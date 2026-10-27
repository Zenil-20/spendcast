const test = require('node:test');
const assert = require('node:assert/strict');

const { pearson, correlationOf, returnCorrelations, correlationLabel, blendedMonthlyReturns, annualVolatility, worstTwelveMonths } = require('../utils/returnStats');
const { addDays } = require('../utils/time');

// One NAV per month-end from a list of monthly returns, starting Jan 2020.
function monthlySeries(returns, start = 100) {
    const dates = ['2019-12-31'];
    const values = [start];
    returns.forEach((r, i) => {
        const year = 2020 + Math.floor(i / 12);
        const month = (i % 12) + 1;
        const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
        dates.push(`${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`);
        values.push(values[values.length - 1] * (1 + r));
    });
    return { dates, values };
}

const wave = n => Array.from({ length: n }, (_, i) => 0.02 * Math.sin(i));
const TODAY = addDays('2026-01-01', 300);

test('pearson: +1, -1, and undefined for a flat series', () => {
    assert.ok(Math.abs(pearson([1, 2, 3], [2, 4, 6]) - 1) < 1e-12);
    assert.ok(Math.abs(pearson([1, 2, 3], [3, 2, 1]) + 1) < 1e-12);
    assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
});

test('correlationOf needs 24 shared months', () => {
    const a = new Map(Array.from({ length: 30 }, (_, i) => [`m${String(i).padStart(2, '0')}`, Math.sin(i)]));
    const short = new Map([...a].slice(0, 10));
    assert.equal(correlationOf(a, short).correlation, null);
    assert.equal(correlationOf(a, short).months, 10);
    assert.ok(Math.abs(correlationOf(a, a).correlation - 1) < 1e-12);
});

test('returnCorrelations: same returns correlate 1, opposite ones -1, most alike first', () => {
    const base = wave(48);
    const funds = [
        { schemeCode: 1, shortName: 'A', series: monthlySeries(base) },
        { schemeCode: 2, shortName: 'B', series: monthlySeries(base.map(r => r * 1.5)) },
        { schemeCode: 3, shortName: 'C', series: monthlySeries(base.map(r => -r)) }
    ];
    const pairs = returnCorrelations(funds, TODAY);
    assert.equal(pairs.length, 3);
    assert.deepEqual([pairs[0].a.shortName, pairs[0].b.shortName], ['A', 'B']);
    assert.ok(pairs[0].correlation > 0.999);
    assert.ok(pairs[2].correlation < -0.999);
    assert.equal(pairs[0].months, 36);
    assert.equal(correlationLabel(0.97), 'move almost identically');
    assert.equal(correlationLabel(null), 'not enough shared history');
});

test('blendedMonthlyReturns weights funds by value and uses only funds that existed', () => {
    const a = monthlySeries(Array(24).fill(0.01));
    const b = monthlySeries(Array(24).fill(0.03));
    const blended = blendedMonthlyReturns([{ series: a, value: 300 }, { series: b, value: 100 }], TODAY);
    assert.ok(Math.abs(blended.get('2021-06') - 0.015) < 1e-12);

    // A fund without data for a month doesn't drag that month to zero.
    const young = { dates: a.dates.slice(12), values: a.values.slice(12) };
    const partial = blendedMonthlyReturns([{ series: young, value: 300 }, { series: b, value: 100 }], TODAY);
    assert.ok(Math.abs(partial.get('2020-06') - 0.03) < 1e-12);

    // With minCoverage, a month where only a quarter of today's money existed is left out.
    const covered = blendedMonthlyReturns([{ series: young, value: 300 }, { series: b, value: 100 }], TODAY, { minCoverage: 0.5 });
    assert.equal(covered.has('2020-06'), false);
    assert.ok(Math.abs(covered.get('2021-06') - 0.015) < 1e-12);
});

test('annualVolatility and worstTwelveMonths', () => {
    const steady = new Map(Array.from({ length: 24 }, (_, i) => [`2020-${String(i).padStart(2, '0')}`, 0.01]));
    assert.ok(annualVolatility(steady) < 1e-12);
    assert.equal(annualVolatility(new Map([...steady].slice(0, 6))), null);

    const returns = Array(36).fill(0.01);
    returns.splice(12, 12, ...Array(12).fill(-0.02));
    const map = new Map(returns.map((r, i) => [`${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, r]));
    const worst = worstTwelveMonths(map);
    assert.equal(worst.from, '2021-01');
    assert.equal(worst.to, '2021-12');
    assert.ok(Math.abs(worst.return - (Math.pow(0.98, 12) - 1)) < 1e-12);
});
