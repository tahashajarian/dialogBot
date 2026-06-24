const mongoose = require("mongoose");

const DiscussionBoostSchema = new mongoose.Schema({
  publicCode: { type: String, required: true, unique: true },
  discussionId: { type: mongoose.Schema.Types.ObjectId, ref: "Discussion", required: true, index: true },
  creatorUserId: { type: Number, required: true, index: true },
  status: {
    type: String,
    enum: ["pending", "active", "expired", "cancelled", "refunded"],
    default: "pending",
    index: true,
  },
  quotedCost: { type: Number, required: true, min: 0 },
  quoteExpiresAt: { type: Date, required: true },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  cooldownUntil: { type: Date, default: null },
  spendTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "StarTransaction", default: null },
  refundTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "StarTransaction", default: null },
  settingsSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

DiscussionBoostSchema.index(
  { discussionId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "active" }, name: "one_active_boost_per_discussion" },
);
DiscussionBoostSchema.index(
  { creatorUserId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "active" }, name: "one_active_boost_per_creator" },
);
DiscussionBoostSchema.index({ status: 1, endsAt: 1 });
DiscussionBoostSchema.index({ discussionId: 1, cooldownUntil: -1 });
DiscussionBoostSchema.index({ creatorUserId: 1, cooldownUntil: -1 });

module.exports = mongoose.model("DiscussionBoost", DiscussionBoostSchema);
