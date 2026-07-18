const test = require("node:test");
const assert = require("node:assert/strict");
const messages = require("../src/messages");
const { discussionsMenuKeyboard, peopleHubKeyboard } = require("../src/keyboards");
const { callBacks } = require("../src/constants");

const {
  normalizePublicProfileCode,
  normalizePublicDiscussionCode,
  validateJoinRulePayload,
  validateJoinRules,
  joinOrOpenDiscussion,
  hasLink,
  validateDiscussionDescription,
  validateDiscussionTitle,
  normalizeMaxMembers,
  resolveDiscussionMaxMembers,
  DISCUSSION_MEMBER_CAP,
  DISCUSSION_ALLOWED_MEMBER_CAPS,
  DISCUSSION_RECENT_MESSAGES_CAP,
  DISCUSSION_MESSAGE_BURST_WINDOW_MS,
  BOT_STARTER_DISCUSSIONS,
  seedBotDiscussions,
  sortBotStarterDiscussionsFirst,
} = require("../src/services/discussions");
const {
  buildDiscussionOpenNameGate,
  getDiscussionOpenCodeFromNameState,
  handleDiscussionNameCancel,
  hasValidDiscussionProfileName,
  isDiscussionNameCancelText,
  parseDiscussionNameState,
  requireDiscussionProfileName,
} = require("../src/flows/discussion-name-gate");
const Discussion = require("../src/models/discussion");
const User = require("../src/models/user");
const { starEconomy } = require("../src/services/star-settings");
const {
  getPaidDiscussionCapacity,
  getSelectableDiscussionCapacities,
} = require("../src/services/discussion-capacities");
const {
  enterDiscussionsAfterRoomExit,
  handleDiscussionBottomButton,
} = require("../src/flows/discussions-text");

test("discussion caps match MVP defaults", () => {
  assert.equal(DISCUSSION_MEMBER_CAP, 20);
  assert.deepEqual(DISCUSSION_ALLOWED_MEMBER_CAPS, [2, 3, 4, 5, 10, 15, 20]);
  assert.equal(DISCUSSION_RECENT_MESSAGES_CAP, 10);
  assert.equal(DISCUSSION_MESSAGE_BURST_WINDOW_MS, 1000);
});

test("leaving a room sends confirmation and Discussions menu as separate messages", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  User.findOneAndUpdate = async () => ({});
  try {
    const ctx = {
      userId: 42,
      user: { userId: 42 },
      reply: async (text, keyboard) => {
        replies.push({ text, keyboard });
        return { message_id: replies.length };
      },
    };
    await enterDiscussionsAfterRoomExit(ctx, "fa", {
      ok: true,
      discussion: { title: "گفت‌وگوی فیلم" },
    });

    assert.equal(replies.length, 2);
    assert.equal(replies[0].text, messages.fa.discussionLeft.replace("{title}", "گفت‌وگوی فیلم"));
    assert.equal(replies[0].keyboard.reply_markup.remove_keyboard, true);
    assert.equal(replies[1].text, messages.fa.discussionsMenu);
    assert.ok(replies[1].keyboard.reply_markup.keyboard.length > 1);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("room Close opens an inline confirmation without entering text-confirm state", async () => {
  const replies = [];
  const ctx = {
    userId: 42,
    user: { userId: 42, activeDiscussionId: "room-1", state: "idle" },
    text: messages.en.discussionCloseButton,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 91 };
    },
  };

  await handleDiscussionBottomButton(ctx, "en", messages.en.discussionCloseButton);

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.en.discussionCloseConfirmPrompt);
  assert.equal(replies[0].extra.reply_markup.keyboard, undefined);
  assert.equal(
    replies[0].extra.reply_markup.inline_keyboard[0][0].callback_data,
    `${require("../src/constants").callBacks.discussionCloseConfirm}room-1:room`,
  );
  assert.equal(ctx.user.state, "idle");
});

test("full discussion blocks invite options with a dismiss-only Got it notice", async () => {
  const originalUserFindOne = User.findOne;
  const originalDiscussionFindById = Discussion.findById;
  const replies = [];
  User.findOne = async () => ({ userId: 42 });
  Discussion.findById = async () => ({
    _id: "507f1f77bcf86cd799439011",
    status: "open",
    memberUserIds: [42, 43],
    maxMembers: 2,
    publicDiscussionCode: "d_ROOM1",
  });

  try {
    const ctx = {
      userId: 42,
      user: { userId: 42, activeDiscussionId: "507f1f77bcf86cd799439011", savedProfileCodes: [] },
      reply: async (text, extra) => {
        replies.push({ text, extra });
        return { message_id: replies.length };
      },
    };

    await handleDiscussionBottomButton(ctx, "en", messages.en.discussionInvite);

    assert.equal(replies.length, 1);
    assert.equal(replies[0].text, messages.en.discussionInviteFull);
    assert.deepEqual(replies[0].extra.reply_markup.inline_keyboard, [[{
      text: messages.en.acknowledgeButton,
      callback_data: callBacks.discussionInvitePickerClose,
    }]]);
  } finally {
    User.findOne = originalUserFindOne;
    Discussion.findById = originalDiscussionFindById;
  }
});

