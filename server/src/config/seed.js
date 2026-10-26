const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { PLACES } = require('./places');
const { SEED_DEMO, IS_PROD } = require('./env');

const uid = (p) => `${p}-${uuidv4().slice(0, 8)}`;

function ensurePlaces(db) {
  PLACES.forEach((p) => {
    db.prepare('INSERT OR IGNORE INTO places (id, name, short_name, type, lat, lng, region) VALUES (?,?,?,?,?,?,?)')
      .run(p.id, p.name, p.short_name, p.type, p.lat, p.lng, p.region);
  });
}

async function seedDemo(db) {
  const hashedDriver = await bcrypt.hash('driver123', 10);
  const hashedRider = await bcrypt.hash('rider123', 10);
  const hashedAdmin = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10);

  const adminId = uid('usr');
  db.prepare('INSERT INTO users (id, name, phone, password_hash, role) VALUES (?,?,?,?,?)')
    .run(adminId, 'Admin', process.env.ADMIN_PHONE || '+6790000000', hashedAdmin, 'admin');

  const riderId = uid('usr');
  db.prepare('INSERT INTO users (id, name, phone, password_hash, role) VALUES (?,?,?,?,?)')
    .run(riderId, 'Jone Vaka', '+6797770001', hashedRider, 'rider');

  const DRIVERS = [
    { name: 'Ratu Driving', phone: '+6799001001', vehicle_type: 'Taxi', vehicle_model: 'Toyota RAV4', license_plate: 'FM 1234', status: 'online', lat: -18.1408, lng: 178.4417 },
    { name: 'Mere Taxi', phone: '+6799001002', vehicle_type: 'Taxi', vehicle_model: 'Toyota Prius', license_plate: 'NC 5678', status: 'offline', lat: -18.1450, lng: 178.4450 },
    { name: 'Ben Van', phone: '+6799001003', vehicle_type: 'Van', vehicle_model: 'Toyota HiAce', license_plate: 'NA 9012', status: 'offline', lat: -18.1390, lng: 178.4380 },
    { name: 'Tina Express', phone: '+6799001004', vehicle_type: 'Taxi', vehicle_model: 'Honda Fit', license_plate: 'ND 3456', status: 'offline', lat: -18.1500, lng: 178.4500 },
    { name: 'Kam Trading', phone: '+6799001005', vehicle_type: 'SUV', vehicle_model: 'Mitsubishi Pajero', license_plate: 'FB 7890', status: 'offline', lat: -17.7552, lng: 177.4433 },
    { name: 'Dev Cabins', phone: '+6799001006', vehicle_type: 'Taxi', vehicle_model: 'Suzuki Swift', license_plate: 'FA 2345', status: 'offline', lat: -17.7748, lng: 177.3690 },
  ];

  DRIVERS.forEach((d) => {
    const userId = uid('usr');
    const driverId = uid('drv');
    db.prepare('INSERT INTO users (id, name, phone, password_hash, role) VALUES (?,?,?,?,?)')
      .run(userId, d.name, d.phone, hashedDriver, 'driver');
    db.prepare('INSERT OR IGNORE INTO drivers (id, user_id, full_name, phone, vehicle_type, vehicle_model, license_plate, status, lat, lng, rating, trips) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(driverId, userId, d.name, d.phone, d.vehicle_type, d.vehicle_model, d.license_plate, d.status, d.lat, d.lng, 5.0, 0);
  });
}

async function seedAdmin(db) {
  const phone = process.env.ADMIN_PHONE;
  const password = process.env.ADMIN_PASSWORD;
  if (!phone || !password) return false;
  const hashed = await bcrypt.hash(password, 10);
  db.prepare('INSERT INTO users (id, name, phone, password_hash, role) VALUES (?,?,?,?,?)')
    .run(uid('usr'), process.env.ADMIN_NAME || 'Admin', phone, hashed, 'admin');
  return true;
}

async function seedData(db) {
  await db.ready;
  ensurePlaces(db);

  const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (existing && existing.c > 0) return { seeded: false };

  if (SEED_DEMO) {
    await seedDemo(db);
    return { seeded: true, demo: true };
  }

  const adminCreated = await seedAdmin(db);
  if (!adminCreated) {
    const message =
      'Empty database and SEED_DEMO is off: set ADMIN_PHONE and ADMIN_PASSWORD to create the first admin account.';
    if (IS_PROD) throw new Error(message);
    console.warn(message);
  }
  return { seeded: adminCreated, admin: adminCreated };
}

module.exports = { seedData, ensurePlaces };
