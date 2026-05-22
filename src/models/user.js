const mongoose = require("mongoose");

const AiListItemSchema = new mongoose.Schema({
  title: { type: String, required: true },
  comment: { type: String, default: "" },
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
  aiLists: { type: AiListsSchema, default: () => ({}) },
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
  lang: { type: String, default: "fa" },
  state: { type: String, default: "idle" },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", UserSchema);