test("normalizes discussion capacity to allowed values", () => {
  assert.equal(normalizeMaxMembers(5), 5);
  assert.equal(normalizeMaxMembers("10"), 10);
  assert.equal(normalizeMaxMembers(2), 2);
  assert.equal(normalizeMaxMembers(50), 50);
  assert.equal(normalizeMaxMembers(7), 20);
  assert.equal(normalizeMaxMembers(100), 20);
  assert.equal(normalizeMaxMembers("nope"), 20);
});

test("resolves capacity 100 only for persisted language-specific bot starter rooms", () => {
  assert.equal(resolveDiscussionMaxMembers({
    isBotCreated: true,
    botSeedKey: "free-discussion:en",
    maxMembers: 100,
  }), 100);
  assert.equal(resolveDiscussionMaxMembers({
    isBotCreated: true,
    botSeedKey: "free-discussion:fa",
    maxMembers: 20,
  }), 20);
  assert.equal(resolveDiscussionMaxMembers({
    isBotCreated: false,
    botSeedKey: "free-discussion:en",
    maxMembers: 100,
  }), 20);
  assert.equal(resolveDiscussionMaxMembers({
    isBotCreated: true,
    botSeedKey: "free-discussion",
    maxMembers: 100,
  }), 20);
  assert.equal(resolveDiscussionMaxMembers({
    isBotCreated: true,
    botSeedKey: "custom-bot-room:en",
    maxMembers: 100,
  }), 20);
});

test("paid discussion capacities depend on Star spending availability", () => {
  const originalSettings = { ...starEconomy };
  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: true,
    paidTwoPersonDiscussionsEnabled: true,
    paidTwoPersonDiscussionCost: 3,
    paidLargeDiscussionsEnabled: true,
    paidLargeDiscussionCapacity: 50,
    paidLargeDiscussionCost: 10,
  });
  try {
    assert.deepEqual(getPaidDiscussionCapacity(2), {
      capacity: 2,
      cost: 3,
      kind: "two_person",
      available: true,
    });
    assert.deepEqual(getPaidDiscussionCapacity(50), {
      capacity: 50,
      cost: 10,
      kind: "large",
      available: true,
    });
    assert.ok(getSelectableDiscussionCapacities().includes(2));
    assert.ok(getSelectableDiscussionCapacities().includes(50));

    starEconomy.spendingEnabled = false;
    assert.equal(getPaidDiscussionCapacity(2).available, false);
    assert.equal(getSelectableDiscussionCapacities().includes(2), false);
  } finally {
    Object.assign(starEconomy, originalSettings);
  }
});

test("normalizePublicProfileCode normalizes and validates codes", () => {
  assert.equal(normalizePublicProfileCode("u_ab12"), "u_AB12");
  assert.equal(normalizePublicProfileCode("/u_ab12"), "u_AB12");
  assert.equal(normalizePublicProfileCode("  /u_A-1_2  "), "u_A12");
  assert.equal(normalizePublicProfileCode("abc"), "");
  assert.equal(normalizePublicProfileCode(""), "");
});

test("normalizePublicDiscussionCode normalizes and validates discussion commands", () => {
  assert.equal(normalizePublicDiscussionCode("d_ab12"), "d_AB12");
  assert.equal(normalizePublicDiscussionCode("/d_ab12"), "d_AB12");
  assert.equal(normalizePublicDiscussionCode("u_ab12"), "");
  assert.equal(normalizePublicDiscussionCode(""), "");
});

test("validateJoinRulePayload accepts open rule", () => {
  const result = validateJoinRulePayload({ type: "open" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.joinRule, { type: "open" });
});

test("discussion schema accepts open join rule without section", () => {
  const discussion = new Discussion({
    title: "Open room",
    description: "A public topic",
    publicDiscussionCode: "d_TEST1",
    creatorUserId: 1,
    joinRule: { type: "open" },
  });

  assert.equal(discussion.validateSync(), undefined);
  assert.equal(discussion.replyCount, 0);
  assert.ok(discussion.lastActivityAt instanceof Date);
});

test("discussion schema indexes creator activity lists", () => {
  const indexes = Discussion.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => (
    options?.name === "creator_open_discussions_activity_sort" &&
    fields.creatorUserId === 1 &&
    fields.status === 1 &&
    fields.lastActivityAt === -1
  )));
});

