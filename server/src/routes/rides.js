const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth, requireRole } = require('../middleware/auth');
const { haversine, calculateFare, computeRoutePath } = require('../rides/fare');
const { getRoadRoute } = require('../rides/routing');
const { loadRide, rideForDriver } = require('../rides/ride-utils');

const AVG_SPEED_KMH = 30;
// Demo/testing builds may reveal a ride's pickup code to its assigned driver.
const DEMO_MODE = process.env.NODE_ENV !== 'production' || process.env.DEMO_MODE === 'true';
const router = express.Router();

function resolvePlace(db, body, prefix) {
  const id = body[`${prefix}_place_id`] || body[`${prefix}PlaceId`];
  if (id) {
    const p = db.prepare('SELECT * FROM places WHERE id=?').get(id);
    if (p) return p;
  }
  const lat = Number(body[`${prefix}_lat`]);
  const lng = Number(body[`${prefix}_lng`]);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const name = body[`${prefix}_name`] || (prefix === 'pickup' ? 'Pickup point' : 'Drop-off point');
    return { id: null, name, short_name: name, type: 'custom', lat, lng, region: 'Custom' };
  }
  return null;
}

async function estimateFor(db, pickup, dropoff) {
  const routed = await getRoadRoute(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);

  let distanceKm;
  let durationMin;
  let path;
  if (routed) {
    // Real road distance/duration from the routing engine.
    distanceKm = routed.distance_km;
    durationMin = routed.duration_min;
    path = routed.path;
  } else {
    // Fallback: straight-line approximation (routing service unavailable).
    distanceKm = haversine(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
    durationMin = (distanceKm / AVG_SPEED_KMH) * 60;
    path = computeRoutePath(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
  }

  const fare = calculateFare(distanceKm, durationMin);
  return {
    distance_km: fare.distanceKm,
    duration_min: fare.durationMin,
    fare: fare.fare,
    currency: fare.currency,
    base_fare: fare.baseFare,
    per_km: fare.perKmRate,
    per_minute: fare.perMinRate,
    surge_multiplier: 1,
    driver_payout: Math.round(fare.fare * 0.75 * 100) / 100,
    routed: !!routed,
    pickup,
    dropoff,
    path,
  };
}

module.exports = (db, io, matchingEngine) => {
  router.use(requireAuth);

  router.post('/estimate', async (req, res) => {
    try {
      const body = req.body || {};
      const pickup = resolvePlace(db, body, 'pickup');
      const dropoff = resolvePlace(db, body, 'dropoff');
      if (!pickup || !dropoff) {
        return res.status(400).json({ error: 'pickup and dropoff are required' });
      }
      res.json(await estimateFor(db, pickup, dropoff));
    } catch (err) {
      res.status(500).json({ error: 'Estimate failed' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const body = req.body || {};
      const pickup = resolvePlace(db, body, 'pickup');
      const dropoff = resolvePlace(db, body, 'dropoff');
      if (!pickup || !dropoff) {
        return res.status(400).json({ error: 'pickup and dropoff are required' });
      }

      const est = await estimateFor(db, pickup, dropoff);
      const id = uuidv4();
      const pickupCode = String(Math.floor(1000 + Math.random() * 9000));

      db.prepare('INSERT INTO rides (id, rider_id, pickup_place, dropoff_place, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, fare, currency, status, distance_km, duration_min, path_json, pickup_code, quoted_fare, meter_distance_km, meter_fare) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          id,
          req.user.userId,
          pickup.name,
          dropoff.name,
          pickup.lat,
          pickup.lng,
          dropoff.lat,
          dropoff.lng,
          est.fare,
          'FJD',
          'requested',
          est.distance_km,
          est.duration_min,
          JSON.stringify(est.path),
          pickupCode,
          est.fare,
          0,
          0
        );

      const ride = loadRide(db, id);
      matchingEngine.matchRide(id, pickup.lat, pickup.lng);
      res.json(ride);
    } catch (err) {
      res.status(500).json({ error: 'Failed to request ride' });
    }
  });

  router.get('/', (req, res) => {
    try {
      if (req.user.role === 'driver') {
        const driver = db.prepare('SELECT * FROM drivers WHERE user_id=?').get(req.user.userId);
        if (!driver) return res.status(403).json({ error: 'Driver record not found' });
        const rides = db.prepare(`
          SELECT r.*, d.full_name AS driver_name, u.name AS rider_name, u.phone AS rider_phone
          FROM rides r
          LEFT JOIN drivers d ON d.id = r.driver_id
          LEFT JOIN users u ON u.id = r.rider_id
          WHERE r.driver_id=?
          ORDER BY r.requested_at DESC
        `).all(driver.id);
        return res.json({ rides: rides.map(rideForDriver) });
      }

      const rides = db.prepare(`
        SELECT r.*, d.full_name AS driver_name, d.phone AS driver_phone, d.vehicle_type, d.vehicle_model,
               d.license_plate, d.rating AS driver_rating, d.trips AS driver_trips, u.name AS rider_name
        FROM rides r
        LEFT JOIN drivers d ON d.id = r.driver_id
        LEFT JOIN users u ON u.id = r.rider_id
        WHERE r.rider_id=?
        ORDER BY r.requested_at DESC
      `).all(req.user.userId);
      res.json({ rides });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load rides' });
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const ride = loadRide(db, req.params.id);
      if (!ride) return res.status(404).json({ error: 'Ride not found' });

      const isRider = ride.rider_id === req.user.userId;
      let isDriver = false;
      if (req.user.role === 'driver') {
        const driver = db.prepare('SELECT * FROM drivers WHERE user_id=?').get(req.user.userId);
        isDriver = driver && ride.driver_id === driver.id;
      }
      if (!isRider && !isDriver) {
        return res.status(403).json({ error: 'Not authorized to view this ride' });
      }
      res.json(isDriver && !isRider ? rideForDriver(ride) : ride);
    } catch (err) {
      res.status(500).json({ error: 'Failed to load ride' });
    }
  });

  router.post('/:id/accept', requireRole('driver'), (req, res) => {
    try {
      const driver = db.prepare('SELECT * FROM drivers WHERE user_id=?').get(req.user.userId);
      if (!driver) return res.status(403).json({ error: 'Driver record not found' });

      const ride = matchingEngine.acceptRide(driver.id, req.params.id);
      if (!ride) {
        const existing = loadRide(db, req.params.id);
        return res.json(existing ? rideForDriver(existing) : { error: 'Ride not found' });
      }
      res.json(rideForDriver(ride));
    } catch (err) {
      res.status(500).json({ error: 'Failed to accept ride' });
    }
  });

  router.post('/:id/status', requireRole('driver'), (req, res) => {
    try {
      const driver = db.prepare('SELECT * FROM drivers WHERE user_id=?').get(req.user.userId);
      if (!driver) return res.status(403).json({ error: 'Driver record not found' });

      const { status, code } = req.body || {};
      if (!['arrived', 'in_progress', 'completed'].includes(status)) {
        return res.status(400).json({ error: 'status must be arrived, in_progress or completed' });
      }
      if (status === 'in_progress' && !code) {
        return res.status(400).json({ error: 'Enter the rider\u2019s pickup code to start the trip' });
      }

      const ride = matchingEngine.transitionRide(driver.id, req.params.id, status, { code });
      if (ride && ride.error) {
        const message =
          ride.error === 'invalid_code'
            ? 'Incorrect pickup code \u2014 ask your rider for their code'
            : 'Enter the rider\u2019s pickup code to start the trip';
        return res.status(400).json({ error: message });
      }
      if (!ride) return res.status(400).json({ error: 'Ride cannot transition to that status' });
      res.json(rideForDriver(ride));
    } catch (err) {
      res.status(500).json({ error: 'Failed to update ride' });
    }
  });

  router.get('/:id/pickup-code', requireRole('driver'), (req, res) => {
    if (!DEMO_MODE) return res.status(404).json({ error: 'Not found' });
    try {
      const driver = db.prepare('SELECT * FROM drivers WHERE user_id=?').get(req.user.userId);
      if (!driver) return res.status(403).json({ error: 'Driver record not found' });
      const ride = loadRide(db, req.params.id);
      if (!ride) return res.status(404).json({ error: 'Ride not found' });
      if (ride.driver_id !== driver.id) {
        return res.status(403).json({ error: 'Not your ride' });
      }
      res.json({ pickup_code: ride.pickup_code });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load code' });
    }
  });

  router.post('/:id/cancel', (req, res) => {
    try {
      if (req.user.role !== 'rider') {
        return res.status(403).json({ error: 'Only riders can cancel rides' });
      }

      const ride = db.prepare('SELECT * FROM rides WHERE id=?').get(req.params.id);
      if (!ride) return res.status(404).json({ error: 'Ride not found' });
      if (ride.rider_id !== req.user.userId) {
        return res.status(403).json({ error: 'Not authorized to cancel this ride' });
      }

      const cancelled = matchingEngine.cancelRide(req.params.id);
      if (!cancelled) return res.status(400).json({ error: 'Ride cannot be cancelled' });
      res.json(cancelled);
    } catch (err) {
      res.status(500).json({ error: 'Failed to cancel ride' });
    }
  });

  router.post('/:id/rate', (req, res) => {
    try {
      const rating = Number(req.body && req.body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
      }

      const ride = db.prepare('SELECT * FROM rides WHERE id=?').get(req.params.id);
      if (!ride) return res.status(404).json({ error: 'Ride not found' });
      if (ride.rider_id !== req.user.userId) {
        return res.status(403).json({ error: 'Only the rider can rate this ride' });
      }
      if (ride.status !== 'completed') {
        return res.status(400).json({ error: 'Only completed rides can be rated' });
      }

      db.prepare('UPDATE rides SET rating=? WHERE id=?').run(rating, req.params.id);
      if (ride.driver_id) {
        const stats = db.prepare('SELECT AVG(rating) AS avg FROM rides WHERE driver_id=? AND rating IS NOT NULL').get(ride.driver_id);
        const avg = stats && stats.avg ? Math.round(stats.avg * 10) / 10 : 5.0;
        db.prepare('UPDATE drivers SET rating=? WHERE id=?').run(avg, ride.driver_id);
      }

      res.json(loadRide(db, req.params.id));
    } catch (err) {
      res.status(500).json({ error: 'Failed to rate ride' });
    }
  });

  return router;
};