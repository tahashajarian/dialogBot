const test = require("node:test");
const assert = require("node:assert/strict");

const { version } = require("../package.json");
const { handleUpdate } = require("../src/bot");
const messages = require("../src/messages");
const {
  getActiveProfileCompletion,
  getHomeRuntimeInfoReply,
  normalizeHomeRuntimeKey,
} = require("../src/services/home-runtime-info");

const homeUser = {
  userId: 42,
  lang: "en",
  state: "idle",
  navigationMode: "global",
  starBalance: 12,
  profileName: "Sam",
  city: "Tehran",
  age: 30,
  gender: "other",
  bio: "Music and books",
  photoFileId: "photo",
  publicProfileCode: "u_TEST",
  savedProfileCodes: ["u_ONE", "u_TWO"],
  aiLists: {
    movies: { topTen: [{ title: "One" }, { title: "Two" }, { title: "Three" }] },
    music: { topTen: [{ title: "Song" }] },
    books: { topTen: [] },
    random: { topTen: [{ title: "Art" }] },
  },
};

const dependencies = {
  countInvitations: async () => 2,
  listDiscussions: async () => [
    { title: "Movie night", memberUserIds: [42, 7, 8] },
    { title: "Book club", memberUserIds: [42] },
  ],
  logDiagnostics: () => {},
};

test("Home runtime keys are exact and case-insensitive", () => {
  for (const key of ["status", "diagnostics"]) {
    assert.equal(normalizeHomeRuntimeKey(key), key);
    assert.equal(normalizeHomeRuntimeKey(key.toUpperCase()), key);
  }
  assert.equal(normalizeHomeRuntimeKey("وضعیت"), "status");
  assert.equal(normalizeHomeRuntimeKey("What version are you?"), "");
  assert.equal(normalizeHomeRuntimeKey("نسخه"), "");
  assert.equal(normalizeHomeRuntimeKey("debug"), "");
  assert.equal(normalizeHomeRuntimeKey("keys"), "");
  assert.equal(normalizeHomeRuntimeKey("version"), "");
});

test("the Guide permanently explains the user-facing status key", () => {
  assert.match(messages.en.helpText, /In the Home menu, type “status”/);
  assert.match(messages.fa.helpText, /در منوی خانه، «وضعیت» رو بفرست/);
  assert.doesNotMatch(messages.en.helpText, /diagnostics/i);
  assert.doesNotMatch(messages.fa.helpText, /diagnostics/i);
});

test("status summarizes verified personal counts", async () => {
  const reply = await getHomeRuntimeInfoReply({
    text: "status",
    lang: "en",
    user: homeUser,
    dependencies,
  });

  assert.match(reply, /🎬 3\/10/);
  assert.match(reply, /👤 Profile: 100% complete \(7\/7\)/);
  assert.match(reply, /🎵 1\/10/);
  assert.match(reply, /⭐ Stars: 12/);
  assert.match(reply, /🔖 Saved profiles: 2/);
  assert.match(reply, /📨 Pending invitations: 2/);
  assert.match(reply, /💬 Your discussions:/);
  assert.match(reply, /• Movie night · 👥 3/);
  assert.match(reply, /• Book club · 👥 1/);
});

test("the Persian status alias returns the localized personal summary", async () => {
  const reply = await getHomeRuntimeInfoReply({
    text: "وضعیت",
    lang: "fa",
    user: { ...homeUser, lang: "fa" },
    dependencies,
  });

  assert.match(reply, /وضعیت تو/);
  assert.match(reply, /محبوب‌ها/);
  assert.match(reply, /ستاره‌ها/);
  assert.match(reply, /تکمیل پروفایل: 100٪/);
});

test("profile completion counts only fields currently active in the product", () => {
  const base = getActiveProfileCompletion(homeUser, {
    profilePetPreferenceEnabled: false,
    profileLocationEnabled: false,
  });
  assert.deepEqual(base, { completed: 7, total: 7, percentage: 100 });

  const withOptionalFields = getActiveProfileCompletion(homeUser, {
    profilePetPreferenceEnabled: true,
    profileLocationEnabled: true,
  });
  assert.deepEqual(withOptionalFields, { completed: 7, total: 9, percentage: 78 });
});

test("diagnostics is sanitized and contains stable support facts", async () => {
  const reply = await getHomeRuntimeInfoReply({
    text: "diagnostics",
    lang: "en",
    user: homeUser,
    now: new Date("2026-07-29T12:00:00.000Z"),
    dependencies,
  });

  assert.match(reply, new RegExp(`Version: ${version.replaceAll(".", "\\.")}`));
  assert.match(reply, /UTC: 2026-07-29T12:00:00\.000Z/);
  assert.match(reply, /User ID: 42/);
  assert.match(reply, /Profile code: u_TEST/);
  assert.match(reply, /State: idle/);
  assert.match(reply, /Navigation: global/);
  assert.match(reply, /Reference: [A-F0-9]{10}/);
  assert.doesNotMatch(reply, /BOT_TOKEN|API_KEY|MONGO_URI|mongodb:\/\//i);
});

test("diagnostics always uses the English support format", async () => {
  const reply = await getHomeRuntimeInfoReply({
    text: "diagnostics",
    lang: "fa",
    user: { ...homeUser, lang: "fa" },
    now: new Date("2026-07-29T12:00:00.000Z"),
    dependencies,
  });

  assert.match(reply, /^🛠 Diagnostics/);
  assert.match(reply, /Profile completion: 100%/);
  assert.match(reply, /Open created discussions: 2/);
  assert.doesNotMatch(reply, /گزارش فنی|تکمیل پروفایل|ندارد/);
});

test("runtime keys cannot intercept non-Home flows or active discussions", async () => {
  assert.equal(await getHomeRuntimeInfoReply({
    text: "version",
    lang: "en",
    user: { state: "editing_name", navigationMode: "global" },
  }), "");
  assert.equal(await getHomeRuntimeInfoReply({
    text: "status",
    lang: "fa",
    user: { state: "idle", navigationMode: "profile" },
  }), "");
  assert.equal(await getHomeRuntimeInfoReply({
    text: "diagnostics",
    lang: "en",
    user: { state: "idle", navigationMode: "global", activeDiscussionId: "room" },
  }), "");
});

test("other Home text keeps the normal use-buttons guidance", async () => {
  const replies = [];
  await handleUpdate({
    text: "hello",
    userId: 42,
    user: homeUser,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  });

  assert.deepEqual(replies, [{ text: messages.en.sectionTextUseBottomButtons, extra: undefined }]);
});
