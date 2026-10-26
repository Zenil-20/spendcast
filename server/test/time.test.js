const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeTimeZone,
    getSupportedTimeZones,
    parseDateString,
    isDateTimeString,
    addDays,
    getLocalDateString,
    startOfLocalDay,
    getNextLocalMidnight,
    getElapsedDayFraction
} = require('../utils/time');

const HOUR = 60 * 60 * 1000;

test('timezones are validated against IANA names', () => {
    // ICU resolves these to legacy names; the current names must be kept.
    assert.equal(normalizeTimeZone('Asia/Kolkata'), 'Asia/Kolkata');
    assert.equal(normalizeTimeZone('Asia/Calcutta'), 'Asia/Kolkata');
    assert.equal(normalizeTimeZone('Europe/Kyiv'), 'Europe/Kyiv');
    assert.equal(normalizeTimeZone('asia/tokyo'), 'Asia/Tokyo');
    assert.ok(getSupportedTimeZones().includes('Asia/Kolkata'));
    assert.ok(!getSupportedTimeZones().includes('Asia/Calcutta'));
    assert.ok(getSupportedTimeZones().includes('UTC'));
    assert.equal(normalizeTimeZone(' America/New_York '), 'America/New_York');
    assert.equal(normalizeTimeZone('UTC'), 'UTC');
    assert.equal(normalizeTimeZone('Mars/Olympus'), null);
    assert.equal(normalizeTimeZone('+05:30'), null);
    assert.equal(normalizeTimeZone(''), null);
    assert.equal(normalizeTimeZone(42), null);
});

test('calendar dates are validated', () => {
    assert.deepEqual(parseDateString('2028-02-29'), { year: 2028, month: 2, day: 29 });
    assert.equal(parseDateString('2026-02-29'), null);
    assert.equal(parseDateString('2026-13-01'), null);
    assert.equal(parseDateString('2026-1-01'), null);
    assert.equal(isDateTimeString('2026-10-05T14:30:00+05:30'), true);
    assert.equal(isDateTimeString('2026-10-05T14:30:00Z'), true);
    // Without an offset the instant is ambiguous.
    assert.equal(isDateTimeString('2026-10-05T14:30:00'), false);
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('the same instant is a different local date in different timezones', () => {
    const instant = new Date('2026-10-31T20:00:00Z');

    assert.equal(getLocalDateString(instant, 'Asia/Kolkata'), '2026-11-01');
    assert.equal(getLocalDateString(instant, 'America/Los_Angeles'), '2026-10-31');
    assert.equal(getLocalDateString(instant, 'Pacific/Kiritimati'), '2026-11-01');
});

test('start of day uses the timezone offset', () => {
    assert.equal(startOfLocalDay('2026-10-23', 'Asia/Kolkata').toISOString(), '2026-10-22T18:30:00.000Z');
    assert.equal(startOfLocalDay('2026-10-23', 'America/New_York').toISOString(), '2026-10-23T04:00:00.000Z');
    assert.equal(startOfLocalDay('2026-10-23', 'UTC').toISOString(), '2026-10-23T00:00:00.000Z');
});

test('start of day is correct on DST change days', () => {
    // US spring forward (2026-03-08) and fall back (2026-11-01) happen at 02:00.
    assert.equal(startOfLocalDay('2026-03-08', 'America/New_York').toISOString(), '2026-03-08T05:00:00.000Z');
    assert.equal(startOfLocalDay('2026-11-01', 'America/New_York').toISOString(), '2026-11-01T04:00:00.000Z');

    // Chile skips midnight when DST starts, so the day begins at 01:00.
    const santiago = startOfLocalDay('2026-09-06', 'America/Santiago');
    assert.equal(getLocalDateString(santiago, 'America/Santiago'), '2026-09-06');
    assert.equal(getLocalDateString(new Date(santiago.getTime() - 1), 'America/Santiago'), '2026-09-05');
});

test('every day of a year starts exactly at its first instant', () => {
    for (const timeZone of ['America/Santiago', 'Australia/Lord_Howe', 'Asia/Tehran', 'Europe/London']) {
        let date = '2026-01-01';

        for (let i = 0; i < 365; i++) {
            const start = startOfLocalDay(date, timeZone);

            assert.equal(getLocalDateString(start, timeZone), date, `${timeZone} ${date}`);
            assert.notEqual(getLocalDateString(new Date(start.getTime() - 1), timeZone), date, `${timeZone} ${date}`);
            date = addDays(date, 1);
        }
    }
});

test('next local midnight is in the given timezone', () => {
    const now = new Date('2026-10-23T10:00:00Z');

    assert.equal(getNextLocalMidnight(now, 'Asia/Kolkata').toISOString(), '2026-10-23T18:30:00.000Z');
    assert.equal(getNextLocalMidnight(now, 'America/New_York').toISOString(), '2026-10-24T04:00:00.000Z');
    // Exactly at midnight, the next midnight is a full day later.
    assert.equal(
        getNextLocalMidnight(new Date('2026-10-23T00:00:00Z'), 'UTC').toISOString(),
        '2026-10-24T00:00:00.000Z'
    );
});

test('elapsed day fraction follows local time', () => {
    const now = new Date('2026-10-23T06:30:00Z');

    assert.equal(getElapsedDayFraction(now, 'Asia/Kolkata'), 0.5);
    assert.equal(getElapsedDayFraction(new Date(now.getTime() + 12 * HOUR), 'Asia/Kolkata'), 0);
});
