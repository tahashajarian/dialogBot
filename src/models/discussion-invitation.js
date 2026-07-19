const mongoose = require("mongoose");

const DiscussionInvitationSchema = new mongoose.Schema({
  publicInvitationCode: { type: String, default: "" },
  discussionId: { type: mongoose.Schema.Types.ObjectId, ref: "Discussion", required: true },
  discussionPublicCode: { type: String, default: "" },
  inviterUserId: { type: Number, required: true, index: true },
  inviteeUserId: { type: Number, required: true, index: true },
  inviteePublicProfileCode: { type: String, default: "" },
  restoresOwnerRemoval: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ["pending", "accepted", "removed", "expired"],
    default: "pending",
    index: true,
  },
  source: { type: String, enum: ["room", "saved_profile", "bot_onboarding", "onboarding_match", "shared_link"], default: "room" },
  createdAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date, default: null },
  removedAt: { type: Date, default: null },
  expiredAt: { type: Date, default: null },
  seenAt: { type: Date, default: null },
  lastOpenedAt: { type: Date, default: null },
});

DiscussionInvitationSchema.index(
  { publicInvitationCode: 1 },
  {
    name: "publicInvitationCode_unique_nonempty",
    unique: true,
    partialFilterExpression: {
      publicInvitationCode: { $type: "string", $gt: "" },
    },
  },
);

DiscussionInvitationSchema.index({ inviteeUserId: 1, status: 1, createdAt: -1 });
DiscussionInvitationSchema.index(
  { inviteeUserId: 1, status: 1, seenAt: 1, createdAt: -1 },
  { name: "received_invitation_seen_state" },
);
DiscussionInvitationSchema.index(
  { inviterUserId: 1, createdAt: -1 },
  { name: "inviter_invitation_rate_limit" },
);
DiscussionInvitationSchema.index(
  { discussionId: 1 },
  { name: "closed_discussion_invitation_cleanup" },
);
DiscussionInvitationSchema.index(
  { inviteeUserId: 1, discussionId: 1, status: 1 },
  {
    name: "pending_invitation_per_discussion_recipient",
    unique: true,
    partialFilterExpression: { status: "pending" },
  },
);

module.exports = mongoose.model("DiscussionInvitation", DiscussionInvitationSchema);
