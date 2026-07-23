const test = require("node:test");
const assert = require("node:assert/strict");

const { callBacks } = require("../src/constants");
const {
  getPublicProfileReturnContext,
  isPublicProfileCallback,
} = require("../src/flows/public-profile-callbacks");

test("public profile routing owns view, save, unsave, and member-card close actions", () => {
  const callbacks = [
    `${callBacks.profileViewByCode}u_ABC123`,
    `${callBacks.profileSaveByCode}u_ABC123`,
    `${callBacks.profileSaveByCode}u_ABC123:members`,
    `${callBacks.profileUnsaveByCode}u_ABC123`,
    `${callBacks.profileUnsaveByCode}u_ABC123:members`,
    callBacks.profileCloseDiscussionMember,
  ];
  for (const callback of callbacks) assert.equal(isPublicProfileCallback(callback), true, callback);

  assert.equal(isPublicProfileCallback(callBacks.profile), false);
  assert.equal(isPublicProfileCallback(callBacks.savedProfiles), false);
  assert.equal(isPublicProfileCallback(callBacks.discussionMembersClose), false);
});

test("public profile return context preserves saved and People discussion origins", () => {
  const savedCtx = { user: { discussionLastListType: "saved:u_ABC123:0" } };
  assert.deepEqual(getPublicProfileReturnContext(savedCtx), {
    fromSavedList: true,
    fromPeopleList: false,
    fromProfileDiscussion: true,
  });

  const peopleCtx = { user: { discussionLastListType: "people:taste:u_ABC123:0" } };
  assert.deepEqual(getPublicProfileReturnContext(peopleCtx), {
    fromSavedList: false,
    fromPeopleList: true,
    fromProfileDiscussion: true,
  });
  assert.equal(peopleCtx.user.peopleLastListMode, "taste");
});
