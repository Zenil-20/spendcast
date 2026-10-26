// Pure helpers for the expenditure forecast. They have no database access, so
// they can be unit tested. They work on calendar dates ("YYYY-MM-DD" strings)
// that were already resolved in the user's timezone, so nothing here depends
// on the server's timezone.

const { getDaysInMonth, toDateString } = require("./time");

const FREQUENCY_INTERVAL_MONTHS = {
    monthly: 1,
    quarterly: 3,
    yearly: 12
};

const DEFAULTS = {
    // Weight of a month halves every `halfLifeMonths` months into the past.
    halfLifeMonths: 3,
    // Level and trend are fitted on the most recent 12 months only; older
    // history is used for seasonality.
    trendWindowMonths: 12,
    // A trend is only fitted once there is enough history to tell it from noise.
    minMonthsForTrend: 6,
    // Each further month ahead keeps 80% of the previous month's trend.
    trendDamping: 0.8,
    // Trend can move the estimate by at most 25% of the baseline level.
    maxTrendShare: 0.25,
    // Months above median + 3 robust std deviations are capped (one-off purchases).
    outlierMultiplier: 3,
    // A partial month is only extrapolated once at least this many days have passed.
    minPartialMonthDays: 7,
    // An unlinked expense within 5% of a rule's amount counts as that rule's payment.
    recurringAmountTolerance: 0.05,
    // Backtesting starts once this many earlier months are available.
    minBacktestHistory: 3,
    // Seasonality needs the same month to move the same way in 2+ prior years.
    minSeasonalYears: 2,
    // Each seasonal sample needs 9+ of its trailing 12 months recorded.
    minSeasonalWindowMonths: 9,
    // Only half of the measured seasonal effect is applied, within these bounds.
    seasonalShrink: 0.5,
    minSeasonalFactor: 0.75,
    maxSeasonalFactor: 1.5,
    // z-score for an 80% prediction interval.
    intervalZ: 1.2816
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getMonthIndex(year, month) {
    return year * 12 + (month - 1);
}

// Month index of a "YYYY-MM-DD" calendar date.
function getMonthIndexOfDateString(dateString) {
    return getMonthIndex(Number(dateString.slice(0, 4)), Number(dateString.slice(5, 7)));
}

// Recurring rule dates are calendar dates stored at UTC midnight, so their UTC
// fields are the calendar date the user picked.
function toCalendarDateString(date) {
    const value = new Date(date);

    return toDateString(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

function fromMonthIndex(monthIndex) {
    return {
        year: Math.floor(monthIndex / 12),
        month: (monthIndex % 12) + 1
    };
}

function getMonthStartString(monthIndex) {
    const { year, month } = fromMonthIndex(monthIndex);

    return toDateString(year, month, 1);
}

const monthLabelFormat = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
});

function getMonthLabel(year, month) {
    return monthLabelFormat.format(new Date(Date.UTC(year, month - 1, 1)));
}

function median(values) {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Standard deviation estimate that a single extreme month cannot inflate.
// 1.4826 scales the median absolute deviation (MAD) to a normal std deviation.
// When more than half the values are identical MAD is 0, so fall back to the
// mean absolute deviation (scaled by 1.2533 for the same reason).
function robustStdDev(values) {
    if (values.length < 2) {
        return 0;
    }

    const center = median(values);
    const deviations = values.map(value => Math.abs(value - center));
    const mad = median(deviations);

    return mad > 0 ? 1.4826 * mad : 1.2533 * mean(deviations);
}

// Theil-Sen estimator: the median of all pairwise slopes. Unlike least squares,
// a few unusual months cannot drag the trend.
function theilSenSlope(points) {
    const slopes = [];

    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const run = points[j].monthIndex - points[i].monthIndex;

            if (run !== 0) {
                slopes.push((points[j].value - points[i].value) / run);
            }
        }
    }

    return median(slopes);
}

