'use strict';

const {
  QUIET_HOURS_END,
  QUIET_HOURS_START,
  QUIET_HOURS_TIMEZONE,
} = require('./constants');

function getZonedDateParts(date = new Date(), timeZone = QUIET_HOURS_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function isWithinQuietHours(date = new Date(), timeZone = QUIET_HOURS_TIMEZONE) {
  const { hour } = getZonedDateParts(date, timeZone);
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

function getMillisecondsUntilAllowedWindow(date = new Date(), timeZone = QUIET_HOURS_TIMEZONE) {
  const { hour, minute, second } = getZonedDateParts(date, timeZone);
  const elapsedSeconds = (hour * 60 * 60) + (minute * 60) + second;

  if (hour >= QUIET_HOURS_START) {
    const endOfDaySeconds = 24 * 60 * 60;
    return ((endOfDaySeconds - elapsedSeconds) + (QUIET_HOURS_END * 60 * 60)) * 1000;
  }

  if (hour < QUIET_HOURS_END) {
    return ((QUIET_HOURS_END * 60 * 60) - elapsedSeconds) * 1000;
  }

  return 0;
}

function formatResumeAt(date = new Date(), timeZone = QUIET_HOURS_TIMEZONE) {
  const waitMs = getMillisecondsUntilAllowedWindow(date, timeZone);
  const resumeDate = new Date(date.getTime() + waitMs);
  const parts = getZonedDateParts(resumeDate, timeZone);
  const pad = (value) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} ${timeZone}`;
}

module.exports = {
  formatResumeAt,
  getMillisecondsUntilAllowedWindow,
  isWithinQuietHours,
};
