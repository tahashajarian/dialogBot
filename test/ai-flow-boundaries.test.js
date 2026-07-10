const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const {
  formatAiCommentPrompt,
  formatAiCommentSaved,
  handleAiText,
  isAiBackText,
  isAiSectionListText,
  isAiSectionSuggestText,
  isAiSectionTopTenText,
  isAiTextState,
} = require("../src/flows/ai-text");
const User = require("../src/models/user");
const AiPaidSuggestion = require("../src/models/ai-paid-suggestion");
const { starEconomy } = require("../src/services/star-settings");
const {
  getAiListAddPrompt,
  getMeaningfulMusicTitle,
  isAudioDocument,
  resolveAiListAddInput,
} = require("../src/flows/ai-list-input");
const {
  aiSectionKeyboardForSection,
  aiSuggestionAddKeyboard,
  aiSuggestionAddedOptionsKeyboard,
  aiSuggestionNextKeyboard,
  aiListCancelAddKeyboard,
  aiListManageMenuKeyboard,
  aiInterestTopTenChipKeyboard,
  aiPaidSuggestionConfirmKeyboard,
  aiSuggestionModeKeyboard,
  aiSuggestionLimitKeyboard,
  getInterestTopTenChipTitle,
} = require("../src/keyboards");

test("suggestion limit keyboard returns to the current section", () => {
  const keyboard = aiSuggestionLimitKeyboard("en", "music");
  const [button] = keyboard.reply_markup.inline_keyboard.flat();
  assert.equal(button.text, messages.en.aiBack);
  assert.equal(button.callback_data, callBacks.aiSuggestMusic);
});

test("paid suggestion confirm keyboard is explicit and section-scoped", () => {
  const keyboard = aiPaidSuggestionConfirmKeyboard("en", "ABC123", 1, "music");
  const buttons = keyboard.reply_markup.inline_keyboard.flat();

  assert.equal(buttons[0].text, messages.en.aiSuggestionPaidConfirmButton.replace("{cost}", "1"));
  assert.equal(buttons[0].callback_data, `${callBacks.aiPaidSuggestionConfirm}ABC123`);
  assert.equal(buttons[1].callback_data, `${callBacks.aiPaidSuggestionCancel}music`);
  assert.equal(buttons[2].callback_data, callBacks.aiSuggestMusic);
});

test("suggestion limit offers paid confirmation when Stars spending is enabled", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalCreate = AiPaidSuggestion.create;
  const originalSettings = { ...starEconomy };
  const edits = [];
  const now = new Date();

  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: true,
    paidSuggestionsEnabled: true,
    paidSuggestionCost: 1,
  });
  User.findOne = async () => ({
    userId: 91,
    aiSuggestionUsage: {
      music: Array.from({ length: 10 }, () => now),
    },
  });
  User.findOneAndUpdate = async () => ({});
  AiPaidSuggestion.create = async (payload) => ({
    ...payload,
    publicCode: "PAID91",
  });

  const ctx = {
    userId: 91,
    user: {
      userId: 91,
      lang: "en",
      state: "ai_suggest_context_music",
      starBalance: 3,
      aiLists: {
        music: {
          topTen: [{ title: "A" }, { title: "B" }, { title: "C" }],
          watchlist: [],
        },
      },
      aiSuggestionUsage: {
        music: Array.from({ length: 10 }, () => now),
      },
    },
    reply: async (text, extra) => ({ message_id: 1, text, extra }),
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return { message_id: messageId, text, extra };
    },
  };

  try {
    await handleAiText(ctx, "en", "calm", ctx.user.state);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    AiPaidSuggestion.create = originalCreate;
    Object.assign(starEconomy, originalSettings);
  }

  const finalEdit = edits.at(-1);
  const buttons = finalEdit.extra.reply_markup.inline_keyboard.flat();
  assert.match(finalEdit.text, /free suggestions/);
  assert.match(finalEdit.text, /1 Star/);
  assert.equal(buttons[0].callback_data, `${callBacks.aiPaidSuggestionConfirm}PAID91`);
  assert.equal(buttons[1].callback_data, `${callBacks.aiPaidSuggestionCancel}music`);
});
const {
  handleAiCallback,
  isAiCallback,
  isSuggestionCallbackValidForState,
} = require("../src/flows/ai-callbacks");
const {
  clearAiSectionEntryMessage,
  clearRememberedAiListMessage,
  shouldKeepAiListTitleForCallback,
} = require("../src/flows/ai-cards");
const {
  buildTopTenListMessage,
  buildTopTenSavedMessage,
  buildWatchlistMessage,
  buildShareListMessage,
  formatAiItemsList,
  getDuplicateListMessage,
  getNeedTopTenMessage,
  getTopTenManageEntryMessage,
  toTitleSet,
} = require("../src/services/ai-list-ui");

test("AI text state predicate recognizes only AI-owned text states", () => {
  assert.equal(isAiTextState("ai_chat_movies"), true);
  assert.equal(isAiTextState("ai_manage_music_top_ten_add_input"), true);
  assert.equal(isAiTextState("ai_manage_random_watchlist_comment_input"), true);
  assert.equal(isAiTextState("ai_suggest_context_books"), true);

  assert.equal(isAiTextState("editing_name"), false);
  assert.equal(isAiTextState("discussion_create_title"), false);
  assert.equal(isAiTextState("idle"), false);
});

test("AI text button predicates accept localized keyboard labels", () => {
  assert.equal(isAiBackText(messages.en.aiBack), true);
  assert.equal(isAiBackText(messages.fa.aiBack), true);
  assert.equal(isAiBackText("Back"), true);

  assert.equal(isAiSectionListText(messages.en.aiSectionListButtonMovies, "movies"), true);
  assert.equal(isAiSectionListText(messages.fa.aiSectionListButtonRandom, "random"), true);
  assert.equal(isAiSectionTopTenText(messages.en.aiSectionTopTenButton), true);
  assert.equal(isAiSectionTopTenText(`🎵 ${messages.fa.aiSectionTopTenButton}`), true);
  assert.equal(isAiSectionSuggestText(messages.fa.aiSectionSuggestButton), true);
  assert.equal(isAiSectionSuggestText(`🎬 ${messages.en.aiSectionSuggestButton}`), true);
});

