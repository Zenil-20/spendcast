const test = require('node:test');
const assert = require('node:assert/strict');

const { monthEnds, yearReturnAt, detectAlerts, planAlertChanges } = require('../utils/alerts');
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

const years = (from, date) => (Date.parse(date) - Date.parse(from)) / (365.25 * 86400000);
const TODAY = '2026-10-25';
const START = '2018-01-01';
const benchmark = weekdaySeries(START, '2026-10-23', date => 100 * Math.pow(1.12, years(START, date)));
// Same as the market, except a one-off fall of `drop` on `on`.
const withDrop = (on, drop) => weekdaySeries(START, '2026-10-23', date => 100 * Math.pow(1.12, years(START, date)) * (date >= on ? 1 - drop : 1));

const fund = (overrides = {}) => ({ schemeCode: 101, shortName: 'Midcap Fund', equityTaxed: true, series: benchmark, value: 100000, installments: [], investments: [], ...overrides });
const detect = (input = {}) => detectAlerts({ today: TODAY, funds: [], benchmark, ...input });
const byType = (alerts, type) => alerts.filter(alert => alert.type === type);

/* ---------- Helpers ---------- */

test('monthEnds gives the last NAV date of complete months only', () => {
    assert.deepEqual(monthEnds(benchmark, TODAY, 3), ['2026-07-31', '2026-08-31', '2026-09-30']);
});

test('yearReturnAt needs a full year of history', () => {
    assert.ok(Math.abs(yearReturnAt(benchmark, '2026-09-30') - 0.12) < 0.005);
    assert.equal(yearReturnAt(benchmark, '2018-06-29'), null);
});

/* ---------- Underperformance ---------- */

test('a fund trailing the Nifty 50 by over 3% at 3 month-ends in a row raises an alert, with the data', () => {
    // A 10% fall in early June 2026: every month-end from June on trails by about 10%.
    const [alert] = byType(detect({ funds: [fund({ series: withDrop('2026-06-02', 0.1) })] }), 'underperformance');

    assert.equal(alert.key, 'underperformance:101');
    assert.equal(alert.severity, 'warning');
    assert.match(alert.title, /trailed the Nifty 50 for 3 months running/);
    assert.match(alert.why, /each of the last 3 month-ends/);
    assert.deepEqual(alert.evidence.columns, ['Month-end', 'Fund, 1 year', 'Nifty 50, 1 year', 'Gap']);
    assert.equal(alert.evidence.rows.length, 6);
    assert.equal(alert.period.to, '2026-09-30');
    assert.ok(alert.investigate.length >= 2);
});

test('two bad month-ends are not enough, unless the alert is already open', () => {
    // A fall in early August: only August and September trail.
    const series = withDrop('2026-08-03', 0.1);
    assert.equal(byType(detect({ funds: [fund({ series })] }), 'underperformance').length, 0);

    const [held] = byType(detect({ funds: [fund({ series })], openKeys: new Set(['underperformance:101']) }), 'underperformance');
    assert.match(held.why, /^Still open/);
});

test('an open underperformance alert clears once the gap is within 1.5%', () => {
    const series = withDrop('2026-09-02', 0.01);
    assert.equal(byType(detect({ funds: [fund({ series })], openKeys: new Set(['underperformance:101']) }), 'underperformance').length, 0);
});

test('debt funds are not compared with the Nifty 50', () => {
    const debt = fund({ equityTaxed: false, series: withDrop('2026-06-02', 0.1) });
    assert.equal(byType(detect({ funds: [debt] }), 'underperformance').length, 0);
});

/* ---------- Concentration ---------- */

const snap = (date, largestShare, companyShare = null, overlap = null) => ({
    date,
    concentration: {
        largestFund: { schemeCode: 1, shortName: 'Flexi Cap', share: largestShare },
        topCompany: companyShare === null ? null : { name: 'HDFC Bank', share: companyShare },
        topPair: overlap === null ? null : { a: 'Flexi Cap', b: 'Large Cap', overlap }
    }
});

