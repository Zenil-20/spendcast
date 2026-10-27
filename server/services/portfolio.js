// Builds holdings, the portfolio view and its analysis from investments and
// NAV histories. Everything here is factual (what happened, what it's worth,
// what tax would apply); nothing recommends buying or selling.

const Investment = require("../models/Investment");
const navStore = require("./navStore");
const { addDays } = require("../utils/time");
const {
    round,
    buildInstallments,
    nextInstallment,
    summarizeHolding,
    xirr,
    trailingReturn,
    riskMetrics,
    priceContext,
    portfolioTimeline,
    recentHolidays,
    downsample,
    isWeekend,
    benchmarkComparison,
    entrySignal,
    isEquityTaxed,
    taxLots,
    estimateEquityTax,
    TAX
} = require("../utils/mfMath");
const { harvestPlan, sipDateStudy } = require("../utils/mfPlanning");

const RISK_FREE_RATE = Number(process.env.MF_RISK_FREE_RATE || 0.065);
const RETURN_PERIODS = [
    { key: "1M", months: 1 },
    { key: "3M", months: 3 },
    { key: "6M", months: 6 },
    { key: "1Y", months: 12 },
    { key: "3Y", months: 36 },
    { key: "5Y", months: 60 }
];
// A fund trailing the benchmark by more than this (per year) is flagged.
const LAG_THRESHOLD = 0.02;
// One holding above this share of the portfolio is flagged as concentrated.
const CONCENTRATION_THRESHOLD = 0.5;

// "Equity Scheme - Flexi Cap Fund" -> { assetClass: "Equity", category: "Flexi Cap Fund" }
function splitCategory(schemeCategory) {
    if (!schemeCategory) return { assetClass: "Other", category: "Uncategorised" };
    const [left, ...rest] = schemeCategory.split(" - ");
    const assetClass = left.replace(/\s*Scheme(s)?$/i, "").trim() || "Other";
    return { assetClass, category: rest.join(" - ").trim() || left.trim() };
}

// "Parag Parikh Flexi Cap Fund - Direct Plan - Growth" -> name, plan and option.
function splitName(schemeName) {
    const parts = String(schemeName || "").split(/\s+-\s+/);
    const text = schemeName.toLowerCase();
    return {
        shortName: parts[0].trim(),
        plan: /\bdirect\b/.test(text) ? "Direct" : /\bregular\b/.test(text) ? "Regular" : null,
        option: /\b(idcw|dividend)\b/.test(text) ? "IDCW" : /\bgrowth\b/.test(text) ? "Growth" : null
    };
}

function trailingReturns(series) {
    const returns = {};
    RETURN_PERIODS.forEach(({ key, months }) => { returns[key] = series ? trailingReturn(series, months) : null; });
    return returns;
}

// One SIP or one-time purchase, with its installments worked out from NAVs.
function investmentView(investment, history, today) {
    const id = String(investment._id);
    const installments = buildInstallments(investment, history.series, today)
        .map(item => ({ ...item, investmentId: id, source: investment.kind }));
    const summary = summarizeHolding(installments, history.series);
    const latest = summary.latestNav;
    const stopped = investment.kind === "sip" && (!investment.isActive || (investment.endDate && investment.endDate < today));
    const next = stopped ? null : nextInstallment(investment, today);

    return {
        id,
        kind: investment.kind,
        amount: investment.amount,
        sipDay: investment.sipDay,
        startDate: investment.startDate,
        endDate: investment.endDate,
        stepUpPercent: investment.stepUpPercent || 0,
        stopped: !!stopped,
        invested: summary.invested,
        units: summary.units,
        installmentsAllotted: summary.installmentsAllotted,
        notDebited: installments.filter(item => item.status === "skipped").length,
        next: next && latest
            ? { ...next, estimatedUnits: round(next.amount / latest.nav, 3), atNav: latest.nav, atNavDate: latest.date }
            : next,
        installments
    };
}

