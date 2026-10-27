const Goal = require('../models/Goal');
const Investment = require('../models/Investment');
const HttpError = require('../utils/httpError');
const { getNow } = require('../utils/clock');
const { parseAmount } = require('../utils/money');
const { readBody, isMissing, readText, readObjectId, readDateString } = require('../utils/validation');
const { addDays } = require('../utils/time');
const navStore = require('../services/navStore');
const { evaluateGoals } = require('../services/goals');
const { recordGoals } = require('../services/analytics');

const MAX_GOALS = 20;
const MAX_TARGET = 1e11;
const MAX_MONTHLY = 1e8;

// Validates a new or changed goal. `existing` is the stored goal when editing.
async function readGoal(userId, body, now, existing = null) {
    const merged = { ...(existing || {}), ...body };
    const today = navStore.marketToday(now);

    const name = readText(merged.name, 'name', { max: 60 });
    const { amount: targetAmount, error } = parseAmount(merged.targetAmount, 'INR');
    if (error) throw new HttpError(400, `targetAmount: ${error}`);
    if (targetAmount < 1000 || targetAmount > MAX_TARGET) throw new HttpError(400, 'targetAmount must be between ₹1,000 and ₹10,000 crore.');

    const targetDate = readDateString(merged.targetDate, 'targetDate');
    if (targetDate < addDays(today, 31)) throw new HttpError(400, 'targetDate must be at least a month from today.');
    if (targetDate > addDays(today, 365 * 40)) throw new HttpError(400, 'targetDate must be within 40 years.');

    const codes = isMissing(merged.schemeCodes) ? [] : merged.schemeCodes;
    if (!Array.isArray(codes) || codes.length > 20) throw new HttpError(400, 'schemeCodes must be a list of at most 20 funds.');
    const schemeCodes = [...new Set(codes.map(Number))];
    if (schemeCodes.some(code => !Number.isInteger(code) || code <= 0)) throw new HttpError(400, 'schemeCodes must be valid scheme codes.');
    if (schemeCodes.length) {
        // Only the customer's own funds can count towards a goal.
        const held = new Set(await Investment.distinct('schemeCode', { userId, schemeCode: { $in: schemeCodes } }));
        if (schemeCodes.some(code => !held.has(code))) throw new HttpError(400, 'A goal can only include funds you hold.');
    }

    let monthlyContribution = null;
    if (!isMissing(merged.monthlyContribution)) {
        monthlyContribution = Number(merged.monthlyContribution);
        if (!Number.isFinite(monthlyContribution) || monthlyContribution < 0 || monthlyContribution > MAX_MONTHLY) {
            throw new HttpError(400, 'monthlyContribution must be between 0 and ₹10 crore, or empty to use your current SIPs.');
        }
        monthlyContribution = Math.round(monthlyContribution);
    }

    const stepUpPercent = isMissing(merged.stepUpPercent) ? 0 : Number(merged.stepUpPercent);
    if (!Number.isFinite(stepUpPercent) || stepUpPercent < 0 || stepUpPercent > 50) {
        throw new HttpError(400, 'stepUpPercent must be between 0 and 50.');
    }

    return { name, targetAmount, targetDate, schemeCodes, monthlyContribution, stepUpPercent };
}

async function findGoal(req) {
    const goal = await Goal.findOne({ _id: readObjectId(req.params.id, 'id'), userId: req.user.id }).lean();
    if (!goal) throw new HttpError(404, 'Goal not found.');
    return goal;
}

// GET /goals
async function listGoals(req, res) {
    const now = getNow(req);
    const goals = await Goal.find({ userId: req.user.id }).sort({ targetDate: 1 }).lean();
    const evaluated = await evaluateGoals(req.user.id, goals, now);
    // Today's odds feed the trend; a failed write shouldn't fail the page.
    await recordGoals(req.user.id, now, evaluated).catch(error => console.error('[goals] Snapshot failed:', error.message));
    res.status(200).json({ success: true, goals: evaluated });
}

// POST /goals/preview — the odds for a goal without saving it.
async function previewGoal(req, res) {
    const input = await readGoal(req.user.id, readBody(req), getNow(req));
    const [goal] = await evaluateGoals(req.user.id, [input], getNow(req));
    res.status(200).json({ success: true, goal });
}

// POST /goals
async function createGoal(req, res) {
    const input = await readGoal(req.user.id, readBody(req), getNow(req));
    if (await Goal.countDocuments({ userId: req.user.id }) >= MAX_GOALS) {
        throw new HttpError(400, `You can keep up to ${MAX_GOALS} goals. Delete one to add another.`);
    }
    const goal = await Goal.create({ ...input, userId: req.user.id });
    const [view] = await evaluateGoals(req.user.id, [goal.toObject()], getNow(req));
    res.status(201).json({ success: true, goal: view });
}

// PATCH /goals/:id
async function updateGoal(req, res) {
    const existing = await findGoal(req);
    const input = await readGoal(req.user.id, readBody(req), getNow(req), existing);
    const goal = await Goal.findOneAndUpdate({ _id: existing._id, userId: req.user.id }, { $set: input }, { new: true, runValidators: true }).lean();
    const [view] = await evaluateGoals(req.user.id, [goal], getNow(req));
    res.status(200).json({ success: true, goal: view });
}

// DELETE /goals/:id
async function deleteGoal(req, res) {
    const goal = await findGoal(req);
    await Goal.deleteOne({ _id: goal._id, userId: req.user.id });
    res.status(200).json({ success: true, id: String(goal._id) });
}

module.exports = { listGoals, previewGoal, createGoal, updateGoal, deleteGoal };
