const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { loginLimiter } = require('../middleware/rateLimiter');
const { requireWebsiteAdmin } = require('../middleware/website-admin-auth');
const { normEmail, validEmail } = require('../verify');
const { generateWebsiteTokens, verifyWebsiteRefreshToken } = require('../config/website-jwt');

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validUsername(value) {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(value) || validEmail(value);
}

module.exports = (db) => {
  const router = express.Router();

  function sessionFor(admin) {
    return {
      user: {
        id: admin.id,
        username: admin.username || admin.email,
        email: admin.email || null,
        role: 'website_admin',
      },
      ...generateWebsiteTokens(admin.id),
    };
  }

  router.get('/status', (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS count FROM website_admins').get().count;
    res.set('Cache-Control', 'no-store');
    res.json({
      signupRequired: count === 0,
    });
  });

  router.post('/signup', loginLimiter, async (req, res) => {
    if (db.prepare('SELECT id FROM website_admins LIMIT 1').get()) {
      return res.status(409).json({ error: 'Website admin signup is closed' });
    }
    const body = req.body || {};
    const suppliedUsername = body.username || body.email;
    const username = normalizeUsername(suppliedUsername);
    const email = body.email ? normEmail(body.email) : null;
    const password = body.password;
    if (!validUsername(username)) {
      return res.status(400).json({ error: 'Use a username with 3-32 letters, numbers, dots, underscores or hyphens' });
    }
    if (email && !validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
      return res.status(400).json({ error: 'Choose a password between 12 and 200 characters' });
    }
    const id = uuidv4();
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      if (db.prepare('SELECT id FROM website_admins LIMIT 1').get()) {
        return res.status(409).json({ error: 'Website admin signup is closed' });
      }
      db.prepare('INSERT INTO website_admins (id, username, email, password_hash) VALUES (?, ?, ?, ?)')
        .run(id, username, email, passwordHash);
      const admin = db.prepare('SELECT id, username, email FROM website_admins WHERE id=?').get(id);
      if (!admin) return res.status(500).json({ error: 'Could not create the website admin account' });
      res.status(201).json(sessionFor(admin));
    } catch (error) {
      if (db.prepare('SELECT id FROM website_admins LIMIT 1').get()) {
        return res.status(409).json({ error: 'Website admin signup is closed' });
      }
      console.error('Website admin signup failed:', error.message);
      return res.status(500).json({ error: 'Could not create the website admin account' });
    }
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const body = req.body || {};
    const username = normalizeUsername(body.username || body.email);
    const password = body.password;
    if (!validUsername(username) || typeof password !== 'string') {
      return res.status(400).json({ error: 'A valid username and password are required' });
    }
    const admin = db.prepare(`
      SELECT id, username, email, password_hash
      FROM website_admins
      WHERE username=? OR LOWER(email)=?
      LIMIT 1
    `).get(username, username);
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      return res.status(401).json({ error: 'Invalid website admin username or password' });
    }
    res.json(sessionFor(admin));
  });

  router.post('/refresh', loginLimiter, (req, res) => {
    const refreshToken = req.body && req.body.refreshToken;
    if (typeof refreshToken !== 'string') return res.status(401).json({ error: 'Website admin session expired' });
    try {
      const decoded = verifyWebsiteRefreshToken(refreshToken);
      if (decoded.role !== 'website_admin') throw new Error('Invalid role');
      const admin = db.prepare('SELECT id, username, email FROM website_admins WHERE id=?').get(decoded.userId);
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
