const mongoose = require("mongoose");

const AccountDeletionSchema = new mongoose.Schema({
  identityFingerprint: { type: String, required: true, unique: true, index: true },
  tombstoneUserId: { type: Number, required: true, unique: true },
  status: { type: String, enum: ["pending", "running", "complete", "failed"], default: "pending", index: true },
  step: { type: String, default: "prepared" },
  lastErrorCode: { type: String, default: "" },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  restartedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.models.AccountDeletion || mongoose.model("AccountDeletion", AccountDeletionSchema);
