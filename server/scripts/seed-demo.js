// Creates a demo account with 3 years of realistic expense history, so the
// forecast can be tried end to end. Only the demo account's own records are
// created or deleted; no other user's data is touched.
//
// Usage:
//   node scripts/seed-demo.js            create the demo account (once)
//   node scripts/seed-demo.js --reset    delete the demo account's data and recreate it
//   node scripts/seed-demo.js --investments   add demo mutual fund holdings to the existing
//                                             demo account (leaves everything else as it is)
//
// Optional: --timezone Asia/Kolkata --currency INR

require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');
const Expense = require('../models/Expense');
const RecurringExpense = require('../models/RecurringExpense');
const MonthlyBudget = require('../models/MonthlyBudget');
const Investment = require('../models/Investment');
const { hashPassword } = require('../utils/password');
const { normalizeTimeZone, getDaysInMonth, toDateString, getLocalDateString, startOfLocalDay } = require('../utils/time');
const { normalizeCurrency, createMoneyRounder } = require('../utils/money');
const { getMonthIndex, fromMonthIndex, getRecurringDueDate } = require('../utils/forecast');

const DEMO_EMAIL = 'demo@forecast.local';
const DEMO_PASSWORD = 'Demo@12345';
const HISTORY_MONTHS = 36;
const HOUR_MS = 60 * 60 * 1000;

function readArg(name) {
    const index = process.argv.indexOf(`--${name}`);

    return index === -1 ? undefined : process.argv[index + 1];
}

// Seeded random numbers, so every run produces the same data.
function createRandom(seed) {
    let state = seed;

    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function toStoredDate(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day));
}

function buildRules(firstMonthIndex, currentMonthIndex) {
    const first = fromMonthIndex(firstMonthIndex);
    const hike = fromMonthIndex(firstMonthIndex + 24);
    const gymStart = fromMonthIndex(firstMonthIndex + 6);
    const gymEnd = fromMonthIndex(firstMonthIndex + 20);
    const lastOldRent = fromMonthIndex(firstMonthIndex + 23);
    const insuranceYear = first.month <= 3 ? first.year : first.year + 1;

    return [
        // Rent was raised after two years: the old rule ended, a new one started.
        {
            key: 'oldRent', title: 'Rent', category: 'Housing', amount: 18000, frequency: 'monthly',
            startDate: toStoredDate(first.year, first.month, 1),
            endDate: toStoredDate(lastOldRent.year, lastOldRent.month, getDaysInMonth(lastOldRent.year, lastOldRent.month)),
            isActive: false
        },
        {
            key: 'rent', title: 'Rent', category: 'Housing', amount: 20000, frequency: 'monthly',
            startDate: toStoredDate(hike.year, hike.month, 1)
        },
        {
            key: 'netflix', title: 'Netflix', category: 'Entertainment', amount: 649, frequency: 'monthly',
            startDate: toStoredDate(first.year, first.month, 15)
        },
        {
            key: 'internet', title: 'Internet', category: 'Utilities', amount: 999, frequency: 'monthly',
            startDate: toStoredDate(first.year, first.month, 7)
        },
        {
            key: 'insurance', title: 'Car insurance', category: 'Insurance', amount: 14500, frequency: 'yearly',
            startDate: toStoredDate(insuranceYear, 3, 20)
        },
        // A cancelled membership: explains past payments, not scheduled any more.
        {
            key: 'gym', title: 'Gym membership', category: 'Health', amount: 1500, frequency: 'monthly',
            startDate: toStoredDate(gymStart.year, gymStart.month, 3),
            endDate: toStoredDate(gymEnd.year, gymEnd.month, 28),
            isActive: false
        }
    ].filter(rule => getMonthIndex(rule.startDate.getUTCFullYear(), rule.startDate.getUTCMonth() + 1) <= currentMonthIndex);
}