// Returns the due date ("YYYY-MM-DD") of `rule` in the given month, or null if
// the rule has no payment in that month.
function getRecurringDueDate(rule, year, month) {
    const interval = FREQUENCY_INTERVAL_MONTHS[rule.frequency];

    if (!interval || !rule.startDate) {
        return null;
    }

    const startDate = toCalendarDateString(rule.startDate);
    const monthsSinceStart = getMonthIndex(year, month) - getMonthIndexOfDateString(startDate);

    if (monthsSinceStart < 0 || monthsSinceStart % interval !== 0) {
        return null;
    }

    // A rule that starts on the 31st falls on the last day of shorter months.
    const day = Math.min(Number(startDate.slice(8, 10)), getDaysInMonth(year, month));
    const dueDate = toDateString(year, month, day);

    if (rule.endDate && dueDate > toCalendarDateString(rule.endDate)) {
        return null;
    }

    return dueDate;
}

function isRecurringDueInMonth(rule, year, month) {
    return getRecurringDueDate(rule, year, month) !== null;
}

function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
}

// Finds the rule an unlinked expense most likely pays: same category, due in
// that month, not already paid that month, and an amount within tolerance.
function findMatchingRule(expense, bucket, rules, tolerance) {
    const { year, month } = fromMonthIndex(bucket.monthIndex);
    const category = normalizeText(expense.category);
    const title = normalizeText(expense.title);
    let best = null;

    for (const rule of rules) {
        if (bucket.paidRuleIds.has(String(rule._id))
            || normalizeText(rule.category) !== category
            || !isRecurringDueInMonth(rule, year, month)) {
            continue;
        }

        const amountGap = Math.abs(expense.amount - rule.amount);

        if (amountGap > rule.amount * tolerance) {
            continue;
        }

        // Prefer the closest amount, then an exact title match.
        const titleMatches = normalizeText(rule.title) === title;

        if (!best
            || amountGap < best.amountGap
            || (amountGap === best.amountGap && titleMatches && !best.titleMatches)) {
            best = { rule, amountGap, titleMatches };
        }
    }

    return best ? best.rule : null;
}

// Groups expenses by calendar month and splits each month into recurring and
// variable spend. Expenses linked to a rule are recurring. Unlinked expenses
// that look like a scheduled payment are also treated as recurring, so a
// payment logged by hand is not counted twice (once in variable history and
// again as scheduled).
function classifyExpenses(expenses, rules, options = {}) {
    const { recurringAmountTolerance } = { ...DEFAULTS, ...options };
    const buckets = new Map();
    const unlinked = [];

    const getBucket = monthIndex => {
        if (!buckets.has(monthIndex)) {
            buckets.set(monthIndex, {
                monthIndex,
                total: 0,
                recurring: 0,
                variable: 0,
                count: 0,
                paidRuleIds: new Set()
            });
        }

        return buckets.get(monthIndex);
    };

    for (const expense of expenses) {
        const bucket = getBucket(getMonthIndexOfDateString(expense.localDate));

        bucket.total += expense.amount;
        bucket.count += 1;

        if (expense.recurringExpenseId) {
            bucket.recurring += expense.amount;
            bucket.paidRuleIds.add(String(expense.recurringExpenseId));
        } else {
            unlinked.push({ expense, bucket });
        }
    }

    // Linked payments are recorded first, so a rule already paid in a month
    // cannot also absorb an unrelated unlinked expense.
    for (const { expense, bucket } of unlinked) {
        const rule = findMatchingRule(expense, bucket, rules, recurringAmountTolerance);

        if (rule) {
            bucket.recurring += expense.amount;
            bucket.paidRuleIds.add(String(rule._id));
        } else {
            bucket.variable += expense.amount;
        }
    }

    return buckets;
}

