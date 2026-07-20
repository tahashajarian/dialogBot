const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const {
  DISCUSSION_NOTIFICATION_CONCURRENCY,
  createActiveDiscussionNotifier,
  notifyDiscussionMembers,
} = require("../src/services/discussion-notifications");

test("discussion notifications attempt every member despite isolated delivery failures", async () => {
  const attempted = [];
  let active = 0;
  let maxActive = 0;
  const members = Array.from({ length: 12 }, (_, index) => ({
    userId: index + 1,
    lang: index % 2 ? "en" : "fa",
  }));
  const ctx = {
    sendToUser: async (userId) => {
      attempted.push(userId);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      if (userId === 4) throw new Error("blocked");
      return userId !== 9;
    },
  };

  const result = await notifyDiscussionMembers(
    ctx,
    messages,
    members,
    (msgs, lang) => msgs[lang].discussionLeftNotice.replace("{name}", "Sara"),
  );

  assert.deepEqual(attempted.sort((a, b) => a - b), members.map((member) => member.userId));
  assert.deepEqual(result, { attempted: 12, delivered: 10, failed: 2 });
  assert.ok(maxActive <= DISCUSSION_NOTIFICATION_CONCURRENCY);
});

test("active-member lookup failure stays isolated from the acting user", async () => {
  const notify = createActiveDiscussionNotifier(async () => {
    throw new Error("database unavailable");
  });

  const result = await notify({}, messages, "room-1", [], () => "notice");
  assert.deepEqual(result, {
    attempted: 0,
    delivered: 0,
    failed: 0,
    lookupFailed: true,
  });
});