function buildExpenses({ rules, ruleIds, firstMonthIndex, currentMonthIndex, today, timezone, roundMoney, random }) {
    const expenses = [];
    const pick = values => values[Math.floor(random() * values.length)];
    const between = (min, max) => min + random() * (max - min);

    const add = (title, category, amount, localDate, paymentMethod, recurringExpenseId = null) => {
        if (localDate > today) {
            return;
        }

        // A time between 09:00 and 21:00 local time on that day.
        const date = new Date(startOfLocalDay(localDate, timezone).getTime() + between(9, 21) * HOUR_MS);

        expenses.push({
            title,
            category,
            amount: roundMoney(amount),
            date,
            localDate: getLocalDateString(date, timezone),
            paymentMethod,
            recurringExpenseId
        });
    };

    for (let monthIndex = firstMonthIndex; monthIndex <= currentMonthIndex; monthIndex++) {
        const { year, month } = fromMonthIndex(monthIndex);
        const days = getDaysInMonth(year, month);
        const day = () => toDateString(year, month, 1 + Math.floor(random() * days));
        // About 0.4% price growth per month.
        const inflation = 1 + 0.004 * (monthIndex - firstMonthIndex);

        // Recurring payments. Most are linked to their rule; some are logged by
        // hand without a link, which the forecast matches by category and amount.
        for (const rule of rules) {
            const dueDate = getRecurringDueDate(rule, year, month);

            if (dueDate) {
                const linked = random() < 0.8 ? ruleIds[rule.key] : null;
                add(rule.title, rule.category, rule.amount, dueDate, rule.category === 'Housing' ? 'Bank Transfer' : 'Card', linked);
            }
        }

        for (let week = 0; week < 4; week++) {
            const groceryDay = Math.min(days, 2 + week * 7 + Math.floor(random() * 3));
            add('Groceries', 'Food', between(1800, 2600) * inflation, toDateString(year, month, groceryDay), pick(['UPI', 'Card']));
        }

        const diningCount = 3 + Math.floor(random() * 4);

        for (let i = 0; i < diningCount; i++) {
            add(pick(['Dinner out', 'Lunch', 'Cafe', 'Food delivery']), 'Dining', between(400, 1500) * inflation, day(), pick(['UPI', 'Card']));
        }

        const rideCount = 6 + Math.floor(random() * 5);

        for (let i = 0; i < rideCount; i++) {
            add(pick(['Cab', 'Metro card recharge', 'Fuel']), 'Transport', between(150, 600) * inflation, day(), 'UPI');
        }

        // Electricity is higher in summer.
        const summer = month >= 4 && month <= 6;
        add('Electricity bill', 'Utilities', (summer ? between(2600, 3400) : between(1200, 1800)) * inflation, toDateString(year, month, Math.min(days, 10)), 'UPI');

        const shoppingCount = 1 + Math.floor(random() * 3);

        for (let i = 0; i < shoppingCount; i++) {
            add(pick(['Clothes', 'Home supplies', 'Online order']), 'Shopping', between(800, 4000) * inflation, day(), pick(['Card', 'UPI']));
        }

        // Seasonal spending: festival shopping in Oct/Nov, travel every December.
        if (month === 10 || month === 11) {
            add('Festival shopping', 'Festivals', between(6000, 9000) * inflation, day(), 'Card');
        }

        if (month === 12) {
            add('Holiday trip', 'Travel', between(15000, 22000) * inflation, toDateString(year, month, 20), 'Card');
        }
    }

    // One-off purchase 8 months ago. It must not raise every future month.
    const laptop = fromMonthIndex(currentMonthIndex - 8);
    add('Laptop', 'Electronics', 85000, toDateString(laptop.year, laptop.month, 12), 'Card');

    return expenses;
}

async function deleteDemoAccount(user) {
    const userId = String(user._id);

    await Promise.all([
        Expense.deleteMany({ userId }),
        RecurringExpense.deleteMany({ userId }),
        MonthlyBudget.deleteMany({ userId }),
        Investment.deleteMany({ userId })
    ]);
    await User.deleteOne({ _id: user._id });
}

