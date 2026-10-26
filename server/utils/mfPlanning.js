// Planning calculations built on NAV history: goal odds from historical
// returns, the yearly tax-free long-term gains harvest, and whether the SIP
// date matters. Pure functions with no database or network access. Series are
// { dates, values } as in mfMath, dates "YYYY-MM-DD".

const { getDaysInMonth, toDateString, parseDateString, addDays } = require("./time");
const { round, indexOnOrAfter, addYears, stampDuty, xirr, daysBetween, TAX } = require("./mfMath");

/* ---------- Shared helpers ---------- */

// Small, fast, seedable PRNG (mulberry32), so the same goal gives the same
// odds on every load.
function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashSeed(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return hash >>> 0;
}

function quantileOf(sorted, q) {
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

const monthKey = date => date.slice(0, 7);

function monthsBetween(from, to) {
    const a = parseDateString(from);
    const b = parseDateString(to);
    return (b.year - a.year) * 12 + (b.month - a.month);
}

// Month-on-month returns from the last NAV of each calendar month:
// Map("YYYY-MM" -> return). The current, unfinished month is left out.
function monthlyReturns(series, asOf) {
    const lastOfMonth = new Map();
    series.dates.forEach((date, i) => { lastOfMonth.set(monthKey(date), series.values[i]); });
    if (asOf) lastOfMonth.delete(monthKey(asOf));

    const months = [...lastOfMonth.keys()].sort();
    const returns = new Map();
    for (let i = 1; i < months.length; i++) {
        // Only consecutive months; a gap in the data isn't a one-month return.
        if (monthsBetween(`${months[i - 1]}-01`, `${months[i]}-01`) !== 1) continue;
        returns.set(months[i], lastOfMonth.get(months[i]) / lastOfMonth.get(months[i - 1]) - 1);
    }
    return returns;
}

/* ---------- Goal odds from historical returns ---------- */

const GOAL_DEFAULTS = { paths: 2000, blockMonths: 12, minHistoryMonths: 36, flatRate: 0.12 };

// The odds of reaching `target` by `targetDate`, by replaying the portfolio's
// own monthly returns from history in random 12-month blocks (blocks keep
// real streaks — crashes and recoveries — intact).
//
// funds:     [{ series, value, monthlySip }]  money already in each fund and
//            what goes in each month; a fund with too little history borrows
//            the benchmark's return for the months it didn't exist.
// benchmark: series used for those months and when no funds are chosen.
// monthlyContribution: total put in each month (spread like the SIPs, or like
//            the current holdings when there are no SIPs).
// stepUpPercent: yearly increase of the monthly contribution.
//
// Returns null when there isn't enough history to sample from.
function simulateGoal({ funds = [], benchmark, today, targetDate, target, monthlyContribution, stepUpPercent = 0, seed = "goal", options = {} }) {
    const { paths, blockMonths, minHistoryMonths, flatRate } = { ...GOAL_DEFAULTS, ...options };
    const months = Math.max(1, monthsBetween(today, targetDate));
    const current = funds.reduce((sum, fund) => sum + fund.value, 0);

    // Historical months to sample: those with a benchmark return.
    const benchmarkReturns = benchmark ? monthlyReturns(benchmark, today) : new Map();
    const fundReturns = funds.map(fund => monthlyReturns(fund.series, today));
    let calendar = [...benchmarkReturns.keys()].sort();
    if (!calendar.length && fundReturns.length) calendar = [...fundReturns[0].keys()].sort();
    if (calendar.length < minHistoryMonths) return null;

    const weightsBy = pick => {
        const total = funds.reduce((sum, fund) => sum + pick(fund), 0);
        return total > 0 ? funds.map(fund => pick(fund) / total) : null;
    };
    const valueWeights = weightsBy(fund => fund.value);
    const sipWeights = weightsBy(fund => fund.monthlySip) || valueWeights;
    let borrowedMonths = 0;

    // One blended return per historical month, for the money already invested
    // and for new contributions.
    const blend = weights => calendar.map(month => {
        if (!weights) return benchmarkReturns.get(month) ?? 0;
        return weights.reduce((sum, weight, i) => {
            const own = fundReturns[i].get(month);
            return sum + weight * (own ?? benchmarkReturns.get(month) ?? 0);
        }, 0);
    });
    const valueSeries = blend(valueWeights);
    const sipSeries = blend(sipWeights);
    if (valueWeights || sipWeights) {
        const weights = sipWeights || valueWeights;
        borrowedMonths = calendar.filter(month => weights.some((weight, i) => weight > 0 && !fundReturns[i].has(month))).length;
    }

    const random = seededRandom(hashSeed(String(seed)));
    const step = 1 + stepUpPercent / 100;
    const contributionAt = k => Math.pow(step, Math.floor(k / 12));
    const yearMarks = [];
    for (let m = 12; m < months; m += 12) yearMarks.push(m);
    yearMarks.push(months);

    const finals = new Float64Array(paths);
    const needed = new Float64Array(paths);
    const marks = yearMarks.map(() => new Float64Array(paths));
    const span = calendar.length;
    const block = Math.min(blockMonths, span);

    for (let p = 0; p < paths; p++) {
        let lumpGrowth = 1;    // growth of today's money so far
        let sipPot = 0;        // value of contributions per ₹1 of base contribution
        let start = 0;
        let mark = 0;

        for (let k = 0; k < months; k++) {
            if (k % block === 0) start = Math.floor(random() * (span - block + 1)) - k;
            const index = start + k;
            sipPot = (sipPot + contributionAt(k)) * (1 + sipSeries[index]);
            lumpGrowth *= 1 + valueSeries[index];

            if (k + 1 === yearMarks[mark]) {
                marks[mark][p] = current * lumpGrowth + monthlyContribution * sipPot;
                mark++;
            }
        }

        finals[p] = current * lumpGrowth + monthlyContribution * sipPot;
        // The monthly amount this path needs to hit the target exactly.
        needed[p] = sipPot > 0 ? Math.max(0, (target - current * lumpGrowth) / sipPot) : (current * lumpGrowth >= target ? 0 : Infinity);
    }

    const sortedFinals = [...finals].sort((a, b) => a - b);
    const sortedNeeded = [...needed].sort((a, b) => a - b);
    const reached = sortedFinals.filter(value => value >= target).length;

    // What a flat-rate projection (the usual calculator) would promise.
    const monthlyRate = Math.pow(1 + flatRate, 1 / 12) - 1;
    let flat = current;
    for (let k = 0; k < months; k++) flat = (flat + monthlyContribution * contributionAt(k)) * (1 + monthlyRate);

    let invested = current;
    for (let k = 0; k < months; k++) invested += monthlyContribution * contributionAt(k);

    const needFor = odds => {
        const value = quantileOf(sortedNeeded, odds);
        return value === null || !Number.isFinite(value) ? null : Math.ceil(value / 100) * 100;
    };

    return {
        probability: reached / paths,
        months,
        target,
        current: round(current, 2),
        monthlyContribution,
        stepUpPercent,
        totalInvested: round(invested, 2),
        outcomes: {
            p10: round(quantileOf(sortedFinals, 0.1), 0),
            p25: round(quantileOf(sortedFinals, 0.25), 0),
            median: round(quantileOf(sortedFinals, 0.5), 0),
            p75: round(quantileOf(sortedFinals, 0.75), 0),
            p90: round(quantileOf(sortedFinals, 0.9), 0)
        },
        // Monthly amount needed for a given chance of success.
        neededMonthly: { odds50: needFor(0.5), odds75: needFor(0.75), odds90: needFor(0.9) },
        flatRate: { rate: flatRate, value: round(flat, 0) },
        fan: yearMarks.map((m, i) => {
            const sorted = [...marks[i]].sort((a, b) => a - b);
            const { year, month } = parseDateString(today);
            const index = year * 12 + (month - 1) + m;
            return {
                date: toDateString(Math.floor(index / 12), (index % 12) + 1, 1),
                p10: round(quantileOf(sorted, 0.1), 0),
                median: round(quantileOf(sorted, 0.5), 0),
                p90: round(quantileOf(sorted, 0.9), 0)
            };
        }),
        history: {
            from: calendar[0],
            to: calendar[calendar.length - 1],
            months: span,
            paths,
            blockMonths: block,
            // Months where a fund didn't exist yet and the benchmark stood in.
            borrowedMonths,
            // Months of each fund's own returns in the sample, in `funds` order.
            fundMonths: fundReturns.map(returns => calendar.filter(month => returns.has(month)).length)
        }
    };
}

/* ---------- Tax-free long-term gains harvest ---------- */

// Indian financial year (April-March) containing `date`.
function financialYear(date) {
    const { year, month } = parseDateString(date);
    const startYear = month >= 4 ? year : year - 1;
    return {
        label: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
        start: toDateString(startYear, 4, 1),
        end: toDateString(startYear + 1, 3, 31)
    };
}

// Units are sold first-in-first-out, so a fund's long-term gain can only be
// booked from its oldest units forward, stopping at the first lot that is
// still short-term. Returns that sellable stretch lot by lot.
function sellableLongTerm(installments, latest, lockInYears = 0) {
    const lots = installments
        .filter(item => item.status === "allotted")
        .sort((a, b) => a.navDate.localeCompare(b.navDate));
    const sellable = [];

    for (const lot of lots) {
        // Held for more than 12 months, and past any lock-in (ELSS: 3 years).
        if (!(latest.date > addYears(lot.navDate, Math.max(1, lockInYears)))) break;
        sellable.push({ navDate: lot.navDate, units: lot.units, cost: lot.amount, value: lot.units * latest.nav, gain: lot.units * latest.nav - lot.amount });
    }
    return sellable;
}

// How much long-term gain to book (sell and buy straight back) this financial
// year so it falls inside the ₹1.25 lakh yearly exemption, which can't be
// carried forward. Booking it now raises the purchase price of those units, so
// the same gain is never taxed later.
//
// holdings: [{ schemeCode, shortName, equityTaxed, installments, latestNav, lockInYears? }]
// alreadyBooked: long-term gains already sold this financial year.
function harvestPlan(holdings, today, { alreadyBooked = 0 } = {}) {
    const year = financialYear(today);
    const remaining = Math.max(0, TAX.longTermExemption - alreadyBooked);
    const candidates = [];
    let earliestLongTerm = null;

    for (const holding of holdings) {
        if (!holding.equityTaxed || !holding.latestNav) continue;
        const lots = sellableLongTerm(holding.installments, holding.latestNav, holding.lockInYears || 0);

        // When the first units of a fund with nothing sellable turn long-term.
        const oldest = holding.installments.filter(item => item.status === "allotted").map(item => item.navDate).sort()[0];
        if (!lots.length && oldest) {
            const date = addDays(addYears(oldest, Math.max(1, holding.lockInYears || 0)), 1);
            if (!earliestLongTerm || date < earliestLongTerm.date) earliestLongTerm = { date, shortName: holding.shortName };
        }

        // Book only up to the point where the gain is highest (a later lot at
        // a loss would just cancel some of it).
        let running = 0;
        let best = { gain: 0, upTo: -1 };
        lots.forEach((lot, i) => {
            running += lot.gain;
            if (running > best.gain) best = { gain: running, upTo: i };
        });
        if (best.upTo < 0) continue;

        const useful = lots.slice(0, best.upTo + 1);
        const value = useful.reduce((sum, lot) => sum + lot.value, 0);
        candidates.push({ holding, lots: useful, gain: best.gain, value, efficiency: best.gain / value });
    }

    // Prefer funds that free up the most gain per rupee taken out of the market.
    candidates.sort((a, b) => b.efficiency - a.efficiency);
    const available = candidates.reduce((sum, item) => sum + item.gain, 0);
    let left = remaining;
    const plan = [];

    for (const candidate of candidates) {
        if (left <= 0.5) break;
        let units = 0;
        let value = 0;
        let gain = 0;

        for (const lot of candidate.lots) {
            if (left - gain <= 0.5) break;
            if (lot.gain <= 0 || gain + lot.gain <= left) {
                units += lot.units;
                value += lot.value;
                gain += lot.gain;
            } else {
                // Part of this lot: just enough units to use up what's left.
                const share = (left - gain) / lot.gain;
                units += lot.units * share;
                value += lot.value * share;
                gain += lot.gain * share;
            }
        }

        if (gain <= 0) continue;
        // Units are traded to 3 decimals; round down so the gain stays inside.
        const nav = candidate.holding.latestNav.nav;
        const sellUnits = Math.floor(units * 1000) / 1000;
        const ratio = units > 0 ? sellUnits / units : 0;
        left -= gain * ratio;
        plan.push({
            schemeCode: candidate.holding.schemeCode,
            shortName: candidate.holding.shortName,
            units: sellUnits,
            amount: round(sellUnits * nav, 2),
            gain: round(gain * ratio, 2),
            nav,
            navDate: candidate.holding.latestNav.date,
            oldestLot: candidate.lots[0].navDate,
            // Stamp duty on buying the same amount back.
            rebuyStampDuty: stampDuty(sellUnits * nav, today)
        });
    }

    const booked = plan.reduce((sum, item) => sum + item.gain, 0);
    const taxRate = TAX.equityLongTermRate * (1 + TAX.cess);

    return {
        financialYear: year.label,
        deadline: year.end,
        daysLeft: Math.max(0, daysBetween(today, year.end)),
        exemption: TAX.longTermExemption,
        alreadyBooked: round(alreadyBooked, 2),
        remaining: round(remaining, 2),
        available: round(available, 2),
        plan,
        gainBooked: round(booked, 2),
        // Tax the same gain would attract if it were sold in a later year
        // without room in that year's exemption.
        taxAvoided: round(booked * taxRate, 2),
        costs: round(plan.reduce((sum, item) => sum + item.rebuyStampDuty, 0), 2),
        earliestLongTerm
    };
}

/* ---------- Does the SIP date matter? ---------- */

// The same monthly SIP run on every day of the month (1st-28th) over the last
// `years` years of this fund, each allotted at the next trading day's NAV.
// Returns null with less than `minMonths` of history.
function sipDateStudy(series, { years = 5, amount = 10000, minMonths = 24 } = {}) {
    const count = series.dates.length;
    if (!count) return null;

    const last = series.dates[count - 1];
    const lastFull = parseDateString(last);
    // End with the last month whose 28th has a NAV on or after it.
    let endIndex = lastFull.year * 12 + (lastFull.month - 1);
    if (toDateString(lastFull.year, lastFull.month, 28) > last) endIndex -= 1;
    const first = parseDateString(series.dates[0]);
    // Start after the first NAV so every day has a price in every month.
    const startIndex = Math.max(endIndex - years * 12 + 1, first.year * 12 + first.month);
    const months = endIndex - startIndex + 1;
    if (months < minMonths) return null;

    const latestNav = series.values[count - 1];
    const days = [];

    for (let day = 1; day <= 28; day++) {
        let units = 0;
        const flows = [];

        for (let index = startIndex; index <= endIndex; index++) {
            const year = Math.floor(index / 12);
            const month = (index % 12) + 1;
            const due = toDateString(year, month, Math.min(day, getDaysInMonth(year, month)));
            const at = indexOnOrAfter(series, due);
            if (at === -1) continue;
            units += (amount - stampDuty(amount, series.dates[at])) / series.values[at];
            flows.push({ date: series.dates[at], amount: -amount });
        }

        const value = units * latestNav;
        flows.push({ date: last, amount: value });
        days.push({ day, value: round(value, 2), xirr: xirr(flows) });
    }

    const byValue = [...days].sort((a, b) => b.value - a.value);
    const best = byValue[0];
    const worst = byValue[byValue.length - 1];

    return {
        from: toDateString(Math.floor(startIndex / 12), (startIndex % 12) + 1, 1),
        to: last,
        months,
        amount,
        invested: amount * months,
        days,
        best: best.day,
        worst: worst.day,
        // How much more the best day ended with than the worst.
        spread: worst.value > 0 ? best.value / worst.value - 1 : 0,
        // Typical gap from the best day, across all 28.
        medianGap: quantileOf(byValue.map(item => best.value / item.value - 1).sort((a, b) => a - b), 0.5)
    };
}

module.exports = {
    seededRandom,
    monthlyReturns,
    simulateGoal,
    financialYear,
    harvestPlan,
    sipDateStudy
};
