const mongoose = require("mongoose");

// The catalogue of every scheme listed on mfapi.in (about 76,000), refreshed
// weekly so customers can search by name, scheme code or ISIN.
const mutualFundSchemeSchema = new mongoose.Schema(
    {
        schemeCode: { type: Number, required: true, unique: true },
        schemeName: { type: String, required: true },
        isinGrowth: { type: String, default: null },
        isinDivReinvestment: { type: String, default: null }
    },
    { timestamps: true }
);

mutualFundSchemeSchema.index({ isinGrowth: 1 });
mutualFundSchemeSchema.index({ isinDivReinvestment: 1 });

module.exports = mongoose.model("MutualFundScheme", mutualFundSchemeSchema);
