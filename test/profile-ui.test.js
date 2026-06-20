const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const {
  profileKeyboard,
  profileSettingsKeyboard,
  profileActiveDiscussionHelpKeyboard,
} = require("../src/keyboards");
const {
  buildProfileText,
  sendProfileMessage,
  sanitizeProfileNameCandidate,
  validateProfileName,
} = require("../src/services/profile");

const user = {
  firstName: "Ali",
  profileName: "Ali",
  showActiveDiscussionOnProfile: true,
};

test("buildProfileText shows active discussion visibility only for own profile", () => {
  const ownText = buildProfileText(user, "en", messages, { isOwnProfile: true });
  const publicText = buildProfileText(user, "en", messages, { isOwnProfile: false });

  assert.match(ownText, /Show active discussion/);
  assert.match(ownText, /What is this\? \/ad_help/);
  assert.doesNotMatch(publicText, /Show active discussion/);
  assert.doesNotMatch(publicText, /\/ad_help/);
});

test("buildProfileText uses public title when viewing someone else", () => {
  const ownText = buildProfileText(user, "en", messages, { isOwnProfile: true });
  const publicText = buildProfileText(user, "en", messages, { isOwnProfile: false });
  const publicTextFa = buildProfileText(user, "fa", messages, { isOwnProfile: false });

  assert.match(ownText, /Your profile:/);
  assert.match(publicText, /User profile:/);
  assert.doesNotMatch(publicText, /Your profile:/);
  assert.match(publicTextFa, /پروفایل کاربر:/);
  assert.doesNotMatch(publicTextFa, /پروفایل شما:/);
});

test("validateProfileName rejects emoji and keeps normal names", () => {
  assert.deepEqual(validateProfileName("Ali", 30), { ok: true, value: "Ali" });
  assert.deepEqual(validateProfileName("  علی   رضایی  ", 30), { ok: true, value: "علی رضایی" });
  assert.equal(validateProfileName("Al", 30).reason, "too_short");
  assert.equal(validateProfileName("Ali 🤖", 30).reason, "emoji");
  assert.equal(validateProfileName("Sara 🌸", 30).reason, "emoji");
  assert.equal(sanitizeProfileNameCandidate("Ali 🤖", 30), "Ali");
  assert.equal(sanitizeProfileNameCandidate("🤖", 30), "");
});

test("buildProfileText hides empty badge section", () => {
  const noBadgeUser = {
    firstName: "Ali",
    profileName: "Ali",
    aiTaste: {},
  };
  const ownText = buildProfileText(noBadgeUser, "en", messages, { isOwnProfile: true });
  const publicText = buildProfileText(noBadgeUser, "en", messages, { isOwnProfile: false });

  assert.doesNotMatch(ownText, /🏷 Taste labels/);
  assert.doesNotMatch(ownText, /You do not have a badge yet/);
  assert.doesNotMatch(publicText, /🏷 Taste labels/);
  assert.doesNotMatch(publicText, /No badge/);
  assert.doesNotMatch(publicText, /You do not have a badge yet/);
});

test("buildProfileText shows compact interests preview", () => {
  const profileUser = {
    firstName: "Ali",
    profileName: "Ali",
    aiLists: {
      random: {
        topTen: [
          { title: "Chess" },
          { title: "Coffee" },
          { title: "Coding" },
          { title: "Photography" },
          { title: "Travel" },
          { title: "Cooking" },
        ],
      },
    },
  };

  const text = buildProfileText(profileUser, "en", messages, { isOwnProfile: false });

  assert.match(text, /🧩 Interests/);
  assert.match(text, /Chess, Coffee, Coding, Photography, Travel/);
  assert.doesNotMatch(text, /Cooking/);
});

test("buildProfileText hides empty interests section", () => {
  const emptyUser = {
    firstName: "Ali",
    profileName: "Ali",
    aiLists: { random: { topTen: [] } },
  };

  const ownText = buildProfileText(emptyUser, "en", messages, { isOwnProfile: true });
  const publicText = buildProfileText(emptyUser, "en", messages, { isOwnProfile: false });

  assert.doesNotMatch(ownText, /🧩 Interests/);
  assert.doesNotMatch(ownText, /You have not added interests yet/);
  assert.doesNotMatch(publicText, /🧩 Interests/);
  assert.doesNotMatch(publicText, /You have not added interests yet/);
});

test("buildProfileText omits unset optional profile rows", () => {
  const minimalUser = {
    firstName: "Ali",
    profileName: "Ali",
  };

  const text = buildProfileText(minimalUser, "en", messages, { isOwnProfile: false });

  assert.match(text, /👤 Name: Ali/);
  assert.doesNotMatch(text, /City:/);
  assert.doesNotMatch(text, /Age:/);
  assert.doesNotMatch(text, /Gender:/);
  assert.doesNotMatch(text, /Pet:/);
  assert.doesNotMatch(text, /Location:/);
  assert.doesNotMatch(text, /Bio:/);
  assert.doesNotMatch(text, /—/);
});

