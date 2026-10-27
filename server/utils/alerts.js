// Alerts that are worth reading: each fires only when a condition has lasted
// (not on one bad day), stays open until it has clearly gone away (a looser
// threshold to clear than to fire, so it doesn't flap), and says why it fired,
// over which period, with the data, and what to look into. Pure functions.
//
// Four kinds:
//   underperformance  an equity fund's 1-year return trailed the Nifty 50's at
//                     3 month-ends in a row
//   concentration     the largest fund, company or fund-pair overlap rose and
//                     has stayed high for a week
//   goal              a goal has been behind for 3 daily checks and is off
//                     track or 10+ points worse than a month ago
//   reconcile         data to check: a fund's NAV stopped updating, or a SIP's
//                     last two installments were both marked missed

const { navOnOrBefore, daysBetween } = require("./mfMath");
const { shiftMonths } = require("./projection");
const { addDays } = require("./time");

const RULES = {
    underperformance: { gap: -0.03, clearGap: -0.015, months: 3, history: 6, severeGap: -0.06 },
    concentration: {
        fund: { level: 0.5, clear: 0.45, rise: 0.1 },
        company: { level: 0.1, clear: 0.09, rise: 0.03 },
        overlap: { level: 0.5, clear: 0.45, rise: 0.1 }
    },
    goal: { behindDays: 3, drop: -0.1 },
    staleNavDays: 7,
    dismissCooldownDays: 30
};

const pct = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;

/* ---------- Underperformance ---------- */

// Last NAV date of each of the `count` most recent complete months.
function monthEnds(series, today, count) {
    const current = today.slice(0, 7);
    const last = new Map();
    series.dates.forEach(date => { if (date.slice(0, 7) < current) last.set(date.slice(0, 7), date); });
    return [...last.values()].sort().slice(-count);
}

function yearReturnAt(series, date) {
    const end = navOnOrBefore(series, date);
    const startDate = shiftMonths(date, -12);
    if (!end || !series.dates.length || series.dates[0] > startDate) return null;
    const start = navOnOrBefore(series, startDate);
    return start ? end.nav / start.nav - 1 : null;
}

function underperformance(fund, benchmark, today, isOpen) {
    const rule = RULES.underperformance;
    const rows = monthEnds(benchmark, today, rule.history)
        .map(date => {
            const own = yearReturnAt(fund.series, date);
            const index = yearReturnAt(benchmark, date);
            return own === null || index === null ? null : { date, fund: own, index, gap: own - index };
        })
        .filter(Boolean);
    if (rows.length < rule.months) return null;

    const recent = rows.slice(-rule.months);
    const latest = rows[rows.length - 1];
    const fires = recent.every(row => row.gap < rule.gap);
    const holds = isOpen && latest.gap <= rule.clearGap;
    if (!fires && !holds) return null;

    const widening = recent[recent.length - 1].gap < recent[0].gap;
    return {
        key: `underperformance:${fund.schemeCode}`,
        type: "underperformance",
        severity: latest.gap < rule.severeGap ? "warning" : "info",
        subject: { schemeCode: fund.schemeCode, shortName: fund.shortName },
        title: `${fund.shortName} has trailed the Nifty 50 for ${recent.length} months running`,
        why: fires
            ? `Its 1-year return was more than ${pct(-rule.gap, 0)} behind the Nifty 50's at each of the last ${rule.months} month-ends, and the gap is ${widening ? "widening" : "not widening"}.`
            : `Still open: the gap is ${pct(latest.gap)}, and it closes once it's back within ${pct(-rule.clearGap)}.`,
        period: { from: rows[0].date, to: latest.date },
        evidence: {
            columns: ["Month-end", "Fund, 1 year", "Nifty 50, 1 year", "Gap"],
            rows: rows.map(row => [row.date, pct(row.fund), pct(row.index), pct(row.gap)])
        },
        investigate: [
            "Compare it with its own category index and peers: a mid- or small-cap fund can trail the Nifty 50 for months when large companies lead.",
            "Check the fund's latest factsheet for a change of fund manager or investment mandate.",
            "Watch the gap column: a gap that keeps widening says more than one bad month."
        ],
        link: `/investments/${fund.schemeCode}`
    };
}

