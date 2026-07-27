const test = require("node:test");
const assert = require("node:assert/strict");
const { URL } = require("node:url");

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
  markCurrentProfileDiscussions,
  profileDiscussionsInlineKeyboard,
} = require("../src/flows/saved-profiles");
const {
  discussionListNavigationKeyboard,
  discussionRecentListKeyboard,
  discussionLanguagePickerKeyboard,
  discussionInvitePreviewKeyboard,
  discussionJoinErrorAckKeyboard,
  discussionJoinLockedKeyboard,
  discussionUnavailableAckKeyboard,
  discussionLeaveCurrentNoticeKeyboard,
  discussionRoomKeyboard,
  discussionMembersCloseKeyboard,
  discussionCloseConfirmKeyboard,
  discussionCreateCapacityKeyboard,
  discussionCreateLanguagePickerKeyboard,
  discussionTasteLabelsKeyboard,
  discussionExtraSlotConfirmKeyboard,
  discussionExtraSlotAckKeyboard,
} = require("../src/keyboards");
const { validateJoinRulePayload } = require("../src/services/discussion-join-rules");
const { callBacks } = require("../src/constants");
const { COPY_TEXT_LIMIT } = require("../src/services/share-actions");
const {
  addDiscussionFirstVisitTip,
  clearDiscussionMembersMessage,
  clearDiscussionListMessage,
  clearDiscussionMenuNotice,
  handleDiscussionListCallback,
  isDiscussionListCallback,
  renderActiveDiscussionList,
  renderMyDiscussionList,
  shouldKeepDiscussionRoomCardsForCallback,
  isDiscussionCreateFlowCallback,
  isDiscussionCreateEntryPaymentCallback,
} = require("../src/flows/discussions-callbacks");
const {
  buildDiscussionInviteSharePayload,
  removeDiscussionMemberCommand,
  showDiscussionInvitePreviewCommand,
} = require("../src/flows/discussions-text");
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

