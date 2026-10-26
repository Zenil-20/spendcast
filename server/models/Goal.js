const mongoose = require("mongoose");

// Something a customer is saving towards, e.g. "₹25 lakh for a house by 2032".
// The odds of reaching it are never stored: they're worked out from NAV
// history each time, so they move with the market and the customer's SIPs.
const goalSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true, index: true },
        name: { type: String, required: true, trim: true, maxlength: 60 },
        targetAmount: { type: Number, required: true, min: 1000 },
        // "YYYY-MM-DD".
        targetDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
        // Funds counted towards the goal; empty means all of the customer's funds.
        schemeCodes: { type: [Number], default: [] },
        // Put in each month; null means the current SIPs of those funds.
        monthlyContribution: { type: Number, min: 0, default: null },
        // Yearly increase in the monthly contribution, in percent.
        stepUpPercent: { type: Number, min: 0, max: 50, default: 0 }
    },
    { timestamps: true }
);

module.exports = mongoose.model("Goal", goalSchema);
