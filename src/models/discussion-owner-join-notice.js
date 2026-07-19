const mongoose = require("mongoose");

const DiscussionOwnerJoinNoticeSchema = new mongoose.Schema({
  discussionId: { type: mongoose.Schema.Types.ObjectId, ref: "Discussion", required: true },
  ownerUserId: { type: Number, required: true, index: true },
  lastSuccessfulSendAt: { type: Date, default: null },
  windowUserIds: { type: [Number], default: [] },
  pendingUserIds: { type: [Number], default: [] },
  pendingCount: { type: Number, default: 0, min: 0 },
  claimToken: { type: String, default: "" },
  claimKind: { type: String, enum: ["", "immediate", "summary"], default: "" },
  claimedUserIds: { type: [Number], default: [] },
  claimedCount: { type: Number, default: 0, min: 0 },
  claimedAt: { type: Date, default: null },
}, { timestamps: false });

DiscussionOwnerJoinNoticeSchema.index(
  { discussionId: 1 },
  { unique: true, name: "one_owner_join_notice_state_per_discussion" },
);
DiscussionOwnerJoinNoticeSchema.index(
  { lastSuccessfulSendAt: 1, pendingCount: 1, claimedAt: 1 },
  { name: "due_owner_join_notice_summaries" },
);
DiscussionOwnerJoinNoticeSchema.index(
  { claimToken: 1, claimedAt: 1 },
  {
    name: "owner_join_notice_active_claims",
    partialFilterExpression: { claimToken: { $type: "string", $gt: "" } },
  },
);

module.exports = mongoose.model("DiscussionOwnerJoinNotice", DiscussionOwnerJoinNoticeSchema);