test("suggestion save buttons name the concrete section list", () => {
  const musicAddButtons = aiSuggestionAddKeyboard("en", "music").reply_markup.inline_keyboard.flat();
  const booksAddedButtons = aiSuggestionAddedOptionsKeyboard("fa", "books").reply_markup.inline_keyboard.flat();
  const rejectedButtons = aiSuggestionNextKeyboard("fa", "movies").reply_markup.inline_keyboard.flat();

  assert.equal(musicAddButtons[0].text, "➕ Save to 🎵 listen later");
  assert.equal(booksAddedButtons[1].text, "🗂 📚 برای بعد خواندن");
  assert.equal(booksAddedButtons[2].text, messages.fa.aiListBackToTopTen);
  assert.equal(booksAddedButtons[2].callback_data, `${callBacks.aiListManageMenu}books:top_ten`);
  assert.equal(rejectedButtons[1].text, messages.fa.aiListBackToTopTen);
  assert.equal(rejectedButtons[1].callback_data, `${callBacks.aiListManageMenu}movies:top_ten`);
  assert.equal(messages.en.aiSuggestionAdded.replace("{listName}", "📚 read later"), "✅ Saved to 📚 read later.");
  assert.equal(messages.fa.aiSuggestionAdded.replace("{listName}", "🎵 پلی‌لیست"), "✅ در 🎵 پلی‌لیست ذخیره شد.");
});

test("AI section keyboard prefixes section actions with section emoji", () => {
  const musicKeyboard = aiSectionKeyboardForSection("fa", "music");
  const topTenButton = musicKeyboard.reply_markup.keyboard[0][0];
  const suggestButton = musicKeyboard.reply_markup.keyboard[2][0];
  const randomKeyboard = aiSectionKeyboardForSection("fa", "random");
  const randomTopTenButton = randomKeyboard.reply_markup.keyboard[0][0];
  const randomSuggestButton = randomKeyboard.reply_markup.keyboard[2][0];

  assert.equal(topTenButton.text, `🎵 ${messages.fa.aiSectionTopTenButton}`);
  assert.equal(suggestButton.text, `🎵 ${messages.fa.aiSectionSuggestButton}`);
  assert.equal(randomTopTenButton.text, messages.fa.aiSectionTopTenButton);
  assert.equal(randomSuggestButton.text, messages.fa.aiSectionSuggestButton);
});

test("AI bottom Back clears reply controls on the destination menu message", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const edits = [];

  User.findOneAndUpdate = async () => ({});

  const ctx = {
    text: messages.fa.aiBack,
    userId: 1,
    user: {
      userId: 1,
      lang: "fa",
      state: "ai_manage_random_top_ten",
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return { message_id: messageId };
    },
  };

  try {
    await handleAiText(ctx, "fa", messages.fa.aiBack, ctx.user.state);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, `${messages.fa.aiAssistant}\n\n${messages.fa.aiAssistantMenu}`);
  assert.equal(replies[0].extra?.reply_markup?.remove_keyboard, true);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].messageId, 1);
  assert.equal(edits[0].text, `${messages.fa.aiAssistant}\n\n${messages.fa.aiAssistantMenu}`);
  assert.deepEqual(edits[0].extra.reply_markup.inline_keyboard.at(-1)[0].callback_data, callBacks.aiBack);
});

test("music add flow accepts meaningful audio titles and rejects untitled media", () => {
  assert.equal(
    getMeaningfulMusicTitle({ audio: { title: "Paranoid Android" } }),
    "Paranoid Android",
  );
  assert.equal(
    getMeaningfulMusicTitle({ audio: { file_name: "03 - Wish You Were Here.mp3" } }),
    "Wish You Were Here",
  );
  assert.equal(
    getMeaningfulMusicTitle({
      document: {
        file_name: "The HU - Sad But True.mp3",
        mime_type: "audio/mpeg",
      },
    }),
    "The HU - Sad But True",
  );
  assert.equal(getMeaningfulMusicTitle({ audio: { file_name: "audio123.mp3" } }), "");
  assert.equal(isAudioDocument({ file_name: "song.mp3" }), true);
  assert.equal(isAudioDocument({ file_name: "cover.jpg", mime_type: "image/jpeg" }), false);

  assert.deepEqual(
    resolveAiListAddInput(
      { message: { audio: { title: "Nude" } } },
      "music",
      "",
    ),
    { item: "Nude", reason: "" },
  );
  assert.deepEqual(
    resolveAiListAddInput(
      { message: { photo: [{ file_id: "photo" }] } },
      "books",
      "",
    ),
    { item: "", reason: "unsupported_media" },
  );
  assert.deepEqual(
    resolveAiListAddInput(
      { message: { audio: { file_name: "track01.mp3" } } },
      "music",
      "",
    ),
    { item: "", reason: "untitled_audio" },
  );
  assert.deepEqual(
    resolveAiListAddInput(
      { message: { document: { file_name: "The HU - Sad But True.mp3" } } },
      "music",
      "",
    ),
    { item: "The HU - Sad But True", reason: "" },
  );
});

test("music add prompt invites either an audio track or typed title", () => {
  assert.equal(getAiListAddPrompt("en", "music", "topTen"), messages.en.aiMusicFavoritesAddPrompt);
  assert.equal(getAiListAddPrompt("fa", "books", "topTen"), messages.fa.aiBookFavoritesAddPrompt);
  assert.match(messages.en.aiMusicListManageAddPrompt, /^👩‍🦳/);
  assert.match(messages.fa.aiMusicListManageAddPrompt, /آهنگ/);
});

test("add prompt starts with Cancel and post-save prompt returns to list", () => {
  const firstPrompt = aiListCancelAddKeyboard("en", "movies", "watchlist");
  const nextPrompt = aiListCancelAddKeyboard("en", "movies", "watchlist", { backToList: true });
  const firstInterestPrompt = aiInterestTopTenChipKeyboard("en", [], 0);
  const nextInterestPrompt = aiInterestTopTenChipKeyboard("en", ["Chess"], 0, { backToList: true });

  assert.equal(firstPrompt.reply_markup.inline_keyboard.flat().at(-1).text, messages.en.cancelEdit);
  assert.equal(nextPrompt.reply_markup.inline_keyboard.flat().at(-1).text, messages.en.aiListManageAddBackToList);
  assert.equal(firstInterestPrompt.reply_markup.inline_keyboard.flat().at(-1).text, messages.en.cancelEdit);
  assert.equal(nextInterestPrompt.reply_markup.inline_keyboard.flat().at(-1).text, messages.en.aiListManageAddBackToList);
});

test("pressing Add retires the remembered list card", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];
  const edits = [];

  User.findOneAndUpdate = async () => ({});

  const ctx = {
    callbackData: `${callBacks.aiListManageAdd}movies:top_ten`,
    callbackMessageId: 40,
    userId: 79,
    user: {
      userId: 79,
      lang: "en",
      state: "ai_manage_movies_top_ten",
      aiLastListMessageId: 39,
      aiLastListSection: "movies",
      aiLastListType: "topTen",
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 80 + replies.length };
    },
  };

  try {
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(deletedIds.includes(39), true);
  assert.equal(deletedIds.includes(40), true);
  assert.equal(ctx.user.aiLastListMessageId, null);
  assert.equal(replies.filter((reply) => reply.text === messages.en.aiMovieFavoritesAddPrompt).length, 1);
  assert.equal(replies.some((reply) => reply.text === "."), false);
  assert.equal(ctx.user.aiPendingInputMessageId, 81);
  assert.equal(edits.length, 0);
  assert.equal(replies.at(-1).extra.reply_markup.inline_keyboard.flat().at(-1).text, messages.en.cancelEdit);
});

