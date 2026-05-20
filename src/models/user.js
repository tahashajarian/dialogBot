const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  username: String,
  firstName: String,
  profileName: String,
  city: String,
  age: Number,
  petPreference: String,
  location: {
    latitude: Number,
    longitude: Number,
    accuracy: Number,
    city: String,
    sharedAt: Date,
  },
  photoFileId: String,
  lang: { type: String, default: "fa" },
  state: { type: String, default: "idle" },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", UserSchema);
