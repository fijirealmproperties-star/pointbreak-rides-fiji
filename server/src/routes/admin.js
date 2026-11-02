const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { requireAuth, requireRole } = require('../middleware/auth');
const { onlineRiders } = require('../presence');
const { sendPush } = require('../push');
const { normEmail, validEmail, mailConfigured } = require('../verify');

module.exports = (db) => {
  const router = express.Router();

  router.use(requireAuth, requireRole('admin'));

  // Broadcast a notice to riders, drivers or everyone (in-app bell + push).
  router.post('/notices', async (req, res) => {
    const title = String((req.body && req.body.title) || '').trim().slice(0, 80);
    const body = String((req.body && req.body.body) || '').trim().slice(0, 500);
    const audience = ['all', 'riders', 'drivers'].includes(req.body && req.body.audience) ? req.body.audience : 'all';
    if (!title || !body) return res.status(400).json({ error: 'Title and message are required' });

    const id = uuidv4();
    db.prepare('INSERT INTO notices (id, title, body, audience) VALUES (?, ?, ?, ?)').run(id, title, body, audience);

    const roles = audience === 'riders' ? ['rider'] : audience === 'drivers' ? ['driver'] : ['rider', 'driver'];
    const users = db.prepare(
      `SELECT id FROM users WHERE role IN (${roles.map(() => '?').join(',')})`
    ).all(...roles);
    const results = await Promise.all(users.map((u) => sendPush(db, u.id, {
      title: `📢 ${title}`,
      body,
      tag: `notice-${id}`,
    }).catch(() => 0)));
    const pushed = results.filter((n) => n > 0).length;
    res.json({ ok: true, id, recipients: users.length, pushed });
  });

  router.get('/notices', (req, res) => {
    const notices = db.prepare('SELECT * FROM notices ORDER BY created_at DESC LIMIT 20').all();
    res.json({ notices });
  });

  router.delete('/notices/:id', (req, res) => {
    db.prepare('DELETE FROM notices WHERE id=?').run(req.params.id);
    db.prepare('DELETE FROM notice_reads WHERE notice_id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // Live map data for the admin dashboard (auth required — contains rider phones).
  router.get('/rides/all', (req, res) => {
    const rides = db.prepare(`
      SELECT r.*, d.full_name AS driver_name, u.name AS rider_name, u.phone AS rider_phone, u.email AS rider_email
      FROM rides r
      LEFT JOIN drivers d ON d.id = r.driver_id
      LEFT JOIN users u ON u.id = r.rider_id
      ORDER BY r.requested_at DESC
    `).all();
    res.json({ rides });
  });

  router.get('/riders/live', (req, res) => {
    const riders = onlineRiders().map((p) => {
      const u = db.prepare('SELECT id, name, phone FROM users WHERE id=?').get(p.userId);
      return u ? { id: u.id, name: u.name, phone: u.phone, lat: p.lat, lng: p.lng, last_seen: new Date(p.at).toISOString() } : null;
    }).filter(Boolean);
    res.json({ riders });
  });

  // ---- Account management: list, inspect, suspend and delete riders/drivers ----
  router.get('/users', (req, res) => {
    const users = db.prepare(`
      SELECT u.id, u.name, u.phone, u.email, u.email_verified, u.role, u.created_at, u.suspended, u.suspended_reason,
             d.id AS driver_id, d.vehicle_type, d.vehicle_model, d.license_plate, d.status AS driver_status,
             d.rating AS driver_rating, d.trips AS driver_trips,
             (SELECT COUNT(*) FROM rides r WHERE r.rider_id = u.id) AS rides_as_rider,
             (SELECT COUNT(*) FROM rides r WHERE r.rider_id = u.id AND r.status = 'cancelled') AS cancelled_rides,
             (SELECT COUNT(*) FROM rides r WHERE d.id IS NOT NULL AND r.driver_id = d.id) AS rides_as_driver,
             (SELECT MAX(r.requested_at) FROM rides r WHERE r.rider_id = u.id OR (d.id IS NOT NULL AND r.driver_id = d.id)) AS last_ride_at
      FROM users u
      LEFT JOIN drivers d ON d.user_id = u.id
      WHERE u.role != 'admin'
      ORDER BY u.created_at DESC
    `).all();
    res.json({ users });
  });

  router.get('/users/:id', (req, res) => {
    const user = db.prepare('SELECT id, name, phone, role, created_at, suspended, suspended_reason FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id=?').get(user.id) || null;
    const rides = db.prepare(`
      SELECT r.id, r.pickup_place, r.dropoff_place, r.status, r.fare, r.final_fare, r.rating, r.requested_at,
             d.full_name AS driver_name, u.name AS rider_name
      FROM rides r
      LEFT JOIN drivers d ON d.id = r.driver_id
      LEFT JOIN users u ON u.id = r.rider_id
      WHERE r.rider_id = ? OR r.driver_id = ?
      ORDER BY r.requested_at DESC LIMIT 25
    `).all(user.id, driver ? driver.id : '');
    res.json({ user, driver, rides });
  });

  // Private message to one user (bell + push).
  router.post('/users/:id/message', async (req, res) => {
    const user = db.prepare('SELECT id, role FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const title = String((req.body && req.body.title) || '').trim().slice(0, 80);
    const body = String((req.body && req.body.body) || '').trim().slice(0, 500);
    if (!title || !body) return res.status(400).json({ error: 'Title and message are required' });
    const id = uuidv4();
    db.prepare('INSERT INTO notices (id, title, body, audience) VALUES (?, ?, ?, ?)').run(id, title, body, 'user:' + user.id);
    const pushed = await sendPush(db, user.id, { title: `💬 ${title}`, body, tag: `notice-${id}` }).catch(() => 0);
    res.json({ ok: true, id, pushed: pushed > 0 });
  });

  // Passwords are hashed and cannot be read; set a temporary one to help a locked-out user.
  router.post('/users/:id/reset-password', async (req, res) => {
    const user = db.prepare('SELECT id, role FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ error: 'Admin passwords cannot be reset here' });
    let password = String((req.body && req.body.password) || '').trim();
    if (!password) {
      const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
      password = Array.from(require('crypto').randomBytes(8), (b) => chars[b % chars.length]).join('');
    }
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await bcrypt.hash(password, 10), user.id);
    res.json({ ok: true, password });
  });

  // Set or fix a user's email (marks it verified) so they can use Forgot password.
  router.post('/users/:id/email', (req, res) => {
    const user = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const email = normEmail(req.body && req.body.email);
    if (!validEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
    const other = db.prepare('SELECT id FROM users WHERE lower(email)=? AND id!=?').get(email, user.id);
    if (other) return res.status(409).json({ error: 'Email already used by another account' });
    db.prepare('UPDATE users SET email=?, email_verified=1 WHERE id=?').run(email, user.id);
    res.json({ ok: true });
  });

  // Live codes, only kept readable while no email provider is configured.
  router.get('/email-codes', (req, res) => {
    const codes = db.prepare(
      `SELECT c.purpose, c.email, c.code_plain AS code, c.created_at, u.name, u.phone
       FROM email_codes c JOIN users u ON u.id = c.user_id
       WHERE c.code_plain IS NOT NULL AND c.expires_at > ? ORDER BY c.created_at DESC`
    ).all(Date.now());
    res.json({ codes, mailConfigured: mailConfigured() });
  });

  router.post('/users/:id/suspend', (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ error: 'Admin accounts cannot be suspended' });
    const suspended = req.body && req.body.suspended === false ? 0 : 1;
    const reason = String((req.body && req.body.reason) || '').trim().slice(0, 300);
    if (suspended) {
      db.prepare("UPDATE users SET suspended=1, suspended_reason=?, suspended_at=datetime('now') WHERE id=?").run(reason || null, user.id);
      db.prepare("UPDATE drivers SET status='offline' WHERE user_id=? AND status='online'").run(user.id);
    } else {
      db.prepare('UPDATE users SET suspended=0, suspended_reason=NULL, suspended_at=NULL WHERE id=?').run(user.id);
    }
    res.json({ ok: true, suspended: !!suspended });
  });

  // Permanently removes the account. Ride history is kept for records.
  router.delete('/users/:id', (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ error: 'Admin accounts cannot be deleted' });
    if (user.id === req.user.userId) return res.status(400).json({ error: 'You cannot delete your own account' });

    const driver = db.prepare('SELECT id FROM drivers WHERE user_id=?').get(user.id);
    const active = db.prepare(
      "SELECT id FROM rides WHERE (rider_id=? OR driver_id=?) AND status IN ('requested','accepted','arrived','picking_up','in_progress') LIMIT 1"
    ).get(user.id, driver ? driver.id : '');
    if (active) return res.status(400).json({ error: 'This user has an active ride. Wait for it to finish or cancel it first.' });

    db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(user.id);
    db.prepare('DELETE FROM notice_reads WHERE user_id=?').run(user.id);
    db.prepare('DELETE FROM email_codes WHERE user_id=?').run(user.id);
    if (driver) db.prepare('DELETE FROM drivers WHERE id=?').run(driver.id);
    db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    res.json({ ok: true });
  });

  router.get('/counts', (req, res) => {
    const riders = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'rider'").get().n;
    const drivers = db.prepare('SELECT COUNT(*) AS n FROM drivers').get().n;
    res.json({ riders, drivers });
  });

  router.get('/drivers/all', (req, res) => {
    const drivers = db.prepare(`
      SELECT d.*, u.name
      FROM drivers d
      LEFT JOIN users u ON u.id = d.user_id
      ORDER BY d.status, d.full_name
    `).all();
    res.json({ drivers });
  });

  router.get('/drivers', (req, res) => {
    const drivers = db.prepare(`
      SELECT d.*, u.name AS user_name
      FROM drivers d
      JOIN users u ON u.id = d.user_id
      ORDER BY d.created_at DESC
    `).all();
    res.json({ drivers });
  });

  router.post('/drivers', async (req, res) => {
    try {
      const { name, phone, password, vehicle_type, vehicle_model, license_plate, lat, lng } = req.body || {};
      if (!name || !phone || !password) {
        return res.status(400).json({ error: 'name, phone and password are required' });
      }
      const email = normEmail(req.body && req.body.email);
      if (email && !validEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
      if (email && db.prepare('SELECT id FROM users WHERE lower(email)=?').get(email)) {
        return res.status(409).json({ error: 'Email already registered to another account' });
      }
      const existing = db.prepare('SELECT id FROM users WHERE phone=?').get(phone);
      if (existing) return res.status(409).json({ error: 'Phone number already registered' });

      const userId = uuidv4();
      const driverId = uuidv4();
      const hashed = await bcrypt.hash(password, 10);

      db.prepare('INSERT INTO users (id, name, phone, password_hash, role, email, email_verified) VALUES (?,?,?,?,?,?,1)')
        .run(userId, name, phone, hashed, 'driver', email || null);

      db.prepare(
        'INSERT INTO drivers (id, user_id, full_name, phone, vehicle_type, vehicle_model, license_plate, status, lat, lng, rating, trips) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(
        driverId,
        userId,
        name,
        phone,
        vehicle_type || 'Taxi',
        vehicle_model || 'Unknown',
        license_plate || 'NA 0000',
        'offline',
        Number(lat) || 0,
        Number(lng) || 0,
        5.0,
        0
      );

      const driver = db.prepare('SELECT * FROM drivers WHERE id=?').get(driverId);
      res.status(201).json({ driver });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create driver' });
    }
  });

  router.patch('/drivers/:id', (req, res) => {
    const driver = db.prepare('SELECT * FROM drivers WHERE id=?').get(req.params.id);
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    const fields = ['vehicle_type', 'vehicle_model', 'license_plate', 'lat', 'lng'];
    const updates = [];
    const values = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f}=?`);
        values.push(req.body[f]);
      }
    }
    if (updates.length === 0) return res.json(driver);
    values.push(driver.id);
    db.prepare(`UPDATE drivers SET ${updates.join(', ')} WHERE id=?`).run(...values);
    res.json(db.prepare('SELECT * FROM drivers WHERE id=?').get(driver.id));
  });

  router.delete('/drivers/:id', (req, res) => {
    const driver = db.prepare('SELECT * FROM drivers WHERE id=?').get(req.params.id);
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    const active = db.prepare(
      "SELECT id FROM rides WHERE driver_id=? AND status IN ('requested','accepted','arrived','in_progress')"
    ).get(driver.id);
    if (active) return res.status(400).json({ error: 'Cannot delete a driver with an active ride' });

    db.prepare('DELETE FROM drivers WHERE id=?').run(driver.id);
    db.prepare("UPDATE users SET role='rider' WHERE id=?").run(driver.user_id);
    res.json({ ok: true });
  });

  return router;
};