test("sendProfileMessage skips loading and default photo for text-only profiles", async () => {
  const replies = [];
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    replyWithPhoto: async () => {
      throw new Error("text-only profile should not send a default photo");
    },
  };

  const sent = await sendProfileMessage({
    ctx,
    user,
    lang: "en",
    messages,
    loadingText: messages.en.profileLoading,
  });

  assert.equal(sent.message_id, 1);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /User profile:/);
  assert.doesNotMatch(replies[0].text, /Preparing profile/);
});

test("sendProfileMessage keeps loading only for custom profile photos", async () => {
  const replies = [];
  const photos = [];
  const deletedIds = [];
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 10 };
    },
    replyWithPhoto: async (photo, extra) => {
      photos.push({ photo, extra });
      return { message_id: 11 };
    },
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
  };

  const sent = await sendProfileMessage({
    ctx,
    user: { ...user, photoFileId: "photo-file-id" },
    lang: "en",
    messages,
    loadingText: messages.en.profileLoading,
  });

  assert.equal(sent.message_id, 11);
  assert.equal(replies[0].text, messages.en.profileLoading);
  assert.equal(photos[0].photo, "photo-file-id");
  assert.match(photos[0].extra.caption, /User profile:/);
  assert.deepEqual(deletedIds, [10]);
});

test("profileKeyboard puts remove photo beside change photo", () => {
  const keyboard = profileKeyboard("en", true);
  const rows = keyboard?.reply_markup?.inline_keyboard || [];
  const photoRow = rows.find((row) => row.some((button) => button.callback_data === "profile:edit:photo"));

  assert.ok(photoRow);
  assert.deepEqual(photoRow.map((button) => button.text), [
    messages.en.profileEditPhoto,
    messages.en.profileResetPhoto,
  ]);
});

test("profileKeyboard groups frequent profile edits into compact rows", () => {
  const keyboard = profileKeyboard("en", true);
  const rows = keyboard?.reply_markup?.inline_keyboard || [];
  const buttons = rows.flat();
  const callbacks = buttons.map((button) => button.callback_data);
  const nameAgeRow = rows.find((row) => row.some((button) => button.callback_data === "profile:edit:name"));
  const cityGenderRow = rows.find((row) => row.some((button) => button.callback_data === "profile:edit:city"));

  assert.ok(callbacks.includes("profile:settings"));
  assert.ok(!callbacks.includes("profile:active-discussion:help"));
  assert.ok(!callbacks.includes("profile:toggle:discoverable"));
  assert.ok(!callbacks.includes("profile:edit:bio"));
  assert.ok(!callbacks.includes("profile:edit:pet:preference"));
  assert.ok(!callbacks.includes("profile:edit:location"));
  assert.ok(!callbacks.includes("profile:toggle:active-discussion-visible"));
  assert.deepEqual(nameAgeRow.map((button) => button.callback_data), ["profile:edit:name", "profile:edit:age"]);
  assert.deepEqual(cityGenderRow.map((button) => button.callback_data), ["profile:edit:city", "profile:edit:gender"]);
});

test("profileSettingsKeyboard contains detail controls and back to profile", () => {
  const keyboard = profileSettingsKeyboard("en", true);
  const rows = keyboard?.reply_markup?.inline_keyboard || [];
  const buttons = rows.flat();
  const callbacks = buttons.map((button) => button.callback_data);
  const bioPetRow = rows.find((row) => row.some((button) => button.callback_data === "profile:edit:bio"));
  const locationVisibilityRow = rows.find((row) => row.some((button) => button.callback_data === "profile:edit:location"));

  assert.ok(callbacks.includes("profile:edit:bio"));
  assert.ok(!callbacks.includes("profile:edit:gender"));
  assert.ok(callbacks.includes("profile:edit:pet:preference"));
  assert.ok(callbacks.includes("profile:edit:location"));
  assert.ok(callbacks.includes("profile:toggle:active-discussion-visible"));
  assert.ok(!callbacks.includes("profile:active-discussion:help"));
  assert.ok(callbacks.includes("profile:settings:back"));
  assert.deepEqual(bioPetRow.map((button) => button.callback_data), ["profile:edit:bio", "profile:edit:pet:preference"]);
  assert.deepEqual(locationVisibilityRow.map((button) => button.callback_data), ["profile:edit:location", "profile:toggle:active-discussion-visible"]);
  assert.equal(
    buttons.find((button) => button.callback_data === "profile:toggle:active-discussion-visible").text,
    messages.en.profileHideActiveDiscussion,
  );
});

test("profileActiveDiscussionHelpKeyboard returns to profile", () => {
  const keyboard = profileActiveDiscussionHelpKeyboard("en");
  const buttons = (keyboard?.reply_markup?.inline_keyboard || []).flat();

  assert.deepEqual(buttons.map((button) => button.callback_data), [
    "profile:active-discussion:help:done",
  ]);
  assert.equal(buttons[0].text, messages.en.profileActiveDiscussionHelpDone);
});