test('a fund share that rose 10+ points and stayed above 50% for a week raises an alert', () => {
    const snapshots = [snap('2026-09-25', 0.38), snap('2026-10-18', 0.52), snap(TODAY, 0.55)];
    const [alert] = byType(detect({ snapshots }), 'concentration');

    assert.equal(alert.key, 'concentration:fund');
    assert.match(alert.title, /Flexi Cap is now 55% of your portfolio/);
    assert.match(alert.why, /from 38.0% a month ago/);
    assert.deepEqual(alert.evidence.rows.map(row => row[0]), ['2026-09-25', '2026-10-18', TODAY]);
});

test('a one-week spike, a small rise, or missing history raise nothing', () => {
    assert.equal(byType(detect({ snapshots: [snap('2026-09-25', 0.38), snap('2026-10-18', 0.45), snap(TODAY, 0.55)] }), 'concentration').length, 0);
    assert.equal(byType(detect({ snapshots: [snap('2026-09-25', 0.5), snap('2026-10-18', 0.52), snap(TODAY, 0.55)] }), 'concentration').length, 0);
    assert.equal(byType(detect({ snapshots: [snap(TODAY, 0.9)] }), 'concentration').length, 0);
});

test('an open concentration alert holds above 45% and clears below it', () => {
    const open = new Set(['concentration:fund']);
    const flat = share => [snap('2026-09-25', 0.47), snap('2026-10-18', 0.47), snap(TODAY, share)];
    assert.equal(byType(detect({ snapshots: flat(0.47), openKeys: open }), 'concentration').length, 1);
    assert.equal(byType(detect({ snapshots: flat(0.44), openKeys: open }), 'concentration').length, 0);
});

test('company and fund-pair overlap concentration', () => {
    const snapshots = [snap('2026-09-25', 0.3, 0.07, 0.35), snap('2026-10-18', 0.3, 0.11, 0.52), snap(TODAY, 0.3, 0.12, 0.56)];
    const keys = byType(detect({ snapshots }), 'concentration').map(alert => alert.key).sort();
    assert.deepEqual(keys, ['concentration:company', 'concentration:overlap']);
});

/* ---------- Goals ---------- */

const goal = watch => ({
    id: 'g1',
    name: 'House',
    today: TODAY,
    targetAmount: 2500000,
    effectiveMonthly: 20000,
    simulation: { outcomes: { median: 2100000 } },
    watch: { status: 'off_track', probability: 0.42, trend: { behindDays: 3, change: -0.2, from: '2026-09-27', previous: 0.62 }, fix: { options: [{ kind: 'monthly', amount: 4300, monthly: 24300 }] }, ...watch }
});

test('a goal off track for 3 checks raises a warning with the smallest fix', () => {
    const [alert] = byType(detect({ goals: [goal()] }), 'goal');
    assert.equal(alert.key, 'goal:g1');
    assert.equal(alert.severity, 'warning');
    assert.match(alert.title, /"House" is off track: 42% chance/);
    assert.match(alert.why, /behind for 3 daily checks in a row, and the odds moved down 20 points since 2026-09-27/);
    assert.match(alert.investigate[0], /Adding ₹4,300 a month/);
    assert.ok(alert.evidence.rows.some(row => row[0] === 'Chance on 2026-09-27' && row[1] === '62%'));
});

test('goal alerts need persistence and a real decline', () => {
    const quiet = watch => byType(detect({ goals: [goal(watch)] }), 'goal').length;
    assert.equal(quiet({ trend: { behindDays: 2, change: -0.2, from: null, previous: null } }), 0);
    // At risk but barely moved: not worth an alert.
    assert.equal(quiet({ status: 'at_risk', probability: 0.7, trend: { behindDays: 5, change: -0.05, from: null, previous: null } }), 0);
    assert.equal(quiet({ status: 'at_risk', probability: 0.6, trend: { behindDays: 5, change: -0.12, from: '2026-09-27', previous: 0.72 } }), 1);
});

