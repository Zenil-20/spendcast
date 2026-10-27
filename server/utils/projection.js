// Portfolio forecast: where the money already invested plus the SIPs still to
// come could be in 3, 6, 12 and 36 months, as a range rather than one number.
// Pure functions with no database or network access.
//
// Each path replays real history: a random 12-month stretch of past months is
// picked and every fund gets its own return from that same month, so funds
// that fell together in the past fall together here too. Upcoming SIP
// installments come from each SIP's actual schedule (day, step-up, end date),
// and each one can be missed at the rate this customer has missed them before.

const { scheduledDates, installmentAmount, round } = require("./mfMath");
const { monthlyReturns, seededRandom, hashSeed, quantileOf } = require("./mfPlanning");
const { getDaysInMonth, toDateString, parseDateString, addDays } = require("./time");

const DEFAULTS = { paths: 2000, blockMonths: 12, minHistoryMonths: 36, horizons: [3, 6, 12, 36] };
// Missed installments are measured over this many days of SIP history.
const MISS_WINDOW_DAYS = 730;

// The same day `months` later, clamped to the end of shorter months.
function shiftMonths(date, months) {
    const { year, month, day } = parseDateString(date);
    const index = year * 12 + (month - 1) + months;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    return toDateString(y, m, Math.min(day, getDaysInMonth(y, m)));
}

// Share of a fund's recent SIP installments the customer marked as missed.
// installments: as built by mfMath.buildInstallments, with `source`.
function missRateOf(installments, today) {
    const since = addDays(today, -MISS_WINDOW_DAYS);
    const recent = installments.filter(item => item.source === "sip" && item.dueDate >= since && item.dueDate <= today);
    const missed = recent.filter(item => item.status === "skipped").length;
    return { rate: recent.length ? missed / recent.length : 0, missed, scheduled: recent.length };
}

// Installment amounts due in each projected month, per fund:
// result[f][k] = [amounts due in month k+1].
function upcomingInstallments(funds, today, months) {
    return funds.map(fund => {
        const byMonth = Array.from({ length: months }, () => []);
        const active = (fund.investments || []).filter(item => item.kind === "sip" && item.isActive !== false);

        for (const investment of active) {
            for (const due of scheduledDates(investment, shiftMonths(today, months))) {
                if (due <= today) continue;
                // Month k holds the installments after k months and up to k+1 months.
                let k = 0;
                while (k < months - 1 && due > shiftMonths(today, k + 1)) k++;
                byMonth[k].push(installmentAmount(investment, due));
            }
        }
        return byMonth;
    });
}

