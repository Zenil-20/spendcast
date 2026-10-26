const mongoose = require("mongoose");

const settingsFields = {
    // IANA timezone chosen by the user, e.g. "Asia/Kolkata", "America/New_York".
    timezone: {
        type: String,
        required: true
    },
    // ISO 4217 currency code, e.g. "INR", "USD", "JPY".
    currency: {
        type: String,
        required: true,
        uppercase: true
    }
};

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },
        passwordHash: {
            type: String,
            required: true,
            select: false
        },
        // Settings currently in effect.
        settings: new mongoose.Schema(settingsFields, { _id: false }),
        // Saved views from the investments chart builder.
        chartPresets: {
            type: [new mongoose.Schema(
                {
                    id: { type: String, required: true },
                    name: { type: String, required: true, trim: true, maxlength: 40 },
                    schemeCodes: { type: [Number], default: [] },
                    metric: { type: String, enum: ["value", "invested", "gain", "returnPercent"], required: true },
                    mode: { type: String, enum: ["separate", "combined"], required: true }
                },
                { _id: false }
            )],
            default: []
        },
        // Which emails the user wants. Every email links to turning it off.
        notifications: {
            type: new mongoose.Schema(
                {
                    dailyDigest: { type: Boolean, default: true },
                    sipReminders: { type: Boolean, default: true },
                    taxReminders: { type: Boolean, default: true }
                },
                { _id: false }
            ),
            default: () => ({})
        },

        // A requested change that takes effect at `effectiveAt` (the next local
        // midnight after the request). Null when no change is waiting.
        pendingSettings: {
            type: new mongoose.Schema(
                {
                    ...settingsFields,
                    requestedAt: { type: Date, required: true },
                    effectiveAt: { type: Date, required: true }
                },
                { _id: false }
            ),
            default: null
        }
    },
    {
        timestamps: true,
        // Two concurrent settings updates cannot silently overwrite each other.
        optimisticConcurrency: true
    }
);

module.exports = mongoose.model("User", userSchema);
