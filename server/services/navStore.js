// Local store of the scheme catalogue and NAV histories, and the job that
// keeps them current.
//
// NAVs are published once per trading day (Indian market, IST). Each night at
// 00:05 IST the previous day's NAV is fetched for every scheme someone holds,
// using an incremental request (only dates after the last one stored). Later
// runs at 06:00 and 09:00 IST pick up NAVs the source published late. Nothing
// is fetched for schemes nobody holds.

const crypto = require("crypto");
const MutualFundScheme = require("../models/MutualFundScheme");
const NavHistory = require("../models/NavHistory");
const Investment = require("../models/Investment");
const JobLock = require("../models/JobLock");
const mfapi = require("./mfapi");
const { getLocalDateString, startOfLocalDay, addDays } = require("../utils/time");
const { nameWords, searchCatalogue } = require("../utils/fundSearch");

const MARKET_TIMEZONE = "Asia/Kolkata";
// UTI Nifty 50 Index Fund - Direct Plan - Growth: benchmark for beta and alpha.
const BENCHMARK_SCHEME = Number(process.env.MF_BENCHMARK_SCHEME || 120716);
const SYNC_TIMES = ["00:05", "06:00", "09:00"];
const CATALOGUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const LOCK_LEASE_MS = 15 * 60 * 1000;
const INSTANCE_ID = crypto.randomUUID();

/* ---------- Catalogue (search) ---------- */

let catalogue = null;
let catalogueLoading = null;

function toEntry(doc) {
    const words = nameWords(doc.schemeName);
    return {
        schemeCode: doc.schemeCode,
        schemeName: doc.schemeName,
        isinGrowth: doc.isinGrowth || null,
        isinDivReinvestment: doc.isinDivReinvestment || null,
        search: words.join(" "),
        words
    };
}

// Schemes customers hold rank higher in search (a popularity signal).
// Refreshed at most every 10 minutes.
let heldSchemes = { codes: new Set(), loadedAt: 0 };

async function getHeldSchemes() {
    if (Date.now() - heldSchemes.loadedAt > 10 * 60 * 1000) {
        heldSchemes = { codes: new Set(await Investment.distinct("schemeCode")), loadedAt: Date.now() };
    }
    return heldSchemes.codes;
}

async function refreshCatalogue() {
    const list = await mfapi.listSchemes();
    // The source lists most schemes twice; keep one row per scheme code.
    const byCode = new Map();
    list.forEach(item => {
        if (Number.isInteger(item.schemeCode) && item.schemeName && !byCode.has(item.schemeCode)) byCode.set(item.schemeCode, item);
    });
    const rows = [...byCode.values()];

    for (let i = 0; i < rows.length; i += 2000) {
        await MutualFundScheme.bulkWrite(rows.slice(i, i + 2000).map(item => ({
            updateOne: {
                filter: { schemeCode: item.schemeCode },
                update: {
                    $set: {
                        schemeName: item.schemeName.trim(),
                        isinGrowth: item.isinGrowth || null,
                        isinDivReinvestment: item.isinDivReinvestment || null
                    }
                },
                upsert: true
            }
        })), { ordered: false });
    }

    catalogue = rows.map(toEntry);
    await JobLock.updateOne({ _id: "catalogue" }, { $set: { lastSuccessAt: new Date(), lockedUntil: new Date(0), owner: INSTANCE_ID } }, { upsert: true });
    console.log(`[mf] Catalogue refreshed: ${rows.length} schemes`);
}

// Loads the catalogue into memory, downloading it the first time.
function ensureCatalogue() {
    if (catalogue) return Promise.resolve(catalogue);

    if (!catalogueLoading) {
        catalogueLoading = (async () => {
            const docs = await MutualFundScheme.find({}, { schemeCode: 1, schemeName: 1, isinGrowth: 1, isinDivReinvestment: 1 }).lean();

            if (docs.length > 0) {
                catalogue = docs.map(toEntry);
            } else {
                await refreshCatalogue();
            }

            return catalogue;
        })().finally(() => { catalogueLoading = null; });
    }

    return catalogueLoading;
}

