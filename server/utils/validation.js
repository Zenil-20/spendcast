const HttpError = require("./httpError");
const {
    parseDateString,
    isDateTimeString,
    startOfLocalDay,
    getLocalDateString
} = require("./time");

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
const MIN_DATE = "1900-01-01";

function readBody(req) {
    const body = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new HttpError(400, "Request body must be a JSON object.");
    }

    return body;
}

function isMissing(value) {
    return value === undefined || value === null || value === "";
}

// Returns trimmed text, or undefined for an optional field that was not sent.
function readText(value, field, { required = true, max = 200 } = {}) {
    if (isMissing(value)) {
        if (required) {
            throw new HttpError(400, `${field} is required.`);
        }

        return undefined;
    }

    if (typeof value !== "string" || !value.trim()) {
        throw new HttpError(400, `${field} must be a non-empty string.`);
    }

    const text = value.trim();

    if (text.length > max) {
        throw new HttpError(400, `${field} must be at most ${max} characters.`);
    }

    return text;
}

function readEnum(value, field, allowed) {
    const text = readText(value, field);

    if (!allowed.includes(text)) {
        throw new HttpError(400, `${field} must be one of: ${allowed.join(", ")}.`);
    }

    return text;
}

function readObjectId(value, field) {
    if (typeof value !== "string" || !OBJECT_ID_PATTERN.test(value)) {
        throw new HttpError(400, `${field} must be a valid id.`);
    }

    return value;
}

// Reads a "YYYY-MM-DD" calendar date.
function readDateString(value, field) {
    if (!parseDateString(value) || value < MIN_DATE) {
        throw new HttpError(400, `${field} must be a valid date in YYYY-MM-DD format.`);
    }

    return value;
}

// Resolves an expense date in the user's timezone. "YYYY-MM-DD" means that day
// in the user's timezone; a date-time with an offset is an exact instant.
// Future dates are rejected: the forecast treats recorded expenses as spent.
function resolveExpenseDate(value, timeZone, now) {
    let resolved;

    if (parseDateString(value)) {
        resolved = { localDate: value, date: startOfLocalDay(value, timeZone) };
    } else if (isDateTimeString(value)) {
        const date = new Date(value);
        resolved = { date, localDate: getLocalDateString(date, timeZone) };
    } else {
        throw new HttpError(400, "date must be YYYY-MM-DD or an ISO date-time with an offset, e.g. 2026-10-05T14:30:00+05:30.");
    }

    if (resolved.localDate < MIN_DATE) {
        throw new HttpError(400, "date is too far in the past.");
    }

    if (resolved.localDate > getLocalDateString(now, timeZone)) {
        throw new HttpError(400, "date cannot be in the future.");
    }

    return resolved;
}

module.exports = {
    readBody,
    isMissing,
    readText,
    readEnum,
    readObjectId,
    readDateString,
    resolveExpenseDate
};
