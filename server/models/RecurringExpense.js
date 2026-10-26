
const mongoose = require("mongoose");

const recurringExpenseSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            index: true
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0.01
        },
        category: {
            type: String,
            required: true,
            trim: true
        },
        // ISO 4217 currency of the amount, from the user's settings at creation.
        currency: {
            type: String,
            required: true,
            uppercase: true
        },
        frequency: {
            type: String,
            enum: ["monthly", "quarterly", "yearly"],
            required: true
        },
        // Date of the first scheduled payment. Rule dates are calendar dates
        // stored at UTC midnight, so their UTC fields are the date the user picked.
        startDate: {
            type: Date,
            required: true
        },
        // Optional final date on which a payment can be scheduled.
        endDate: {
            type: Date,
            default: null
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

recurringExpenseSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model(
    "RecurringExpense",
    recurringExpenseSchema
);
