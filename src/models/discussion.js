const mongoose = require("mongoose");

const DiscussionMessageSchema = new mongoose.Schema({
  senderUserId: { type: Number, required: true },
  senderDisplayName: { type: String, required: true },
  text: { type: String, required: true },
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
}, { _id: false });

const DiscussionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, default: "", trim: true, maxlength: 300 },
  creatorUserId: { type: Number, required: true, index: true },
  status: { type: String, enum: ["open", "closed"], default: "open", index: true },
  joinRule: { type: DiscussionJoinRuleSchema, default: () => ({ type: "open" }) },
  memberUserIds: { type: [Number], default: [] },
  maxMembers: { type: Number, default: 20 },
  recentMessages: { type: [DiscussionMessageSchema], default: [] },
  replyCount: { type: Number, default: 0 },
  lastActivityAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null },
});

DiscussionSchema.index({ status: 1, updatedAt: -1 });
DiscussionSchema.index({ memberUserIds: 1, status: 1 });

module.exports = mongoose.model("Discussion", DiscussionSchema);
