const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const initSqlJs = require('sql.js');
const { initSchema } = require('../src/config/schema');
const { generateTokens } = require('../src/config/jwt');

test('a driver can email a Surfs Up Meter receipt once for a finished trip', async (t) => {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  const db = {
    exec: (sql) => raw.exec(sql),
    prepare(sql) {
      return {
        run: (...args) => {
          raw.run(sql, args);
          return { changes: raw.getRowsModified(), lastInsertRowid: raw.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] };
        },
        all: (...args) => {
          const stmt = raw.prepare(sql);
          try {
            stmt.bind(args);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
          } finally { stmt.free(); }
        },
        get: (...args) => {
          const stmt = raw.prepare(sql);
          try {
            stmt.bind(args);
            return stmt.step() ? stmt.getAsObject() : undefined;
          } finally { stmt.free(); }
        },
      };
    },
  };
  initSchema(db);
  db.prepare('INSERT INTO users (id,name,phone,role) VALUES (?,?,?,?)').run('driver-user', 'Test Driver', '+6791234567', 'driver');
  db.prepare('INSERT INTO drivers (id,user_id,full_name,phone,vehicle_type,vehicle_model,license_plate) VALUES (?,?,?,?,?,?,?)')
    .run('driver-id', 'driver-user', 'Test Driver', '+6791234567', 'Taxi', 'Test Car', 'FJ 123');
  db.prepare(`
    INSERT INTO roadside_trips (id,driver_id,tariff_type,total_fare,trip_duration_seconds,trip_distance_km,status,ended_at)
    VALUES (1,'driver-id','SURFS_UP_day',12.5,900,8.25,'finished','2026-11-17 01:00:00')
  `).run();
  const app = express();
  app.use(express.json());
  app.use('/api/drivers', require('../src/routes/drivers')(db, {}));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const oldKey = process.env.RESEND_API_KEY;
  const oldFetch = global.fetch;
  const requestFetch = global.fetch;
  t.after(() => {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldKey;
    global.fetch = oldFetch;
    server.close();
    raw.close();
  });

  const url = `http://127.0.0.1:${server.address().port}/api/drivers/roadside-trips/1/receipt`;
  const apiBase = `http://127.0.0.1:${server.address().port}/api/drivers`;
  const token = generateTokens('driver-user', 'driver').accessToken;
  async function send(email) {
    const response = await requestFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email }),
    });
    return { status: response.status, body: await response.json() };
  }

  delete process.env.RESEND_API_KEY;
  assert.equal((await send('guest@example.com')).status, 503);
  process.env.RESEND_API_KEY = 'test-key';
  assert.equal((await send('not-an-email')).status, 400);

  let emailPayload;
  global.fetch = async (_url, options) => {
    emailPayload = JSON.parse(options.body);
    return { ok: true, status: 200 };
  };
  const sent = await send('Guest@Example.com');
  assert.equal(sent.status, 200);
  assert.equal(sent.body.email, 'guest@example.com');
  assert.deepEqual(emailPayload.to, ['guest@example.com']);
  assert.match(emailPayload.text, /Total fare: FJ\$ 12\.50/);
  assert.match(emailPayload.text, /Distance: 8\.25 km/);

  const saved = db.prepare('SELECT receipt_status, receipt_email, receipt_sent_at FROM roadside_trips WHERE id=?').get(1);
  assert.equal(saved.receipt_status, 'sent');
  assert.equal(saved.receipt_email, 'guest@example.com');
  assert.ok(saved.receipt_sent_at);
  assert.equal((await send('guest@example.com')).status, 409);

  const finishResponse = await requestFetch(`${apiBase}/roadside`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      tariff_type: 'SURFS_UP_night',
      total_fare: 8,
      trip_duration_seconds: 600,
      trip_distance_km: 4,
    }),
  });
  assert.equal(finishResponse.status, 200);
  assert.equal((await finishResponse.json()).trip_id, 2);
});
