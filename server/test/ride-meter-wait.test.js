const test = require('node:test');
const assert = require('node:assert/strict');
const { meterWaitingIncrement } = require('../src/realtime');
const { calculateFare } = require('../src/rides/fare');

test('waiting meter counts normal five-second stopped-location updates', () => {
  assert.equal(meterWaitingIncrement(5 / 60, 0), 5 / 60);
});

test('waiting meter caps delayed updates and ignores long gaps or movement', () => {
  assert.equal(meterWaitingIncrement(12 / 60, 0), 10 / 60);
  assert.equal(meterWaitingIncrement(15 / 60, 0), 0);
  assert.equal(meterWaitingIncrement(5 / 60, 10), 0);
  assert.equal(meterWaitingIncrement(5 / 60, 25), 0);
});

test('meter fare combines kilometres travelled and chargeable waiting time', () => {
  const fare = calculateFare(2, 5, { at: new Date('2026-03-05T00:00:00Z') });
  assert.equal(fare.distanceCharge, 2.8);
  assert.equal(fare.waitCharge, 0.9);
  assert.equal(fare.fare, 5.7);
});
