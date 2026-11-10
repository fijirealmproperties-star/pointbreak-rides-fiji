const webpush = require('web-push');

let fcm = null;
function initFcm() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return;
  try {
    const admin = require('firebase-admin');
    const cred = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    fcm = admin.messaging();
    console.log('FCM push ready');
  } catch (e) {
    console.error('FCM init failed:', e && e.message);
  }
}

let ready = false;
let publicKey = null;

// VAPID keys come from env, or are generated once and kept in the database
// (which lives on the Railway volume) so subscriptions survive restarts.
function initPush(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  sub_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fcm_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notice_reads (
  user_id TEXT NOT NULL,
  notice_id TEXT NOT NULL,
  PRIMARY KEY (user_id, notice_id)
);
`);
  let pub = process.env.VAPID_PUBLIC_KEY;
  let priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    const get = (k) => {
      const r = db.prepare('SELECT value FROM kv WHERE key=?').get(k);
      return r && r.value;
    };
    pub = get('vapid_public');
    priv = get('vapid_private');
    if (!pub || !priv) {
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run('vapid_public', pub);
      db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run('vapid_private', priv);
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@pointbreakfiji.com', pub, priv);
  publicKey = pub;
  ready = true;
  initFcm();
}

const getPublicKey = () => publicKey;
const isFcmReady = () => !!fcm;

function saveSubscription(db, userId, sub) {
  db.prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint, user_id, sub_json) VALUES (?, ?, ?)')
    .run(sub.endpoint, userId, JSON.stringify(sub));
}

function removeSubscription(db, endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint);
}

function saveFcmToken(db, userId, token) {
  db.prepare('INSERT OR REPLACE INTO fcm_tokens (token, user_id) VALUES (?, ?)').run(token, userId);
}

function hasSubscription(db, userId) {
  return !!db.prepare('SELECT 1 AS x FROM push_subscriptions WHERE user_id=? LIMIT 1').get(userId)
    || !!db.prepare('SELECT 1 AS x FROM fcm_tokens WHERE user_id=? LIMIT 1').get(userId);
}

async function sendPush(db, userId, payload, options = {}) {
  if (!ready || !userId) return 0;
  const rows = db.prepare('SELECT endpoint, sub_json FROM push_subscriptions WHERE user_id=?').all(userId);
  let sent = 0;
  if (fcm) {
    const tokens = options.fcmToken
      ? db.prepare('SELECT token FROM fcm_tokens WHERE user_id=? AND token=?').all(userId, options.fcmToken)
      : db.prepare('SELECT token FROM fcm_tokens WHERE user_id=?').all(userId);
    await Promise.all(tokens.map(async (t) => {
      try {
        await fcm.send({
          token: t.token,
          notification: { title: String(payload.title || 'Pointbreak'), body: String(payload.body || '') },
          data: { tag: String(payload.tag || '') },
          android: { priority: 'high', ttl: 60000, notification: { tag: payload.tag || undefined, channelId: 'default' } },
        });
        sent += 1;
      } catch (e) {
        const code = e && e.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          db.prepare('DELETE FROM fcm_tokens WHERE token=?').run(t.token);
        } else console.error('FCM failed:', e && e.message);
      }
    }));
  }
  // The installed Android app already got it; a browser notification would open the website instead of the app.
  if (sent > 0 || options.fcmToken) return sent;
  await Promise.all(rows.map(async (row) => {
    try {
      await webpush.sendNotification(JSON.parse(row.sub_json), JSON.stringify(payload), {
        TTL: 60,
        urgency: 'high',
      });
      sent += 1;
    } catch (e) {
      if (e && [401, 403, 404, 410].includes(e.statusCode)) removeSubscription(db, row.endpoint);
      else console.error('Push failed:', e && e.message);
    }
  }));
  return sent;
}

module.exports = { saveFcmToken, initPush, getPublicKey, isFcmReady, saveSubscription, removeSubscription, hasSubscription, sendPush };
