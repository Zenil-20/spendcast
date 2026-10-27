// Portfolio health score: six measurable factors, each scored 0-100 with the
// evidence behind it, and a weighted total. A factor without enough data is
// left out and the rest are re-weighted, so the score never rests on a guess;
// `coverage` says how much of the full weight was scored. It describes the
// portfolio's structure today. It does not predict returns.
// Pure functions with no database or network access.

const FACTORS = {
    concentration: { label: "Concentration", weight: 0.25 },
    overlap: { label: "Overlap between funds", weight: 0.15 },
    riskVsHorizon: { label: "Risk for your time horizon", weight: 0.2 },
    cost: { label: "Costs", weight: 0.15 },
    benchmarkRelative: { label: "Against the market", weight: 0.15 },
    allocationDrift: { label: "Drift from your target", weight: 0.1 }
};
// Look-through figures are used once holdings are known for this much of the money.
const MIN_COVERAGE = 0.6;
const BUCKETS = ["equity", "debt", "hybrid", "other"];

const pct = (value, digits = 0) => `${(value * 100).toFixed(digits)}%`;

// 100 at `best`, 0 at `worst`, straight line between (either direction).
function linear(value, best, worst) {
    const t = Math.max(0, Math.min(1, (value - worst) / (best - worst)));
    // Drop float noise first, so 12.4999999 (an exact 12.5) rounds up.
    return Math.round(Number((t * 100).toFixed(6)));
}

// Rough share of a fund held in equity, from its category.
function equityShareOf(holding) {
    const asset = (holding.assetClass || "").toLowerCase();
    const category = (holding.category || "").toLowerCase();
    if (asset === "equity") return 1;
    if (asset === "debt") return 0;
    if (asset === "hybrid") {
        if (/arbitrage/.test(category)) return 0;
        if (/aggressive/.test(category)) return 0.75;
        if (/conservative/.test(category)) return 0.2;
        if (/equity savings/.test(category)) return 0.35;
        return 0.5;
    }
    return holding.equityTaxed ? 1 : 0;
}

function bucketOf(holding) {
    const asset = (holding.assetClass || "").toLowerCase();
    if (asset === "equity" || asset === "debt" || asset === "hybrid") return asset;
    return holding.equityTaxed ? "equity" : "other";
}

// The most equity that suits a horizon: little for money needed soon.
function maxEquityFor(years) {
    if (years < 1) return 0.1;
    if (years < 3) return 0.35;
    if (years < 5) return 0.6;
    if (years < 7) return 0.8;
    return 1;
}

function unscored(key, reason) {
    return { key, ...FACTORS[key], score: null, reason, evidence: [], value: null };
}

/* ---------- Factors ---------- */

function concentrationFactor({ holdings, total, lookThrough }) {
    const largest = [...holdings].sort((a, b) => b.value - a.value)[0];
    const largestShare = largest.value / total;
    const fundScore = linear(largestShare, 0.35, 0.8);
    const value = { largestFund: { shortName: largest.shortName, share: largestShare }, effectiveHoldings: null, largestCompany: null, top10Share: null, method: "funds" };
    const evidence = [`Your largest fund, ${largest.shortName}, is ${pct(largestShare)} of your portfolio.`];
    let score = fundScore;

    const concentration = lookThrough?.concentration;
    if (lookThrough && lookThrough.coverage.share >= MIN_COVERAGE && concentration?.effectiveHoldings) {
        // A single index fund can be well spread, so what the funds own counts
        // three times as much as how many funds there are.
        const companyScore = Math.min(linear(concentration.effectiveHoldings, 30, 8), linear(concentration.largest.share, 0.08, 0.2));
        score = Math.round(companyScore * 0.75 + fundScore * 0.25);
        Object.assign(value, {
            method: "holdings",
            effectiveHoldings: concentration.effectiveHoldings,
            largestCompany: concentration.largest,
            top10Share: concentration.top10Share
        });
        evidence.push(`Across what your funds own, your money is spread like ${Math.round(concentration.effectiveHoldings)} equal holdings; the 10 largest companies are ${pct(concentration.top10Share)} of it.`);
        evidence.push(`Largest company: ${concentration.largest.name} at ${pct(concentration.largest.share, 1)}${concentration.largest.funds > 1 ? `, held through ${concentration.largest.funds} funds` : ""}.`);
    } else if (holdings.length === 1) {
        evidence.push("With one fund, everything depends on that fund's holdings, which aren't available here.");
    }

    return { key: "concentration", ...FACTORS.concentration, score, evidence, value };
}

