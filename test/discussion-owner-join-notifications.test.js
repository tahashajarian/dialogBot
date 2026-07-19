const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const { getDiscussionOwnerJoinNoticeConfig } = require("../src/config");
const {
  NOTICE_WINDOW_MS,
  buildOwnerJoinNoticeText,
  ownerJoinNoticeKeyboard,
} = require("../src/services/discussion-owner-join-notifications");

test("owner join notice rollout switch defaults off and accepts explicit true", () => {
  assert.deepEqual(getDiscussionOwnerJoinNoticeConfig({}), { enabled: false });
  assert.deepEqual(
    getDiscussionOwnerJoinNoticeConfig({ DISCUSSION_OWNER_JOIN_NOTICES_ENABLED: "true" }),
    { enabled: true },
  );
});

test("owner join notice copy renders single and summarized joins in both languages", () => {
  const discussion = { title: "Best movie endings" };
  assert.equal(buildOwnerJoinNoticeText(messages, "en", {
    joinerName: "Sara",
    joinedCount: 1,
    discussion,
    memberCount: 6,
  }), "👩‍🦳 \"Sara\" joined your discussion.\n\n💬 Best movie endings\n👥 6 members");
  assert.equal(buildOwnerJoinNoticeText(messages, "fa", {
    joinerName: "سارا",
    joinedCount: 4,
    discussion,
    memberCount: 9,
  }), "👩‍🦳 4 نفر جدید به گفت‌وگوی شما پیوستند.\n\n💬 Best movie endings\n👥 9 عضو");
  assert.equal(buildOwnerJoinNoticeText(messages, "en", {
    joinedCount: 1,
    discussion,
    memberCount: 2,
    forceSummary: true,
  }), "👩‍🦳 1 more person joined your discussion.\n\n💬 Best movie endings\n👥 2 members");
});

test("owner join notice Open button targets the owner-notice action callback", () => {
  const keyboard = ownerJoinNoticeKeyboard(messages, "en", "d_ROOM01");
  assert.deepEqual(keyboard.reply_markup.inline_keyboard, [[{
    text: "Open discussion",
    callback_data: `${callBacks.discussionOwnerJoinNoticeOpen}d_ROOM01`,
  }]]);
  assert.equal(NOTICE_WINDOW_MS, 10 * 60 * 1000);
});
