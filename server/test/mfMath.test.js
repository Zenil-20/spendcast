const test = require('node:test');
const assert = require('node:assert/strict');

const {
    fromApiDate,
    scheduledDates,
    installmentAmount,
    stampDuty,
    buildInstallments,
    nextInstallment,
    xirr,
    trailingReturn,
    maxDrawdown,
    riskMetrics,
    priceContext,
    summarizeHolding,
    valueAveraging,
    portfolioTimeline,
    recentHolidays
} = require('../utils/mfMath');
const { addDays } = require('../utils/time');

// Builds a NAV series of weekdays between two dates, skipping `holidays`.
function weekdaySeries(from, to, navFor = () => 100, holidays = []) {
    const dates = [];
    const values = [];

    for (let date = from, i = 0; date <= to; date = addDays(date, 1)) {
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        if (weekday !== 0 && weekday !== 6 && !holidays.includes(date)) {
            dates.push(date);
            values.push(navFor(date, i++));
        }
    }

    return { dates, values };
}

const sip = (overrides = {}) => ({ kind: 'sip', amount: 5000, sipDay: 15, startDate: '2026-01-15', endDate: null, ...overrides });

test('mfapi dates are converted to ISO calendar dates', () => {
    assert.equal(fromApiDate('23-10-2026'), '2026-10-23');
});

