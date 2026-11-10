const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('native test targets only the requested user token and never falls back to web push', async (t) => {
  const originalLoad = Module._load;
  const originalConfig = process.env.FIREBASE_SERVICE_ACCOUNT;
  let fail = false;
  let webCalls = 0;
  const sent = [];
  process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
  Module._load = function (name, ...args) {
    if (name === 'firebase-admin') return {
      credential: { cert: () => ({}) },
      initializeApp() {},
      messaging: () => ({ send: async (message) => {
        sent.push(message.token);
        if (fail) throw new Error('delivery failed');
      } }),
    };
    if (name === 'web-push') return {
      generateVAPIDKeys: () => ({ publicKey: 'public', privateKey: 'private' }),
      setVapidDetails() {},
      sendNotification: async () => { webCalls++; },
    };
    return originalLoad.call(this, name, ...args);
  };
  const push = require('../src/push');
  t.after(() => {
    Module._load = originalLoad;
    if (originalConfig === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
    else process.env.FIREBASE_SERVICE_ACCOUNT = originalConfig;
  });
  const db = {
    exec() {},
    prepare(sql) {
      return {
        get: () => undefined,
        run() {},
        all: (...args) => {
          if (sql.includes('push_subscriptions')) return [{ endpoint: 'web', sub_json: '{}' }];
          if (sql.includes('fcm_tokens')) {
            return args[0] === 'owner' && (!args[1] || args[1] === 'native-token')
              ? [{ token: 'native-token' }] : [];
          }
          throw new Error('Unexpected query');
        },
      };
    },
  };
  push.initPush(db);
  Module._load = originalLoad;
  assert.equal(await push.sendPush(db, 'owner', {}, { fcmToken: 'native-token' }), 1);
  assert.deepEqual(sent, ['native-token']);
  assert.equal(await push.sendPush(db, 'other-user', {}, { fcmToken: 'native-token' }), 0);
  fail = true;
  assert.equal(await push.sendPush(db, 'owner', {}, { fcmToken: 'native-token' }), 0);
  assert.equal(webCalls, 0);
});
