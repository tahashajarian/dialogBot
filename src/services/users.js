const User = require("../models/user");

async function getOrCreateUser(from) {
  if (!from) return null;

  let user = await User.findOne({ userId: from.id });

  if (!user) {
    user = await User.create({
      userId: from.id,
      username: from.username,
      firstName: from.first_name,
      profileName: from.first_name,
      age: null,
      lang: "fa",
    });
  }

  return user;
}

async function updateLanguage(userId, newLang) {
  return await User.findOneAndUpdate(
    { userId },
    { lang: newLang },
    { returnDocument: "after" },
  );
}

async function updateProfileField(userId, field, value) {
  return await User.findOneAndUpdate(
    { userId },
    { [field]: value },
    { returnDocument: "after" },
  );
}

async function updateUserState(userId, state) {
  return await User.findOneAndUpdate(
    { userId },
    { state },
    { returnDocument: "after" },
  );
}

module.exports = { getOrCreateUser, updateLanguage, updateProfileField, updateUserState };
