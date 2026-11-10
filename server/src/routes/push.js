const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { saveFcmToken, getPublicKey, isFcmReady, saveSubscription, removeSubscription, sendPush } = require('../push');

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

  router.post('/fcm', requireAuth, (req, res) => {
    const token = req.body && req.body.token;
    if (typeof token !== 'string' || token.length < 20 || token.length > 4096) {
      return res.status(400).json({ error: 'Invalid token' });
    }
    if (!isFcmReady()) {
      return res.status(503).json({ error: 'App notifications are not configured on the server.' });
    }
    saveFcmToken(db, req.user.userId, token);
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

  router.post('/test-native', requireAuth, async (req, res, next) => {
    try {
      const token = req.body && req.body.token;
      if (typeof token !== 'string' || token.length < 20 || token.length > 4096) {
        return res.status(400).json({ error: 'Invalid token' });
      }
      if (!isFcmReady()) return res.status(503).json({ error: 'App notifications are not configured on the server.' });
      await new Promise(resolve => setTimeout(resolve, 5000));
      const sent = await sendPush(db, req.user.userId, {
        title: 'Pointbreak app test',
        body: 'Tap this notification to open the Pointbreak app.',
        tag: 'pb-native-test',
      }, { fcmToken: token });
      if (!sent) return res.status(503).json({ error: 'Could not deliver the app test notification. Please try again or contact support.' });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
