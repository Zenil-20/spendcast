// Disclosed fund holdings and expense ratios (see models/FundPortfolio.js):
// the latest disclosure per scheme, cached briefly, and the import used by
// scripts/import-fund-portfolios.js.

const FundPortfolio = require("../models/FundPortfolio");
const { normalizePortfolio } = require("../utils/lookThrough");

// Disclosures change monthly, so a short cache only saves repeated reads.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

// Map schemeCode -> { asOf, expenseRatio, holdings } for each code that has a
// disclosure. Codes without one are simply missing from the map.
async function latestPortfolios(schemeCodes) {
    const now = Date.now();
    const result = new Map();
    const missing = [];

    for (const code of new Set(schemeCodes)) {
        const cached = cache.get(code);
        if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
            if (cached.portfolio) result.set(code, cached.portfolio);
        } else {
            missing.push(code);
        }
    }

    if (missing.length) {
        const docs = await FundPortfolio.aggregate([
            { $match: { schemeCode: { $in: missing } } },
            { $sort: { schemeCode: 1, asOf: -1 } },
            { $group: { _id: "$schemeCode", asOf: { $first: "$asOf" }, expenseRatio: { $first: "$expenseRatio" }, holdings: { $first: "$holdings" } } }
        ]);
        const found = new Map(docs.map(doc => [doc._id, { asOf: doc.asOf, expenseRatio: doc.expenseRatio, holdings: doc.holdings }]));

        for (const code of missing) {
            const portfolio = found.get(code) || null;
            cache.set(code, { portfolio, loadedAt: now });
            if (portfolio) result.set(code, portfolio);
        }
    }

    return result;
}

// Validates and stores disclosures. entries: [{ schemeCodes: [Number], asOf,
// expenseRatio?, holdings }]. Returns counts; a bad entry is reported, not
// stored, and doesn't stop the others.
async function importPortfolios(entries, source) {
    const report = { stored: 0, rejected: [] };

    for (const [i, entry] of entries.entries()) {
        let portfolio;
        const codes = Array.isArray(entry?.schemeCodes) ? entry.schemeCodes.map(Number) : [];

        try {
            if (!codes.length || codes.some(code => !Number.isInteger(code) || code <= 0)) {
                throw new Error("schemeCodes must be a non-empty list of scheme codes.");
            }
            portfolio = normalizePortfolio(entry);
        } catch (error) {
            report.rejected.push({ index: i, schemeCodes: entry?.schemeCodes, error: error.message });
            continue;
        }

        for (const schemeCode of codes) {
            await FundPortfolio.updateOne(
                { schemeCode, asOf: portfolio.asOf },
                { $set: { holdings: portfolio.holdings, expenseRatio: portfolio.expenseRatio, source } },
                { upsert: true, runValidators: true }
            );
            cache.delete(schemeCode);
            report.stored += 1;
        }
    }

    return report;
}

module.exports = { latestPortfolios, importPortfolios };
