'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatResumeAt,
  getMillisecondsUntilAllowedWindow,
  isWithinQuietHours,
} = require('../lib/service-window');

test('horario de silencio cruza a meia-noite', () => {
  assert.equal(isWithinQuietHours(new Date('2026-01-01T23:00:00Z'), 'UTC'), true);
  assert.equal(isWithinQuietHours(new Date('2026-01-01T06:30:00Z'), 'UTC'), true);
  assert.equal(isWithinQuietHours(new Date('2026-01-01T12:00:00Z'), 'UTC'), false);
});

test('calcula o tempo e o horario de retomada', () => {
  const date = new Date('2026-01-01T23:30:00Z');
  assert.equal(getMillisecondsUntilAllowedWindow(date, 'UTC'), 7.5 * 60 * 60 * 1000);
  assert.equal(formatResumeAt(date, 'UTC'), '2026-01-02 07:00:00 UTC');
});
