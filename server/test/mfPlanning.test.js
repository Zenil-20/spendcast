const test = require('node:test');
const assert = require('node:assert/strict');

const { monthlyReturns, simulateGoal, financialYear, harvestPlan, sipDateStudy } = require('../utils/mfPlanning');
const { buildInstallments } = require('../utils/mfMath');
const { addDays } = require('../utils/time');

function weekdaySeries(from, to, navFor = () => 100) {
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

// Grows at exactly `yearly` per calendar year.
const growing = (from, to, yearly) => weekdaySeries(from, to, date => 100 * Math.pow(1 + yearly, (Date.parse(date) - Date.parse(from)) / (365.25 * 86400000)));

test('monthlyReturns uses month-end NAVs and leaves out the current month', () => {
    const series = weekdaySeries('2026-01-01', '2026-04-10', date => (date < '2026-02-01' ? 100 : date < '2026-03-01' ? 110 : 121));
    const returns = monthlyReturns(series, '2026-04-10');

    assert.deepEqual([...returns.keys()], ['2026-02', '2026-03']);
    assert.ok(Math.abs(returns.get('2026-02') - 0.1) < 1e-12);
    assert.ok(Math.abs(returns.get('2026-03') - 0.1) < 1e-12);
});

test('simulateGoal: a steady 12% history matches the flat projection and gives certain odds', () => {
    const benchmark = growing('2012-01-02', '2026-10-23', 0.12);
    const common = { funds: [], benchmark, today: '2026-10-25', targetDate: '2031-10-25', monthlyContribution: 10000 };
    const result = simulateGoal({ ...common, target: 500000 });

    assert.equal(result.months, 60);
    assert.equal(result.probability, 1);
    // Steady growth (months differ only in trading days), so all outcomes
    // nearly agree with 12% a year.
    assert.ok(result.outcomes.p90 / result.outcomes.p10 - 1 < 0.01);
    assert.ok(Math.abs(result.outcomes.median / result.flatRate.value - 1) < 0.01);
    assert.equal(result.fan.length, 5);

    const tooHigh = simulateGoal({ ...common, target: 10000000 });
    assert.equal(tooHigh.probability, 0);
    // Paying the amount needed for even odds does give at least even odds.
    const needed = tooHigh.neededMonthly.odds50;
    const check = simulateGoal({ ...common, target: 10000000, monthlyContribution: needed });
    assert.ok(check.probability >= 0.5);
    const short = simulateGoal({ ...common, target: 10000000, monthlyContribution: needed * 0.95 });
    assert.equal(short.probability, 0);
});

test('simulateGoal: same seed gives the same answer; volatile history gives real uncertainty', () => {
    const benchmark = weekdaySeries('2010-01-04', '2026-10-23', (date, i) => 100 * Math.pow(1.12, i / 252) * (1 + 0.25 * Math.sin(i / 90)));
    const input = { funds: [], benchmark, today: '2026-10-25', targetDate: '2036-10-25', monthlyContribution: 10000, target: 2300000, seed: 'abc' };
    const a = simulateGoal(input);
    const b = simulateGoal(input);

    assert.deepEqual(a, b);
    assert.ok(a.probability > 0 && a.probability < 1);
    assert.ok(a.outcomes.p10 < a.outcomes.median && a.outcomes.median < a.outcomes.p90);
    assert.ok(a.neededMonthly.odds50 <= a.neededMonthly.odds75 && a.neededMonthly.odds75 <= a.neededMonthly.odds90);
});

test('simulateGoal: a young fund borrows the benchmark for months before it existed', () => {
    const benchmark = growing('2012-01-02', '2026-10-23', 0.1);
    const young = growing('2026-03-30', '2026-10-23', 0.1);
    const result = simulateGoal({
        funds: [{ series: young, value: 9000, monthlySip: 3000 }],
        benchmark, today: '2026-10-25', targetDate: '2029-10-25', monthlyContribution: 3000, target: 100000
    });

    assert.ok(result.history.borrowedMonths > 100);
    assert.equal(result.current, 9000);
});

test('simulateGoal returns null without three years of history', () => {
    const benchmark = growing('2025-01-01', '2026-10-23', 0.1);
    assert.equal(simulateGoal({ funds: [], benchmark, today: '2026-10-25', targetDate: '2030-01-01', monthlyContribution: 1000, target: 1 }), null);
});

test('financialYear runs April to March', () => {
    assert.deepEqual(financialYear('2026-10-25'), { label: '2026-27', start: '2026-04-01', end: '2027-03-31' });
    assert.deepEqual(financialYear('2027-02-10'), { label: '2026-27', start: '2026-04-01', end: '2027-03-31' });
});

test('harvestPlan books long-term gains FIFO, only up to the exemption', () => {
    // Doubles over the period: units bought early hold large gains.
    const series = weekdaySeries('2022-01-03', '2026-10-23', (date, i) => 100 + i * 0.1);
    const installments = buildInstallments({ kind: 'sip', amount: 50000, sipDay: 5, startDate: '2022-02-05' }, series, '2026-10-23');
    const latestNav = { date: series.dates.at(-1), nav: series.values.at(-1) };
    const holding = { schemeCode: 1, shortName: 'Fund A', equityTaxed: true, installments, latestNav };

    const plan = harvestPlan([holding], '2026-10-25');
    assert.equal(plan.financialYear, '2026-27');
    assert.ok(plan.available > 125000);
    assert.equal(plan.plan.length, 1);
    // Fills the exemption without going over it.
    assert.ok(plan.gainBooked <= 125000 && plan.gainBooked > 124000);
    assert.equal(plan.plan[0].oldestLot, installments[0].navDate);
    assert.ok(Math.abs(plan.taxAvoided - plan.gainBooked * 0.125 * 1.04) < 0.05);

    const partly = harvestPlan([holding], '2026-10-25', { alreadyBooked: 100000 });
    assert.ok(partly.gainBooked <= 25000 && partly.gainBooked > 24000);
});

test('harvestPlan skips non-equity funds and says when units first turn long-term', () => {
    const series = weekdaySeries('2026-01-05', '2026-10-23', (date, i) => 100 + i);
    const installments = buildInstallments({ kind: 'sip', amount: 5000, sipDay: 15, startDate: '2026-02-15' }, series, '2026-10-23');
    const latestNav = { date: series.dates.at(-1), nav: series.values.at(-1) };

    const plan = harvestPlan([
        { schemeCode: 1, shortName: 'Young', equityTaxed: true, installments, latestNav },
        { schemeCode: 2, shortName: 'Debt', equityTaxed: false, installments, latestNav }
    ], '2026-10-25');

    assert.equal(plan.plan.length, 0);
    assert.equal(plan.available, 0);
    assert.equal(plan.earliestLongTerm.shortName, 'Young');
    assert.equal(plan.earliestLongTerm.date, '2027-02-17');
});

test('sipDateStudy compares every day 1-28 over the same months', () => {
    const series = weekdaySeries('2019-01-01', '2026-10-23', (date, i) => 100 * Math.pow(1.12, i / 252) * (1 + 0.05 * Math.sin(i / 7)));
    const study = sipDateStudy(series, { years: 5 });

    assert.equal(study.days.length, 28);
    assert.equal(study.months, 60);
    assert.equal(study.invested, 600000);
    assert.ok(study.spread >= 0);
    assert.ok(study.days.every(day => day.value > 0));
    assert.equal(sipDateStudy(weekdaySeries('2026-01-01', '2026-10-23')), null);
});

test('harvestPlan respects the ELSS 3-year lock-in', () => {
    const series = weekdaySeries('2023-06-01', '2026-10-23', (date, i) => 100 + i * 0.2);
    const installments = buildInstallments({ kind: 'sip', amount: 20000, sipDay: 5, startDate: '2023-07-05' }, series, '2026-10-23');
    const latestNav = { date: series.dates.at(-1), nav: series.values.at(-1) };
    const base = { schemeCode: 1, shortName: 'Tax saver', equityTaxed: true, installments, latestNav };

    const free = harvestPlan([base], '2026-10-25');
    const locked = harvestPlan([{ ...base, lockInYears: 3 }], '2026-10-25');

    assert.ok(free.available > locked.available);
    // Only lots bought more than 3 years ago (Jul-Oct 2023) can be sold.
    assert.ok(locked.plan.length === 1 && locked.plan[0].oldestLot === installments[0].navDate);
    assert.ok(locked.plan[0].units <= installments.slice(0, 4).reduce((sum, item) => sum + item.units, 0));
});
