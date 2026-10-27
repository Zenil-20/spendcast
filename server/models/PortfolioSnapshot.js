const mongoose = require("mongoose");

// One row per user per day: the health score, the concentration figures and
// each goal's odds. Comparing days is what lets a score change be explained
// and an alert wait until a condition has lasted. Written by the daily job
// after the NAV sync, and on the user's first visit of the day.
const portfolioSnapshotSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    // Market date, "YYYY-MM-DD".
    date: { type: String, required: true },
    // healthScore.snapshotOf(): { score, coverage, factors: [{ key, score, weight, value }] }
    health: { type: mongoose.Schema.Types.Mixed, default: null },
    concentration: {
        largestFund: { type: mongoose.Schema.Types.Mixed, default: null },
        topCompany: { type: mongoose.Schema.Types.Mixed, default: null },
        topPair: { type: mongoose.Schema.Types.Mixed, default: null }
    },
    goals: {
        type: [new mongoose.Schema({ goalId: String, probability: Number, status: String }, { _id: false })],
        default: undefined
    },
    alertsCheckedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});

portfolioSnapshotSchema.index({ userId: 1, date: 1 }, { unique: true });
// About 13 months is enough for every comparison made.
portfolioSnapshotSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 24 * 3600 });

module.exports = mongoose.model("PortfolioSnapshot", portfolioSnapshotSchema);
