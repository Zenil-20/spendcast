// Mutual fund calculations: SIP allotment, holdings, returns and risk metrics.
// Pure functions with no database or network access. Dates are Indian market
// calendar dates as "YYYY-MM-DD" strings.
//
// A NAV series is { dates: string[], values: number[] }, sorted oldest first.
// NAVs are only published on days the market is open, so the series itself is
// the trading calendar: a date missing from it was a weekend or a holiday.

const { getDaysInMonth, toDateString, parseDateString, addDays } = require("./time");

// Stamp duty of 0.005% on mutual fund purchases, in force from 1 July 2020.
// It is deducted from the amount invested: net = amount / 1.00005.
const STAMP_DUTY_RATE = 0.00005;
const STAMP_DUTY_FROM = "2020-07-01";
const TRADING_DAYS_PER_YEAR = 252;
const DAY_MS = 24 * 60 * 60 * 1000;

function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(Number((value * factor).toPrecision(15))) / factor;
}

/* ---------- Dates and series lookups ---------- */

// "23-10-2026" (mfapi format) -> "2026-10-23"
function fromApiDate(value) {
    const [day, month, year] = value.split("-");
    return `${year}-${month}-${day}`;
}

function daysBetween(from, to) {
    return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
}

function addMonths(dateString, months) {
    const { year, month } = parseDateString(dateString);
    const index = year * 12 + (month - 1) + months;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function isWeekend(dateString) {
    const day = new Date(`${dateString}T00:00:00Z`).getUTCDay();
    return day === 0 || day === 6;
}

// Index of the first date >= target, or -1.
function indexOnOrAfter(series, target) {
    let low = 0;
    let high = series.dates.length;

    while (low < high) {
        const middle = (low + high) >> 1;
        if (series.dates[middle] < target) low = middle + 1;
        else high = middle;
    }

    return low < series.dates.length ? low : -1;
}

// Index of the last date <= target, or -1.
function indexOnOrBefore(series, target) {
    const after = indexOnOrAfter(series, target);

    if (after === -1) return series.dates.length - 1;
    return series.dates[after] === target ? after : after - 1;
}

function navOnOrBefore(series, target) {
    const index = indexOnOrBefore(series, target);
    return index === -1 ? null : { date: series.dates[index], nav: series.values[index] };
}

/* ---------- SIP schedule and allotment ---------- */

// Due dates of an investment up to and including `until`. A SIP day past the
// end of a month (29-31) falls on that month's last day.
function scheduledDates(investment, until) {
    if (investment.kind === "lumpsum") {
        return investment.startDate <= until ? [investment.startDate] : [];
    }

    const last = investment.endDate && investment.endDate < until ? investment.endDate : until;
    const dates = [];

    for (let offset = 0; offset < 1200; offset++) {
        const { year, month } = addMonths(investment.startDate, offset);
        const due = toDateString(year, month, Math.min(investment.sipDay, getDaysInMonth(year, month)));

        if (due > last) break;
        if (due >= investment.startDate) dates.push(due);
    }

    return dates;
}

// Installment amount with an optional yearly step-up (e.g. +10% every 12 installments' worth of months).
function installmentAmount(investment, dueDate) {
    if (investment.kind === "lumpsum" || !investment.stepUpPercent) {
        return investment.amount;
    }

    const start = parseDateString(investment.startDate);
    const due = parseDateString(dueDate);
    const monthsIn = (due.year - start.year) * 12 + (due.month - start.month);
    const steps = Math.max(0, Math.floor(monthsIn / 12));

    return round(investment.amount * Math.pow(1 + investment.stepUpPercent / 100, steps), 2);
}

function stampDuty(amount, date) {
    return date >= STAMP_DUTY_FROM ? round(amount - amount / (1 + STAMP_DUTY_RATE), 2) : 0;
}

// Every installment up to `today` (an Indian market date), each allotted at
// the NAV of the first trading day on or after its due date.
//
// status: "allotted"    units bought at navDate's NAV
//         "awaiting_nav" due, but that trading day's NAV isn't published yet
//         "skipped"     the person marked this installment as missed
function buildInstallments(investment, series, today) {
    const skipped = new Set(investment.skippedDates || []);

    return scheduledDates(investment, today).map(dueDate => {
        const amount = installmentAmount(investment, dueDate);

        if (skipped.has(dueDate)) {
            return { dueDate, amount, status: "skipped" };
        }

        const index = indexOnOrAfter(series, dueDate);

        if (index === -1) {
            return { dueDate, amount, status: "awaiting_nav" };
        }

        const navDate = series.dates[index];
        const nav = series.values[index];
        const duty = stampDuty(amount, navDate);
        const units = round((amount - duty) / nav, 3);

        return {
            dueDate,
            navDate,
            nav,
            amount,
            stampDuty: duty,
            units,
            status: "allotted",
            // The due date was a weekend or market holiday.
            shifted: navDate !== dueDate
        };
    });
}

function nextInstallment(investment, today) {
    if (investment.kind === "lumpsum" || investment.isActive === false) {
        return null;
    }

    const [next] = scheduledDates(investment, addDays(today, 40)).filter(date => date > today);

    if (!next || (investment.endDate && next > investment.endDate)) {
        return null;
    }

    return { dueDate: next, amount: installmentAmount(investment, next), onWeekend: isWeekend(next) };
}

/* ---------- Returns ---------- */

// Annualised internal rate of return for dated cash flows
// ([{ date, amount }], money out negative, money in positive).
function xirr(cashflows) {
    if (cashflows.length < 2) return null;
    if (!cashflows.some(flow => flow.amount < 0) || !cashflows.some(flow => flow.amount > 0)) return null;

    const first = cashflows.reduce((earliest, flow) => (flow.date < earliest ? flow.date : earliest), cashflows[0].date);
    const flows = cashflows.map(flow => ({ years: daysBetween(first, flow.date) / 365, amount: flow.amount }));
    const npv = rate => flows.reduce((sum, flow) => sum + flow.amount / Math.pow(1 + rate, flow.years), 0);
    const derivative = rate => flows.reduce((sum, flow) => sum - flow.years * flow.amount / Math.pow(1 + rate, flow.years + 1), 0);

    // Newton's method, then bisection if it doesn't converge.
    let rate = 0.1;

    for (let i = 0; i < 100; i++) {
        const value = npv(rate);
        const slope = derivative(rate);

        if (Math.abs(value) < 1e-7) return rate;
        if (!Number.isFinite(slope) || slope === 0) break;

        const next = rate - value / slope;
        if (!Number.isFinite(next) || next <= -0.9999) break;
        if (Math.abs(next - rate) < 1e-10) return next;
        rate = next;
    }

    let low = -0.9999;
    let high = 100;

    if (npv(low) * npv(high) > 0) return null;

    for (let i = 0; i < 300; i++) {
        const middle = (low + high) / 2;
        const value = npv(middle);
        if (Math.abs(value) < 1e-7) return middle;
        if (npv(low) * value < 0) high = middle;
        else low = middle;
    }

    return (low + high) / 2;
}

function cagr(startValue, endValue, years) {
    if (!(startValue > 0) || !(endValue > 0) || !(years > 0)) return null;
    return Math.pow(endValue / startValue, 1 / years) - 1;
}

// Point-to-point return of the fund over `months` (annualised when >= 12 months).
function trailingReturn(series, months) {
    const last = series.dates.length - 1;
    if (last < 1) return null;

    const lastDate = series.dates[last];
    const { year, month } = addMonths(lastDate, -months);
    const day = Math.min(Number(lastDate.slice(8, 10)), getDaysInMonth(year, month));
    const start = navOnOrBefore(series, toDateString(year, month, day));

    if (!start || start.date < series.dates[0] || daysBetween(start.date, lastDate) < months * 28) return null;

    const value = series.values[last];
    return months >= 12
        ? cagr(start.nav, value, daysBetween(start.date, lastDate) / 365)
        : value / start.nav - 1;
}

/* ---------- Risk ---------- */

function dailyReturns(series, fromIndex) {
    const returns = [];
    for (let i = Math.max(1, fromIndex); i < series.values.length; i++) {
        returns.push(series.values[i] / series.values[i - 1] - 1);
    }
    return returns;
}

function mean(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
    if (values.length < 2) return null;
    const average = mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

// Largest peak-to-trough fall, as a negative fraction, with its dates.
function maxDrawdown(series, fromIndex = 0) {
    let peak = series.values[fromIndex];
    let peakDate = series.dates[fromIndex];
    let worst = { drawdown: 0, peakDate, troughDate: peakDate };

    for (let i = fromIndex; i < series.values.length; i++) {
        if (series.values[i] > peak) {
            peak = series.values[i];
            peakDate = series.dates[i];
        }

        const drawdown = series.values[i] / peak - 1;
        if (drawdown < worst.drawdown) {
            worst = { drawdown, peakDate, troughDate: series.dates[i] };
        }
    }

    return worst;
}

// Risk and return statistics over the last year of trading days.
// `riskFreeRate` is annual (e.g. 0.065). `benchmark` is another NAV series.
function riskMetrics(series, { riskFreeRate = 0.065, benchmark = null } = {}) {
    const count = series.values.length;
    if (count < 60) return null;

    const fromIndex = Math.max(0, count - 1 - TRADING_DAYS_PER_YEAR);
    const returns = dailyReturns(series, fromIndex + 1);
    const deviation = standardDeviation(returns);
    const volatility = deviation === null ? null : deviation * Math.sqrt(TRADING_DAYS_PER_YEAR);
    const yearReturn = cagr(series.values[fromIndex], series.values[count - 1], daysBetween(series.dates[fromIndex], series.dates[count - 1]) / 365);
    const dailyRiskFree = Math.pow(1 + riskFreeRate, 1 / TRADING_DAYS_PER_YEAR) - 1;
    const downside = returns.map(value => Math.min(0, value - dailyRiskFree));
    const downsideDeviation = Math.sqrt(downside.reduce((sum, value) => sum + value * value, 0) / downside.length) * Math.sqrt(TRADING_DAYS_PER_YEAR);

    const result = {
        period: { from: series.dates[fromIndex], to: series.dates[count - 1] },
        annualReturn: yearReturn,
        volatility,
        sharpe: volatility ? (yearReturn - riskFreeRate) / volatility : null,
        sortino: downsideDeviation ? (yearReturn - riskFreeRate) / downsideDeviation : null,
        maxDrawdown: maxDrawdown(series, fromIndex),
        beta: null,
        alpha: null,
        correlation: null
    };

    if (benchmark && benchmark.values.length > 60) {
        // Daily returns on the dates both funds traded.
        const paired = [];
        for (let i = fromIndex + 1; i < count; i++) {
            const at = indexOnOrBefore(benchmark, series.dates[i]);
            const before = indexOnOrBefore(benchmark, series.dates[i - 1]);
            if (at > 0 && before >= 0 && benchmark.dates[at] === series.dates[i] && benchmark.dates[before] === series.dates[i - 1]) {
                paired.push([series.values[i] / series.values[i - 1] - 1, benchmark.values[at] / benchmark.values[before] - 1]);
            }
        }

        if (paired.length > 60) {
            const fundMean = mean(paired.map(pair => pair[0]));
            const marketMean = mean(paired.map(pair => pair[1]));
            let covariance = 0;
            let marketVariance = 0;
            let fundVariance = 0;

            for (const [fund, market] of paired) {
                covariance += (fund - fundMean) * (market - marketMean);
                marketVariance += (market - marketMean) ** 2;
                fundVariance += (fund - fundMean) ** 2;
            }

            const beta = covariance / marketVariance;
            const marketStart = navOnOrBefore(benchmark, series.dates[fromIndex]);
            const marketEnd = navOnOrBefore(benchmark, series.dates[count - 1]);
            const marketReturn = marketStart && marketEnd
                ? cagr(marketStart.nav, marketEnd.nav, daysBetween(marketStart.date, marketEnd.date) / 365)
                : null;

            result.beta = beta;
            result.correlation = covariance / Math.sqrt(marketVariance * fundVariance);
            // Jensen's alpha: return above what the fund's market risk would predict.
            result.alpha = marketReturn === null ? null : yearReturn - (riskFreeRate + beta * (marketReturn - riskFreeRate));
            result.benchmarkReturn = marketReturn;
        }
    }

    return result;
}

// Where the latest NAV sits against its recent range.
function priceContext(series) {
    const count = series.values.length;
    if (count < 2) return null;

    const latest = series.values[count - 1];
    const yearAgo = Math.max(0, count - TRADING_DAYS_PER_YEAR);
    const window = series.values.slice(yearAgo);
    const high = Math.max(...window);
    const low = Math.min(...window);
    const average200 = count >= 200 ? mean(series.values.slice(count - 200)) : null;

    return {
        high52w: high,
        low52w: low,
        fromHigh: latest / high - 1,
        fromLow: latest / low - 1,
        // 0 at the 52-week low, 1 at the high.
        rangePosition: high === low ? 1 : (latest - low) / (high - low),
        average200,
        fromAverage200: average200 ? latest / average200 - 1 : null
    };
}

/* ---------- Holdings and portfolio ---------- */

function summarizeHolding(installments, series) {
    const allotted = installments.filter(item => item.status === "allotted");
    const count = series.values.length;
    const latest = count ? { date: series.dates[count - 1], nav: series.values[count - 1] } : null;
    const previous = count > 1 ? series.values[count - 2] : null;
    const units = round(allotted.reduce((sum, item) => sum + item.units, 0), 3);
    const invested = round(allotted.reduce((sum, item) => sum + item.amount, 0), 2);
    const value = latest ? round(units * latest.nav, 2) : 0;
    const flows = allotted.map(item => ({ date: item.navDate, amount: -item.amount }));

    if (latest && units > 0) flows.push({ date: latest.date, amount: value });

    const firstDate = allotted.length ? allotted[0].navDate : null;

    return {
        latestNav: latest,
        units,
        invested,
        value,
        gain: round(value - invested, 2),
        absoluteReturn: invested > 0 ? value / invested - 1 : null,
        averageCost: units > 0 ? round(invested / units, 4) : null,
        // Today's move: units held before the latest trading day times the NAV change.
        dayChange: latest && previous
            ? round(allotted.filter(item => item.navDate < latest.date).reduce((sum, item) => sum + item.units, 0) * (latest.nav - previous), 2)
            : 0,
        dayChangePercent: latest && previous ? latest.nav / previous - 1 : null,
        xirr: xirr(flows),
        holdingDays: firstDate && latest ? daysBetween(firstDate, latest.date) : 0,
        installmentsAllotted: allotted.length
    };
}

// What the holding would be worth if every installment had grown at
// `annualRate` — the value-averaging target path.
function valueAveraging(installments, series, annualRate) {
    const allotted = installments.filter(item => item.status === "allotted");
    const count = series.values.length;
    if (!allotted.length || !count) return null;

    const latest = { date: series.dates[count - 1], nav: series.values[count - 1] };
    const target = allotted.reduce((sum, item) => sum + item.amount * Math.pow(1 + annualRate, daysBetween(item.navDate, latest.date) / 365), 0);
    const units = allotted.reduce((sum, item) => sum + item.units, 0);
    const value = units * latest.nav;
    const gap = target - value;

    return {
        annualRate,
        targetValue: round(target, 2),
        currentValue: round(value, 2),
        gap: round(gap, 2),
        topUpUnits: gap > 0 ? round(gap / latest.nav, 3) : 0
    };
}

// Daily value of all holdings together, and the money put in by each day.
// `holdings` = [{ installments, series }]. Points are thinned to `maxPoints`.
function portfolioTimeline(holdings, maxPoints = 500) {
    const allotments = holdings.flatMap(({ installments, series }) =>
        installments.filter(item => item.status === "allotted").map(item => ({ ...item, series }))
    );

    if (!allotments.length) return [];

    const start = allotments.reduce((earliest, item) => (item.navDate < earliest ? item.navDate : earliest), allotments[0].navDate);
    const dates = [...new Set(holdings.flatMap(({ series }) => series.dates.filter(date => date >= start)))].sort();
    const points = [];

    for (const date of dates) {
        let value = 0;
        let invested = 0;

        for (const { installments, series } of holdings) {
            let units = 0;
            for (const item of installments) {
                if (item.status === "allotted" && item.navDate <= date) {
                    units += item.units;
                    invested += item.amount;
                }
            }
            if (units > 0) {
                const nav = navOnOrBefore(series, date);
                if (nav) value += units * nav.nav;
            }
        }

        points.push({ date, value: round(value, 2), invested: round(invested, 2) });
    }

    if (points.length <= maxPoints) return points;

    const step = Math.ceil(points.length / maxPoints);
    return points.filter((point, index) => index % step === 0 || index === points.length - 1);
}

// Weekdays in the recent past with no NAV: market holidays.
function recentHolidays(series, days = 30) {
    const count = series.dates.length;
    if (!count) return [];

    const last = series.dates[count - 1];
    const holidays = [];

    for (let date = addDays(last, -days); date < last; date = addDays(date, 1)) {
        if (!isWeekend(date) && series.dates[indexOnOrAfter(series, date)] !== date) {
            holidays.push(date);
        }
    }

    return holidays;
}

function downsample(series, maxPoints) {
    const count = series.dates.length;
    if (count <= maxPoints) return series.dates.map((date, i) => ({ date, nav: series.values[i] }));

    const step = Math.ceil(count / maxPoints);
    const points = [];
    for (let i = 0; i < count; i += step) points.push({ date: series.dates[i], nav: series.values[i] });
    if (points[points.length - 1].date !== series.dates[count - 1]) points.push({ date: series.dates[count - 1], nav: series.values[count - 1] });
    return points;
}

/* ---------- Daily entry signal ---------- */

function quantile(sorted, q) {
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

// Where today's NAV sits against its own 200-trading-day average, ranked
// against every past day of the fund, and how buying in each zone worked out
// over the following year in this fund's history. Zones are terciles of the
// fund's own history: "below" (cheaper than usual), "usual", "above".
// Returns null without enough history (200 days plus a year of outcomes).
function entrySignal(series, { window = 200, horizon = TRADING_DAYS_PER_YEAR } = {}) {
    const count = series.values.length;
    if (count < window + horizon + 60) return null;

    const deviations = new Array(count).fill(null);
    let rollingSum = 0;

    for (let i = 0; i < count; i++) {
        rollingSum += series.values[i];
        if (i >= window) rollingSum -= series.values[i - window];
        if (i >= window - 1) deviations[i] = series.values[i] / (rollingSum / window) - 1;
    }

    const known = deviations.filter(value => value !== null);
    const sorted = [...known].sort((a, b) => a - b);
    const lowCut = quantile(sorted, 1 / 3);
    const highCut = quantile(sorted, 2 / 3);
    const zoneOf = value => (value <= lowCut ? "below" : value >= highCut ? "above" : "usual");

    const outcomes = { below: [], usual: [], above: [] };
    for (let i = window - 1; i + horizon < count; i++) {
        outcomes[zoneOf(deviations[i])].push(series.values[i + horizon] / series.values[i] - 1);
    }

    const summarize = returns => (returns.length
        ? {
            averageReturn: mean(returns),
            positiveShare: returns.filter(value => value > 0).length / returns.length,
            samples: returns.length
        }
        : null);

    const today = deviations[count - 1];
    let rank = 0;
    while (rank < sorted.length && sorted[rank] < today) rank++;

    return {
        zone: zoneOf(today),
        deviation: today,
        // 0 = furthest below its average the fund has ever been, 1 = furthest above.
        percentile: rank / sorted.length,
        average200: series.values[count - 1] / (1 + today),
        thresholds: { below: lowCut, above: highCut },
        history: {
            below: summarize(outcomes.below),
            usual: summarize(outcomes.usual),
            above: summarize(outcomes.above)
        },
        horizonDays: horizon,
        since: series.dates[window - 1],
        asOf: series.dates[count - 1]
    };
}

/* ---------- Benchmark comparison ---------- */

// What the same payments, on the same days, would be worth today in the
// benchmark (a Nifty 50 index fund). The fairest test of fund selection:
// identical cash flows, different fund.
function benchmarkComparison(installments, benchmark, asOf) {
    const allotted = installments.filter(item => item.status === "allotted");
    const end = benchmark ? navOnOrBefore(benchmark, asOf) : null;
    if (!allotted.length || !end) return null;

    let units = 0;
    const flows = [];

    for (const item of allotted) {
        const index = indexOnOrAfter(benchmark, item.navDate);
        if (index === -1 || benchmark.dates[index] > asOf) continue;
        units += (item.amount - (item.stampDuty || 0)) / benchmark.values[index];
        flows.push({ date: item.navDate, amount: -item.amount });
    }

    if (!flows.length) return null;

    const value = units * end.nav;
    flows.push({ date: end.date, amount: value });

    return { value: round(value, 2), xirr: xirr(flows) };
}

/* ---------- Tax (Indian capital gains, estimate) ---------- */

// Rules for equity-oriented funds from 23 July 2024: units held more than 12
// months are long-term (12.5% above ₹1.25 lakh of gains a financial year),
// otherwise short-term (20%). 4% health & education cess on the tax.
// Other funds (debt, most international/FoF) are taxed at the slab rate.
const TAX = {
    equityLongTermRate: 0.125,
    equityShortTermRate: 0.2,
    longTermExemption: 125000,
    cess: 0.04
};

const EQUITY_HYBRID = /(aggressive hybrid|balanced advantage|dynamic asset allocation|arbitrage|equity savings)/i;
const DEBT_WORDS = /\b(gilt|g-?sec|sdl|bond|debt|liquid|overnight|money market|treasury|psu|crisil[- ]?ibx|target maturity|corporate|credit|banking)\b/i;

// Whether a scheme is taxed as equity, from its category and name.
function isEquityTaxed(meta = {}) {
    const category = meta.schemeCategory || "";
    const name = meta.schemeName || "";

    if (/^equity/i.test(category)) return true;
    if (/^hybrid/i.test(category)) return EQUITY_HYBRID.test(category);
    if (/index funds|etf/i.test(category)) return !DEBT_WORDS.test(name) && !/(international|global|nasdaq|s&p 500|us )/i.test(name);
    return false;
}

function addYears(dateString, years) {
    const { year, month, day } = parseDateString(dateString);
    return toDateString(year + years, month, Math.min(day, getDaysInMonth(year + years, month)));
}

// Unrealised gains split by how they would be taxed if sold at the latest NAV.
function taxLots(installments, latest, equity, soonDays = 30) {
    const result = {
        equity,
        longTermGain: 0,
        shortTermGain: 0,
        slabGain: 0,
        turningLongTerm: { gain: 0, units: 0, firstDate: null }
    };

    if (!latest) return result;

    for (const item of installments) {
        if (item.status !== "allotted") continue;

        const gain = item.units * latest.nav - item.amount;

        if (!equity) {
            result.slabGain += gain;
            continue;
        }

        const longTermFrom = addYears(item.navDate, 1);

        if (latest.date > longTermFrom) {
            result.longTermGain += gain;
        } else {
            result.shortTermGain += gain;
            // Units that become long-term within `soonDays`.
            if (longTermFrom <= addDays(latest.date, soonDays)) {
                result.turningLongTerm.gain += gain;
                result.turningLongTerm.units += item.units;
                const date = addDays(longTermFrom, 1);
                if (!result.turningLongTerm.firstDate || date < result.turningLongTerm.firstDate) {
                    result.turningLongTerm.firstDate = date;
                }
            }
        }
    }

    result.longTermGain = round(result.longTermGain, 2);
    result.shortTermGain = round(result.shortTermGain, 2);
    result.slabGain = round(result.slabGain, 2);
    result.turningLongTerm.gain = round(result.turningLongTerm.gain, 2);
    result.turningLongTerm.units = round(result.turningLongTerm.units, 3);
    return result;
}

// Estimated tax if everything were sold today. Gains and losses within each
// bucket net off; the long-term exemption applies once across the portfolio.
// Ignores other gains booked this financial year, surcharge and slab-rate tax.
function estimateEquityTax(longTermGain, shortTermGain) {
    const shortTermTax = Math.max(0, shortTermGain) * TAX.equityShortTermRate;
    const taxableLongTerm = Math.max(0, longTermGain - TAX.longTermExemption);
    const longTermTax = taxableLongTerm * TAX.equityLongTermRate;

    return {
        shortTermTax: round(shortTermTax * (1 + TAX.cess), 2),
        longTermTax: round(longTermTax * (1 + TAX.cess), 2),
        total: round((shortTermTax + longTermTax) * (1 + TAX.cess), 2),
        exemptionUsed: round(Math.min(Math.max(0, longTermGain), TAX.longTermExemption), 2)
    };
}

module.exports = {
    TAX,
    STAMP_DUTY_FROM,
    round,
    benchmarkComparison,
    entrySignal,
    isEquityTaxed,
    taxLots,
    estimateEquityTax,
    addYears,
    fromApiDate,
    daysBetween,
    isWeekend,
    indexOnOrAfter,
    indexOnOrBefore,
    navOnOrBefore,
    scheduledDates,
    installmentAmount,
    stampDuty,
    buildInstallments,
    nextInstallment,
    xirr,
    cagr,
    trailingReturn,
    maxDrawdown,
    riskMetrics,
    priceContext,
    summarizeHolding,
    valueAveraging,
    portfolioTimeline,
    recentHolidays,
    downsample
};
