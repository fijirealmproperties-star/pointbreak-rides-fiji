const express = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many booking requests. Please try again later.' },
});

function text(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function bookingDate(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const parsed = new Date(`${date}T${time}:00+12:00`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toLocaleDateString('en-CA', { timeZone: 'Pacific/Fiji' }) !== date ||
    parsed.toLocaleTimeString('en-GB', {
      timeZone: 'Pacific/Fiji',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }) !== time
  ) return null;
  if (parsed.getTime() < Date.now() + 10 * 60 * 1000) return null;
  if (parsed.getTime() > Date.now() + 30 * 24 * 60 * 60 * 1000) return null;
  return parsed.toISOString();
}

module.exports = (db) => {
  router.post('/', requestLimiter, (req, res) => {
    const body = req.body || {};
    const name = text(body.name, 100);
    const email = text(body.email, 254).toLowerCase();
    const phone = text(body.phone, 32);
    const pickup = text(body.pickup, 200);
    const dropoff = text(body.dropoff, 200);
    const notes = text(body.notes, 1000);
    const passengers = Number(body.passengers);
    const date = typeof body.date === 'string' ? body.date.trim() : '';
    const time = typeof body.time === 'string' ? body.time.trim() : '';
    const scheduledAt = bookingDate(date, time);

    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !/^\+?[\d\s().-]{7,32}$/.test(phone) || phone.replace(/\D/g, '').length < 7 ||
        !pickup || !dropoff || pickup === dropoff ||
        !Number.isInteger(passengers) || passengers < 1 || passengers > 15) {
      return res.status(400).json({ error: 'Please enter valid contact details, different pickup and destination locations, and 1–15 passengers.' });
    }
    if (!scheduledAt) {
      return res.status(400).json({ error: 'Choose a valid Fiji date and time between 10 minutes and 30 days from now.' });
    }

    const id = uuidv4();
    const result = db.prepare(`
      INSERT INTO guest_bookings (id, name, email, phone, pickup, dropoff, scheduled_at, passengers, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, email, phone, pickup, dropoff, scheduledAt, passengers, notes || null);
    if (!result || result.changes !== 1) {
      console.error('Failed to save guest booking request');
      return res.status(500).json({ error: 'Could not save your request. Please try again.' });
    }

    res.status(201).json({ booking: { id, status: 'pending', scheduled_at: scheduledAt } });
  });

  return router;
};