// Everything held in one fund - its SIPs and one-time purchases - as a single
// holding: total units, average cost, one XIRR and one set of tax lots.
function fundHolding(schemeCode, views, history, benchmark, fallbackName) {
    const installments = views
        .flatMap(view => view.installments)
        .sort((a, b) => (a.navDate || a.dueDate).localeCompare(b.navDate || b.dueDate));
    const summary = summarizeHolding(installments, history.series);
    const name = history.meta?.schemeName || fallbackName;
    const equity = isEquityTaxed({ ...history.meta, schemeName: name });
    const activeSips = views.filter(view => view.kind === "sip" && !view.stopped);
    const nextDebits = activeSips.map(view => view.next).filter(Boolean).sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    return {
        id: String(schemeCode),
        schemeCode,
        schemeName: name,
        ...splitName(name),
        fundHouse: history.meta?.fundHouse || null,
        ...splitCategory(history.meta?.schemeCategory),
        ...summary,
        awaitingNav: installments.filter(item => item.status === "awaiting_nav").length,
        notDebited: installments.filter(item => item.status === "skipped").length,
        monthlySip: round(activeSips.reduce((sum, view) => sum + (view.next?.amount ?? view.amount), 0), 2),
        activeSipCount: activeSips.length,
        purchaseCount: views.filter(view => view.kind === "lumpsum").length,
        next: nextDebits[0] || null,
        investments: views.map(({ installments: _installments, ...rest }) => rest),
        equityTaxed: equity,
        // ELSS units can't be sold for 3 years from purchase.
        lockInYears: /elss/i.test(history.meta?.schemeCategory || "") ? 3 : 0,
        tax: taxLots(installments, summary.latestNav, equity),
        entry: (() => {
            const signal = entrySignal(history.series);
            return signal ? { zone: signal.zone, percentile: signal.percentile } : null;
        })(),
        fundReturn1Y: trailingReturn(history.series, 12),
        fundReturn3Y: trailingReturn(history.series, 36),
        benchmarkReturn1Y: benchmark ? trailingReturn(benchmark.series, 12) : null,
        benchmarkReturn3Y: benchmark ? trailingReturn(benchmark.series, 36) : null,
        installments
    };
}

// The user's investments grouped into one holding per fund.
async function loadFunds(userId, today, benchmark, schemeCode = null) {
    const investments = await Investment.find(schemeCode ? { userId, schemeCode } : { userId }).sort({ createdAt: 1 }).lean();
    const groups = new Map();

    investments.forEach(investment => {
        groups.set(investment.schemeCode, [...(groups.get(investment.schemeCode) || []), investment]);
    });

    return Promise.all([...groups.entries()].map(async ([code, list]) => {
        const history = await navStore.getHistory(code);
        const views = list.map(investment => investmentView(investment, history, today));

        return {
            holding: fundHolding(code, views, history, benchmark, list[0].schemeName),
            views,
            history
        };
    }));
}

function groupTotals(holdings, key) {
    const groups = new Map();

    holdings.forEach(holding => {
        const name = holding[key] || "Other";
        const entry = groups.get(name) || { name, value: 0, invested: 0, count: 0 };
        entry.value += holding.value;
        entry.invested += holding.invested;
        entry.count += 1;
        groups.set(name, entry);
    });

    const total = holdings.reduce((sum, holding) => sum + holding.value, 0);

    return [...groups.values()]
        .map(entry => ({ ...entry, value: round(entry.value, 2), invested: round(entry.invested, 2), share: total ? entry.value / total : 0 }))
        .sort((a, b) => b.value - a.value);
}

