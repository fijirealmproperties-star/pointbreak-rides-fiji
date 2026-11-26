const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { loginLimiter } = require('../middleware/rateLimiter');
const { requireWebsiteAdmin } = require('../middleware/website-admin-auth');
const { normEmail, validEmail } = require('../verify');
const { generateWebsiteTokens, verifyWebsiteRefreshToken } = require('../config/website-jwt');

module.exports = (db) => {
  const router = express.Router();

  function sessionFor(admin) {
    return {
      user: { id: admin.id, email: admin.email, role: 'website_admin' },
      ...generateWebsiteTokens(admin.id),
    };
  }

  router.get('/status', (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS count FROM website_admins').get().count;
    res.set('Cache-Control', 'no-store');
    res.json({
      setupRequired: count === 0,
      setupConfigured: typeof process.env.WEBSITE_ADMIN_SETUP_KEY === 'string' &&
        process.env.WEBSITE_ADMIN_SETUP_KEY.length >= 32,
    });
  });

  router.post('/setup', loginLimiter, async (req, res) => {
    const configuredKey = process.env.WEBSITE_ADMIN_SETUP_KEY;
    if (!configuredKey || configuredKey.length < 32) {
      return res.status(503).json({ error: 'Website admin setup is not configured on the server' });
    }
    if (db.prepare('SELECT id FROM website_admins LIMIT 1').get()) {
      return res.status(409).json({ error: 'The first website admin has already been created' });
    }
    const suppliedKey = typeof (req.body && req.body.setupKey) === 'string' ? req.body.setupKey : '';
    const expected = Buffer.from(configuredKey);
    const supplied = Buffer.from(suppliedKey);
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
      return res.status(403).json({ error: 'The setup key is incorrect' });
    }
    const email = normEmail(req.body && req.body.email);
    const password = req.body && req.body.password;
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid website admin email address' });
    if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
      return res.status(400).json({ error: 'Choose a password between 12 and 200 characters' });
    }
    const id = uuidv4();
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      if (db.prepare('SELECT id FROM website_admins LIMIT 1').get()) {
        return res.status(409).json({ error: 'The first website admin has already been created' });
      }
      db.prepare('INSERT INTO website_admins (id, email, password_hash) VALUES (?, ?, ?)')
        .run(id, email, passwordHash);
      const admin = db.prepare('SELECT id, email FROM website_admins WHERE id=?').get(id);
      if (!admin) return res.status(500).json({ error: 'Could not create the website admin account' });
      res.status(201).json(sessionFor(admin));
    } catch (error) {
      if (db.prepare('SELECT id FROM website_admins LIMIT 1').get()) {
        return res.status(409).json({ error: 'A website admin was created while setup was in progress' });
      }
      console.error('Website admin setup failed:', error.message);
      return res.status(500).json({ error: 'Could not create the website admin account' });
    }
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const email = normEmail(req.body && req.body.email);
    const password = req.body && req.body.password;
    if (!email || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const admin = db.prepare('SELECT id, email, password_hash FROM website_admins WHERE email=?').get(email);
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      return res.status(401).json({ error: 'Invalid website admin email or password' });
    }
    res.json(sessionFor(admin));
  });

  router.post('/refresh', loginLimiter, (req, res) => {
    const refreshToken = req.body && req.body.refreshToken;
    if (typeof refreshToken !== 'string') return res.status(401).json({ error: 'Website admin session expired' });
    try {
      const decoded = verifyWebsiteRefreshToken(refreshToken);
      if (decoded.role !== 'website_admin') throw new Error('Invalid role');
      const admin = db.prepare('SELECT id, email FROM website_admins WHERE id=?').get(decoded.userId);
      if (!admin) return res.status(401).json({ error: 'Website admin account not found' });
      res.json(sessionFor(admin));
    } catch {
      res.status(401).json({ error: 'Website admin session expired' });
    }
  });

  router.put('/password', requireWebsiteAdmin, async (req, res) => {
    const oldPassword = req.body && req.body.oldPassword;
    const newPassword = req.body && req.body.newPassword;
    if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 200) {
      return res.status(400).json({ error: 'Choose a password between 12 and 200 characters' });
    }
    const admin = db.prepare('SELECT id, password_hash FROM website_admins WHERE id=?').get(req.websiteAdmin.id);
    if (!admin || typeof oldPassword !== 'string' || !(await bcrypt.compare(oldPassword, admin.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    db.prepare('UPDATE website_admins SET password_hash=? WHERE id=?')
      .run(await bcrypt.hash(newPassword, 12), admin.id);
    res.json({ ok: true });
  });

  return router;
};