async function main() {
    const timezone = normalizeTimeZone(readArg('timezone') || 'Asia/Kolkata');
    const currency = normalizeCurrency(readArg('currency') || 'INR');
    const reset = process.argv.includes('--reset');

    if (!timezone || !currency) {
        throw new Error('Invalid --timezone or --currency.');
    }

    await mongoose.connect(process.env.MONGO_URI);

    const existing = await User.findOne({ email: DEMO_EMAIL });

    if (process.argv.includes('--investments')) {
        if (!existing) throw new Error('Create the demo account first: node scripts/seed-demo.js');
        await seedInvestments(String(existing._id));
        return;
    }

    if (existing && !reset) {
        console.log(`Demo account already exists (${DEMO_EMAIL}). Run with --reset to recreate its data.`);
        return;
    }

    if (existing) {
        await deleteDemoAccount(existing);
        console.log('Deleted the previous demo account and its data.');
    }

    const now = new Date();
    const today = getLocalDateString(now, timezone);
    const currentMonthIndex = getMonthIndex(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
    const firstMonthIndex = currentMonthIndex - HISTORY_MONTHS;
    const roundMoney = createMoneyRounder(currency);
    const random = createRandom(20261023);

    const user = await User.create({
        name: 'Demo User',
        email: DEMO_EMAIL,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        settings: { timezone, currency }
    });
    const userId = String(user._id);

    try {
        const rules = buildRules(firstMonthIndex, currentMonthIndex);
        const savedRules = await RecurringExpense.insertMany(rules.map(({ key, ...rule }) => ({
            ...rule,
            amount: roundMoney(rule.amount),
            currency,
            userId
        })));
        const ruleIds = Object.fromEntries(rules.map((rule, i) => [rule.key, savedRules[i]._id]));

        const expenses = buildExpenses({ rules, ruleIds, firstMonthIndex, currentMonthIndex, today, timezone, roundMoney, random });

        await Expense.insertMany(expenses.map(expense => ({ ...expense, currency, userId })));
        await MonthlyBudget.create({ userId, amount: roundMoney(45000), currency });
        await seedInvestments(userId);

        console.log(`Created demo account with ${savedRules.length} recurring expenses and ${expenses.length} expenses (${timezone}, ${currency}).`);
        console.log(`  Email:    ${DEMO_EMAIL}`);
        console.log(`  Password: ${DEMO_PASSWORD}`);
        console.log(`  Dashboard: http://localhost:${process.env.PORT || 6969}/`);
    } catch (error) {
        // Do not leave a half-created demo account behind.
        await deleteDemoAccount(user);
        throw error;
    }
}

// Real schemes; units are rebuilt from published NAVs when the portfolio is viewed.
const DEMO_INVESTMENTS = [
    { schemeCode: 122639, schemeName: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth', kind: 'sip', amount: 5000, sipDay: 15, startDate: '2024-10-15' },
    { schemeCode: 120716, schemeName: 'UTI Nifty 50 Index Fund - Direct Plan - Growth', kind: 'sip', amount: 3000, sipDay: 5, startDate: '2025-01-05', stepUpPercent: 10 },
    { schemeCode: 125497, schemeName: 'SBI SMALL CAP FUND - Direct Plan - Growth', kind: 'lumpsum', amount: 50000, startDate: '2025-03-01' }
];

async function seedInvestments(userId) {
    if (await Investment.exists({ userId })) {
        console.log('The demo account already has investments; nothing added.');
        return;
    }

    await Investment.insertMany(DEMO_INVESTMENTS.map(item => ({ ...item, userId })));
    console.log(`Added ${DEMO_INVESTMENTS.length} demo mutual fund holdings.`);
}

main()
    .catch(error => {
        console.error('Seeding failed:', error.message);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
