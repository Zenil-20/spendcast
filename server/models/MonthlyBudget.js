
const mongoose = require("mongoose");

const monthlyBudgetSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            unique: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0.01
        },
        currency: {
            type: String,
            required: true,
            uppercase: true,
            trim: true
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("MonthlyBudget", monthlyBudgetSchema);
