const test = require("node:test");
const assert = require("node:assert/strict");
const { callBacks } = require("../src/constants");
const { isSavedProfilesCallback } = require("../src/flows/saved-profiles-routing");
const {
  buildProfileDiscussionReturnType,
  parseProfileDiscussionRequest,
} = require("../src/services/saved-profile-discussions-ui");

test("Saved Profiles routing recognizes exact, paged, and People callbacks", () => {
  assert.equal(isSavedProfilesCallback(callBacks.savedProfiles), true);
  assert.equal(isSavedProfilesCallback(`${callBacks.savedProfilesPage}2`), true);
  assert.equal(isSavedProfilesCallback(callBacks.peopleDiscover), true);
  assert.equal(isSavedProfilesCallback(callBacks.profileEditName), false);
});

test("profile discussion requests normalize legacy People sources", () => {
  assert.deepEqual(parseProfileDiscussionRequest("taste:u_AB12"), {
    source: "people",
    peopleMode: "taste",
    code: "u_AB12",
  });
  assert.deepEqual(parseProfileDiscussionRequest("saved:u_AB12"), {
    source: "saved",
    peopleMode: "browse",
    code: "u_AB12",
  });
});

test("unscoped profile discussion requests preserve current People context", () => {
  const request = parseProfileDiscussionRequest("u_AB12", {
    user: { peopleLastListMode: "taste", peopleLastListMessageId: 44 },
  });
  assert.deepEqual(request, { source: "people", peopleMode: "taste", code: "u_AB12" });
});

test("profile discussion return types reject invalid codes and retain source", () => {
  assert.equal(buildProfileDiscussionReturnType("bad"), "");
  assert.equal(
    buildProfileDiscussionReturnType("u_AB12", { source: "people", peopleMode: "taste" }),
    "people:taste:u_AB12",
  );
});
