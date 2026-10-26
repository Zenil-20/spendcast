const test = require('node:test');
const assert = require('node:assert/strict');

const { getEffectiveSettings, getPendingChange } = require('../services/userSettings');

const user = {
    settings: { timezone: 'Asia/Kolkata', currency: 'INR' },
    pendingSettings: {
        timezone: 'America/New_York',
        currency: 'USD',
        requestedAt: new Date('2026-10-23T10:00:00Z'),
        // Next midnight in Asia/Kolkata after the request.
        effectiveAt: new Date('2026-10-23T18:30:00Z')
    }
};

test('pending change is not applied before its effective time', () => {
    const now = new Date('2026-10-23T18:29:59Z');

    assert.deepEqual(getEffectiveSettings(user, now), { timezone: 'Asia/Kolkata', currency: 'INR' });
    assert.equal(getPendingChange(user, now).timezone, 'America/New_York');
});

test('pending change applies from its effective time, without a job', () => {
    const now = new Date('2026-10-23T18:30:00Z');

    assert.deepEqual(getEffectiveSettings(user, now), { timezone: 'America/New_York', currency: 'USD' });
    assert.equal(getPendingChange(user, now), null);
});

test('settings without a pending change are returned as they are', () => {
    const plain = { settings: user.settings, pendingSettings: null };

    assert.deepEqual(getEffectiveSettings(plain, new Date()), user.settings);
    assert.equal(getPendingChange(plain, new Date()), null);
});
