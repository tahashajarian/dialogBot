const test = require("node:test");
const assert = require("node:assert/strict");

const { getProfileStarCompletionStatus } = require("../src/services/star-milestones");
const { starEconomy } = require("../src/services/star-settings");

test("profile Star milestone requires name, bio, and two optional public fields", () => {
  assert.deepEqual(getProfileStarCompletionStatus({ profileName: "Ali" }), {
    complete: false,
    hasName: true,
    hasBio: false,
    optionalCompleted: 0,
    optionalNeeded: 2,
  });

  const completed = getProfileStarCompletionStatus({
    profileName: "Ali",
    bio: "Music and books",
    city: "Tehran",
    photoFileId: "photo",
  });
  assert.equal(completed.complete, true);
  assert.equal(completed.optionalCompleted, 2);
});

test("exact location is not part of the profile Star milestone", () => {
  const status = getProfileStarCompletionStatus({
    profileName: "Ali",
    bio: "Music and books",
    location: { latitude: 35, longitude: 51 },
  });
  assert.equal(status.complete, false);
  assert.equal(status.optionalCompleted, 0);
});

test("a hidden Pet field does not count toward profile completion", () => {
  const previous = starEconomy.profilePetPreferenceEnabled;
  try {
    starEconomy.profilePetPreferenceEnabled = false;
    const hidden = getProfileStarCompletionStatus({ profileName: "Ali", bio: "Bio", city: "Tehran", petPreference: "cat" });
    assert.equal(hidden.optionalCompleted, 1);
    assert.equal(hidden.complete, false);
    starEconomy.profilePetPreferenceEnabled = true;
    const enabled = getProfileStarCompletionStatus({ profileName: "Ali", bio: "Bio", city: "Tehran", petPreference: "cat" });
    assert.equal(enabled.optionalCompleted, 2);
    assert.equal(enabled.complete, true);
  } finally {
    starEconomy.profilePetPreferenceEnabled = previous;
  }
});
