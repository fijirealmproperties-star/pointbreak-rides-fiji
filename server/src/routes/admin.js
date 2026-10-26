const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { requireAuth, requireRole } = require('../middleware/auth');

module.exports = (db) => {
  const router = express.Router();

  router.use(requireAuth, requireRole('admin'));

  // Live map data for the admin dashboard (auth required — contains rider phones).
  router.get('/rides/all', (req, res) => {
    const rides = db.prepare(`
      SELECT r.*, d.full_name AS driver_name, u.name AS rider_name, u.phone AS rider_phone
      FROM rides r
      LEFT JOIN drivers d ON d.id = r.driver_id
      LEFT JOIN users u ON u.id = r.rider_id
      ORDER BY r.requested_at DESC
    `).all();
    res.json({ rides });
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
      const existing = db.prepare('SELECT id FROM users WHERE phone=?').get(phone);
      if (existing) return res.status(409).json({ error: 'Phone number already registered' });

      const userId = uuidv4();
      const driverId = uuidv4();
      const hashed = await bcrypt.hash(password, 10);

      db.prepare('INSERT INTO users (id, name, phone, password_hash, role) VALUES (?,?,?,?,?)')
        .run(userId, name, phone, hashed, 'driver');

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