test("pressing Add sends one visible prompt with Cancel when edit is unavailable", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];

  User.findOneAndUpdate = async () => ({});

  const ctx = {
    callbackData: `${callBacks.aiListManageAdd}books:watchlist`,
    callbackMessageId: 42,
    userId: 80,
    user: {
      userId: 80,
      lang: "en",
      state: "ai_manage_books_watchlist",
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 90 + replies.length };
    },
  };

  try {
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(replies.filter((reply) => reply.text === messages.en.aiListManageAddPrompt).length, 1);
  assert.equal(deletedIds.includes(91), false);
  assert.equal(replies.at(-1).extra.reply_markup.inline_keyboard.flat().at(-1).text, messages.en.cancelEdit);
  assert.equal(ctx.user.aiPendingInputMessageId, 91);
});

test("Top Ten saved message does not repeat saved-only fallback feedback", async () => {
  const text = await buildTopTenSavedMessage({
    ctx: { userId: 1 },
    lang: "fa",
    section: "books",
    item: "نتاشایباشسمنیاب",
    items: [{ title: "نتاشایباشسمنیاب" }],
  });

  assert.match(text, /^✅/);
  assert.match(text, /✅ «نتاشایباشسمنیاب» ثبت شد\. \(1\/10\)/);
  assert.match(text, /👩‍🦳 خوبه؛ یکی دیگه هم بفرست/);
  assert.doesNotMatch(text, /ذخیره شد/);
});

test("canceling AI list comment returns to the refreshed list manager", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];

  const ctx = {
    callbackData: `${callBacks.aiListManageCancelComment}movies:watchlist`,
    callbackMessageId: 55,
    userId: 81,
    user: {
      userId: 81,
      lang: "fa",
      state: "ai_manage_movies_watchlist_comment_input",
      aiPendingInputMessageId: 55,
      aiSectionPendingCommentItem: "Arrival",
      aiSectionPendingCommentListType: "watchlist",
      aiLists: {
        movies: {
          topTen: [],
          watchlist: [{ title: "Arrival" }],
        },
      },
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 90 + replies.length };
    },
  };

  User.findOneAndUpdate = async (query, update) => {
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await handleAiCallback(ctx, "fa", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const finalReply = replies.at(-1);
  const buttons = finalReply.extra.reply_markup.inline_keyboard.flat();
  const labels = buttons.map((button) => button.text);

  assert.deepEqual(deletedIds, [55]);
  assert.equal(ctx.user.aiSectionPendingCommentItem, null);
  assert.equal(ctx.user.aiSectionPendingCommentListType, null);
  assert.equal(ctx.user.state, "ai_manage_movies_watchlist");
  assert.match(finalReply.text, /Arrival/);
  assert.match(finalReply.text, /\/cm_mv_l_1/);
  assert.doesNotMatch(finalReply.text, /لغو شد/);
  assert.equal(labels.includes(messages.fa.cancelEdit), false);
  assert.equal(labels.includes(messages.fa.aiListManageAddLaterMovies), true);
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.aiListManageShow}movies:watchlist`), false);
});

test("AI comment copy names the item instead of the list type", () => {
  assert.equal(
    formatAiCommentPrompt("fa", "topTen", "Dune"),
    "👩‍🦳 کامنت برای «Dune» را بفرست (تا 120 کاراکتر).",
  );
  assert.equal(
    formatAiCommentSaved("fa", "topTen", "Dune"),
    "✅ کامنت برای «Dune» ذخیره شد.",
  );
  assert.equal(
    formatAiCommentPrompt("en", "watchlist", "Arrival"),
    '👩‍🦳 Send a comment for "Arrival" (up to 120 chars).',
  );
  assert.doesNotMatch(formatAiCommentPrompt("en", "topTen", "Arrival"), /top 10 comment/i);
  assert.doesNotMatch(formatAiCommentSaved("en", "topTen", "Arrival"), /top 10 comment/i);
});

test("AI comment item callback asks for a comment on the selected title", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];
  const edits = [];

  const ctx = {
    callbackData: `${callBacks.aiListManageCommentItem}books:top_ten:0`,
    callbackMessageId: 55,
    userId: 81,
    user: {
      userId: 81,
      lang: "fa",
      state: "ai_manage_books_top_ten",
      aiLists: {
        books: {
          topTen: [{ title: "Dune" }],
          watchlist: [],
        },
      },
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 90 + replies.length, text, extra };
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return { message_id: messageId, text, extra };
    },
  };

  User.findOneAndUpdate = async (query, update) => {
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await handleAiCallback(ctx, "fa", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const finalPromptText = edits.at(-1)?.text || replies.at(-1)?.text;
  assert.deepEqual(deletedIds, [55]);
  assert.match(finalPromptText, /کامنت برای «Dune»/);
  assert.doesNotMatch(finalPromptText, /کامنت تاپ ۱۰/);
  assert.equal(ctx.user.state, "ai_manage_books_top_ten_comment_input");
  assert.equal(ctx.user.aiSectionPendingCommentItem, "Dune");
});

test("entering AI list manager shows item rows without an all-items button", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];

  const ctx = {
    callbackData: `${callBacks.aiListManageMenu}movies:watchlist`,
    callbackMessageId: 60,
    userId: 82,
    user: {
      userId: 82,
      lang: "en",
      state: "ai_manage_movies_watchlist",
      aiLists: {
        movies: {
          topTen: [],
          watchlist: [{ title: "Arrival" }],
        },
      },
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 + replies.length };
    },
  };

  User.findOneAndUpdate = async (query, update) => {
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const managerReply = replies.at(-1);
  const buttons = managerReply.extra.reply_markup.inline_keyboard.flat();

  assert.deepEqual(deletedIds, [60]);
  assert.match(managerReply.text, /Arrival/);
  assert.match(managerReply.text, /\/cm_mv_l_1/);
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.aiListManageShow}movies:watchlist`), false);
});

