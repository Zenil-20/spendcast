const test = require('node:test');
const assert = require('node:assert/strict');

const { goalStatus, monthsToExtend, smallestFix, goalTrend, goalWatch } = require('../utils/goalWatch');
const { simulateGoal } = require('../utils/mfPlanning');
const { addDays } = require('../utils/time');

function weekdaySeries(from, to, navFor) {
    const dates = [];
    const values = [];
    for (let date = from, i = 0; date <= to; date = addDays(date, 1)) {
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        if (weekday !== 0 && weekday !== 6) {
            dates.push(date);
            values.push(navFor(date, i++));
        }
    }
    return { dates, values };
}

const volatile = weekdaySeries('2010-01-04', '2026-10-23', (date, i) => 100 * Math.pow(1.12, i / 252) * (1 + 0.25 * Math.sin(i / 90)));
const TODAY = '2026-10-25';
const goalInput = (overrides = {}) => ({ funds: [], benchmark: volatile, today: TODAY, targetDate: '2031-10-25', monthlyContribution: 10000, target: 1000000, seed: 'g', ...overrides });

/* ---------- Status ---------- */

test('goalStatus: on track at 75%, off track below 50%, and 80% to recover', () => {
    assert.equal(goalStatus(0.9), 'on_track');
    assert.equal(goalStatus(0.75), 'on_track');
    assert.equal(goalStatus(0.74), 'at_risk');
    assert.equal(goalStatus(0.5), 'at_risk');
    assert.equal(goalStatus(0.49), 'off_track');
    // Hysteresis: odds back at 77% after being behind are still "at risk".
    assert.equal(goalStatus(0.77, 'off_track'), 'at_risk');
    assert.equal(goalStatus(0.77, 'on_track'), 'on_track');
    assert.equal(goalStatus(0.8, 'at_risk'), 'on_track');
});

/* ---------- simulateGoal additions ---------- */

test('simulateGoal reports the shortfall and the one-time top-up that gives 75% odds', () => {
    const sim = simulateGoal(goalInput({ target: 1500000 }));
    assert.ok(sim.probability < 0.75);
    assert.ok(Math.abs(sim.shortfall.probability - (1 - sim.probability)) < 1e-12);
    assert.ok(sim.shortfall.median > 0);
    assert.ok(sim.shortfall.badCase >= sim.shortfall.median);
    assert.equal(sim.neededTopUp % 1000, 0);

    // Adding the top-up today as money already invested does reach 75%.
    const fund = { series: volatile, value: sim.neededTopUp, monthlySip: 10000 };
    const check = simulateGoal(goalInput({ target: 1500000, funds: [fund] }));
    assert.ok(check.probability >= 0.74, `with top-up ${check.probability}`);
});

test('simulateGoal: a goal already certain needs no top-up and has no shortfall', () => {
    const sim = simulateGoal(goalInput({ target: 100000 }));
    assert.equal(sim.probability, 1);
    assert.equal(sim.neededTopUp, 0);
    assert.deepEqual(sim.shortfall, { probability: 0, median: 0, badCase: 0 });
});

/* ---------- The fix ---------- */

test('monthsToExtend finds the fewest extra months by binary search', () => {
    const calls = [];
    // Odds rise 1 point a month from 50%.
    const probabilityAt = months => { calls.push(months); return 0.5 + months / 100; };
    assert.equal(monthsToExtend(probabilityAt), 25);
    assert.ok(calls.length <= 10);
    assert.equal(monthsToExtend(() => 0.9), 0);
    assert.equal(monthsToExtend(() => 0.2), null);
});

test('smallestFix: the monthly increase first, then a top-up, then a later date', () => {
    const sim = simulateGoal(goalInput({ target: 1500000 }));
    const fix = smallestFix(sim, { extension: 14, targetDate: '2031-10-25' });

    assert.equal(fix.primary, 'monthly');
    assert.deepEqual(fix.options.map(o => o.kind), ['monthly', 'topUp', 'extend']);
    const monthly = fix.options[0];
    assert.equal(monthly.amount % 100, 0);
    assert.equal(monthly.monthly, 10000 + monthly.amount);
    assert.deepEqual(fix.options[2], { kind: 'extend', months: 14, date: '2032-12-25' });

    // That monthly amount really gives about 75% odds.
    const check = simulateGoal(goalInput({ target: 1500000, monthlyContribution: monthly.monthly }));
    assert.ok(check.probability >= 0.74, `with fix ${check.probability}`);
});

test('smallestFix is null for a goal already on track', () => {
    assert.equal(smallestFix(simulateGoal(goalInput({ target: 100000 }))), null);
    assert.equal(smallestFix(null), null);
});

/* ---------- Trend ---------- */

test('goalTrend compares with about a month ago and counts days behind in a row', () => {
    const history = [
        { date: '2026-09-20', probability: 0.82, status: 'on_track' },
        { date: '2026-09-27', probability: 0.8, status: 'on_track' },
        { date: '2026-10-22', probability: 0.6, status: 'at_risk' },
        { date: '2026-10-23', probability: 0.55, status: 'at_risk' },
        { date: '2026-10-24', probability: 0.52, status: 'at_risk' }
    ];
    const trend = goalTrend(history, TODAY, 0.48);
    // The latest check on or before 27 Sep (28 days back).
    assert.equal(trend.from, '2026-09-27');
    assert.ok(Math.abs(trend.change - (0.48 - 0.8)) < 1e-12);
    // Three stored days behind plus today.
    assert.equal(trend.behindDays, 4);

    assert.equal(goalTrend(history, TODAY, 0.9).behindDays, 0);
    assert.deepEqual(goalTrend([], TODAY, 0.6), { from: null, previous: null, change: null, behindDays: 1 });
});

test('goalWatch puts status, trend and fix together', () => {
    const sim = simulateGoal(goalInput({ target: 1500000 }));
    const watch = goalWatch({ sim, history: [{ date: '2026-09-01', probability: 0.9, status: 'on_track' }], today: TODAY, targetDate: '2031-10-25', extension: 6 });

    assert.equal(watch.status, sim.probability < 0.5 ? 'off_track' : 'at_risk');
    assert.equal(watch.trend.previous, 0.9);
    assert.equal(watch.fix.options.length, 3);
    assert.equal(goalWatch({ sim: null }), null);
});