function taxSummary(holdings) {
    const longTermGain = round(holdings.reduce((sum, h) => sum + h.tax.longTermGain, 0), 2);
    const shortTermGain = round(holdings.reduce((sum, h) => sum + h.tax.shortTermGain, 0), 2);
    const slabGain = round(holdings.reduce((sum, h) => sum + h.tax.slabGain, 0), 2);
    const turning = holdings
        .filter(h => h.tax.turningLongTerm.gain !== 0)
        .map(h => ({ id: h.id, shortName: h.shortName, ...h.tax.turningLongTerm }))
        .sort((a, b) => a.firstDate.localeCompare(b.firstDate));

    return {
        longTermGain,
        shortTermGain,
        slabGain,
        estimate: estimateEquityTax(longTermGain, shortTermGain),
        exemption: TAX.longTermExemption,
        rates: { longTerm: TAX.equityLongTermRate, shortTerm: TAX.equityShortTermRate, cess: TAX.cess },
        turningLongTerm: turning,
        turningLongTermGain: round(turning.reduce((sum, item) => sum + item.gain, 0), 2)
    };
}

function sipSummary(funds, today) {
    const sips = funds.flatMap(fund => fund.views
        .filter(view => view.kind === "sip")
        .map(view => ({ ...view, fundId: fund.holding.id, shortName: fund.holding.shortName, schemeName: fund.holding.schemeName })));
    const active = sips.filter(sip => !sip.stopped);
    const monthEnd = `${today.slice(0, 8)}31`;
    const weekAhead = addDays(today, 7);

    return {
        monthlyTotal: round(active.reduce((sum, sip) => sum + (sip.next?.amount ?? sip.amount), 0), 2),
        remainingThisMonth: round(active.filter(sip => sip.next && sip.next.dueDate <= monthEnd).reduce((sum, sip) => sum + sip.next.amount, 0), 2),
        nextWeekTotal: round(active.filter(sip => sip.next && sip.next.dueDate <= weekAhead).reduce((sum, sip) => sum + sip.next.amount, 0), 2),
        active: active
            .map(sip => ({
                id: sip.fundId,
                investmentId: sip.id,
                shortName: sip.shortName,
                schemeName: sip.schemeName,
                amount: sip.next?.amount ?? sip.amount,
                baseAmount: sip.amount,
                sipDay: sip.sipDay,
                stepUpPercent: sip.stepUpPercent,
                startDate: sip.startDate,
                installmentsAllotted: sip.installmentsAllotted,
                invested: sip.invested,
                next: sip.next
            }))
            .sort((a, b) => (a.next?.dueDate || "9").localeCompare(b.next?.dueDate || "9")),
        stopped: sips.filter(sip => sip.stopped).map(sip => ({
            id: sip.fundId,
            investmentId: sip.id,
            shortName: sip.shortName,
            amount: sip.amount,
            sipDay: sip.sipDay,
            startDate: sip.startDate,
            endDate: sip.endDate,
            installmentsAllotted: sip.installmentsAllotted,
            invested: sip.invested
        }))
    };
}

// Why the portfolio moved on the latest trading day: each fund's share of the
// change. Money added that day isn't a gain, so it's reported separately; a
// fund whose NAV for that day isn't out yet is listed as pending.
function todayMove(holdings, benchmark, asOf) {
    if (!asOf) return null;

    let previousValue = 0;
    let newMoney = 0;
    const movers = [];
    const pending = [];

    for (const holding of holdings) {
        if (!holding.latestNav || holding.units <= 0) continue;
        if (holding.latestNav.date !== asOf || holding.dayChangePercent === null) {
            pending.push(holding.shortName);
            continue;
        }

        const boughtToday = holding.installments.filter(item => item.status === "allotted" && item.navDate === asOf);
        const newUnits = boughtToday.reduce((sum, item) => sum + item.units, 0);
        newMoney += boughtToday.reduce((sum, item) => sum + item.amount, 0);
        previousValue += (holding.units - newUnits) * holding.latestNav.nav - holding.dayChange;
        movers.push({ id: holding.id, shortName: holding.shortName, change: holding.dayChange, percent: holding.dayChangePercent });
    }

    if (!movers.length) return null;

    const change = round(movers.reduce((sum, item) => sum + item.change, 0), 2);
    const series = benchmark?.series;
    const count = series?.dates.length || 0;
    const benchmarkPercent = count > 1 && series.dates[count - 1] === asOf ? series.values[count - 1] / series.values[count - 2] - 1 : null;

    return {
        date: asOf,
        change,
        percent: previousValue > 0 ? change / previousValue : null,
        benchmarkPercent,
        newMoney: round(newMoney, 2),
        movers: movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)),
        pending
    };
}

