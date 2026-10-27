// Portfolio analytics built on the user's funds: look-through overlap, the
// forecast, the health score and the alerts. Each request loads the funds
// once (NAV histories come from navStore's cache), and the pure calculations
// live in utils/. Daily snapshots (models/PortfolioSnapshot) record the
// health score, concentration and goal odds so later days can explain what
// changed and alerts can wait until a condition has lasted.

const Alert = require("../models/Alert");
const Goal = require("../models/Goal");
const User = require("../models/User");
const PortfolioSnapshot = require("../models/PortfolioSnapshot");
const navStore = require("./navStore");
const fundPortfolios = require("./fundPortfolios");
const { loadFunds } = require("./portfolio");
const { evaluateGoals } = require("./goals");
const { lookThrough, diversificationImpact } = require("../utils/lookThrough");
const { returnCorrelations, correlationLabel, correlationOf, blendedMonthlyReturns, annualVolatility, worstTwelveMonths } = require("../utils/returnStats");
const { monthlyReturns } = require("../utils/mfPlanning");
const { projectPortfolio, missRateOf } = require("../utils/projection");
const { healthScore, explainChange, snapshotOf, MIN_COVERAGE } = require("../utils/healthScore");
const { detectAlerts, planAlertChanges } = require("../utils/alerts");
const { addDays } = require("../utils/time");

// Alerts are re-checked on a visit if the last check is older than this.
const ALERT_REFRESH_MS = 6 * 60 * 60 * 1000;
// A month speaks for the portfolio only if funds holding half its value existed then.
const OWN_HISTORY_COVERAGE = 0.5;
const pct = (value, digits = 0) => `${(value * 100).toFixed(digits)}%`;
const inr = value => `₹${Math.round(value).toLocaleString("en-IN")}`;

async function loadContext(userId, now) {
    const today = navStore.marketToday(now);
    const benchmark = await navStore.getBenchmark();
    const funds = await loadFunds(userId, today, benchmark);
    const portfolios = await fundPortfolios.latestPortfolios(funds.map(fund => fund.holding.schemeCode));
    return { userId, now, today, benchmark, funds, portfolios };
}

/* ---------- Overlap ---------- */

function overlapParts(ctx) {
    const live = ctx.funds.filter(fund => fund.holding.value > 0);
    const look = lookThrough(
        live.map(fund => ({ schemeCode: fund.holding.schemeCode, shortName: fund.holding.shortName, value: fund.holding.value, portfolio: ctx.portfolios.get(fund.holding.schemeCode) || null })),
        { today: ctx.today }
    );
    const correlations = returnCorrelations(live.map(fund => ({ schemeCode: fund.holding.schemeCode, shortName: fund.holding.shortName, series: fund.history.series })), ctx.today)
        .map(pair => ({ ...pair, label: correlationLabel(pair.correlation) }));
    return { look, correlations };
}

// The plain-language findings, most important first.
function overlapSummary(look, correlations) {
    const lines = [];
    const known = look.coverage.share >= MIN_COVERAGE;

    if (look.coverage.value > 0) {
        if (look.commonCount > 0) {
            lines.push(`${look.commonCount} ${look.commonCount === 1 ? "company is" : "companies are"} held through more than one of your funds; together ${pct(look.commonShare)} of what you own.`);
            const top = look.common[0];
            lines.push(`Largest: ${top.name}, ${inr(top.amount)} through ${top.funds.length} funds (${pct(top.share, 1)} of what you own).`);
        } else {
            lines.push("No company is held through more than one of your funds.");
        }
        for (const sector of look.sectors.filter(item => item.duplicated).slice(0, 2)) {
            lines.push(`${sector.sector} is a large part of ${sector.heavyFunds} of your funds: ${pct(sector.share)} of your equity in total.`);
        }
        const pair = look.pairs[0];
        if (pair && pair.overlap >= 0.3) {
            lines.push(`${pair.a.shortName} and ${pair.b.shortName} are ${pct(pair.overlap)} the same: adding to one is much like adding to the other.`);
        }
    }

    const alike = correlations.find(pair => pair.correlation !== null && pair.correlation >= 0.9);
    if (alike && !known) {
        lines.push(`${alike.a.shortName} and ${alike.b.shortName} ${alike.label} (correlation ${alike.correlation.toFixed(2)} over ${alike.months} months), a sign they own similar companies.`);
    }
    // Missing holdings are listed in `coverage`, which the page shows on its own.
    return lines;
}