test("entering a media section keeps a small section title above Top Ten", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];
  const edits = [];

  const ctx = {
    callbackData: callBacks.aiSuggestBooks,
    callbackMessageId: 60,
    userId: 82,
    user: {
      userId: 82,
      lang: "en",
      state: "idle",
      aiSectionEntryMessageId: 44,
      aiLists: {
        books: {
          topTen: [{ title: "Dune" }],
          watchlist: [],
        },
      },
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 + replies.length, text, extra };
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return { message_id: messageId, text, extra };
    },
  };

  User.findOneAndUpdate = async (query, update) => {
    if (update?.$set) Object.assign(ctx.user, update.$set);
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
      editCallbackMessageOrReply: async (callbackCtx, text, extra) => (
        callbackCtx.editMessageText(callbackCtx.callbackMessageId, text, extra)
      ),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deletedIds, [44]);
  assert.equal(edits[0].messageId, 60);
  assert.equal(edits[0].text, "📚 Books");
  assert.match(replies[0].text, /Dune/);
  assert.equal(ctx.user.aiSectionEntryMessageId, 60);
  assert.equal(ctx.user.aiLastListMessageId, 101);
  assert.equal(ctx.user.state, "ai_manage_books_top_ten");
});

test("section suggestion need-state consumes Top Ten card and shows Got it acknowledgement", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];

  const ctx = {
    callbackData: `${callBacks.aiSectionSuggestMenu}music`,
    callbackMessageId: 77,
    userId: 82,
    user: {
      userId: 82,
      lang: "en",
      state: "ai_manage_music_top_ten",
      aiLastListMessageId: 77,
      aiLastListSection: "music",
      aiLastListType: "topTen",
      aiLists: {
        music: {
          topTen: [],
          watchlist: [],
        },
      },
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 + replies.length, text, extra };
    },
  };

  User.findOneAndUpdate = async (query, update) => {
    if (update?.$set) Object.assign(ctx.user, update.$set);
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
      editCallbackMessageOrReply: async () => {
        throw new Error("Not-ready suggestion should use a Got it card");
      },
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deletedIds, [77]);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /add at least 3 things/);
  assert.deepEqual(
    replies[0].extra.reply_markup.inline_keyboard.flat().map((button) => button.text),
    [messages.en.acknowledgeButton],
  );
  assert.equal(
    replies[0].extra.reply_markup.inline_keyboard.flat()[0].callback_data,
    `${callBacks.aiSectionSuggestNeedTopTenAck}music`,
  );
  assert.equal(ctx.user.aiLastListMessageId, null);
  assert.equal(ctx.user.aiActionContext, "suggest_need_top_ten:music");
});

test("suggestion need-state Got it returns to the section Top Ten", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];

  const ctx = {
    callbackData: `${callBacks.aiSectionSuggestNeedTopTenAck}music`,
    callbackMessageId: 101,
    userId: 82,
    user: {
      userId: 82,
      lang: "en",
      state: "ai_manage_music_top_ten",
      aiActionMessageId: 101,
      aiActionContext: "suggest_need_top_ten:music",
      aiLists: {
        music: {
          topTen: [],
          watchlist: [],
        },
      },
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 200 + replies.length, text, extra };
    },
  };

  User.findOneAndUpdate = async (query, update) => {
    if (update?.$set) Object.assign(ctx.user, update.$set);
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deletedIds, [101]);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /Music favorites/);
  assert.equal(ctx.user.aiActionMessageId, null);
  assert.equal(ctx.user.aiActionContext, "");
  assert.equal(ctx.user.state, "ai_manage_music_top_ten");
});

test("suggestion mode prompt can return to the section Top Ten", async () => {
  const keyboard = aiSuggestionModeKeyboard("en", "movies");
  const buttons = keyboard.reply_markup.inline_keyboard.flat();

  assert.equal(buttons.at(-1).text, messages.en.aiBack);
  assert.equal(buttons.at(-1).callback_data, `${callBacks.aiListManageMenu}movies:top_ten`);
});

test("suggestion vibe prompt is sent once with cancel controls", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];
  const edits = [];

  const ctx = {
    callbackData: `${callBacks.aiSectionSuggestWithContext}movies`,
    callbackMessageId: 66,
    userId: 83,
    user: {
      userId: 83,
      lang: "fa",
      state: "ai_manage_movies_top_ten",
      aiLists: {
        movies: {
          topTen: [{ title: "Heat" }, { title: "Arrival" }, { title: "Dune" }],
          watchlist: [],
        },
      },
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 210 + replies.length, text, extra };
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return { message_id: messageId, text, extra };
    },
  };

  User.findOneAndUpdate = async (query, update) => {
    if (update?.$set) Object.assign(ctx.user, update.$set);
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await handleAiCallback(ctx, "fa", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deletedIds, [66]);
  assert.equal(replies.length, 1);
  assert.equal(edits.length, 0);
  assert.equal(replies[0].text, messages.fa.aiSuggestionContextPrompt);
  assert.equal(replies[0].extra.reply_markup.inline_keyboard.flat()[0].callback_data, `${callBacks.aiSectionSuggestContextCancel}movies`);
  assert.equal(ctx.user.state, "ai_suggest_context_movies");
  assert.equal(ctx.user.aiPendingInputMessageId, 211);
});

test("AI top-ten Back returns to the AI section picker", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const events = [];
  const replies = [];
  const updates = [];

  const ctx = {
    callbackData: `${callBacks.aiListManageBack}movies`,
    callbackMessageId: 77,
    userId: 82,
    user: {
      userId: 82,
      lang: "en",
      state: "ai_manage_movies_top_ten",
      aiLastListMessageId: 77,
      aiLastListSection: "movies",
      aiLastListType: "topTen",
      aiSectionEntryMessageId: 44,
      aiLists: {
        movies: {
          topTen: [{ title: "Arrival" }],
          watchlist: [],
        },
      },
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      events.push(`delete:${messageId}`);
      return true;
    },
    reply: async (text, extra) => {
      events.push("reply");
      replies.push({ text, extra });
      return { message_id: 120, text, extra };
    },
    editMessageText: async (messageId, text, extra) => {
      events.push(`edit:${messageId}`);
      replies.push({ text, extra });
      return { message_id: messageId, text, extra };
    },
  };

  User.findOneAndUpdate = async (query, update) => {
    updates.push(update);
    if (update?.$set) Object.assign(ctx.user, update.$set);
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => {
        throw new Error("Back should not block on generic callback deletion");
      },
      editCallbackMessageOrReply: async (callbackCtx, text, extra) => (
        callbackCtx.editMessageText(callbackCtx.callbackMessageId, text, extra)
      ),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(ctx.user.state, "idle");
  assert.equal(ctx.user.aiSectionEntryMessageId, null);
  assert.deepEqual(events, ["delete:44", "edit:77"]);
  assert.equal(replies.at(-1).text, `${messages.en.aiAssistant}\n\n${messages.en.aiAssistantMenu}`);
  assert.ok(updates.some((update) => update?.state === "idle"));
});

