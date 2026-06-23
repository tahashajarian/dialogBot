const mongoose = require("mongoose");

const AiPaidSuggestionSchema = new mongoose.Schema({
  publicCode: { type: String, required: true, unique: true, index: true },
  userId: { type: Number, required: true, index: true },
  section: { type: String, required: true, enum: ["movies", "music", "books", "random"] },
  userText: { type: String, default: "" },
  status: {
    type: String,
    enum: ["pending", "spending", "completed", "cancelled", "refunded"],
    default: "pending",
    index: true,
  },
  quotedCost: { type: Number, required: true, min: 0 },
  quoteExpiresAt: { type: Date, required: true, index: true },
  spendTransactionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  refundTransactionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  settingsSnapshot: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  suggestionTitle: { type: String, default: "" },
}, { timestamps: true });

AiPaidSuggestionSchema.index({ userId: 1, section: 1, status: 1, quoteExpiresAt: -1 });

module.exports = mongoose.models.AiPaidSuggestion || mongoose.model("AiPaidSuggestion", AiPaidSuggestionSchema);
