const mongoose = require("mongoose");
const { getRuntimeConfig } = require("./config");

async function connectDB(config = getRuntimeConfig()) {
  try {
    await mongoose.connect(config.mongoUri, {
      dbName: config.dbName,
    });

    console.log("MongoDB connected");
  } catch (err) {
    console.error("Mongo error:", err);
    process.exit(1);
  }
}

module.exports = connectDB;