// funds:   [{ schemeCode, shortName, series, value, investments, missRate }]
// extraMonthly: change to the monthly SIP total (negative lowers it). Existing
//          SIPs are scaled by it; with no SIPs it is a new flat monthly amount
//          split like the current holdings.
// Returns null when there isn't enough history to replay.
function projectPortfolio({ funds, benchmark, today, extraMonthly = 0, seed = "projection", options = {} }) {
    const { paths, blockMonths, minHistoryMonths, horizons } = { ...DEFAULTS, ...options };
    if (!funds.length) return null;
    const months = Math.max(...horizons);

    // Historical months to sample from: those with a benchmark return.
    const benchmarkReturns = benchmark ? monthlyReturns(benchmark, today) : new Map();
    const fundReturns = funds.map(fund => monthlyReturns(fund.series, today));
    let calendar = [...benchmarkReturns.keys()].sort();
    if (!calendar.length) calendar = [...fundReturns[0].keys()].sort();
    if (calendar.length < minHistoryMonths) return null;

    // A fund that didn't exist yet borrows the benchmark's return that month.
    const returns = fundReturns.map(own => Float64Array.from(calendar, month => own.get(month) ?? benchmarkReturns.get(month) ?? 0));
    const borrowed = fundReturns.map(own => calendar.filter(month => !own.has(month)).length);

    const schedule = upcomingInstallments(funds, today, months);
    const currentMonthly = round(schedule.reduce((sum, byMonth) => sum + byMonth[0].reduce((s, a) => s + a, 0), 0), 2);
    const missRates = funds.map(fund => Math.min(0.9, Math.max(0, fund.missRate || 0)));

    // Changing the SIP scales every scheduled installment; with no SIP the
    // change is new money spread like today's holdings.
    const change = Math.max(-currentMonthly, Number(extraMonthly) || 0);
    const scale = currentMonthly > 0 ? (currentMonthly + change) / currentMonthly : 1;
    const flat = currentMonthly > 0 ? 0 : Math.max(0, change);
    const totalValue = funds.reduce((sum, fund) => sum + Math.max(0, fund.value), 0);
    const flatWeights = funds.map(fund => (totalValue > 0 ? Math.max(0, fund.value) / totalValue : 1 / funds.length));

    const random = seededRandom(hashSeed(String(seed)));
    const span = calendar.length;
    const block = Math.min(blockMonths, span);
    const F = funds.length;

    // Per month and path: growth of today's money, of SIP money, of ₹1 a month
    // of flat money, and SIP money actually paid in.
    const lump = Array.from({ length: months }, () => new Float64Array(paths));
    const sip = Array.from({ length: months }, () => new Float64Array(paths));
    const pot = Array.from({ length: months }, () => new Float64Array(paths));
    const paid = Array.from({ length: months }, () => new Float64Array(paths));

    const lumpF = new Float64Array(F);
    const sipF = new Float64Array(F);
    const potF = new Float64Array(F);

    for (let p = 0; p < paths; p++) {
        let start = 0;
        let paidSoFar = 0;
        for (let f = 0; f < F; f++) {
            lumpF[f] = Math.max(0, funds[f].value);
            sipF[f] = 0;
            potF[f] = 0;
        }

        for (let k = 0; k < months; k++) {
            if (k % block === 0) start = Math.floor(random() * (span - block + 1)) - k;
            const index = start + k;
            let lumpTotal = 0;
            let sipTotal = 0;
            let potTotal = 0;

            for (let f = 0; f < F; f++) {
                let due = 0;
                for (const amount of schedule[f][k]) {
                    if (missRates[f] === 0 || random() >= missRates[f]) due += amount;
                }
                paidSoFar += due;
                const growth = 1 + returns[f][index];
                lumpF[f] *= growth;
                sipF[f] = (sipF[f] + due) * growth;
                potF[f] = (potF[f] + flatWeights[f]) * growth;
                lumpTotal += lumpF[f];
                sipTotal += sipF[f];
                potTotal += potF[f];
            }

            lump[k][p] = lumpTotal;
            sip[k][p] = sipTotal;
            pot[k][p] = potTotal;
            paid[k][p] = paidSoFar;
        }
    }

    const current = round(totalValue, 2);
    const valuesAt = (k, scaleBy, flatBy) => {
        const values = new Float64Array(paths);
        for (let p = 0; p < paths; p++) values[p] = lump[k][p] + scaleBy * sip[k][p] + flatBy * pot[k][p];
        return values;
    };
    const quantiles = values => {
        const sorted = [...values].sort((a, b) => a - b);
        return {
            p10: round(quantileOf(sorted, 0.1), 0),
            p25: round(quantileOf(sorted, 0.25), 0),
            median: round(quantileOf(sorted, 0.5), 0),
            p75: round(quantileOf(sorted, 0.75), 0),
            p90: round(quantileOf(sorted, 0.9), 0)
        };
    };

    const horizonViews = horizons.map(h => {
        const k = h - 1;
        const values = valuesAt(k, scale, flat);
        let paidTotal = 0;
        let losses = 0;
        for (let p = 0; p < paths; p++) {
            const contributed = scale * paid[k][p] + flat * (k + 1);
            paidTotal += contributed;
            if (values[p] < current + contributed) losses++;
        }
        const q = quantiles(values);
        const contributed = round(paidTotal / paths, 0);
        return {
            months: h,
            date: shiftMonths(today, h),
            contributed,
            invested: round(current + contributed, 0),
            pessimistic: q.p10,
            baseline: q.median,
            optimistic: q.p90,
            p25: q.p25,
            p75: q.p75,
            // Paths that ended below the money put in.
            lossProbability: losses / paths
        };
    });

    const fan = [{ date: today, p10: current, p25: current, median: current, p75: current, p90: current }];
    for (let k = 0; k < months; k++) fan.push({ date: shiftMonths(today, k + 1), ...quantiles(valuesAt(k, scale, flat)) });

    // The longest horizon for a range of monthly SIP totals.
    const last = months - 1;
    const steps = currentMonthly > 0
        ? [-1, -0.5, 0, 0.5, 1].map(share => share * currentMonthly)
        : [0, 1000, 5000, 10000, 25000];
    const sensitivity = steps.map(delta => {
        const total = Math.max(0, round(currentMonthly + delta, 0));
        const s = currentMonthly > 0 ? total / currentMonthly : 1;
        const fl = currentMonthly > 0 ? 0 : total;
        const q = quantiles(valuesAt(last, s, fl));
        return { monthly: total, change: round(total - currentMonthly, 0), pessimistic: q.p10, baseline: q.median, optimistic: q.p90 };
    });

    return {
        asOf: today,
        current,
        currentMonthly,
        monthly: round(currentMonthly + change, 0),
        change: round(change, 0),
        horizons: horizonViews,
        fan,
        sensitivity: { months, rows: sensitivity },
        assumptions: {
            history: { from: calendar[0], to: calendar[span - 1], months: span, paths, blockMonths: block },
            funds: funds.map((fund, i) => ({
                schemeCode: fund.schemeCode,
                shortName: fund.shortName,
                // Months where the benchmark stood in for this fund.
                borrowedMonths: borrowed[i],
                missRate: missRates[i],
                upcomingInstallments: schedule[i].reduce((sum, list) => sum + list.length, 0)
            })),
            stepUpsIncluded: funds.some(fund => (fund.investments || []).some(item => item.kind === "sip" && item.stepUpPercent > 0 && item.isActive !== false)),
            contributionTiming: "start of each month",
            excludes: ["taxes", "exit loads", "new purchases you haven't scheduled"]
        }
    };
}

module.exports = {
    shiftMonths,
    missRateOf,
    upcomingInstallments,
    projectPortfolio
};
