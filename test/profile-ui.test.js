const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
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
