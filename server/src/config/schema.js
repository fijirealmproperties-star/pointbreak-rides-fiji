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

CREATE TABLE IF NOT EXISTS roadside_trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id TEXT NOT NULL,
  tariff_type TEXT NOT NULL,
  total_fare REAL NOT NULL,
  trip_duration_seconds INTEGER NOT NULL DEFAULT 0,
  trip_distance_km REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
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

CREATE TABLE IF NOT EXISTS guest_bookings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  pickup TEXT NOT NULL,
  dropoff TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  passengers INTEGER NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS website_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS website_admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS website_media (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS website_posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  image_id TEXT,
  image_alt TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (image_id) REFERENCES website_media(id)
);
`);

  // --- Taxi meter + rider verification (added after the initial schema) ---
  ensureColumn(db, 'rides', 'pickup_code', 'TEXT');
  ensureColumn(db, 'drivers', 'vehicle_icon', "TEXT DEFAULT '🚗'");
  ensureColumn(db, 'rides', 'passengers', 'INTEGER DEFAULT 1');
  ensureColumn(db, 'rides', 'quoted_fare', 'REAL');
  ensureColumn(db, 'rides', 'meter_distance_km', 'REAL DEFAULT 0');
  ensureColumn(db, 'rides', 'meter_fare', 'REAL DEFAULT 0');
  ensureColumn(db, 'rides', 'meter_started_at', 'TEXT');
  ensureColumn(db, 'rides', 'meter_wait_min', 'REAL DEFAULT 0');
  ensureColumn(db, 'rides', 'meter_last_at', 'TEXT');
  ensureColumn(db, 'rides', 'final_fare', 'REAL');
  ensureColumn(db, 'rides', 'final_distance_km', 'REAL');
  ensureColumn(db, 'rides', 'final_duration_min', 'REAL');
  ensureColumn(db, 'rides', 'scheduled_at', 'TEXT');
  ensureColumn(db, 'rides', 'cancel_fee', 'REAL DEFAULT 0');
  ensureColumn(db, 'rides', 'cancelled_by', 'TEXT');
  ensureColumn(db, 'users', 'suspended', 'INTEGER DEFAULT 0');
  ensureColumn(db, 'users', 'email', 'TEXT');
  ensureColumn(db, 'users', 'email_verified', 'INTEGER DEFAULT 0');
  ensureColumn(db, 'users', 'suspended_reason', 'TEXT');
  ensureColumn(db, 'users', 'suspended_at', 'TEXT');
  ensureColumn(db, 'roadside_trips', 'status', "TEXT DEFAULT 'finished'");
  ensureColumn(db, 'roadside_trips', 'ended_at', 'TEXT');
  ensureColumn(db, 'roadside_trips', 'receipt_email', 'TEXT');
  ensureColumn(db, 'roadside_trips', 'receipt_status', "TEXT NOT NULL DEFAULT 'not_sent'");
  ensureColumn(db, 'roadside_trips', 'receipt_sent_at', 'TEXT');
  db.exec(`
CREATE TABLE IF NOT EXISTS user_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_documents_user ON user_documents(user_id);
`);
}

module.exports = { initSchema };