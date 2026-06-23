const test = require("node:test");
const assert = require("node:assert/strict");

const { getProfileStarCompletionStatus } = require("../src/services/star-milestones");

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
