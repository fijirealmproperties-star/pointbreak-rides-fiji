const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getPublicKey, saveSubscription, removeSubscription, sendPush } = require('../push');

module.exports = (db) => {
  const router = express.Router();

  router.get('/key', (req, res) => {
    res.json({ key: getPublicKey() });
  });

  router.post('/subscribe', requireAuth, (req, res) => {
    const sub = req.body && req.body.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    saveSubscription(db, req.user.userId, sub);
    res.json({ ok: true });
  });

  router.post('/unsubscribe', requireAuth, (req, res) => {
    const endpoint = req.body && req.body.endpoint;
    if (endpoint) removeSubscription(db, endpoint);
    res.json({ ok: true });
  });

  router.post('/test', requireAuth, async (req, res) => {
    const sent = await sendPush(db, req.user.userId, {
      title: 'Pointbreak test alert',
      body: 'Notifications are working on this device.',
      tag: 'pb-test',
    });
    res.json({ ok: true, sent });
  });

  return router;
};
