const mongoose = require("mongoose");

const AiListItemSchema = new mongoose.Schema({
  title: { type: String, required: true },
  comment: { type: String, default: "" },
  watched: { type: Boolean, default: false },
}, { _id: false });

const AiSectionListsSchema = new mongoose.Schema({
  watchlist: { type: [AiListItemSchema], default: [] },
  topTen: { type: [AiListItemSchema], default: [] },
}, { _id: false });

const AiListsSchema = new mongoose.Schema({
  movies: { type: AiSectionListsSchema, default: () => ({}) },
  music: { type: AiSectionListsSchema, default: () => ({}) },
  books: { type: AiSectionListsSchema, default: () => ({}) },
  random: { type: AiSectionListsSchema, default: () => ({}) },
}, { _id: false });

const AiTasteSectionSchema = new mongoose.Schema({
  labelKey: { type: String, default: "" },
  emoji: { type: String, default: "" },
  confidence: { type: Number, default: 0 },
  sampleCount: { type: Number, default: 0 },
  updatedAt: Date,
}, { _id: false });

const AiTasteSchema = new mongoose.Schema({
  movies: { type: AiTasteSectionSchema, default: () => ({}) },
  music: { type: AiTasteSectionSchema, default: () => ({}) },
  books: { type: AiTasteSectionSchema, default: () => ({}) },
  random: { type: AiTasteSectionSchema, default: () => ({}) },
}, { _id: false });

const AiRecentSuggestionsSchema = new mongoose.Schema({
  movies: { type: [String], default: [] },
  music: { type: [String], default: [] },
  books: { type: [String], default: [] },
  random: { type: [String], default: [] },
}, { _id: false });

const AiSuggestionUsageSchema = new mongoose.Schema({
  movies: { type: [Date], default: [] },
  music: { type: [Date], default: [] },
  books: { type: [Date], default: [] },
  random: { type: [Date], default: [] },
}, { _id: false });

const UserSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  username: String,
  firstName: String,
  profileName: String,
  city: String,
  age: Number,
  gender: String,
  petPreference: String,
  bio: String,
  location: {
    latitude: Number,
    longitude: Number,
    accuracy: Number,
    city: String,
    sharedAt: Date,
  },
  photoFileId: String,
  profileDiscoverable: { type: Boolean, default: false },
  showActiveDiscussionOnProfile: { type: Boolean, default: false },
  publicProfileCode: { type: String, default: "", index: true, sparse: true },
  activeDiscussionId: { type: mongoose.Schema.Types.ObjectId, ref: "Discussion", default: null },
  discussionMembershipIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Discussion" }],
    default: [],
    validate: {
      validator(value) {
        return Array.isArray(value) && value.length <= 10;
      },
      message: "discussionMembershipIds exceeds membership cap",
    },
  },
  savedProfileCodes: {
    type: [String],
    default: [],
    validate: {
      validator(value) {
        return Array.isArray(value) && value.length <= 50;
      },
      message: "savedProfileCodes exceeds saved profile cap",
    },
  },
  savedProfilesLastListMessageId: { type: Number, default: null },
  profileEditPromptMessageId: { type: Number, default: null },
  discussionDraftTitle: { type: String, default: "" },
  discussionDraftDescription: { type: String, default: "" },
  discussionDraftJoinRule: { type: mongoose.Schema.Types.Mixed, default: null },
  discussionDraftMaxMembers: { type: Number, default: 20 },
  discussionLastRoomHeaderMessageId: { type: Number, default: null },
  discussionLastRoomRecentMessageId: { type: Number, default: null },
  discussionLastListMessageId: { type: Number, default: null },
  discussionLastListType: { type: String, default: "" },
  discussionMenuNoticeMessageId: { type: Number, default: null },
  discussionMessageUsage: { type: [Date], default: [] },
  aiLists: { type: AiListsSchema, default: () => ({}) },
  aiTaste: { type: AiTasteSchema, default: () => ({}) },
  aiRecentSuggestions: { type: AiRecentSuggestionsSchema, default: () => ({}) },
  aiSuggestionUsage: { type: AiSuggestionUsageSchema, default: () => ({}) },
  aiWatchlistMovies: { type: [String], default: [] },
  aiTopTenMovies: { type: [String], default: [] },
  aiWatchlistMusic: { type: [String], default: [] },
  aiTopTenMusic: { type: [String], default: [] },
  aiWatchlistBooks: { type: [String], default: [] },
  aiTopTenBooks: { type: [String], default: [] },
  aiWatchlistRandom: { type: [String], default: [] },
  aiTopTenRandom: { type: [String], default: [] },
  aiSectionPinnedMessageId: Number,
  aiSectionPinnedSection: String,
  aiLastListMessageId: Number,
  aiLastListSection: String,
  aiLastListType: String,
  aiSectionEntryMessageId: Number,
  aiPendingInputMessageId: Number,
  aiSectionPendingCommentItem: String,
  aiSectionPendingCommentListType: String,
  lang: { type: String, default: "fa" },
  state: { type: String, default: "idle" },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", UserSchema);