test("AI top-ten Back deletes the list card before fallback reply when edit fails", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const events = [];

  const ctx = {
    callbackData: `${callBacks.aiListManageBack}movies`,
    callbackMessageId: 77,
    userId: 82,
    user: {
      userId: 82,
      lang: "en",
      state: "ai_manage_movies_top_ten",
      aiLastListMessageId: 77,
      aiLastListSection: "movies",
      aiLastListType: "topTen",
      aiSectionEntryMessageId: 44,
      aiLists: {
        movies: {
          topTen: [{ title: "Arrival" }],
          watchlist: [],
        },
      },
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      events.push(`delete:${messageId}`);
      return true;
    },
    editMessageText: async (messageId) => {
      events.push(`edit:${messageId}:false`);
      return false;
    },
    reply: async (text, extra) => {
      events.push("reply");
      return { message_id: 120, text, extra };
    },
  };

  User.findOneAndUpdate = async (query, update) => {
    if (update?.$set) Object.assign(ctx.user, update.$set);
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => {
        throw new Error("Back should delete the tracked list card directly");
      },
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(events, ["delete:44", "edit:77:false", "delete:77", "reply"]);
  assert.equal(ctx.user.aiLastListMessageId, null);
  assert.equal(ctx.user.aiLastListSection, "");
  assert.equal(ctx.user.aiLastListType, "");
});

test("empty AI watchlist manager uses an intentional empty-state message", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];

  const ctx = {
    callbackData: `${callBacks.aiListManageMenu}music:watchlist`,
    callbackMessageId: 63,
    userId: 85,
    user: {
      userId: 85,
      lang: "fa",
      state: "ai_chat_music",
      aiLists: {
        music: {
          topTen: [],
          watchlist: [],
        },
      },
    },
    answerCb: async () => true,
    deleteMessage: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 130 + replies.length };
    },
  };

  User.findOneAndUpdate = async (query, update) => {
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await handleAiCallback(ctx, "fa", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const managerReply = replies.at(-1);
  const buttons = managerReply.extra.reply_markup.inline_keyboard.flat();
  const labels = buttons.map((button) => button.text);

  assert.match(managerReply.text, /هنوز خالیه/);
  assert.match(managerReply.text, /اولین مورد/);
  assert.equal(labels.includes(messages.fa.aiListManageAddLaterMusic), true);
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.aiListManageShow}music:watchlist`), false);
});

test("sharing AI list renders clean titles and comments without management commands", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];

  const ctx = {
    callbackData: `${callBacks.aiListManageShare}movies:watchlist`,
    callbackMessageId: 61,
    userId: 83,
    user: {
      userId: 83,
      lang: "en",
      state: "ai_manage_movies_watchlist",
      aiLists: {
        movies: {
          topTen: [],
          watchlist: [
            { title: "Arrival", comment: "quiet sci-fi", watched: true },
            { title: "Heat" },
            { title: "Dune" },
            { title: "Alien" },
            { title: "Her" },
            { title: "Jaws", comment: "classic" },
          ],
        },
      },
    },
    answerCb: async () => true,
    deleteMessage: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 110 + replies.length };
    },
  };

  User.findOneAndUpdate = async (query, update) => {
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const sharedReply = replies.at(-2);
  const introReply = replies.at(-1);

  assert.equal(introReply.text, messages.en.aiListShareIntro);
  assert.equal(
    introReply.extra.reply_markup.inline_keyboard.flat().some((button) => button.callback_data === `${callBacks.aiListShareBack}movies:watchlist`),
    true,
  );
  assert.equal(
    introReply.extra.reply_markup.inline_keyboard.flat().some((button) => button.text === "🔙 Back to 🎬 watch later"),
    true,
  );
  assert.equal(introReply.extra.reply_markup.inline_keyboard.flat().length, 1);
  assert.match(introReply.text, /👆/);
  assert.equal(ctx.user.aiActionMessageId, 112);
  assert.equal(ctx.user.aiActionContext, "share:movies:watchlist");
  assert.doesNotMatch(sharedReply.text, /📌/);
  assert.match(sharedReply.text, /Arrival — quiet sci-fi/);
  assert.match(sharedReply.text, /Jaws — classic/);
  assert.doesNotMatch(sharedReply.text, /\/cm_mv_l_1/);
  assert.doesNotMatch(sharedReply.text, /\/rm_mv_l_1/);
  assert.doesNotMatch(sharedReply.text, /Change to watched/);
  assert.equal(sharedReply.extra, undefined);
});

test("AI share return button consumes guidance card before reopening list", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const deleted = [];
  const ctx = {
    callbackData: `${callBacks.aiListShareBack}movies:watchlist`,
    callbackMessageId: 77,
    userId: 84,
    user: {
      userId: 84,
      lang: "en",
      state: "ai_manage_movies_watchlist",
      aiLists: {
        movies: {
          topTen: [],
          watchlist: [
            { title: "Arrival", watched: true },
            { title: "Heat" },
            { title: "Dune" },
            { title: "Alien" },
            { title: "Her" },
            { title: "Jaws" },
          ],
        },
      },
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deleted.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 210 + replies.length };
    },
  };

  User.findOneAndUpdate = async (query, update) => {
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => {
        throw new Error("generic fallback should not be needed");
      },
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deleted, [77]);
  assert.equal(ctx.user.aiActionMessageId, null);
  assert.equal(ctx.user.aiActionContext, "");
  assert.match(replies.at(-1).text, /🎬 watch later/);
  assert.ok(replies.at(-1).extra?.reply_markup?.inline_keyboard);
});

test("back to list after adding uses current item count for share button", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];

  const ctx = {
    callbackData: `${callBacks.aiListManageCancelAdd}random:top_ten:back`,
    callbackMessageId: 62,
    userId: 84,
    user: {
      userId: 84,
      lang: "en",
      state: "ai_manage_random_top_ten_add_input",
      aiLists: {
        random: {
          topTen: [
            { title: "Chess" },
            { title: "Coding" },
            { title: "Coffee" },
            { title: "Travel" },
            { title: "Photography" },
            { title: "Writing" },
          ],
        },
      },
    },
    answerCb: async () => true,
    deleteMessage: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 120 + replies.length };
    },
  };

  User.findOneAndUpdate = async (query, update) => {
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const managerReply = replies.at(-1);
  const buttons = managerReply.extra.reply_markup.inline_keyboard.flat();
  const labels = buttons.map((button) => button.text);

  assert.equal(ctx.user.state, "ai_manage_random_top_ten");
  assert.match(managerReply.text, /Chess/);
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.aiListManageShow}random:top_ten`), false);
  assert.equal(labels.includes(messages.en.aiListManageShare), true);
});

