const mongoose = require("mongoose");

const UserTasteIndexSchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  section: {
    type: String,
    enum: ["movies", "music", "books", "random"],
    required: true,
  },
  items: { type: [String], default: [] },
  matchKeys: { type: [String], default: [] },
  itemCount: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
}, { versionKey: false });

UserTasteIndexSchema.index(
  { userId: 1, section: 1 },
  { unique: true, name: "one_taste_index_per_user_section" },
);
UserTasteIndexSchema.index(
  { section: 1, items: 1, itemCount: 1, userId: 1 },
  { name: "taste_index_section_item_lookup" },
);
UserTasteIndexSchema.index(
  { section: 1, matchKeys: 1, itemCount: 1, userId: 1 },
  { name: "taste_index_section_fuzzy_lookup" },
);
UserTasteIndexSchema.index({ updatedAt: 1 });

module.exports = mongoose.model("UserTasteIndex", UserTasteIndexSchema);
