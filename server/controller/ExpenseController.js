const Expense = require('../models/Expense');
const MonthlyBudget = require('../models/MonthlyBudget');
const RecurringExpense = require('../models/RecurringExpense');
const HttpError = require('../utils/httpError');
const { getNow } = require('../utils/clock');
const { createMoneyRounder, parseAmount } = require('../utils/money');
const {
    getDaysInMonth,
    parseDateString,
    getLocalDateString,
    getElapsedDayFraction
} = require('../utils/time');
const {
    readBody,
    isMissing,
    readText,
    readEnum,
    readObjectId,
    readDateString,
    resolveExpenseDate
} = require('../utils/validation');
const {
    DEFAULTS,
    getMonthIndex,
    fromMonthIndex,
    getMonthStartString,
    getMonthLabel,
    classifyExpenses,
    forecastVariableSpend,
    backtestVariableModel,
    getScheduledPayments,
    compareWithBudget,
    sumAmounts
} = require('../utils/forecast');
const { loadEffectiveSettings } = require('../services/userSettings');

// 36 months gives two earlier years for every forecast month, which the
// seasonality check needs. Level and trend use only the last 12 months.
const HISTORY_MONTHS = 36;
// Forecast length in months: 3 by default, up to 12 with ?months=.
const DEFAULT_FORECAST_MONTHS = 3;
const MAX_FORECAST_MONTHS = 12;
const MAX_LIST_LIMIT = 500;
const PAYMENT_METHODS = Expense.schema.path('paymentMethod').enumValues;

function formatExpense(expense) {
    return {
        id: String(expense._id),
        title: expense.title,
        amount: expense.amount,
        currency: expense.currency,
        category: expense.category,
        date: expense.date,
        localDate: expense.localDate,
        paymentMethod: expense.paymentMethod,
        notes: expense.notes,
        recurringExpenseId: expense.recurringExpenseId ? String(expense.recurringExpenseId) : null
    };
}

// Creates an expense for the signed-in user. The amount is in the user's
// current currency and the date is resolved in the user's current timezone.
async function createExpense(req, res) {
    const body = readBody(req);
    const now = getNow(req);
    const { timezone, currency } = await loadEffectiveSettings(req.user.id, now);

    const title = readText(body.title, 'title');
    const category = readText(body.category, 'category', { max: 100 });
    const paymentMethod = readEnum(body.paymentMethod, 'paymentMethod', PAYMENT_METHODS);
    const notes = readText(body.notes, 'notes', { required: false, max: 1000 }) || '';
    const { date, localDate } = resolveExpenseDate(body.date, timezone, now);
    const { amount, error } = parseAmount(body.amount, currency);

    if (error) {
        throw new HttpError(400, error);
    }

    let recurringExpenseId = null;

    if (!isMissing(body.recurringExpenseId)) {
        recurringExpenseId = readObjectId(body.recurringExpenseId, 'recurringExpenseId');

        const rule = await RecurringExpense.findOne({
            _id: recurringExpenseId,
            userId: req.user.id
        }).lean();

        if (!rule) {
            throw new HttpError(400, 'recurringExpenseId does not match any of your recurring expenses.');
        }

        if (rule.currency !== currency) {
            throw new HttpError(400, `This recurring expense is in ${rule.currency}, but your current currency is ${currency}.`);
        }
    }

    const expense = await Expense.create({
        title,
        amount,
        currency,
        category,
        date,
        localDate,
        paymentMethod,
        notes,
        userId: req.user.id,
        recurringExpenseId
    });

    res.status(201).json({
        success: true,
        expense: formatExpense(expense)
    });
}

// Lists the user's expenses, newest first, optionally between two local dates.
async function listExpenses(req, res) {
    const filter = { userId: req.user.id };
    const localDate = {};

    if (!isMissing(req.query.from)) {
        localDate.$gte = readDateString(req.query.from, 'from');
    }

    if (!isMissing(req.query.to)) {
        localDate.$lte = readDateString(req.query.to, 'to');
    }

    if (Object.keys(localDate).length > 0) {
        filter.localDate = localDate;
    }

    const limit = isMissing(req.query.limit) ? 100 : Number(req.query.limit);

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
        throw new HttpError(400, `limit must be an integer from 1 to ${MAX_LIST_LIMIT}.`);
    }

    const expenses = await Expense.find(filter)
        .sort({ localDate: -1, date: -1 })
        .limit(limit)
        .lean();

    res.status(200).json({
        success: true,
        expenses: expenses.map(formatExpense)
    });
}

async function deleteExpense(req, res) {
    const id = readObjectId(req.params.id, 'id');
    const result = await Expense.deleteOne({ _id: id, userId: req.user.id });

    if (result.deletedCount === 0) {
        throw new HttpError(404, 'Expense not found.');
    }

    res.status(200).json({ success: true });
}