test("Top Ten add flow stays open for the next item", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const edits = [];

  User.findOne = async () => ({
    userId: 77,
    aiLists: { random: { topTen: [] } },
  });
  User.findOneAndUpdate = async () => ({});

  const ctx = {
    userId: 77,
    user: {
      userId: 77,
      lang: "en",
      state: "ai_manage_random_top_ten_add_input",
      aiLists: { random: { topTen: [] } },
      aiLastListMessageId: 38,
      aiLastListSection: "random",
      aiLastListType: "topTen",
    },
    deleteMessage: async (messageId) => {
      replies.push({ text: `deleted:${messageId}` });
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return { message_id: messageId };
    },
  };

  try {
    await handleAiText(ctx, "en", "Chess", ctx.user.state);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const finalEdit = edits.at(-1);
  const buttons = finalEdit.extra.reply_markup.inline_keyboard.flat();

  assert.equal(ctx.user.state, "ai_manage_random_top_ten_add_input");
  assert.equal(replies.some((reply) => reply.text === "deleted:38"), true);
  assert.match(finalEdit.text, /Added "Chess"|Saved "Chess"|Chess/);
  assert.match(finalEdit.text, /Send the next title here/);
  assert.equal(buttons.some((button) => button.text === messages.en.aiListManageAddBackToList), true);
  assert.equal(buttons.some((button) => button.text === messages.en.cancelEdit), false);
  assert.equal(buttons.some((button) => button.text.includes("Chess")), false);
  assert.deepEqual(ctx.user.aiLists.random.topTen.map((entry) => entry.title), ["Chess"]);
});

