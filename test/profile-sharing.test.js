const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const {
  buildShareableProfileCaption,
  hasCompletedMediaFavorites,
  hasPublicMediaFavorites,
} = require("../src/services/profile-sharing");
const {
  buildPublicFavoritesSectionText,
  getPublicFavoriteSections,
} = require("../src/services/profile-favorites-ui");
const { profileQuickActionsKeyboard, profilePublicActionsKeyboard } = require("../src/keyboards");
const User = require("../src/models/user");
const StarReferralLink = require("../src/models/star-referral-link");
const { createShareableProfileCard, returnFromShareableProfile } = require("../src/flows/profile-sharing");
const { handleProfileFavoritesCallback } = require("../src/flows/profile-favorites");

function favorites(count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    title: `${prefix} ${index + 1}`,
    comment: "A personal note that should stay compact on a Telegram photo card",
  }));
}

test("shareable profile caption uses first-person copy and the profile emoji", () => {
  const user = {
    profileName: "Taha",
    profileEmoji: "🎶",
    aiLists: {
      random: { topTen: [{ title: "Cinema" }] },
      movies: { topTen: favorites(10, "Movie") },
      music: { topTen: favorites(1, "Song") },
      books: { topTen: [] },
    },
  };
  const caption = buildShareableProfileCaption({ user, lang: "fa", link: "https://t.me/muze_bot?start=ref_CODE" });

  assert.match(caption, /^✨ پروفایل میوزِ من 🎶/);
  assert.match(caption, /پروفایل و محبوب‌های من 🎶 رو در میوز ببین:/);
  assert.doesNotMatch(caption, /طاها|Taha/);
  assert.match(caption, /https:\/\/t\.me\/muze_bot\?start=ref_CODE/);
  assert.ok(caption.length <= 1024);
});

test("share button requires one complete media Favorites list", () => {
  const incomplete = { aiLists: { movies: { topTen: favorites(9, "Movie") } } };
  const complete = { aiLists: { music: { topTen: favorites(10, "Song") } } };

  assert.equal(hasPublicMediaFavorites(incomplete), true);
  assert.equal(hasCompletedMediaFavorites(incomplete), false);
  assert.equal(hasCompletedMediaFavorites(complete), true);
  assert.equal(
    profileQuickActionsKeyboard("en").reply_markup.inline_keyboard.flat()
      .some((button) => button.callback_data === callBacks.profileShare),
    false,
  );
  assert.equal(
    profileQuickActionsKeyboard("en", { canShareProfile: true }).reply_markup.inline_keyboard.flat()
      .some((button) => button.callback_data === callBacks.profileShare),
    true,
  );
});

test("public Favorites expose only media favorites and fit photo captions", () => {
  const user = {
    profileName: "Taha",
    aiLists: {
      movies: { topTen: favorites(10, "A very long favorite movie title") },
      music: { topTen: [] },
      books: { topTen: [] },
      random: { topTen: favorites(10, "Interest") },
    },
  };
  assert.deepEqual(getPublicFavoriteSections(user).map(({ section }) => section), ["movies"]);
  assert.ok(buildPublicFavoritesSectionText(user, "en", "movies").length <= 1024);

  const rows = profilePublicActionsKeyboard("en", "u_ABC", {
    source: "shared",
    hasFavorites: true,
  }).reply_markup.inline_keyboard;
  assert.equal(rows[0][0].callback_data, `${callBacks.profileFavoritesOpen}shared:0:u_ABC`);
});

test("share guidance restores a photo profile in place without deleting the banner", async () => {
  const mediaEdits = [];
  const deletions = [];
  const ctx = {
    userId: 1,
    callbackMessageId: 202,
    user: {
      userId: 1,
      profileName: "Taha",
      photoFileId: "profile-photo-id",
      aiLists: { movies: { topTen: favorites(10, "Movie") } },
    },
    editMessageMedia: async (...args) => {
      mediaEdits.push(args);
      return true;
    },
    deleteMessage: async (messageId) => deletions.push(messageId),
  };

  await returnFromShareableProfile(ctx, "en");

  assert.equal(mediaEdits[0][0], 202);
  assert.equal(mediaEdits[0][1].media, "profile-photo-id");
  assert.deepEqual(deletions, []);
  assert.equal(ctx.user.navigationMode, "profile");
});

test("share creation falls back to text and never deletes the own-profile card", async () => {
  const originalUserFindOne = User.findOne;
  const originalReferralCreate = StarReferralLink.create;
  const originalPublicUrl = process.env.BOT_PUBLIC_URL;
  const user = {
    userId: 1,
    publicProfileCode: "u_OWNER",
    profileEmoji: "🎶",
    aiLists: { movies: { topTen: favorites(10, "Movie") } },
  };
  const replies = [];
  const deletions = [];
  User.findOne = async () => user;
  StarReferralLink.create = async (value) => ({ ...value, publicCode: "A1B2C3D4E5F6" });
  process.env.BOT_PUBLIC_URL = "https://example.com/muze";
  const ctx = {
    userId: 1,
    user,
    callbackMessageId: 50,
    replyWithPhoto: async () => { throw new Error("media unavailable"); },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length + 50 };
    },
    deleteMessage: async (messageId) => deletions.push(messageId),
  };

  try {
    await createShareableProfileCard(ctx, "en");
  } finally {
    User.findOne = originalUserFindOne;
    StarReferralLink.create = originalReferralCreate;
    if (originalPublicUrl === undefined) delete process.env.BOT_PUBLIC_URL;
    else process.env.BOT_PUBLIC_URL = originalPublicUrl;
  }

  assert.equal(replies.length, 2);
  assert.match(replies[0].text, /https:\/\/example\.com\/muze\?start=ref_A1B2C3D4E5F6/);
  assert.equal(replies[1].text, messages.en.profileShareGuidance);
  assert.deepEqual(deletions, []);
  assert.equal(user.navigationMode, "profile");
});

test("closing public Favorites restores the reply-keyboard mode beneath it", async () => {
  const deleted = [];
  const ctx = {
    callbackData: callBacks.profileFavoritesClose,
    callbackMessageId: 88,
    userId: 1,
    user: {
      userId: 1,
      navigationMode: "profile_favorites:shared:0:u_SHARED:movies",
      publicProfileReturnNavigationMode: "help",
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => deleted.push(messageId),
  };

  await handleProfileFavoritesCallback(ctx, "en");

  assert.deepEqual(deleted, [88]);
  assert.equal(ctx.user.navigationMode, "help");
  assert.equal(ctx.user.publicProfileReturnNavigationMode, "");
});
