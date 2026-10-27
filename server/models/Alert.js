const mongoose = require("mongoose");

// A condition worth the customer's attention (see utils/alerts.js). One row
// per user per condition key: it is opened when the condition starts,
// updated while it lasts, resolved when it ends, and reopened if it returns.
// A dismissed alert stays quiet for 30 days even if the condition is true.
const alertSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true },
        // e.g. "underperformance:122639", "goal:6addcdf0...", "concentration:fund"
        key: { type: String, required: true },
        type: { type: String, enum: ["underperformance", "concentration", "goal", "reconcile"], required: true },
        severity: { type: String, enum: ["info", "warning"], required: true },
        status: { type: String, enum: ["open", "dismissed", "resolved"], default: "open" },
        title: { type: String, required: true },
        why: { type: String, required: true },
        period: { from: String, to: String },
        // { columns: [String], rows: [[String]] }
        evidence: { type: mongoose.Schema.Types.Mixed, default: null },
        investigate: { type: [String], default: [] },
        subject: { type: mongoose.Schema.Types.Mixed, default: null },
        link: { type: String, default: null },
        firstSeenAt: { type: Date, required: true },
        lastSeenAt: { type: Date, required: true },
        resolvedAt: { type: Date, default: null },
        dismissedAt: { type: Date, default: null },
        // Set once the email has gone out, so a failed send is retried.
        notifiedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

alertSchema.index({ userId: 1, key: 1 }, { unique: true });
alertSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("Alert", alertSchema);