// The yearly tax-free gains harvest for the user's equity funds.
function buildHarvest(holdings, today, alreadyBooked = 0) {
    return harvestPlan(holdings, today, { alreadyBooked });
}

// The few facts that matter most, most important first.
function buildInsights({ holdings, totals, tax, sips, harvest, today }) {
    const insights = [];
    const inr = value => `₹${Math.round(Math.abs(value)).toLocaleString("en-IN")}`;
    const pct = value => `${(Math.abs(value) * 100).toFixed(1)}%`;

    // The market comparison has its own card, so it isn't repeated here.

    // The exemption resets on 1 April and can't be carried forward, so this
    // matters most in the last quarter of the financial year.
    if (harvest && harvest.gainBooked > 0 && today.slice(5, 7) <= "03") {
        insights.push({
            id: "harvest",
            tone: "positive",
            title: `Book ${inr(harvest.gainBooked)} of gains tax-free before 31 March`,
            detail: `Selling and buying back these units uses this year's ₹1.25 lakh exemption, which doesn't carry forward. It avoids about ${inr(harvest.taxAvoided)} of tax later. See Planning → Tax.`
        });
    }

    if (tax.turningLongTermGain > 0 && tax.turningLongTerm.length) {
        const first = tax.turningLongTerm[0];
        insights.push({
            id: "long-term",
            tone: "info",
            title: `${inr(tax.turningLongTermGain)} of gains turn long-term within 30 days`,
            detail: `From ${first.firstDate} onwards these units are taxed at ${TAX.equityLongTermRate * 100}% instead of ${TAX.equityShortTermRate * 100}% if sold.`
        });
    }

    const largest = [...holdings].sort((a, b) => b.value - a.value)[0];
    if (holdings.length > 1 && largest && totals.value > 0 && largest.value / totals.value > CONCENTRATION_THRESHOLD) {
        insights.push({
            id: "concentration",
            tone: "attention",
            title: `${largest.shortName} is ${pct(largest.value / totals.value)} of your portfolio`,
            detail: "Most of your money depends on a single fund's performance."
        });
    }

    for (const holding of holdings) {
        if (!holding.equityTaxed) continue;
        const useThreeYear = holding.fundReturn3Y !== null && holding.benchmarkReturn3Y !== null;
        const fund = useThreeYear ? holding.fundReturn3Y : holding.fundReturn1Y;
        const index = useThreeYear ? holding.benchmarkReturn3Y : holding.benchmarkReturn1Y;

        if (fund !== null && index !== null && index - fund > LAG_THRESHOLD) {
            insights.push({
                id: `lag-${holding.id}`,
                tone: "attention",
                title: `${holding.shortName} trails the Nifty 50 by ${pct(index - fund)} a year`,
                detail: `${useThreeYear ? "Over 3 years" : "Over the last year"}: fund ${(fund * 100).toFixed(1)}% vs Nifty 50 ${(index * 100).toFixed(1)}%${useThreeYear ? " a year" : ""}.`
            });
        }
    }

    if (sips.nextWeekTotal > 0) {
        insights.push({
            id: "debits",
            tone: "info",
            title: `${inr(sips.nextWeekTotal)} in SIP debits in the next 7 days`,
            detail: "Keep the balance in your mandate account to avoid a bounced installment."
        });
    }

    return insights;
}

