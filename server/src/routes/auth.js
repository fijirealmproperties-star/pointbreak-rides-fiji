const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { generateTokens, verifyRefreshToken } = require('../config/jwt');
const { loginLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

module.exports = (db) => {
  router.post('/register', loginLimiter, async (req, res) => {
    try {
      const { name, phone, password, role } = req.body || {};
      if (!name || !phone || !password) {
        return res.status(400).json({ error: 'name, phone and password are required' });
      }

      if (role === 'driver') {
        return res.status(403).json({ error: 'Driver accounts are not open for public registration' });
      }
      if (String(password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      const finalRole = 'rider';
      const existing = db.prepare('SELECT id FROM users WHERE phone=?').get(phone);
      if (existing) return res.status(409).json({ error: 'Phone number already registered' });

      const hashed = await bcrypt.hash(password, 10);
      const userId = uuidv4();
      db.prepare('INSERT INTO users (id, name, phone, password_hash, role) VALUES (?,?,?,?,?)')
        .run(userId, name, phone, hashed, finalRole);

      let user = db.prepare('SELECT id, name, phone, role, created_at FROM users WHERE id=?').get(userId);

      const tokens = generateTokens(userId, finalRole);
      res.json({ user, ...tokens });
    } catch (err) {
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  router.post('/login', loginLimiter, async (req, res) => {
    try {
      const { phone, password } = req.body || {};
      if (!phone || !password) {
        return res.status(400).json({ error: 'phone and password are required' });
      }

      const user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
      if (!user) return res.status(401).json({ error: 'Invalid phone or password' });

      const ok = await bcrypt.compare(password || '', user.password_hash || '');
      if (!ok) return res.status(401).json({ error: 'Invalid phone or password' });

      const payload = { id: user.id, name: user.name, phone: user.phone, role: user.role, created_at: user.created_at };
      if (user.role === 'driver') {
        const driver = db.prepare('SELECT * FROM drivers WHERE user_id=?').get(user.id);
        if (driver) payload.driverProfile = driver;
      }

      const tokens = generateTokens(user.id, user.role);
      res.json({ user: payload, ...tokens });
    } catch (err) {
      res.status(500).json({ error: 'Login failed' });
    }
  });

  router.post('/refresh', (req, res) => {
    const token = req.body && req.body.refreshToken;
    if (!token) return res.status(400).json({ error: 'Refresh token required' });
    try {
      const decoded = verifyRefreshToken(token);
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(decoded.userId);
      if (!user) return res.status(401).json({ error: 'User not found' });

      const payload = { id: user.id, name: user.name, phone: user.phone, role: user.role };
      if (user.role === 'driver') {
        const driver = db.prepare('SELECT * FROM drivers WHERE user_id=?').get(user.id);
        if (driver) payload.driverProfile = driver;
      }

      const tokens = generateTokens(user.id, user.role);
      res.json({ user: payload, ...tokens });
    } catch (err) {
      res.status(401).json({ error: 'Invalid refresh token' });
    }
  });

  return router;
};
