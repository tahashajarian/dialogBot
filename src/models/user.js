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
  suggestedLabelKeys: { type: [String], default: [] },
  suggestionInsight: { type: String, default: "", maxlength: 120 },
  emoji: { type: String, default: "" },
  confidence: { type: Number, default: 0 },
  sampleCount: { type: Number, default: 0 },
  source: { type: String, default: "" },
  classifierVersion: { type: Number, default: 0 },
  inputFingerprint: { type: String, default: "" },
  classificationStatus: { type: String, default: "" },
  freeClassificationUsedAt: { type: Date, default: null },
  confirmedAt: { type: Date, default: null },
  updatedAt: Date,
}, { _id: false });

const AiTasteSchema = new mongoose.Schema({
  movies: { type: AiTasteSectionSchema, default: () => ({}) },
  music: { type: AiTasteSectionSchema, default: () => ({}) },
  books: { type: AiTasteSectionSchema, default: () => ({}) },
}, { _id: false });

const AiRecentSuggestionsSchema = new mongoose.Schema({
  movies: { type: [String], default: [] },
  music: { type: [String], default: [] },
  books: { type: [String], default: [] },
  random: { type: [String], default: [] },
}, { _id: false });

const AiRejectedSuggestionsSchema = new mongoose.Schema({
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

const SectionTipsShownAtSchema = new mongoose.Schema({
  discussions: { type: Date, default: null },
  favorites: { type: Date, default: null },
  people: { type: Date, default: null },
}, { _id: false });

const UserSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  username: String,
  firstName: String,
  profileName: String,
  profileNameConfirmedAt: { type: Date, default: null },
  profileEmoji: { type: String, default: "" },
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
    cityLookupAttemptedAt: Date,
    sharedAt: Date,
  },
  photoFileId: String,
  showProfileInPeopleDiscovery: { type: Boolean, default: true },
  showActiveDiscussionOnProfile: { type: Boolean, default: true },
  activeDiscussionHelpAcknowledgedAt: { type: Date, default: null },
  starBalance: { type: Number, default: 0, min: 0 },
  starPendingTransactionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  starLastAppliedTransactionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  receiveBoostRecommendations: { type: Boolean, default: true },
  advancedSearchNotifyRequestedAt: { type: Date, default: null },
  tasteMatchUnlockUntil: { type: Date, default: null },
  publicProfileCode: { type: String, default: "" },
  activeDiscussionId: { type: mongoose.Schema.Types.ObjectId, ref: "Discussion", default: null },
  ownedOpenDiscussionIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Discussion" }],
    default: [],
    validate: {
      validator(value) {
        return Array.isArray(value) && value.length <= 10;
      },
      message: "ownedOpenDiscussionIds exceeds discussion membership cap",
    },
  },
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
  recentJoinedDiscussionIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Discussion" }],
    default: [],
    validate: {
      validator(value) {
        return Array.isArray(value) && value.length <= 3;
      },
      message: "recentJoinedDiscussionIds exceeds recent discussion cap",
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
  peopleLastListMessageId: { type: Number, default: null },
  peopleLastListPage: { type: Number, default: 0 },
  peopleLastListMode: { type: String, default: "" },
  savedProfilesLastListMessageId: { type: Number, default: null },
  publicProfileLastMessageId: { type: Number, default: null },
  profileInvitationRestrictionsLastMessageId: { type: Number, default: null },
  profileLastMessageId: { type: Number, default: null },
  navigationLastCardMessageId: { type: Number, default: null },
  navigationMode: { type: String, default: "" },
  profileEditPromptMessageId: { type: Number, default: null },
  pendingProfileViewCode: { type: String, default: "" },
  discussionDraftTitle: { type: String, default: "" },
  discussionDraftDescription: { type: String, default: "" },
  discussionDraftJoinRule: { type: mongoose.Schema.Types.Mixed, default: null },
  discussionDraftMaxMembers: { type: Number, default: 20 },
  discussionDraftLanguage: { type: String, enum: ["", "fa", "en"], default: "" },
  discussionDraftPaidOwnedSlotTransactionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  discussionDraftPaidOwnedSlotAuthorized: { type: Boolean, default: false },
  discussionDraftPaidOwnedSlotCap: { type: Number, default: 0, min: 0, max: 10 },
  discussionDraftPaidOwnedSlotCost: { type: Number, default: 0, min: 0 },
  discussionLanguageFilter: { type: String, enum: ["", "fa", "en", "all"], default: "" },
  discussionLastRoomHeaderMessageId: { type: Number, default: null },
  discussionLastRoomRecentMessageId: { type: Number, default: null },
  discussionLastListMessageId: { type: Number, default: null },
  discussionLastListType: { type: String, default: "" },
  discussionLastMembersMessageId: { type: Number, default: null },
  discussionMenuNoticeMessageId: { type: Number, default: null },
  discussionMessageUsage: { type: [Date], default: [] },
  reportReporterUserIds: { type: [Number], default: [] },
  bannedAt: { type: Date, default: null },
  banReason: { type: String, default: "" },
  banSource: { type: String, default: "" },
  aiLists: { type: AiListsSchema, default: () => ({}) },
  aiTaste: { type: AiTasteSchema, default: () => ({}) },
  aiRecentSuggestions: { type: AiRecentSuggestionsSchema, default: () => ({}) },
  aiRejectedSuggestions: { type: AiRejectedSuggestionsSchema, default: () => ({}) },
  aiSuggestionUsage: { type: AiSuggestionUsageSchema, default: () => ({}) },
  aiWatchlistMovies: { type: [String], default: [] },
  aiTopTenMovies: { type: [String], default: [] },
  aiWatchlistMusic: { type: [String], default: [] },
  aiTopTenMusic: { type: [String], default: [] },
  aiWatchlistBooks: { type: [String], default: [] },
  aiTopTenBooks: { type: [String], default: [] },
  aiWatchlistRandom: { type: [String], default: [] },
  aiTopTenRandom: { type: [String], default: [] },
  aiLastListMessageId: Number,
  aiLastListSection: String,
  aiLastListType: String,
  aiSectionEntryMessageId: Number,
  aiActionMessageId: Number,
  aiActionContext: String,
  aiPendingInputMessageId: Number,
  aiSectionPendingCommentItem: String,
  aiSectionPendingCommentListType: String,
  onboardingVersion: { type: Number, default: 0 },
  onboardingCompletedAt: { type: Date, default: null },
  onboardingSkippedAt: { type: Date, default: null },
  onboardingPromptMessageId: { type: Number, default: null },
  onboardingStarterInvitationsAt: { type: Date, default: null },
  onboardingTasteSetupNudgedAt: { type: Date, default: null },
  sectionTipsShownAt: { type: SectionTipsShownAtSchema, default: () => ({}) },
  lastStartInviteCode: { type: String, default: "" },
  lastStartInviteAt: { type: Date, default: null },
  handledStartInviteCodes: { type: [String], default: [] },
  pendingDiscussionShareInviterUserId: { type: Number, default: null },
  pendingDiscussionShareCode: { type: String, default: "" },
  pendingDiscussionShareAt: { type: Date, default: null },
  lang: { type: String, default: "fa" },
  state: { type: String, default: "idle" },
  createdAt: { type: Date, default: Date.now },
});

UserSchema.index(
  { publicProfileCode: 1 },
  {
    name: "publicProfileCode_unique_nonempty",
    unique: true,
    partialFilterExpression: {
      publicProfileCode: { $type: "string", $gt: "" },
    },
  },
);
UserSchema.index(
  { activeDiscussionId: 1 },
  { name: "active_discussion_membership_cleanup" },
);
UserSchema.index(
  { discussionMembershipIds: 1 },
  { name: "discussion_membership_cleanup" },
);
UserSchema.index(
  { bannedAt: 1, activeDiscussionId: 1, receiveBoostRecommendations: 1, userId: 1 },
  { name: "boost_recipient_candidates" },
);
UserSchema.index(
  { bannedAt: 1, profileName: 1, firstName: 1, userId: 1 },
  { name: "people_browse_candidates" },
);

module.exports = mongoose.model("User", UserSchema);