async function buildOverlap(userId, now) {
    const ctx = await loadContext(userId, now);
    const { look, correlations } = overlapParts(ctx);
    return {
        asOf: ctx.today,
        method: look.coverage.share >= MIN_COVERAGE ? "holdings" : look.coverage.value > 0 ? "partial" : "returns",
        summary: overlapSummary(look, correlations),
        ...look,
        correlations
    };
}

// Would adding `schemeCode` with `amount` spread the money wider?
async function buildCandidate(userId, now, schemeCode, amount) {
    const ctx = await loadContext(userId, now);
    const history = await navStore.getHistory(schemeCode);
    const shortName = String(history.meta?.schemeName || `Scheme ${schemeCode}`).split(/\s+-\s+/)[0].trim();
    const live = ctx.funds.filter(fund => fund.holding.value > 0);
    const held = live.some(fund => fund.holding.schemeCode === schemeCode);
    const value = amount ?? (live.length ? live.reduce((sum, fund) => sum + fund.holding.value, 0) / live.length : 10000);
    const [candidatePortfolio] = [...(await fundPortfolios.latestPortfolios([schemeCode])).values()];

    const base = { schemeCode, shortName, amount: Math.round(value), alreadyHeld: held };
    if (!live.length) {
        return { ...base, method: "none", verdict: "improves", reasons: ["You don't hold any funds yet, so any fund adds diversification."] };
    }

    const impact = diversificationImpact(
        live.map(fund => ({ schemeCode: fund.holding.schemeCode, shortName: fund.holding.shortName, value: fund.holding.value, portfolio: ctx.portfolios.get(fund.holding.schemeCode) || null })),
        { schemeCode, shortName, value, portfolio: candidatePortfolio || null }
    );
    if (impact) return { ...base, ...impact };

    // No holdings to compare: fall back to how its returns move with yours.
    const yours = blendedMonthlyReturns(live.map(fund => ({ series: fund.history.series, value: fund.holding.value })), ctx.today, { minCoverage: OWN_HISTORY_COVERAGE });
    const { correlation, months } = correlationOf(monthlyReturns(history.series, ctx.today), yours);
    if (correlation === null) {
        return { ...base, method: "returns", verdict: "unknown", correlation: null, reasons: ["There isn't 2 years of shared history to compare this fund with your portfolio, and its holdings aren't available."] };
    }
    const verdict = correlation >= 0.95 ? "duplicates" : correlation >= 0.85 ? "marginal" : "improves";
    return {
        ...base,
        method: "returns",
        verdict,
        correlation,
        months,
        reasons: [
            `Over the last ${months} months its monthly returns had a correlation of ${correlation.toFixed(2)} with your portfolio's (1 means they move identically).`,
            verdict === "duplicates"
                ? "It has moved almost exactly like what you already own, so it would add little diversification."
                : verdict === "marginal"
                    ? "It has moved much like what you already own; it would add some, but not much, diversification."
                    : "It has moved differently enough from what you own to add diversification.",
            "Holdings aren't available for this comparison, so this is based on returns, not on the companies owned."
        ]
    };
}

/* ---------- Forecast ---------- */

async function buildProjection(userId, now, extraMonthly = 0) {
    const ctx = await loadContext(userId, now);
    const funds = ctx.funds
        .filter(fund => fund.holding.value > 0 || fund.holding.activeSipCount > 0)
        .map(fund => ({ fund, misses: missRateOf(fund.holding.installments, ctx.today) }))
        .map(({ fund, misses }) => ({
            schemeCode: fund.holding.schemeCode,
            shortName: fund.holding.shortName,
            series: fund.history.series,
            value: fund.holding.value,
            investments: fund.views.map(view => ({
                kind: view.kind,
                amount: view.amount,
                sipDay: view.sipDay,
                startDate: view.startDate,
                endDate: view.endDate,
                stepUpPercent: view.stepUpPercent,
                isActive: !view.stopped
            })),
            missRate: misses.rate,
            missHistory: misses
        }));

    const projection = projectPortfolio({
        funds,
        benchmark: ctx.benchmark?.series,
        today: ctx.today,
        extraMonthly,
        // Stable through the day, so moving the slider only changes the SIP.
        seed: `${userId}:${ctx.today}`
    });
    if (!projection) return { asOf: ctx.today, projection: null, reason: funds.length ? "Not enough market history to replay." : "Add a fund to see a forecast." };

    // Missed-installment history, for the assumptions list.
    projection.assumptions.funds = projection.assumptions.funds.map((item, i) => ({ ...item, missed: funds[i].missHistory.missed, scheduled: funds[i].missHistory.scheduled }));
    return { asOf: ctx.today, benchmarkName: ctx.benchmark?.meta?.schemeName || null, projection };
}