test("user schema indexes active discussion cleanup", () => {
  const indexes = User.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => (
    options?.name === "active_discussion_membership_cleanup" &&
    fields.activeDiscussionId === 1
  )));
});

test("bot starter discussions use the bot id without fake members", async () => {
  const originalFindOneAndUpdate = Discussion.findOneAndUpdate;
  const calls = [];
  Discussion.findOneAndUpdate = async (filter, update) => {
    calls.push({ filter, update });
    return {
      ...update.$setOnInsert,
      ...update.$set,
      publicDiscussionCode: `d_BOT${calls.length}`,
    };
  };

  try {
    const result = await seedBotDiscussions(9001);
    assert.equal(result.ok, true);
    assert.equal(calls.length, BOT_STARTER_DISCUSSIONS.length * 2);
    assert.deepEqual(
      calls.map((entry) => entry.filter.botSeedKey),
      BOT_STARTER_DISCUSSIONS.flatMap((entry) => [`${entry.botSeedKey}:fa`, `${entry.botSeedKey}:en`]),
    );
    for (const { update } of calls) {
      assert.equal(update.$set.creatorUserId, 9001);
      assert.equal(update.$set.isBotCreated, true);
      assert.equal(update.$set.maxMembers, 100);
      assert.deepEqual(update.$setOnInsert.memberUserIds, []);
    }
    assert.deepEqual(calls[0].update.$set.joinRule, { type: "open" });
    assert.deepEqual(calls[2].update.$set.joinRule, {
      type: "top_ten_item",
      section: "random",
      itemTitle: "Gaming",
      itemAliases: ["Gaming", "Games", "Game", "گیم", "بازی"],
    });
    assert.deepEqual(calls[4].update.$set.joinRule, {
      type: "top_ten_item",
      section: "random",
      itemTitle: "Movies",
      itemAliases: ["Movies", "Movie", "Film", "Films", "فیلم", "فیلم‌ها"],
    });
    assert.deepEqual(calls[6].update.$set.joinRule, {
      type: "taste_label",
      section: "music",
      tasteLabelKey: "metalhead",
    });
  } finally {
    Discussion.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("bot starter discussions keep the open room first when pinned", () => {
  const sorted = sortBotStarterDiscussionsFirst([
    { botSeedKey: "lets-talk", isBotCreated: true },
    { botSeedKey: "metalheads", isBotCreated: true },
    { botSeedKey: "whats-up", isBotCreated: true },
    { botSeedKey: "free-discussion", isBotCreated: true },
  ]);

  assert.deepEqual(
    sorted.map((discussion) => discussion.botSeedKey),
    ["free-discussion", "whats-up", "lets-talk", "metalheads"],
  );
});

test("discussion entry requires a valid profile name before joining", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const updates = [];
  const replies = [];
  const events = [];

  User.findOneAndUpdate = async (filter, update) => {
    updates.push({ filter, update });
    return {};
  };

  try {
    const ctx = {
      userId: 42,
      user: { userId: 42, profileName: "" },
      reply: async (text, keyboard) => {
        events.push("prompt");
        replies.push({ text, keyboard });
        return { message_id: 77 };
      },
    };

    assert.equal(hasValidDiscussionProfileName({ profileName: "Ali", profileNameConfirmedAt: new Date() }), true);
    assert.equal(hasValidDiscussionProfileName({ profileName: "Ali" }), false);
    assert.equal(hasValidDiscussionProfileName({ profileName: "Al" }), false);
    assert.equal(hasValidDiscussionProfileName({
      profileName: "منشتسیبمنتشکمیبتشکسیبتشمکسیبت",
      profileNameConfirmedAt: new Date(),
    }), false);
    assert.equal(await requireDiscussionProfileName(ctx, "en", {
      source: "join",
      token: "d_ROOM1",
      beforePrompt: async () => events.push("cleanup"),
    }), false);

    assert.deepEqual(events, ["cleanup", "prompt"]);
    assert.match(replies[0].text, /Before creating or entering a discussion/);
    assert.equal(
      replies[0].keyboard.reply_markup.keyboard[0][0].text,
      messages.en.cancelEdit,
    );
    const stateUpdate = updates.find((entry) => entry.update.state);
    assert.deepEqual(parseDiscussionNameState(stateUpdate.update.state), {
      source: "join",
      token: "d_ROOM1",
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("discussion name gate recognizes localized bottom Cancel labels before name validation", () => {
  assert.equal(isDiscussionNameCancelText(messages.fa.cancelEdit), true);
  assert.equal(isDiscussionNameCancelText(messages.en.cancelEdit), true);
  assert.equal(isDiscussionNameCancelText("\u200f✕ لغو\u200e"), true);
  assert.equal(isDiscussionNameCancelText("/cancel"), true);
  assert.equal(isDiscussionNameCancelText("Taha"), false);
});

test("discussion name cancel returns invite accepts to invitations", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const updates = [];
  const calls = [];

  User.findOneAndUpdate = async (filter, update) => {
    updates.push({ filter, update });
    return {};
  };

  try {
    const ctx = {
      userId: 42,
      user: {
        state: "discussion_name_required:accept:875ZYQO",
        profileEditPromptMessageId: 77,
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

    await handleDiscussionNameCancel(ctx, "en", {
      renderInvitationsList: async (_ctx, lang, page) => {
        calls.push(["invitations", lang, page]);
        return true;
      },
    });

    assert.deepEqual(calls, [
      ["delete", 77],
      ["reply", messages.en.discussionsMenu, discussionsMenuKeyboard("en")],
      ["invitations", "en", 0],
    ]);
    assert.equal(ctx.user.state, "idle");
    assert.ok(updates.some((entry) => entry.update.profileEditPromptMessageId === null));
    assert.ok(updates.some((entry) => entry.update.state === "idle"));
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("discussion name cancel returns active list opens to active discussions", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const calls = [];

  User.findOneAndUpdate = async () => ({});

  try {
    const ctx = {
      userId: 42,
      user: {
        state: "discussion_name_required:open:d_ROOM1",
        profileEditPromptMessageId: 88,
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

    await handleDiscussionNameCancel(ctx, "en", {
      renderActiveDiscussionList: async (_ctx, lang, page, joinableOnly) => {
        calls.push(["active", lang, page, joinableOnly]);
        return true;
      },
    });

    assert.deepEqual(calls, [
      ["delete", 88],
      ["reply", messages.en.discussionsMenu, discussionsMenuKeyboard("en")],
      ["active", "en", 0, false],
    ]);
    assert.equal(ctx.user.state, "idle");
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("discussion name gate preserves saved-profile discussion origin", () => {
  const nameGate = buildDiscussionOpenNameGate({
    user: {
      discussionLastListType: "saved:u_ALI1",
    },
  }, "d_ROOM1");

  assert.deepEqual(nameGate, {
    source: "open_saved",
    token: "u_ALI1|d_ROOM1",
  });
  assert.equal(getDiscussionOpenCodeFromNameState(nameGate), "d_ROOM1");
});

test("discussion name cancel returns saved-profile discussions to the same profile", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const calls = [];

  User.findOneAndUpdate = async () => ({});

  try {
    const ctx = {
      userId: 42,
      user: {
        state: "discussion_name_required:open_saved:u_ALI1|d_ROOM1",
        profileEditPromptMessageId: 99,
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

    await handleDiscussionNameCancel(ctx, "en", {
      renderSavedProfileDiscussions: async (_ctx, lang, code) => {
        calls.push(["saved", lang, code]);
        return true;
      },
    });

    assert.deepEqual(calls, [
      ["delete", 99],
      ["reply", messages.en.people, peopleHubKeyboard("en")],
      ["saved", "en", "u_ALI1"],
    ]);
    assert.equal(ctx.user.state, "idle");
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("discussion name cancel returns my-discussion opens to my discussions", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const calls = [];

  User.findOneAndUpdate = async () => ({});

  try {
    const ctx = {
      userId: 42,
      user: {
        state: "discussion_name_required:open_mine:d_ROOM1",
        profileEditPromptMessageId: 100,
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

    await handleDiscussionNameCancel(ctx, "en", {
      renderMyDiscussionList: async (_ctx, lang, page) => {
        calls.push(["mine", lang, page]);
        return true;
      },
    });

    assert.deepEqual(calls, [
      ["delete", 100],
      ["reply", messages.en.discussionsMenu, discussionsMenuKeyboard("en")],
      ["mine", "en", 0],
    ]);
    assert.equal(ctx.user.state, "idle");
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("validateJoinRulePayload validates restricted rules", () => {
  const topTen = validateJoinRulePayload({ type: "top_ten_completed", section: "movies" });
  assert.equal(topTen.ok, true);
  assert.equal(topTen.joinRule.type, "top_ten_completed");

  const taste = validateJoinRulePayload({ type: "taste_label", section: "music", tasteLabelKey: "metalhead" });
  assert.equal(taste.ok, true);
  assert.equal(taste.joinRule.tasteLabelKey, "metalhead");

  const item = validateJoinRulePayload({ type: "top_ten_item", section: "books", itemTitle: "  Dune " });
  assert.equal(item.ok, true);
  assert.equal(item.joinRule.itemTitle, "Dune");
  assert.deepEqual(item.joinRule.itemAliases, ["Dune"]);
});

test("validateJoinRulePayload rejects invalid payloads", () => {
  assert.equal(validateJoinRulePayload({ type: "weird" }).ok, false);
  assert.equal(validateJoinRulePayload({ type: "top_ten_completed", section: "games" }).ok, false);
  assert.equal(validateJoinRulePayload({ type: "taste_label", section: "music" }).ok, false);
  assert.equal(validateJoinRulePayload({ type: "top_ten_item", section: "books", itemTitle: "   " }).ok, false);
});

test("discussion title link detector catches common links", () => {
  assert.equal(hasLink("watch this https://example.com"), true);
  assert.equal(hasLink("join t.me/example"), true);
  assert.equal(hasLink("Best riffs ever"), false);
});

test("discussion title and description reject command-like text", () => {
  assert.equal(validateDiscussionTitle("/start").valid, false);
  assert.equal(validateDiscussionTitle(" /join_ROOM").reason, "command_like");
  assert.equal(validateDiscussionDescription("/help me").reason, "command_like");
  assert.equal(validateDiscussionTitle("Best riffs ever").valid, true);
});

test("top ten item join rule tolerates near-duplicate spelling", async () => {
  const user = {
    aiLists: {
      books: {
        topTen: [
          { title: "The Lord of the Rings", comment: "", watched: false },
        ],
      },
    },
  };
  const result = await validateJoinRules({
    user,
    joinRule: { type: "top_ten_item", section: "books", itemTitle: "Lord of Rings" },
  });
  assert.equal(result.ok, true);
});

test("top ten item join rule accepts explicit bilingual aliases", async () => {
  const user = {
    aiLists: {
      random: {
        topTen: [
          { title: "گیم", comment: "", watched: false },
        ],
      },
    },
  };
  const result = await validateJoinRules({
    user,
    joinRule: {
      type: "top_ten_item",
      section: "random",
      itemTitle: "Gaming",
      itemAliases: ["Gaming", "گیم", "بازی"],
    },
  });
  assert.equal(result.ok, true);
});

test("joining another room requires leaving the active room first", async () => {
  const originalFindOne = User.findOne;
  const originalFindById = Discussion.findById;
  const activeDiscussionId = new Discussion()._id;
  const targetDiscussionId = new Discussion()._id;

  User.findOne = async () => ({
    userId: 42,
    activeDiscussionId,
  });
  Discussion.findById = async () => ({
    _id: targetDiscussionId,
    status: "open",
    memberUserIds: [],
    creatorUserId: 7,
  });

  try {
    const result = await joinOrOpenDiscussion(42, targetDiscussionId);
    assert.deepEqual(result, { ok: false, reason: "leave_current_first" });
  } finally {
    User.findOne = originalFindOne;
    Discussion.findById = originalFindById;
  }
});

test("explicit discussion switch can activate target room", async () => {
  const originalFindOne = User.findOne;
  const originalUserFindOneAndUpdate = User.findOneAndUpdate;
  const originalFindById = Discussion.findById;
  const activeDiscussionId = new Discussion()._id;
  const targetDiscussionId = new Discussion()._id;
  const userUpdates = [];

  User.findOne = async () => ({
    userId: 42,
    activeDiscussionId,
  });
  User.findOneAndUpdate = async (query, update) => {
    userUpdates.push({ query, update });
    return {};
  };
  Discussion.findById = async () => ({
    _id: targetDiscussionId,
    status: "open",
    memberUserIds: [42],
    creatorUserId: 7,
  });

  try {
    const result = await joinOrOpenDiscussion(42, targetDiscussionId, { allowActiveSwitch: true });
    assert.equal(result.ok, true);
    assert.equal(result.joined, false);
    assert.equal(String(result.previousActiveDiscussionId), String(activeDiscussionId));
    assert.equal(String(userUpdates.at(-1).update.$set.activeDiscussionId), String(targetDiscussionId));
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalUserFindOneAndUpdate;
    Discussion.findById = originalFindById;
  }
});