test("ordinary discussion cleanup forgets tracked list cards without Telegram operations", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const updates = [];
  User.findOneAndUpdate = async (_query, update) => {
    updates.push(update);
    return {};
  };
  const telegramOperations = [];
  const ctx = {
    userId: 7,
    user: {
      discussionLastMembersMessageId: 12,
      discussionMenuNoticeMessageId: 13,
      discussionLastListMessageId: 14,
      discussionLastListType: "active",
    },
    deleteMessage: async (id) => telegramOperations.push(["delete", id]),
    editMessageReplyMarkup: async (id) => telegramOperations.push(["edit", id]),
  };

  try {
    await clearDiscussionMembersMessage(ctx);
    await clearDiscussionMenuNotice(ctx);
    await clearDiscussionListMessage(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(telegramOperations, []);
  assert.equal(ctx.user.discussionLastMembersMessageId, null);
  assert.equal(ctx.user.discussionMenuNoticeMessageId, null);
  assert.equal(ctx.user.discussionLastListMessageId, null);
  assert.equal(ctx.user.discussionLastListType, "");
  assert.equal(updates.length, 4);
});

test("a current profile discussion is labeled in text and has no action button", async () => {
  const discussion = {
    _id: "current-room",
    publicDiscussionCode: "d_CURRENT",
    creatorUserId: 2,
    title: "Shared Room",
    description: "A room we are already in",
    memberUserIds: [1, 2],
    maxMembers: 20,
    joinRule: { type: "open" },
  };
  const [decorated] = markCurrentProfileDiscussions({
    userId: 1,
    activeDiscussionId: "current-room",
  }, [discussion]);

  assert.equal(decorated.listAction, "current");
  assert.equal(decorated.isCurrentForViewer, true);
  const text = buildDiscussionListText(messages, "en", "Discussions", [decorated], {
    includeActions: false,
  });
  assert.match(text, /🟢 Current discussion — Shared Room/);

  decorated.displayTitle = "Shared Room";
  const callbacks = profileDiscussionsInlineKeyboard("en", "u_A1", [decorated])
    .reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.deepEqual(callbacks, [
    `${callBacks.profileDiscussionsBack}u_A1`,
    callBacks.profileDiscussionsClose,
  ]);
});

test("profile discussions offer Join only for rooms whose rule the viewer satisfies", () => {
  const callbacks = profileDiscussionsInlineKeyboard("en", "u_A1", [
    {
      _id: "locked-room",
      title: "Locked room",
      displayTitle: "Locked room",
      isJoinable: false,
    },
    {
      _id: "open-room",
      title: "Open room",
      displayTitle: "Open room",
      isJoinable: true,
    },
  ]).reply_markup.inline_keyboard.flat().map((button) => button.callback_data);

  assert.deepEqual(callbacks, [
    `${callBacks.discussionOpen}open-room`,
    `${callBacks.profileDiscussionsBack}u_A1`,
    callBacks.profileDiscussionsClose,
  ]);
});

test("opening the current room from a member profile does not run join logic or redraw the room", async () => {
  const originalFindById = Discussion.findById;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deleted = [];
  let lookedUpDiscussion = false;
  Discussion.findById = async () => {
    lookedUpDiscussion = true;
    throw new Error("current room must bypass join/open lookup");
  };
  User.findOneAndUpdate = async () => ({});
  const ctx = {
    callbackData: `${callBacks.discussionOpen}current-room`,
    callbackMessageId: 77,
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      state: "idle",
      activeDiscussionId: "current-room",
      navigationMode: "profile_discussions:discussion_members:u_A1:0",
      publicProfileReturnNavigationMode: "discussions",
      discussionLastListMessageId: 77,
      discussionLastListType: "discussion_members:u_A1",
      publicProfileLastMessageId: 77,
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deleted.push(messageId);
      return true;
    },
    reply: async () => assert.fail("current room should not send a join/open acknowledgement or redraw"),
  };

  try {
    await handleCallback(ctx);
  } finally {
    Discussion.findById = originalFindById;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(lookedUpDiscussion, false);
  assert.deepEqual(deleted, [77]);
  assert.equal(ctx.user.navigationMode, "discussions");
  assert.equal(ctx.user.publicProfileReturnNavigationMode, "");
  assert.equal(ctx.user.discussionLastListMessageId, null);
});

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
    { ...base, title: "Media item room", creatorUserId: 8, joinRule: { type: "top_ten_item", section: "movies", itemTitle: "Arrival" } },
  ];

  const ranked = await rankDiscussionsForDiscovery(user, discussions, {
    now,
    savedCreatorUserIds: new Set([9]),
  });

  assert.deepEqual(ranked.map((entry) => entry.title), [
    "Media item room",
    "Taste room",
    "Item room",
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

test("starter discussion hints add personalized context without a static Start here line", () => {
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

  assert.doesNotMatch(text, /Start here|open to everyone/i);
  assert.match(text, /💡 This discussion matches one of your Interests: 🎮 Gaming\./);
  assert.match(text, /💡 Add 🎬 Movies to your profile interests to unlock this discussion\./);
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
  assert.match(text, /محبوب‌های من 🎬🎵📚 ←/);
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
  const moreButton = flatButtons.find((btn) => btn.text === `${messages.fa.discussionListMorePage} ➡️`);

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
  const allToggle = allButtons.find((btn) => btn.text.includes(messages.fa.discussionListOnlyJoinable));
  const joinableToggle = joinableButtons.find((btn) => btn.text.includes(messages.fa.discussionListShowAll));

  assert.equal(allToggle?.text, "🔓 فقط قابل ورودها");
  assert.equal(joinableToggle?.text, "🔓 نمایش همه");
  assert.equal(
    allButtons.at(-1)?.callback_data,
    callBacks.discussionListClose,
  );
  assert.equal(allButtons.at(-1)?.text, messages.fa.discussionShareClose);
});

test("non-empty My Discussions includes its width-friendly creator tip", () => {
  const text = buildDiscussionListText(messages, "en", messages.en.discussionMyList, [{
    title: "Hi",
    description: "Short",
    publicDiscussionCode: "d_SHORT1",
    memberUserIds: [1],
    joinRule: { type: "open" },
  }], {
    headerTip: messages.en.discussionMyListTip,
  });

  assert.ok(text.startsWith(`🗂 My discussions (1)\n${messages.en.discussionMyListTip}`));
  assert.match(messages.en.discussionMyListTipWithRecent, /button below/);
  assert.match(messages.fa.discussionMyListTipWithRecent, /دکمه‌ی پایین/);
  assert.match(messages.en.discussionRecentListTip, /recently joined/);
  assert.match(messages.fa.discussionRecentListTip, /تازگی/);
});

test("My Discussions navigation is inline and ends with Close", () => {
  const keyboard = discussionListNavigationKeyboard("en", {
    listType: "mine",
    page: 1,
    totalPages: 3,
  });
  const buttons = keyboard.reply_markup.inline_keyboard.flat();

  assert.equal(keyboard.reply_markup.keyboard, undefined);
  assert.equal(buttons.at(-1).text, messages.en.discussionShareClose);
  assert.equal(buttons.at(-1).callback_data, callBacks.discussionListClose);
});

test("My Discussions exposes recent history only when available and preserves its page", () => {
  const withoutHistory = discussionListNavigationKeyboard("en", {
    listType: "mine",
    page: 2,
    totalPages: 4,
  });
  assert.equal(withoutHistory.reply_markup.inline_keyboard.flat().some(
    (button) => button.callback_data?.startsWith(callBacks.discussionListRecent),
  ), false);

  const withHistory = discussionListNavigationKeyboard("en", {
    listType: "mine",
    page: 2,
    totalPages: 4,
    hasRecentDiscussions: true,
  });
  const recentButton = withHistory.reply_markup.inline_keyboard.flat().find(
    (button) => button.text === messages.en.discussionRecentListButton,
  );
  assert.equal(recentButton.callback_data, `${callBacks.discussionListRecent}2`);

  const recentKeyboard = discussionRecentListKeyboard("en", { backPage: 2 });
  const recentButtons = recentKeyboard.reply_markup.inline_keyboard.flat();
  assert.equal(recentButtons[0].callback_data, `${callBacks.discussionListRecentBack}2`);
  assert.equal(recentButtons.at(-1).callback_data, callBacks.discussionListClose);
  assert.equal(isDiscussionListCallback(`${callBacks.discussionListRecent}2`), true);
  assert.equal(shouldKeepDiscussionRoomCardsForCallback(`${callBacks.discussionListRecentBack}2`), true);
});

test("active discussion language picker is inline and disappears into the refreshed list", () => {
  const picker = discussionLanguagePickerKeyboard("en", {
    joinableOnly: true,
    languageFilter: "fa",
  });
  const buttons = picker.reply_markup.inline_keyboard.flat();

  assert.equal(picker.reply_markup.keyboard, undefined);
  assert.equal(
    buttons.find((button) => button.text.includes(messages.en.discussionLanguageEnglish)).callback_data,
    `${callBacks.discussionListLanguageSet}joinable:en`,
  );

  const refreshedList = discussionListNavigationKeyboard("en", {
    listType: "active",
    joinableOnly: true,
    languageFilter: "en",
  });
  assert.ok(refreshedList.reply_markup.inline_keyboard.flat().some(
    (button) => button.text === messages.en.discussionListLanguageFilterButton
      .replace("{language}", messages.en.discussionLanguageEnglish),
  ));
});

test("closing a discussion list card restores the Discussions reply keyboard mode", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const events = [];
  const ctx = {
    userId: 7,
    user: { navigationMode: "discussion_list:recent:0" },
    persistNavigationMode: true,
    callbackData: callBacks.discussionListClose,
    callbackMessageId: 42,
    answerCb: async () => events.push("answer"),
  };
  User.findOneAndUpdate = async () => ({});

  try {
    await handleDiscussionListCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async (callbackCtx) => {
        events.push(`delete:${callbackCtx.callbackMessageId}`);
        return true;
      },
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(events, ["answer", "delete:42"]);
  assert.equal(ctx.user.navigationMode, "discussions");
});

test("discussion members card has a Close-only inline action", () => {
  const keyboard = discussionMembersCloseKeyboard("en");
  const buttons = keyboard.reply_markup.inline_keyboard.flat();

  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].text, messages.en.discussionShareClose);
  assert.equal(buttons[0].callback_data, callBacks.discussionMembersClose);
  assert.equal(isDiscussionListCallback(callBacks.discussionMembersClose), true);
});

