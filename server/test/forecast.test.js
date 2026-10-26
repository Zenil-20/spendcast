const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getMonthIndex,
    getMonthStartString,
    getMonthLabel,
    robustStdDev,
    theilSenSlope,
    getRecurringDueDate,
    isRecurringDueInMonth,
    classifyExpenses,
    getSeasonalFactor,
    forecastVariableSpend,
    backtestVariableModel,
    compareWithBudget,
    DEFAULTS
} = require('../utils/forecast');

// Rule dates are calendar dates stored at UTC midnight.
const utc = (year, month, day) => new Date(Date.UTC(year, month - 1, day));
const round2 = value => Math.round(value * 100) / 100;

// Builds observations for consecutive months starting at `year`/`month`.
const series = (values, year = 2026, month = 1) => values.map((value, i) => ({
    monthIndex: getMonthIndex(year, month) + i,
    value
}));

test('month helpers roll over years', () => {
    assert.equal(getMonthStartString(getMonthIndex(2026, 1) - 1), '2025-12-01');
    assert.equal(getMonthStartString(getMonthIndex(2026, 11) + 3), '2027-02-01');
    assert.equal(getMonthLabel(2026, 10), 'Oct 2026');
});

test('monthly rule on the 31st falls on the last day of shorter months', () => {
    const rule = { frequency: 'monthly', startDate: utc(2026, 1, 31) };

    assert.equal(getRecurringDueDate(rule, 2026, 2), '2026-02-28');
    assert.equal(getRecurringDueDate(rule, 2028, 2), '2028-02-29');
    assert.equal(getRecurringDueDate(rule, 2026, 4), '2026-04-30');
});

test('quarterly and yearly rules are only due in their months', () => {
    const quarterly = { frequency: 'quarterly', startDate: utc(2026, 1, 10) };
    const yearly = { frequency: 'yearly', startDate: utc(2025, 6, 1) };

    assert.equal(isRecurringDueInMonth(quarterly, 2026, 4), true);
    assert.equal(isRecurringDueInMonth(quarterly, 2026, 5), false);
    assert.equal(isRecurringDueInMonth(quarterly, 2025, 10), false);
    assert.equal(isRecurringDueInMonth(yearly, 2026, 6), true);
    assert.equal(isRecurringDueInMonth(yearly, 2026, 7), false);
});

test('rules are not due after their end date', () => {
    const rule = { frequency: 'monthly', startDate: utc(2026, 1, 20), endDate: utc(2026, 3, 10) };

    assert.equal(isRecurringDueInMonth(rule, 2026, 2), true);
    assert.equal(isRecurringDueInMonth(rule, 2026, 3), false);
});

test('expenses are grouped by their local calendar date', () => {
    const expenses = [
        { title: 'A', category: 'Food', amount: 100, localDate: '2026-03-31', recurringExpenseId: null },
        { title: 'B', category: 'Food', amount: 50, localDate: '2026-04-01', recurringExpenseId: null }
    ];
    const buckets = classifyExpenses(expenses, []);

    assert.equal(buckets.get(getMonthIndex(2026, 3)).total, 100);
    assert.equal(buckets.get(getMonthIndex(2026, 4)).total, 50);
});

test('unlinked payment matching a rule is recurring, not variable', () => {
    const rules = [{
        _id: 'rent',
        title: 'Rent',
        category: 'Housing',
        amount: 20000,
        frequency: 'monthly',
        startDate: utc(2026, 1, 1)
    }];
    const expenses = [
        { title: 'rent', category: 'housing', amount: 20000, localDate: '2026-03-02', recurringExpenseId: null },
        { title: 'Groceries', category: 'Food', amount: 5000, localDate: '2026-03-05', recurringExpenseId: null },
        // Same category but amount is too far off to be the rent payment.
        { title: 'Repairs', category: 'Housing', amount: 3000, localDate: '2026-03-09', recurringExpenseId: null }
    ];

    const bucket = classifyExpenses(expenses, rules).get(getMonthIndex(2026, 3));

    assert.equal(bucket.total, 28000);
    assert.equal(bucket.recurring, 20000);
    assert.equal(bucket.variable, 8000);
    assert.equal(bucket.count, 3);
});

test('a rule already paid through a linked expense is not matched again', () => {
    const rules = [{
        _id: 'gym',
        title: 'Gym',
        category: 'Health',
        amount: 1500,
        frequency: 'monthly',
        startDate: utc(2026, 1, 1)
    }];
    const expenses = [
        { title: 'Gym', category: 'Health', amount: 1500, localDate: '2026-02-01', recurringExpenseId: 'gym' },
        { title: 'Gym day pass', category: 'Health', amount: 1500, localDate: '2026-02-20', recurringExpenseId: null }
    ];

    const bucket = classifyExpenses(expenses, rules).get(getMonthIndex(2026, 2));

    assert.equal(bucket.recurring, 1500);
    assert.equal(bucket.variable, 1500);
});

test('robust spread and Theil-Sen slope ignore a single extreme value', () => {
    assert.ok(robustStdDev([100, 100, 100, 100, 5000]) < 1500);
    assert.equal(theilSenSlope(series([100, 110, 120, 10000, 140, 150])), 10);
});

