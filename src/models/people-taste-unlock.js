const mongoose = require("mongoose");

const PeopleTasteUnlockSchema = new mongoose.Schema({
  publicCode: { type: String, required: true, unique: true, index: true },
  userId: { type: Number, required: true, index: true },
  status: {
    type: String,
    enum: ["pending", "activating", "active", "cancelled", "refunded"],
    default: "pending",
    index: true,
  },
  quotedCost: { type: Number, required: true, min: 0 },
  quotedDurationHours: { type: Number, required: true, min: 1 },
  quoteExpiresAt: { type: Date, required: true, index: true },
  entitlementUntil: { type: Date, default: null },
  spendTransactionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  refundTransactionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  settingsSnapshot: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: true });

PeopleTasteUnlockSchema.index({ userId: 1, status: 1, quoteExpiresAt: -1 });

module.exports = mongoose.models.PeopleTasteUnlock || mongoose.model("PeopleTasteUnlock", PeopleTasteUnlockSchema);
