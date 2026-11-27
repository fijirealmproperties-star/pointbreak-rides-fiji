const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const initSqlJs = require('sql.js');
const { initSchema } = require('../src/config/schema');
const { generateTokens } = require('../src/config/jwt');
const MatchingEngine = require('../src/rides/matching');

test('rider can correct an active trip destination without resetting the meter', async (t) => {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  const db = {
    exec: (sql) => raw.exec(sql),
    prepare(sql) {
      return {
        run(...args) {
          raw.run(sql, args);
          return { changes: raw.getRowsModified() };
        },
        all(...args) {
          const stmt = raw.prepare(sql);
          try {
            stmt.bind(args);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
          } finally { stmt.free(); }
        },
        get(...args) {
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
  db.prepare('INSERT INTO users (id,name,phone,role) VALUES (?,?,?,?)')
    .run('rider-user', 'Rider', '+6791111111', 'rider');
  db.prepare('INSERT INTO users (id,name,phone,role) VALUES (?,?,?,?)')
    .run('driver-user', 'Driver', '+6792222222', 'driver');
  db.prepare(`
    INSERT INTO drivers (id,user_id,full_name,phone,vehicle_type,vehicle_model,license_plate)
    VALUES (?,?,?,?,?,?,?)
  `).run('driver-id', 'driver-user', 'Driver', '+6792222222', 'Taxi', 'Car', 'FJ 123');
  db.prepare(`
    INSERT INTO rides (
      id,rider_id,driver_id,pickup_place,dropoff_place,pickup_lat,pickup_lng,
      dropoff_lat,dropoff_lng,fare,status,distance_km,duration_min,path_json,
      driver_lat,driver_lng,pickup_code,meter_distance_km,meter_fare,
      meter_started_at,meter_wait_min,meter_last_at
    ) VALUES (
      'ride-id','rider-user','driver-id','Pickup','Old drop-off',-18.14,178.44,
      -18.13,178.45,12,'in_progress',8,20,'[]',
      -18.135,178.445,'1234',3.2,7.38,datetime('now','-5 minutes'),2.5,datetime('now')
    )
  `).run();

  const oldFetch = global.fetch;
  const requestFetch = global.fetch;
  global.fetch = async (url) => {
    const coordinates = new URL(url).pathname.split('/').pop().split(';').map((point) => point.split(',').map(Number));
    const [[lng1, lat1], [lng2, lat2]] = coordinates;
    return {
      ok: true,
      async json() {
        return {
          code: 'Ok',
          routes: [{
            distance: 5000,
            duration: 900,
            geometry: { coordinates: [[lng1, lat1], [lng2, lat2]] },
          }],
        };
      },
    };
  };
  t.after(() => {
    global.fetch = oldFetch;
    raw.close();
  });

  const emitted = [];
  const matchingEngine = new MatchingEngine({}, db);
  matchingEngine._emitToUser = (...args) => emitted.push(['user', ...args]);
  matchingEngine._emitToDriver = (...args) => emitted.push(['driver', ...args]);
  const app = express();
  app.use(express.json());
  app.use('/api/rides', require('../src/routes/rides')(db, {}, matchingEngine));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => server.close());

  const token = generateTokens('rider-user', 'rider').accessToken;
  const response = await requestFetch(`http://127.0.0.1:${server.address().port}/api/rides/ride-id/destination`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name: 'Corrected drop-off', lat: -18.12, lng: 178.46 }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ride.dropoff_place, 'Corrected drop-off');
  assert.equal(result.ride.meter_distance_km, 3.2);
  assert.equal(result.ride.meter_fare, 7.38);
  assert.equal(result.ride.meter_wait_min, 2.5);
  assert.equal(result.ride.distance_km, 8.2);
  assert.deepEqual(JSON.parse(result.ride.path_json).at(-1), { lat: -18.12, lng: 178.46 });
  assert.equal(emitted.length, 2);
  assert.equal(emitted.find(([kind]) => kind === 'driver')[3].ride.pickup_code, undefined);

  const otherRiderToken = generateTokens('other-rider', 'rider').accessToken;
  const unauthorized = await requestFetch(`http://127.0.0.1:${server.address().port}/api/rides/ride-id/destination`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${otherRiderToken}`,
    },
    body: JSON.stringify({ name: 'Another drop-off', lat: -18.11, lng: 178.47 }),
  });
  assert.equal(unauthorized.status, 403);

  const invalid = await requestFetch(`http://127.0.0.1:${server.address().port}/api/rides/ride-id/destination`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name: 'Invalid drop-off', lat: 91, lng: 178.47 }),
  });
  assert.equal(invalid.status, 400);

  const final = matchingEngine._finalizeFare({
    ...result.ride,
    meter_distance_km: 0.05,
    meter_wait_min: 0.2,
    distance_km: 8.2,
  });
  assert.equal(final.distanceKm, 0.05);
});
