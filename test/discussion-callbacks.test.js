const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const {
  getDiscussionErrorMessage,
  buildDiscussionListText,
  buildDiscussionPreviewText,
} = require("../src/services/discussion-ui");
const { discussionListNavigationKeyboard } = require("../src/keyboards");

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
  assert.match(text, /🔒 🔐 Join condition:/);
  assert.match(text, /🏷 Music -/);
  assert.match(text, /Join 👉 \/d_AB12/);
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
