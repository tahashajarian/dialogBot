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
  assert.match(text, /📄 Metal only/);
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

test("formatDiscussionMemberLines marks host with host badge", () => {
  const lines = formatDiscussionMemberLines(messages, "en", [
    { userId: 10, profileName: "Owner", publicProfileCode: "u_A1" },
    { userId: 11, profileName: "Member", publicProfileCode: "u_B2" },
  ], 10);
  assert.match(lines[0], /Owner — ⭐ host/);
  assert.match(lines[1], /👁 View profile 👈 \/u_B2/);
  assert.match(lines[1], /🚩 Report 👈 \/report_B2/);
});

test("formatDiscussionMemberLines does not show presence marker", () => {
  const lines = formatDiscussionMemberLines(messages, "en", [
    { userId: 10, profileName: "Owner", publicProfileCode: "u_A1", activeDiscussionId: "d1" },
    { userId: 11, profileName: "Member", publicProfileCode: "u_B2", activeDiscussionId: "d1" },
  ], 10, 11, "d1");

  assert.doesNotMatch(lines.join("\n"), /🟢/);
});

test("formatDiscussionMemberLines shows current user without profile code", () => {
  const lines = formatDiscussionMemberLines(messages, "en", [
    { userId: 10, profileName: "Owner", publicProfileCode: "u_A1" },
    { userId: 11, profileName: "Member", publicProfileCode: "u_B2" },
  ], 10, 11);

  assert.equal(lines[1], "2.\n👤 You\n────────");
});

test("formatDiscussionMemberLines lets owner remove other members", () => {
  const lines = formatDiscussionMemberLines(messages, "en", [
    { userId: 10, profileName: "Owner", publicProfileCode: "u_A1" },
    { userId: 11, profileName: "Member", publicProfileCode: "u_B2" },
  ], 10, 10);

  assert.match(lines[1], /👁 View profile 👈 \/u_B2/);
  assert.match(lines[1], /🚩 Report 👈 \/report_B2/);
  assert.match(lines[1], /🗑 Remove 👈 \/remove_B2/);
});

test("formatDiscussionMemberLines separates member blocks with dividers", () => {
  const lines = formatDiscussionMemberLines(messages, "en", [
    { userId: 10, profileName: "Owner", publicProfileCode: "u_A1" },
    { userId: 11, profileName: "Member", publicProfileCode: "u_B2" },
  ], 10, 10);

  assert.match(lines.join("\n"), /You[\s\S]*────────[\s\S]*Member/);
  assert.match(lines.at(-1), /────────$/);
});

test("formatDiscussionMemberLines uses Persian digits in fa", () => {
  const lines = formatDiscussionMemberLines(messages, "fa", [
    { userId: 10, profileName: "علی", publicProfileCode: "u_A1" },
    { userId: 11, profileName: "Sara", publicProfileCode: "u_B2" },
  ], 10, 10);

  assert.match(lines[0], /۱\./);
  assert.match(lines[1], /۲\./);
});
