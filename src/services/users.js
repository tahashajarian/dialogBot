const User = require("../models/user");

async function getUser(userId) {
  let user = await User.findOne({ userId });

  if (!user) {
    user = await User.create({ userId });
  }

  return user;
}

async function setUserLang(userId, lang) {
  await User.updateOne(
    { userId },
    { $set: { lang } }
  );
}

module.exports = {
  getUser,
  setUserLang
};