test("closing the discussion members card only deletes it and clears tracking", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const events = [];
  const ctx = {
    userId: 7,
    user: { discussionLastMembersMessageId: 52 },
    callbackData: callBacks.discussionMembersClose,
    callbackMessageId: 52,
    answerCb: async () => events.push("answer"),
  };
  User.findOneAndUpdate = async () => ({});

  try {
    await handleDiscussionListCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async (callbackCtx) => {
        events.push(`delete:${callbackCtx.callbackMessageId}`);
        return true;
      },
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(events, ["answer", "delete:52"]);
  assert.equal(ctx.user.discussionLastMembersMessageId, null);
});

test("join-error acknowledgement copy remains available for discussion recovery", () => {
  const keyboard = discussionJoinErrorAckKeyboard("en", "discussions");
  const [button] = keyboard.reply_markup.inline_keyboard.flat();

  assert.doesNotMatch(messages.en.discussionListMineEmpty, /Active discussions/);
  assert.match(messages.en.discussionListMineEmpty, /have not created/);
  assert.match(messages.en.discussionListMineEmpty, /Create a new discussion/);
  assert.match(messages.en.discussionListMineEmptyAfterClose, /closed/);
  assert.match(messages.en.discussionListMineEmptyAfterClose, /created discussions/);
  assert.equal(button.text, messages.en.acknowledgeButton);
  assert.equal(keyboard.reply_markup.keyboard, undefined);
});

test("locked-discussion Got it only closes the notice without redrawing its menu", async () => {
  const button = discussionJoinLockedKeyboard("en").reply_markup.inline_keyboard[0][0];
  assert.equal(button.text, messages.en.acknowledgeButton);
  assert.equal(button.callback_data, callBacks.discussionJoinLockedClose);

  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deleted = [];
  const replies = [];
  User.findOneAndUpdate = async () => ({});
  const ctx = {
    callbackData: callBacks.discussionJoinLockedClose,
    callbackMessageId: 42,
    userId: 1,
    user: { userId: 1, navigationMode: "discussion_list:active:0:1:all:en", discussionMenuNoticeMessageId: 42 },
    answerCb: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 90 + replies.length };
    },
  };

  try {
    await handleDiscussionListCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => {
        deleted.push(42);
        return true;
      },
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deleted, [42]);
  assert.equal(ctx.user.navigationMode, "discussion_list:active:0:1:all:en");
  assert.equal(ctx.user.discussionMenuNoticeMessageId, null);
  assert.deepEqual(replies, []);
});

test("unavailable-discussion Got it closes the notice and restores its stable keyboard", async () => {
  const keyboard = discussionUnavailableAckKeyboard("fa");
  const [button] = keyboard.reply_markup.inline_keyboard.flat();
  assert.equal(button.text, messages.fa.acknowledgeButton);
  assert.equal(button.callback_data, callBacks.discussionUnavailableClose);
  assert.equal(keyboard.reply_markup.keyboard, undefined);

  const deleted = [];
  const replies = [];
  const ctx = {
    callbackData: callBacks.discussionUnavailableClose,
    callbackMessageId: 52,
    userId: 1,
    user: {
      userId: 1,
      navigationMode: "discussion_list:active:0:1:all:fa",
      discussionMenuNoticeMessageId: 41,
    },
    answerCb: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 90 + replies.length };
    },
  };

  await handleDiscussionListCallback(ctx, "fa", {
    deleteCallbackMessageIfPossible: async () => {
      deleted.push(52);
      return true;
    },
  });

  assert.deepEqual(deleted, [52]);
  assert.equal(ctx.user.navigationMode, "discussion_list:active:0:1:all:fa");
  assert.equal(ctx.user.discussionMenuNoticeMessageId, 41);
  assert.equal(replies[0].text, messages.fa.discussionsMenu);
  assert.equal(replies[0].extra.reply_markup.is_persistent, true);
});

