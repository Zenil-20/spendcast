// One-time migration for records created before expenses stored `localDate`
// and `currency`, and before recurring rules stored `currency`.
//
// Usage:
//   node scripts/migrate-expense-fields.js --currency INR [--timezone UTC] [--dry-run]
//
// --timezone is the timezone used to read the calendar date of old expenses.
// Old date-only values were stored at UTC midnight, so UTC (the default) gives
// back the date the user picked.

require('dotenv').config();

const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const RecurringExpense = require('../models/RecurringExpense');
const { normalizeTimeZone, getLocalDateString } = require('../utils/time');
const { normalizeCurrency } = require('../utils/money');

const BATCH_SIZE = 500;

function readArg(name) {
    const index = process.argv.indexOf(`--${name}`);

    return index === -1 ? undefined : process.argv[index + 1];
}

async function migrateExpenses(timezone, currency, dryRun) {
    const cursor = Expense.find({
        $or: [{ localDate: { $exists: false } }, { currency: { $exists: false } }]
    }).select('date localDate currency').lean().cursor();
    let operations = [];
    let updated = 0;

    const flush = async () => {
        if (operations.length > 0 && !dryRun) {
            await Expense.bulkWrite(operations, { ordered: false });
        }

        updated += operations.length;
        operations = [];
    };

    for await (const expense of cursor) {
        const update = {};

        if (!expense.localDate) {
            update.localDate = getLocalDateString(new Date(expense.date), timezone);
        }

        if (!expense.currency) {
            update.currency = currency;
        }

        operations.push({ updateOne: { filter: { _id: expense._id }, update: { $set: update } } });

        if (operations.length >= BATCH_SIZE) {
            await flush();
        }
    }

    await flush();

    return updated;
}

async function main() {
    const timezone = normalizeTimeZone(readArg('timezone') || 'UTC');
    const currency = normalizeCurrency(readArg('currency'));
    const dryRun = process.argv.includes('--dry-run');

    if (!timezone || !currency) {
        throw new Error('Usage: node scripts/migrate-expense-fields.js --currency INR [--timezone UTC] [--dry-run]');
    }

    await mongoose.connect(process.env.MONGO_URI);

    const expenses = await migrateExpenses(timezone, currency, dryRun);
    const rules = dryRun
        ? await RecurringExpense.countDocuments({ currency: { $exists: false } })
        : (await RecurringExpense.updateMany(
            { currency: { $exists: false } },
            { $set: { currency } }
        )).modifiedCount;

    console.log(`${dryRun ? '[dry run] would update' : 'Updated'} ${expenses} expense(s) and ${rules} recurring expense(s).`);
}

main()
    .catch(error => {
        console.error('Migration failed:', error.message);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
