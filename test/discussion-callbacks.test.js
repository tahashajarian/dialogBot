const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { starEconomy } = require("../src/services/star-settings");
const {
  getDiscussionErrorMessage,
  buildDiscussionListText,
  buildDiscussionPreviewText,
  buildDiscussionInviteShareText,
  buildDiscussionInvitePreviewText,
  buildDiscussionInviteLockedText,
  buildDiscussionJoinLockedText,
  getDiscussionDiscoveryScore,
  rankDiscussionsForDiscovery,
} = require("../src/services/discussion-ui");
const {
  discussionListNavigationKeyboard,
  discussionInvitePreviewKeyboard,
  discussionJoinErrorAckKeyboard,
  discussionCreateGuidanceAckKeyboard,
  discussionRoomKeyboard,
  discussionCreateCapacityKeyboard,
  discussionCreateLanguagePickerKeyboard,
} = require("../src/keyboards");
const { callBacks } = require("../src/constants");
const {
  handleDiscussionListCallback,
  renderMyDiscussionList,
  shouldKeepDiscussionRoomCardsForCallback,
  isDiscussionCreateFlowCallback,
} = require("../src/flows/discussions-callbacks");
const {
  handleDiscussionCreateCallback,
  isDiscussionCreateCallback,
} = require("../src/flows/discussions-create-callbacks");
const {
  handleDiscussionNameCancel,
} = require("../src/flows/discussion-name-gate");
const { handleCallback } = require("../src/callbacks");
const Discussion = require("../src/models/discussion");
const User = require("../src/models/user");

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
  assert.match(preview, /Completed 10 favorites \(Music\)/);
});