// Search by scheme code, ISIN or words of the name (typo-tolerant, see
// utils/fundSearch.js). Returns { results, match } where match is "exact",
// "fuzzy" (spelling corrected), "partial" (some words matched) or "none".
async function searchSchemes(query, limit = 20) {
    const list = await ensureCatalogue();
    const term = String(query || "").trim();

    if (!term) return { results: [], match: "none" };

    if (/^\d+$/.test(term)) {
        const code = Number(term);
        const results = list
            .filter(item => String(item.schemeCode).startsWith(term))
            .sort((a, b) => (a.schemeCode === code ? -1 : b.schemeCode === code ? 1 : a.schemeCode - b.schemeCode))
            .slice(0, limit)
            .map(strip);
        return { results, match: results.length ? "exact" : "none" };
    }

    if (/^inf[a-z0-9]{9}$/i.test(term)) {
        const isin = term.toUpperCase();
        const results = list.filter(item => item.isinGrowth === isin || item.isinDivReinvestment === isin).slice(0, limit).map(strip);
        return { results, match: results.length ? "exact" : "none" };
    }

    const { results, match } = searchCatalogue(list, term, { limit, held: await getHeldSchemes() });
    return { results: results.map(strip), match };
}

function strip(item) {
    return {
        schemeCode: item.schemeCode,
        schemeName: item.schemeName,
        isinGrowth: item.isinGrowth,
        isinDivReinvestment: item.isinDivReinvestment
    };
}

async function findScheme(schemeCode) {
    const list = await ensureCatalogue();
    return list.find(item => item.schemeCode === schemeCode) || null;
}

/* ---------- NAV histories ---------- */

const cache = new Map();
const inFlight = new Map();

function toResult(doc) {
    return { meta: doc.meta, series: { dates: doc.dates, values: doc.values }, lastDate: doc.lastDate };
}

async function fetchFullHistory(schemeCode) {
    const { meta, series } = await mfapi.getHistory(schemeCode);

    if (!series.dates.length) {
        throw Object.assign(new Error(`No NAV history for scheme ${schemeCode}`), { status: 404 });
    }

    const doc = await NavHistory.findOneAndUpdate(
        { schemeCode },
        {
            $set: {
                meta,
                dates: series.dates,
                values: series.values,
                lastDate: series.dates[series.dates.length - 1],
                lastCheckedAt: new Date()
            }
        },
        { upsert: true, returnDocument: "after", lean: true }
    );

    return doc;
}

// Appends NAVs published after the last stored date.
async function updateHistory(doc) {
    const { meta, series } = await mfapi.getHistory(doc.schemeCode, doc.lastDate);
    const newDates = [];
    const newValues = [];

    series.dates.forEach((date, i) => {
        if (date > doc.lastDate) {
            newDates.push(date);
            newValues.push(series.values[i]);
        }
    });

    const update = { $set: { meta, lastCheckedAt: new Date() } };

    if (newDates.length) {
        update.$push = { dates: { $each: newDates }, values: { $each: newValues } };
        update.$set.lastDate = newDates[newDates.length - 1];
    }

    // Conditional on lastDate, so two runs can never append the same days twice.
    const updated = await NavHistory.findOneAndUpdate(
        { schemeCode: doc.schemeCode, lastDate: doc.lastDate },
        update,
        { returnDocument: "after", lean: true }
    );

    return { doc: updated || (await NavHistory.findOne({ schemeCode: doc.schemeCode }).lean()), added: newDates.length };
}

// NAV history of a scheme, downloading it the first time it's needed.
async function getHistory(schemeCode) {
    const cached = cache.get(schemeCode);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.result;

    if (inFlight.has(schemeCode)) return inFlight.get(schemeCode);

    const promise = (async () => {
        const doc = (await NavHistory.findOne({ schemeCode }).lean()) || (await fetchFullHistory(schemeCode));
        const result = toResult(doc);
        cache.set(schemeCode, { result, loadedAt: Date.now() });
        return result;
    })().finally(() => inFlight.delete(schemeCode));

    inFlight.set(schemeCode, promise);
    return promise;
}

function getBenchmark() {
    return getHistory(BENCHMARK_SCHEME).catch(() => null);
}

function marketToday(now = new Date()) {
    return getLocalDateString(now, MARKET_TIMEZONE);
}

/* ---------- Daily sync ---------- */

async function acquireLock(name) {
    const now = new Date();

    try {
        const lock = await JobLock.findOneAndUpdate(
            { _id: name, $or: [{ lockedUntil: { $lt: now } }, { owner: INSTANCE_ID }] },
            { $set: { lockedUntil: new Date(now.getTime() + LOCK_LEASE_MS), owner: INSTANCE_ID } },
            { upsert: true, returnDocument: "after" }
        );
        return !!lock;
    } catch (error) {
        // Duplicate key: another instance holds the lock.
        if (error.code === 11000) return false;
        throw error;
    }
}

