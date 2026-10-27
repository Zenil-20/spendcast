const mongoose = require("mongoose");

// A fund's disclosed holdings and expense ratio as of one date, used to look
// through funds to the companies they own. NAV data (mfapi.in) has none of
// this, so it's loaded with scripts/import-fund-portfolios.js from the
// monthly portfolio disclosures AMCs publish. Every plan of a scheme (Direct,
// Regular, Growth, IDCW) holds the same portfolio, so one disclosure is stored
// under each plan's scheme code; the expense ratio can differ per plan.
const holdingSchema = new mongoose.Schema(
    {
        isin: { type: String, default: null },
        name: { type: String, required: true },
        sector: { type: String, default: null },
        assetType: { type: String, enum: ["equity", "debt", "cash", "other"], required: true },
        // Fraction of the fund, e.g. 0.083 for 8.3%.
        weight: { type: Number, required: true, min: 0, max: 1 }
    },
    { _id: false }
);

const fundPortfolioSchema = new mongoose.Schema(
    {
        schemeCode: { type: Number, required: true },
        // Date of the disclosure, "YYYY-MM-DD".
        asOf: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
        holdings: { type: [holdingSchema], default: [] },
        // Total expense ratio as a fraction (0.0065 = 0.65% a year), or null.
        expenseRatio: { type: Number, default: null, min: 0, max: 0.03 },
        source: { type: String, required: true }
    },
    { timestamps: true }
);

// One disclosure per scheme per date; the latest is used.
fundPortfolioSchema.index({ schemeCode: 1, asOf: -1 }, { unique: true });

module.exports = mongoose.model("FundPortfolio", fundPortfolioSchema);