test("discussion preview includes selected top ten item", () => {
  const user = {
    discussionDraftTitle: "Dune fans",
    discussionDraftDescription: "",
    discussionDraftJoinRule: { type: "top_ten_item", section: "books", itemTitle: "Dune" },
    discussionDraftMaxMembers: 5,
  };
  const preview = buildDiscussionPreviewText(messages, "en", user);
  assert.match(preview, /🔑 📚 Books - Dune/);
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

  assert.match(text, /1\. 💬 Metal room/);
  assert.match(text, /👥 2\/20\n🏷 Music - 🤘 Metalhead 🔒/);
  assert.match(text, /📄 Heavy riffs only/);
  assert.doesNotMatch(text, /🔐 Join condition:/);
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

test("discussion discovery ranking favors relevant and fresh joinable rooms", async () => {
  const now = new Date("2026-06-21T12:00:00Z");
  const user = {
    userId: 1,
    discussionMembershipIds: [],
    savedProfileCodes: ["u_SAVED"],
  };
  const base = {
    status: "open",
    isJoinable: true,
    memberUserIds: [2],
    maxMembers: 20,
    lastActivityAt: new Date("2026-06-10T12:00:00Z"),
    updatedAt: new Date("2026-06-10T12:00:00Z"),
    createdAt: new Date("2026-06-10T12:00:00Z"),
  };
  const discussions = [
    { ...base, title: "Generic old", creatorUserId: 4, joinRule: { type: "open" } },
    { ...base, title: "Saved creator", creatorUserId: 9, joinRule: { type: "open" } },
    { ...base, title: "Fresh open", creatorUserId: 5, joinRule: { type: "open" }, createdAt: now, lastActivityAt: now },
    { ...base, title: "Taste room", creatorUserId: 6, joinRule: { type: "taste_label", section: "music", tasteLabelKey: "metalhead" } },
    { ...base, title: "Item room", creatorUserId: 7, joinRule: { type: "top_ten_item", section: "random", itemTitle: "Chess" } },
  ];

  const ranked = await rankDiscussionsForDiscovery(user, discussions, {
    now,
    savedCreatorUserIds: new Set([9]),
  });

  assert.deepEqual(ranked.map((entry) => entry.title), [
    "Item room",
    "Taste room",
    "Fresh open",
    "Saved creator",
    "Generic old",
  ]);
  assert.ok(
    getDiscussionDiscoveryScore(user, discussions[2], { now }) >
    getDiscussionDiscoveryScore(user, discussions[0], { now }),
  );
});

test("bot-created discussions use localized copy and only a bot emoji marker", () => {
  const discussion = {
    title: "Free Discussion",
    description: "A simple place to start chatting.",
    publicDiscussionCode: "d_BOT1",
    isBotCreated: true,
    botSeedKey: "free-discussion",
    isJoinable: true,
    memberUserIds: [],
    joinRule: { type: "open" },
  };
  const listText = buildDiscussionListText(messages, "en", "Active discussions", [discussion]);
  const previewText = buildDiscussionInvitePreviewText(messages, "en", discussion);
  const persianListText = buildDiscussionListText(messages, "fa", "گفت‌وگوهای فعال", [discussion]);
  const persianPreviewText = buildDiscussionInvitePreviewText(messages, "fa", discussion);

  assert.match(listText, /💬 👩‍🦳 Free Discussion/);
  assert.match(listText, /👥 0\/20\n🌍 Everyone ✅/);
  assert.match(listText, /A simple place to start chatting/);
  assert.match(previewText, /💬 👩‍🦳 Free Discussion/);
  assert.match(persianListText, /💬 .*👩‍🦳 گفت‌وگوی آزاد/);
  assert.match(persianListText, /یه جای ساده برای شروع گپ با بقیه/);
  assert.match(persianPreviewText, /💬 .*👩‍🦳 گفت‌وگوی آزاد/);
  assert.doesNotMatch(listText, /official/i);
});

test("metalhead starter discussion uses localized copy and metalhead badge rule", () => {
  const discussion = {
    title: "Metalheads",
    description: "Heavy riffs, loud albums, and metal recommendations.",
    publicDiscussionCode: "d_METAL",
    isBotCreated: true,
    botSeedKey: "metalheads",
    isJoinable: true,
    memberUserIds: [],
    joinRule: { type: "taste_label", section: "music", tasteLabelKey: "metalhead" },
  };
  const listText = buildDiscussionListText(messages, "en", "Active discussions", [discussion]);
  const persianListText = buildDiscussionListText(messages, "fa", "گفت‌وگوهای فعال", [discussion]);

  assert.match(listText, /💬 👩‍🦳 Metalheads/);
  assert.match(listText, /Heavy riffs, loud albums, and metal recommendations/);
  assert.match(listText, /🏷 Music - 🤘 Metalhead ✅/);
  assert.match(persianListText, /💬 .*👩‍🦳 متال‌هدها/);
  assert.match(persianListText, /ریف‌های سنگین/);
  assert.match(persianListText, /🤘/);
});

test("starter discussion list makes the first social step obvious", () => {
  const discussions = [
    {
      title: "Free Discussion",
      description: "A simple place to start chatting.",
      publicDiscussionCode: "d_BOT1",
      isBotCreated: true,
      botSeedKey: "free-discussion",
      isJoinable: true,
      memberUserIds: [],
      joinRule: { type: "open" },
    },
    {
      title: "Gaming Hangout",
      description: "A room for players.",
      publicDiscussionCode: "d_BOT2",
      isBotCreated: true,
      botSeedKey: "whats-up",
      isJoinable: true,
      memberUserIds: [],
      joinRule: {
        type: "top_ten_item",
        section: "random",
        itemTitle: "Gaming",
        itemAliases: ["Gaming", "Games", "Game", "گیم", "بازی"],
      },
    },
    {
      title: "Movie Chat",
      description: "Talk about films.",
      publicDiscussionCode: "d_BOT3",
      isBotCreated: true,
      botSeedKey: "lets-talk",
      isJoinable: false,
      memberUserIds: [],
      joinRule: {
        type: "top_ten_item",
        section: "random",
        itemTitle: "Movies",
        itemAliases: ["Movies", "Movie", "Film", "Films", "فیلم"],
      },
    },
  ];
  const text = buildDiscussionListText(messages, "en", "Active discussions", discussions);

  assert.match(text, /✨ Start here: open to everyone\./);
  assert.doesNotMatch(text, /Unlocked by your Interests/);
  assert.match(text, /💡 Add 🎬 Movies to your profile interests to unlock this room\./);
});

test("starter discussion item rules use Persian aliases in Persian UI", () => {
  const discussion = {
    title: "Gaming Hangout",
    description: "A room for players.",
    publicDiscussionCode: "d_BOT2",
    isBotCreated: true,
    botSeedKey: "whats-up",
    isJoinable: false,
    memberUserIds: [],
    joinRule: {
      type: "top_ten_item",
      section: "random",
      itemTitle: "Gaming",
      itemAliases: ["Gaming", "Games", "Game", "گیم", "بازی"],
    },
  };
  const listText = buildDiscussionListText(messages, "fa", "گفت‌وگوهای فعال", [discussion]);
  const lockedText = buildDiscussionInviteLockedText(
    messages,
    "fa",
    "requires_top_ten_item",
    discussion,
  );

  assert.match(listText, /🔑 .*گیم/);
  assert.match(listText, /برای باز شدن این گفت‌وگو، 🎮 گیم/);
  assert.match(lockedText, /«🎮 گیم»/);
  assert.doesNotMatch(lockedText, /Gaming/);
});

test("locked discussion list join text explains the exact unlock path", () => {
  const text = buildDiscussionJoinLockedText(messages, "fa", "requires_taste_label", {
    title: "Metalheads",
    joinRule: {
      type: "taste_label",
      section: "music",
      tasteLabelKey: "metalhead",
    },
  });

  assert.match(text, /موسیقی/);
  assert.match(text, /Metalhead|متال/);
  assert.match(text, /فیلم، موسیقی، کتاب ←/);
  assert.match(text, /۱۰ انتخاب محبوب/);
  assert.match(text, /لیست گفت‌وگوها/);
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

  assert.match(text, /6\. 💬 Page two item one/);
  assert.match(text, /7\. 💬 Page two item two/);
});

test("discussion list text uses Persian digits for fa numbering", () => {
  const text = buildDiscussionListText(messages, "fa", "گفت‌وگوها", [
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

test("my discussions empty state uses a tip and Got it acknowledgement", () => {
  const keyboard = discussionJoinErrorAckKeyboard("en", "discussions");
  const [button] = keyboard.reply_markup.inline_keyboard.flat();

  assert.match(messages.en.discussionListMineEmpty, /Active discussions/);
  assert.match(messages.en.discussionListMineEmpty, /create a new discussion/);
  assert.match(messages.en.discussionListMineEmptyAfterClose, /closed/);
  assert.match(messages.en.discussionListMineEmptyAfterClose, /My discussions now/);
  assert.equal(button.text, messages.en.acknowledgeButton);
  assert.equal(button.callback_data, `${callBacks.discussionJoinErrorAck}discussions`);
});

test("my discussions empty callback uses visible card without toast text", async () => {
  const originalUserFindOne = User.findOne;
  const originalDiscussionFind = Discussion.find;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const answerTexts = [];
  const rendered = [];

  User.findOne = () => ({
    select: () => ({
      lean: async () => ({
        activeDiscussionId: null,
        discussionMembershipIds: [],
      }),
    }),
  });
  Discussion.find = () => ({
    sort: () => ({
      limit: async () => [],
    }),
  });
  User.findOneAndUpdate = async () => ({});

  const ctx = {
    callbackMessageId: 42,
    userId: 1,
    user: { userId: 1 },
    answerCb: async (text) => {
      answerTexts.push(text);
      return true;
    },
  };

  try {
    await renderMyDiscussionList(ctx, "en", 0, {
      editCallbackMessageOrReply: async (_ctx, text, keyboard) => {
        rendered.push({ text, keyboard });
        return { message_id: 42 };
      },
    });

    assert.deepEqual(answerTexts, [undefined]);
    assert.equal(rendered[0].text, messages.en.discussionListMineEmpty);
    assert.equal(
      rendered[0].keyboard.reply_markup.inline_keyboard.flat()[0].callback_data,
      `${callBacks.discussionJoinErrorAck}discussions`,
    );
  } finally {
    User.findOne = originalUserFindOne;
    Discussion.find = originalDiscussionFind;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
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
  assert.equal(isDiscussionCreateCallback(callBacks.discussionCreateGuidanceAck), true);
  assert.equal(isDiscussionCreateFlowCallback(callBacks.discussionCreateGuidanceAck), true);
  assert.equal(isDiscussionCreateCallback(`${callBacks.discussionCreatePaidCapacityConfirm}2:3`), true);
  assert.equal(isDiscussionCreateFlowCallback(callBacks.discussionCreatePaidCapacityCancel), true);
  assert.equal(isDiscussionCreateFlowCallback(callBacks.discussionCreatePaidCapacityAck), true);
});

test("discussion creation language picker supports set and non-destructive back", () => {
  const keyboard = discussionCreateLanguagePickerKeyboard("en", "fa").reply_markup.inline_keyboard;
  assert.equal(keyboard[0][0].text, "✓ 🇮🇷 Persian");
  assert.equal(keyboard[0][0].callback_data, `${callBacks.discussionCreateSetLanguage}fa`);
  assert.equal(keyboard[1][0].callback_data, `${callBacks.discussionCreateSetLanguage}en`);
  assert.equal(keyboard[2][0].callback_data, callBacks.discussionCreateLanguageBack);
  assert.equal(keyboard.length, 3);
  assert.equal(isDiscussionCreateFlowCallback(`${callBacks.discussionCreateSetLanguage}en`), true);
  assert.equal(isDiscussionCreateFlowCallback(callBacks.discussionCreateLanguageBack), true);
});

test("discussion create guidance uses Got it acknowledgement and deletes on tap", async () => {
  const guidanceKeyboard = discussionCreateGuidanceAckKeyboard("en");
  assert.equal(
    guidanceKeyboard.reply_markup.inline_keyboard[0][0].text,
    messages.en.acknowledgeButton,
  );
  assert.equal(
    guidanceKeyboard.reply_markup.inline_keyboard[0][0].callback_data,
    callBacks.discussionCreateGuidanceAck,
  );

  const deletedIds = [];
  const renderedPrompts = [];
  const ctx = {
    callbackData: callBacks.discussionCreateGuidanceAck,
    callbackMessageId: 88,
    user: { state: "discussion_create_join_rule" },
    answerCb: async () => true,
  };

  await handleDiscussionCreateCallback(ctx, "en", {
    deleteCallbackMessageIfPossible: async (callbackCtx) => {
      deletedIds.push(callbackCtx.callbackMessageId);
      return true;
    },
    editCallbackMessageOrReply: async (_callbackCtx, text, keyboard) => {
      renderedPrompts.push({ text, keyboard });
      return true;
    },
  });

  assert.deepEqual(deletedIds, [88]);
  assert.deepEqual(renderedPrompts.map((entry) => entry.text), [messages.en.discussionJoinRulePrompt]);
});

test("discussion create start asks for profile name before title prompt", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const updates = [];
  const replies = [];
  const deletedIds = [];
  User.findOneAndUpdate = async (filter, update) => {
    updates.push({ filter, update });
    return {};
  };

  try {
    const ctx = {
      callbackData: callBacks.discussionCreateStart,
      callbackMessageId: 91,
      userId: 42,
      user: { userId: 42, profileName: "" },
      answerCb: async () => true,
      reply: async (text, keyboard) => {
        replies.push({ text, keyboard });
        return { message_id: 92 };
      },
    };

    await handleDiscussionCreateCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async (callbackCtx) => {
        deletedIds.push(callbackCtx.callbackMessageId);
        return true;
      },
      editCallbackMessageOrReply: async () => {
        throw new Error("create should not continue before name");
      },
    });

    assert.deepEqual(deletedIds, [91]);
    assert.match(replies[0].text, /Before creating or entering a discussion/);
    assert.ok(updates.some((entry) => entry.update.state === "discussion_name_required:create:start"));
    assert.ok(updates.some((entry) => entry.update.profileEditPromptMessageId === 92));
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("discussion name cancel returns create flow to discussions menu", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const calls = [];
  User.findOneAndUpdate = async () => ({});

  try {
    const ctx = {
      userId: 42,
      user: {
        state: "discussion_name_required:create:start",
        profileEditPromptMessageId: 93,
      },
      deleteMessage: async (messageId) => {
        calls.push(["delete", messageId]);
        return true;
      },
      reply: async (text, keyboard) => {
        calls.push(["reply", text, keyboard]);
        return true;
      },
    };

    await handleDiscussionNameCancel(ctx, "en");

    assert.equal(calls[0][0], "delete");
    assert.equal(calls[0][1], 93);
    assert.equal(calls[1][0], "reply");
    assert.equal(calls[1][1], messages.en.discussionsMenu);
    assert.equal(ctx.user.state, "idle");
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
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

test("discussion capacity picker marks paid capacities only when spending is available", () => {
  const originalSettings = { ...starEconomy };
  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: true,
    paidTwoPersonDiscussionsEnabled: true,
    paidLargeDiscussionsEnabled: true,
    paidLargeDiscussionCapacity: 50,
  });
  try {
    const keyboard = discussionCreateCapacityKeyboard("en", 20)?.reply_markup?.inline_keyboard || [];
    const labels = keyboard.flat().map((button) => button.text);
    assert.ok(labels.includes("\u200e2 ⭐"));
    assert.ok(labels.includes("\u200e50 ⭐"));
    assert.deepEqual(
      keyboard.slice(0, 2).map((row) => row.map((button) => button.callback_data)),
      [
        [
          `${callBacks.discussionCreateSetCapacity}2`,
          `${callBacks.discussionCreateSetCapacity}3`,
          `${callBacks.discussionCreateSetCapacity}4`,
          `${callBacks.discussionCreateSetCapacity}5`,
        ],
        [
          `${callBacks.discussionCreateSetCapacity}10`,
          `${callBacks.discussionCreateSetCapacity}15`,
          `${callBacks.discussionCreateSetCapacity}20`,
          `${callBacks.discussionCreateSetCapacity}50`,
        ],
      ],
    );

    starEconomy.spendingEnabled = false;
    const disabledLabels = (discussionCreateCapacityKeyboard("en", 20)?.reply_markup?.inline_keyboard || []).flat().map((button) => button.text);
    assert.equal(disabledLabels.includes("\u200e2 ⭐"), false);
    assert.equal(disabledLabels.includes("\u200e50 ⭐"), false);
  } finally {
    Object.assign(starEconomy, originalSettings);
  }
});

test("paid capacity create confirm opens payment confirmation and cancel returns preview", async () => {
  const originalSettings = { ...starEconomy };
  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: true,
    paidTwoPersonDiscussionsEnabled: true,
    paidTwoPersonDiscussionCost: 3,
  });
  const renders = [];
  const ctx = {
    callbackData: callBacks.discussionCreateConfirm,
    callbackMessageId: 44,
    userId: 10,
    user: {
      starBalance: 8,
      discussionDraftTitle: "Tiny room",
      discussionDraftDescription: "A focused room",
      discussionDraftJoinRule: { type: "open" },
      discussionDraftMaxMembers: 2,
    },
    answerCb: async () => true,
  };
  try {
    await handleDiscussionCreateCallback(ctx, "en", {
      editCallbackMessageOrReply: async (_ctx, text, keyboard) => {
        renders.push({ text, keyboard });
        return true;
      },
    });
    assert.match(renders[0].text, /costs 3 Stars/);
    assert.equal(
      renders[0].keyboard.reply_markup.inline_keyboard[0][0].callback_data,
      `${callBacks.discussionCreatePaidCapacityConfirm}2:3`,
    );

    ctx.callbackData = callBacks.discussionCreatePaidCapacityCancel;
    await handleDiscussionCreateCallback(ctx, "en", {
      editCallbackMessageOrReply: async (_ctx, text, keyboard) => {
        renders.push({ text, keyboard });
        return true;
      },
    });
    assert.match(renders[1].text, /Tiny room/);
    assert.equal(renders[1].keyboard.reply_markup.inline_keyboard[0][0].callback_data, callBacks.discussionCreateConfirm);
  } finally {
    Object.assign(starEconomy, originalSettings);
  }
});

test("discussion owner room keyboard shows boost only when boosts are available", () => {
  const originalSettings = {
    economyEnabled: starEconomy.economyEnabled,
    spendingEnabled: starEconomy.spendingEnabled,
    boostEnabled: starEconomy.boostEnabled,
  };
  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: true,
    boostEnabled: true,
  });
  try {
    const enabledLabels = (discussionRoomKeyboard("en", true)?.reply_markup?.keyboard || []).flat().map((button) => button.text);
    assert.ok(enabledLabels.includes(messages.en.discussionBoostButton));

    starEconomy.spendingEnabled = false;
    const disabledLabels = (discussionRoomKeyboard("en", true)?.reply_markup?.keyboard || []).flat().map((button) => button.text);
    assert.equal(disabledLabels.includes(messages.en.discussionBoostButton), false);
  } finally {
    Object.assign(starEconomy, originalSettings);
  }
});

test("discussion invite preview keyboard joins by public code", () => {
  const keyboard = discussionInvitePreviewKeyboard("en", "d_AB12");
  const buttons = keyboard?.reply_markup?.inline_keyboard.flat() || [];
  assert.ok(buttons.find((button) => button.callback_data === `${callBacks.discussionInviteJoin}d_AB12`));
});

test("discussion invite preview keyboard can switch from active room", () => {
  const keyboard = discussionInvitePreviewKeyboard("en", "d_AB12", { activeElsewhere: true });
  const buttons = keyboard?.reply_markup?.inline_keyboard.flat() || [];

  assert.ok(buttons.find((button) => button.callback_data === `${callBacks.discussionInviteSwitchJoin}d_AB12`));
  assert.ok(buttons.find((button) => button.callback_data === `${callBacks.discussionInviteCancel}d_AB12`));
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.discussionInviteJoin}d_AB12`), false);
});

test("locked discussion invite preview uses Got it dismissal", () => {
  const keyboard = discussionInvitePreviewKeyboard("en", "d_AB12", { cancelOnly: true });
  const button = keyboard?.reply_markup?.inline_keyboard.flat()[0];

  assert.equal(button.text, messages.en.acknowledgeButton);
  assert.equal(button.callback_data, `${callBacks.discussionInviteCancel}d_AB12`);
});

test("dismissing invite preview restores active discussion keyboard", async () => {
  const originalFindOne = Discussion.findOne;
  const originalFindById = Discussion.findById;
  const deleted = [];
  const replies = [];

  Discussion.findOne = () => Promise.resolve(null);
  Discussion.findById = () => ({
    lean: async () => ({
      _id: "active-room",
      title: "Movie Room",
      status: "open",
      creatorUserId: 7,
    }),
  });

  const ctx = {
    callbackData: `${callBacks.discussionInviteCancel}d_AB12`,
    callbackMessageId: 44,
    userId: 7,
    user: {
      userId: 7,
      lang: "en",
      activeDiscussionId: "active-room",
    },
    answerCb: async () => {},
    deleteMessage: async (messageId) => {
      deleted.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 90 + replies.length };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    Discussion.findOne = originalFindOne;
    Discussion.findById = originalFindById;
  }

  assert.deepEqual(deleted, [44]);
  assert.match(replies[0].text, /Movie Room/);
  const labels = (replies[0].extra.reply_markup.keyboard || []).flat().map((button) => button.text);
  assert.ok(labels.includes(messages.en.discussionLeave));
});

test("dismissing invite preview for current discussion stays quiet", async () => {
  const originalFindOne = Discussion.findOne;
  const originalFindById = Discussion.findById;
  const deleted = [];
  const replies = [];

  Discussion.findOne = () => Promise.resolve({
    _id: "active-room",
    publicDiscussionCode: "d_AB12",
  });
  Discussion.findById = () => {
    throw new Error("active room should not be restored for the same invite");
  };

  const ctx = {
    callbackData: `${callBacks.discussionInviteCancel}d_AB12`,
    callbackMessageId: 44,
    userId: 7,
    user: {
      userId: 7,
      lang: "en",
      activeDiscussionId: "active-room",
    },
    answerCb: async () => {},
    deleteMessage: async (messageId) => {
      deleted.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 90 + replies.length };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    Discussion.findOne = originalFindOne;
    Discussion.findById = originalFindById;
  }

  assert.deepEqual(deleted, [44]);
  assert.equal(replies.length, 0);
});

test("dismissing invite preview can offer optional taste setup when no room is active", async () => {
  const originalFindOneDiscussion = Discussion.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deleted = [];
  const replies = [];
  const updates = [];

  Discussion.findOne = () => Promise.resolve(null);
  User.findOneAndUpdate = async (filter, update) => {
    updates.push({ filter, update });
    return {};
  };

  const ctx = {
    callbackData: `${callBacks.discussionInviteCancel}d_AB12`,
    callbackMessageId: 44,
    userId: 7,
    user: {
      userId: 7,
      lang: "en",
      state: "idle",
      onboardingVersion: 0,
      activeDiscussionId: null,
    },
    answerCb: async () => {},
    deleteMessage: async (messageId) => {
      deleted.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 90 + replies.length };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    Discussion.findOne = originalFindOneDiscussion;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deleted, [44]);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /Want closer discussion matches/);
  const buttons = replies[0].extra.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.find((button) => button.callback_data === callBacks.onboardingTasteSetupStart));
  assert.ok(updates.some((entry) => entry.update.onboardingTasteSetupNudgedAt instanceof Date));
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
  assert.match(text, /Go to Me → Interests/);
  assert.match(text, /try this invite link again/);
  assert.doesNotMatch(text, /\{item\}/);
});

test("full discussion guidance keeps the existing acknowledgement recovery", () => {
  const keyboard = discussionJoinErrorAckKeyboard("fa", "active");
  const [button] = keyboard.reply_markup.inline_keyboard.flat();

  assert.match(messages.fa.discussionErrFull, /گفت‌وگوی خودت رو بسازی/);
  assert.match(messages.en.discussionErrFull, /create your own/);
  assert.equal(button.callback_data, `${callBacks.discussionJoinErrorAck}active`);
});
