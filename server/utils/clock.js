const HttpError = require("./httpError");

// Test clock for manual and API testing of time-dependent behavior (month
// boundaries, settings that apply at midnight). When ENABLE_TEST_CLOCK=true and
// NODE_ENV is not "production", the X-Test-Now header (an ISO date-time) is
// used as the current time. Otherwise the header is ignored.
function isTestClockEnabled() {
    return process.env.ENABLE_TEST_CLOCK === "true"
        && process.env.NODE_ENV !== "production";
}

function getNow(req) {
    const header = req.get("X-Test-Now");

    if (!header || !isTestClockEnabled()) {
        return new Date();
    }

    const now = new Date(header);

    if (Number.isNaN(now.getTime())) {
        throw new HttpError(400, "X-Test-Now must be an ISO date-time, e.g. 2026-10-23T10:00:00Z.");
    }

    return now;
}

module.exports = {
    isTestClockEnabled,
    getNow
};
