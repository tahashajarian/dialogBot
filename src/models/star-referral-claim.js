const mongoose = require("mongoose");

const StarReferralClaimSchema = new mongoose.Schema({
  referralLinkId: { type: mongoose.Schema.Types.ObjectId, ref: "StarReferralLink", required: true },
  inviterUserId: { type: Number, required: true, index: true },
  inviteeUserId: { type: Number, required: true, unique: true },
  status: { type: String, enum: ["pending", "qualified"], default: "pending", index: true },
  qualifiedAt: { type: Date, default: null },
  rewardTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "StarTransaction", default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

StarReferralClaimSchema.index({ inviterUserId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("StarReferralClaim", StarReferralClaimSchema);
