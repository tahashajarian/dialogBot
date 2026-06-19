const mongoose = require("mongoose");
const { getRuntimeConfig } = require("./config");
const { logger } = require("./services/logger");

async function connectDB(config = getRuntimeConfig()) {
  await mongoose.connect(config.mongoUri, {
    dbName: config.dbName,
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
