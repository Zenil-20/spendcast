// Daily emails: why the portfolio moved, SIP debits due tomorrow, and the
// tax-free gains reminder. Runs after the NAV sync; each email is sent at most
// once (see NotificationLog), however many times the job runs.

const User = require("../models/User");
const Investment = require("../models/Investment");
const NotificationLog = require("../models/NotificationLog");
const Alert = require("../models/Alert");
const sendEmail = require("./mail");
const navStore = require("./navStore");
const { buildPortfolio } = require("./portfolio");
const analytics = require("./analytics");
const { addDays } = require("../utils/time");

// No emails before this hour (IST): the first NAV sync runs just after midnight.
const SEND_FROM_HOUR = 6;

const inr = value => `₹${Math.round(Math.abs(value)).toLocaleString("en-IN")}`;
const dayLabel = date => new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

function marketHour(now) {
    return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: navStore.MARKET_TIMEZONE }).format(now));
}

// Sends once per key. The key is claimed first (the unique index stops a
// second instance or run), and released again if the email didn't go out, so
// a later run retries it. Returns "sent", "duplicate" or "skipped" (email
// isn't configured).
async function sendOnce(user, key, subject, body) {
    const userId = String(user._id);

    try {
        await NotificationLog.create({ userId, key });
    } catch (error) {
        if (error.code === 11000) return "duplicate"; // already sent
        throw error;
    }

    let result;
    try {
        result = await sendEmail(user.email, subject, body);
    } catch (error) {
        await NotificationLog.deleteOne({ userId, key });
        throw error;
    }

    // Not configured (e.g. development): nothing was sent, so don't record it.
    if (result.skipped) {
        await NotificationLog.deleteOne({ userId, key });
        return "skipped";
    }
    return "sent";
}

async function notifyUser(user, now) {
    const prefs = user.notifications || {};
    const data = await buildPortfolio(String(user._id), now);
    const today = navStore.marketToday(now);

    // 1. Why the portfolio moved on the latest trading day.
    if (prefs.dailyDigest !== false && data.todayMove) {
        const move = data.todayMove;
        const day = dayLabel(move.date);
        const lines = move.movers.slice(0, 5).map(m => `  ${m.shortName}: ${m.change < 0 ? "−" : "+"}${inr(m.change)} (${(m.percent * 100).toFixed(2)}%)`);
        await sendOnce(user, `digest:${move.date}`,
            `Your portfolio ${move.change < 0 ? "fell" : "rose"} ${inr(move.change)} on ${day}`,
            `${move.change < 0 ? "Down" : "Up"} ${inr(move.change)} on ${day}.\n\n${lines.join("\n")}`);
    }

    // 2. SIP debits due tomorrow.
    if (prefs.sipReminders !== false) {
        const tomorrow = addDays(today, 1);
        for (const sip of data.sips.active.filter(s => s.next?.dueDate === tomorrow)) {
            await sendOnce(user, `sip:${sip.investmentId}:${tomorrow}`,
                `${inr(sip.amount)} SIP for ${sip.shortName} is due tomorrow`,
                `Keep ${inr(sip.amount)} in your mandate account to avoid a bounced installment.` +
                (sip.next.onWeekend ? "\n\nTomorrow is a weekend, so units are bought at the next trading day's NAV." : ""));
        }
    }

    // 3. Tax-free gains reminder, once a month from January to March.
    if (prefs.taxReminders !== false && data.harvest.gainBooked > 0 && today.slice(5, 7) <= "03") {
        await sendOnce(user, `harvest:${data.harvest.financialYear}:${today.slice(0, 7)}`,
            `Book ${inr(data.harvest.gainBooked)} of gains tax-free before 31 March`,
            `This year's ₹1.25 lakh exemption doesn't carry forward. It would avoid about ${inr(data.harvest.taxAvoided)} of tax later.`);
    }

    // 4. Alerts: today's snapshot, then any alert that opened and hasn't been
    // emailed. They're recorded (and shown in the app) even with emails off.
    const fresh = await analytics.refreshAlerts(String(user._id), now);
    if (prefs.alerts !== false) {
        for (const alert of fresh) {
            const outcome = await sendOnce(user, `alert:${alert._id}:${alert.firstSeenAt.toISOString().slice(0, 10)}`, alert.title, alertEmail(alert));
            if (outcome !== "skipped") {
                await Alert.updateOne({ _id: alert._id, notifiedAt: null }, { $set: { notifiedAt: new Date() } });
            }
        }
    }
}

// Why it fired, the data, and what to look into, as plain text.
function alertEmail(alert) {
    const table = alert.evidence?.rows?.length
        ? alert.evidence.rows.map(row => `  ${row.join("  ·  ")}`).join("\n")
        : "";
    return [
        alert.why,
        alert.period?.from ? `\nPeriod: ${alert.period.from} to ${alert.period.to}` : "",
        table ? `\n${alert.evidence.columns.join("  ·  ")}\n${table}` : "",
        alert.investigate.length ? `\nWhat to look into:\n${alert.investigate.map(item => `  - ${item}`).join("\n")}` : "",
        "\nFor tracking only — not investment advice."
    ].join("\n");
}

// Runs for every user who holds funds; one user's failure doesn't stop the rest.
async function sendDailyNotifications(now = new Date()) {
    if (marketHour(now) < SEND_FROM_HOUR) {
        return { skipped: true, reason: "quiet hours" };
    }

    const userIds = await Investment.distinct("userId");
    const users = await User.find({ _id: { $in: userIds } }, { email: 1, name: 1, notifications: 1 }).lean();
    let failed = 0;

    for (const user of users) {
        await notifyUser(user, now).catch(error => {
            failed += 1;
            console.error(`[mail] Notifications failed for ${user._id}:`, error.message);
        });
    }
    console.log(`[mail] Notifications: ${users.length} users, ${failed} failed`);
    return { users: users.length, failed };
}

module.exports = { sendDailyNotifications };
