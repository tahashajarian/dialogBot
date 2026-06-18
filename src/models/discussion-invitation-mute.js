const mongoose = require("mongoose");

const DiscussionInvitationMuteSchema = new mongoose.Schema({
  muterUserId: { type: Number, required: true, index: true },
  mutedUserId: { type: Number, required: true, index: true },
  sourceInvitationId: { type: mongoose.Schema.Types.ObjectId, ref: "DiscussionInvitation", default: null },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

DiscussionInvitationMuteSchema.index(
  { muterUserId: 1, mutedUserId: 1 },
  { unique: true, name: "discussion_invitation_mute_pair" },
);

module.exports = mongoose.model("DiscussionInvitationMute", DiscussionInvitationMuteSchema);
