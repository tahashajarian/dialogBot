const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const {
  getDiscussionErrorMessage,
  buildDiscussionListText,
  buildDiscussionPreviewText,
  buildDiscussionInviteShareText,
  buildDiscussionInvitePreviewText,
  buildDiscussionInviteLockedText,
} = require("../src/services/discussion-ui");
const {
  discussionListNavigationKeyboard,
  discussionInvitePreviewKeyboard,
  discussionJoinErrorAckKeyboard,
  discussionRoomKeyboard,
} = require("../src/keyboards");
const { callBacks } = require("../src/constants");
const {
  handleDiscussionListCallback,
  shouldKeepDiscussionRoomCardsForCallback,
  isDiscussionCreateFlowCallback,
} = require("../src/flows/discussions-callbacks");
const { isDiscussionCreateCallback } = require("../src/flows/discussions-create-callbacks");

test("discussion callback error mapping returns specific copy", () => {
  assert.equal(
    getDiscussionErrorMessage(messages, "en", "discussion_full"),
    messages.en.discussionErrFull,
  );
  assert.equal(
    getDiscussionErrorMessage(messages, "fa", "requires_top_ten_completed"),
    messages.fa.discussionErrNeedTopTen,
  );
  assert.equal(
    getDiscussionErrorMessage(messages, "en", "not_owner"),
    messages.en.discussionErrNotOwner,
  );
});

test("discussion preview text reflects draft edits", () => {
  const user = {
    discussionDraftTitle: "Best riffs",
    discussionDraftDescription: "Metal only",
    discussionDraftJoinRule: { type: "top_ten_completed", section: "music" },
  };
  const preview = buildDiscussionPreviewText(messages, "en", user);
  assert.match(preview, /Best riffs/);
  assert.match(preview, /Metal only/);
  assert.match(preview, /Completed Top 10 \(Music\)/);
});

test("discussion preview includes selected top ten item", () => {
  const user = {
    discussionDraftTitle: "Dune fans",
    discussionDraftDescription: "",
    discussionDraftJoinRule: { type: "top_ten_item", section: "books", itemTitle: "Dune" },
    discussionDraftMaxMembers: 5,
  };
  const preview = buildDiscussionPreviewText(messages, "en", user);
  assert.match(preview, /🏆 Books - Dune/);
  assert.match(preview, /Capacity: 5/);
});

test("discussion list text includes title, description, count, and rule", () => {
  const text = buildDiscussionListText(messages, "en", "Active discussions", [{
    title: "Metal room",
    publicDiscussionCode: "d_AB12",
    isJoinable: false,
    description: "Heavy riffs only",
    memberUserIds: [1, 2],
    maxMembers: 20,
    joinRule: { type: "taste_label", section: "music", tasteLabelKey: "metalhead" },
  }]);

  assert.match(text, /1\.\n💬 Metal room/);
  assert.match(text, /📄 Heavy riffs only/);
  assert.match(text, /👥 2\/20/);
  assert.match(text, /🔐 Join condition:/);
  assert.match(text, /🏷 Music -[\s\S]*🔒/);
  assert.match(text, /Join 👈 \/d_AB12/);
});

test("discussion list text separates multiple discussions with dividers", () => {
  const text = buildDiscussionListText(messages, "en", "Active discussions", [
    {
      title: "Metal room",
      publicDiscussionCode: "d_AB12",
      memberUserIds: [1],
      joinRule: { type: "open" },
    },
    {
      title: "Movie room",
      publicDiscussionCode: "d_CD34",
      memberUserIds: [1, 2],
      joinRule: { type: "open" },
    },
  ]);

  assert.match(text, /Metal room[\s\S]*────────[\s\S]*Movie room/);
});

test("discussion list text keeps numbering across pages", () => {
  const text = buildDiscussionListText(messages, "en", "Active discussions", [
    {
      title: "Page two item one",
      publicDiscussionCode: "d_EF56",
      memberUserIds: [1],
      joinRule: { type: "open" },
    },
    {
      title: "Page two item two",
      publicDiscussionCode: "d_GH78",
      memberUserIds: [1, 2],
      joinRule: { type: "open" },
    },
  ], { startIndex: 5 });

  assert.match(text, /6\.\n💬 Page two item one/);
  assert.match(text, /7\.\n💬 Page two item two/);
});

test("discussion list text uses Persian digits for fa numbering", () => {
  const text = buildDiscussionListText(messages, "fa", "بحث‌ها", [
    {
      title: "English title",
      description: "English desc",
      memberUserIds: [1],
      joinRule: { type: "open" },
    },
  ], { startIndex: 1 });

  assert.match(text, /۲\./);
});

test("discussion navigation keyboard uses next page index and updated labels", () => {
  const keyboard = discussionListNavigationKeyboard("fa", {
    listType: "active",
    page: 0,
    totalPages: 3,
    joinableOnly: false,
  });

  const rows = keyboard?.reply_markup?.inline_keyboard || [];
  const flatButtons = rows.flat();
  const moreButton = flatButtons.find((btn) => btn.callback_data === "discussion:list:active:page:1:all");

  assert.ok(moreButton);
  assert.equal(moreButton.text, `${messages.fa.discussionListMorePage} ➡️`);
  assert.equal(messages.fa.discussionListMorePage, "نمایش بیشتر");
  assert.equal(messages.fa.discussionListPrevPage, "قبلی‌ها");
});

