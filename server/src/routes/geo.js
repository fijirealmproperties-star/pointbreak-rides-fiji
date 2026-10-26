const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { reverseGeocode } = require('../rides/geocode');

const router = express.Router();

// Turn a map pin into a street label for the pickup / drop-off fields.
router.post('/reverse', requireAuth, async (req, res) => {
  try {
    const lat = Number(req.body && req.body.lat);
    const lng = Number(req.body && req.body.lng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return res.status(400).json({ error: 'lat and lng must be valid coordinates' });
    }
    res.json(await reverseGeocode(lat, lng));
  } catch (err) {
    res.status(500).json({ error: 'Could not look up that location' });
  }
});

module.exports = router;