/* ---------- Concentration ---------- */

// Latest snapshot on or before `date`.
function snapshotAt(snapshots, date) {
    for (let i = snapshots.length - 1; i >= 0; i--) {
        if (snapshots[i].date <= date) return snapshots[i];
    }
    return null;
}

function concentrationAlerts(snapshots, today, openKeys) {
    const now = snapshotAt(snapshots, today);
    const week = snapshotAt(snapshots, addDays(today, -7));
    const month = snapshotAt(snapshots, addDays(today, -28));
    if (!now?.concentration || !week?.concentration || !month?.concentration) return [];
    const rules = RULES.concentration;
    const alerts = [];

    const check = ({ key, read, rule, title, why, label }) => {
        const current = read(now.concentration);
        const lastWeek = read(week.concentration);
        const lastMonth = read(month.concentration);
        if (current === null || lastWeek === null) return;
        const fires = current.share >= rule.level && lastWeek.share >= rule.level && lastMonth !== null && current.share - lastMonth.share >= rule.rise;
        const holds = openKeys.has(key) && current.share >= rule.clear;
        if (!fires && !holds) return;
        alerts.push({
            key,
            type: "concentration",
            severity: "info",
            subject: { name: current.name },
            title: title(current),
            why: fires ? why(current, lastMonth) : `Still open: ${pct(current.share)} now; it closes below ${pct(rule.clear, 0)}.`,
            period: { from: month.date, to: now.date },
            evidence: {
                columns: ["Date", label],
                rows: [[month.date, lastMonth ? `${pct(lastMonth.share)} (${lastMonth.name})` : "—"], [week.date, `${pct(lastWeek.share)} (${lastWeek.name})`], [now.date, `${pct(current.share)} (${current.name})`]]
            },
            investigate: [
                "Check whether the rise came from market moves or from new SIP installments and purchases going into the same place.",
                "See Health → Overlap for which funds hold the same companies.",
                "Decide whether this matches what you intend; concentration isn't wrong, but it should be deliberate."
            ],
            link: "/investments/health#overlap"
        });
    };

    check({
        key: "concentration:fund",
        rule: rules.fund,
        read: c => (c.largestFund ? { name: c.largestFund.shortName, share: c.largestFund.share } : null),
        title: c => `${c.name} is now ${pct(c.share, 0)} of your portfolio`,
        why: (c, before) => `It rose from ${pct(before.share)} a month ago and has been above ${pct(rules.fund.level, 0)} for at least a week.`,
        label: "Largest fund's share"
    });
    check({
        key: "concentration:company",
        rule: rules.company,
        read: c => (c.topCompany ? { name: c.topCompany.name, share: c.topCompany.share } : null),
        title: c => `${pct(c.share)} of what you own is now in ${c.name}`,
        why: (c, before) => `Through all your funds combined, up from ${pct(before.share)} a month ago and above ${pct(rules.company.level, 0)} for at least a week.`,
        label: "Largest company's share"
    });
    check({
        key: "concentration:overlap",
        rule: rules.overlap,
        read: c => (c.topPair ? { name: `${c.topPair.a} & ${c.topPair.b}`, share: c.topPair.overlap } : null),
        title: c => `${c.name} now overlap by ${pct(c.share, 0)}`,
        why: (c, before) => `Their holdings went from ${pct(before.share)} to ${pct(c.share)} the same in a month, so they add less diversification together.`,
        label: "Highest overlap between two funds"
    });

    return alerts;
}

/* ---------- Goals ---------- */

