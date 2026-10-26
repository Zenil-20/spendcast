// Timezone helpers built on Intl, so every IANA timezone works without extra
// dependencies. Calendar dates are passed around as "YYYY-MM-DD" strings, which
// carry no timezone and sort correctly as plain strings.

const HOUR_MS = 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// Date-times must carry an explicit offset ("Z" or "+05:30"); without one the
// instant they describe is ambiguous.
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const formatterCache = new Map();

function getPartsFormatter(timeZone) {
    if (!formatterCache.has(timeZone)) {
        formatterCache.set(timeZone, new Intl.DateTimeFormat("en-US", {
            timeZone,
            hourCycle: "h23",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }));
    }

    return formatterCache.get(timeZone);
}

// ICU still reports some renamed zones under their old names (for example
// "Asia/Kolkata" resolves to "Asia/Calcutta"). Users expect the current IANA
// names, and Intl accepts both, so the current name is used everywhere.
const CURRENT_TIME_ZONE_NAMES = {
    "America/Godthab": "America/Nuuk",
    "Asia/Calcutta": "Asia/Kolkata",
    "Asia/Katmandu": "Asia/Kathmandu",
    "Asia/Rangoon": "Asia/Yangon",
    "Asia/Saigon": "Asia/Ho_Chi_Minh",
    "Atlantic/Faeroe": "Atlantic/Faroe",
    "Europe/Kiev": "Europe/Kyiv",
    "Pacific/Enderbury": "Pacific/Kanton",
    "Pacific/Ponape": "Pacific/Pohnpei",
    "Pacific/Truk": "Pacific/Chuuk"
};

function toCurrentTimeZoneName(name) {
    return CURRENT_TIME_ZONE_NAMES[name] || name;
}

// Returns the canonical IANA name, or null when the value is not a valid IANA
// timezone. Raw offsets such as "+05:30" are rejected: they ignore daylight saving.
function normalizeTimeZone(value) {
    if (typeof value !== "string" || !value.trim() || /^[+-]/.test(value.trim())) {
        return null;
    }

    try {
        const resolved = new Intl.DateTimeFormat("en-US", { timeZone: value.trim() })
            .resolvedOptions()
            .timeZone;

        return toCurrentTimeZoneName(resolved);
    } catch {
        return null;
    }
}

function getSupportedTimeZones() {
    const names = Intl.supportedValuesOf("timeZone").map(toCurrentTimeZoneName);

    return [...new Set([...names, "UTC"])].sort();
}

function getDaysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value, length = 2) {
    return String(value).padStart(length, "0");
}

function toDateString(year, month, day) {
    return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

// Parses "YYYY-MM-DD" into its parts, or returns null for invalid dates
// such as "2026-02-30".
function parseDateString(value) {
    const match = typeof value === "string" ? DATE_PATTERN.exec(value) : null;

    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (month < 1 || month > 12 || day < 1 || day > getDaysInMonth(year, month)) {
        return null;
    }

    return { year, month, day };
}

function isDateTimeString(value) {
    return typeof value === "string"
        && DATE_TIME_PATTERN.test(value)
        && !Number.isNaN(Date.parse(value));
}

function addDays(dateString, days) {
    const { year, month, day } = parseDateString(dateString);
    const date = new Date(Date.UTC(year, month - 1, day + days));

    return toDateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

// Wall-clock parts of `date` as seen in `timeZone`.
function getZonedParts(date, timeZone) {
    const parts = {};

    for (const { type, value } of getPartsFormatter(timeZone).formatToParts(date)) {
        if (type !== "literal") {
            parts[type] = Number(value);
        }
    }

    return parts;
}

function getLocalDateString(date, timeZone) {
    const { year, month, day } = getZonedParts(date, timeZone);

    return toDateString(year, month, day);
}

// Offset of `timeZone` from UTC at the instant `date`, in milliseconds.
function getTimeZoneOffset(date, timeZone) {
    const parts = getZonedParts(date, timeZone);
    const wallClockAsUtc = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second
    );

    return wallClockAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// First instant of a calendar day in `timeZone`. Offsets are sampled on both
// sides of the day so DST changes are handled: when midnight occurs twice the
// earlier one is used, and when DST skips midnight the day starts at the jump.
function startOfLocalDay(dateString, timeZone) {
    const { year, month, day } = parseDateString(dateString);
    const wallClockMidnight = Date.UTC(year, month - 1, day);

    const candidates = [-36, 0, 36]
        .map(hours => wallClockMidnight - getTimeZoneOffset(
            new Date(wallClockMidnight + hours * HOUR_MS),
            timeZone
        ))
        .filter(instant => getLocalDateString(new Date(instant), timeZone) === dateString)
        .sort((a, b) => a - b);

    const start = candidates.length > 0
        ? candidates[0]
        : wallClockMidnight - getTimeZoneOffset(new Date(wallClockMidnight), timeZone);

    return new Date(start);
}

function getNextLocalMidnight(now, timeZone) {
    return startOfLocalDay(addDays(getLocalDateString(now, timeZone), 1), timeZone);
}

// Fraction of the local day that has passed at `now` (0 at midnight, near 1 at 23:59).
function getElapsedDayFraction(now, timeZone) {
    const { hour, minute, second } = getZonedParts(now, timeZone);

    return (hour * 3600 + minute * 60 + second) / 86400;
}

module.exports = {
    normalizeTimeZone,
    getSupportedTimeZones,
    getDaysInMonth,
    toDateString,
    parseDateString,
    isDateTimeString,
    addDays,
    getZonedParts,
    getLocalDateString,
    getTimeZoneOffset,
    startOfLocalDay,
    getNextLocalMidnight,
    getElapsedDayFraction
};