/* ---------- Health ---------- */

async function loadProfile(userId) {
    const user = await User.findById(userId, { investmentProfile: 1 }).lean();
    return user?.investmentProfile || null;
}

function concentrationOf(ctx, look) {
    const live = ctx.funds.filter(fund => fund.holding.value > 0);
    const total = live.reduce((sum, fund) => sum + fund.holding.value, 0);
    const largest = [...live].sort((a, b) => b.holding.value - a.holding.value)[0];
    const known = look.coverage.share >= MIN_COVERAGE;
    const pair = look.pairs[0];
    return {
        largestFund: largest && total ? { schemeCode: largest.holding.schemeCode, shortName: largest.holding.shortName, share: largest.holding.value / total } : null,
        topCompany: known && look.concentration.largest ? { name: look.concentration.largest.name, share: look.concentration.largest.share } : null,
        topPair: known && pair ? { a: pair.a.shortName, b: pair.b.shortName, overlap: pair.overlap } : null
    };
}

async function healthParts(ctx) {
    const { look, correlations } = overlapParts(ctx);
    const [profile, goals] = await Promise.all([
        loadProfile(ctx.userId),
        Goal.find({ userId: ctx.userId, targetDate: { $gt: ctx.today } }, { targetDate: 1 }).sort({ targetDate: 1 }).limit(1).lean()
    ]);
    const nearestGoalYears = goals[0] ? (Date.parse(goals[0].targetDate) - Date.parse(ctx.today)) / (365.25 * 86400000) : null;
    const live = ctx.funds.filter(fund => fund.holding.value > 0);
    const blended = blendedMonthlyReturns(live.map(fund => ({ series: fund.history.series, value: fund.holding.value })), ctx.today, { minCoverage: OWN_HISTORY_COVERAGE });

    const health = healthScore({
        holdings: ctx.funds.map(fund => ({ ...fund.holding, expenseRatio: ctx.portfolios.get(fund.holding.schemeCode)?.expenseRatio ?? null })),
        lookThrough: look,
        correlations,
        profile,
        nearestGoalYears,
        volatility: annualVolatility(blended),
        // One 12-month window out of a short history says little.
        worstYear: blended.size >= 24 ? worstTwelveMonths(blended) : null
    });
    return { health, look, concentration: concentrationOf(ctx, look) };
}

