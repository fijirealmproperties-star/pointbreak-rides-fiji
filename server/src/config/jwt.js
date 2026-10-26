const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_REFRESH_SECRET } = require('./env');

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '30d';

const generateTokens = (userId, role) => {
  const accessToken = jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
  const refreshToken = jwt.sign({ userId, role }, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
  return { accessToken, refreshToken };
};

const verifyAccessToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, JWT_REFRESH_SECRET);
};

module.exports = { generateTokens, verifyAccessToken, verifyRefreshToken, JWT_SECRET, JWT_REFRESH_SECRET };
