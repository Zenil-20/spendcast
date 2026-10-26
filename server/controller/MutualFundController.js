const crypto = require('crypto');
const Investment = require('../models/Investment');
const User = require('../models/User');
const HttpError = require('../utils/httpError');
const { getNow } = require('../utils/clock');
const { parseAmount } = require('../utils/money');
const {
    readBody,
    isMissing,
    readEnum,
    readObjectId,
    readDateString
} = require('../utils/validation');
const navStore = require('../services/navStore');
const portfolio = require('../services/portfolio');

// Mutual fund amounts are always in Indian rupees, whatever the user's
// display currency is.
const MF_CURRENCY = 'INR';
const KINDS = Investment.schema.path('kind').enumValues;

function readSchemeCode(value) {
    const code = Number(value);

    if (!Number.isInteger(code) || code <= 0) {
        throw new HttpError(400, 'schemeCode must be a valid scheme code.');
    }

    return code;
}

function readRange(value) {
    if (isMissing(value)) return '1Y';
    if (value !== 'ALL' && !portfolio.RANGES[value]) {
        throw new HttpError(400, `range must be one of: ${[...Object.keys(portfolio.RANGES), 'ALL'].join(', ')}.`);
    }
    return value;
}

// Loads a scheme's history, turning "not found" into a 404/400.
async function loadScheme(schemeCode, status = 404) {
    try {
        return await navStore.getHistory(schemeCode);
    } catch (error) {
        if (error.status === 404) throw new HttpError(status, 'That fund was not found, or has no NAV history.');
        if (error.upstream) throw new HttpError(502, 'The NAV data service is unavailable. Please try again shortly.');
        throw error;
    }
}

// Validates a new or changed investment. `existing` is the stored investment when editing.
async function readInvestment(body, now, existing = null) {
    const merged = { ...(existing || {}), ...body };
    const today = navStore.marketToday(now);
    const schemeCode = readSchemeCode(merged.schemeCode);
    const kind = readEnum(merged.kind, 'kind', KINDS);
    const { amount, error } = parseAmount(merged.amount, MF_CURRENCY);

    if (error) throw new HttpError(400, error);

    const startDate = readDateString(merged.startDate, 'startDate');
    const history = await loadScheme(schemeCode, 400);
    const firstNav = history.series.dates[0];

    if (startDate < firstNav) {
        throw new HttpError(400, `This fund's NAV history starts on ${firstNav}. Choose a start date on or after it.`);
    }

    const investment = {
        schemeCode,
        schemeName: history.meta?.schemeName || `Scheme ${schemeCode}`,
        kind,
        amount,
        startDate,
        sipDay: null,
        endDate: null,
        stepUpPercent: 0,
        skippedDates: Array.isArray(merged.skippedDates) ? merged.skippedDates : []
    };

    if (kind === 'lumpsum') {
        if (startDate > today) throw new HttpError(400, 'A lump-sum purchase date cannot be in the future.');
        return investment;
    }

    const sipDay = isMissing(merged.sipDay) ? Number(startDate.slice(8, 10)) : Number(merged.sipDay);
    if (!Number.isInteger(sipDay) || sipDay < 1 || sipDay > 31) {
        throw new HttpError(400, 'sipDay must be a day of the month from 1 to 31.');
    }

    const stepUpPercent = isMissing(merged.stepUpPercent) ? 0 : Number(merged.stepUpPercent);
    if (!Number.isFinite(stepUpPercent) || stepUpPercent < 0 || stepUpPercent > 100) {
        throw new HttpError(400, 'stepUpPercent must be between 0 and 100.');
    }

    let endDate = null;
    if (!isMissing(merged.endDate)) {
        endDate = readDateString(merged.endDate, 'endDate');
        if (endDate < startDate) throw new HttpError(400, 'endDate cannot be before startDate.');
    }

    for (const date of investment.skippedDates) {
        readDateString(date, 'skippedDates');
    }

    return { ...investment, sipDay, stepUpPercent, endDate };
}

/* ---------- Funds ---------- */

// GET /mf/search?q=  — by name, scheme code or ISIN.
async function searchFunds(req, res) {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    if (query.length < 2) {
        return res.status(200).json({ success: true, results: [], match: "none" });
    }

    const { results, match } = await navStore.searchSchemes(query.slice(0, 100), 25);
    res.status(200).json({ success: true, results, match });
}

