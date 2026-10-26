const mongoose = require("mongoose");

// Lease-based lock so a scheduled job runs on only one server instance.
const jobLockSchema = new mongoose.Schema({
    _id: { type: String },
    lockedUntil: { type: Date, required: true },
    owner: { type: String, required: true },
    lastSuccessAt: { type: Date, default: null }
});

module.exports = mongoose.model("JobLock", jobLockSchema);
