const mongoose = require("mongoose");

const AppSettingAuditSchema = new mongoose.Schema({
  key: { type: String, required: true, index: true },
  actor: { type: String, default: "system" },
  previousValues: { type: mongoose.Schema.Types.Mixed, default: {} },
  nextValues: { type: mongoose.Schema.Types.Mixed, default: {} },
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

AppSettingAuditSchema.index({ key: 1, createdAt: -1 });

module.exports = mongoose.model("AppSettingAudit", AppSettingAuditSchema);
