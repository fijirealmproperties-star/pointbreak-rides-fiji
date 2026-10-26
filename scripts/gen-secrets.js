// Generate strong secrets for a production deployment.
// Usage: node scripts/gen-secrets.js
const crypto = require('crypto');

const secret = () => crypto.randomBytes(48).toString('base64url');

console.log('# Paste these into .env (never commit .env)');
console.log(`JWT_SECRET=${secret()}`);
console.log(`JWT_REFRESH_SECRET=${secret()}`);
console.log(`ADMIN_PASSWORD=${secret().slice(0, 20)}`);
