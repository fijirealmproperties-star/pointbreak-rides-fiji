const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');

const { IS_PROD, corsOrigin, SEED_DEMO } = require('./src/config/env');
const SQLiteWrapper = require('./src/config/database');
const { initSchema } = require('./src/config/schema');
const { seedData } = require('./src/config/seed');
const { apiLimiter } = require('./src/middleware/rateLimiter');
const MatchingEngine = require('./src/rides/matching');
const { setupSocket } = require('./src/realtime');
const { usesDemoGeocoder } = require('./src/rides/geocode');
const { usesDemoRouting } = require('./src/rides/routing');

const PORT = process.env.PORT || 3003;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'pointbreak-rides-fiji.db');

const ADMIN_DIR = path.join(__dirname, '..', 'web');
const MOBILE_WEB_DIR =
  process.env.MOBILE_WEB_DIR || path.join(__dirname, '..', 'mobile', 'dist');

const db = new SQLiteWrapper(DB_PATH);
(async () => {
  await db.ready;
  initSchema(db);
  try {
    const result = await seedData(db);
    if (result.seeded && result.demo) console.log('Seeded demo data (fresh database).');
    else if (result.seeded && result.admin) console.log('Created the first admin account.');
  } catch (e) {
    console.error('Seed failed:', e.message);
    if (IS_PROD) process.exit(1);
  }

  const app = express();
  // Behind Caddy: needed so rate limiting sees the real client IP.
  app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1);
  app.disable('x-powered-by');

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: corsOrigin, maxAge: 86400 }));
  app.use(express.json({ limit: '10mb' }));
  app.use(apiLimiter);

  app.use('/api/auth', require('./src/routes/auth')(db));
  app.use('/api/geo', require('./src/routes/geo'));

  app.get('/api/health', (req, res) =>
    res.json({ ok: true, service: 'pointbreak-rides-fiji', time: new Date().toISOString() })
  );
  app.get('/api/places', (req, res) => {
    const places = db.prepare('SELECT * FROM places ORDER BY region, name').all();
    res.json({ places });
  });

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: corsOrigin } });

  const matchingEngine = new MatchingEngine(io, db);
  setupSocket(io, matchingEngine, db);
  // Any ride left in 'requested' from a previous run is unmatchable — clear it
  // and re-sync driver availability, then keep sweeping so it can't recur.
  matchingEngine.recoverFromRestart();
  matchingEngine.startSweeper(15000);

  app.use('/api/rides', require('./src/routes/rides')(db, io, matchingEngine));
  app.use('/api/drivers', require('./src/routes/drivers')(db, matchingEngine));
  app.use('/api/admin', require('./src/routes/admin')(db));

  // Admin dashboard (static, talks to the API on the same origin).
  app.use('/admin', express.static(ADMIN_DIR));

  // Rider/driver web build: / serves the app; native apps use the API directly.
  if (fs.existsSync(path.join(MOBILE_WEB_DIR, 'index.html'))) {
    app.use(express.static(MOBILE_WEB_DIR));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/admin')) return next();
      // Never answer a missing download with the app shell: the install page
      // HEADs /downloads/pointbreak.apk to decide whether to show the button.
      if (req.path.startsWith('/downloads/')) return next();
      res.sendFile(path.join(MOBILE_WEB_DIR, 'index.html'));
    });
  } else {
    app.use(express.static(ADMIN_DIR));
  }

  server.listen(PORT, () => {
    console.log(`Pointbreak Rides Fiji API running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}${SEED_DEMO ? ' (demo data)' : ''}`);
    console.log(
      `Web app: ${fs.existsSync(path.join(MOBILE_WEB_DIR, 'index.html')) ? MOBILE_WEB_DIR : 'not built (admin dashboard only)'}`
    );
    if (!IS_PROD) {
      console.log(`Rider: +679 7770001 / rider123`);
      console.log(`Driver (online): +679 9001001 / driver123`);
      console.log(`Drivers (offline): +679 9001002 - 9001006 / driver123`);
    } else {
      if (usesDemoGeocoder)
        console.warn('WARNING: public Nominatim demo geocoder in use — start the "maps" profile and set NOMINATIM_URL (see DEPLOY-FREE.md).');
      if (usesDemoRouting)
        console.warn('WARNING: public OSRM demo server in use — start the "maps" profile and set OSRM_URL (see DEPLOY-FREE.md).');
      if (!process.env.CORS_ORIGINS)
        console.warn('WARNING: CORS_ORIGINS is not set — browser origins are blocked (native apps are unaffected).');
    }
  });
})();
