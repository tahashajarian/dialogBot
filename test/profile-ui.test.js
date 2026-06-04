const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { profileKeyboard, profileSettingsKeyboard } = require("../src/keyboards");
const { buildProfileText } = require("../src/services/profile");

const user = {
  firstName: "Ali",
  profileName: "Ali",
  profileDiscoverable: true,
  showActiveDiscussionOnProfile: true,
};

test("buildProfileText shows privacy rows only for own profile", () => {
  const ownText = buildProfileText(user, "en", messages, { isOwnProfile: true });
  const publicText = buildProfileText(user, "en", messages, { isOwnProfile: false });

  assert.match(ownText, /Profile discovery/);
  assert.match(ownText, /Show active discussion on profile/);
  assert.doesNotMatch(publicText, /Profile discovery/);
  assert.doesNotMatch(publicText, /Show active discussion on profile/);
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

test("profileKeyboard keeps lower-frequency controls in settings", () => {
  const keyboard = profileKeyboard("en", true, true);
  const buttons = (keyboard?.reply_markup?.inline_keyboard || []).flat();
  const callbacks = buttons.map((button) => button.callback_data);

  assert.ok(callbacks.includes("profile:settings"));
  assert.ok(callbacks.includes("profile:toggle:discoverable"));
  assert.ok(!callbacks.includes("profile:edit:gender"));
  assert.ok(!callbacks.includes("profile:edit:pet:preference"));
  assert.ok(!callbacks.includes("profile:edit:location"));
  assert.ok(!callbacks.includes("profile:toggle:active-discussion-visible"));
});

test("profileSettingsKeyboard contains detail controls and back to profile", () => {
  const keyboard = profileSettingsKeyboard("en", true);
  const buttons = (keyboard?.reply_markup?.inline_keyboard || []).flat();
  const callbacks = buttons.map((button) => button.callback_data);

  assert.ok(callbacks.includes("profile:edit:gender"));
  assert.ok(callbacks.includes("profile:edit:pet:preference"));
  assert.ok(callbacks.includes("profile:edit:location"));
  assert.ok(callbacks.includes("profile:toggle:active-discussion-visible"));
  assert.ok(callbacks.includes("profile:settings:back"));
  assert.equal(
    buttons.find((button) => button.callback_data === "profile:toggle:active-discussion-visible").text,
    messages.en.profileHideActiveDiscussion,
  );
});
