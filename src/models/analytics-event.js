const mongoose = require("mongoose");

const analyticsEventSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    index: true,
  },
  userId: {
    type: Number,
    default: null,
    index: true,
  },
  source: {
    type: String,
    default: "",
    index: true,
  },
  section: {
    type: String,
    default: "",
    index: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: undefined,
  },
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

analyticsEventSchema.index({ name: 1, createdAt: -1 });
analyticsEventSchema.index({ userId: 1, name: 1, createdAt: -1 });

module.exports = mongoose.model("AnalyticsEvent", analyticsEventSchema);
