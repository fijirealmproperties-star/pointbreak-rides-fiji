const test = require('node:test');
const assert = require('node:assert/strict');
const { meterWaitingIncrement } = require('../src/realtime');

test('waiting meter counts normal five-second stopped-location updates', () => {
  assert.equal(meterWaitingIncrement(5 / 60, 0), 5 / 60);
});

test('waiting meter caps delayed updates and ignores long gaps or movement', () => {
  assert.equal(meterWaitingIncrement(12 / 60, 0), 10 / 60);
  assert.equal(meterWaitingIncrement(15 / 60, 0), 0);
  assert.equal(meterWaitingIncrement(5 / 60, 10), 0);
  assert.equal(meterWaitingIncrement(5 / 60, 25), 0);
});
