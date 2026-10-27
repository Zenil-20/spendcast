// Look-through exposure: what a portfolio of funds actually owns, company by
// company and sector by sector, from each fund's disclosed holdings. Pure
// functions with no database or network access.
//
// A fund portfolio is { asOf: "YYYY-MM-DD", expenseRatio, holdings: [{ isin,
// name, sector, assetType, weight }] } with weights as fractions of the fund
// (0.083 = 8.3%). Disclosures are monthly, so every figure here is "as of"
// the disclosure dates, not today.

const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const ASSET_TYPES = ["equity", "debt", "cash", "other"];
// A sector counts as duplicated when at least two funds put this much of
// their own money in it.
const SECTOR_DUPLICATE_WEIGHT = 0.1;
// Disclosures older than this are flagged as stale.
const STALE_AFTER_DAYS = 120;
const CASH_LABEL = "Cash & others";

/* ---------- Validating imported disclosures ---------- */

function cleanName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

// "Reliance Industries Ltd." and "RELIANCE INDUSTRIES LIMITED" are the same company.
function normalizeCompanyName(name) {
    return cleanName(name)
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\b(limited|ltd|the|co|company|corp|corporation|inc)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// Holdings are matched across funds by ISIN, or by name when a disclosure
// doesn't give one.
function companyKey(holding) {
    return holding.isin ? holding.isin : `name:${normalizeCompanyName(holding.name)}`;
}

// Validates one fund's disclosure and puts it in a standard shape. Weights may
// be fractions or percentages (detected from their total). Repeated lines for
// the same company are merged. Throws an Error naming the problem.
function normalizePortfolio(raw) {
    if (!raw || typeof raw !== "object") throw new Error("portfolio must be an object.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.asOf || "")) throw new Error("asOf must be a date in YYYY-MM-DD format.");
    if (!Array.isArray(raw.holdings) || raw.holdings.length === 0) throw new Error("holdings must be a non-empty list.");

    let expenseRatio = null;
    if (raw.expenseRatio !== undefined && raw.expenseRatio !== null && raw.expenseRatio !== "") {
        expenseRatio = Number(raw.expenseRatio);
        // Given as a percentage (0.65) or a fraction (0.0065)? TERs are below 3%.
        if (Number.isFinite(expenseRatio) && expenseRatio >= 0.05) expenseRatio /= 100;
        if (!Number.isFinite(expenseRatio) || expenseRatio < 0 || expenseRatio > 0.03) {
            throw new Error("expenseRatio must be between 0% and 3%.");
        }
        expenseRatio = Math.round(expenseRatio * 1e6) / 1e6;
    }

    const rows = raw.holdings.map((item, i) => {
        const name = cleanName(item?.name);
        const weight = Number(item?.weight);
        if (!name) throw new Error(`holdings[${i}].name is required.`);
        if (!Number.isFinite(weight) || weight < 0) throw new Error(`holdings[${i}].weight must be a number, 0 or more.`);
        const isin = typeof item.isin === "string" && ISIN_PATTERN.test(item.isin.trim().toUpperCase()) ? item.isin.trim().toUpperCase() : null;
        const assetType = ASSET_TYPES.includes(item.assetType) ? item.assetType : "equity";
        return { isin, name, sector: cleanName(item.sector) || null, assetType, weight };
    });

    const total = rows.reduce((sum, row) => sum + row.weight, 0);
    // Percentages add up to about 100; fractions to about 1.
    const scale = total > 1.5 ? 100 : 1;
    if (total / scale > 1.02) throw new Error(`holdings weights add up to ${(total / scale * 100).toFixed(1)}%, more than 100%.`);

    const merged = new Map();
    for (const row of rows) {
        const holding = { ...row, weight: row.weight / scale };
        const key = companyKey(holding);
        const existing = merged.get(key);
        if (existing) existing.weight += holding.weight;
        else merged.set(key, holding);
    }

    return {
        asOf: raw.asOf,
        expenseRatio,
        holdings: [...merged.values()].filter(row => row.weight > 0).sort((a, b) => b.weight - a.weight)
    };
}

/* ---------- Look-through exposure ---------- */

function daysBetween(from, to) {
    return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
}

// Weight of each company in one fund, cash and the like left out.
function companyWeights(portfolio) {
    const weights = new Map();
    for (const holding of portfolio.holdings) {
        if (holding.assetType === "cash") continue;
        weights.set(companyKey(holding), (weights.get(companyKey(holding)) || 0) + holding.weight);
    }
    return weights;
}

// Share of two portfolios that is the same: the sum over companies of the
// smaller of the two weights. 1 means identical, 0 means nothing in common.
function weightOverlap(a, b) {
    let overlap = 0;
    let common = 0;
    for (const [key, weight] of a) {
        if (b.has(key)) {
            overlap += Math.min(weight, b.get(key));
            common += 1;
        }
    }
    return { overlap, common };
}

// funds: [{ schemeCode, shortName, value, portfolio | null }]
// Amounts are in rupees; shares are of the money whose holdings are known
// (`coverage.value`), since the rest can't be looked through.
function lookThrough(funds, { today = null, topCompanies = 25 } = {}) {
    const total = funds.reduce((sum, fund) => sum + Math.max(0, fund.value), 0);
    const covered = funds.filter(fund => fund.portfolio && fund.value > 0);
    const coveredValue = covered.reduce((sum, fund) => sum + fund.value, 0);
    const companies = new Map();
    const sectors = new Map();
    let cash = 0;

    for (const fund of covered) {
        let weightSum = 0;
        const fundSectors = new Map();

        for (const holding of fund.portfolio.holdings) {
            const amount = fund.value * holding.weight;
            weightSum += holding.weight;

            if (holding.assetType === "cash") {
                cash += amount;
                continue;
            }

            const key = companyKey(holding);
            const entry = companies.get(key) || {
                key,
                isin: holding.isin,
                name: holding.name,
                sector: holding.sector,
                assetType: holding.assetType,
                amount: 0,
                funds: []
            };
            entry.amount += amount;
            const inFund = entry.funds.find(item => item.schemeCode === fund.schemeCode);
            if (inFund) {
                inFund.weight += holding.weight;
                inFund.amount += amount;
            } else {
                entry.funds.push({ schemeCode: fund.schemeCode, shortName: fund.shortName, weight: holding.weight, amount });
            }
            companies.set(key, entry);

            if (holding.assetType === "equity") {
                const sector = holding.sector || "Unclassified";
                fundSectors.set(sector, (fundSectors.get(sector) || 0) + holding.weight);
            }
        }

        // Whatever the disclosure doesn't account for is treated as cash.
        cash += fund.value * Math.max(0, 1 - weightSum);

        for (const [sector, weight] of fundSectors) {
            const entry = sectors.get(sector) || { sector, amount: 0, funds: [] };
            entry.amount += fund.value * weight;
            entry.funds.push({ schemeCode: fund.schemeCode, shortName: fund.shortName, weight, amount: fund.value * weight });
            sectors.set(sector, entry);
        }
    }

    const list = [...companies.values()]
        .map(entry => ({
            ...entry,
            share: coveredValue ? entry.amount / coveredValue : 0,
            portfolioShare: total ? entry.amount / total : 0,
            funds: entry.funds.sort((a, b) => b.amount - a.amount)
        }))
        .sort((a, b) => b.amount - a.amount);

    const equityValue = [...sectors.values()].reduce((sum, entry) => sum + entry.amount, 0);
    const sectorList = [...sectors.values()]
        .map(entry => {
            const heavy = entry.funds.filter(item => item.weight >= SECTOR_DUPLICATE_WEIGHT);
            return {
                ...entry,
                share: equityValue ? entry.amount / equityValue : 0,
                funds: entry.funds.sort((a, b) => b.amount - a.amount),
                // At least two funds each put a large part of their money here.
                duplicated: heavy.length >= 2,
                heavyFunds: heavy.length
            };
        })
        .sort((a, b) => b.amount - a.amount);

    // Every pair of funds whose holdings are known.
    const weights = covered.map(fund => companyWeights(fund.portfolio));
    const pairs = [];
    for (let i = 0; i < covered.length; i++) {
        for (let j = i + 1; j < covered.length; j++) {
            const { overlap, common } = weightOverlap(weights[i], weights[j]);
            const shared = [...weights[i].keys()]
                .filter(key => weights[j].has(key))
                .map(key => ({ name: companies.get(key).name, weight: Math.min(weights[i].get(key), weights[j].get(key)) }))
                .sort((a, b) => b.weight - a.weight)
                .slice(0, 5)
                .map(item => item.name);
            pairs.push({
                a: { schemeCode: covered[i].schemeCode, shortName: covered[i].shortName },
                b: { schemeCode: covered[j].schemeCode, shortName: covered[j].shortName },
                overlap,
                commonCount: common,
                topShared: shared
            });
        }
    }
    pairs.sort((x, y) => y.overlap - x.overlap);

    // Concentration across underlying companies: the Herfindahl index and the
    // "effective number" of equally sized holdings it corresponds to.
    const exposed = list.reduce((sum, entry) => sum + entry.amount, 0);
    const hhi = exposed > 0 ? list.reduce((sum, entry) => sum + (entry.amount / exposed) ** 2, 0) : null;
    const top10 = exposed > 0 ? list.slice(0, 10).reduce((sum, entry) => sum + entry.amount, 0) / exposed : null;

    return {
        coverage: {
            value: coveredValue,
            total,
            share: total ? coveredValue / total : 0,
            funds: covered.map(fund => ({
                schemeCode: fund.schemeCode,
                shortName: fund.shortName,
                asOf: fund.portfolio.asOf,
                stale: today ? daysBetween(fund.portfolio.asOf, today) > STALE_AFTER_DAYS : false
            })),
            missing: funds.filter(fund => !fund.portfolio && fund.value > 0).map(fund => ({ schemeCode: fund.schemeCode, shortName: fund.shortName, value: fund.value }))
        },
        companyCount: list.length,
        companies: list.slice(0, topCompanies),
        // Companies held through two or more funds: the hidden overlap.
        common: list.filter(entry => entry.funds.length >= 2).slice(0, topCompanies),
        commonCount: list.filter(entry => entry.funds.length >= 2).length,
        commonShare: exposed > 0 ? list.filter(entry => entry.funds.length >= 2).reduce((sum, entry) => sum + entry.amount, 0) / exposed : 0,
        sectors: sectorList,
        pairs,
        cash: { label: CASH_LABEL, amount: cash, share: coveredValue ? cash / coveredValue : 0 },
        concentration: {
            hhi,
            effectiveHoldings: hhi ? 1 / hhi : null,
            top10Share: top10,
            largest: list[0] ? { name: list[0].name, share: exposed ? list[0].amount / exposed : 0, funds: list[0].funds.length } : null
        }
    };
}

/* ---------- Does another fund add diversification? ---------- */

// Compares the portfolio with and without `candidate` ({ schemeCode,
// shortName, value, portfolio }), using disclosed holdings. Returns null when
// either side has no holdings to compare.
function diversificationImpact(funds, candidate) {
    if (!candidate.portfolio) return null;
    const before = lookThrough(funds, { topCompanies: Infinity });
    const exposedValue = before.companies.reduce((sum, entry) => sum + entry.amount, 0);
    if (exposedValue <= 0) return null;

    const after = lookThrough([...funds, candidate]);
    // What the portfolio owns today, as weights of the money looked through.
    const portfolioWeights = new Map(before.companies.map(entry => [entry.key, entry.amount / exposedValue]));

    const candidateWeights = companyWeights(candidate.portfolio);
    const { overlap } = weightOverlap(candidateWeights, portfolioWeights);
    const fresh = [...candidateWeights.entries()].filter(([key]) => !portfolioWeights.has(key));
    const freshWeight = fresh.reduce((sum, [, weight]) => sum + weight, 0);

    const effBefore = before.concentration.effectiveHoldings;
    const effAfter = after.concentration.effectiveHoldings;
    const effChange = effBefore ? effAfter / effBefore - 1 : null;
    const top10Change = before.concentration.top10Share !== null && after.concentration.top10Share !== null
        ? after.concentration.top10Share - before.concentration.top10Share
        : null;

    // Most of the candidate is already owned, or the spread barely changes.
    let verdict = "marginal";
    if (overlap >= 0.6 || (effChange !== null && effChange < 0.03)) verdict = "duplicates";
    else if (overlap < 0.4 && effChange !== null && effChange >= 0.1) verdict = "improves";

    const pct = value => `${(value * 100).toFixed(0)}%`;
    const reasons = [
        `${pct(overlap)} of ${candidate.shortName} is in companies you already own through your funds.`,
        `${fresh.length} of its holdings (${pct(freshWeight)} of the fund) would be new to you.`
    ];
    if (effChange !== null) {
        reasons.push(`Your money would be spread like ${Math.round(effAfter)} equal holdings instead of ${Math.round(effBefore)} (${effChange >= 0 ? "+" : ""}${pct(effChange)}).`);
    }
    if (top10Change !== null && Math.abs(top10Change) >= 0.005) {
        reasons.push(`Your 10 largest companies would go from ${pct(before.concentration.top10Share)} to ${pct(after.concentration.top10Share)} of what you own.`);
    }

    return {
        method: "holdings",
        verdict,
        overlapWithPortfolio: overlap,
        newHoldings: fresh.length,
        newWeight: freshWeight,
        effectiveHoldings: { before: effBefore, after: effAfter, change: effChange },
        top10Share: { before: before.concentration.top10Share, after: after.concentration.top10Share },
        reasons
    };
}

module.exports = {
    ASSET_TYPES,
    SECTOR_DUPLICATE_WEIGHT,
    STALE_AFTER_DAYS,
    normalizeCompanyName,
    companyKey,
    normalizePortfolio,
    weightOverlap,
    lookThrough,
    diversificationImpact
};
