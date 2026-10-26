const MonthlyBudget = require("../models/MonthlyBudget");
const Expense = require("../models/Expense");
const RecurringExpense = require("../models/RecurringExpense");
const HttpError = require("../utils/httpError");
const { getNow } = require("../utils/clock");
const { normalizeTimeZone, getSupportedTimeZones } = require("../utils/time");
const { normalizeCurrency, getSupportedCurrencies, parseAmount } = require("../utils/money");
const { readBody, isMissing } = require("../utils/validation");
const {
    loadSettings,
    loadEffectiveSettings,
    requestSettingsChange
} = require("../services/userSettings");

// Lists the values the UI can offer in its pickers.
function getOptions(req, res) {
    res.status(200).json({
        success: true,
        timezones: getSupportedTimeZones(),
        currencies: getSupportedCurrencies(),
        paymentMethods: Expense.schema.path("paymentMethod").enumValues,
        frequencies: RecurringExpense.schema.path("frequency").enumValues
    });
}

async function getSettings(req, res) {
    res.status(200).json({
        success: true,
        ...await loadSettings(req.user.id, getNow(req))
    });
}

// Changes take effect at the next local midnight; see services/userSettings.js.
async function updateSettings(req, res) {
    const body = readBody(req);
    const changes = {};

    if (!isMissing(body.timezone)) {
        changes.timezone = normalizeTimeZone(body.timezone);

        if (!changes.timezone) {
            throw new HttpError(400, "timezone must be a valid IANA timezone, e.g. Asia/Kolkata or America/New_York.");
        }
    }

    if (!isMissing(body.currency)) {
        changes.currency = normalizeCurrency(body.currency);

        if (!changes.currency) {
            throw new HttpError(400, "currency must be a valid ISO 4217 code, e.g. INR, USD, EUR.");
        }
    }

    if (Object.keys(changes).length === 0) {
        throw new HttpError(400, "Provide timezone and/or currency.");
    }

    res.status(200).json({
        success: true,
        ...await requestSettingsChange(req.user.id, changes, getNow(req))
    });
}

function formatBudget(budget, currency) {
    if (!budget) {
        return null;
    }

    return {
        amount: budget.amount,
        currency: budget.currency,
        // A budget set in another currency is not used by the forecast.
        matchesCurrentCurrency: budget.currency === currency
    };
}

async function getBudget(req, res) {
    const { currency } = await loadEffectiveSettings(req.user.id, getNow(req));
    const budget = await MonthlyBudget.findOne({ userId: req.user.id }).lean();

    res.status(200).json({
        success: true,
        budget: formatBudget(budget, currency)
    });
}

// Sets the monthly budget in the user's current currency.
async function setBudget(req, res) {
    const body = readBody(req);
    const { currency } = await loadEffectiveSettings(req.user.id, getNow(req));
    const { amount, error } = parseAmount(body.amount, currency);

    if (error) {
        throw new HttpError(400, error);
    }

    const budget = await MonthlyBudget.findOneAndUpdate(
        { userId: req.user.id },
        { amount, currency },
        { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    res.status(200).json({
        success: true,
        budget: formatBudget(budget, currency)
    });
}

module.exports = {
    getOptions,
    getSettings,
    updateSettings,
    getBudget,
    setBudget
};
