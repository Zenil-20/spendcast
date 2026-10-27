// Goals: the odds of reaching a target amount by a date, worked out by
// replaying the chosen funds' own monthly returns from history, plus the
// early warning: whether each goal is on track, how its odds have moved over
// the daily checks, and the smallest change that would bring it back.

const PortfolioSnapshot = require("../models/PortfolioSnapshot");
const navStore = require("./navStore");
const { loadFunds } = require("./portfolio");
const { round } = require("../utils/mfMath");
const { simulateGoal } = require("../utils/mfPlanning");
const { goalWatch, monthsToExtend, FIX_ODDS } = require("../utils/goalWatch");
const { shiftMonths } = require("../utils/projection");
const { addDays } = require("../utils/time");

// Fewer replays when searching for a later date: only the month count is kept.
const EXTENSION_PATHS = 500;
const HISTORY_DAYS = 45;

function goalView(goal) {
    return {
        id: goal._id ? String(goal._id) : null,
        name: goal.name,
        targetAmount: goal.targetAmount,
        targetDate: goal.targetDate,
        schemeCodes: goal.schemeCodes || [],
        monthlyContribution: goal.monthlyContribution ?? null,
        stepUpPercent: goal.stepUpPercent || 0
    };
}

// Each saved goal's daily checks before today, oldest first.
async function goalHistories(userId, today) {
    const snapshots = await PortfolioSnapshot.find(
        { userId, date: { $gte: addDays(today, -HISTORY_DAYS), $lt: today }, goals: { $exists: true } },
        { date: 1, goals: 1 }
    ).sort({ date: 1 }).lean();
    const histories = new Map();

    for (const snapshot of snapshots) {
        for (const item of snapshot.goals || []) {
            histories.set(item.goalId, [...(histories.get(item.goalId) || []), { date: snapshot.date, probability: item.probability, status: item.status }]);
        }
    }
    return histories;
}

// Evaluates goals against the user's funds, loading funds and NAVs once.
// `loaded` ({ funds, benchmark }) reuses funds the caller already has.
async function evaluateGoals(userId, goals, now, loaded = null) {
    const today = navStore.marketToday(now);
    const [benchmark, funds, histories] = await Promise.all([
        loaded ? loaded.benchmark : navStore.getBenchmark(),
        loaded ? loaded.funds : loadFunds(userId, today, null),
        goals.some(goal => goal._id) ? goalHistories(userId, today) : new Map()
    ]);

    return goals.map(raw => {
        const goal = goalView(raw);
        const wanted = goal.schemeCodes.length ? new Set(goal.schemeCodes) : null;
        // Funds sold since the goal was set simply drop out of it.
        const chosen = funds.filter(fund => !wanted || wanted.has(fund.holding.schemeCode));
        const currentSips = round(chosen.reduce((sum, fund) => sum + fund.holding.monthlySip, 0), 2);
        const monthlyContribution = goal.monthlyContribution ?? currentSips;
        const input = {
            funds: chosen.map(fund => ({ series: fund.history.series, value: fund.holding.value, monthlySip: fund.holding.monthlySip })),
            benchmark: benchmark?.series,
            today,
            targetDate: goal.targetDate,
            target: goal.targetAmount,
            monthlyContribution,
            stepUpPercent: goal.stepUpPercent,
            // Same inputs, same answer — before and after saving.
            seed: JSON.stringify([goal.targetAmount, goal.targetDate, goal.schemeCodes, monthlyContribution, goal.stepUpPercent])
        };

        const simulation = goal.targetDate > today ? simulateGoal(input) : null;

        // How much later the target date would need to be for 75% odds.
        const extension = simulation && simulation.probability < FIX_ODDS
            ? monthsToExtend(months => simulateGoal({ ...input, targetDate: shiftMonths(goal.targetDate, months), options: { paths: EXTENSION_PATHS } }).probability)
            : null;

        return {
            ...goal,
            today,
            funds: chosen.map((fund, i) => ({
                schemeCode: fund.holding.schemeCode,
                shortName: fund.holding.shortName,
                value: fund.holding.value,
                monthlySip: fund.holding.monthlySip,
                // How much of the sample is this fund's own history.
                historyMonths: simulation?.history.fundMonths[i] ?? null
            })),
            currentSips,
            effectiveMonthly: monthlyContribution,
            benchmarkName: benchmark?.meta?.schemeName || null,
            simulation,
            watch: goalWatch({ sim: simulation, history: histories.get(goal.id) || [], today, targetDate: goal.targetDate, extension })
        };
    });
}

module.exports = { evaluateGoals, goalView };
