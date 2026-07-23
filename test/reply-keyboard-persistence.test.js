const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const {
  aiAssistantKeyboard,
  discussionsMenuKeyboard,
  discussionRoomKeyboard,
  mainMenuKeyboard,
  onboardingCompleteKeyboard,
  peopleHubKeyboard,
  profileKeyboard,
} = require("../src/keyboards");
const {
  getStableReplyKeyboardRecovery,
  restoreStableReplyKeyboard,
} = require("../src/flows/reply-keyboard-recovery");
const Discussion = require("../src/models/discussion");

test("stable reply keyboards request persistent display on Telegram clients", () => {
  const keyboards = [
    mainMenuKeyboard("en"),
    discussionsMenuKeyboard("en"),
    discussionRoomKeyboard("en"),
    peopleHubKeyboard("en"),
    aiAssistantKeyboard("en"),
    profileKeyboard("en"),
    onboardingCompleteKeyboard("en"),
  ];

  for (const keyboard of keyboards) {
    assert.ok(keyboard.reply_markup.keyboard?.length);
    assert.equal(keyboard.reply_markup.one_time_keyboard, false);
    assert.equal(keyboard.reply_markup.is_persistent, true);
  }
});

test("invite dismissal reconstructs stable navigation without changing its mode", () => {
  const contexts = [
    [{ state: "idle", navigationMode: "global" }, /Home/],
    [{ state: "idle", navigationMode: "discussions" }, /Discussions/],
    [{ state: "idle", navigationMode: "people" }, /People/],
    [{ state: "idle", navigationMode: "favorites" }, /Choose a section/],
    [{ state: "idle", navigationMode: "profile" }, /profile details/],
  ];

  for (const [user, expectedText] of contexts) {
    const recovery = getStableReplyKeyboardRecovery({ user }, "en");
    assert.match(recovery.text, expectedText);
    assert.equal(recovery.keyboard.reply_markup.is_persistent, true);
  }
});

test("invite dismissal does not replace active or in-progress reply keyboards", () => {
  assert.equal(getStableReplyKeyboardRecovery({
    user: { state: "editing_bio", navigationMode: "profile" },
  }, "en"), null);
  assert.equal(getStableReplyKeyboardRecovery({
    user: { state: "idle", navigationMode: "discussions", activeDiscussionId: "active" },
  }, "en"), null);
});

test("invite dismissal restores active discussion controls when another invite cannot open", async () => {
  const originalFindById = Discussion.findById;
  const replies = [];
  Discussion.findById = () => ({
    lean: async () => ({
      _id: "active",
      status: "open",
      title: "Movie Room",
      ownerUserId: 7,
      memberUserIds: [7],
    }),
  });

  try {
    await restoreStableReplyKeyboard({
      userId: 7,
      user: { state: "idle", activeDiscussionId: "active" },
      reply: async (text, extra) => {
        replies.push({ text, extra });
        return { message_id: 1 };
      },
    }, "en");
  } finally {
    Discussion.findById = originalFindById;
  }

  assert.match(replies[0].text, /Movie Room/);
  assert.equal(replies[0].extra.reply_markup.is_persistent, true);
  assert.ok(replies[0].extra.reply_markup.keyboard.flat().some(
    (button) => button.text === messages.en.discussionLeave,
  ));
});
