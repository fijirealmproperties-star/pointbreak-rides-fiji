const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { generateTokens, verifyRefreshToken } = require('../config/jwt');
const { loginLimiter } = require('../middleware/rateLimiter');
const { normEmail, validEmail, mailConfigured, issueCode, checkCode } = require('../verify');
const { sendPush } = require('../push');

const router = express.Router();

const DOC_TYPES = ['national_id', 'tin', 'voters_card', 'passport', 'drivers_licence'];
const DOC_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_DOC_BYTES = 3.5 * 1024 * 1024;

// Returns { docs } with validated documents, or { error }.
function parseDocuments(input) {
  if (!Array.isArray(input) || input.length === 0) return { error: 'Upload at least one ID document (ID, TIN or voter card)' };
  if (input.length > 3) return { error: 'You can upload up to 3 documents' };
  const docs = [];
  for (const d of input) {
    const type = d && d.type;
    let mime = d && d.mime;
    let data = String((d && d.data) || '');
    const m = data.match(/^data:([^;]+);base64,/);
    if (m) { mime = mime || m[1]; data = data.slice(m[0].length); }
    if (!DOC_TYPES.includes(type)) return { error: 'Unknown document type' };
    if (!DOC_MIMES.includes(mime)) return { error: 'Documents must be a photo (JPG/PNG/WebP) or a PDF' };
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data)) return { error: 'Document could not be read' };
    const size = Math.floor((data.length * 3) / 4);
    if (size > MAX_DOC_BYTES) return { error: 'A document is too large (max 3.5 MB)' };
    if (size < 500) return { error: 'A document looks empty' };
    docs.push({ type, mime, data, size });
  }
  return { docs };
}

module.exports = (db) => {
  const sessionFor = (user) => {
    const payload = { id: user.id, name: user.name, phone: user.phone, role: user.role, created_at: user.created_at };
    if (user.role === 'driver') {
      const driver = db.prepare('SELECT * FROM drivers WHERE user_id=?').get(user.id);
      if (driver) payload.driverProfile = driver;
    }
    return { user: payload, ...generateTokens(user.id, user.role) };
  };

  router.post('/register', loginLimiter, async (req, res) => {
    try {
      const { name, phone, password, role } = req.body || {};
      const parsedDocs = role === 'driver' ? { docs: [] } : parseDocuments(req.body && req.body.documents);
      const email = normEmail(req.body && req.body.email);
      if (!name || !phone || !password) {
        return res.status(400).json({ error: 'name, phone and password are required' });
      }
      if (!validEmail(email)) return res.status(400).json({ error: 'A valid email address is required' });

      if (role === 'driver') {
        return res.status(403).json({ error: 'Driver accounts are not open for public registration' });
      }
      if (String(password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      if (parsedDocs.error) return res.status(400).json({ error: parsedDocs.error });
      const finalRole = 'rider';
      const existing = db.prepare('SELECT id FROM users WHERE phone=?').get(phone);
      if (existing) return res.status(409).json({ error: 'Phone number already registered' });
      if (db.prepare('SELECT id FROM users WHERE lower(email)=?').get(email)) {
        return res.status(409).json({ error: 'Email already registered to another phone number' });
      }

      const hashed = await bcrypt.hash(password, 10);
      const userId = uuidv4();
      db.prepare('INSERT INTO users (id, name, phone, password_hash, role, email, email_verified) VALUES (?,?,?,?,?,?,0)')
        .run(userId, name, phone, hashed, finalRole, email);
      const insDoc = db.prepare('INSERT INTO user_documents (id, user_id, doc_type, mime, size, data) VALUES (?,?,?,?,?,?)');
      for (const d of parsedDocs.docs) insDoc.run(uuidv4(), userId, d.type, d.mime, d.size, d.data);
      try {
        for (const a of db.prepare("SELECT id FROM users WHERE role='admin'").all()) {
          sendPush(db, a.id, {
            title: '🪪 New rider registered',
            body: `${name} (${phone}) uploaded ${parsedDocs.docs.length} ID document(s) for review.`,
            url: '/admin/#accounts',
          });
        }
      } catch {}

      const { emailed } = await issueCode(db, { id: userId, name }, email, 'verify');
      res.json({ needsVerification: true, phone, email, emailed });
    } catch (err) {
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  router.post('/verify-email', loginLimiter, async (req, res) => {
    try {
      const { phone, code } = req.body || {};
      const user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone || '');
      if (!user || !(await checkCode(db, user.id, 'verify', code, true))) {
        return res.status(400).json({ error: 'Invalid or expired code' });
      }
      db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(user.id);
      res.json(sessionFor(user));
    } catch (err) {
      res.status(500).json({ error: 'Verification failed' });
    }
  });

  router.post('/resend-code', loginLimiter, async (req, res) => {
    try {
      const user = db.prepare('SELECT * FROM users WHERE phone=?').get((req.body && req.body.phone) || '');
      if (user && user.email && !user.email_verified) await issueCode(db, user, user.email, 'verify');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Could not resend code' });
    }
  });

  // Step 1 of password reset: phone and email must belong to the same account.
  router.post('/forgot-password', loginLimiter, async (req, res) => {
    try {
      const phone = String((req.body && req.body.phone) || '').trim();
      const email = normEmail(req.body && req.body.email);
      const user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
      if (user && user.role !== 'admin' && user.email && normEmail(user.email) === email && !user.suspended) {
        await issueCode(db, user, user.email, 'reset');
        sendPush(db, user.id, {
          title: '🔑 Password reset requested',
          body: 'A reset code was sent to your email. If this was not you, ignore it.',
          tag: 'pw-reset',
        }).catch(() => 0);
      }
      res.json({ ok: true, message: 'If that phone number and email match an account, a 6-digit code has been sent.' });
    } catch (err) {
      res.status(500).json({ error: 'Could not start password reset' });
    }
  });

  router.post('/reset-password', loginLimiter, async (req, res) => {
    try {
      const phone = String((req.body && req.body.phone) || '').trim();
      const email = normEmail(req.body && req.body.email);
      const { code, password } = req.body || {};
      if (String(password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      const user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
      if (!user || user.role === 'admin' || !user.email || normEmail(user.email) !== email
        || !(await checkCode(db, user.id, 'reset', code, true))) {
        return res.status(400).json({ error: 'Invalid or expired code' });
      }
      db.prepare('UPDATE users SET password_hash=?, email_verified=1 WHERE id=?').run(await bcrypt.hash(password, 10), user.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Password reset failed' });
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
      if (user.suspended) return res.status(403).json({ error: 'This account has been suspended. Contact Pointbreak support.' });
      if (user.email && !user.email_verified) {
        await issueCode(db, user, user.email, 'verify');
        return res.status(403).json({ error: 'Please verify your email first. We sent you a new code.', code: 'EMAIL_NOT_VERIFIED', phone: user.phone });
      }
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
      if (user.suspended) return res.status(403).json({ error: 'This account has been suspended. Contact Pointbreak support.' });

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
