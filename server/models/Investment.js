const mongoose = require("mongoose");

// A customer's SIP or lump-sum investment in one scheme. Units are never
// stored: every installment is rebuilt from the NAV history, so a SIP started
// two years ago needs no manual entry of old purchases.
const investmentSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true, index: true },
        schemeCode: { type: Number, required: true },
        schemeName: { type: String, required: true },
        kind: { type: String, enum: ["sip", "lumpsum"], required: true },
        // SIP: amount per installment. Lump sum: amount invested.
        amount: { type: Number, required: true, min: 1 },
        // SIP day of the month (1-31; 29-31 fall on the last day of shorter months).
        sipDay: { type: Number, min: 1, max: 31, default: null },
        // First installment (SIP) or purchase date (lump sum), "YYYY-MM-DD".
        startDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
        // Last date an installment can fall on; null while the SIP continues.
        endDate: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ },
        // Yearly increase in the SIP amount, in percent.
        stepUpPercent: { type: Number, min: 0, max: 100, default: 0 },
        // Installments the customer says were missed (e.g. a bounced mandate).
        skippedDates: { type: [String], default: [] },
        isActive: { type: Boolean, default: true }
    },
    { timestamps: true }
);

investmentSchema.index({ userId: 1, schemeCode: 1 });

module.exports = mongoose.model("Investment", investmentSchema);
