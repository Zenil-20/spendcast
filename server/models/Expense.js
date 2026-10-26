
const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0
        },
        category: {
            type: String,
            required: true,
            trim: true
        },
        // Instant of the expense. Date-only input is stored as the start of
        // that day in the user's timezone.
        date: {
            type: Date,
            required: [true, "Expense date is required"]
        },
        // Calendar date ("YYYY-MM-DD") in the user's timezone when the expense
        // was recorded. Months are grouped by this field, so a later timezone
        // change does not move past expenses between months.
        localDate: {
            type: String,
            required: true,
            match: /^\d{4}-\d{2}-\d{2}$/
        },
        // ISO 4217 currency of the amount, from the user's settings at creation.
        currency: {
            type: String,
            required: true,
            uppercase: true
        },
        paymentMethod: {
            type: String,
            required: true,
            enum: ["Cash", "UPI", "Card", "Bank Transfer", "Other"]
        },
        notes: {
            type: String,
            trim: true,
            default: ""
        },
        userId: {
            type: String,
            required: true,
            index: true
        },
        recurringExpenseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "RecurringExpense",
            default: null
        }
    },
    {
        timestamps: true
    }
);

expenseSchema.index({ userId: 1, currency: 1, localDate: 1 });

module.exports = mongoose.model("Expense", expenseSchema);