test("discussion navigation toggle keeps emoji and updates only text", () => {
  const allState = discussionListNavigationKeyboard("fa", {
    listType: "active",
    page: 0,
    totalPages: 2,
    joinableOnly: false,
  });
  const joinableState = discussionListNavigationKeyboard("fa", {
    listType: "active",
    page: 0,
    totalPages: 2,
    joinableOnly: true,
  });

  const allButtons = (allState?.reply_markup?.inline_keyboard || []).flat();
  const joinableButtons = (joinableState?.reply_markup?.inline_keyboard || []).flat();
  const allToggle = allButtons.find((btn) => btn.callback_data === "discussion:list:active:page:0:joinable");
  const joinableToggle = joinableButtons.find((btn) => btn.callback_data === "discussion:list:active:page:0:all");

  assert.equal(allToggle?.text, "🔓 فقط قابل ورودها");
  assert.equal(joinableToggle?.text, "🔓 نمایش همه");
});

test("discussion join error acknowledgement can return to saved profile discussions", async () => {
  const keyboard = discussionJoinErrorAckKeyboard("en", "saved:u_a1");
  const button = keyboard.reply_markup.inline_keyboard.flat()[0];
  assert.equal(button.callback_data, `${callBacks.discussionJoinErrorAck}saved:u_A1`);

  const deletedIds = [];
  let renderedCode = "";
  const ctx = {
    callbackData: `${callBacks.discussionJoinErrorAck}saved:u_A1`,
    callbackMessageId: 42,
    userId: 1,
    user: { userId: 1 },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
  };

  await handleDiscussionListCallback(ctx, "en", {
    deleteCallbackMessageIfPossible: (callbackCtx) => callbackCtx.deleteMessage(callbackCtx.callbackMessageId),
    renderSavedProfileDiscussions: async (_ctx, _lang, code) => {
      renderedCode = code;
      return true;
    },
  });

  assert.deepEqual(deletedIds, [42]);
  assert.equal(renderedCode, "u_A1");
});

test("discussion create TopTen callback is routed and treated as create flow", () => {
  assert.equal(isDiscussionCreateCallback(callBacks.discussionCreateRuleTopTen), true);
  assert.equal(isDiscussionCreateFlowCallback(callBacks.discussionCreateRuleTopTen), true);
  assert.equal(shouldKeepDiscussionRoomCardsForCallback(callBacks.discussionCreateRuleTopTen), true);
});

test("discussion room keyboard includes invite and leave without menu button", () => {
  const keyboard = discussionRoomKeyboard("en", false);
  const rows = keyboard?.reply_markup?.keyboard || [];
  const labels = rows.flat().map((button) => button.text);
  assert.ok(labels.includes(messages.en.discussionInvite));
  assert.ok(labels.includes(messages.en.discussionLeave));
  assert.equal(labels.includes(messages.en.discussionReturnToMenu), false);
  assert.equal(labels.includes(messages.en.discussionCloseButton), false);
});

test("discussion owner room keyboard includes leave and close", () => {
  const keyboard = discussionRoomKeyboard("en", true);
  const labels = (keyboard?.reply_markup?.keyboard || []).flat().map((button) => button.text);
  assert.ok(labels.includes(messages.en.discussionLeave));
  assert.ok(labels.includes(messages.en.discussionCloseButton));
  assert.equal(labels.includes(messages.en.discussionReturnToMenu), false);
});

test("discussion invite preview keyboard joins by public code", () => {
  const keyboard = discussionInvitePreviewKeyboard("en", "d_AB12");
  const buttons = keyboard?.reply_markup?.inline_keyboard.flat() || [];
  assert.ok(buttons.find((button) => button.callback_data === `${callBacks.discussionInviteJoin}d_AB12`));
});

test("discussion invite share and preview text stay privacy-safe", () => {
  const discussion = {
    title: "Metal room",
    description: "Heavy riffs only",
    publicDiscussionCode: "d_AB12",
    memberUserIds: [1, 2],
    maxMembers: 5,
    joinRule: { type: "taste_label", section: "music", tasteLabelKey: "metalhead" },
  };

  const shareText = buildDiscussionInviteShareText(messages, "en", discussion, "d_AB12", {
    deepLink: "https://ble.ir/@LikelyBot?start=join_AB12",
  });
  const previewText = buildDiscussionInvitePreviewText(messages, "en", discussion);

  assert.match(shareText, /Join discussion 👉 https:\/\/ble\.ir\/@LikelyBot\?start=join_AB12/);
  assert.doesNotMatch(shareText, /Join inside the bot 👉 \/join_AB12/);
  assert.match(shareText, /Join condition:/);
  assert.match(shareText, /📄 Heavy riffs only/);
  assert.doesNotMatch(shareText, /recent/i);
  assert.match(previewText, /Invite preview/);
  assert.match(previewText, /👥 2\/5/);
});

test("discussion invite locked hint names required update path", () => {
  const text = buildDiscussionInviteLockedText(messages, "en", "requires_top_ten_item", {
    joinRule: { type: "top_ten_item", section: "random", itemTitle: "Chess" },
  });

  assert.match(text, /Chess/);
  assert.match(text, /Go to Lists/);
  assert.match(text, /same invite link/);
});