test('an open goal alert stays until the goal is back on track', () => {
    const open = new Set(['goal:g1']);
    const count = watch => byType(detect({ goals: [goal(watch)], openKeys: open }), 'goal').length;
    assert.equal(count({ status: 'at_risk', probability: 0.77, trend: { behindDays: 1, change: 0.1, from: null, previous: null } }), 1);
    assert.equal(count({ status: 'on_track', probability: 0.85, trend: { behindDays: 0, change: 0.2, from: null, previous: null } }), 0);
});

/* ---------- Reconciliation ---------- */

test('a fund whose NAV stopped updating needs checking', () => {
    const stale = { dates: benchmark.dates.filter(date => date <= '2026-10-09'), values: [] };
    stale.values = benchmark.values.slice(0, stale.dates.length);
    const installments = [{ dueDate: '2026-10-15', status: 'awaiting_nav', source: 'sip' }];
    const [alert] = byType(detect({ funds: [fund({ series: stale, installments })] }), 'reconcile');

    assert.equal(alert.key, 'reconcile:nav:101');
    assert.match(alert.title, /hasn't had a new NAV since 2026-10-09/);
    assert.match(alert.why, /14 days later/);
    assert.ok(alert.evidence.rows.some(row => row[0] === 'Installments waiting for a NAV' && row[1] === '1'));
    assert.equal(byType(detect({ funds: [fund()] }), 'reconcile').length, 0);
});

test('two missed installments in a row on an active SIP need checking', () => {
    const items = statuses => statuses.map((status, i) => ({ investmentId: 'sip1', source: 'sip', dueDate: `2026-0${7 + i}-05`, amount: 5000, status }));
    const investments = active => [{ _id: 'sip1', kind: 'sip', isActive: active }];

    const [alert] = byType(detect({ funds: [fund({ installments: items(['allotted', 'skipped', 'skipped']), investments: investments(true) })] }), 'reconcile');
    assert.equal(alert.key, 'reconcile:missed:sip1');
    assert.deepEqual(alert.evidence.rows.map(row => row[0]), ['2026-08-05', '2026-09-05']);

    assert.equal(byType(detect({ funds: [fund({ installments: items(['skipped', 'skipped', 'allotted']), investments: investments(true) })] }), 'reconcile').length, 0);
    assert.equal(byType(detect({ funds: [fund({ installments: items(['allotted', 'skipped', 'skipped']), investments: investments(false) })] }), 'reconcile').length, 0);
});

/* ---------- Lifecycle ---------- */

test('planAlertChanges: create new, update open, reopen resolved, respect dismissals, resolve the gone', () => {
    const now = Date.parse('2026-10-25T06:00:00Z');
    const daysAgo = days => new Date(now - days * 86400000);
    const existing = [
        { key: 'a', status: 'open' },
        { key: 'b', status: 'resolved' },
        { key: 'c', status: 'dismissed', dismissedAt: daysAgo(10) },
        { key: 'd', status: 'dismissed', dismissedAt: daysAgo(40) },
        { key: 'e', status: 'open' },
        { key: 'g', status: 'dismissed', dismissedAt: daysAgo(1) }
    ];
    const active = ['a', 'b', 'c', 'd', 'f'].map(key => ({ key }));
    const plan = planAlertChanges(existing, active, now);

    assert.deepEqual(plan.create.map(a => a.key), ['f']);
    assert.deepEqual(plan.update.map(a => a.key), ['a']);
    // Dismissed 10 days ago: still quiet. 40 days ago: back.
    assert.deepEqual(plan.reopen.map(a => a.key), ['b', 'd']);
    assert.deepEqual(plan.resolve, ['e']);
});
