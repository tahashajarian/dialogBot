const mongoose = require("mongoose");

const PendingInlineListItemSchema = new mongoose.Schema({
  section: {
    type: String,
    required: true,
    enum: ["movies", "series", "music", "books"],
  },
  title: { type: String, required: true, maxlength: 80 },
  key: { type: String, required: true, maxlength: 64 },
  createdAt: { type: Date, required: true },
}, { _id: false });

const PendingInlineListSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  items: {
    type: [PendingInlineListItemSchema],
    default: [],
    validate: {
      validator: (items) => items.length <= 10,
      message: "Pending inline list item limit exceeded",
    },
  },
  revision: { type: Number, default: 0, min: 0 },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

PendingInlineListSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.PendingInlineList
  || mongoose.model("PendingInlineList", PendingInlineListSchema);
