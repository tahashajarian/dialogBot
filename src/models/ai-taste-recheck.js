const mongoose = require("mongoose");

const AiTasteRecheckSchema = new mongoose.Schema({
  publicCode: { type: String, required: true, unique: true, index: true },
  userId: { type: Number, required: true, index: true },
  section: { type: String, required: true, enum: ["movies", "music", "books"] },
  status: {
    type: String,
    enum: ["pending", "spending", "completed", "refunded", "cancelled"],
    default: "pending",
    index: true,
  },
  quotedCost: { type: Number, required: true, min: 0 },
  quoteExpiresAt: { type: Date, required: true, index: true },
  inputFingerprint: { type: String, required: true },
  previousLabelKey: { type: String, required: true },
  previousClassificationStatus: { type: String, required: true, enum: ["confirmed", "skipped"] },
  suggestedLabelKeys: { type: [String], default: [] },
  suggestionInsight: { type: String, default: "", maxlength: 120 },
  spendTransactionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  refundTransactionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  settingsSnapshot: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: true });

module.exports = mongoose.models.AiTasteRecheck || mongoose.model("AiTasteRecheck", AiTasteRecheckSchema);
