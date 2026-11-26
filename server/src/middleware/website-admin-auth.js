const { verifyWebsiteAccessToken } = require('../config/website-jwt');

function requireWebsiteAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Website admin sign-in required' });
  }
  try {
    const decoded = verifyWebsiteAccessToken(authHeader.slice(7));
    if (decoded.role !== 'website_admin' || !decoded.userId) {
      return res.status(403).json({ error: 'Website admin access required' });
    }
    req.websiteAdmin = { id: decoded.userId };
    next();
  } catch {
    return res.status(401).json({ error: 'Website admin session is invalid or expired' });
  }
}

module.exports = { requireWebsiteAdmin };
