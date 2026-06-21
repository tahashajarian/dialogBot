const mongoose = require("mongoose");

const operationalEventSchema = new mongoose.Schema({
  kind: {
    type: String,
    required: true,
    index: true,
  },
  ok: {
    type: Boolean,
    default: true,
    index: true,
  },
  operation: {
    type: String,
    default: "",
    index: true,
  },
  provider: {
    type: String,
    default: "",
  },
  reason: {
    type: String,
    default: "",
  },
  durationMs: {
    type: Number,
    default: 0,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: undefined,
  },
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

operationalEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
operationalEventSchema.index({ kind: 1, createdAt: -1 });

module.exports = mongoose.model("OperationalEvent", operationalEventSchema);
