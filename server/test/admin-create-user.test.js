const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const { initSchema } = require('../src/config/schema');
const { generateTokens } = require('../src/config/jwt');

test('admin can create a rider who can log in with phone and password', async (t) => {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  const db = {
    exec: (sql) => raw.exec(sql),
    prepare(sql) {
      return {
        run: (...args) => raw.run(sql, args),
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
  app.use('/api/admin', require('../src/routes/admin')(db, {}));
  app.use('/api/auth', require('../src/routes/auth')(db));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => { server.close(); raw.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const admin = generateTokens('admin-id', 'admin').accessToken;
  const rider = generateTokens('rider-id', 'rider').accessToken;
  async function post(path, body, token) {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  const input = { name: '  Test Rider ', phone: ' +6791234567 ', password: 'a secure password', role: 'admin' };
  assert.equal((await post('/admin/users', input)).status, 401);
  assert.equal((await post('/admin/users', input, rider)).status, 403);
  assert.equal((await post('/admin/users', { ...input, password: 'short' }, admin)).status, 400);
  const created = await post('/admin/users', input, admin);
  assert.equal(created.status, 201);
  assert.equal(created.body.user.role, 'rider');
  assert.equal(created.body.user.phone, '+6791234567');
  assert.equal(created.body.user.password_hash, undefined);
  const saved = db.prepare('SELECT * FROM users WHERE id=?').get(created.body.user.id);
  assert.equal(await bcrypt.compare(input.password, saved.password_hash), true);
  assert.equal(saved.email, null);
  assert.equal((await post('/admin/users', input, admin)).status, 409);
  assert.equal((await post('/auth/login', { phone: saved.phone, password: 'wrong' })).status, 401);
  const login = await post('/auth/login', { phone: saved.phone, password: input.password });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, saved.id);
  assert.equal(login.body.user.role, 'rider');
});
