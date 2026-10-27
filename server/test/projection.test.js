const test = require('node:test');
const assert = require('node:assert/strict');

const { shiftMonths, missRateOf, upcomingInstallments, projectPortfolio } = require('../utils/projection');
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

const growing = (from, to, yearly) => weekdaySeries(from, to, date => 100 * Math.pow(1 + yearly, (Date.parse(date) - Date.parse(from)) / (365.25 * 86400000)));
const volatile = (from, to) => weekdaySeries(from, to, (date, i) => 100 * Math.pow(1.12, i / 252) * (1 + 0.25 * Math.sin(i / 90)));

const TODAY = '2026-10-25';
const steady = growing('2012-01-02', '2026-10-23', 0.12);
const sip = (overrides = {}) => ({ kind: 'sip', amount: 10000, sipDay: 5, startDate: '2025-01-05', endDate: null, stepUpPercent: 0, isActive: true, ...overrides });
const fund = (overrides = {}) => ({ schemeCode: 1, shortName: 'Fund', series: steady, value: 100000, investments: [], missRate: 0, ...overrides });

test('shiftMonths keeps the day and clamps it to shorter months', () => {
    assert.equal(shiftMonths('2026-10-25', 3), '2027-01-25');
    assert.equal(shiftMonths('2026-10-31', 4), '2027-02-28');
    assert.equal(shiftMonths('2026-01-15', -2), '2025-11-15');
});

test('upcomingInstallments follows each SIP schedule: day, step-up, end date and stopped SIPs', () => {
    const [plain] = upcomingInstallments([{ investments: [sip()] }], TODAY, 3);
    // 5 Nov, 5 Dec, 5 Jan: one per month.
    assert.deepEqual(plain, [[10000], [10000], [10000]]);

    // +10% a year from January 2025: the January 2027 installment is the third year's.
    const [stepped] = upcomingInstallments([{ investments: [sip({ stepUpPercent: 10 })] }], TODAY, 3);
    assert.deepEqual(stepped, [[11000], [11000], [12100]]);

    const [ending] = upcomingInstallments([{ investments: [sip({ endDate: '2026-12-31' })] }], TODAY, 3);
    assert.deepEqual(ending, [[10000], [10000], []]);

    const [stopped] = upcomingInstallments([{ investments: [sip({ isActive: false }), { kind: 'lumpsum', amount: 50000, startDate: '2025-01-01' }] }], TODAY, 3);
    assert.deepEqual(stopped, [[], [], []]);
});

test('missRateOf uses the last two years of SIP installments only', () => {
    const installments = [
        { source: 'sip', dueDate: '2023-01-05', status: 'skipped' }, // too old
        { source: 'sip', dueDate: '2026-01-05', status: 'skipped' },
        { source: 'sip', dueDate: '2026-02-05', status: 'allotted' },
        { source: 'sip', dueDate: '2026-03-05', status: 'allotted' },
        { source: 'sip', dueDate: '2026-04-05', status: 'allotted' },
        { source: 'lumpsum', dueDate: '2026-05-01', status: 'allotted' }
    ];
    assert.deepEqual(missRateOf(installments, TODAY), { rate: 0.25, missed: 1, scheduled: 4 });
    assert.deepEqual(missRateOf([], TODAY), { rate: 0, missed: 0, scheduled: 0 });
});

test('steady 12% history: every scenario agrees and matches 12% growth', () => {
    const result = projectPortfolio({ funds: [fund()], benchmark: steady, today: TODAY });
    const year = result.horizons.find(h => h.months === 12);

    assert.deepEqual(result.horizons.map(h => h.months), [3, 6, 12, 36]);
    assert.equal(year.date, '2027-10-25');
    assert.equal(year.contributed, 0);
    assert.ok(Math.abs(year.baseline / 112000 - 1) < 0.01, `baseline ${year.baseline}`);
    assert.ok(year.optimistic / year.pessimistic - 1 < 0.01);
    assert.equal(year.lossProbability, 0);
    assert.equal(result.fan.length, 37);
    assert.equal(result.fan[0].median, 100000);
});

test('upcoming SIP installments are added to the projection', () => {
    const result = projectPortfolio({ funds: [fund({ investments: [sip()] })], benchmark: steady, today: TODAY });
    const three = result.horizons.find(h => h.months === 3);
    const longest = result.horizons.find(h => h.months === 36);

    assert.equal(result.currentMonthly, 10000);
    assert.equal(three.contributed, 30000);
    assert.equal(longest.contributed, 360000);
    assert.equal(three.invested, 130000);
    // More money in, and growing: well above what was put in.
    assert.ok(longest.baseline > longest.invested);
});