// GET /mf/schemes/:code
async function getFund(req, res) {
    const schemeCode = readSchemeCode(req.params.code);
    await loadScheme(schemeCode);
    const detail = await portfolio.buildSchemeDetail(schemeCode, { range: readRange(req.query.range) });
    res.status(200).json({ success: true, ...detail });
}

/* ---------- Investments ---------- */

// POST /investments/preview — what an investment would look like, without saving.
async function previewInvestment(req, res) {
    const now = getNow(req);
    const input = await readInvestment(readBody(req), now);
    res.status(200).json({ success: true, preview: await portfolio.previewInvestment(input, now) });
}

// POST /investments
async function createInvestment(req, res) {
    const now = getNow(req);
    const input = await readInvestment(readBody(req), now);
    const investment = await Investment.create({ ...input, userId: req.user.id });
    const detail = await portfolio.buildHoldingDetail(req.user.id, investment.schemeCode, now);
    res.status(201).json({ success: true, investmentId: String(investment._id), ...detail });
}

// PATCH /investments/:id — change amount, dates, step-up, skipped installments, or stop/resume.
async function updateInvestment(req, res) {
    const id = readObjectId(req.params.id, 'id');
    const body = readBody(req);
    const now = getNow(req);
    const investment = await Investment.findOne({ _id: id, userId: req.user.id });

    if (!investment) throw new HttpError(404, 'Investment not found.');

    // The fund and the kind of investment can't change; create a new one instead.
    const { schemeCode, kind, ...changes } = body;
    const input = await readInvestment(changes, now, investment.toObject());

    Object.assign(investment, {
        amount: input.amount,
        startDate: input.startDate,
        sipDay: input.sipDay,
        endDate: input.endDate,
        stepUpPercent: input.stepUpPercent,
        skippedDates: input.skippedDates
    });

    // Stopping a SIP ends it today, so no further installments are counted.
    // A stopped SIP isn't restarted (that would invent purchases for the gap);
    // start a new SIP instead.
    if (!isMissing(body.isActive)) {
        if (typeof body.isActive !== 'boolean') throw new HttpError(400, 'isActive must be true or false.');
        const today = navStore.marketToday(now);

        if (body.isActive === false && investment.kind === 'sip') {
            if (!investment.endDate || investment.endDate > today) investment.endDate = today;
        } else if (body.isActive === true && !investment.isActive) {
            throw new HttpError(400, 'A stopped SIP can\'t be restarted. Add a new SIP for this fund instead.');
        }

        investment.isActive = body.isActive;
    }

    await investment.save();
    const detail = await portfolio.buildHoldingDetail(req.user.id, investment.schemeCode, now);
    res.status(200).json({ success: true, ...detail });
}

// DELETE /investments/:id — removes one SIP or one-time purchase. The response
// says how many investments remain in that fund.
async function deleteInvestment(req, res) {
    const id = readObjectId(req.params.id, 'id');
    const deleted = await Investment.findOneAndDelete({ _id: id, userId: req.user.id }).lean();

    if (!deleted) throw new HttpError(404, 'Investment not found.');

    const remaining = await Investment.countDocuments({ userId: req.user.id, schemeCode: deleted.schemeCode });
    res.status(200).json({ success: true, schemeCode: deleted.schemeCode, remaining });
}

// GET /holdings/:code?range=1Y — one fund: all its SIPs and one-time purchases combined.
async function getHolding(req, res) {
    const schemeCode = readSchemeCode(req.params.code);
    const detail = await portfolio.buildHoldingDetail(req.user.id, schemeCode, getNow(req), { range: readRange(req.query.range) });

    if (!detail) throw new HttpError(404, 'You have no investments in this fund.');
    res.status(200).json({ success: true, ...detail });
}

// DELETE /holdings/:code — removes a fund and every purchase in it.
async function deleteHolding(req, res) {
    const schemeCode = readSchemeCode(req.params.code);
    const result = await Investment.deleteMany({ userId: req.user.id, schemeCode });

    if (result.deletedCount === 0) throw new HttpError(404, 'You have no investments in this fund.');
    res.status(200).json({ success: true, removed: result.deletedCount });
}

