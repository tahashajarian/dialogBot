const test = require("node:test");
const assert = require("node:assert/strict");

const {
  toSavedProfileListItems,
  isCodeSaved,
  buildSavedProfileListItems,
  paginateSavedProfiles,
  buildSavedProfilesListText,
  buildProfileSavedFooter,
  buildProfileDiscussionSectionsText,
} = require("../src/services/saved-profiles-ui");
const messages = require("../src/messages");
const {
  clearPeopleListMessage,
  clearSavedProfilesListMessage,
  clearSavedProfileDiscussionMessage,
  clearViewedPublicProfileMessage,
  formatSavedProfileRemovedMessage,
  formatSavedProfileSavedMessage,
  handleSavedProfilesCallback,
} = require("../src/flows/saved-profiles");
const { callBacks } = require("../src/constants");

test("toSavedProfileListItems builds stable rows with deduped codes", () => {
  const byCode = new Map([
    ["u_A1", { profileName: "Ali", firstName: "A" }],
    ["u_B2", { firstName: "Sara" }],
  ]);
  const rows = toSavedProfileListItems(["u_A1", "u_B2", "u_A1", ""], byCode);
  assert.deepEqual(rows, [
    { code: "u_A1", name: "Ali", genderEmoji: "", age: undefined, userId: undefined, hasDiscussions: false },
    { code: "u_B2", name: "Sara", genderEmoji: "", age: undefined, userId: undefined, hasDiscussions: false },
  ]);
});

test("saved profiles use gender emoji and localized optional age", () => {
  const items = toSavedProfileListItems(["u_A1", "u_B2"], new Map([
    ["u_A1", { profileName: "لاله", gender: "female", age: 28 }],
    ["u_B2", { profileName: "سام" }],
  ]));
  const text = buildSavedProfilesListText(messages, "fa", items);

  assert.match(text, /👩[^\n]*لاله[^\n]*🎂 ۲۸/);
  assert.match(text, /👤[^\n]*سام/);
});

test("isCodeSaved checks case-insensitive membership", () => {
  assert.equal(isCodeSaved(["u_A1", "u_B2"], "u_a1"), true);
  assert.equal(isCodeSaved(["u_A1", "u_B2"], "u_c3"), false);
});

test("buildSavedProfileListItems normalizes and hydrates user labels", async () => {
  const rows = await buildSavedProfileListItems({
    codes: ["/u_a1", "u_b2", "u_a1"],
    normalizePublicProfileCode: (value) => {
      const raw = String(value || "").replace("/", "").trim();
      return raw ? `u_${raw.slice(2).toUpperCase()}` : "";
    },
    findUsersByCodes: async () => ([
      { publicProfileCode: "u_A1", profileName: "Ali" },
      { publicProfileCode: "u_B2", firstName: "Sara" },
    ]),
  });
  assert.deepEqual(rows, [
    { code: "u_A1", name: "Ali", genderEmoji: "", age: undefined, userId: undefined, hasDiscussions: false },
    { code: "u_B2", name: "Sara", genderEmoji: "", age: undefined, userId: undefined, hasDiscussions: false },
  ]);
});

