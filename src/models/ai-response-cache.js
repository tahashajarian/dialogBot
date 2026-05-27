const mongoose = require("mongoose");

const AiResponseCacheSchema = new mongoose.Schema({
  originalInput: { type: String, required: true },
  normalizedInput: { type: String, required: true, index: true },
  aiResponse: { type: String, required: true },
  embedding: { type: [Number], default: [] },
  category: { type: String, default: "unknown", index: true },
  purpose: { type: String, default: "general_feedback", index: true },
  lang: { type: String, default: "fa", index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  hitCount: { type: Number, default: 0 },
  lastUsedAt: Date,
}, {
  timestamps: true,
});

AiResponseCacheSchema.index(
  { normalizedInput: 1, category: 1, purpose: 1, lang: 1 },
  { unique: true },
);
AiResponseCacheSchema.index({ category: 1, purpose: 1, lang: 1, updatedAt: -1 });

module.exports = mongoose.model("AiResponseCache", AiResponseCacheSchema);