async function buildPortfolio(userId, now) {
    const today = navStore.marketToday(now);
    const benchmark = await navStore.getBenchmark();
    const funds = await loadFunds(userId, today, benchmark);
    const holdings = funds.map(fund => fund.holding);

    const invested = round(holdings.reduce((sum, h) => sum + h.invested, 0), 2);
    const value = round(holdings.reduce((sum, h) => sum + h.value, 0), 2);
    const dayChange = round(holdings.reduce((sum, h) => sum + h.dayChange, 0), 2);
    const allInstallments = holdings.flatMap(h => h.installments);
    const flows = allInstallments.filter(i => i.status === "allotted").map(i => ({ date: i.navDate, amount: -i.amount }));
    const latestDates = holdings.map(h => h.latestNav?.date).filter(Boolean).sort();
    const asOf = latestDates[latestDates.length - 1] || null;
    const firstDate = flows.map(flow => flow.date).sort()[0] || null;

    if (asOf && value > 0) flows.push({ date: asOf, amount: value });

    const totals = {
        invested,
        value,
        gain: round(value - invested, 2),
        absoluteReturn: invested ? value / invested - 1 : null,
        dayChange,
        dayChangePercent: value - dayChange > 0 ? dayChange / (value - dayChange) : null,
        xirr: xirr(flows),
        annualised: !!(firstDate && asOf && (Date.parse(asOf) - Date.parse(firstDate)) / 86400000 >= 365)
    };

    const market = benchmark && asOf ? benchmarkComparison(allInstallments, benchmark.series, asOf) : null;
    const tax = taxSummary(holdings);
    const sips = sipSummary(funds, today);
    const harvest = buildHarvest(holdings, today);
    const totalGain = holdings.reduce((sum, h) => sum + Math.abs(h.gain), 0);
    const calendar = benchmark?.series || funds[0]?.history.series;

    return {
        currency: "INR",
        today,
        asOf,
        totals,
        market: market && { ...market, difference: round(value - market.value, 2), benchmarkName: benchmark.meta?.schemeName || null },
        tax,
        sips,
        insights: buildInsights({ holdings, totals, tax, sips, harvest, today }),
        todayMove: todayMove(holdings, benchmark, asOf),
        harvest,
        contribution: holdings
            .map(h => ({ id: h.id, shortName: h.shortName, gain: h.gain, share: totalGain ? Math.abs(h.gain) / totalGain : 0 }))
            .sort((a, b) => b.gain - a.gain),
        calendar: calendar
            ? {
                lastTradingDay: calendar.dates[calendar.dates.length - 1],
                todayIsWeekend: isWeekend(today),
                recentHolidays: recentHolidays(calendar, 45)
            }
            : null,
        allocation: {
            byAssetClass: groupTotals(holdings, "assetClass"),
            byCategory: groupTotals(holdings, "category"),
            byFundHouse: groupTotals(holdings, "fundHouse")
        },
        timeline: portfolioTimeline(funds.map(fund => ({ installments: fund.holding.installments, series: fund.history.series }))),
        holdings: holdings.map(({ installments, ...rest }) => rest)
    };
}

const RANGES = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "3Y": 1096, "5Y": 1827 };

function navChart(series, range) {
    const days = RANGES[range];
    const last = series.dates[series.dates.length - 1];
    let from = 0;

    if (days && last) {
        const cutoff = addDays(last, -days);
        from = Math.max(0, series.dates.findIndex(date => date >= cutoff));
    }

    return downsample({ dates: series.dates.slice(from), values: series.values.slice(from) }, 400);
}

function fundMetrics(series, benchmark) {
    return {
        returns: trailingReturns(series),
        benchmarkReturns: trailingReturns(benchmark?.series),
        risk: riskMetrics(series, { riskFreeRate: RISK_FREE_RATE, benchmark: benchmark?.series }),
        price: priceContext(series),
        entry: entrySignal(series),
        sipDates: sipDateStudy(series)
    };
}