test("leave-current warning uses one inline leave-and-join action without a reply keyboard", () => {
  const keyboard = discussionLeaveCurrentNoticeKeyboard("fa", "d_ROOM1");
  const [button] = keyboard.reply_markup.inline_keyboard.flat();
  assert.equal(button.text, messages.fa.discussionInviteSwitchJoinButton);
  assert.equal(button.callback_data, `${callBacks.discussionInviteSwitchJoin}d_ROOM1`);
  assert.equal(keyboard.reply_markup.keyboard, undefined);
  assert.match(messages.fa.discussionErrLeaveCurrentFirst, /برای ورود به یه گفت‌وگوی جدید/);
});

test("owner join notification shows leave-current warning instead of an invitation preview", async () => {
  const originalFindOne = Discussion.findOne;
  const edits = [];
  Discussion.findOne = async () => ({
    _id: "notified-room",
    publicDiscussionCode: "d_NOTICE1",
    title: "Notified room",
    status: "open",
    creatorUserId: 7,
  });
  const ctx = {
    callbackData: `${callBacks.discussionOwnerJoinNoticeOpen}d_NOTICE1`,
    callbackMessageId: 44,
    userId: 7,
    user: { userId: 7, lang: "en", activeDiscussionId: "current-room" },
    answerCb: async () => {},
    editMessageText: async (messageId, text, keyboard) => {
      edits.push({ messageId, text, keyboard });
      return { message_id: messageId };
    },
    reply: async () => {
      throw new Error("notification warning should edit the existing card");
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    Discussion.findOne = originalFindOne;
  }

  assert.equal(edits.length, 1);
  assert.equal(edits[0].text, messages.en.discussionErrLeaveCurrentFirst);
  assert.doesNotMatch(edits[0].text, /Invitation preview/i);
  const buttons = edits[0].keyboard.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.length, 1);
  assert.equal(
    buttons[0].callback_data,
    `${callBacks.discussionInviteSwitchJoin}d_NOTICE1`,
  );
});

test("discussion list title shows the full filtered count", () => {
  const text = buildDiscussionListText(messages, "en", "Active discussions", [{
    title: "One room",
    description: "Test",
    memberUserIds: [1],
    maxMembers: 20,
    joinRule: { type: "open" },
    isJoinable: true,
  }], { totalCount: 8 });

  assert.match(text, /^Active discussions \(8\)/);
});

test("discussion first-visit guidance is compact, bilingual, and part of the list response", () => {
  for (const lang of ["fa", "en"]) {
    const list = buildDiscussionListText(messages, lang, messages[lang].discussionActiveList, [{
      title: "Room",
      description: "Test",
      memberUserIds: [],
      maxMembers: 20,
      joinRule: { type: "open" },
      isJoinable: true,
    }]);
    const tipped = addDiscussionFirstVisitTip(lang, list, true);

    assert.equal(tipped, `${messages[lang].discussionActiveListFirstVisitTip}\n\n${list}`);
    assert.equal(addDiscussionFirstVisitTip(lang, list, false), list);
    assert.match(messages[lang].discussionActiveListFirstVisitTip, /^💡/);
    assert.match(messages[lang].discussionActiveListFirstVisitTip, lang === "fa" ? /مرتب/ : /ranked/);
  }
});

test("Active Discussions keeps an accurate direct-entry tip after first visit", () => {
  for (const lang of ["fa", "en"]) {
    const text = buildDiscussionListText(messages, lang, messages[lang].discussionActiveList, [{
      title: "Room",
      description: "Test",
      memberUserIds: [],
      maxMembers: 20,
      joinRule: { type: "open" },
      isJoinable: true,
    }], { headerTip: messages[lang].discussionActiveListTip });

    assert.match(text, lang === "fa" ? /با دستور «ورود»/ : /Join command/);
    assert.match(text, lang === "fa" ? /چی لازمه/ : /what is needed/);
    assert.doesNotMatch(text, lang === "fa" ? /پیش‌نمایش/ : /preview/);
    assert.match(messages[lang].discussionActiveListTip, /^💡/);
    assert.match(messages[lang].discussionActiveListTip, lang === "fa" ? /می‌تونی/ : /You can/);
  }
});

test("failed Active Discussions delivery does not mark its first-visit tip", async () => {
  const originalUserFindOne = User.findOne;
  const originalDiscussionFind = Discussion.find;
  User.findOne = () => ({
    select: () => ({ lean: async () => ({ discussionMembershipIds: [] }) }),
  });
  Discussion.find = () => ({
    sort: () => ({ limit: async () => [] }),
  });
  const ctx = {
    userId: 1,
    user: { userId: 1 },
    answerCb: async () => true,
    reply: async () => ({ message_id: 1 }),
  };

  try {
    await assert.rejects(
      renderActiveDiscussionList(ctx, "en", 0, false, "en", {
        freshDestination: true,
        editCallbackMessageOrReply: async () => {
          throw new Error("delivery failed");
        },
      }),
      /delivery failed/,
    );
  } finally {
    User.findOne = originalUserFindOne;
    Discussion.find = originalDiscussionFind;
  }

  assert.equal(ctx.user.sectionTipsShownAt, undefined);
});

