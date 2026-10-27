// Goal early warning: whether a goal is on track, how that has changed, and
// the smallest change that would bring it back. Pure functions; the odds
// themselves come from mfPlanning.simulateGoal.

const { addDays } = require("./time");
const { shiftMonths } = require("./projection");

// A goal is on track at 75% odds or better, off track below 50%.
const ON_TRACK = 0.75;
const OFF_TRACK = 0.5;
// Once behind, a goal must reach 80% to count as back on track, so odds
// hovering around 75% don't flip the status (and alerts) every day.
const RECOVERED = 0.8;
// The fix aims for this chance of success.
const FIX_ODDS = 0.75;
const MAX_EXTENSION_MONTHS = 120;

function goalStatus(probability, previousStatus = null) {
    if (probability < OFF_TRACK) return "off_track";
    if (probability < ON_TRACK) return "at_risk";
    const wasBehind = previousStatus === "at_risk" || previousStatus === "off_track";
    return wasBehind && probability < RECOVERED ? "at_risk" : "on_track";
}

// Fewest extra months that give at least `odds`, by binary search.
// probabilityAt(extraMonths) -> chance of success with the deadline moved out.
// Returns null when even MAX_EXTENSION_MONTHS isn't enough.
function monthsToExtend(probabilityAt, odds = FIX_ODDS, maxMonths = MAX_EXTENSION_MONTHS) {
    if (probabilityAt(0) >= odds) return 0;
    if (probabilityAt(maxMonths) < odds) return null;
    let low = 0;          // not enough
    let high = maxMonths; // enough

    while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (probabilityAt(middle) >= odds) high = middle;
        else low = middle;
    }
    return high;
}

// The changes that would each, on their own, bring the odds to 75%. The
// primary one is the smallest change to the monthly contribution, since
// that's the lever most people can pull; the others are alternatives.
// sim: a simulateGoal result. extension: months from monthsToExtend.
function smallestFix(sim, { extension = null, targetDate = null } = {}) {
    if (!sim || sim.probability >= FIX_ODDS) return null;
    const options = [];

    const needed = sim.neededMonthly?.odds75;
    if (needed !== null && needed !== undefined) {
        const increase = Math.max(0, Math.ceil((needed - sim.monthlyContribution) / 100) * 100);
        options.push({ kind: "monthly", amount: increase, monthly: sim.monthlyContribution + increase });
    }
    if (sim.neededTopUp !== null && sim.neededTopUp !== undefined) {
        options.push({ kind: "topUp", amount: sim.neededTopUp });
    }
    if (extension !== null && extension > 0) {
        options.push({ kind: "extend", months: extension, date: targetDate ? shiftMonths(targetDate, extension) : null });
    }

    return {
        odds: FIX_ODDS,
        primary: options[0]?.kind ?? null,
        options
    };
}

// history: daily checks [{ date, probability, status }] oldest first, not
// including today. Returns how the odds moved over about 30 days and how many
// of the latest checks in a row were behind.
function goalTrend(history, today, probability) {
    const cutoff = addDays(today, -28);
    const earlier = [...history].reverse().find(item => item.date <= cutoff) || null;

    let behindDays = goalStatus(probability) === "on_track" ? 0 : 1;
    if (behindDays) {
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].status === "on_track") break;
            behindDays++;
        }
    }

    return {
        from: earlier ? earlier.date : null,
        previous: earlier ? earlier.probability : null,
        change: earlier ? probability - earlier.probability : null,
        behindDays
    };
}

function goalWatch({ sim, history = [], today, targetDate, extension = null }) {
    if (!sim) return null;
    const previous = history.length ? history[history.length - 1].status : null;
    return {
        status: goalStatus(sim.probability, previous),
        probability: sim.probability,
        trend: goalTrend(history, today, sim.probability),
        fix: smallestFix(sim, { extension, targetDate })
    };
}

module.exports = {
    ON_TRACK,
    OFF_TRACK,
    RECOVERED,
    FIX_ODDS,
    goalStatus,
    monthsToExtend,
    smallestFix,
    goalTrend,
    goalWatch
};
