const User = require("../models/User");
const HttpError = require("../utils/httpError");
const { getNextLocalMidnight } = require("../utils/time");

// Timezone and currency changes do not apply immediately. A change takes effect
// at the next local midnight of the timezone in effect when it was requested,
// so the current day finishes under the settings it started with.
//
// No scheduled job is needed: whenever settings are read, a pending change
// whose effective time has passed is already treated as the current settings.

function isDue(pendingSettings, now) {
    return Boolean(pendingSettings) && new Date(pendingSettings.effectiveAt) <= now;
}

function getEffectiveSettings(user, now) {
    const source = isDue(user.pendingSettings, now) ? user.pendingSettings : user.settings;

    return {
        timezone: source.timezone,
        currency: source.currency
    };
}

function getPendingChange(user, now) {
    if (!user.pendingSettings || isDue(user.pendingSettings, now)) {
        return null;
    }

    const { timezone, currency, requestedAt, effectiveAt } = user.pendingSettings;

    return { timezone, currency, requestedAt, effectiveAt };
}

function formatSettings(user, now) {
    return {
        settings: getEffectiveSettings(user, now),
        pendingChange: getPendingChange(user, now)
    };
}

async function findUserOrFail(userId, query) {
    const user = await query;

    if (!user) {
        // The token is valid but the account no longer exists.
        throw new HttpError(401, "User account not found.");
    }

    return user;
}

async function loadEffectiveSettings(userId, now) {
    const user = await findUserOrFail(
        userId,
        User.findById(userId).select("settings pendingSettings").lean()
    );

    return getEffectiveSettings(user, now);
}

async function loadSettings(userId, now) {
    const user = await findUserOrFail(
        userId,
        User.findById(userId).select("settings pendingSettings").lean()
    );

    return formatSettings(user, now);
}

// Schedules a change of timezone and/or currency. A second request before the
// change takes effect replaces the pending one; requesting the settings that
// are already in effect cancels it.
async function requestSettingsChange(userId, changes, now) {
    const user = await findUserOrFail(userId, User.findById(userId));
    const current = getEffectiveSettings(user, now);
    const pending = getPendingChange(user, now);

    // Store a change whose time has already come as the current settings.
    if (isDue(user.pendingSettings, now)) {
        user.settings = current;
    }

    const next = {
        ...current,
        ...(pending && { timezone: pending.timezone, currency: pending.currency }),
        ...changes
    };

    if (next.timezone === current.timezone && next.currency === current.currency) {
        user.pendingSettings = null;
    } else {
        user.pendingSettings = {
            ...next,
            requestedAt: now,
            effectiveAt: getNextLocalMidnight(now, current.timezone)
        };
    }

    await user.save();

    return formatSettings(user, now);
}

module.exports = {
    getEffectiveSettings,
    getPendingChange,
    formatSettings,
    loadEffectiveSettings,
    loadSettings,
    requestSettingsChange
};
