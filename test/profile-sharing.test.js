const test = require("node:test");
const assert = require("node:assert/strict");

const originalBotDeepLinkBaseUrl = process.env.BOT_DEEP_LINK_BASE_URL;
const originalBotPublicUrl = process.env.BOT_PUBLIC_URL;
const originalPublicBotUrl = process.env.PUBLIC_BOT_URL;
const originalBotUsername = process.env.BOT_USERNAME;

delete process.env.BOT_DEEP_LINK_BASE_URL;
delete process.env.PUBLIC_BOT_URL;
delete process.env.BOT_USERNAME;
process.env.BOT_PUBLIC_URL = "https://example.com/muze";

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const {
  buildProfileShareGuidance,
  buildShareableProfileCaption,
  hasShareableMediaFavorites,
  hasPublicMediaFavorites,
} = require("../src/services/profile-sharing");
const {
  buildPublicFavoritesHubText,
  buildPublicFavoritesSectionText,
  formatPublicFavoritesTelegramText,
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

test("profile share guidance shows the configured referral reward", () => {
  const settings = {
    economyEnabled: true,
    earningEnabled: true,
    firstTopTenMilestoneItems: 3,
    rewardExternalReferral: 12,
  };

  assert.match(buildProfileShareGuidance("en", settings), /earn 12 Stars for every new user/);
  assert.match(buildProfileShareGuidance("fa", settings), /با اومدن هر کاربر جدید.+۱۲ ستاره می‌گیری/);
  assert.doesNotMatch(buildProfileShareGuidance("fa", settings), /علاقه‌مندی/);
  assert.equal(
    buildProfileShareGuidance("en", { ...settings, earningEnabled: false }),
    messages.en.profileShareGuidanceNoReward,
  );
  assert.equal(
    buildProfileShareGuidance("en", { ...settings, earningEnabled: false }, { showsFavorites: false }),
    messages.en.profileShareGuidanceNoRewardWithoutFavorites,
  );
});

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

  assert.match(caption, /^✨ پروفایل من در میوز 🎶/);
  assert.match(caption, /پروفایل و محبوب‌های من 🎶 رو در میوز ببین:/);
  assert.doesNotMatch(caption, /طاها|Taha/);
  assert.match(caption, /https:\/\/t\.me\/muze_bot\?start=ref_CODE/);
  assert.ok(caption.length <= 1024);
});

