const RecurringExpense = require("../models/RecurringExpense");
const HttpError = require("../utils/httpError");
const { getNow } = require("../utils/clock");
const { parseAmount } = require("../utils/money");
const { parseDateString } = require("../utils/time");
const { toCalendarDateString } = require("../utils/forecast");
const {
    readBody,
    isMissing,
    readText,
    readEnum,
    readObjectId,
    readDateString
} = require("../utils/validation");
const { loadEffectiveSettings } = require("../services/userSettings");

const FREQUENCIES = RecurringExpense.schema.path("frequency").enumValues;

// Rule dates are calendar dates, stored at UTC midnight.
function toStoredDate(dateString) {
    const { year, month, day } = parseDateString(dateString);

    return new Date(Date.UTC(year, month - 1, day));
}

function formatRule(rule) {
    return {
        id: String(rule._id),
        title: rule.title,
        category: rule.category,
        amount: rule.amount,
        currency: rule.currency,
        frequency: rule.frequency,
        startDate: toCalendarDateString(rule.startDate),
        endDate: rule.endDate ? toCalendarDateString(rule.endDate) : null,
        isActive: rule.isActive
    };
}

function readEndDate(value, startDate) {
    if (isMissing(value)) {
        return null;
    }

    const endDate = readDateString(value, "endDate");

    if (endDate < startDate) {
        throw new HttpError(400, "endDate cannot be before startDate.");
    }

    return endDate;
}

async function createRecurringExpense(req, res) {
    const body = readBody(req);
    const { currency } = await loadEffectiveSettings(req.user.id, getNow(req));
    const title = readText(body.title, "title");
    const category = readText(body.category, "category", { max: 100 });
    const frequency = readEnum(body.frequency, "frequency", FREQUENCIES);
    const startDate = readDateString(body.startDate, "startDate");
    const endDate = readEndDate(body.endDate, startDate);
    const { amount, error } = parseAmount(body.amount, currency);

    if (error) {
        throw new HttpError(400, error);
    }

    const rule = await RecurringExpense.create({
        userId: req.user.id,
        title,
        category,
        amount,
        currency,
        frequency,
        startDate: toStoredDate(startDate),
        endDate: endDate ? toStoredDate(endDate) : null
    });

    res.status(201).json({
        success: true,
        recurringExpense: formatRule(rule)
    });
}

async function listRecurringExpenses(req, res) {
    const rules = await RecurringExpense.find({ userId: req.user.id })
        .sort({ createdAt: 1 })
        .lean();

    res.status(200).json({
        success: true,
        recurringExpenses: rules.map(formatRule)
    });
}

// Activates/deactivates a rule or changes its end date.
async function updateRecurringExpense(req, res) {
    const id = readObjectId(req.params.id, "id");
    const body = readBody(req);
    const rule = await RecurringExpense.findOne({ _id: id, userId: req.user.id });

    if (!rule) {
        throw new HttpError(404, "Recurring expense not found.");
    }

    if (body.isActive !== undefined) {
        if (typeof body.isActive !== "boolean") {
            throw new HttpError(400, "isActive must be true or false.");
        }

        rule.isActive = body.isActive;
    }

    if (body.endDate !== undefined) {
        const endDate = readEndDate(body.endDate, toCalendarDateString(rule.startDate));
        rule.endDate = endDate ? toStoredDate(endDate) : null;
    }

    await rule.save();

    res.status(200).json({
        success: true,
        recurringExpense: formatRule(rule)
    });
}

module.exports = {
    createRecurringExpense,
    listRecurringExpenses,
    updateRecurringExpense
};
