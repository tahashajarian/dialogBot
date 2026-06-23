const mongoose = require("mongoose");

const StarTransactionSchema = new mongoose.Schema({
  userId: { type: Number, required: true, index: true },
  amount: { type: Number, required: true },
  balanceAfter: { type: Number, default: null, min: 0 },
  status: {
    type: String,
    enum: ["pending", "applied", "rejected"],
    default: "pending",
    index: true,
  },
  rejectionReason: { type: String, default: "" },
  bucket: {
    type: String,
    enum: ["earned", "purchased", "promotional"],
    default: "earned",
    index: true,
  },
  type: {
    type: String,
    enum: ["earn", "spend", "refund", "grant", "purchase", "reversal", "expiry"],
    required: true,
    index: true,
  },
  reason: { type: String, required: true, index: true },
  idempotencyKey: { type: String, required: true, unique: true },
  relatedUserId: { type: Number, default: null },
  discussionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  invitationId: { type: mongoose.Schema.Types.ObjectId, default: null },
  boostId: { type: mongoose.Schema.Types.ObjectId, default: null },
  entitlementId: { type: mongoose.Schema.Types.ObjectId, default: null },
  paymentId: { type: String, default: "" },
  reversesTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "StarTransaction",
    default: null,
  },
  settingsSnapshot: { type: mongoose.Schema.Types.Mixed, default: undefined },
  metadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
  constraints: { type: mongoose.Schema.Types.Mixed, default: undefined },
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

StarTransactionSchema.index({ userId: 1, createdAt: -1 });
StarTransactionSchema.index({ status: 1, createdAt: 1 });
StarTransactionSchema.index({ type: 1, reason: 1, createdAt: -1 });
StarTransactionSchema.index(
  { reversesTransactionId: 1 },
  {
    name: "star_transaction_single_refund",
    unique: true,
    partialFilterExpression: { reversesTransactionId: { $type: "objectId" } },
  },
);

module.exports = mongoose.model("StarTransaction", StarTransactionSchema);