function goalAlert(goal, openKeys) {
    const watch = goal.watch;
    if (!watch || !goal.simulation) return null;
    const key = `goal:${goal.id}`;
    const behind = watch.status !== "on_track";
    const persistent = watch.trend.behindDays >= RULES.goal.behindDays;
    const worse = watch.status === "off_track" || (watch.trend.change !== null && watch.trend.change <= RULES.goal.drop);
    const fires = behind && persistent && worse;
    // Clearing waits for "on_track", which goalStatus only gives back at 80%.
    if (!fires && !(openKeys.has(key) && behind)) return null;

    const fix = watch.fix?.options?.[0];
    const fixText = !fix ? null
        : fix.kind === "monthly" ? `Adding ₹${fix.amount.toLocaleString("en-IN")} a month would bring the odds to about 75%.`
            : fix.kind === "topUp" ? `A one-time ₹${fix.amount.toLocaleString("en-IN")} would bring the odds to about 75%.`
                : `Moving the date out ${fix.months} months would bring the odds to about 75%.`;

    return {
        key,
        type: "goal",
        severity: watch.status === "off_track" ? "warning" : "info",
        subject: { goalId: goal.id, name: goal.name },
        title: `"${goal.name}" is ${watch.status === "off_track" ? "off track" : "at risk"}: ${Math.round(watch.probability * 100)}% chance`,
        why: `It has been behind for ${watch.trend.behindDays} daily checks in a row${watch.trend.change !== null ? `, and the odds moved ${watch.trend.change >= 0 ? "up" : "down"} ${Math.round(Math.abs(watch.trend.change) * 100)} points since ${watch.trend.from}` : ""}.`,
        period: { from: watch.trend.from || goal.today, to: goal.today },
        evidence: {
            columns: ["", "Value"],
            rows: [
                ["Chance of reaching the target", `${Math.round(watch.probability * 100)}%`],
                ...(watch.trend.previous !== null ? [[`Chance on ${watch.trend.from}`, `${Math.round(watch.trend.previous * 100)}%`]] : []),
                ["Typical outcome", `₹${goal.simulation.outcomes.median.toLocaleString("en-IN")}`],
                ["Target", `₹${goal.targetAmount.toLocaleString("en-IN")}`],
                ["Monthly contribution", `₹${goal.effectiveMonthly.toLocaleString("en-IN")}`]
            ]
        },
        investigate: [
            ...(fixText ? [fixText] : []),
            "Check whether a SIP counted towards this goal was stopped or missed.",
            "Odds move with markets; a goal a few points behind after a fall often recovers. These are odds, not promises."
        ],
        link: "/investments/planning#goals"
    };
}

/* ---------- Reconciliation ---------- */

