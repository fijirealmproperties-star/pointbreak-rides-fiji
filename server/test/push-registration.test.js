const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { generateTokens } = require('../src/config/jwt');

test('rejects native registration when Firebase is not configured', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/push', require('../src/routes/push')({ prepare() { throw new Error('must not save token'); } }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => server.close());
  const token = generateTokens('user', 'driver').accessToken;
  for (const endpoint of ['fcm', 'test-native']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/push/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ token: 'valid-length-fcm-token-for-testing' }),
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /not configured/);
  }
});
