const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const initSqlJs = require('sql.js');
const { initSchema } = require('../src/config/schema');
const { generateTokens } = require('../src/config/jwt');

test('retrying a finished meter trip does not create another history entry', async (t) => {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  const db = {
    exec: (sql) => raw.exec(sql),
    prepare(sql) {
      function rows(args) {
        const stmt = raw.prepare(sql);
        try {
          stmt.bind(args);
          const result = [];
          while (stmt.step()) result.push(stmt.getAsObject());
          return result;
        } finally { stmt.free(); }
      }
      return {
        run: (...args) => {
          raw.run(sql, args);
          return { changes: raw.getRowsModified(), lastInsertRowid: raw.exec('SELECT last_insert_rowid()')[0].values[0][0] };
        },
        get: (...args) => rows(args)[0],
        all: (...args) => rows(args),
      };
    },
  };
  initSchema(db);
  db.prepare("INSERT INTO drivers (id, user_id, full_name, phone, vehicle_type, vehicle_model, license_plate) VALUES (?,?,?,?,?,?,?)")
    .run('driver', 'user', 'Driver', '123', 'Taxi', 'Car', 'PLATE');
  db.prepare("INSERT INTO roadside_trips (id, driver_id, tariff_type, total_fare, status) VALUES (?,?,?,?,?)")
    .run(42, 'driver', 'VITI_LEVU_day', 0, 'running');
  const app = express();
  app.use(express.json());
  app.use('/drivers', require('../src/routes/drivers')(db, {
    unregisterDriverById() {},
    broadcastDrivers() {},
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => { server.close(); raw.close(); });
  const url = `http://127.0.0.1:${server.address().port}/drivers/roadside`;
  const token = generateTokens('user', 'driver').accessToken;
  const body = JSON.stringify({ trip_id: 42, tariff_type: 'VITI_LEVU_day', total_fare: 12.5, trip_distance_km: 3, trip_duration_seconds: 300 });
  for (let i = 0; i < 2; i++) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body });
    assert.equal(response.status, 200);
  }
  const trips = db.prepare('SELECT * FROM roadside_trips WHERE driver_id=?').all('driver');
  assert.equal(trips.length, 1);
  assert.equal(trips[0].status, 'finished');
  assert.equal(trips[0].total_fare, 12.5);
  const started = await fetch(`http://127.0.0.1:${server.address().port}/drivers/roadside/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tariff_type: 'SURFS_UP_day' }),
  });
  assert.equal(started.status, 200);
  const { trip_id } = await started.json();
  assert.equal(typeof trip_id, 'number');
  assert.equal(db.prepare('SELECT status FROM roadside_trips WHERE id=?').get(trip_id).status, 'running');
});