async function saveSnapshot(userId, date, fields) {
    await PortfolioSnapshot.updateOne({ userId, date }, { $set: fields, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
}

async function buildHealth(userId, now) {
    const ctx = await loadContext(userId, now);
    const { health, concentration } = await healthParts(ctx);
    if (!health) return { asOf: ctx.today, health: null, changes: null };

    const [last, month] = await Promise.all([
        PortfolioSnapshot.findOne({ userId, date: { $lt: ctx.today }, health: { $ne: null } }).sort({ date: -1 }).lean(),
        PortfolioSnapshot.findOne({ userId, date: { $lte: addDays(ctx.today, -28) }, health: { $ne: null } }).sort({ date: -1 }).lean()
    ]);
    await saveSnapshot(userId, ctx.today, { health: snapshotOf(health), concentration });

    const change = snapshot => (snapshot ? { date: snapshot.date, ...explainChange(snapshot.health, health) } : null);
    return {
        asOf: ctx.today,
        health,
        changes: { sinceLast: change(last), sinceMonth: change(month) }
    };
}

/* ---------- Snapshots and alerts ---------- */

// Today's full snapshot (health, concentration, goal odds) and the alerts it
// implies. Returns the user's open alerts that haven't been emailed yet.
async function refreshAlerts(userId, now) {
    const ctx = await loadContext(userId, now);
    const { health, concentration } = await healthParts(ctx);
    const savedGoals = await Goal.find({ userId }).lean();
    const goals = await evaluateGoals(userId, savedGoals, now, { funds: ctx.funds, benchmark: ctx.benchmark });

    await saveSnapshot(userId, ctx.today, {
        health: snapshotOf(health),
        concentration,
        goals: goals.filter(goal => goal.watch).map(goal => ({ goalId: goal.id, probability: goal.watch.probability, status: goal.watch.status }))
    });

    const [snapshots, existing] = await Promise.all([
        PortfolioSnapshot.find({ userId, date: { $gte: addDays(ctx.today, -35) } }, { date: 1, concentration: 1 }).sort({ date: 1 }).lean(),
        Alert.find({ userId }, { key: 1, status: 1, dismissedAt: 1 }).lean()
    ]);
    const active = detectAlerts({
        today: ctx.today,
        funds: ctx.funds.map(fund => ({
            schemeCode: fund.holding.schemeCode,
            shortName: fund.holding.shortName,
            equityTaxed: fund.holding.equityTaxed,
            series: fund.history.series,
            value: fund.holding.value,
            installments: fund.holding.installments,
            investments: fund.views.map(view => ({ id: view.id, kind: view.kind, isActive: !view.stopped }))
        })),
        benchmark: ctx.benchmark?.series,
        snapshots,
        goals,
        openKeys: new Set(existing.filter(item => item.status === "open").map(item => item.key))
    });

    const plan = planAlertChanges(existing, active, now.getTime());
    const content = alert => ({
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
        why: alert.why,
        period: alert.period,
        evidence: alert.evidence,
        investigate: alert.investigate,
        subject: alert.subject,
        link: alert.link,
        lastSeenAt: now
    });

    await Promise.all([
        // $setOnInsert: a second instance creating the same alert is harmless.
        ...plan.create.map(alert => Alert.updateOne(
            { userId, key: alert.key },
            { $set: content(alert), $setOnInsert: { status: "open", firstSeenAt: now } },
            { upsert: true }
        )),
        ...plan.update.map(alert => Alert.updateOne({ userId, key: alert.key, status: "open" }, { $set: content(alert) })),
        ...plan.reopen.map(alert => Alert.updateOne(
            { userId, key: alert.key },
            { $set: { ...content(alert), status: "open", firstSeenAt: now, resolvedAt: null, dismissedAt: null, notifiedAt: null } }
        )),
        ...plan.resolve.map(key => Alert.updateOne({ userId, key, status: "open" }, { $set: { status: "resolved", resolvedAt: now } }))
    ]);
    await saveSnapshot(userId, ctx.today, { alertsCheckedAt: now });

    return Alert.find({ userId, status: "open", notifiedAt: null }).lean();
}

// Refreshes the alerts when the last check is stale (the daily job normally
// keeps them current), then lists them.
async function listAlerts(userId, now, { includeClosed = false } = {}) {
    const today = navStore.marketToday(now);
    const snapshot = await PortfolioSnapshot.findOne({ userId, date: today }, { alertsCheckedAt: 1 }).lean();
    if (!snapshot?.alertsCheckedAt || now - snapshot.alertsCheckedAt > ALERT_REFRESH_MS) {
        await refreshAlerts(userId, now);
    }

    const filter = includeClosed ? { userId } : { userId, status: "open" };
    const alerts = await Alert.find(filter).sort({ status: 1, severity: -1, lastSeenAt: -1 }).limit(50).lean();
    return alerts.map(alertView);
}

function alertView(alert) {
    return {
        id: String(alert._id),
        key: alert.key,
        type: alert.type,
        severity: alert.severity,
        status: alert.status,
        title: alert.title,
        why: alert.why,
        period: alert.period,
        evidence: alert.evidence,
        investigate: alert.investigate,
        subject: alert.subject,
        link: alert.link,
        firstSeenAt: alert.firstSeenAt,
        lastSeenAt: alert.lastSeenAt,
        resolvedAt: alert.resolvedAt,
        dismissedAt: alert.dismissedAt
    };
}

// Records today's goal odds after a goals page load, so their trend builds
// up even on days the daily job doesn't run.
async function recordGoals(userId, now, goals) {
    const items = goals.filter(goal => goal.id && goal.watch).map(goal => ({ goalId: goal.id, probability: goal.watch.probability, status: goal.watch.status }));
    if (items.length) await saveSnapshot(userId, navStore.marketToday(now), { goals: items });
}

module.exports = {
    buildOverlap,
    buildCandidate,
    buildProjection,
    buildHealth,
    refreshAlerts,
    listAlerts,
    alertView,
    recordGoals
};