// Coverage depends on how many months have data and how densely they cover the
// period from the first recorded month up to the last completed month.
function getDataCoverage(completedMonths, currentMonthIndex, usedPartialMonth) {
    if (usedPartialMonth || completedMonths.length < 3) {
        return "limited";
    }

    const spanMonths = currentMonthIndex - completedMonths[0].monthIndex;
    const density = completedMonths.length / spanMonths;

    return completedMonths.length >= 6 && density >= 0.75
        ? "strong"
        : "moderate";
}

function readForecastMonths(value) {
    if (isMissing(value)) {
        return DEFAULT_FORECAST_MONTHS;
    }

    const months = Number(value);

    if (!Number.isInteger(months) || months < 1 || months > MAX_FORECAST_MONTHS) {
        throw new HttpError(400, `months must be an integer from 1 to ${MAX_FORECAST_MONTHS}.`);
    }

    return months;
}

// Forecasts the rest of the current month and the next months (3 by default),
// in the user's timezone and currency. Each month is variable spend (from the
// model) plus recurring payments scheduled for that month.
async function forecastMonthlyExpenditure(req, res) {
    const userId = req.user.id;
    const forecastMonthCount = readForecastMonths(req.query.months);
    const now = getNow(req);
    const { timezone, currency } = await loadEffectiveSettings(userId, now);
    const roundMoney = createMoneyRounder(currency);

    const today = getLocalDateString(now, timezone);
    const { year: currentYear, month: currentMonth, day: currentDay } = parseDateString(today);
    const currentMonthIndex = getMonthIndex(currentYear, currentMonth);
    const dateRange = {
        $gte: getMonthStartString(currentMonthIndex - HISTORY_MONTHS),
        $lt: getMonthStartString(currentMonthIndex + 1)
    };

    // Inactive rules are loaded too: a cancelled subscription still explains
    // payments in past months. Only active rules are scheduled ahead.
    const [expenses, otherCurrencyCount, allRules, budget] = await Promise.all([
        Expense.find({ userId, currency, localDate: dateRange })
            .select("title category amount localDate recurringExpenseId")
            .lean(),
        Expense.countDocuments({ userId, currency: { $ne: currency }, localDate: dateRange }),
        RecurringExpense.find({ userId })
            .select("title category amount currency frequency startDate endDate isActive")
            .lean(),
        MonthlyBudget.findOne({ userId }).lean()
    ]);

    // Amounts are never converted between currencies, so data recorded in
    // another currency is left out and reported.
    const warnings = [];
    const rules = allRules.filter(rule => rule.currency === currency);

    if (otherCurrencyCount > 0) {
        warnings.push(`${otherCurrencyCount} expense(s) recorded in another currency were excluded. Amounts are not converted between currencies.`);
    }

    if (rules.length < allRules.length) {
        warnings.push(`${allRules.length - rules.length} recurring expense(s) in another currency were excluded.`);
    }

    let budgetAmount = null;

    if (budget && budget.currency === currency) {
        budgetAmount = budget.amount;
    } else if (budget) {
        warnings.push(`Your budget is set in ${budget.currency}. Set it again in ${currency} to compare the forecast with it.`);
    }

    const buckets = classifyExpenses(expenses, rules);
    const completedMonths = [...buckets.values()]
        .filter(bucket => bucket.monthIndex < currentMonthIndex)
        .sort((a, b) => a.monthIndex - b.monthIndex);
    const currentBucket = buckets.get(currentMonthIndex) || null;

    const daysInCurrentMonth = getDaysInMonth(currentYear, currentMonth);
    // Days of this month that have passed, including the elapsed part of today.
    const elapsedDays = currentDay - 1 + getElapsedDayFraction(now, timezone);

    let observations = completedMonths.map(bucket => ({
        monthIndex: bucket.monthIndex,
        value: bucket.variable
    }));
    let usedPartialMonth = false;

    // With no completed month, extrapolate the current month, but only once
    // enough days have passed for the daily rate to mean something.
    if (observations.length === 0
        && currentBucket
        && elapsedDays >= DEFAULTS.minPartialMonthDays) {
        observations = [{
            monthIndex: currentMonthIndex,
            value: currentBucket.variable / elapsedDays * daysInCurrentMonth
        }];
        usedPartialMonth = true;
    }

    const monthlyHistory = completedMonths.map(bucket => {
        const { year, month } = fromMonthIndex(bucket.monthIndex);

        return {
            year,
            month,
            monthLabel: getMonthLabel(year, month),
            totalExpenditure: roundMoney(bucket.total),
            recurringExpenditure: roundMoney(bucket.recurring),
            variableExpenditure: roundMoney(bucket.variable),
            expenseCount: bucket.count
        };
    });

    if (observations.length === 0) {
        return res.status(200).json({
            success: true,
            message: "There is not enough expense history to estimate variable spending. Add expenses and recurring payments to improve the forecast.",
            timezone,
            currency,
            asOf: today,
            warnings,
            currentMonth: null,
            forecast: null,
            monthlyHistory
        });
    }

    const targetIndexes = [currentMonthIndex];

    for (let step = 1; step <= forecastMonthCount; step++) {
        targetIndexes.push(currentMonthIndex + step);
    }

    const [currentVariable, ...futureVariables] = forecastVariableSpend(observations, targetIndexes);
    const activeRules = rules.filter(rule => rule.isActive);

    // Current month: what is already spent, plus the expected variable spend
    // for the remaining time, plus this month's recurring payments not yet
    // recorded (including ones whose due date has passed but are not logged).
    const paidRuleIds = currentBucket ? currentBucket.paidRuleIds : new Set();
    const upcomingPayments = getScheduledPayments(activeRules, currentYear, currentMonth)
        .filter(payment => !paidRuleIds.has(payment.recurringExpenseId));
    const upcomingRecurring = sumAmounts(upcomingPayments);
    const spentSoFar = currentBucket ? currentBucket.total : 0;
    const remainingShare = (daysInCurrentMonth - elapsedDays) / daysInCurrentMonth;
    const remainingVariable = currentVariable.estimate * remainingShare;
    const currentProjected = spentSoFar + remainingVariable + upcomingRecurring;
    const currentHigh = spentSoFar + currentVariable.high * remainingShare + upcomingRecurring;

    const currentMonthForecast = {
        year: currentYear,
        month: currentMonth,
        monthLabel: getMonthLabel(currentYear, currentMonth),
        daysElapsed: Math.round(elapsedDays * 100) / 100,
        daysInMonth: daysInCurrentMonth,
        spentSoFar: roundMoney(spentSoFar),
        recurringSpentSoFar: roundMoney(currentBucket ? currentBucket.recurring : 0),
        variableSpentSoFar: roundMoney(currentBucket ? currentBucket.variable : 0),
        expectedRemainingVariableExpenditure: roundMoney(remainingVariable),
        upcomingRecurringExpenditure: roundMoney(upcomingRecurring),
        projectedTotalExpenditure: roundMoney(currentProjected),
        projectedTotalRange: {
            low: roundMoney(spentSoFar + currentVariable.low * remainingShare + upcomingRecurring),
            high: roundMoney(currentHigh)
        },
        budget: budgetAmount,
        ...compareWithBudget(currentProjected, currentHigh, budgetAmount, roundMoney),
        upcomingRecurringPayments: upcomingPayments
    };

    const forecastMonths = futureVariables.map(variable => {
        const { year, month } = fromMonthIndex(variable.monthIndex);
        const recurringPayments = getScheduledPayments(activeRules, year, month);
        const recurringTotal = sumAmounts(recurringPayments);
        const estimatedTotal = variable.estimate + recurringTotal;
        const estimatedHigh = variable.high + recurringTotal;

        return {
            year,
            month,
            monthLabel: getMonthLabel(year, month),
            estimatedVariableExpenditure: roundMoney(variable.estimate),
            variableExpenditureRange: {
                low: roundMoney(variable.low),
                high: roundMoney(variable.high)
            },
            seasonalFactor: Math.round(variable.seasonalFactor * 1000) / 1000,
            expectedRecurringExpenditure: roundMoney(recurringTotal),
            estimatedTotalExpenditure: roundMoney(estimatedTotal),
            estimatedTotalRange: {
                low: roundMoney(variable.low + recurringTotal),
                high: roundMoney(estimatedHigh)
            },
            budget: budgetAmount,
            ...compareWithBudget(estimatedTotal, estimatedHigh, budgetAmount, roundMoney),
            recurringPayments
        };
    });

    // Walk-forward backtest of the variable-spend model on this user's history.
    const backtest = usedPartialMonth ? null : backtestVariableModel(observations);

    return res.status(200).json({
        success: true,
        forecastHorizonMonths: forecastMonthCount,
        timezone,
        currency,
        asOf: today,
        method: "Recency-weighted, outlier-capped baseline with a damped, capped Theil-Sen trend (6+ months), a conservative seasonal adjustment (2+ years), plus scheduled recurring payments",
        dataCoverage: getDataCoverage(completedMonths, currentMonthIndex, usedPartialMonth),
        historicalMonthsUsed: completedMonths.length,
        usedPartialMonth,
        accuracy: backtest && {
            ...backtest,
            meanAbsoluteError: roundMoney(backtest.meanAbsoluteError)
        },
        warnings,
        limitations: [
            "Forecasts are estimates, not guarantees. Ranges are 80% prediction intervals.",
            "Months without recorded transactions are treated as missing, not as zero spending.",
            "Unlinked expenses are matched to recurring rules by category and amount (within 5%); linking them explicitly is more reliable.",
            "Seasonality is applied only when the same month moved the same way in at least two earlier years."
        ],
        monthlyHistory,
        currentMonth: currentMonthForecast,
        forecast: forecastMonths
    });
}

module.exports = {
    createExpense,
    listExpenses,
    deleteExpense,
    forecastMonthlyExpenditure
};