function overlapFactor({ holdings, lookThrough, correlations }) {
    if (holdings.length < 2) return unscored("overlap", "Needs at least two funds.");
    const valueOf = new Map(holdings.map(h => [h.schemeCode, h.value]));
    const weighted = (pairs, pick) => {
        let weight = 0;
        let total = 0;
        for (const pair of pairs) {
            const w = (valueOf.get(pair.a.schemeCode) || 0) + (valueOf.get(pair.b.schemeCode) || 0);
            weight += w;
            total += w * pick(pair);
        }
        return weight ? total / weight : null;
    };

    if (lookThrough && lookThrough.coverage.share >= MIN_COVERAGE && lookThrough.pairs.length) {
        const average = weighted(lookThrough.pairs, pair => pair.overlap);
        const top = lookThrough.pairs[0];
        return {
            key: "overlap",
            ...FACTORS.overlap,
            score: linear(average, 0.2, 0.6),
            evidence: [
                `On average ${pct(average)} of one fund's money is in the same companies as another's.`,
                `${top.a.shortName} and ${top.b.shortName} overlap most: ${pct(top.overlap)}, ${top.commonCount} companies in common${top.topShared.length ? ` including ${top.topShared.slice(0, 3).join(", ")}` : ""}.`
            ],
            value: { method: "holdings", average, topPair: { a: top.a.shortName, b: top.b.shortName, overlap: top.overlap, commonCount: top.commonCount, topShared: top.topShared.slice(0, 3) } }
        };
    }

    const usable = (correlations || []).filter(pair => pair.correlation !== null);
    if (!usable.length) return unscored("overlap", "Your funds don't share 2 years of history to compare yet.");
    const average = weighted(usable, pair => pair.correlation);
    const top = usable[0];
    return {
        key: "overlap",
        ...FACTORS.overlap,
        score: linear(average, 0.6, 0.97),
        evidence: [
            `Your funds' monthly returns have a correlation of ${average.toFixed(2)} on average (1 means they move identically).`,
            `${top.a.shortName} and ${top.b.shortName} are the most alike at ${top.correlation.toFixed(2)} over ${top.months} months.`,
            "Holdings aren't available for enough of your funds, so this compares how they moved, not what they own."
        ],
        value: { method: "returns", average, topPair: { a: top.a.shortName, b: top.b.shortName, correlation: top.correlation } }
    };
}

function riskFactor({ holdings, total, profile, nearestGoalYears, volatility, worstYear }) {
    const horizonYears = profile?.horizonYears ?? nearestGoalYears ?? null;
    if (horizonYears === null) return unscored("riskVsHorizon", "Set your investment horizon, or add a goal, to score this.");
    const source = profile?.horizonYears != null ? "profile" : "goal";
    const equityShare = holdings.reduce((sum, h) => sum + equityShareOf(h) * h.value, 0) / total;
    const maxEquity = maxEquityFor(horizonYears);
    const excess = Math.max(0, equityShare - maxEquity);
    const evidence = [
        `About ${pct(equityShare)} of your money is in equity; for a ${horizonYears < 1 ? "sub-1-year" : `${Math.round(horizonYears * 10) / 10}-year`} horizon (${source === "goal" ? "your nearest goal" : "your setting"}) up to ${pct(maxEquity)} is usual.`
    ];
    if (volatility !== null && volatility !== undefined) evidence.push(`Your portfolio's mix has swung about ${pct(volatility)} a year (volatility of monthly returns).`);
    if (worstYear) {
        evidence.push(worstYear.return < 0
            ? `Its worst 12 months in the data lost ${pct(-worstYear.return)} (${worstYear.from} to ${worstYear.to}).`
            : `Even its worst 12 months in the data gained ${pct(worstYear.return)} (${worstYear.from} to ${worstYear.to}); the history is short and hasn't seen a bad year.`);
    }

    return {
        key: "riskVsHorizon",
        ...FACTORS.riskVsHorizon,
        score: excess === 0 ? 100 : linear(excess, 0, 0.4),
        evidence,
        value: { horizonYears, source, equityShare, maxEquity, volatility: volatility ?? null }
    };
}

