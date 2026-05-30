const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const {
  formatDiscussionRoom,
  formatRecentDiscussionMessages,
  formatDiscussionMemberLines,
} = require("../src/services/discussion-room-ui");

test("formatDiscussionRoom renders title, description, and counts", () => {
  const text = formatDiscussionRoom(messages, "en", {
    title: "Best Albums",
    description: "Metal only",
    memberUserIds: [1, 2],
    maxMembers: 20,
  });
  assert.match(text, /Best Albums/);
  assert.match(text, /Metal only/);
  assert.match(text, /2\/20/);
});

test("formatRecentDiscussionMessages handles empty and populated lists", () => {
  const empty = formatRecentDiscussionMessages(messages, "en", { recentMessages: [] });
  assert.match(empty, /No messages yet/);

  const populated = formatRecentDiscussionMessages(messages, "en", {
    recentMessages: [{ senderDisplayName: "Ali", text: "Hello" }],
  });
  assert.match(populated, /Ali: Hello/);
});

test("formatDiscussionMemberLines marks owner with owner badge", () => {
  const lines = formatDiscussionMemberLines(messages, "en", [
    { userId: 10, profileName: "Owner", publicProfileCode: "u_A1" },
    { userId: 11, profileName: "Member", publicProfileCode: "u_B2" },
  ], 10);
  assert.match(lines[0], /owner/i);
  assert.match(lines[1], /u_B2/);
});

test("formatDiscussionMemberLines shows current user without profile code", () => {
  const lines = formatDiscussionMemberLines(messages, "en", [
    { userId: 10, profileName: "Owner", publicProfileCode: "u_A1" },
    { userId: 11, profileName: "Member", publicProfileCode: "u_B2" },
  ], 10, 11);

  assert.equal(lines[1], "2. You");
});
