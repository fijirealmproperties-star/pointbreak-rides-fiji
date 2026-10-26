function hasColumn(db, table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

function ensureColumn(db, table, column, def) {
  try {
    if (hasColumn(db, table, column)) return;
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`).run();
  } catch (e) {
    // best-effort migration; a concurrent/duplicate add is harmless
  }
}

function initSchema(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'rider',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle_type TEXT NOT NULL,
  vehicle_model TEXT NOT NULL,
  license_plate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline',
  lat REAL,
  lng REAL,
  rating REAL NOT NULL DEFAULT 5.0,
  trips INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  type TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  region TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rides (
  id TEXT PRIMARY KEY,
  rider_id TEXT NOT NULL,
  driver_id TEXT,
  pickup_place TEXT NOT NULL,
  dropoff_place TEXT NOT NULL,
  pickup_lat REAL NOT NULL,
  pickup_lng REAL NOT NULL,
  dropoff_lat REAL NOT NULL,
  dropoff_lng REAL NOT NULL,
  fare REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'FJD',
  status TEXT NOT NULL DEFAULT 'requested',
  distance_km REAL NOT NULL,
  duration_min REAL NOT NULL,
  path_json TEXT,
  driver_lat REAL,
  driver_lng REAL,
  requested_at TEXT DEFAULT (datetime('now')),
  accepted_at TEXT,
  arrived_at TEXT,
  pickup_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  rating INTEGER
);
`);

  // --- Taxi meter + rider verification (added after the initial schema) ---
  ensureColumn(db, 'rides', 'pickup_code', 'TEXT');
  ensureColumn(db, 'rides', 'quoted_fare', 'REAL');
  ensureColumn(db, 'rides', 'meter_distance_km', 'REAL DEFAULT 0');
  ensureColumn(db, 'rides', 'meter_fare', 'REAL DEFAULT 0');
  ensureColumn(db, 'rides', 'meter_started_at', 'TEXT');
  ensureColumn(db, 'rides', 'final_fare', 'REAL');
  ensureColumn(db, 'rides', 'final_distance_km', 'REAL');
  ensureColumn(db, 'rides', 'final_duration_min', 'REAL');
}

module.exports = { initSchema };