function costFactor({ holdings, total }) {
    const known = holdings.filter(h => h.expenseRatio !== null && h.expenseRatio !== undefined);
    const knownValue = known.reduce((sum, h) => sum + h.value, 0);

    if (knownValue / total >= MIN_COVERAGE) {
        const ter = known.reduce((sum, h) => sum + h.expenseRatio * h.value, 0) / knownValue;
        const priciest = [...known].sort((a, b) => b.expenseRatio - a.expenseRatio)[0];
        return {
            key: "cost",
            ...FACTORS.cost,
            score: linear(ter, 0.005, 0.02),
            evidence: [
                `Weighted expense ratio ${pct(ter, 2)} a year, about ₹${Math.round(ter * total).toLocaleString("en-IN")} on your current value.`,
                `Most expensive: ${priciest.shortName} at ${pct(priciest.expenseRatio, 2)}.`
            ],
            value: { method: "expenseRatio", ter, priciest: { shortName: priciest.shortName, ter: priciest.expenseRatio } }
        };
    }

    // Without expense ratios, the plan type is the one cost fact we have.
    const planned = holdings.filter(h => h.plan);
    if (!planned.length) return unscored("cost", "Expense ratios and plan types aren't known for your funds.");
    const regular = planned.filter(h => h.plan === "Regular");
    const regularShare = regular.reduce((sum, h) => sum + h.value, 0) / total;
    return {
        key: "cost",
        ...FACTORS.cost,
        score: linear(regularShare, 0, 1),
        evidence: regular.length
            ? [`${pct(regularShare)} of your money is in Regular plans (${regular.map(h => h.shortName).join(", ")}), which usually cost 0.5–1% a year more than the Direct plan of the same fund.`]
            : ["All your funds are Direct plans, the lower-cost option."],
        value: { method: "plan", regularShare }
    };
}

function benchmarkFactor({ holdings }) {
    const rows = holdings
        .filter(h => h.equityTaxed)
        .map(h => {
            const threeYear = h.fundReturn3Y !== null && h.benchmarkReturn3Y !== null;
            const fund = threeYear ? h.fundReturn3Y : h.fundReturn1Y;
            const index = threeYear ? h.benchmarkReturn3Y : h.benchmarkReturn1Y;
            return fund === null || index === null ? null : { shortName: h.shortName, value: h.value, excess: fund - index, years: threeYear ? 3 : 1 };
        })
        .filter(Boolean);
    if (!rows.length) return unscored("benchmarkRelative", "Needs an equity fund with at least a year of history.");

    const weight = rows.reduce((sum, row) => sum + row.value, 0);
    const excess = rows.reduce((sum, row) => sum + row.excess * row.value, 0) / weight;
    const laggards = rows.filter(row => row.excess < -0.02).sort((a, b) => a.excess - b.excess);
    const evidence = [`Value-weighted, your equity funds returned ${excess >= 0 ? "" : "−"}${pct(Math.abs(excess), 1)} a year ${excess >= 0 ? "more" : "less"} than the Nifty 50.`];
    if (laggards.length) evidence.push(`Trailing by more than 2% a year: ${laggards.map(row => `${row.shortName} (${pct(row.excess, 1)} over ${row.years}Y)`).join(", ")}.`);
    evidence.push("Compared with the Nifty 50 for every equity fund, so mid- and small-cap funds can look better or worse than against their own index.");

    return {
        key: "benchmarkRelative",
        ...FACTORS.benchmarkRelative,
        score: linear(excess, 0.03, -0.05),
        evidence,
        value: { excess, laggards: laggards.map(row => ({ shortName: row.shortName, excess: row.excess })) }
    };
}