// Seasonal factor for the calendar month of `targetIndex`. Each earlier year's
// value for that month is compared with the median of its trailing 12 months.
// The factor is only used when every year moves the same way, and then only
// the most conservative year's effect is applied (shrunk and bounded), so a
// one-off purchase in a single year cannot create a fake seasonal pattern.
function getSeasonalFactor(observations, targetIndex, config) {
    const byIndex = new Map(observations.map(item => [item.monthIndex, item.value]));
    const firstIndex = observations[0].monthIndex;
    const ratios = [];

    for (let index = targetIndex - 12; index >= firstIndex; index -= 12) {
        if (!byIndex.has(index)) {
            continue;
        }

        const window = [];

        for (let offset = 0; offset < 12; offset++) {
            if (byIndex.has(index - offset)) {
                window.push(byIndex.get(index - offset));
            }
        }

        // Median, not mean: other months' spikes (a holiday, a laptop) would
        // otherwise raise the baseline and make ordinary months look low.
        const typicalMonth = window.length >= config.minSeasonalWindowMonths ? median(window) : 0;

        if (typicalMonth > 0) {
            ratios.push(byIndex.get(index) / typicalMonth);
        }
    }

    if (ratios.length < config.minSeasonalYears
        || !(ratios.every(ratio => ratio > 1) || ratios.every(ratio => ratio < 1))) {
        return 1;
    }

    const conservative = ratios.reduce((closest, ratio) =>
        Math.abs(ratio - 1) < Math.abs(closest - 1) ? ratio : closest
    );

    return clamp(
        1 + config.seasonalShrink * (conservative - 1),
        config.minSeasonalFactor,
        config.maxSeasonalFactor
    );
}

// Fits the variable-spend model to observations of { monthIndex, value }.
function fitVariableModel(observations, options = {}) {
    const config = { ...DEFAULTS, ...options };
    const sorted = [...observations].sort((a, b) => a.monthIndex - b.monthIndex);
    const lastIndex = sorted[sorted.length - 1].monthIndex;
    const recent = sorted.filter(item => item.monthIndex > lastIndex - config.trendWindowMonths);
    const values = recent.map(item => item.value);

    // Cap one-off spikes (a laptop, a trip) so they do not raise every future month.
    const spread = robustStdDev(values);
    const cap = spread > 0
        ? median(values) + config.outlierMultiplier * spread
        : Infinity;
    const cleaned = recent.map(item => ({
        monthIndex: item.monthIndex,
        value: Math.min(item.value, cap)
    }));

    // Recency-weighted level. Weights use the real distance in months, so gaps
    // in the history are handled correctly.
    let weightSum = 0;
    let weightedValue = 0;
    let weightedIndex = 0;

    for (const item of cleaned) {
        const weight = Math.pow(0.5, (lastIndex - item.monthIndex) / config.halfLifeMonths);

        weightSum += weight;
        weightedValue += weight * item.value;
        weightedIndex += weight * item.monthIndex;
    }

    const level = weightedValue / weightSum;
    // The level describes spending at this (weighted) point in time, which lies
    // slightly before the last observed month.
    const levelIndex = weightedIndex / weightSum;

    const slope = cleaned.length >= config.minMonthsForTrend
        ? theilSenSlope(cleaned)
        : 0;

    const residuals = cleaned.map(item =>
        item.value - (level + slope * (item.monthIndex - levelIndex))
    );

    // With very little history the measured spread is unreliable, so enforce a
    // minimum width instead of reporting false precision.
    const minRelativeSpread = cleaned.length < 3 ? 0.25 : 0.1;
    const residualSpread = Math.max(robustStdDev(residuals), level * minRelativeSpread);

    return {
        level,
        levelIndex,
        lastIndex,
        slope,
        residualSpread,
        observations: sorted,
        observationCount: cleaned.length,
        config
    };
}

