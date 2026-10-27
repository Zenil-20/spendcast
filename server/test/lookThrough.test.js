const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizePortfolio, normalizeCompanyName, companyKey, weightOverlap, lookThrough, diversificationImpact } = require('../utils/lookThrough');

const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} is not close to ${expected}`);

const RELIANCE = 'INE002A01018';
const HDFC = 'INE040A01034';
const INFY = 'INE009A01021';
const TCS = 'INE467B01029';

function fund(schemeCode, value, holdings, extra = {}) {
    return {
        schemeCode,
        shortName: `Fund ${schemeCode}`,
        value,
        portfolio: holdings && normalizePortfolio({ asOf: '2026-09-30', holdings, ...extra })
    };
}

/* ---------- normalizePortfolio ---------- */

test('normalizePortfolio reads percentages, merges repeated companies and sorts by weight', () => {
    const result = normalizePortfolio({
        asOf: '2026-09-30',
        expenseRatio: 0.65,
        holdings: [
            { isin: RELIANCE, name: 'Reliance Industries Ltd.', sector: 'Energy', weight: 6 },
            { isin: HDFC, name: 'HDFC Bank', sector: 'Financials', weight: 9 },
            // The same company listed twice (e.g. two share classes) is merged.
            { isin: RELIANCE.toLowerCase(), name: 'RELIANCE INDUSTRIES LIMITED', sector: 'Energy', weight: 2 },
            { name: 'TREPS', assetType: 'cash', weight: 3 }
        ]
    });

    assert.equal(result.expenseRatio, 0.0065);
    assert.deepEqual(result.holdings.map(h => h.name), ['HDFC Bank', 'Reliance Industries Ltd.', 'TREPS']);
    close(result.holdings[1].weight, 0.08);
    assert.equal(result.holdings[2].assetType, 'cash');
    assert.equal(result.holdings[2].isin, null);
});

test('normalizePortfolio keeps fractions as they are', () => {
    const result = normalizePortfolio({ asOf: '2026-09-30', expenseRatio: 0.0045, holdings: [{ isin: HDFC, name: 'HDFC Bank', weight: 0.5 }, { isin: INFY, name: 'Infosys', weight: 0.4 }] });
    close(result.holdings[0].weight, 0.5);
    assert.equal(result.expenseRatio, 0.0045);
});

test('normalizePortfolio rejects disclosures it cannot trust', () => {
    const base = { asOf: '2026-09-30', holdings: [{ name: 'HDFC Bank', weight: 50 }] };
    assert.throws(() => normalizePortfolio({ ...base, asOf: '30-09-2026' }), /asOf/);
    assert.throws(() => normalizePortfolio({ ...base, holdings: [] }), /non-empty/);
    assert.throws(() => normalizePortfolio({ ...base, holdings: [{ name: '', weight: 5 }] }), /name/);
    assert.throws(() => normalizePortfolio({ ...base, holdings: [{ name: 'X', weight: -1 }] }), /weight/);
    assert.throws(() => normalizePortfolio({ ...base, holdings: [{ name: 'X', weight: 70 }, { name: 'Y', weight: 60 }] }), /more than 100%/);
    assert.throws(() => normalizePortfolio({ ...base, expenseRatio: 4 }), /expenseRatio/);
});

test('companies without an ISIN are matched by a normalised name', () => {
    assert.equal(normalizeCompanyName('Larsen & Toubro Ltd.'), normalizeCompanyName('LARSEN AND TOUBRO LIMITED'));
    assert.equal(companyKey({ isin: null, name: 'The Tata Power Co. Ltd' }), companyKey({ isin: null, name: 'Tata Power Company Limited' }));
    assert.equal(companyKey({ isin: HDFC, name: 'anything' }), HDFC);
});

/* ---------- weightOverlap ---------- */

test('weightOverlap is 1 for identical portfolios, 0 for disjoint ones, and sums the smaller weights', () => {
    const a = new Map([['x', 0.5], ['y', 0.5]]);
    assert.equal(weightOverlap(a, a).overlap, 1);
    assert.equal(weightOverlap(a, new Map([['z', 1]])).overlap, 0);
    const result = weightOverlap(a, new Map([['x', 0.2], ['y', 0.7], ['z', 0.1]]));
    close(result.overlap, 0.7);
    assert.equal(result.common, 2);
});

/* ---------- lookThrough ---------- */

test('lookThrough adds up exposure to each company across funds', () => {
    const funds = [
        fund(1, 100000, [{ isin: HDFC, name: 'HDFC Bank', sector: 'Financials', weight: 10 }, { isin: RELIANCE, name: 'Reliance', sector: 'Energy', weight: 8 }, { isin: INFY, name: 'Infosys', sector: 'IT', weight: 82 }]),
        fund(2, 50000, [{ isin: HDFC, name: 'HDFC Bank', sector: 'Financials', weight: 20 }, { isin: TCS, name: 'TCS', sector: 'IT', weight: 80 }])
    ];
    const result = lookThrough(funds, { today: '2026-10-25' });

    const hdfc = result.companies.find(c => c.isin === HDFC);
    // ₹10,000 through fund 1 and ₹10,000 through fund 2.
    close(hdfc.amount, 20000, 1e-6);
    close(hdfc.share, 20000 / 150000);
    assert.equal(hdfc.funds.length, 2);

    assert.equal(result.commonCount, 1);
    assert.deepEqual(result.common.map(c => c.isin), [HDFC]);
    assert.equal(result.coverage.share, 1);
    assert.equal(result.coverage.funds.every(f => !f.stale), true);
    assert.equal(result.pairs.length, 1);
    close(result.pairs[0].overlap, 0.1);
    assert.deepEqual(result.pairs[0].topShared, ['HDFC Bank']);
});

test('lookThrough reports sectors two funds both lean on as duplicated', () => {
    const funds = [
        fund(1, 100000, [{ isin: HDFC, name: 'HDFC Bank', sector: 'Financials', weight: 30 }, { isin: INFY, name: 'Infosys', sector: 'IT', weight: 70 }]),
        fund(2, 100000, [{ isin: 'INE090A01021', name: 'ICICI Bank', sector: 'Financials', weight: 40 }, { isin: TCS, name: 'TCS', sector: 'IT', weight: 5 }, { isin: RELIANCE, name: 'Reliance', sector: 'Energy', weight: 55 }])
    ];
    const result = lookThrough(funds);
    const byName = Object.fromEntries(result.sectors.map(s => [s.sector, s]));

    // Different banks, same sector: the overlap is in the sector, not the names.
    assert.equal(result.commonCount, 0);
    assert.equal(byName.Financials.duplicated, true);
    close(byName.Financials.share, 0.35);
    // TCS is only 5% of fund 2, so IT isn't a duplicated bet.
    assert.equal(byName.IT.duplicated, false);
});

test('lookThrough treats undisclosed weight and cash lines as cash, and measures concentration', () => {
    const funds = [fund(1, 100000, [{ isin: HDFC, name: 'HDFC Bank', weight: 45 }, { isin: INFY, name: 'Infosys', weight: 45 }, { name: 'TREPS', assetType: 'cash', weight: 4 }])];
    const result = lookThrough(funds);

    // 4% TREPS plus the 6% the disclosure doesn't account for.
    close(result.cash.amount, 10000, 1e-6);
    // Two equal holdings: effective number 2, Herfindahl 0.5.
    close(result.concentration.hhi, 0.5);
    close(result.concentration.effectiveHoldings, 2);
    close(result.concentration.top10Share, 1);
});

test('lookThrough shows what share of the money it could look through', () => {
    const funds = [
        fund(1, 30000, [{ isin: HDFC, name: 'HDFC Bank', weight: 100 }]),
        fund(2, 70000, null)
    ];
    const result = lookThrough(funds, { today: '2027-06-01' });

    close(result.coverage.share, 0.3);
    assert.deepEqual(result.coverage.missing.map(f => f.schemeCode), [2]);
    // Shares are of the money looked through, the portfolio share of all of it.
    close(result.companies[0].share, 1);
    close(result.companies[0].portfolioShare, 0.3);
    // A September disclosure is stale by June.
    assert.equal(result.coverage.funds[0].stale, true);
});

test('lookThrough with no disclosures returns empty, not errors', () => {
    const result = lookThrough([fund(1, 1000, null)]);
    assert.equal(result.coverage.share, 0);
    assert.equal(result.companyCount, 0);
    assert.equal(result.concentration.effectiveHoldings, null);
    assert.deepEqual(result.pairs, []);
});

/* ---------- diversificationImpact ---------- */

const largeCapA = [{ isin: HDFC, name: 'HDFC Bank', weight: 25 }, { isin: RELIANCE, name: 'Reliance', weight: 25 }, { isin: INFY, name: 'Infosys', weight: 25 }, { isin: TCS, name: 'TCS', weight: 25 }];

test('diversificationImpact: a fund holding the same companies duplicates', () => {
    const current = [fund(1, 100000, largeCapA)];
    const candidate = fund(9, 50000, [{ isin: HDFC, name: 'HDFC Bank', weight: 30 }, { isin: RELIANCE, name: 'Reliance', weight: 30 }, { isin: INFY, name: 'Infosys', weight: 20 }, { isin: TCS, name: 'TCS', weight: 20 }]);
    const result = diversificationImpact(current, candidate);

    assert.equal(result.verdict, 'duplicates');
    close(result.overlapWithPortfolio, 0.9);
    assert.equal(result.newHoldings, 0);
    assert.ok(result.reasons.some(text => /already own/.test(text)));
});

test('diversificationImpact: a fund of different companies improves the spread', () => {
    const current = [fund(1, 100000, largeCapA)];
    const others = Array.from({ length: 20 }, (_, i) => ({ isin: `INE${String(100000 + i).padStart(8, '0')}1`, name: `Smallco ${i}`, weight: 5 }));
    const result = diversificationImpact(current, fund(9, 100000, others));

    assert.equal(result.verdict, 'improves');
    assert.equal(result.overlapWithPortfolio, 0);
    assert.equal(result.newHoldings, 20);
    assert.ok(result.effectiveHoldings.after > result.effectiveHoldings.before * 2);
    assert.ok(result.top10Share.after < result.top10Share.before);
});

test('diversificationImpact needs holdings on both sides', () => {
    assert.equal(diversificationImpact([fund(1, 100, largeCapA)], fund(9, 100, null)), null);
    assert.equal(diversificationImpact([fund(1, 100, null)], fund(9, 100, largeCapA)), null);
});
