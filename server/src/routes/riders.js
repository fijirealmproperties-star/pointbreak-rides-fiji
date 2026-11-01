const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { touchRider } = require('../presence');

const router = express.Router();
router.use(requireAuth, requireRole('rider'));

// Heartbeat with optional position; powers the admin live map.
router.post('/ping', (req, res) => {
  const lat = Number(req.body && req.body.lat);
  const lng = Number(req.body && req.body.lng);
  touchRider(req.user.userId, lat, lng);
  res.json({ ok: true });
});

module.exports = router;