test("my discussions empty callback offers normal discussion navigation without toast text", async () => {
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
    const buttons = rendered[0].keyboard.reply_markup.inline_keyboard.flat();
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].text, messages.en.discussionShareClose);
    assert.equal(buttons[0].callback_data, callBacks.discussionListClose);
  } finally {
    User.findOne = originalUserFindOne;
    Discussion.find = originalDiscussionFind;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("empty My Discussions mentions recent history only when its button is available", () => {
  assert.match(messages.en.discussionListMineEmptyWithRecent, /button below/);
  assert.match(messages.fa.discussionListMineEmptyWithRecent, /دکمه‌ی پایین/);
  assert.doesNotMatch(messages.en.discussionListMineEmpty, /button below/);
  assert.doesNotMatch(messages.fa.discussionListMineEmpty, /دکمه‌ی پایین/);
});

test("acknowledging an empty discussion list enters Discussions with a footprint", async () => {
  const replies = [];
  const deletedIds = [];
  const ctx = {
    callbackData: `${callBacks.discussionJoinErrorAck}discussions`,
    callbackMessageId: 42,
    user: { userId: 1 },
    userId: 1,
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, keyboard) => {
      replies.push({ text, keyboard });
      return { message_id: replies.length };
    },
  };

  await handleDiscussionListCallback(ctx, "en", {
    deleteCallbackMessageIfPossible: (callbackCtx) => callbackCtx.deleteMessage(callbackCtx.callbackMessageId),
  });

  assert.deepEqual(deletedIds, [42]);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.en.discussionsMenu);
});

test("discussion join error acknowledgement can return to saved profile discussions", async () => {
  const keyboard = discussionJoinErrorAckKeyboard("en", "saved:u_a1");
  const button = keyboard.reply_markup.inline_keyboard.flat()[0];
  assert.equal(button.text, messages.en.acknowledgeButton);

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
  assert.equal(isDiscussionCreateCallback(`${callBacks.discussionCreateExtraSlotConfirm}5`), true);
  assert.equal(isDiscussionCreateFlowCallback(callBacks.discussionCreateExtraSlotCancel), true);
  assert.equal(isDiscussionCreateFlowCallback(callBacks.discussionCreateExtraSlotAck), true);
  assert.equal(isDiscussionCreateEntryPaymentCallback(`${callBacks.discussionCreateExtraSlotConfirm}5`), true);
  assert.equal(isDiscussionCreateEntryPaymentCallback(callBacks.discussionCreateExtraSlotCancel), true);
  assert.equal(isDiscussionCreateEntryPaymentCallback(callBacks.discussionCreateExtraSlotAck), true);
  assert.equal(isDiscussionCreateEntryPaymentCallback(callBacks.discussionCreateConfirm), false);
});

test("extra discussion payment uses inline confirmation and acknowledgement cards", () => {
  const confirmation = discussionExtraSlotConfirmKeyboard("en", 5).reply_markup.inline_keyboard.flat();
  assert.equal(confirmation[0].text, messages.en.discussionExtraSlotConfirmButton.replace("{cost}", "5"));
  assert.equal(confirmation[0].callback_data, `${callBacks.discussionCreateExtraSlotConfirm}5`);
  assert.equal(confirmation[1].callback_data, callBacks.discussionCreateExtraSlotCancel);

  const acknowledgement = discussionExtraSlotAckKeyboard("en").reply_markup.inline_keyboard.flat();
  assert.equal(acknowledgement.length, 1);
  assert.equal(acknowledgement[0].text, messages.en.acknowledgeButton);
  assert.equal(acknowledgement[0].callback_data, callBacks.discussionCreateExtraSlotAck);
});

