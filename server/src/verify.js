const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const TTL_MIN = 15;
const MAX_ATTEMPTS = 5;

function initVerify(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS email_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  code_plain TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);`);
}

function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;
}

function mailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

// Sends through Resend (https://resend.com). Returns true when handed to the provider.
async function sendMail(to, subject, text) {
  if (!mailConfigured()) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'Pointbreak Rides <onboarding@resend.dev>',
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) console.error('[mail] provider error', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (e) {
    console.error('[mail] failed', e.message);
    return false;
  }
}

// Creates a 6-digit code, replacing any older one for the same user and purpose.
// When no mail provider is set up the code is kept readable so the admin can pass it on.
async function issueCode(db, user, email, purpose) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.prepare('DELETE FROM email_codes WHERE user_id=? AND purpose=?').run(user.id, purpose);
  db.prepare('INSERT INTO email_codes (id, user_id, email, purpose, code_hash, code_plain, expires_at) VALUES (?,?,?,?,?,?,?)')
    .run(crypto.randomUUID(), user.id, email, purpose, await bcrypt.hash(code, 8),
      mailConfigured() ? null : code, Date.now() + TTL_MIN * 60 * 1000);
  const subject = purpose === 'reset' ? 'Reset your Pointbreak password' : 'Verify your Pointbreak email';
  const text = purpose === 'reset'
    ? `Hi ${user.name},\n\nYour Pointbreak password reset code is ${code}.\nIt expires in ${TTL_MIN} minutes. If you did not ask for this, ignore this email.`
    : `Hi ${user.name},\n\nYour Pointbreak verification code is ${code}.\nIt expires in ${TTL_MIN} minutes.`;
  const emailed = await sendMail(email, subject, text);
  return { emailed };
}

// Returns true when the code is right; wrong guesses are counted and lock the code.
async function checkCode(db, userId, purpose, code, consume) {
  const row = db.prepare('SELECT * FROM email_codes WHERE user_id=? AND purpose=?').get(userId, purpose);
  if (!row || row.expires_at < Date.now() || row.attempts >= MAX_ATTEMPTS) return false;
  const ok = await bcrypt.compare(String(code || '').trim(), row.code_hash);
  if (!ok) {
    db.prepare('UPDATE email_codes SET attempts=attempts+1 WHERE id=?').run(row.id);
    return false;
  }
  if (consume) db.prepare('DELETE FROM email_codes WHERE id=?').run(row.id);
  return true;
}

module.exports = { initVerify, normEmail, validEmail, mailConfigured, issueCode, checkCode };
