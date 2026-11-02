const express = require('express');
const { requireAuth } = require('../middleware/auth');

// Notices sent by the admin, as seen by a rider or driver (the bell icon).
module.exports = (db) => {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const audience = req.user.role === 'driver' ? 'drivers' : 'riders';
    const rows = db.prepare(
      `SELECT n.id, n.title, n.body, n.created_at,
              CASE WHEN r.notice_id IS NULL THEN 0 ELSE 1 END AS read
       FROM notices n
       LEFT JOIN notice_reads r ON r.notice_id = n.id AND r.user_id = ?
       WHERE n.audience IN ('all', ?, ?)
       ORDER BY n.created_at DESC LIMIT 50`
    ).all(req.user.userId, audience, 'user:' + req.user.userId);
    const notices = rows.map((n) => ({ ...n, read: !!n.read }));
    res.json({ notices, unread: notices.filter((n) => !n.read).length });
  });

  router.post('/read', (req, res) => {
    const audience = req.user.role === 'driver' ? 'drivers' : 'riders';
    const ids = db.prepare("SELECT id FROM notices WHERE audience IN ('all', ?, ?)").all(audience, 'user:' + req.user.userId);
    for (const n of ids) {
      db.prepare('INSERT OR IGNORE INTO notice_reads (user_id, notice_id) VALUES (?, ?)').run(req.user.userId, n.id);
    }
    res.json({ ok: true });
  });

  return router;
};