async function releaseLock(name, succeeded) {
    await JobLock.updateOne(
        { _id: name, owner: INSTANCE_ID },
        { $set: { lockedUntil: new Date(0), ...(succeeded && { lastSuccessAt: new Date() }) } }
    );
}

// Brings every held scheme (and the benchmark) up to date.
async function syncTrackedSchemes() {
    if (!(await acquireLock("nav-sync"))) {
        return { skipped: true };
    }

    const today = marketToday();
    let updated = 0;
    let failed = 0;
    let succeeded = false;

    try {
        const codes = new Set([...(await Investment.distinct("schemeCode")), BENCHMARK_SCHEME]);

        await Promise.all([...codes].map(async schemeCode => {
            try {
                const doc = await NavHistory.findOne({ schemeCode }).lean();

                if (!doc) {
                    await fetchFullHistory(schemeCode);
                    updated += 1;
                    return;
                }

                // Today's NAV is already stored: nothing newer can exist.
                if (doc.lastDate >= today) return;

                const result = await updateHistory(doc);
                if (result.added) updated += 1;
                cache.delete(schemeCode);
            } catch (error) {
                failed += 1;
                console.error(`[mf] NAV sync failed for ${schemeCode}:`, error.message);
            }
        }));

        succeeded = failed === 0;
        console.log(`[mf] NAV sync: ${codes.size} schemes checked, ${updated} updated, ${failed} failed`);

        // Refresh the catalogue weekly so new schemes become searchable.
        const catalogueLock = await JobLock.findById("catalogue").lean();
        if (!catalogueLock?.lastSuccessAt || Date.now() - catalogueLock.lastSuccessAt.getTime() > CATALOGUE_MAX_AGE_MS) {
            await refreshCatalogue().catch(error => console.error("[mf] Catalogue refresh failed:", error.message));
        }

        return { checked: codes.size, updated, failed };
    } finally {
        await releaseLock("nav-sync", succeeded);
    }
}

// Milliseconds until the next scheduled run, in market time (IST).
function msUntilNextRun(now = new Date()) {
    const today = marketToday(now);
    const candidates = [today, addDays(today, 1)].flatMap(date => SYNC_TIMES.map(time => {
        const [hours, minutes] = time.split(":").map(Number);
        return startOfLocalDay(date, MARKET_TIMEZONE).getTime() + (hours * 60 + minutes) * 60 * 1000;
    }));

    return Math.min(...candidates.filter(time => time > now.getTime())) - now.getTime();
}

let timer = null;

// The NAV sync, then the daily emails built from the fresh NAVs. Only the
// instance that ran the sync (and so held the lock) sends them.
async function syncAndNotify() {
    const result = await syncTrackedSchemes().catch(error => console.error("[mf] NAV sync error:", error.message));

    if (result && !result.skipped) {
        // Required here: notifications -> portfolio -> navStore would be circular at load time.
        await require("./notifications").sendDailyNotifications()
            .catch(error => console.error("[mail] Notification job error:", error.message));
    }
}

function scheduleNext() {
    const delay = msUntilNextRun();
    timer = setTimeout(async () => {
        await syncAndNotify();
        scheduleNext();
    }, delay);
    timer.unref?.();
}

// Starts the daily schedule, plus a catch-up run shortly after startup if the
// last successful sync is more than six hours old.
function startNavScheduler() {
    if (process.env.MF_SYNC_ENABLED === "false" || timer) return;

    scheduleNext();

    setTimeout(async () => {
        try {
            const lock = await JobLock.findById("nav-sync").lean();
            if (!lock?.lastSuccessAt || Date.now() - lock.lastSuccessAt.getTime() > 6 * 60 * 60 * 1000) {
                await syncAndNotify();
            }
            await ensureCatalogue();
        } catch (error) {
            console.error("[mf] Startup sync error:", error.message);
        }
    }, 10_000).unref?.();
}

module.exports = {
    MARKET_TIMEZONE,
    BENCHMARK_SCHEME,
    searchSchemes,
    findScheme,
    ensureCatalogue,
    getHistory,
    getBenchmark,
    marketToday,
    syncTrackedSchemes,
    msUntilNextRun,
    startNavScheduler
};