test("extra discussion payment callbacks remain valid while the create wizard is idle", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const answers = [];
  const deleted = [];
  User.findOneAndUpdate = async () => ({});
  try {
    await handleCallback({
      callbackData: callBacks.discussionCreateExtraSlotCancel,
      callbackMessageId: 77,
      userId: 42,
      user: { userId: 42, lang: "en", state: "idle", navigationMode: "discussions" },
      answerCb: async (...args) => answers.push(args),
      deleteMessage: async (messageId) => deleted.push(messageId),
    });

    assert.deepEqual(answers, [[]]);
    assert.deepEqual(deleted, [77]);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("discussion creation language picker supports set and non-destructive back", () => {
  const keyboard = discussionCreateLanguagePickerKeyboard("en", "fa").reply_markup.keyboard;
  assert.equal(keyboard[0][0].text, "✓ 🇮🇷 Persian");
  assert.equal(keyboard[1][0].text, "🇬🇧 English");
  assert.equal(keyboard[2][0].text, messages.en.discussionBack);
  assert.equal(keyboard.length, 3);
  assert.equal(isDiscussionCreateFlowCallback(`${callBacks.discussionCreateSetLanguage}en`), true);
  assert.equal(isDiscussionCreateFlowCallback(callBacks.discussionCreateLanguageBack), true);
});

test("taste-label discussion rules show earned media labels directly", () => {
  const keyboard = discussionTasteLabelsKeyboard("en", [
    { section: "movies", labelKey: "cinephile" },
    { section: "books", labelKey: "novel_reader" },
  ]);
  const buttons = keyboard.reply_markup.keyboard.flat();

  assert.equal(buttons[0].text, "🎬 Movies & Series · 🎞️ Cinephile");
  assert.equal(buttons[1].text, "📚 Books · 📖 Novel Reader");
  assert.ok(!buttons.some((button) => button.text === messages.en.aiSuggestRandom));
  assert.equal(validateJoinRulePayload({
    type: "taste_label",
    section: "random",
    tasteLabelKey: "gamer",
  }).reason, "invalid_section");
});

test("choosing a taste-label join rule skips the section picker", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const cards = [];
  User.findOneAndUpdate = async () => ({});

  try {
    const ctx = {
      callbackData: callBacks.discussionCreateRuleTaste,
      callbackMessageId: 88,
      userId: 10,
      user: {
        state: "discussion_create_join_rule",
        lang: "en",
        aiTaste: {
          movies: { labelKey: "cinephile" },
          books: { labelKey: "novel_reader" },
        },
      },
      answerCb: async () => true,
      reply: async () => {
        throw new Error("earned labels should replace the current wizard card");
      },
    };
    await handleDiscussionCreateCallback(ctx, "en", {
      editCallbackMessageOrReply: async (_ctx, text, keyboard) => cards.push({ text, keyboard }),
    });

    assert.equal(cards.length, 1);
    assert.equal(cards[0].text, messages.en.discussionChooseTasteLabel);
    assert.deepEqual(
      cards[0].keyboard.reply_markup.keyboard.slice(0, 2).flat().map((button) => button.text),
      ["🎬 Movies & Series · 🎞️ Cinephile", "📚 Books · 📖 Novel Reader"],
    );
    assert.equal(ctx.user.discussionDraftJoinRule.type, "taste_label");
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("discussion create guidance has no inline acknowledgement and restores join-rule buttons", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  User.findOneAndUpdate = async () => ({});

  try {
    for (const [callbackData, expectedText] of [
      [callBacks.discussionCreateRuleTaste, "don't have any taste labels yet"],
      [callBacks.discussionCreateRuleItem, "don't have any items available for a join condition yet"],
    ]) {
      const replies = [];
      const ctx = {
        callbackData,
        callbackMessageId: 88,
        userId: 10,
        user: { state: "discussion_create_join_rule", lang: "en", aiTaste: {}, aiLists: {} },
        answerCb: async () => true,
        reply: async (text, keyboard) => {
          replies.push({ text, keyboard });
          return { message_id: 89 };
        },
      };
      await handleDiscussionCreateCallback(ctx, "en", {
        editCallbackMessageOrReply: async () => {
          throw new Error("guidance should be a normal reply");
        },
      });

      assert.equal(replies.length, 1);
      assert.ok(replies[0].text.includes(expectedText));
      assert.ok(replies[0].text.includes(messages.en.discussionJoinRulePrompt));
      assert.equal(replies[0].keyboard.reply_markup.inline_keyboard, undefined);
      assert.ok(replies[0].keyboard.reply_markup.keyboard.flat().some(
        (button) => button.text === messages.en.discussionJoinRuleOpen,
      ));
    }
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
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

    assert.deepEqual(deletedIds, []);
    assert.match(replies[0].text, /Before creating or entering a discussion/);
    assert.ok(updates.some((entry) => entry.update.state === "discussion_name_required:create:start"));
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
    const keyboard = discussionCreateCapacityKeyboard("en", 20)?.reply_markup?.keyboard || [];
    const labels = keyboard.flat().map((button) => button.text);
    assert.ok(labels.includes("\u200e2 ⭐"));
    assert.ok(labels.includes("\u200e50 ⭐"));
    assert.equal(keyboard.slice(0, 2).flat().length, 8);

    starEconomy.spendingEnabled = false;
    const disabledLabels = (discussionCreateCapacityKeyboard("en", 20)?.reply_markup?.keyboard || []).flat().map((button) => button.text);
    assert.equal(disabledLabels.includes("\u200e2 ⭐"), false);
    assert.equal(disabledLabels.includes("\u200e50 ⭐"), false);
  } finally {
    Object.assign(starEconomy, originalSettings);
  }
});

test("the visible remove command asks for confirmation without removing immediately", async () => {
  const originalFindOne = User.findOne;
  const replies = [];
  User.findOne = () => ({
    select: () => ({
      lean: async () => ({ userId: 8, profileName: "Taha", firstName: "Taha" }),
    }),
  });
  const ctx = {
    userId: 7,
    user: { userId: 7, activeDiscussionId: "room-1" },
    reply: async (text, keyboard) => {
      replies.push({ text, keyboard });
      return { message_id: 61 };
    },
  };

  try {
    await removeDiscussionMemberCommand(ctx, "en", "/remove_ABC123");
  } finally {
    User.findOne = originalFindOne;
  }

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /Taha/);
  assert.doesNotMatch(replies[0].text, /was removed/);
  const buttons = replies[0].keyboard.reply_markup.inline_keyboard.flat();
  assert.equal(buttons[0].callback_data, `${callBacks.discussionRemoveMemberConfirm}room-1:u_ABC123`);
  assert.equal(buttons[1].callback_data, callBacks.discussionRemoveMemberCancel);
});

test("canceling member removal deletes only the confirmation card", async () => {
  const events = [];
  const ctx = {
    callbackData: callBacks.discussionRemoveMemberCancel,
    callbackMessageId: 72,
    userId: 7,
    user: { userId: 7, lang: "en", activeDiscussionId: "room-1" },
    answerCb: async () => events.push("answer"),
    deleteMessage: async (messageId) => {
      events.push(`delete:${messageId}`);
      return true;
    },
    reply: async () => {
      throw new Error("cancel should not open a picker or send another card");
    },
  };

  await handleCallback(ctx);
  assert.deepEqual(events, ["answer", "delete:72"]);
});

test("discussion close confirmation actions are inline", () => {
  const confirmation = discussionCloseConfirmKeyboard("en", "room-1", "mine");
  const confirmButtons = confirmation.reply_markup.inline_keyboard.flat();

  assert.equal(confirmation.reply_markup.keyboard, undefined);
  assert.deepEqual(confirmButtons.map((button) => button.callback_data), [
    `${callBacks.discussionCloseConfirm}room-1:mine`,
    `${callBacks.discussionCloseCancel}room-1:mine`,
  ]);
});

test("canceling a discussion draft edit quietly restores preview", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const rendered = [];
  User.findOneAndUpdate = async () => ({});

  try {
    const ctx = {
      callbackData: callBacks.discussionCreateCancelEdit,
      userId: 42,
      user: {
        userId: 42,
        lang: "en",
        state: "discussion_create_title_edit",
        discussionDraftTitle: "Open cafe",
        discussionDraftDescription: "A room",
        discussionDraftJoinRule: { type: "open" },
      },
      answerCb: async () => true,
      reply: async (text, keyboard) => {
        replies.push({ text, keyboard });
        return true;
      },
    };

    await handleDiscussionCreateCallback(ctx, "en", {
      editCallbackMessageOrReply: async (_callbackCtx, text, keyboard) => {
        rendered.push({ text, keyboard });
        return true;
      },
      deleteCallbackMessageIfPossible: async () => true,
      clearDiscussionMenuNotice: async () => true,
      rememberDiscussionMenuNotice: async () => true,
      sendDiscussionRoom: async () => true,
    });

    assert.equal(replies.length, 0);
    assert.equal(rendered.length, 1);
    assert.match(rendered[0].text, /Open cafe/);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
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
      renders[0].keyboard.reply_markup.keyboard[0][0].text,
      messages.en.discussionPaidCapacityConfirmButton.replace("{cost}", "3"),
    );

    ctx.callbackData = callBacks.discussionCreatePaidCapacityCancel;
    await handleDiscussionCreateCallback(ctx, "en", {
      editCallbackMessageOrReply: async (_ctx, text, keyboard) => {
        renders.push({ text, keyboard });
        return true;
      },
    });
    assert.match(renders[1].text, /Tiny room/);
    assert.equal(renders[1].keyboard.reply_markup.keyboard[0][0].text, messages.en.discussionCreateConfirm);
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
  const close = buttons.find((button) => button.callback_data === `${callBacks.discussionInviteCancel}d_AB12`);
  assert.equal(close?.text, messages.en.discussionShareClose);
  assert.equal(buttons.some((button) => button.callback_data === callBacks.discussions), false);
});

test("discussion invite preview keyboard can switch from active room", () => {
  const keyboard = discussionInvitePreviewKeyboard("en", "d_AB12", { activeElsewhere: true });
  const buttons = keyboard?.reply_markup?.inline_keyboard.flat() || [];

  assert.ok(buttons.find((button) => button.callback_data === `${callBacks.discussionInviteSwitchJoin}d_AB12`));
  assert.equal(
    buttons.find((button) => button.callback_data === `${callBacks.discussionInviteCancel}d_AB12`)?.text,
    messages.en.discussionShareClose,
  );
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.discussionInviteJoin}d_AB12`), false);
});

test("locked discussion invite preview uses a Close dismissal", () => {
  const keyboard = discussionInvitePreviewKeyboard("en", "d_AB12", { cancelOnly: true });
  const button = keyboard?.reply_markup?.inline_keyboard.flat()[0];

  assert.equal(button.text, messages.en.discussionShareClose);
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
  const buttons = replies[0].extra.reply_markup.keyboard.flat();
  assert.ok(buttons.find((button) => button.text === messages.en.onboardingTasteSetupStartButton));
  assert.ok(updates.some((entry) => entry.update.onboardingTasteSetupNudgedAt instanceof Date));
});

test("dismissing an invite from Home restores the persistent Home keyboard", async () => {
  const originalFindOneDiscussion = Discussion.findOne;
  const deleted = [];
  const replies = [];
  Discussion.findOne = () => Promise.resolve(null);

  const ctx = {
    callbackData: `${callBacks.discussionInviteCancel}d_AB12`,
    callbackMessageId: 44,
    userId: 7,
    user: {
      userId: 7,
      lang: "en",
      state: "idle",
      navigationMode: "global",
      onboardingVersion: 1,
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
  }

  assert.deepEqual(deleted, [44]);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.en.mainMenu);
  assert.equal(replies[0].extra.reply_markup.is_persistent, true);
  assert.equal(ctx.user.navigationMode, "global");
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

test("invite preview does not offer Join when an inactive user fails the room rule", async () => {
  const originalFindOne = Discussion.findOne;
  const replies = [];
  Discussion.findOne = async () => ({
    _id: "room-1",
    publicDiscussionCode: "d_AB12",
    title: "Movie room",
    description: "Film chat",
    status: "open",
    creatorUserId: 99,
    memberUserIds: [99],
    removedUserIds: [],
    maxMembers: 100,
    joinRule: { type: "top_ten_item", section: "movies", itemTitle: "Arrival" },
  });
  const ctx = {
    userId: 7,
    user: { userId: 7, activeDiscussionId: null, moviesTopTen: [] },
    reply: async (text, keyboard) => {
      replies.push({ text, keyboard });
      return true;
    },
  };

  try {
    await showDiscussionInvitePreviewCommand(ctx, "en", "d_AB12");
  } finally {
    Discussion.findOne = originalFindOne;
  }

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /Arrival/);
  const buttons = replies[0].keyboard.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.discussionInviteJoin}d_AB12`), false);
  assert.equal(buttons[0].text, messages.en.discussionShareClose);
  assert.equal(buttons[0].callback_data, `${callBacks.discussionInviteCancel}d_AB12`);
});

