const mongoose = require("mongoose");

const ModerationActionSchema = new mongoose.Schema({
  action: { type: String, enum: ["unban"], required: true, index: true },
  targetUserId: { type: Number, required: true, index: true },
  actor: { type: String, required: true, default: "analytics-dashboard" },
  reason: { type: String, required: true, maxlength: 500 },
  status: { type: String, enum: ["pending", "applied", "failed", "not_banned", "missing_user"], required: true, default: "pending" },
  previousBan: {
    bannedAt: { type: Date, default: null },
    reason: { type: String, default: "" },
    source: { type: String, default: "" },
  },
  completedAt: { type: Date, default: null },
  failureCode: { type: String, default: "" },
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

ModerationActionSchema.index({ createdAt: -1 });
ModerationActionSchema.index({ targetUserId: 1, createdAt: -1 });

module.exports = mongoose.model("ModerationAction", ModerationActionSchema);
