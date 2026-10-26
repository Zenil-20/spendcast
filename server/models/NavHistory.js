const mongoose = require("mongoose");

// Full NAV history of one scheme, kept locally so portfolios are calculated
// without calling the API. Only schemes someone holds (plus the benchmark) are
// stored, and they are updated incrementally once a day.
const navHistorySchema = new mongoose.Schema(
    {
        schemeCode: { type: Number, required: true, unique: true },
        meta: {
            schemeName: String,
            fundHouse: String,
            schemeType: String,
            schemeCategory: String,
            isinGrowth: String,
            isinDivReinvestment: String
        },
        // Parallel arrays, oldest first: dates as "YYYY-MM-DD", NAVs as numbers.
        dates: { type: [String], default: [] },
        values: { type: [Number], default: [] },
        lastDate: { type: String, default: null },
        lastCheckedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

module.exports = mongoose.model("NavHistory", navHistorySchema);
