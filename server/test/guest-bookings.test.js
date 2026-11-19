const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const initSqlJs = require('sql.js');
const { initSchema } = require('../src/config/schema');
const { generateTokens } = require('../src/config/jwt');

test('guest transport requests are saved for admin review', async (t) => {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  const db = {
    exec: (sql) => raw.exec(sql),
    prepare(sql) {
      return {
        run: (...args) => {
          raw.run(sql, args);
          return { changes: raw.getRowsModified() };
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
  const app = express();
  app.use(express.json());
  app.use('/api/guest-bookings', require('../src/routes/guest-bookings')(db));
  app.use('/api/admin', require('../src/routes/admin')(db, {}));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => { server.close(); raw.close(); });

  const base = `http://127.0.0.1:${server.address().port}/api`;
  const admin = generateTokens('admin-id', 'admin').accessToken;
  const rider = generateTokens('rider-id', 'rider').accessToken;
  const future = new Date(Date.now() + 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
  const request = {
    name: '  Tourist Guest ',
    email: 'GUEST@example.com',
    phone: '+679 123 4567',
    pickup: 'Nadi Airport',
    dropoff: 'Denarau Marina',
    date: future.toISOString().slice(0, 10),
    time: future.toISOString().slice(11, 16),
    passengers: 2,
    notes: 'Flight details',
  };

  async function send(path, { method = 'GET', body, token } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }

  assert.equal((await send('/guest-bookings', { method: 'POST', body: { ...request, passengers: 0 } })).status, 400);
  const created = await send('/guest-bookings', { method: 'POST', body: request });
  assert.equal(created.status, 201);
  assert.equal(created.body.booking.status, 'pending');

  assert.equal((await send('/admin/guest-bookings')).status, 401);
  assert.equal((await send(`/admin/guest-bookings/${created.body.booking.id}`, {
    method: 'PATCH', body: { status: 'confirmed' }, token: rider,
  })).status, 403);
  const list = await send('/admin/guest-bookings', { token: admin });
  assert.equal(list.status, 200);
  assert.equal(list.body.bookings[0].name, 'Tourist Guest');
  assert.equal(list.body.bookings[0].email, 'guest@example.com');
  assert.equal(list.body.bookings[0].pickup, 'Nadi Airport');

  const reviewed = await send(`/admin/guest-bookings/${created.body.booking.id}`, {
    method: 'PATCH', body: { status: 'confirmed' }, token: admin,
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.status, 'confirmed');
  assert.equal((await send(`/admin/guest-bookings/${created.body.booking.id}`, {
    method: 'PATCH', body: { status: 'declined' }, token: admin,
  })).status, 409);
});
