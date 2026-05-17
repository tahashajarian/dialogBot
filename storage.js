const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "users.json");

function readData() {
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("Failed to read users.json:", err);
    return {};
  }
}

function writeData(data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to write users.json:", err);
  }
}

function getUser(userId) {
  if (!userId) return null;
  const data = readData();
  return data[userId] || null;
}

function saveUser(userId, userData) {
  if (!userId) return;
  const data = readData();
  data[userId] = {
    ...(data[userId] || {}),
    ...userData,
    updatedAt: new Date().toISOString(),
  };
  writeData(data);
}

module.exports = {
  getUser,
  saveUser,
};
