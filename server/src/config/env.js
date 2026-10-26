// Central place for environment-derived settings and production safety checks.
// Fails fast at startup rather than shipping insecure defaults to a server.

const IS_PROD = process.env.NODE_ENV === 'production';

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const CORS_ORIGINS = parseList(process.env.CORS_ORIGINS);

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (IS_PROD ? '' : 'pointbreak-rides-fiji-secret-key-change-in-production');
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ||
  (IS_PROD ? '' : 'pointbreak-rides-fiji-refresh-secret-change-in-production');

// Demo accounts (riders/drivers with published passwords) are opt-out in dev
// and opt-in in production.
const SEED_DEMO =
  process.env.SEED_DEMO === 'true' ||
  (!IS_PROD && process.env.SEED_DEMO !== 'false');

// Pickup-code reveal endpoint (GET /api/rides/:id/pickup-code).
const DEMO_MODE = process.env.DEMO_MODE === 'true' || !IS_PROD;

function assertProductionEnv() {
  if (!IS_PROD) return;
  const problems = [];
  if (JWT_SECRET.length < 32) problems.push('JWT_SECRET must be at least 32 characters');
  if (JWT_REFRESH_SECRET.length < 32)
    problems.push('JWT_REFRESH_SECRET must be at least 32 characters');
  if (JWT_SECRET === JWT_REFRESH_SECRET)
    problems.push('JWT_SECRET and JWT_REFRESH_SECRET must be different');
  if (/change|secret-key|refresh-secret/.test(JWT_SECRET + JWT_REFRESH_SECRET))
    problems.push('JWT secrets still contain placeholder text');
  if (problems.length) {
    throw new Error(`Insecure production configuration:\n - ${problems.join('\n - ')}`);
  }
}

// Requests without an Origin header (native apps, curl, server-to-server) are
// always allowed. Browsers are only allowed from explicit origins.
function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (CORS_ORIGINS.length) return CORS_ORIGINS.includes(origin);
  return !IS_PROD;
}

function corsOrigin(origin, callback) {
  callback(null, isAllowedOrigin(origin));
}

assertProductionEnv();

module.exports = {
  IS_PROD,
  CORS_ORIGINS,
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  SEED_DEMO,
  DEMO_MODE,
  isAllowedOrigin,
  corsOrigin,
};
