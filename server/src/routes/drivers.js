const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { rideForDriver } = require('../rides/ride-utils');

const router = express.Router();

// Committed trip states. 'requested' is a pending offer only.
const ACTIVE_STATUSES = ['accepted', 'arrived', 'in_progress'];

module.exports = (db, matchingEngine) => {
  router.use(requireAuth, requireRole('driver'));

  const driverFor = (userId) => db.prepare('SELECT * FROM drivers WHERE user_id=?').get(userId);

  // A committed trip. 'requested' is only a pending offer, so it must not
  // lock the driver into a busy state or bounce them into a dead ride screen.
  const activeRideFor = (driverId) => {
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');
    return db.prepare(
      `SELECT * FROM rides WHERE driver_id=? AND status IN (${placeholders}) ORDER BY requested_at DESC`
    ).get(...[driverId, ...ACTIVE_STATUSES]);
  };

  router.get('/status', (req, res) => {
    const driver = driverFor(req.user.userId);
    if (!driver) return res.status(404).json({ error: 'Driver record not found' });

    const active = activeRideFor(driver.id);
    res.json({ status: driver.status, active_ride_id: active ? active.id : null, driver });
  });

  router.post('/status', (req, res) => {
    try {
      const driver = driverFor(req.user.userId);
      if (!driver) return res.status(404).json({ error: 'Driver record not found' });

      const body = req.body || {};
      let status;
      if (typeof body.online === 'boolean') status = body.online ? 'online' : 'offline';
      else if (body.status === 'online' || body.status === 'offline') status = body.status;
      else return res.status(400).json({ error: 'Pass { online: true/false } or { status: "online"|"offline" }' });

      db.prepare('UPDATE drivers SET status=? WHERE id=?').run(status, driver.id);

      if (status === 'online') {
        const socketId = matchingEngine.socketIdFor(req.user.userId);
        if (socketId) {
          matchingEngine.registerDriver(socketId, req.user.userId, driver.id, driver.lat, driver.lng);
        }
      } else {
        matchingEngine.unregisterDriverById(driver.id);
      }
      matchingEngine.broadcastDrivers();

      const active = activeRideFor(driver.id);
      const fresh = db.prepare('SELECT * FROM drivers WHERE id=?').get(driver.id);
      res.json({
        status: fresh.status,
        active_ride_id: active ? active.id : null,
        driver: fresh,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update driver status' });
    }
  });

  router.get('/active', (req, res) => {
    const driver = driverFor(req.user.userId);
    if (!driver) return res.status(404).json({ error: 'Driver record not found' });

    const ride = activeRideFor(driver.id);
    res.json({ ride: ride ? rideForDriver(ride) : null });
  });

  router.get('/rides', (req, res) => {
    try {
      const driver = driverFor(req.user.userId);
      if (!driver) return res.status(404).json({ error: 'Driver record not found' });

      const rides = db.prepare(`
        SELECT r.*, d.full_name AS driver_name, u.name AS rider_name, u.phone AS rider_phone
        FROM rides r
        LEFT JOIN drivers d ON d.id = r.driver_id
        LEFT JOIN users u ON u.id = r.rider_id
        WHERE r.driver_id=?
        ORDER BY r.requested_at DESC
      `).all(driver.id);
      res.json({ rides: rides.map(rideForDriver) });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load rides' });
    }
  });

  router.get('/stats', (req, res) => {
    try {
      const driver = driverFor(req.user.userId);
      if (!driver) return res.status(404).json({ error: 'Driver record not found' });

      const all = db.prepare('SELECT COUNT(*) AS c FROM rides WHERE driver_id=?').get(driver.id) || { c: 0 };
      const completed = db.prepare("SELECT * FROM rides WHERE driver_id=? AND status='completed'").all(driver.id);
      const cancelled = db.prepare("SELECT COUNT(*) AS c FROM rides WHERE driver_id=? AND status='cancelled'").get(driver.id) || { c: 0 };

      const rated = completed.filter((r) => r.rating != null);
      const average_rating = rated.length
        ? Math.round((rated.reduce((sum, r) => sum + Number(r.rating), 0) / rated.length) * 10) / 10
        : null;
      const total_earnings = Math.round(completed.reduce((sum, r) => sum + (Number(r.fare) || 0), 0) * 100) / 100;

      res.json({
        total_trips: all.c,
        completed_trips: completed.length,
        average_rating,
        total_earnings,
        cancelled_trips: cancelled.c,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load stats' });
    }
  });

  router.post('/location', (req, res) => {
    const lat = Number(req.body && req.body.lat);
    const lng = Number(req.body && req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng must be numbers' });
    }

    const driver = driverFor(req.user.userId);
    if (!driver) return res.status(404).json({ error: 'Driver record not found' });

    // A driver running a roadside trip stays hidden from riders and admin.
    const onRoadside = db.prepare("SELECT 1 FROM roadside_trips WHERE driver_id=? AND status='running' AND created_at >= datetime('now','-6 hours')").get(driver.id);
    if (onRoadside) return res.json({ ok: true, hidden: true });
    matchingEngine.updateLocation(driver.id, lat, lng);
    db.prepare('UPDATE drivers SET lat=?, lng=? WHERE id=?').run(lat, lng, driver.id);
    res.json({ ok: true, lat, lng });
  });

  router.post('/roadside/start', (req, res) => {
    const { tariff_type } = req.body || {};
    if (!/^[A-Z_a-z]{3,40}$/.test(String(tariff_type || ''))) return res.status(400).json({ error: 'Invalid tariff' });
    const driver = driverFor(req.user.userId);
    if (!driver) return res.status(404).json({ error: 'Driver record not found' });
    if (activeRideFor(driver.id)) return res.status(409).json({ error: 'Finish your current ride first' });
    db.prepare("UPDATE roadside_trips SET status='finished', ended_at=datetime('now') WHERE driver_id=? AND status='running'").run(driver.id);
    const info = db.prepare("INSERT INTO roadside_trips (driver_id, tariff_type, total_fare, status) VALUES (?, ?, 0, 'running')")
      .run(driver.id, tariff_type);
    if (!info.changes || !info.lastInsertRowid) return res.status(500).json({ error: 'Could not start meter trip' });
    db.prepare("UPDATE drivers SET status='offline' WHERE id=?").run(driver.id);
    matchingEngine.unregisterDriverById(driver.id);
    matchingEngine.broadcastDrivers();
    res.json({ ok: true, trip_id: info.lastInsertRowid, status: 'offline' });
  });

  router.post('/roadside', (req, res) => {
    const { trip_id, tariff_type, total_fare, trip_duration_seconds, trip_distance_km } = req.body || {};
    const fare = Number(total_fare);
    if (!/^[A-Z_a-z]{3,40}$/.test(String(tariff_type || '')) || !Number.isFinite(fare) || fare < 0 || fare > 100000) {
      return res.status(400).json({ error: 'Invalid roadside trip' });
    }
    const driver = driverFor(req.user.userId);
    const driverId = driver ? driver.id : req.user.userId;
    const secs = Math.max(0, Math.round(Number(trip_duration_seconds) || 0));
    const km = Math.max(0, Number(trip_distance_km) || 0);
    if (trip_id && db.prepare("SELECT id FROM roadside_trips WHERE id=? AND driver_id=? AND status='finished'").get(trip_id, driverId)) {
      return res.json({ ok: true });
    }
    const open = trip_id
      ? db.prepare("SELECT id FROM roadside_trips WHERE id=? AND driver_id=? AND status='running'").get(trip_id, driverId)
      : null;
    if (open) {
      db.prepare("UPDATE roadside_trips SET tariff_type=?, total_fare=?, trip_duration_seconds=?, trip_distance_km=?, status='finished', ended_at=datetime('now') WHERE id=?")
        .run(tariff_type, fare, secs, km, open.id);
    } else {
      db.prepare("INSERT INTO roadside_trips (driver_id, tariff_type, total_fare, trip_duration_seconds, trip_distance_km, status, ended_at) VALUES (?, ?, ?, ?, ?, 'finished', datetime('now'))")
        .run(driverId, tariff_type, fare, secs, km);
    }
    res.json({ ok: true });
  });

  router.get('/roadside-trips', (req, res) => {
    const driver = driverFor(req.user.userId);
    const id = driver ? driver.id : req.user.userId;
    const trips = db.prepare("SELECT id, tariff_type, total_fare, trip_distance_km, trip_duration_seconds, created_at, ended_at FROM roadside_trips WHERE driver_id=? AND status='finished' ORDER BY id DESC LIMIT 200").all(id);
    res.json({ trips });
  });
  return router;
};