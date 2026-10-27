const test = require('node:test');
const assert = require('node:assert/strict');

const { linear, equityShareOf, maxEquityFor, healthScore, explainChange, snapshotOf, gradeOf } = require('../utils/healthScore');

const holding = (overrides = {}) => ({
    schemeCode: 1,
    shortName: 'Flexi Cap',
    value: 100000,
    assetClass: 'Equity',
    category: 'Flexi Cap Fund',
    plan: 'Direct',
    equityTaxed: true,
    fundReturn3Y: 0.15,
    benchmarkReturn3Y: 0.14,
    fundReturn1Y: 0.1,
    benchmarkReturn1Y: 0.1,
    expenseRatio: null,
    ...overrides
});
const factor = (result, key) => result.factors.find(f => f.key === key);

test('linear scores 100 at best, 0 at worst, in either direction, clamped', () => {
    assert.equal(linear(0.35, 0.35, 0.8), 100);
    assert.equal(linear(0.8, 0.35, 0.8), 0);
    assert.equal(linear(0.575, 0.35, 0.8), 50);
    assert.equal(linear(30, 30, 8), 100);
    assert.equal(linear(100, 30, 8), 100);
    assert.equal(linear(-1, 1, 0), 0);
    assert.equal(linear(0.125, 1, 0), 13);
});

test('equity share comes from the category, and horizons cap it', () => {
    assert.equal(equityShareOf({ assetClass: 'Equity' }), 1);
    assert.equal(equityShareOf({ assetClass: 'Debt' }), 0);
    assert.equal(equityShareOf({ assetClass: 'Hybrid', category: 'Arbitrage Fund' }), 0);
    assert.equal(equityShareOf({ assetClass: 'Hybrid', category: 'Aggressive Hybrid Fund' }), 0.75);
    assert.equal(equityShareOf({ assetClass: 'Other', equityTaxed: true }), 1);
    assert.equal(maxEquityFor(0.5), 0.1);
    assert.equal(maxEquityFor(2), 0.35);
    assert.equal(maxEquityFor(10), 1);
});

test('factors without data are left out and the rest re-weighted, with coverage reported', () => {
    const result = healthScore({ holdings: [holding()] });
    const scored = result.factors.filter(f => f.score !== null).map(f => f.key);

    // One fund, no horizon, no target: overlap, risk and drift can't be scored.
    assert.deepEqual(scored, ['concentration', 'cost', 'benchmarkRelative']);
    assert.match(factor(result, 'overlap').reason, /two funds/);
    assert.match(factor(result, 'riskVsHorizon').reason, /horizon/);
    assert.match(factor(result, 'allocationDrift').reason, /target/);
    assert.ok(Math.abs(result.coverage - 0.55) < 1e-9);
    // Weighted mean of the scored factors only.
    const expected = Math.round((factor(result, 'concentration').score * 0.25 + factor(result, 'cost').score * 0.15 + factor(result, 'benchmarkRelative').score * 0.15) / 0.55);
    assert.equal(result.score, expected);
    assert.equal(result.grade, gradeOf(result.score));
});

test('concentration: fund-level without holdings, company-level once looked through', () => {
    const holdings = [holding({ schemeCode: 1, value: 800000 }), holding({ schemeCode: 2, shortName: 'Small Cap', value: 200000 })];
    const fundLevel = factor(healthScore({ holdings }), 'concentration');
    assert.equal(fundLevel.value.method, 'funds');
    assert.equal(fundLevel.score, 0);
    assert.match(fundLevel.evidence[0], /Flexi Cap, is 80%/);

    const lookThrough = {
        coverage: { share: 1 },
        pairs: [],
        concentration: { effectiveHoldings: 40, top10Share: 0.35, largest: { name: 'HDFC Bank', share: 0.06, funds: 2 } }
    };
    const companyLevel = factor(healthScore({ holdings, lookThrough }), 'concentration');
    assert.equal(companyLevel.value.method, 'holdings');
    // 100 for spread across companies, 0 for the 80% fund: 75/25.
    assert.equal(companyLevel.score, 75);
    assert.ok(companyLevel.evidence.some(text => /HDFC Bank at 6.0%, held through 2 funds/.test(text)));
});

test('overlap uses holdings when known, return correlation otherwise', () => {
    const holdings = [holding({ schemeCode: 1 }), holding({ schemeCode: 2, shortName: 'Large Cap' })];
    const pair = { a: { schemeCode: 1, shortName: 'Flexi Cap' }, b: { schemeCode: 2, shortName: 'Large Cap' } };

    const byHoldings = factor(healthScore({ holdings, lookThrough: { coverage: { share: 0.9 }, concentration: {}, pairs: [{ ...pair, overlap: 0.6, commonCount: 38, topShared: ['HDFC Bank', 'ICICI Bank', 'Infosys'] }] } }), 'overlap');
    assert.equal(byHoldings.value.method, 'holdings');
    assert.equal(byHoldings.score, 0);
    assert.ok(byHoldings.evidence.some(text => /38 companies in common including HDFC Bank, ICICI Bank, Infosys/.test(text)));

    const byReturns = factor(healthScore({ holdings, correlations: [{ ...pair, correlation: 0.6, months: 36 }] }), 'overlap');
    assert.equal(byReturns.value.method, 'returns');
    assert.equal(byReturns.score, 100);
    assert.ok(byReturns.evidence.some(text => /move identically/.test(text)));
});