// Predicts variable spend for `targetIndex` (a month index) with an 80% range.
function predictVariable(model, targetIndex) {
    const { config } = model;
    const horizon = Math.max(0, targetIndex - model.lastIndex);

    // Inside the observed range the trend applies in full; beyond it, damped.
    let trendMonths = model.lastIndex - model.levelIndex;

    for (let step = 1; step <= horizon; step++) {
        trendMonths += Math.pow(config.trendDamping, step);
    }

    const maxAdjustment = config.maxTrendShare * model.level;
    const trendAdjustment = clamp(model.slope * trendMonths, -maxAdjustment, maxAdjustment);
    const seasonalFactor = getSeasonalFactor(model.observations, targetIndex, config);
    const estimate = Math.max(0, model.level + trendAdjustment) * seasonalFactor;

    // Uncertainty grows with the forecast horizon.
    const width = config.intervalZ
        * model.residualSpread
        * seasonalFactor
        * Math.sqrt(1 + 0.5 * (Math.max(1, horizon) - 1));

    return {
        estimate,
        low: Math.max(0, estimate - width),
        high: estimate + width,
        seasonalFactor
    };
}

function forecastVariableSpend(observations, targetIndexes, options = {}) {
    const model = fitVariableModel(observations, options);

    return targetIndexes.map(targetIndex => ({
        monthIndex: targetIndex,
        ...predictVariable(model, targetIndex)
    }));
}

// Walk-forward backtest: each past month is forecast using only the months
// before it, then compared with what was actually spent. Uses WAPE (total
// absolute error / total actual spend), which, unlike MAPE, is not blown up by
// months with very small spend.
function backtestVariableModel(observations, options = {}) {
    const config = { ...DEFAULTS, ...options };
    const sorted = [...observations].sort((a, b) => a.monthIndex - b.monthIndex);
    let absoluteError = 0;
    let actualTotal = 0;
    let evaluatedMonths = 0;

    for (let i = config.minBacktestHistory; i < sorted.length; i++) {
        const target = sorted[i];
        const model = fitVariableModel(sorted.slice(0, i), config);
        const { estimate } = predictVariable(model, target.monthIndex);

        absoluteError += Math.abs(estimate - target.value);
        actualTotal += target.value;
        evaluatedMonths += 1;
    }

    if (evaluatedMonths === 0 || actualTotal === 0) {
        return null;
    }

    return {
        evaluatedMonths,
        meanAbsoluteError: absoluteError / evaluatedMonths,
        weightedAbsolutePercentageError: Math.round((absoluteError / actualTotal) * 1000) / 10
    };
}

// Scheduled payments for the given month, from active rules only.
function getScheduledPayments(rules, year, month) {
    return rules
        .filter(rule => rule.isActive !== false)
        .map(rule => ({ rule, dueDate: getRecurringDueDate(rule, year, month) }))
        .filter(item => item.dueDate !== null)
        .map(({ rule, dueDate }) => ({
            recurringExpenseId: String(rule._id),
            title: rule.title,
            category: rule.category,
            amount: rule.amount,
            frequency: rule.frequency,
            dueDate
        }));
}

function compareWithBudget(estimate, high, budgetAmount, roundMoney) {
    if (budgetAmount === null) {
        return { budgetDifference: null, budgetStatus: "budget_not_set" };
    }

    let budgetStatus = "within_budget";

    if (estimate > budgetAmount) {
        budgetStatus = "over_budget";
    } else if (high > budgetAmount) {
        // The estimate fits, but the upper end of the range does not.
        budgetStatus = "at_risk";
    }

    return {
        budgetDifference: roundMoney(budgetAmount - estimate),
        budgetStatus
    };
}

function sumAmounts(items) {
    return items.reduce((sum, item) => sum + item.amount, 0);
}

module.exports = {
    DEFAULTS,
    getMonthIndex,
    getMonthIndexOfDateString,
    toCalendarDateString,
    fromMonthIndex,
    getMonthStartString,
    getMonthLabel,
    median,
    robustStdDev,
    theilSenSlope,
    getRecurringDueDate,
    isRecurringDueInMonth,
    classifyExpenses,
    getSeasonalFactor,
    fitVariableModel,
    predictVariable,
    forecastVariableSpend,
    backtestVariableModel,
    getScheduledPayments,
    compareWithBudget,
    sumAmounts
};