function driftFactor({ holdings, total, profile }) {
    const target = profile?.targetAllocation;
    if (!target) return unscored("allocationDrift", "Set a target allocation to score this.");
    const actual = Object.fromEntries(BUCKETS.map(bucket => [bucket, 0]));
    holdings.forEach(h => { actual[bucketOf(h)] += h.value / total; });
    const drift = BUCKETS.reduce((sum, bucket) => sum + Math.abs(actual[bucket] - (target[bucket] || 0)), 0) / 2;
    const widest = [...BUCKETS].sort((a, b) => Math.abs(actual[b] - (target[b] || 0)) - Math.abs(actual[a] - (target[a] || 0)))[0];

    return {
        key: "allocationDrift",
        ...FACTORS.allocationDrift,
        score: linear(drift, 0.05, 0.3),
        evidence: [
            `${pct(drift)} of your money would have to move to match your target.`,
            `Biggest gap: ${widest} at ${pct(actual[widest])} against a target of ${pct(target[widest] || 0)}.`
        ],
        value: { drift, actual, target, widest }
    };
}

/* ---------- Total ---------- */

function gradeOf(score) {
    if (score === null) return null;
    if (score >= 80) return "Strong";
    if (score >= 60) return "Fair";
    if (score >= 40) return "Needs attention";
    return "Weak";
}

// holdings: portfolio holdings plus `expenseRatio` (null when unknown).
// lookThrough: utils/lookThrough result, or null. correlations: returnStats pairs.
// profile: { horizonYears, targetAllocation } or null.
function healthScore({ holdings, lookThrough = null, correlations = [], profile = null, nearestGoalYears = null, volatility = null, worstYear = null }) {
    const live = holdings.filter(h => h.value > 0);
    const total = live.reduce((sum, h) => sum + h.value, 0);
    if (!live.length || total <= 0) return null;
    const input = { holdings: live, total, lookThrough, correlations, profile, nearestGoalYears, volatility, worstYear };

    const factors = [
        concentrationFactor(input),
        overlapFactor(input),
        riskFactor(input),
        costFactor(input),
        benchmarkFactor(input),
        driftFactor(input)
    ];
    const scored = factors.filter(f => f.score !== null);
    const weight = scored.reduce((sum, f) => sum + f.weight, 0);
    const score = weight ? Math.round(scored.reduce((sum, f) => sum + f.score * f.weight, 0) / weight) : null;

    return {
        score,
        grade: gradeOf(score),
        // Share of the full weight that could be scored.
        coverage: weight / Object.values(FACTORS).reduce((sum, f) => sum + f.weight, 0),
        factors
    };
}

/* ---------- Explaining a change ---------- */

// Points a factor adds to the total: its score times its share of the weight
// that was scored in that snapshot.
function contributions(health) {
    const scored = health.factors.filter(f => f.score !== null);
    const weight = scored.reduce((sum, f) => sum + f.weight, 0);
    return new Map(health.factors.map(f => [f.key, f.score === null || !weight ? null : (f.score * f.weight) / weight]));
}