test("an unavailable invite preserves the current reply keyboard and navigation", async () => {
  const originalFindOne = Discussion.findOne;
  const replies = [];
  Discussion.findOne = async () => null;
  const ctx = {
    userId: 7,
    user: {
      userId: 7,
      navigationMode: "discussion_list:active:0:1:all:fa",
    },
    reply: async (text, keyboard) => {
      replies.push({ text, keyboard });
      return true;
    },
  };

  try {
    await showDiscussionInvitePreviewCommand(ctx, "fa", "d_GONE", {
      onAvailable: async () => assert.fail("unavailable invites must not reset flow state"),
    });
  } finally {
    Discussion.findOne = originalFindOne;
  }

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.fa.discussionInviteUnavailable);
  assert.equal(replies[0].keyboard.reply_markup.remove_keyboard, undefined);
  assert.equal(replies[0].keyboard.reply_markup.keyboard, undefined);
  assert.equal(
    replies[0].keyboard.reply_markup.inline_keyboard[0][0].callback_data,
    callBacks.discussionUnavailableClose,
  );
  assert.equal(ctx.user.navigationMode, "discussion_list:active:0:1:all:fa");
});

test("discussion invite Forward and Copy carry the same complete invitation", () => {
  const discussion = {
    title: "Movie night",
    description: "Pick a favorite scene",
    language: "en",
    joinRule: { type: "open" },
  };
  const link = "https://t.me/MuzeBot?start=ref_ABC123";
  const payload = buildDiscussionInviteSharePayload("en", discussion, "d_AB12", link);
  const forward = new URL(payload.shareUrl);

  assert.equal(forward.searchParams.get("url"), link);
  assert.equal(payload.copyText, `${forward.searchParams.get("text")}\n\n${link}`);
  assert.match(payload.copyText, /Movie night/);
  assert.match(payload.copyText, /Join condition:/);

  const longPayload = buildDiscussionInviteSharePayload("en", {
    ...discussion,
    title: "A".repeat(80),
    description: "B".repeat(300),
  }, "d_AB12", link);
  assert.ok(Array.from(longPayload.copyText).length <= COPY_TEXT_LIMIT);
  assert.equal(new URL(longPayload.shareUrl).searchParams.get("text"), longPayload.copyText.split(`\n\n${link}`)[0]);
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
  assert.equal(button.text, messages.fa.acknowledgeButton);
  assert.equal(keyboard.reply_markup.keyboard, undefined);
});