test('missed installments lower the expected contributions at the customer\'s own rate', () => {
    const always = projectPortfolio({ funds: [fund({ investments: [sip()] })], benchmark: steady, today: TODAY });
    const half = projectPortfolio({ funds: [fund({ investments: [sip()], missRate: 0.5 })], benchmark: steady, today: TODAY });
    const longest = result => result.horizons.find(h => h.months === 36);

    assert.ok(Math.abs(longest(half).contributed / 180000 - 1) < 0.03, `contributed ${longest(half).contributed}`);
    assert.ok(longest(half).baseline < longest(always).baseline);
    assert.equal(half.assumptions.funds[0].missRate, 0.5);
    // Misses add uncertainty even in a steady market.
    assert.ok(longest(half).optimistic > longest(half).pessimistic);
});

test('changing the monthly SIP scales the scheduled installments', () => {
    const base = { funds: [fund({ investments: [sip()] })], benchmark: steady, today: TODAY };
    const doubled = projectPortfolio({ ...base, extraMonthly: 10000 });
    const stopped = projectPortfolio({ ...base, extraMonthly: -10000 });
    // Can't go below zero.
    const belowZero = projectPortfolio({ ...base, extraMonthly: -50000 });
    const longest = result => result.horizons.find(h => h.months === 36);

    assert.equal(doubled.monthly, 20000);
    assert.equal(longest(doubled).contributed, 720000);
    assert.equal(longest(stopped).contributed, 0);
    assert.equal(belowZero.change, -10000);
    assert.ok(Math.abs(longest(stopped).baseline / (100000 * Math.pow(1.12, 3)) - 1) < 0.02);
});

test('with no SIP, a monthly change is new money spread like today\'s holdings', () => {
    const result = projectPortfolio({ funds: [fund(), fund({ schemeCode: 2, value: 300000 })], benchmark: steady, today: TODAY, extraMonthly: 5000 });
    assert.equal(result.currentMonthly, 0);
    assert.equal(result.monthly, 5000);
    assert.equal(result.horizons.find(h => h.months === 12).contributed, 60000);
});

test('the sensitivity table moves the same way as the monthly amount', () => {
    const result = projectPortfolio({ funds: [fund({ series: volatile('2010-01-04', '2026-10-23'), investments: [sip()] })], benchmark: volatile('2010-01-04', '2026-10-23'), today: TODAY });
    const rows = result.sensitivity.rows;

    assert.deepEqual(rows.map(row => row.monthly), [0, 5000, 10000, 15000, 20000]);
    for (let i = 1; i < rows.length; i++) {
        assert.ok(rows[i].baseline > rows[i - 1].baseline);
        assert.ok(rows[i].pessimistic > rows[i - 1].pessimistic);
    }
    // The 0-change row is the projection itself.
    assert.equal(rows[2].baseline, result.horizons.find(h => h.months === 36).baseline);
});

test('volatile history: ordered scenarios, real spread, same seed same answer', () => {
    const series = volatile('2010-01-04', '2026-10-23');
    const input = { funds: [fund({ series, investments: [sip()] })], benchmark: series, today: TODAY, seed: 'abc' };
    const a = projectPortfolio(input);
    const b = projectPortfolio(input);
    const c = projectPortfolio({ ...input, seed: 'xyz' });

    for (const h of a.horizons) {
        assert.ok(h.pessimistic <= h.p25 && h.p25 <= h.baseline && h.baseline <= h.p75 && h.p75 <= h.optimistic);
    }
    const longest = a.horizons.find(h => h.months === 36);
    assert.ok(longest.optimistic / longest.pessimistic > 1.2);
    assert.ok(longest.lossProbability > 0 && longest.lossProbability < 1);
    assert.deepEqual(a.horizons, b.horizons);
    assert.notDeepEqual(a.horizons, c.horizons);
});

test('a fund younger than the history borrows the benchmark for its missing months', () => {
    const young = growing('2024-01-01', '2026-10-23', 0.2);
    const result = projectPortfolio({ funds: [fund({ series: young })], benchmark: steady, today: TODAY });
    assert.ok(result.assumptions.funds[0].borrowedMonths > 100);
    assert.equal(result.assumptions.history.months > 150, true);
});

test('no projection without enough history or without funds', () => {
    const short = growing('2024-06-03', '2026-10-23', 0.12);
    assert.equal(projectPortfolio({ funds: [fund({ series: short })], benchmark: short, today: TODAY }), null);
    assert.equal(projectPortfolio({ funds: [], benchmark: steady, today: TODAY }), null);
});