function describe(key, before, after) {
    const b = before || {};
    const a = after || {};
    switch (key) {
        case "concentration": {
            const lines = [];
            if (a.largestFund && b.largestFund && Math.abs(a.largestFund.share - b.largestFund.share) >= 0.01) {
                lines.push(`${a.largestFund.shortName} is now ${pct(a.largestFund.share)} of your portfolio (the largest fund was ${pct(b.largestFund.share)}).`);
            }
            if (a.effectiveHoldings && b.effectiveHoldings && Math.abs(a.effectiveHoldings / b.effectiveHoldings - 1) >= 0.05) {
                lines.push(`Your money is spread like ${Math.round(a.effectiveHoldings)} equal holdings, ${a.effectiveHoldings > b.effectiveHoldings ? "up" : "down"} from ${Math.round(b.effectiveHoldings)}.`);
            }
            if (a.largestCompany && b.largestCompany && Math.abs(a.largestCompany.share - b.largestCompany.share) >= 0.005) {
                lines.push(`${a.largestCompany.name} is ${pct(a.largestCompany.share, 1)} of what you own (was ${pct(b.largestCompany.share, 1)} for ${b.largestCompany.name}).`);
            }
            return lines;
        }
        case "overlap": {
            if (a.average === undefined || b.average === undefined) return [];
            const measure = a.method === "holdings" ? "overlap" : "return correlation";
            const fmt = value => (a.method === "holdings" ? pct(value) : value.toFixed(2));
            const lines = [`Average ${measure} between your funds went from ${fmt(b.average)} to ${fmt(a.average)}.`];
            if (a.topPair?.topShared?.length) {
                lines.push(`${a.topPair.a} and ${a.topPair.b} hold many of the same companies (${a.topPair.commonCount}, including ${a.topPair.topShared.join(", ")}).`);
            }
            return lines;
        }
        case "riskVsHorizon": {
            const lines = [];
            if (a.equityShare !== undefined && b.equityShare !== undefined && Math.abs(a.equityShare - b.equityShare) >= 0.01) {
                lines.push(`Equity is ${pct(a.equityShare)} of your money, from ${pct(b.equityShare)}.`);
            }
            if (a.horizonYears !== b.horizonYears && a.horizonYears !== undefined) {
                lines.push(`Your horizon is now ${Math.round(a.horizonYears * 10) / 10} years (was ${Math.round((b.horizonYears ?? 0) * 10) / 10}), which allows up to ${pct(a.maxEquity)} in equity.`);
            }
            return lines;
        }
        case "cost":
            if (a.method === "expenseRatio" && b.method === "expenseRatio") return [`Weighted expense ratio went from ${pct(b.ter, 2)} to ${pct(a.ter, 2)}.`];
            if (a.method === "plan" && b.method === "plan") return [`Regular plans are ${pct(a.regularShare)} of your money, from ${pct(b.regularShare)}.`];
            return [`Costs are now measured by ${a.method === "expenseRatio" ? "expense ratios" : "plan type"}.`];
        case "benchmarkRelative": {
            const lines = [];
            if (a.excess !== undefined && b.excess !== undefined) lines.push(`Your equity funds are ${pct(a.excess, 1)} a year against the Nifty 50, from ${pct(b.excess, 1)}.`);
            const newLaggards = (a.laggards || []).filter(item => !(b.laggards || []).some(old => old.shortName === item.shortName));
            if (newLaggards.length) lines.push(`Now trailing by more than 2% a year: ${newLaggards.map(item => item.shortName).join(", ")}.`);
            return lines;
        }
        case "allocationDrift":
            if (a.drift === undefined || b.drift === undefined) return [];
            return [`Drift from your target went from ${pct(b.drift)} to ${pct(a.drift)}; the widest gap is in ${a.widest}.`];
        default:
            return [];
    }
}

// Why the score moved between two health results (or stored snapshots with
// the same shape). Each reason carries the points it moved the total by.
function explainChange(previous, current) {
    if (!previous || !current || previous.score === null || current.score === null) return null;
    const before = contributions(previous);
    const after = contributions(current);
    const prevFactors = new Map(previous.factors.map(f => [f.key, f]));
    const reasons = [];

    for (const factor of current.factors) {
        const old = prevFactors.get(factor.key);
        const was = before.get(factor.key) ?? null;
        const now = after.get(factor.key) ?? null;

        if (was === null && now === null) continue;
        if (was === null || now === null) {
            reasons.push({
                key: factor.key,
                label: factor.label,
                impact: (now ?? 0) - (was ?? 0),
                text: now === null ? `${factor.label} is no longer scored: ${factor.reason}` : `${factor.label} is now scored (${factor.score}/100).`,
                details: []
            });
            continue;
        }

        const impact = now - was;
        if (Math.abs(impact) < 0.5 && Math.abs(factor.score - old.score) < 3) continue;
        reasons.push({
            key: factor.key,
            label: factor.label,
            impact,
            text: `${factor.label} ${factor.score > old.score ? "improved" : factor.score < old.score ? "worsened" : "held"} from ${old.score} to ${factor.score}.`,
            details: describe(factor.key, old.value, factor.value)
        });
    }

    reasons.sort((x, y) => Math.abs(y.impact) - Math.abs(x.impact));
    return { from: previous.score, to: current.score, change: current.score - previous.score, reasons };
}

// The compact form kept in daily snapshots.
function snapshotOf(health) {
    return health && {
        score: health.score,
        coverage: health.coverage,
        factors: health.factors.map(f => ({ key: f.key, label: f.label, weight: f.weight, score: f.score, reason: f.reason || null, value: f.value }))
    };
}

module.exports = {
    FACTORS,
    MIN_COVERAGE,
    linear,
    equityShareOf,
    bucketOf,
    maxEquityFor,
    gradeOf,
    healthScore,
    explainChange,
    snapshotOf
};
