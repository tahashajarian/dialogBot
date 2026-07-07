const mongoose = require("mongoose");

const DiscussionMessageSchema = new mongoose.Schema({
  senderUserId: { type: Number, required: true },
  senderDisplayName: { type: String, required: true },
  text: { type: String, default: "" },
  voiceFileId: { type: String, default: "" },
  voiceDuration: { type: Number, default: 0 },
  sentAt: { type: Date, default: Date.now },
}, { _id: false });

const DiscussionJoinRuleSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["open", "top_ten_completed", "taste_label", "top_ten_item"],
    default: "open",
    required: true,
  },
  section: { type: String, enum: ["", "movies", "music", "books", "random"], default: "" },
  tasteLabelKey: { type: String, default: "" },
  itemTitle: { type: String, default: "" },
  itemAliases: { type: [String], default: [] },
}, { _id: false });

const DiscussionReportSchema = new mongoose.Schema({
  reporterUserId: { type: Number, required: true },
  targetUserId: { type: Number, required: true },
  status: { type: String, enum: ["open", "reviewed"], default: "open" },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const DiscussionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, default: "", trim: true, maxlength: 300 },
  publicDiscussionCode: { type: String, default: "" },
  creatorUserId: { type: Number, required: true, index: true },
  isBotCreated: { type: Boolean, default: false, index: true },
  botSeedKey: { type: String, default: "" },
  status: { type: String, enum: ["open", "closed"], default: "open", index: true },
  joinRule: { type: DiscussionJoinRuleSchema, default: () => ({ type: "open" }) },
  memberUserIds: { type: [Number], default: [] },
  removedUserIds: { type: [Number], default: [] },
  maxMembers: { type: Number, default: 20 },
  recentMessages: { type: [DiscussionMessageSchema], default: [] },
  reports: { type: [DiscussionReportSchema], default: [] },
  replyCount: { type: Number, default: 0 },
  lastActivityAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null },
});

DiscussionSchema.index({ status: 1, updatedAt: -1 });
DiscussionSchema.index(
  { status: 1, lastActivityAt: -1, updatedAt: -1, createdAt: -1 },
  { name: "open_discussions_activity_sort" },
);
DiscussionSchema.index(
  { creatorUserId: 1, status: 1, lastActivityAt: -1, updatedAt: -1, createdAt: -1 },
  { name: "creator_open_discussions_activity_sort" },
);
DiscussionSchema.index({ memberUserIds: 1, status: 1 });
DiscussionSchema.index(
  { publicDiscussionCode: 1 },
  {
    name: "publicDiscussionCode_unique_nonempty",
    unique: true,
    partialFilterExpression: {
      publicDiscussionCode: { $type: "string", $gt: "" },
    },
  },
);
DiscussionSchema.index(
  { botSeedKey: 1 },
  {
    name: "botSeedKey_unique_nonempty",
    unique: true,
    partialFilterExpression: {
      botSeedKey: { $type: "string", $gt: "" },
    },
  },
);

module.exports = mongoose.model("Discussion", DiscussionSchema);