// The tax-free harvest plan for the user, given gains already booked this year.
async function buildHarvestPlan(userId, now, alreadyBooked = 0) {
    const today = navStore.marketToday(now);
    const funds = await loadFunds(userId, today, null);
    return { currency: "INR", today, ...buildHarvest(funds.map(fund => fund.holding), today, alreadyBooked) };
}

// One fund's combined holding: all its SIPs and one-time purchases.
async function buildHoldingDetail(userId, schemeCode, now, { range = "1Y" } = {}) {
    const today = navStore.marketToday(now);
    const benchmark = await navStore.getBenchmark();
    const [fund] = await loadFunds(userId, today, benchmark, schemeCode);
    if (!fund) return null;

    const { holding, history } = fund;
    const market = benchmark && holding.latestNav
        ? benchmarkComparison(holding.installments, benchmark.series, holding.latestNav.date)
        : null;

    return {
        currency: "INR",
        today,
        holding: { ...holding, installments: [...holding.installments].reverse() },
        meta: history.meta,
        metrics: fundMetrics(history.series, benchmark),
        market: market && { ...market, difference: round(holding.value - market.value, 2) },
        taxEstimate: holding.equityTaxed ? estimateEquityTax(holding.tax.longTermGain, holding.tax.shortTermGain) : null,
        chart: navChart(history.series, range),
        benchmarkChart: benchmark ? navChart(benchmark.series, range) : [],
        benchmarkName: benchmark?.meta?.schemeName || null
    };
}

async function buildSchemeDetail(schemeCode, { range = "1Y" } = {}) {
    const [history, benchmark] = await Promise.all([navStore.getHistory(schemeCode), navStore.getBenchmark()]);
    const count = history.series.dates.length;

    return {
        schemeCode,
        meta: history.meta,
        ...splitCategory(history.meta?.schemeCategory),
        latestNav: count ? { date: history.series.dates[count - 1], nav: history.series.values[count - 1] } : null,
        firstNavDate: count ? history.series.dates[0] : null,
        metrics: fundMetrics(history.series, benchmark),
        chart: navChart(history.series, range),
        benchmarkChart: benchmark ? navChart(benchmark.series, range) : [],
        benchmarkName: benchmark?.meta?.schemeName || null
    };
}

// What a proposed investment would look like, without saving it.
async function previewInvestment(input, now) {
    const today = navStore.marketToday(now);
    const history = await navStore.getHistory(input.schemeCode);
    const view = investmentView({ ...input, _id: "preview", isActive: true }, history, today);
    const { installments } = view;

    return {
        currency: "INR",
        kind: input.kind,
        ...summarizeHolding(installments, history.series),
        awaitingNav: installments.filter(item => item.status === "awaiting_nav").length,
        next: view.next,
        shiftedCount: installments.filter(item => item.shifted).length,
        firstAllotment: installments.find(item => item.status === "allotted") || null,
        lastAllotment: [...installments].reverse().find(item => item.status === "allotted") || null
    };
}

// Daily value and invested amount for the chosen funds (all funds when none
// are chosen), each on its own and combined. Only the user's own holdings can
// be charted.
async function buildFundSeries(userId, now, schemeCodes = []) {
    const today = navStore.marketToday(now);
    const funds = await loadFunds(userId, today, null);
    const wanted = schemeCodes.length ? new Set(schemeCodes) : null;
    const chosen = funds.filter(fund => !wanted || wanted.has(fund.holding.schemeCode));

    return {
        currency: "INR",
        funds: chosen.map(fund => ({
            schemeCode: fund.holding.schemeCode,
            shortName: fund.holding.shortName,
            points: portfolioTimeline([{ installments: fund.holding.installments, series: fund.history.series }], 600)
        })),
        combined: portfolioTimeline(chosen.map(fund => ({ installments: fund.holding.installments, series: fund.history.series })), 600)
    };
}

module.exports = {
    loadFunds,
    buildHarvestPlan,
    buildFundSeries,
    RANGES,
    splitCategory,
    buildPortfolio,
    buildHoldingDetail,
    buildSchemeDetail,
    previewInvestment
};
