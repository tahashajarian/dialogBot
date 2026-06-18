const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const {
  profileKeyboard,
  profileSettingsKeyboard,
  profileActiveDiscussionHelpKeyboard,
} = require("../src/keyboards");
const { buildProfileText } = require("../src/services/profile");

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

test("buildProfileText shows badge tip only on own profile", () => {
  const noBadgeUser = {
    firstName: "Ali",
    profileName: "Ali",
    aiTaste: {},
  };
  const ownText = buildProfileText(noBadgeUser, "en", messages, { isOwnProfile: true });
  const publicText = buildProfileText(noBadgeUser, "en", messages, { isOwnProfile: false });

  assert.match(ownText, /🏷 Taste labels/);
  assert.match(ownText, /💡 You do not have a badge yet/);
  assert.match(publicText, /🏷 Taste labels/);
  assert.match(publicText, /No badge/);
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

test("buildProfileText only shows empty interests hint on own profile", () => {
  const emptyUser = {
    firstName: "Ali",
    profileName: "Ali",
    aiLists: { random: { topTen: [] } },
  };

  const ownText = buildProfileText(emptyUser, "en", messages, { isOwnProfile: true });
  const publicText = buildProfileText(emptyUser, "en", messages, { isOwnProfile: false });

  assert.match(ownText, /🧩 Interests/);
  assert.match(ownText, /You have not added interests yet/);
  assert.doesNotMatch(publicText, /🧩 Interests/);
  assert.doesNotMatch(publicText, /You have not added interests yet/);
});

test("buildProfileText shows own-profile completeness", () => {
  const profileUser = {
    firstName: "Ali",
    profileName: "Ali",
    aiLists: {
      random: {
        topTen: [
          { title: "Chess" },
          { title: "Coffee" },
          { title: "Coding" },
        ],
      },
    },
  };

  const ownText = buildProfileText(profileUser, "en", messages, { isOwnProfile: true });
  const publicText = buildProfileText(profileUser, "en", messages, { isOwnProfile: false });

  assert.match(ownText, /👤 Profile completeness: 40%/);
  assert.match(ownText, /Missing: age, city, photo/);
  assert.doesNotMatch(publicText, /Profile completeness/);
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
