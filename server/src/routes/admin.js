const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { requireAuth, requireRole } = require('../middleware/auth');
const { onlineRiders } = require('../presence');
const { sendPush } = require('../push');
const { normEmail, validEmail, mailConfigured } = require('../verify');

module.exports = (db, matchingEngine) => {
  const router = express.Router();

  router.use(requireAuth, requireRole('admin'));

  // Read-only AI assistant: answers admin questions from a live data snapshot.
  router.post('/ai', async (req, res) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return res.status(503).json({ error: 'AI is not set up yet. Add OPENAI_API_KEY in Railway → Variables, then redeploy.' });
    }
    const question = String((req.body && req.body.question) || '').trim().slice(0, 600);
    if (!question) return res.status(400).json({ error: 'Type a question' });
    const history = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-6) : [];

    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const all = (sql, ...a) => db.prepare(sql).all(...a);
    const snapshot = {
      now_utc: new Date().toISOString(),
      totals: {
        riders: one("SELECT COUNT(*) n FROM users WHERE role='rider'").n,
        drivers: one("SELECT COUNT(*) n FROM drivers").n,
        suspended_users: one("SELECT COUNT(*) n FROM users WHERE suspended=1").n,
        online_drivers: one("SELECT COUNT(*) n FROM drivers WHERE status='online'").n,
        rides_total: one('SELECT COUNT(*) n FROM rides').n,
        rides_completed: one("SELECT COUNT(*) n FROM rides WHERE status='completed'").n,
        rides_cancelled: one("SELECT COUNT(*) n FROM rides WHERE status='cancelled'").n,
        revenue_fjd: one("SELECT ROUND(COALESCE(SUM(COALESCE(final_fare,fare)),0),2) n FROM rides WHERE status='completed'").n,
        roadside_trips: one('SELECT COUNT(*) n FROM roadside_trips').n,
        roadside_revenue_fjd: one('SELECT ROUND(COALESCE(SUM(total_fare),0),2) n FROM roadside_trips').n,
      },
      rides_by_status: all('SELECT status, COUNT(*) n FROM rides GROUP BY status'),
      rides_last_14_days: all("SELECT date(requested_at) day, COUNT(*) rides, ROUND(SUM(CASE WHEN status='completed' THEN COALESCE(final_fare,fare) ELSE 0 END),2) revenue FROM rides WHERE requested_at >= datetime('now','-14 day') GROUP BY day ORDER BY day"),
      top_drivers: all("SELECT full_name, vehicle_type, license_plate, status, rating, trips FROM drivers ORDER BY trips DESC LIMIT 10"),
      recent_rides: all("SELECT r.status, r.pickup_place, r.dropoff_place, r.fare, r.final_fare, r.distance_km, r.requested_at, r.scheduled_at, u.name rider, d.full_name driver FROM rides r LEFT JOIN users u ON u.id=r.rider_id LEFT JOIN drivers d ON d.id=r.driver_id ORDER BY r.requested_at DESC LIMIT 25"),
      recent_roadside_trips: all("SELECT t.tariff_type, t.total_fare, t.trip_distance_km, t.trip_duration_seconds, t.created_at, COALESCE(d.full_name,u.name) driver FROM roadside_trips t LEFT JOIN drivers d ON d.id=t.driver_id LEFT JOIN users u ON u.id=t.driver_id ORDER BY t.id DESC LIMIT 15"),
    };

    const messages = [
      {
        role: 'system',
        content:
          'You are the admin assistant for Pointbreak Fiji Rides, a Fiji taxi and ride app. Answer the admin\'s questions using only the JSON data snapshot below. Be short and clear, use FJ$ for money, and say so if the snapshot cannot answer. You are read-only: you cannot change data or send messages; if asked, explain which admin tab to use. Times are UTC; Fiji is UTC+12.\nDATA:\n' +
          JSON.stringify(snapshot),
      },
      ...history
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) })),
      { role: 'user', content: question },
    ];

    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages, temperature: 0.2, max_tokens: 500 }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(502).json({ error: (data.error && data.error.message) || 'The AI service returned an error' });
      res.json({ answer: (data.choices && data.choices[0] && data.choices[0].message.content) || 'No answer.' });
    } catch (e) {
      res.status(502).json({ error: 'Could not reach the AI service. Try again.' });
    }
  });
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
  router.get('/roadside', (req, res) => {
    const trips = db.prepare(`
      SELECT t.*, COALESCE(d.full_name, u.name) AS driver_name, COALESCE(d.phone, u.phone) AS driver_phone
      FROM roadside_trips t
      LEFT JOIN drivers d ON d.id = t.driver_id
      LEFT JOIN users u ON u.id = t.driver_id
      ORDER BY t.id DESC LIMIT 200
    `).all();
    res.json({ trips });
  });

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

  // Manually assign a free driver to an advance booking.
  router.post('/rides/:id/assign', (req, res) => {
    const driverId = req.body && req.body.driver_id;
    if (!driverId) return res.status(400).json({ error: 'driver_id is required' });
    const out = matchingEngine.assignScheduled(req.params.id, driverId);
    if (out.error) return res.status(out.code || 400).json({ error: out.error });
    res.json({ ride: out.ride });
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
