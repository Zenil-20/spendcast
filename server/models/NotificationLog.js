const mongoose = require("mongoose");

// One row per email sent, so a job that runs three times a day sends once.
const notificationLogSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    // e.g. "digest:2026-10-23", "sip:6addcdf0...:2026-11-16", "harvest:2026-27:2027-01"
    key: { type: String, required: true },
    sentAt: { type: Date, default: Date.now }
});

notificationLogSchema.index({ userId: 1, key: 1 }, { unique: true });
// Old rows aren't needed after 90 days.
notificationLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model("NotificationLog", notificationLogSchema);
