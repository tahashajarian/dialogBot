const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePublicProfileCode,
  normalizePublicDiscussionCode,
  validateJoinRulePayload,
  validateJoinRules,
  joinOrOpenDiscussion,
  hasLink,
  normalizeMaxMembers,
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

test("discussion caps match MVP defaults", () => {
  assert.equal(DISCUSSION_MEMBER_CAP, 20);
  assert.deepEqual(DISCUSSION_ALLOWED_MEMBER_CAPS, [2, 3, 4, 5, 10, 15, 20]);
  assert.equal(DISCUSSION_RECENT_MESSAGES_CAP, 10);
  assert.equal(DISCUSSION_MESSAGE_BURST_WINDOW_MS, 1000);
});

test("normalizes discussion capacity to allowed values", () => {
  assert.equal(normalizeMaxMembers(5), 5);
  assert.equal(normalizeMaxMembers("10"), 10);
  assert.equal(normalizeMaxMembers(2), 2);
  assert.equal(normalizeMaxMembers(50), 50);
  assert.equal(normalizeMaxMembers(7), 20);
  assert.equal(normalizeMaxMembers("nope"), 20);
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
    assert.equal(calls.length, BOT_STARTER_DISCUSSIONS.length);
    assert.deepEqual(
      calls.map((entry) => entry.filter.botSeedKey),
      BOT_STARTER_DISCUSSIONS.map((entry) => entry.botSeedKey),
    );
    for (const { update } of calls) {
      assert.equal(update.$set.creatorUserId, 9001);
      assert.equal(update.$set.isBotCreated, true);
      assert.deepEqual(update.$setOnInsert.memberUserIds, []);
    }
    assert.deepEqual(calls[0].update.$set.joinRule, { type: "open" });
    assert.deepEqual(calls[1].update.$set.joinRule, {
      type: "top_ten_item",
      section: "random",
      itemTitle: "Gaming",
      itemAliases: ["Gaming", "Games", "Game", "گیم", "بازی"],
    });
    assert.deepEqual(calls[2].update.$set.joinRule, {
      type: "top_ten_item",
      section: "random",
      itemTitle: "Movies",
      itemAliases: ["Movies", "Movie", "Film", "Films", "فیلم", "فیلم‌ها"],
    });
    assert.deepEqual(calls[3].update.$set.joinRule, {
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
    assert.equal(await requireDiscussionProfileName(ctx, "en", {
      source: "join",
      token: "d_ROOM1",
      beforePrompt: async () => events.push("cleanup"),
    }), false);

    assert.deepEqual(events, ["cleanup", "prompt"]);
    assert.match(replies[0].text, /Before creating or entering a discussion/);
    assert.equal(
      replies[0].keyboard.reply_markup.inline_keyboard[0][0].callback_data,
      "profile:cancel:edit",
    );
    const stateUpdate = updates.find((entry) => entry.update.state);
    const promptUpdate = updates.find((entry) => entry.update.profileEditPromptMessageId === 77);
    assert.deepEqual(parseDiscussionNameState(stateUpdate.update.state), {
      source: "join",
      token: "d_ROOM1",
    });
    assert.ok(promptUpdate);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
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
    };

    await handleDiscussionNameCancel(ctx, "en", {
      renderInvitationsList: async (_ctx, lang, page) => {
        calls.push(["invitations", lang, page]);
        return true;
      },
    });

    assert.deepEqual(calls, [
      ["delete", 77],
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
    };

    await handleDiscussionNameCancel(ctx, "en", {
      renderActiveDiscussionList: async (_ctx, lang, page, joinableOnly) => {
        calls.push(["active", lang, page, joinableOnly]);
        return true;
      },
    });

    assert.deepEqual(calls, [
      ["delete", 88],
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
    };

    await handleDiscussionNameCancel(ctx, "en", {
      renderSavedProfileDiscussions: async (_ctx, lang, code) => {
        calls.push(["saved", lang, code]);
        return true;
      },
    });

    assert.deepEqual(calls, [
      ["delete", 99],
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
    };

    await handleDiscussionNameCancel(ctx, "en", {
      renderMyDiscussionList: async (_ctx, lang, page) => {
        calls.push(["mine", lang, page]);
        return true;
      },
    });

    assert.deepEqual(calls, [
      ["delete", 100],
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
