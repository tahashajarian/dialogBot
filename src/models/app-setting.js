const mongoose = require("mongoose");

const AppSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  values: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("AppSetting", AppSettingSchema);
