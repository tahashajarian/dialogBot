const mongoose = require("mongoose");
const { logger } = require("./logger");

let monitoringAttached = false;
let lastChangedAt = new Date();
let lastError = "";

function stateLabel(readyState) {
  return ["disconnected", "connected", "connecting", "disconnecting"][readyState] || "unknown";
}

function markChanged(error = null) {
  lastChangedAt = new Date();
  lastError = error ? String(error.message || error).slice(0, 180) : "";
}

function attachDatabaseHealthMonitoring(connection = mongoose.connection) {
  if (monitoringAttached) return;
  monitoringAttached = true;
  connection.on("connected", () => {
    markChanged();
    logger.info("MongoDB connection ready");
  });
  connection.on("reconnected", () => {
    markChanged();
    logger.info("MongoDB connection restored");
  });
  connection.on("disconnected", () => {
    markChanged();
    logger.warn("MongoDB connection lost");
  });
  connection.on("error", (error) => {
    markChanged(error);
    logger.error("MongoDB connection error", error);
  });
}

function getDatabaseHealth(connection = mongoose.connection) {
  const readyState = Number(connection?.readyState) || 0;
  return {
    connected: readyState === 1,
    ready: readyState === 1,
    readyState,
    state: stateLabel(readyState),
    name: connection?.name || "",
    host: connection?.host || "",
    lastChangedAt: lastChangedAt.toISOString(),
    lastError,
  };
}

module.exports = {
  attachDatabaseHealthMonitoring,
  getDatabaseHealth,
  stateLabel,
};
