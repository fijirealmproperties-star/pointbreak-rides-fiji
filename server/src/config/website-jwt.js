const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_REFRESH_SECRET } = require('./env');

const ACCESS_SECRET = process.env.WEBSITE_ADMIN_JWT_SECRET ||
  crypto.createHmac('sha256', JWT_SECRET).update('pointbreak-website-admin-access').digest('hex');
const REFRESH_SECRET = process.env.WEBSITE_ADMIN_REFRESH_SECRET ||
  crypto.createHmac('sha256', JWT_REFRESH_SECRET).update('pointbreak-website-admin-refresh').digest('hex');

function generateWebsiteTokens(userId) {
  const claims = { userId, role: 'website_admin' };
  return {
    accessToken: jwt.sign(claims, ACCESS_SECRET, { expiresIn: '15m' }),
    refreshToken: jwt.sign(claims, REFRESH_SECRET, { expiresIn: '30d' }),
  };
}

function verifyWebsiteAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

function verifyWebsiteRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

module.exports = { generateWebsiteTokens, verifyWebsiteAccessToken, verifyWebsiteRefreshToken };