function reconcileAlerts(funds, benchmark, today) {
    const alerts = [];
    const marketDate = benchmark?.dates[benchmark.dates.length - 1] || null;

    for (const fund of funds) {
        const lastNav = fund.series.dates[fund.series.dates.length - 1];
        if (marketDate && lastNav && daysBetween(lastNav, marketDate) >= RULES.staleNavDays && fund.value > 0) {
            const waiting = (fund.installments || []).filter(item => item.status === "awaiting_nav" && item.dueDate <= today);
            alerts.push({
                key: `reconcile:nav:${fund.schemeCode}`,
                type: "reconcile",
                severity: "warning",
                subject: { schemeCode: fund.schemeCode, shortName: fund.shortName },
                title: `${fund.shortName} hasn't had a new NAV since ${lastNav}`,
                why: `The market's latest NAVs are from ${marketDate}, ${daysBetween(lastNav, marketDate)} days later, so this fund's value and any new installments can't be updated.`,
                period: { from: lastNav, to: marketDate },
                evidence: {
                    columns: ["", "Value"],
                    rows: [["Last NAV for this fund", lastNav], ["Latest market NAVs", marketDate], ["Installments waiting for a NAV", String(waiting.length)]]
                },
                investigate: [
                    "Look the scheme up on your CAS statement or the AMC's site: it may have merged into another scheme, been renamed, or been wound up.",
                    "If it merged, add the new scheme and record the switch, so your value stays right."
                ],
                link: `/investments/${fund.schemeCode}`
            });
        }

        // The last two installments of an active SIP both marked missed.
        const bySip = new Map();
        for (const item of fund.installments || []) {
            if (item.source !== "sip" || item.status === "awaiting_nav") continue;
            bySip.set(item.investmentId, [...(bySip.get(item.investmentId) || []), item]);
        }
        for (const [investmentId, items] of bySip) {
            const sip = (fund.investments || []).find(item => String(item._id ?? item.id) === investmentId);
            if (sip && sip.isActive === false) continue;
            const last = items.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(-2);
            if (last.length < 2 || !last.every(item => item.status === "skipped")) continue;
            alerts.push({
                key: `reconcile:missed:${investmentId}`,
                type: "reconcile",
                severity: "warning",
                subject: { schemeCode: fund.schemeCode, shortName: fund.shortName, investmentId },
                title: `Your last two ${fund.shortName} SIP installments were missed`,
                why: `The installments due ${last[0].dueDate} and ${last[1].dueDate} are both marked missed, but the SIP is still active, so forecasts and goals still count future installments.`,
                period: { from: last[0].dueDate, to: last[1].dueDate },
                evidence: { columns: ["Due", "Amount", "Status"], rows: last.map(item => [item.dueDate, `₹${item.amount.toLocaleString("en-IN")}`, "Missed"]) },
                investigate: [
                    "Check the mandate with your bank or the AMC: repeated failed debits can cancel a mandate.",
                    "If you stopped this SIP on purpose, mark it stopped so forecasts and goals don't count it."
                ],
                link: `/investments/${fund.schemeCode}`
            });
        }
    }

    return alerts;
}

/* ---------- All rules ---------- */

// funds: [{ schemeCode, shortName, equityTaxed, series, value, installments, investments }]
// snapshots: daily portfolio snapshots, oldest first, today's included.
// goals: evaluated goals with `watch`. openKeys: keys of alerts open now.
function detectAlerts({ today, funds, benchmark, snapshots = [], goals = [], openKeys = new Set() }) {
    const alerts = [];

    if (benchmark) {
        for (const fund of funds) {
            if (!fund.equityTaxed || !(fund.value > 0)) continue;
            const alert = underperformance(fund, benchmark, today, openKeys.has(`underperformance:${fund.schemeCode}`));
            if (alert) alerts.push(alert);
        }
    }
    alerts.push(...concentrationAlerts(snapshots, today, openKeys));
    for (const goal of goals) {
        const alert = goalAlert(goal, openKeys);
        if (alert) alerts.push(alert);
    }
    alerts.push(...reconcileAlerts(funds, benchmark, today));

    return alerts;
}

// What to do with stored alerts given the ones active now.
// existing: [{ key, status: "open" | "dismissed" | "resolved", dismissedAt }]
// Returns keys to create, update, reopen and resolve. Created and reopened
// alerts are the new ones worth notifying about.
function planAlertChanges(existing, active, now) {
    const byKey = new Map(existing.map(item => [item.key, item]));
    const activeKeys = new Set(active.map(alert => alert.key));
    const cooldown = RULES.dismissCooldownDays * 86400000;
    const plan = { create: [], update: [], reopen: [], resolve: [] };

    for (const alert of active) {
        const stored = byKey.get(alert.key);
        if (!stored) plan.create.push(alert);
        else if (stored.status === "open") plan.update.push(alert);
        else if (stored.status === "resolved") plan.reopen.push(alert);
        // Dismissed: stays quiet for the cooldown, even if still true.
        else if (stored.status === "dismissed" && (!stored.dismissedAt || now - new Date(stored.dismissedAt).getTime() > cooldown)) plan.reopen.push(alert);
    }
    for (const stored of existing) {
        if (stored.status === "open" && !activeKeys.has(stored.key)) plan.resolve.push(stored.key);
    }

    return plan;
}

module.exports = {
    RULES,
    monthEnds,
    yearReturnAt,
    detectAlerts,
    planAlertChanges
};
