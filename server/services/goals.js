// Goals: the odds of reaching a target amount by a date, worked out by
// replaying the chosen funds' own monthly returns from history.

const navStore = require("./navStore");
const { loadFunds } = require("./portfolio");
const { round } = require("../utils/mfMath");
const { simulateGoal } = require("../utils/mfPlanning");

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

// Evaluates goals against the user's funds, loading funds and NAVs once.
async function evaluateGoals(userId, goals, now) {
    const today = navStore.marketToday(now);
    const [benchmark, funds] = await Promise.all([navStore.getBenchmark(), loadFunds(userId, today, null)]);

    return goals.map(raw => {
        const goal = goalView(raw);
        const wanted = goal.schemeCodes.length ? new Set(goal.schemeCodes) : null;
        // Funds sold since the goal was set simply drop out of it.
        const chosen = funds.filter(fund => !wanted || wanted.has(fund.holding.schemeCode));
        const currentSips = round(chosen.reduce((sum, fund) => sum + fund.holding.monthlySip, 0), 2);
        const monthlyContribution = goal.monthlyContribution ?? currentSips;

        const simulation = goal.targetDate > today
            ? simulateGoal({
                funds: chosen.map(fund => ({ series: fund.history.series, value: fund.holding.value, monthlySip: fund.holding.monthlySip })),
                benchmark: benchmark?.series,
                today,
                targetDate: goal.targetDate,
                target: goal.targetAmount,
                monthlyContribution,
                stepUpPercent: goal.stepUpPercent,
                // Same inputs, same answer — before and after saving.
                seed: JSON.stringify([goal.targetAmount, goal.targetDate, goal.schemeCodes, monthlyContribution, goal.stepUpPercent])
            })
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
            simulation
        };
    });
}

module.exports = { evaluateGoals, goalView };
