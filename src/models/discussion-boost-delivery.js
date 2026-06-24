const mongoose = require("mongoose");

const DiscussionBoostDeliverySchema = new mongoose.Schema({
  boostId: { type: mongoose.Schema.Types.ObjectId, ref: "DiscussionBoost", required: true },
  discussionId: { type: mongoose.Schema.Types.ObjectId, ref: "Discussion", required: true, index: true },
  recipientUserId: { type: Number, required: true, index: true },
  reservedAt: { type: Date, default: Date.now, index: true },
  deliveredAt: { type: Date, default: null, index: true },
  openedAt: { type: Date, default: null },
  notInterestedAt: { type: Date, default: null },
}, { timestamps: false });

DiscussionBoostDeliverySchema.index(
  { boostId: 1, recipientUserId: 1 },
  { unique: true, name: "one_delivery_per_boost_recipient" },
);
DiscussionBoostDeliverySchema.index({ recipientUserId: 1, deliveredAt: -1 });
DiscussionBoostDeliverySchema.index({ discussionId: 1, recipientUserId: 1 });
DiscussionBoostDeliverySchema.index(
  { deliveredAt: 1, reservedAt: 1 },
  { partialFilterExpression: { deliveredAt: null }, name: "stale_reserved_boost_delivery" },
);

module.exports = mongoose.model("DiscussionBoostDelivery", DiscussionBoostDeliverySchema);