// GET /investments/:id — kept for older links: returns the fund it belongs to.
async function getInvestment(req, res) {
    const id = readObjectId(req.params.id, 'id');
    const investment = await Investment.findOne({ _id: id, userId: req.user.id }, { schemeCode: 1 }).lean();

    if (!investment) throw new HttpError(404, 'Investment not found.');

    const detail = await portfolio.buildHoldingDetail(req.user.id, investment.schemeCode, getNow(req), { range: readRange(req.query.range) });
    res.status(200).json({ success: true, ...detail });
}

// GET /portfolio/series?codes=122639,120716 — daily value and invested amount
// per fund (all funds when no codes are given), for the chart builder.
async function getFundSeries(req, res) {
    const raw = typeof req.query.codes === 'string' ? req.query.codes.trim() : '';
    const codes = raw ? raw.split(',').map(readSchemeCode) : [];

    if (codes.length > 20) throw new HttpError(400, 'Choose at most 20 funds.');

    const result = await portfolio.buildFundSeries(req.user.id, getNow(req), codes);
    res.status(200).json({ success: true, ...result });
}

// GET /portfolio/harvest?booked=  — the tax-free gains harvest, given
// long-term gains already booked this financial year.
async function getHarvest(req, res) {
    const booked = isMissing(req.query.booked) ? 0 : Number(req.query.booked);
    if (!Number.isFinite(booked) || booked < 0 || booked > 1e10) {
        throw new HttpError(400, 'booked must be the long-term gains already booked this year, 0 or more.');
    }
    const plan = await portfolio.buildHarvestPlan(req.user.id, getNow(req), booked);
    res.status(200).json({ success: true, ...plan });
}

const PRESET_METRICS = ['value', 'invested', 'gain', 'returnPercent'];
const PRESET_MODES = ['separate', 'combined'];
const MAX_PRESETS = 12;

// GET /portfolio/chart-presets
async function getChartPresets(req, res) {
    const user = await User.findById(req.user.id, { chartPresets: 1 }).lean();
    if (!user) throw new HttpError(401, 'User account not found.');
    res.status(200).json({ success: true, presets: user.chartPresets || [] });
}

// PUT /portfolio/chart-presets  { presets: [{ id, name, schemeCodes, metric, mode }] }
async function saveChartPresets(req, res) {
    const body = readBody(req);

    if (!Array.isArray(body.presets) || body.presets.length > MAX_PRESETS) {
        throw new HttpError(400, `presets must be a list of at most ${MAX_PRESETS} saved charts.`);
    }

    const presets = body.presets.map(preset => {
        const name = typeof preset?.name === 'string' ? preset.name.trim() : '';
        if (!name || name.length > 40) throw new HttpError(400, 'Each saved chart needs a name of up to 40 characters.');
        if (!PRESET_METRICS.includes(preset.metric)) throw new HttpError(400, `metric must be one of: ${PRESET_METRICS.join(', ')}.`);
        if (!PRESET_MODES.includes(preset.mode)) throw new HttpError(400, `mode must be one of: ${PRESET_MODES.join(', ')}.`);
        if (!Array.isArray(preset.schemeCodes) || preset.schemeCodes.length > 20) throw new HttpError(400, 'Each saved chart can include at most 20 funds.');

        return {
            id: typeof preset.id === 'string' && preset.id ? preset.id.slice(0, 40) : crypto.randomUUID(),
            name,
            schemeCodes: preset.schemeCodes.map(readSchemeCode),
            metric: preset.metric,
            mode: preset.mode
        };
    });

    // updateOne, not save(): presets shouldn't conflict with settings changes.
    await User.updateOne({ _id: req.user.id }, { $set: { chartPresets: presets } }, { runValidators: true });
    res.status(200).json({ success: true, presets });
}

// GET /portfolio
async function getPortfolio(req, res) {
    try {
        const result = await portfolio.buildPortfolio(req.user.id, getNow(req));
        res.status(200).json({ success: true, ...result });
    } catch (error) {
        if (error.upstream) {
            throw new HttpError(502, 'The NAV data service is unavailable. Please try again shortly.');
        }
        throw error;
    }
}

module.exports = {
    searchFunds,
    getFund,
    previewInvestment,
    createInvestment,
    updateInvestment,
    deleteInvestment,
    getHolding,
    deleteHolding,
    getInvestment,
    getFundSeries,
    getHarvest,
    getChartPresets,
    saveChartPresets,
    getPortfolio
};
