const mongoose = require("mongoose");

const StarReferralLinkSchema = new mongoose.Schema({
  publicCode: { type: String, required: true, unique: true },
  inviterUserId: { type: Number, required: true, index: true },
  discussionId: { type: mongoose.Schema.Types.ObjectId, ref: "Discussion", default: null },
  discussionPublicCode: { type: String, default: "" },
  profilePublicCode: { type: String, default: "" },
  source: { type: String, enum: ["discussion_share", "profile_share", "general"], default: "general" },
  expiresAt: { type: Date, default: null, index: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

StarReferralLinkSchema.index({ inviterUserId: 1, createdAt: -1 });

module.exports = mongoose.model("StarReferralLink", StarReferralLinkSchema);