test("share button requires at least three items in one media Favorites list", () => {
  const insufficient = {
    aiLists: {
      movies: { topTen: favorites(2, "Movie") },
      music: { topTen: favorites(2, "Song") },
      books: { topTen: favorites(2, "Book"), watchlist: favorites(10, "Later") },
    },
  };
  const eligible = { aiLists: { music: { topTen: favorites(3, "Song") } } };

  assert.equal(hasPublicMediaFavorites(insufficient), true);
  assert.equal(hasShareableMediaFavorites(insufficient), false);
  assert.equal(hasShareableMediaFavorites(eligible), true);
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

test("public Favorites sections omit the artificial title-width divider", () => {
  const user = {
    profileName: "Ali",
    aiLists: { movies: { topTen: [{ title: "Up" }] } },
  };

  const hub = buildPublicFavoritesHubText(user, "en");
  const section = buildPublicFavoritesSectionText(user, "en", "movies");
  assert.match(hub, /Ali's favorites\n\n🎬 Movies & Series — 1/);
  assert.doesNotMatch(hub, /━━━━━━━━━━━━━━━━━━━━━━━━━━━━/);
  assert.match(section, /favorite Movies & Series\n\n💡 To copy an item name, just tap its title\.\n\n1\..+Up/);
  assert.doesNotMatch(section, /━━━━━━━━━━━━━━━━━━━━━━━━━━━━/);
});

test("public Favorites make only item titles tap-to-copy", () => {
  const user = {
    profileName: "Taha <Friend>",
    aiLists: {
      movies: {
        topTen: [{
          title: "Persona & Stalker",
          comment: "A <personal> comment & note",
        }],
      },
    },
  };

  const text = formatPublicFavoritesTelegramText(
    buildPublicFavoritesSectionText(user, "en", "movies"),
  );

  assert.match(text, /<code>Persona &amp; Stalker<\/code> — A &lt;personal&gt; comment &amp; note/);
  assert.doesNotMatch(text, /<code>.*personal.*<\/code>/);
  assert.match(text, /Taha &lt;Friend&gt;/);
});

test("public Favorites leave a blank line between items", () => {
  const user = {
    profileName: "Taha",
    aiLists: {
      movies: {
        topTen: [
          { title: "Persona", comment: "First note" },
          { title: "Stalker", comment: "Second note" },
        ],
      },
    },
  };

  const text = formatPublicFavoritesTelegramText(
    buildPublicFavoritesSectionText(user, "en", "movies"),
  );

  assert.match(text, /First note\n\n2\. <code>Stalker<\/code>/);
});

test("public Favorites use the same metadata-enriched titles as the owner's list", () => {
  const user = {
    profileName: "Taha",
    aiLists: {
      movies: {
        topTen: [{
          title: "Nostalghia",
          metadata: "۱۹۸۳ · کارگردان: Andrei Tarkovsky",
          comment: "A note",
        }],
      },
    },
  };

  const text = formatPublicFavoritesTelegramText(
    buildPublicFavoritesSectionText(user, "fa", "movies"),
  );

  assert.match(text, /<code>Nostalghia Andrei Tarkovsky<\/code> — ۱۹۸۳ — A note/);
});

test("hidden Favorites stay stored but disappear from public profile surfaces", () => {
  const user = {
    profileName: "Taha",
    showFavoritesOnProfile: false,
    aiLists: {
      random: { topTen: [{ title: "Cinema" }] },
      movies: { topTen: favorites(10, "Movie") },
    },
    aiTaste: { movies: { labelKey: "movie_buff", emoji: "🎬" } },
  };

  assert.equal(hasShareableMediaFavorites(user), true);
  assert.equal(hasPublicMediaFavorites(user), false);
  assert.deepEqual(getPublicFavoriteSections(user), []);
  const caption = buildShareableProfileCaption({ user, lang: "en", link: "https://example.com/profile" });
  assert.doesNotMatch(caption, /Taste labels|Favorites|Movie 1|Movie Buff/);
  assert.match(caption, /Cinema/);
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

  const user = {
    userId: 1,
    publicProfileCode: "u_OWNER",
    profileEmoji: "🎶",
    aiLists: { movies: { topTen: favorites(10, "Movie") } },
  };

  const replies = [];
  const deletions = [];

  User.findOne = async () => user;
  StarReferralLink.create = async (value) => ({
    ...value,
    publicCode: "A1B2C3D4E5F6",
  });

  const ctx = {
    userId: 1,
    user,
    callbackMessageId: 50,
    replyWithPhoto: async () => {
      throw new Error("media unavailable");
    },
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
  }

  assert.equal(replies.length, 2);
  assert.match(
    replies[0].text,
    /https:\/\/example\.com\/muze\?start=ref_A1B2C3D4E5F6/,
  );
  assert.equal(replies[1].text.includes("{reward}"), false);
  assert.match(replies[1].text, /You earn \d+ Stars/);
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

test.after(() => {
  if (originalBotDeepLinkBaseUrl === undefined) {
    delete process.env.BOT_DEEP_LINK_BASE_URL;
  } else {
    process.env.BOT_DEEP_LINK_BASE_URL = originalBotDeepLinkBaseUrl;
  }

  if (originalBotPublicUrl === undefined) {
    delete process.env.BOT_PUBLIC_URL;
  } else {
    process.env.BOT_PUBLIC_URL = originalBotPublicUrl;
  }

  if (originalPublicBotUrl === undefined) {
    delete process.env.PUBLIC_BOT_URL;
  } else {
    process.env.PUBLIC_BOT_URL = originalPublicBotUrl;
  }

  if (originalBotUsername === undefined) {
    delete process.env.BOT_USERNAME;
  } else {
    process.env.BOT_USERNAME = originalBotUsername;
  }
});
