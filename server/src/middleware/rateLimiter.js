const rateLimit = require('express-rate-limit');

function getClientKey(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return `user:${auth.slice(7, 20)}`;
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: getClientKey,
  message: { error: 'Too many login attempts. Please try again in 1 minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: getClientKey,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, apiLimiter };