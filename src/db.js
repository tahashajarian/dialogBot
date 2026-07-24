const mongoose = require("mongoose");
const { getRuntimeConfig } = require("./config");
const { logger } = require("./services/logger");
const { attachDatabaseHealthMonitoring } = require("./services/database-health");

const MONGO_CONNECTION_OPTIONS = Object.freeze({
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 20000,
  waitQueueTimeoutMS: 2500,
  maxPoolSize: 20,
  minPoolSize: 2,
  heartbeatFrequencyMS: 10000,
});

async function connectDB(config = getRuntimeConfig()) {
  attachDatabaseHealthMonitoring();
  await mongoose.connect(config.mongoUri, {
    dbName: config.dbName,
    ...MONGO_CONNECTION_OPTIONS,
  });

  logger.info("MongoDB connected", { dbName: config.dbName });
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info("MongoDB disconnected");
  }
}

module.exports = connectDB;
module.exports.disconnectDB = disconnectDB;
module.exports.MONGO_CONNECTION_OPTIONS = MONGO_CONNECTION_OPTIONS;