test('flat history forecasts its level', () => {
    const [next] = forecastVariableSpend(series([10000, 10000, 10000, 10000]), [getMonthIndex(2026, 5)]);

    assert.equal(Math.round(next.estimate), 10000);
    assert.ok(next.low < next.estimate && next.high > next.estimate);
});

test('one-off spike is capped and does not dominate the forecast', () => {
    const [next] = forecastVariableSpend(
        series([10000, 11000, 9500, 10500, 60000, 10200]),
        [getMonthIndex(2026, 7)]
    );

    assert.ok(next.estimate < 13000, `estimate was ${next.estimate}`);
});

test('trend is used with 6+ months, damped and capped', () => {
    const [m1, m2, m3] = forecastVariableSpend(
        series([10000, 11000, 12000, 13000, 14000, 15000]),
        [getMonthIndex(2026, 7), getMonthIndex(2026, 8), getMonthIndex(2026, 9)]
    );

    assert.ok(m1.estimate > 14000);
    assert.ok(m2.estimate > m1.estimate);
    // Damping: each step adds less than the one before.
    assert.ok(m3.estimate - m2.estimate < m2.estimate - m1.estimate);
    // Cap: never more than 25% above the level.
    assert.ok(m3.estimate < 15000 * 1.25);
});

test('no trend is fitted with fewer than 6 months', () => {
    const [m1, m2] = forecastVariableSpend(
        series([10000, 12000, 14000, 16000]),
        [getMonthIndex(2026, 5), getMonthIndex(2026, 6)]
    );

    assert.equal(m1.estimate, m2.estimate);
});

test('forecast never goes negative', () => {
    const results = forecastVariableSpend(
        series([9000, 7000, 5000, 3000, 1000, 0]),
        [getMonthIndex(2026, 7), getMonthIndex(2026, 9)]
    );

    for (const result of results) {
        assert.ok(result.estimate >= 0 && result.low >= 0);
    }
});

test('gaps in history are weighted by real month distance', () => {
    const history = [
        { monthIndex: getMonthIndex(2025, 1), value: 50000 },
        { monthIndex: getMonthIndex(2026, 1), value: 10000 },
        { monthIndex: getMonthIndex(2026, 2), value: 10000 }
    ];
    const [next] = forecastVariableSpend(history, [getMonthIndex(2026, 3)]);

    // The old month is outside the 12-month fitting window; a plain average would give 23,333.
    assert.equal(Math.round(next.estimate), 10000);
});

test('consistent yearly spike becomes a seasonal factor', () => {
    // 3 years of 10,000/month with December at 20,000 every year.
    const values = [];

    for (let i = 0; i < 36; i++) {
        values.push(i % 12 === 11 ? 20000 : 10000);
    }

    const history = series(values, 2023, 1);
    const factor = getSeasonalFactor(history, getMonthIndex(2026, 12), DEFAULTS);
    const [nov, dec] = forecastVariableSpend(history, [getMonthIndex(2026, 11), getMonthIndex(2026, 12)]);

    assert.ok(factor > 1.3, `factor was ${factor}`);
    // November is never above its yearly average, so it gets no uplift.
    assert.ok(getSeasonalFactor(history, getMonthIndex(2026, 11), DEFAULTS) <= 1);
    assert.ok(dec.estimate > nov.estimate * 1.4);
});

test('spikes in other months do not make ordinary months look low', () => {
    // December spike every year; January is an ordinary month.
    const values = [];

    for (let i = 0; i < 36; i++) {
        values.push(i % 12 === 11 ? 30000 : 10000);
    }

    assert.equal(getSeasonalFactor(series(values, 2023, 1), getMonthIndex(2026, 1), DEFAULTS), 1);
});

test('a one-off spike in a single year is not treated as seasonal', () => {
    const values = Array(36).fill(10000);
    values[22] = 40000; // Nov 2024 only

    const history = series(values, 2023, 1);

    assert.equal(getSeasonalFactor(history, getMonthIndex(2026, 11), DEFAULTS), 1);
});

test('seasonality needs two earlier years', () => {
    const values = [];

    for (let i = 0; i < 12; i++) {
        values.push(i === 11 ? 20000 : 10000);
    }

    assert.equal(getSeasonalFactor(series(values, 2025, 1), getMonthIndex(2026, 12), DEFAULTS), 1);
});

test('backtest reports error once enough history exists', () => {
    assert.equal(backtestVariableModel(series([1000, 1000, 1000])), null);

    const result = backtestVariableModel(series([1000, 1000, 1000, 1000, 1200]));

    assert.equal(result.evaluatedMonths, 2);
    assert.ok(result.weightedAbsolutePercentageError > 0);
});

test('budget status includes an at-risk band', () => {
    assert.equal(compareWithBudget(900, 950, 1000, round2).budgetStatus, 'within_budget');
    assert.equal(compareWithBudget(900, 1100, 1000, round2).budgetStatus, 'at_risk');
    assert.equal(compareWithBudget(1100, 1200, 1000, round2).budgetStatus, 'over_budget');
    assert.equal(compareWithBudget(1100.555, 1200, 1000, round2).budgetDifference, -100.56);
    assert.equal(compareWithBudget(1100, 1200, null, round2).budgetStatus, 'budget_not_set');
});