test('SIP on the 31st falls on the last day of shorter months', () => {
    const dates = scheduledDates(sip({ sipDay: 31, startDate: '2026-01-31' }), '2026-04-30');
    assert.deepEqual(dates, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('a SIP started after its day in the month begins the next month', () => {
    assert.deepEqual(scheduledDates(sip({ startDate: '2026-01-20' }), '2026-03-31'), ['2026-02-15', '2026-03-15']);
});

test('SIP stops at its end date', () => {
    assert.deepEqual(scheduledDates(sip({ endDate: '2026-02-20' }), '2026-12-31'), ['2026-01-15', '2026-02-15']);
});

test('yearly step-up raises the installment every 12 months', () => {
    const investment = sip({ startDate: '2025-01-15', stepUpPercent: 10 });
    assert.equal(installmentAmount(investment, '2025-12-15'), 5000);
    assert.equal(installmentAmount(investment, '2026-01-15'), 5500);
    assert.equal(installmentAmount(investment, '2027-01-15'), 6050);
});

test('stamp duty of 0.005% applies from 1 July 2020', () => {
    assert.equal(stampDuty(5000, '2020-06-30'), 0);
    assert.equal(stampDuty(5000, '2020-07-01'), 0.25);
    assert.equal(stampDuty(100000, '2026-01-15'), 5);
});

test('installment on a market holiday is allotted at the next trading day NAV', () => {
    // 15 Aug 2026 is a Saturday; pretend Monday 17 Aug is a holiday too.
    const series = weekdaySeries('2026-08-01', '2026-08-31', (date) => (date === '2026-08-18' ? 50 : 40), ['2026-08-17']);
    const [installment] = buildInstallments(sip({ startDate: '2026-08-15' }), series, '2026-08-31');

    assert.equal(installment.status, 'allotted');
    assert.equal(installment.dueDate, '2026-08-15');
    assert.equal(installment.navDate, '2026-08-18');
    assert.equal(installment.shifted, true);
    assert.equal(installment.nav, 50);
    // (5000 - 0.25 stamp duty) / 50, rounded to 3 decimals
    assert.equal(installment.units, 99.995);
});

test('installment on a trading day uses that day NAV', () => {
    const series = weekdaySeries('2026-09-01', '2026-09-30', () => 25);
    const [installment] = buildInstallments(sip({ startDate: '2026-09-15' }), series, '2026-09-30');

    assert.equal(installment.navDate, '2026-09-15');
    assert.equal(installment.shifted, false);
    assert.equal(installment.units, 199.99);
});

test('installment due today waits until that NAV is published', () => {
    const series = weekdaySeries('2026-10-01', '2026-10-14');
    const installments = buildInstallments(sip({ startDate: '2026-10-15' }), series, '2026-10-15');

    assert.equal(installments[0].status, 'awaiting_nav');
});

test('future installments are not counted', () => {
    const series = weekdaySeries('2026-01-01', '2026-03-31');
    assert.equal(buildInstallments(sip(), series, '2026-02-20').length, 2);
});

test('skipped installments buy nothing', () => {
    const series = weekdaySeries('2026-01-01', '2026-03-31');
    const installments = buildInstallments(sip({ skippedDates: ['2026-02-15'] }), series, '2026-03-31');

    assert.deepEqual(installments.map(item => item.status), ['allotted', 'skipped', 'allotted']);
});

test('next installment flags a weekend due date', () => {
    const next = nextInstallment(sip({ startDate: '2026-01-15' }), '2026-11-02');
    assert.deepEqual(next, { dueDate: '2026-11-15', amount: 5000, onWeekend: true });
    assert.equal(nextInstallment(sip({ isActive: false }), '2026-11-02'), null);
});

test('XIRR matches a known answer', () => {
    // 10,000 invested, 11,000 back exactly one year later: 10%.
    const rate = xirr([{ date: '2025-01-01', amount: -10000 }, { date: '2026-01-01', amount: 11000 }]);
    assert.ok(Math.abs(rate - 0.1) < 1e-6, String(rate));
    assert.equal(xirr([{ date: '2025-01-01', amount: -100 }]), null);
});

test('XIRR handles a monthly SIP with a loss', () => {
    const flows = [];
    for (let month = 1; month <= 12; month++) flows.push({ date: `2025-${String(month).padStart(2, '0')}-15`, amount: -1000 });
    flows.push({ date: '2025-12-31', amount: 11000 });
    const rate = xirr(flows);
    assert.ok(rate < 0 && rate > -0.5, String(rate));
});

test('trailing returns annualise beyond one year', () => {
    // NAV doubles over two years: CAGR ≈ 41.4%.
    const series = weekdaySeries('2024-01-01', '2026-01-01', (date, i, ) => 100 * Math.pow(2, i / 522));
    const twoYear = trailingReturn(series, 24);
    assert.ok(Math.abs(twoYear - (Math.SQRT2 - 1)) < 0.01, String(twoYear));
    assert.equal(trailingReturn(series, 60), null);
});

test('max drawdown finds the largest fall', () => {
    const series = { dates: ['a', 'b', 'c', 'd', 'e'], values: [100, 120, 90, 130, 117] };
    const result = maxDrawdown(series);
    assert.equal(result.drawdown, -0.25);
    assert.equal(result.peakDate, 'b');
    assert.equal(result.troughDate, 'c');
});

test('risk metrics: a fund that is the benchmark has beta 1 and alpha 0', () => {
    let value = 100;
    const series = weekdaySeries('2025-01-01', '2026-06-30', (date, i) => (value *= 1 + Math.sin(i) * 0.01));
    const result = riskMetrics(series, { benchmark: series });

    assert.ok(Math.abs(result.beta - 1) < 1e-9);
    assert.ok(Math.abs(result.alpha) < 1e-9);
    assert.ok(result.volatility > 0);
    assert.ok(result.maxDrawdown.drawdown <= 0);
});

test('price context places the NAV in its 52-week range', () => {
    const series = weekdaySeries('2025-06-01', '2026-06-01', (date, i) => 100 + i);
    const context = priceContext(series);
    assert.equal(context.rangePosition, 1);
    assert.equal(context.fromHigh, 0);
});

test('holding summary adds up allotted installments', () => {
    const series = weekdaySeries('2026-01-01', '2026-03-31', (date) => (date < '2026-03-01' ? 50 : 60));
    const installments = buildInstallments(sip({ startDate: '2026-01-15' }), series, '2026-03-31');
    const summary = summarizeHolding(installments, series);

    assert.equal(summary.invested, 15000);
    assert.equal(summary.units, 99.995 * 2 + 83.329);
    assert.equal(summary.value, Math.round(summary.units * 60 * 100) / 100);
    assert.ok(summary.gain > 0);
    assert.ok(summary.xirr > 0);
});

test('value averaging shows the top-up needed to reach the target path', () => {
    const series = weekdaySeries('2025-01-01', '2026-01-01', () => 100);
    const installments = buildInstallments(sip({ startDate: '2025-01-15' }), series, '2026-01-01');
    const plan = valueAveraging(installments, series, 0.12);

    assert.ok(plan.gap > 0);
    assert.equal(plan.topUpUnits, Math.round((plan.gap / 100) * 1000) / 1000);
});

test('portfolio timeline tracks invested money and value over time', () => {
    const series = weekdaySeries('2026-01-01', '2026-03-31', () => 10);
    const installments = buildInstallments(sip({ startDate: '2026-01-15' }), series, '2026-03-31');
    const points = portfolioTimeline([{ installments, series }]);

    assert.equal(points[0].date, '2026-01-15');
    assert.equal(points[0].invested, 5000);
    assert.equal(points[points.length - 1].invested, 15000);
});

test('recent holidays are weekdays without a NAV', () => {
    const series = weekdaySeries('2026-09-20', '2026-10-23', () => 1, ['2026-10-02']);
    assert.deepEqual(recentHolidays(series, 30), ['2026-10-02']);
});

const { benchmarkComparison, isEquityTaxed, taxLots, estimateEquityTax } = require('../utils/mfMath');

test('benchmark comparison puts the same payments into the benchmark', () => {
    const fund = weekdaySeries('2025-01-01', '2026-01-31', () => 10);
    const benchmark = weekdaySeries('2025-01-01', '2026-01-31', (date) => (date < '2026-01-01' ? 100 : 120));
    const installments = buildInstallments(sip({ startDate: '2025-01-15', amount: 1000 }), fund, '2025-12-31');
    const result = benchmarkComparison(installments, benchmark, '2026-01-30');

    // 12 × (1000 − 0.05 stamp duty) / 100 × 120
    assert.equal(result.value, Math.round(12 * (999.95 / 100) * 120 * 100) / 100);
    assert.ok(result.xirr > 0);
});

test('equity taxation is decided by category, with debt index funds excluded', () => {
    assert.equal(isEquityTaxed({ schemeCategory: 'Equity Scheme - Flexi Cap Fund' }), true);
    assert.equal(isEquityTaxed({ schemeCategory: 'Hybrid Scheme - Aggressive Hybrid Fund' }), true);
    assert.equal(isEquityTaxed({ schemeCategory: 'Hybrid Scheme - Conservative Hybrid Fund' }), false);
    assert.equal(isEquityTaxed({ schemeCategory: 'Debt Scheme - Liquid Fund' }), false);
    assert.equal(isEquityTaxed({ schemeCategory: 'Other Scheme - Index Funds', schemeName: 'UTI Nifty 50 Index Fund' }), true);
    assert.equal(isEquityTaxed({ schemeCategory: 'Other Scheme - Index Funds', schemeName: 'Nifty SDL Apr 2027 Index Fund' }), false);
});

test('units held more than 12 months are long-term', () => {
    const latest = { date: '2026-01-15', nav: 20 };
    const lots = [
        { status: 'allotted', navDate: '2025-01-14', units: 10, amount: 100 }, // 1 year + 1 day: long-term
        { status: 'allotted', navDate: '2025-01-15', units: 10, amount: 100 }, // exactly 1 year: short-term
        { status: 'allotted', navDate: '2025-02-01', units: 10, amount: 100 }  // turns long-term within 30 days
    ];
    const result = taxLots(lots, latest, true);

    assert.equal(result.longTermGain, 100);
    assert.equal(result.shortTermGain, 200);
    assert.equal(result.turningLongTerm.gain, 200);
    assert.equal(result.turningLongTerm.firstDate, '2026-01-16');
});

test('non-equity gains go to the slab-rate bucket', () => {
    const result = taxLots([{ status: 'allotted', navDate: '2024-01-01', units: 10, amount: 100 }], { date: '2026-01-01', nav: 15 }, false);
    assert.equal(result.slabGain, 50);
    assert.equal(result.longTermGain, 0);
});

test('equity tax applies the ₹1.25 lakh exemption and 4% cess', () => {
    const tax = estimateEquityTax(225000, 10000);
    assert.equal(tax.longTermTax, Math.round(100000 * 0.125 * 1.04 * 100) / 100);
    assert.equal(tax.shortTermTax, Math.round(10000 * 0.2 * 1.04 * 100) / 100);
    assert.equal(tax.exemptionUsed, 125000);
    assert.equal(estimateEquityTax(-5000, -100).total, 0);
});

const { entrySignal } = require('../utils/mfMath');

test('entry signal needs 200 days plus a year of outcomes', () => {
    assert.equal(entrySignal(weekdaySeries('2025-01-01', '2026-01-01', () => 10)), null);
});

test('entry signal ranks today against the fund history and reports outcomes', () => {
    // A rising fund with a sine wave on top; it ends at a dip.
    const series = weekdaySeries('2018-01-01', '2026-06-30', (date, i) => 100 * Math.pow(1.0004, i) * (1 + 0.08 * Math.sin(i / 40)));
    const lastIndex = series.values.length - 1;
    // Force the last day well below trend.
    series.values[lastIndex] = series.values[lastIndex] * 0.85;

    const signal = entrySignal(series);
    assert.equal(signal.zone, 'below');
    assert.ok(signal.percentile < 0.05, String(signal.percentile));
    for (const zone of ['below', 'usual', 'above']) {
        assert.ok(signal.history[zone].samples > 100, zone);
        assert.ok(signal.history[zone].positiveShare >= 0 && signal.history[zone].positiveShare <= 1);
    }
    assert.ok(signal.thresholds.below < signal.thresholds.above);
});