test("Top Ten duplicate response stays in add mode with bot copy and continuous-add controls", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const existingItems = [{ title: "Arrival" }, { title: "Second Movie" }];

  User.findOne = async () => ({
    userId: 79,
    aiLists: { movies: { topTen: existingItems } },
  });
  User.findOneAndUpdate = async () => ({});

  const ctx = {
    userId: 79,
    user: {
      userId: 79,
      lang: "en",
      state: "ai_manage_movies_top_ten_add_input",
      aiLists: { movies: { topTen: existingItems } },
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  try {
    await handleAiText(ctx, "en", "Second Movie", ctx.user.state);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const reply = replies.at(-1);
  const buttons = reply.extra.reply_markup.inline_keyboard.flat();

  assert.match(reply.text, /^👩‍🦳/);
  assert.match(reply.text, /2\/10/);
  assert.equal(ctx.user.state, "ai_manage_movies_top_ten_add_input");
  assert.equal(buttons.some((button) => button.text === messages.en.aiListManageAddBackToList), true);
  assert.equal(buttons.some((button) => button.text === messages.en.aiListManageAdd), false);
});

test("Top Ten add flow returns to manager when the 10th item completes the list", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const edits = [];
  const initialItems = [
    "Chess",
    "Coding",
    "Gaming",
    "Movies",
    "Music",
    "Books",
    "Anime",
    "Football",
    "Gym",
  ].map((title) => ({ title }));

  User.findOne = async () => ({
    userId: 87,
    aiLists: { random: { topTen: initialItems } },
  });
  User.findOneAndUpdate = async () => ({});

  const ctx = {
    userId: 87,
    user: {
      userId: 87,
      lang: "en",
      state: "ai_manage_random_top_ten_add_input",
      aiLists: { random: { topTen: [...initialItems] } },
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return { message_id: messageId };
    },
  };

  try {
    await handleAiText(ctx, "en", "Travel", ctx.user.state);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const savedEdit = edits.at(-1);
  const managerReply = replies.at(-1);
  const buttons = managerReply.extra.reply_markup.inline_keyboard.flat();
  const labels = buttons.map((button) => button.text);

  assert.equal(ctx.user.state, "ai_manage_random_top_ten");
  assert.equal(savedEdit.extra, undefined);
  assert.equal(labels.includes(messages.en.aiListManageAdd), false);
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.aiListManageShow}random:top_ten`), false);
  assert.equal(labels.includes(messages.en.aiListManageShare), true);
});

test("Top Ten add limit uses local bot-marked copy inside top-ten section", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const fullTopTen = Array.from({ length: 10 }, (_, index) => ({ title: `Item ${index + 1}` }));

  User.findOne = async () => ({
    userId: 86,
    aiLists: { random: { topTen: fullTopTen } },
  });
  User.findOneAndUpdate = async () => ({});

  const ctx = {
    userId: 86,
    user: {
      userId: 86,
      lang: "fa",
      state: "ai_manage_random_top_ten_add_input",
      aiLists: { random: { topTen: fullTopTen } },
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  try {
    await handleAiText(ctx, "fa", "مورد جدید", ctx.user.state);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const reply = replies.at(-1);

  assert.match(reply.text, /^👩‍🦳/);
  assert.match(reply.text, /همین تاپ ۱۰/);
  assert.doesNotMatch(reply.text, /به بخش تاپ ۱۰ برو/);
});

test("watchlist add flow stays open for the next item", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];

  User.findOne = async () => ({
    userId: 78,
    aiLists: { movies: { watchlist: [], topTen: [] } },
  });
  User.findOneAndUpdate = async () => ({});

  const ctx = {
    userId: 78,
    user: {
      userId: 78,
      lang: "en",
      state: "ai_manage_movies_watchlist_add_input",
      aiLists: { movies: { watchlist: [], topTen: [] } },
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  try {
    await handleAiText(ctx, "en", "Arrival", ctx.user.state);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const savedReply = replies.at(-1);
  const buttons = savedReply.extra.reply_markup.inline_keyboard.flat();

  assert.equal(ctx.user.state, "ai_manage_movies_watchlist_add_input");
  assert.match(savedReply.text, /Saved to 🎬 watch later/);
  assert.match(savedReply.text, /Send the next title here/);
  assert.doesNotMatch(savedReply.text, /Star|⭐/);
  assert.equal(buttons.some((button) => button.text === messages.en.aiListManageAddBackToList), true);
  assert.equal(buttons.some((button) => button.text === messages.en.cancelEdit), false);
  assert.deepEqual(ctx.user.aiLists.movies.watchlist.map((entry) => entry.title), ["Arrival"]);
});

test("Interests editor shares the paged onboarding chip catalog", () => {
  const firstPage = aiInterestTopTenChipKeyboard("en", ["شطرنج"], 0);
  const secondPage = aiInterestTopTenChipKeyboard("en", [], 1);
  const firstButtons = firstPage.reply_markup.inline_keyboard.flat();
  const secondButtons = secondPage.reply_markup.inline_keyboard.flat();
  const firstInterestButtons = firstButtons.filter((button) => (
    button.callback_data.startsWith(callBacks.aiInterestTopTenChip)
  ));

  assert.equal(firstButtons.some((button) => button.text.includes("Chess")), false);
  assert.equal(firstInterestButtons.length, 9);
  assert.equal(firstButtons.some((button) => button.text.includes("Movies")), true);
  assert.equal(firstButtons.some((button) => button.callback_data === `${callBacks.aiInterestTopTenMore}1`), true);
  assert.equal(secondButtons.some((button) => button.text.includes("Art")), true);
  assert.equal(getInterestTopTenChipTitle(9, "en"), "Art");
});

test("AI callback predicate keeps AI cards only for AI callbacks", () => {
  assert.equal(isAiCallback(callBacks.aiListManageMenu), true);
  assert.equal(isAiCallback(`${callBacks.aiListManageShow}movies:watchlist`), true);
  assert.equal(isAiCallback(`${callBacks.aiListManageShare}movies:watchlist`), true);
  assert.equal(isAiCallback(`${callBacks.aiSectionSuggestWithContext}books`), true);
  assert.equal(isAiCallback(callBacks.aiBack), true);

  assert.equal(isAiCallback(callBacks.profile), false);
  assert.equal(isAiCallback(callBacks.discussions), false);
  assert.equal(shouldKeepAiListTitleForCallback(callBacks.aiAssistant, isAiCallback), false);
  assert.equal(shouldKeepAiListTitleForCallback(callBacks.profile, isAiCallback), false);
});

test("suggestion callbacks are valid only inside their matching AI state", () => {
  const fromTopTen = `${callBacks.aiSectionSuggestFromTopTen}movies`;
  const withContext = `${callBacks.aiSectionSuggestWithContext}books`;
  const cancelContext = `${callBacks.aiSectionSuggestContextCancel}books`;

  assert.equal(isSuggestionCallbackValidForState(fromTopTen, "ai_chat_movies"), true);
  assert.equal(isSuggestionCallbackValidForState(fromTopTen, "ai_manage_movies_top_ten"), true);
  assert.equal(isSuggestionCallbackValidForState(fromTopTen, "idle"), false);
  assert.equal(isSuggestionCallbackValidForState(withContext, "ai_chat_books"), true);
  assert.equal(isSuggestionCallbackValidForState(withContext, "ai_chat_movies"), false);
  assert.equal(isSuggestionCallbackValidForState(cancelContext, "ai_suggest_context_books"), true);
  assert.equal(isSuggestionCallbackValidForState(cancelContext, "idle"), false);
});

test("suggestion callback reuses the tapped card as the waiting/result card", async () => {
  const originalFindOne = User.findOne;
  const edits = [];
  const replies = [];
  const deletedIds = [];
  const now = new Date();

  User.findOne = async () => ({
    userId: 77,
    aiSuggestionUsage: {
      music: Array.from({ length: 10 }, () => now),
    },
  });

  const ctx = {
    callbackData: `${callBacks.aiSectionSuggestFromTopTen}music`,
    callbackMessageId: 55,
    userId: 77,
    user: {
      userId: 77,
      lang: "en",
      state: "ai_chat_music",
      aiLists: {
        music: {
          topTen: [{ title: "A" }, { title: "B" }, { title: "C" }],
          watchlist: [],
        },
      },
    },
    answerCb: async () => true,
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return { message_id: messageId, text, extra };
    },
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 + replies.length, text, extra };
    },
  };

  try {
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
    });
  } finally {
    User.findOne = originalFindOne;
  }

  assert.deepEqual(deletedIds, []);
  assert.deepEqual(replies, []);
  assert.equal(edits[0].messageId, 55);
  assert.equal(edits[0].text, messages.en.aiThinking);
  assert.equal(edits.at(-1).messageId, 55);
  assert.match(edits.at(-1).text, /free suggestions/);
});

test("AI remembered-card cleanup leaves kept or missing cards alone", async () => {
  const deletedIds = [];
  const ctx = {
    userId: 7,
    user: {
      aiSectionEntryMessageId: 43,
    },
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
  };

  assert.equal(await clearRememberedAiListMessage(ctx), false);
  assert.equal(await clearAiSectionEntryMessage(ctx, [43]), false);
  assert.deepEqual(deletedIds, []);
});

test("AI list UI renders top-ten badges, watched badges, and comments", () => {
  const topTenTitleSet = toTitleSet([{ title: "Dune" }]);
  const rendered = formatAiItemsList(
    "Watchlist",
    [
      { title: "Dune", comment: "reread", watched: true },
      { title: "Foundation", watched: false },
    ],
    "Empty",
    { topTenTitleSet, includeWatched: true },
  );

  assert.match(rendered, /1\. ✅ Dune 🏆 — reread/);
  assert.match(rendered, /2\. ⏳ Foundation/);
});

test("AI list UI builds section-titled list messages from user data", () => {
  const ctx = {
    user: {
      aiLists: {
        movies: {
          topTen: [{ title: "Heat", comment: "tight" }],
          watchlist: [{ title: "Heat" }, { title: "Arrival", comment: "rewatch" }],
        },
      },
    },
  };

  const topTenText = buildTopTenListMessage({ ctx, lang: "en", section: "movies" });
  const watchlistText = buildWatchlistMessage({ ctx, lang: "en", section: "movies" });

  assert.match(topTenText, /❤️ My favorite movies/);
  assert.match(topTenText, /1\. Heat — tight/);
  assert.match(topTenText, /Update comment 👉 \/cm_mv_t_1/);
  assert.match(topTenText, /Remove 👉 \/rm_mv_t_1/);
  assert.match(watchlistText, /1\. ⏳ Heat 🏆/);
  assert.match(watchlistText, /2\. ⏳ Arrival — rewatch/);
  assert.match(watchlistText, /────────/);
  assert.doesNotMatch(watchlistText, /\n\n────────\n\n/);
  assert.match(watchlistText, /Change to watched 👉 \/dn_mv_l_1/);
  assert.match(watchlistText, /Add comment 👉 \/cm_mv_l_1/);
  assert.match(watchlistText, /Update comment 👉 \/cm_mv_l_2/);
  assert.match(watchlistText, /Remove 👉 \/rm_mv_l_2/);
});

test("media favorites guidance progresses from first pick to suggestion unlock and completion", async () => {
  const makeCtx = (count) => ({
    userId: 501,
    user: {
      aiLists: {
        movies: {
          topTen: Array.from({ length: count }, (_, index) => ({ title: `Movie ${index + 1}` })),
        },
      },
    },
  });

  const empty = await getTopTenManageEntryMessage(makeCtx(0), "en", "movies");
  const early = await getTopTenManageEntryMessage(makeCtx(2), "en", "movies");
  const unlocked = await getTopTenManageEntryMessage(makeCtx(3), "en", "movies");

  assert.match(empty, /genuinely love/);
  assert.match(empty, /Start with 3 favorites/);
  assert.match(early, /2\/3 favorites/);
  assert.match(early, /Add 1 more/);
  assert.match(unlocked, /Suggestions unlocked/);
  assert.match(unlocked, /3\/10/);

  const emptyButtons = aiListManageMenuKeyboard("en", "books", "topTen", { itemCount: 0 })
    .reply_markup.inline_keyboard.flat();
  const earlyButtons = aiListManageMenuKeyboard("fa", "music", "topTen", { hasItems: true, itemCount: 2 })
    .reply_markup.inline_keyboard.flat();
  assert.equal(emptyButtons[0].text, messages.en.aiFavoritesAddFirstBooks);
  assert.equal(earlyButtons[0].text, messages.fa.aiFavoritesAddAnotherMusic.replace("{count}", "2").replace("{goal}", "10"));
});

test("AI share list appends configured bot link footer", () => {
  const ctx = {
    user: {
      aiLists: {
        music: {
          topTen: [{ title: "Toranj", comment: "Mohsen Namjoo" }],
        },
      },
    },
  };

  const shareText = buildShareListMessage({
    ctx,
    lang: "en",
    section: "music",
    listType: "topTen",
    botLink: "https://ble.ir/@Muze",
  });

  assert.match(shareText, /❤️ My favorite songs/);
  assert.match(shareText, /1\. Toranj — Mohsen Namjoo/);
  assert.match(shareText, /Made with: https:\/\/ble\.ir\/@Muze/);
  assert.doesNotMatch(shareText, /📌/);
});

test("watchlist action labels use section-specific status wording", () => {
  const ctx = {
    user: {
      aiLists: {
        movies: {
          topTen: [],
          watchlist: [{ title: "Arrival", watched: false }],
        },
        music: {
          topTen: [],
          watchlist: [{ title: "Nights", watched: true }],
        },
      },
    },
  };

  const movieText = buildWatchlistMessage({ ctx, lang: "fa", section: "movies" });
  const musicText = buildWatchlistMessage({ ctx, lang: "en", section: "music" });

  assert.match(movieText, /تغییر به دیده‌شده 👈 \/dn_mv_l_1/);
  assert.doesNotMatch(movieText, /دیده شد 👈 \/dn_mv_l_1/);
  assert.doesNotMatch(movieText, /انجام شد 👈 \/dn_mv_l_1/);
  assert.match(musicText, /Change to not listened 👉 \/un_mu_l_1/);
});

test("AI list manager keyboard shows list/filter/share controls only when eligible", () => {
  const emptyKeyboard = aiListManageMenuKeyboard("en", "movies", "watchlist");
  const emptyButtons = emptyKeyboard.reply_markup.inline_keyboard.flat();
  const emptyLabels = emptyButtons.map((button) => button.text);
  const keyboard = aiListManageMenuKeyboard("en", "movies", "watchlist", { hasItems: true });
  const buttons = keyboard.reply_markup.inline_keyboard.flat();
  const labels = buttons.map((button) => button.text);
  const shareKeyboard = aiListManageMenuKeyboard("en", "movies", "watchlist", { hasItems: true, itemCount: 6 });
  const shareLabels = shareKeyboard.reply_markup.inline_keyboard.flat().map((button) => button.text);

  assert.equal(emptyButtons.some((button) => button.callback_data === `${callBacks.aiListManageShow}movies:watchlist`), false);
  assert.equal(emptyLabels.includes(messages.en.aiListManageShare), false);
  assert.equal(emptyLabels.includes(messages.en.aiListManageShowWatchedMovies), false);
  assert.ok(labels.includes(messages.en.aiListManageAddLaterMovies));
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.aiListManageShow}movies:watchlist`), false);
  assert.equal(labels.includes(messages.en.aiListManageShare), false);
  assert.ok(labels.includes(messages.en.aiListManageShowWatchedMovies));
  assert.ok(labels.includes(messages.en.aiListManageShowNotWatchedMovies));
  assert.ok(shareLabels.includes(messages.en.aiListManageShare));
  assert.equal(
    aiListManageMenuKeyboard("en", "movies", "topTen", { hasItems: true, itemCount: 10 })
      .reply_markup.inline_keyboard.flat()
      .some((button) => button.text === messages.en.aiListManageAdd),
    false,
  );
  assert.ok(labels.includes(messages.en.aiListBackToTopTen));
  assert.ok(
    aiListManageMenuKeyboard("en", "movies", "topTen", { hasItems: true, itemCount: 1 })
      .reply_markup.inline_keyboard.flat()
      .some((button) => button.callback_data === `${callBacks.aiListManageMenu}movies:watchlist`),
  );
  assert.equal(
    aiListManageMenuKeyboard("en", "movies", "topTen", { hasItems: true, itemCount: 1 })
      .reply_markup.inline_keyboard.flat()
      .some((button) => button.callback_data === `${callBacks.aiSectionSuggestMenu}movies`),
    false,
  );
  assert.ok(
    aiListManageMenuKeyboard("en", "movies", "topTen", { hasItems: true, itemCount: 3 })
      .reply_markup.inline_keyboard.flat()
      .some((button) => button.callback_data === `${callBacks.aiSectionSuggestMenu}movies`),
  );
  assert.equal(labels.includes(messages.en.aiListManageRemove), false);
  assert.equal(labels.includes(messages.en.aiListManageComment), false);
  assert.equal(labels.includes(messages.en.aiListManageMoveToTopTen), false);
});

test("watchlist entry rendering always exposes done and not-done status", () => {
  const ctx = {
    user: {
      aiLists: {
        random: {
          topTen: [],
          watchlist: [
            { title: "Lichess puzzles", watched: true },
            { title: "Photo walk", watched: false },
          ],
        },
      },
    },
  };

  const rendered = buildWatchlistMessage({ ctx, lang: "en", section: "random" });

  assert.match(rendered, /1\. ✅ Lichess puzzles/);
  assert.match(rendered, /2\. ⏳ Photo walk/);
});

test("AI list UI uses specific duplicate and Top Ten requirement copy", () => {
  assert.equal(
    getDuplicateListMessage("en", { duplicate: { title: "Arrival" } }),
    messages.en.aiListDuplicateMatch.replace("{item}", "Arrival"),
  );
  assert.equal(
    getNeedTopTenMessage("en", "books"),
    messages.en.aiSectionSuggestNeedTopTenItem.replace("{section}", messages.en.aiSectionNameBooks),
  );
});
