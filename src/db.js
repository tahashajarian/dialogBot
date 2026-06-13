const mongoose = require("mongoose");
const { getRuntimeConfig } = require("./config");

async function connectDB(config = getRuntimeConfig()) {
  await mongoose.connect(config.mongoUri, {
    dbName: config.dbName,
  });

  console.log("MongoDB connected");
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log("MongoDB disconnected");
  }
}

module.exports = connectDB;
module.exports.disconnectDB = disconnectDB;
