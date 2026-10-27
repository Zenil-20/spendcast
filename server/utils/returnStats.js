// Statistics over month-end returns shared by the overlap detector, the
// health score and the alerts: correlations, a portfolio's blended monthly
// returns, volatility and the worst 12 months. Pure functions; series are
// { dates, values } as in mfMath, dates "YYYY-MM-DD".

const { monthlyReturns } = require("./mfPlanning");

const MIN_COMMON_MONTHS = 24;

function pearson(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;
    const mx = xs.reduce((sum, x) => sum + x, 0) / n;
    const my = ys.reduce((sum, y) => sum + y, 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;

    for (let i = 0; i < n; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
        syy += (ys[i] - my) ** 2;
    }

    // A flat series has no defined correlation.
    if (sxx === 0 || syy === 0) return null;
    return sxy / Math.sqrt(sxx * syy);
}

// Correlation of two return maps (Map "YYYY-MM" -> return) over their common
// months, the most recent `months` of them.
function correlationOf(a, b, { months = 36, minMonths = MIN_COMMON_MONTHS } = {}) {
    const common = [...a.keys()].filter(month => b.has(month)).sort().slice(-months);
    if (common.length < minMonths) return { correlation: null, months: common.length };
    return {
        correlation: pearson(common.map(month => a.get(month)), common.map(month => b.get(month))),
        months: common.length
    };
}

// Every pair of funds, most alike first. funds: [{ schemeCode, shortName, series }].
function returnCorrelations(funds, today, options = {}) {
    const returns = funds.map(fund => monthlyReturns(fund.series, today));
    const pairs = [];

    for (let i = 0; i < funds.length; i++) {
        for (let j = i + 1; j < funds.length; j++) {
            const { correlation, months } = correlationOf(returns[i], returns[j], options);
            pairs.push({
                a: { schemeCode: funds[i].schemeCode, shortName: funds[i].shortName },
                b: { schemeCode: funds[j].schemeCode, shortName: funds[j].shortName },
                correlation,
                months
            });
        }
    }

    return pairs.sort((x, y) => (y.correlation ?? -2) - (x.correlation ?? -2));
}

// How alike two funds' monthly returns are, in words.
function correlationLabel(correlation) {
    if (correlation === null || correlation === undefined) return "not enough shared history";
    if (correlation >= 0.95) return "move almost identically";
    if (correlation >= 0.85) return "move very similarly";
    if (correlation >= 0.7) return "are related";
    return "behave differently";
}

// The portfolio's monthly return if today's mix had been held throughout:
// each month weights the funds that existed then by today's value. A month
// counts only if funds holding at least `minCoverage` of today's value
// existed then, so one old fund's history isn't passed off as the portfolio's.
// funds: [{ series, value }]. Returns Map "YYYY-MM" -> return.
function blendedMonthlyReturns(funds, today, { minCoverage = 0 } = {}) {
    const returns = funds.map(fund => monthlyReturns(fund.series, today));
    const months = new Set(returns.flatMap(map => [...map.keys()]));
    const totalValue = funds.reduce((sum, fund) => sum + Math.max(0, fund.value), 0);
    const blended = new Map();

    for (const month of [...months].sort()) {
        let weight = 0;
        let total = 0;
        funds.forEach((fund, i) => {
            const value = returns[i].get(month);
            if (value === undefined || !(fund.value > 0)) return;
            weight += fund.value;
            total += fund.value * value;
        });
        if (weight > 0 && weight >= minCoverage * totalValue) blended.set(month, total / weight);
    }

    return blended;
}

// Annualised volatility of monthly returns over the last `months`.
function annualVolatility(returns, months = 36) {
    const values = [...returns.keys()].sort().slice(-months).map(month => returns.get(month));
    if (values.length < 12) return null;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance) * Math.sqrt(12);
}

// Worst return over any 12 consecutive months, with when it ended.
function worstTwelveMonths(returns) {
    const months = [...returns.keys()].sort();
    let worst = null;

    for (let end = 11; end < months.length; end++) {
        let growth = 1;
        for (let i = end - 11; i <= end; i++) growth *= 1 + returns.get(months[i]);
        if (!worst || growth - 1 < worst.return) worst = { return: growth - 1, from: months[end - 11], to: months[end] };
    }

    return worst;
}

module.exports = {
    pearson,
    correlationOf,
    returnCorrelations,
    correlationLabel,
    blendedMonthlyReturns,
    annualVolatility,
    worstTwelveMonths
};