test("buildSavedProfilesListText separates rows and hides discussions without visible rooms", () => {
  const text = buildSavedProfilesListText(messages, "en", [
    { code: "u_A1", name: "Ali", hasDiscussions: true },
    { code: "u_B2", name: "Sara" },
  ]);

  assert.match(text, new RegExp(messages.en.savedProfilesTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(text, /1\.\n👤 Ali\n👁 View this profile 👉 \/u_A1\n💬 View this user's discussions 👉 \/ds_A1\n🗑 Remove from saved 👉 \/rm_A1/);
  assert.doesNotMatch(text, /\/ds_B2/);
  assert.doesNotMatch(text, /Invite this user/);
  assert.match(text, /Ali[\s\S]*\n\n2\.\n👤 Sara/);
});

test("paginateSavedProfiles keeps stable numbering across pages", () => {
  const items = Array.from({ length: 6 }, (_, index) => ({
    code: `u_A${index + 1}`,
    name: `User ${index + 1}`,
  }));
  const paged = paginateSavedProfiles(items, 1);
  const text = buildSavedProfilesListText(messages, "en", paged.items, {
    startIndex: paged.startIndex,
    totalCount: items.length,
  });

  assert.equal(paged.page, 1);
  assert.equal(paged.totalPages, 2);
  assert.match(text, /Saved profiles \(6\)/);
  assert.match(text, /6\.\n👤 User 6/);
});

test("buildProfileSavedFooter shows saved status or save command", () => {
  const savedFooter = buildProfileSavedFooter(messages, "en", "u_A1", true, { hasDiscussions: true });
  assert.match(savedFooter, /🔖 Saved/);
  assert.match(savedFooter, /\/ds_A1/);
  assert.match(savedFooter, /\/rm_A1/);
  assert.doesNotMatch(buildProfileSavedFooter(messages, "en", "u_A1", true), /\/ds_A1/);
  assert.equal(buildProfileSavedFooter(messages, "en", "u_A1", false), "👩‍🦳 🔖 Save profile 👉 /save_A1");
});

test("buildSavedProfilesListText uses Persian digits in fa", () => {
  const text = buildSavedProfilesListText(messages, "fa", [
    { code: "u_A1", name: "Ali" },
    { code: "u_B2", name: "Sara" },
  ]);

  assert.match(text, /۱\./);
  assert.match(text, /۲\./);
});

test("profile discussion sections clearly separate current and created rooms", () => {
  const text = buildProfileDiscussionSectionsText(
    messages.en.savedProfileDiscussionsTitle.replace("{name}", "Ali"),
    [
      `${messages.en.savedProfileActiveDiscussionTitle}\n\n1. 💬 Open cafe`,
      `${messages.en.savedProfileCreatedDiscussionsTitle}\n\n1. 💬 Film club`,
    ],
  );

  assert.match(text, /^👩‍🦳💬 Ali's discussions/);
  assert.match(text, /🟢 Current active discussion/);
  assert.match(text, /🎙️ Discussions created by this user/);
  assert.match(text, /Open cafe[\s\S]*━━━━━━━━━━[\s\S]*Film club/);
  assert.match(messages.en.savedProfileNoDiscussions, /no visible discussions/);
  assert.match(messages.fa.savedProfileNoDiscussions, /قابل نمایش/);
});

test("saved-profile removal confirmation includes the profile name", () => {
  assert.equal(formatSavedProfileRemovedMessage("fa", "نیما"), "👩‍🦳 پروفایل «نیما» از ذخیره‌شده‌ها حذف شد.");
  assert.equal(formatSavedProfileRemovedMessage("en", "Nima"), "👩‍🦳 “Nima” was removed from saved profiles.");
  assert.equal(formatSavedProfileRemovedMessage("fa", ""), messages.fa.savedProfileRemovedUnknown);
});

test("saved-profile confirmation includes the profile name", () => {
  assert.equal(formatSavedProfileSavedMessage("fa", "نیما"), "👩‍🦳 پروفایل «نیما» ذخیره شد.");
  assert.equal(formatSavedProfileSavedMessage("en", "Nima"), "👩‍🦳 “Nima” was saved.");
  assert.equal(formatSavedProfileSavedMessage("en", ""), messages.en.savedProfileSavedUnknown);
});

test("ordinary People surfaces forget old cards without Telegram delete or edit calls", async () => {
  const telegramCalls = [];
  const ctx = {
    userId: 1,
    user: {
      navigationMode: "public_profile:people:u_A1:0:saved:1",
      peopleLastListMessageId: 10,
      peopleLastListMode: "browse",
      savedProfilesLastListMessageId: 11,
      publicProfileLastMessageId: 12,
      discussionLastListMessageId: 13,
      discussionLastListType: "people:browse:u_A1",
    },
    deleteMessage: async (...args) => telegramCalls.push(["delete", ...args]),
    editMessageText: async (...args) => telegramCalls.push(["editText", ...args]),
    editMessageReplyMarkup: async (...args) => telegramCalls.push(["editMarkup", ...args]),
  };

  assert.equal(await clearPeopleListMessage(ctx), true);
  assert.equal(await clearSavedProfilesListMessage(ctx), true);
  assert.equal(await clearViewedPublicProfileMessage(ctx), true);
  assert.equal(await clearSavedProfileDiscussionMessage(ctx), true);
  assert.deepEqual(telegramCalls, []);
  assert.equal(ctx.user.peopleLastListMessageId, null);
  assert.equal(ctx.user.savedProfilesLastListMessageId, null);
  assert.equal(ctx.user.publicProfileLastMessageId, null);
  assert.equal(ctx.user.discussionLastListMessageId, null);
});

test("People bottom-button routing never invokes legacy inline deletion", async () => {
  const User = require("../src/models/user");
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  User.findOneAndUpdate = async () => ({});
  let deleteCalls = 0;
  const ctx = {
    callbackData: callBacks.people,
    isReplyKeyboardAction: true,
    userId: 1,
    user: { userId: 1, navigationMode: "people_discovery_results:0:2" },
    answerCb: async () => true,
    reply: async () => ({ message_id: 20 }),
  };

  try {
    await handleSavedProfilesCallback(ctx, "en", {
      clearRememberedAiListMessage: async () => true,
      deleteCallbackMessageIfPossible: async () => {
        deleteCalls += 1;
        return true;
      },
      hasTemporaryReplyKeyboard: () => false,
      leaveDiscussionAndClearKeyboardForNavigation: async () => true,
    });

    assert.equal(deleteCalls, 0);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
