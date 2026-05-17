const User = require("../models/user");

async function getOrCreateUser(from) {
  if (!from) return null;

  let user = await User.findOne({ userId: from.id });

  if (!user) {
    user = await User.create({
      userId: from.id,
      username: from.username,
      firstName: from.first_name,
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

module.exports = { getOrCreateUser, updateLanguage };