test("closing invitations opened from Home restores the Home reply keyboard mode", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const events = [];
  const ctx = {
    userId: 7,
    user: {
      navigationMode: "discussion_invitations:0:1",
      discussionListReturnNavigationMode: "global",
    },
    persistNavigationMode: true,
    callbackData: callBacks.discussionListClose,
    callbackMessageId: 43,
    answerCb: async () => events.push("answer"),
  };
  User.findOneAndUpdate = async () => ({});

  try {
    await handleDiscussionListCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async (callbackCtx) => {
        events.push(`delete:${callbackCtx.callbackMessageId}`);
        return true;
      },
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(events, ["answer", "delete:43"]);
  assert.equal(ctx.user.navigationMode, "global");
  assert.equal(ctx.user.discussionListReturnNavigationMode, "");
});

test("closing invitations opened from Discussions restores Discussions mode", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const ctx = {
    userId: 7,
    user: {
      navigationMode: "discussion_invitations:0:1",
      discussionListReturnNavigationMode: "discussions",
    },
    persistNavigationMode: true,
    callbackData: callBacks.discussionListClose,
    callbackMessageId: 44,
    answerCb: async () => null,
  };
  User.findOneAndUpdate = async () => ({});

  try {
    await handleDiscussionListCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => true,
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(ctx.user.navigationMode, "discussions");
  assert.equal(ctx.user.discussionListReturnNavigationMode, "");
});
