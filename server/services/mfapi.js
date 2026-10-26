// Client for https://api.mfapi.in (free, no key). Requests time out, are
// retried with backoff on network errors, 429 and 5xx, and at most
// MAX_CONCURRENT run at once so we stay a polite user of a shared API.

const { fromApiDate } = require("../utils/mfMath");

const BASE_URL = process.env.MFAPI_BASE_URL || "https://api.mfapi.in";
const TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 3;
const MAX_CONCURRENT = 4;

let active = 0;
const queue = [];

async function withSlot(task) {
    if (active >= MAX_CONCURRENT) {
        await new Promise(resolve => queue.push(resolve));
    }

    active += 1;

    try {
        return await task();
    } finally {
        active -= 1;
        queue.shift()?.();
    }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(path, timeout = TIMEOUT_MS) {
    return withSlot(async () => {
        let lastError;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const response = await fetch(BASE_URL + path, {
                    headers: { Accept: "application/json", "User-Agent": "Spendcast/1.0 (portfolio tracker)" },
                    signal: AbortSignal.timeout(timeout)
                });

                if (response.status === 429 || response.status >= 500) {
                    throw Object.assign(new Error(`mfapi responded ${response.status}`), { retryable: true });
                }

                if (!response.ok) {
                    throw Object.assign(new Error(`mfapi responded ${response.status}`), { status: response.status });
                }

                return await response.json();
            } catch (error) {
                lastError = error;
                const retryable = error.retryable || error.name === "TimeoutError" || error.name === "TypeError";

                if (!retryable || attempt === MAX_ATTEMPTS) break;
                await sleep(500 * 2 ** attempt);
            }
        }

        // Marks failures of the upstream service, as opposed to bugs in our code.
        lastError.upstream = true;
        throw lastError;
    });
}

// mfapi returns NAVs newest first, as strings, with "dd-mm-yyyy" dates.
// Converts to oldest-first arrays and drops invalid or zero NAVs.
function toSeries(data) {
    const dates = [];
    const values = [];

    for (let i = (data || []).length - 1; i >= 0; i--) {
        const nav = Number(data[i].nav);
        if (Number.isFinite(nav) && nav > 0) {
            dates.push(fromApiDate(data[i].date));
            values.push(nav);
        }
    }

    return { dates, values };
}

function toMeta(meta = {}) {
    return {
        schemeName: meta.scheme_name || null,
        fundHouse: meta.fund_house || null,
        schemeType: meta.scheme_type || null,
        schemeCategory: meta.scheme_category || null,
        isinGrowth: meta.isin_growth || null,
        isinDivReinvestment: meta.isin_div_reinvestment || null
    };
}

// Every scheme: [{ schemeCode, schemeName, isinGrowth, isinDivReinvestment }] (~11 MB).
function listSchemes() {
    return getJson("/mf", 120000);
}

// NAV history, optionally from `startDate` ("YYYY-MM-DD") onwards.
async function getHistory(schemeCode, startDate) {
    const query = startDate ? `?startDate=${startDate}` : "";
    const body = await getJson(`/mf/${schemeCode}${query}`);

    // An unknown code still returns 200, with scheme_code 0 and no data.
    if (!body || !body.meta || body.status === "FAIL" || !body.meta.scheme_code) {
        throw Object.assign(new Error(`Scheme ${schemeCode} not found on mfapi`), { status: 404 });
    }

    return { meta: toMeta(body.meta), series: toSeries(body.data) };
}

module.exports = {
    listSchemes,
    getHistory,
    toSeries
};