test('risk vs horizon: all-equity is fine for 10 years, not for 2', () => {
    const holdings = [holding()];
    assert.equal(factor(healthScore({ holdings, profile: { horizonYears: 10 } }), 'riskVsHorizon').score, 100);
    const short = factor(healthScore({ holdings, nearestGoalYears: 2, volatility: 0.16, worstYear: { return: -0.24, from: '2020-02', to: '2021-01' } }), 'riskVsHorizon');
    // 100% equity against a 35% guide: 65 points over.
    assert.equal(short.score, 0);
    assert.equal(short.value.source, 'goal');
    assert.ok(short.evidence.some(text => /lost 24%/.test(text)));

    // A worst year that still gained isn't described as a loss.
    const calm = factor(healthScore({ holdings, nearestGoalYears: 2, worstYear: { return: 0.01, from: '2025-04', to: '2026-03' } }), 'riskVsHorizon');
    assert.ok(calm.evidence.some(text => /Even its worst 12 months in the data gained 1%/.test(text)));
    assert.ok(!calm.evidence.some(text => /lost/.test(text)));
});

test('cost: expense ratios when known, Direct vs Regular otherwise', () => {
    const byTer = factor(healthScore({ holdings: [holding({ expenseRatio: 0.005 }), holding({ schemeCode: 2, shortName: 'Pricey', expenseRatio: 0.02 })] }), 'cost');
    assert.equal(byTer.value.method, 'expenseRatio');
    assert.ok(Math.abs(byTer.value.ter - 0.0125) < 1e-12);
    assert.equal(byTer.score, 50);

    const byPlan = factor(healthScore({ holdings: [holding(), holding({ schemeCode: 2, shortName: 'Regular One', plan: 'Regular', value: 300000 })] }), 'cost');
    assert.equal(byPlan.value.method, 'plan');
    assert.equal(byPlan.score, 25);
    assert.ok(byPlan.evidence[0].includes('Regular One'));
});

test('against the market: value-weighted gap, laggards named, debt funds ignored', () => {
    const result = factor(healthScore({ holdings: [
        holding({ fundReturn3Y: 0.1, benchmarkReturn3Y: 0.14 }),
        holding({ schemeCode: 2, shortName: 'Gilt', assetClass: 'Debt', equityTaxed: false, fundReturn3Y: 0.07, benchmarkReturn3Y: 0.14 })
    ] }), 'benchmarkRelative');
    assert.ok(Math.abs(result.value.excess + 0.04) < 1e-12);
    assert.deepEqual(result.value.laggards.map(l => l.shortName), ['Flexi Cap']);
    assert.equal(result.score, linear(-0.04, 0.03, -0.05));
});

test('drift from the target allocation', () => {
    const holdings = [holding({ value: 900000 }), holding({ schemeCode: 2, shortName: 'Debt', assetClass: 'Debt', equityTaxed: false, value: 100000 })];
    const result = factor(healthScore({ holdings, profile: { targetAllocation: { equity: 0.6, debt: 0.4, hybrid: 0, other: 0 } } }), 'allocationDrift');
    assert.ok(Math.abs(result.value.drift - 0.3) < 1e-12);
    assert.equal(result.score, 0);
    assert.equal(result.value.widest, 'equity');
});

test('no holdings, no score', () => {
    assert.equal(healthScore({ holdings: [] }), null);
    assert.equal(healthScore({ holdings: [holding({ value: 0 })] }), null);
});

test('explainChange names the factor that moved the score, with its evidence', () => {
    const holdings = [holding({ schemeCode: 1 }), holding({ schemeCode: 2, shortName: 'Large Cap' })];
    const pair = { a: { schemeCode: 1, shortName: 'Flexi Cap' }, b: { schemeCode: 2, shortName: 'Large Cap' } };
    const lookThrough = overlap => ({ coverage: { share: 1 }, concentration: {}, pairs: [{ ...pair, overlap, commonCount: 30, topShared: ['HDFC Bank', 'Reliance'] }] });

    const before = snapshotOf(healthScore({ holdings, lookThrough: lookThrough(0.2) }));
    const after = healthScore({ holdings, lookThrough: lookThrough(0.55) });
    const change = explainChange(before, after);

    assert.equal(change.from, before.score);
    assert.equal(change.to, after.score);
    assert.ok(change.change < 0);
    assert.equal(change.reasons[0].key, 'overlap');
    assert.ok(change.reasons[0].impact < 0);
    assert.match(change.reasons[0].text, /worsened from 100 to 13/);
    assert.ok(change.reasons[0].details.some(text => /from 20% to 55%/.test(text)));
    assert.ok(change.reasons[0].details.some(text => /hold many of the same companies/.test(text)));
});

test('explainChange reports factors that started or stopped being scored', () => {
    const before = healthScore({ holdings: [holding()] });
    const after = healthScore({ holdings: [holding()], profile: { horizonYears: 10 } });
    const change = explainChange(before, after);
    const risk = change.reasons.find(r => r.key === 'riskVsHorizon');
    assert.match(risk.text, /now scored \(100\/100\)/);
    assert.equal(explainChange(null, after), null);
});
