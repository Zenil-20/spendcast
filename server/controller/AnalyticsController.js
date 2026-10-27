const Alert = require('../models/Alert');
const User = require('../models/User');
const HttpError = require('../utils/httpError');
const { getNow } = require('../utils/clock');
const { parseAmount } = require('../utils/money');
const { readBody, isMissing, readEnum, readObjectId } = require('../utils/validation');
const navStore = require('../services/navStore');
const analytics = require('../services/analytics');

const MAX_EXTRA_MONTHLY = 1e8;
const BUCKETS = ['equity', 'debt', 'hybrid', 'other'];

// NAV service outages become a 502 instead of a generic 500.
async function withUpstream(task) {
    try {
        return await task();
    } catch (error) {
        if (error.upstream) throw new HttpError(502, 'The NAV data service is unavailable. Please try again shortly.');
        throw error;
    }
}

function readSchemeCode(value) {
    const code = Number(value);
    if (!Number.isInteger(code) || code <= 0) throw new HttpError(400, 'schemeCode must be a valid scheme code.');
    return code;
}

/* ---------- Overlap ---------- */

// GET /portfolio/overlap — what the funds own together, company by company.
async function getOverlap(req, res) {
    const result = await withUpstream(() => analytics.buildOverlap(req.user.id, getNow(req)));
    res.status(200).json({ success: true, ...result });
}

// POST /portfolio/overlap/candidate  { schemeCode, amount? } — would this fund add diversification?
async function checkCandidate(req, res) {
    const body = readBody(req);
    const schemeCode = readSchemeCode(body.schemeCode);
    let amount = null;

    if (!isMissing(body.amount)) {
        const parsed = parseAmount(body.amount, 'INR');
        if (parsed.error) throw new HttpError(400, `amount: ${parsed.error}`);
        if (parsed.amount < 500 || parsed.amount > 1e9) throw new HttpError(400, 'amount must be between ₹500 and ₹100 crore.');
        amount = parsed.amount;
    }

    try {
        await navStore.getHistory(schemeCode);
    } catch (error) {
        if (error.status === 404) throw new HttpError(404, 'That fund was not found, or has no NAV history.');
        if (error.upstream) throw new HttpError(502, 'The NAV data service is unavailable. Please try again shortly.');
        throw error;
    }

    const result = await withUpstream(() => analytics.buildCandidate(req.user.id, getNow(req), schemeCode, amount));
    res.status(200).json({ success: true, ...result });
}

/* ---------- Forecast ---------- */

// GET /portfolio/projection?extra=5000 — the forecast, with the monthly SIP
// total changed by `extra` (negative lowers it).
async function getProjection(req, res) {
    const extra = isMissing(req.query.extra) ? 0 : Number(req.query.extra);
    if (!Number.isFinite(extra) || Math.abs(extra) > MAX_EXTRA_MONTHLY) {
        throw new HttpError(400, 'extra must be a monthly amount between -₹10 crore and ₹10 crore.');
    }
    const result = await withUpstream(() => analytics.buildProjection(req.user.id, getNow(req), Math.round(extra)));
    res.status(200).json({ success: true, ...result });
}

/* ---------- Health ---------- */

// GET /portfolio/health — the score, each factor's evidence, and what changed.
async function getHealth(req, res) {
    const result = await withUpstream(() => analytics.buildHealth(req.user.id, getNow(req)));
    res.status(200).json({ success: true, ...result });
}

function profileView(profile) {
    return {
        horizonYears: profile?.horizonYears ?? null,
        targetAllocation: profile?.targetAllocation
            ? Object.fromEntries(BUCKETS.map(bucket => [bucket, Math.round(profile.targetAllocation[bucket] * 1000) / 10]))
            : null
    };
}

// GET /portfolio/profile — horizon and target allocation (percentages).
async function getProfile(req, res) {
    const user = await User.findById(req.user.id, { investmentProfile: 1 }).lean();
    if (!user) throw new HttpError(401, 'User account not found.');
    res.status(200).json({ success: true, profile: profileView(user.investmentProfile) });
}

// PUT /portfolio/profile  { horizonYears: 8 | null, targetAllocation: { equity: 70, debt: 20, hybrid: 10, other: 0 } | null }
async function saveProfile(req, res) {
    const body = readBody(req);

    let horizonYears = null;
    if (!isMissing(body.horizonYears)) {
        horizonYears = Number(body.horizonYears);
        if (!Number.isFinite(horizonYears) || horizonYears < 0.25 || horizonYears > 50) {
            throw new HttpError(400, 'horizonYears must be between 0.25 and 50, or empty.');
        }
    }

    let targetAllocation = null;
    if (!isMissing(body.targetAllocation)) {
        const raw = body.targetAllocation;
        if (typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'targetAllocation must be an object of percentages.');
        const values = BUCKETS.map(bucket => (isMissing(raw[bucket]) ? 0 : Number(raw[bucket])));
        if (values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) {
            throw new HttpError(400, `targetAllocation values (${BUCKETS.join(', ')}) must be percentages from 0 to 100.`);
        }
        const total = values.reduce((sum, value) => sum + value, 0);
        if (Math.abs(total - 100) > 0.5) throw new HttpError(400, `targetAllocation must add up to 100% (it adds up to ${total}%).`);
        targetAllocation = Object.fromEntries(BUCKETS.map((bucket, i) => [bucket, values[i] / total]));
    }

    const profile = horizonYears === null && targetAllocation === null ? null : { horizonYears, targetAllocation };
    // updateOne, not save(): doesn't conflict with a concurrent settings change.
    await User.updateOne({ _id: req.user.id }, { $set: { investmentProfile: profile } }, { runValidators: true });
    res.status(200).json({ success: true, profile: profileView(profile) });
}

/* ---------- Alerts ---------- */

// GET /alerts?include=closed
async function listAlerts(req, res) {
    const includeClosed = req.query.include === 'closed';
    const alerts = await withUpstream(() => analytics.listAlerts(req.user.id, getNow(req), { includeClosed }));
    res.status(200).json({ success: true, alerts });
}

// PATCH /alerts/:id  { status: "dismissed" | "open" } — dismiss, or undo a dismissal.
async function updateAlert(req, res) {
    const id = readObjectId(req.params.id, 'id');
    const status = readEnum(readBody(req).status, 'status', ['dismissed', 'open']);
    const now = getNow(req);
    const alert = await Alert.findOne({ _id: id, userId: req.user.id });

    if (!alert) throw new HttpError(404, 'Alert not found.');
    if (status === 'open' && alert.status !== 'dismissed') throw new HttpError(400, 'Only a dismissed alert can be reopened.');
    if (status === 'dismissed' && alert.status === 'resolved') throw new HttpError(400, 'This alert has already resolved.');

    alert.status = status;
    alert.dismissedAt = status === 'dismissed' ? now : null;
    await alert.save();
    res.status(200).json({ success: true, alert: analytics.alertView(alert.toObject()) });
}

module.exports = {
    getOverlap,
    checkCandidate,
    getProjection,
    getHealth,
    getProfile,
    saveProfile,
    listAlerts,
    updateAlert
};
