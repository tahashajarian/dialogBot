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
  openAiListManager,
  shouldStartAutomaticTasteCheck,
} = require("../src/flows/ai-text");
const User = require("../src/models/user");
const AiPaidSuggestion = require("../src/models/ai-paid-suggestion");
const { starEconomy } = require("../src/services/star-settings");
const { buildAiAssistantMenuMessage } = require("../src/services/ai-list-ui");
const { sendAiAssistantHub } = require("../src/flows/ai-hub");
const { handleCallback } = require("../src/callbacks");
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
  aiWatchlistCardKeyboard,
  aiInterestTopTenChipKeyboard,
  aiPaidSuggestionConfirmKeyboard,
  aiSuggestionModeKeyboard,
  aiSuggestionLimitKeyboard,
  getInterestTopTenChipTitle,
} = require("../src/keyboards");

const keyboardButtons = (keyboard) => (
  keyboard?.reply_markup?.keyboard || keyboard?.reply_markup?.inline_keyboard || []
).flat();

test("Favorites first-visit guidance stays inside the existing bilingual hub", () => {
  for (const lang of ["fa", "en"]) {
    const normal = buildAiAssistantMenuMessage(lang);
    const firstVisit = buildAiAssistantMenuMessage(lang, { showFirstVisitTip: true });

    assert.equal(normal.includes(messages[lang].favoritesFirstVisitTip), false);
    assert.equal(firstVisit, [
      messages[lang].aiAssistantTitle,
      messages[lang].favoritesFirstVisitTip,
      messages[lang].aiAssistantMenu,
    ].join("\n\n"));
    assert.match(messages[lang].favoritesFirstVisitTip, /^💡/);
  }
});

test("Favorites hub sends its banner once and keeps later entries text-only", async () => {
  const sent = [];
  const ctx = {
    user: { userId: 11 },
    reply: async (text, extra) => {
      sent.push({ text, extra });
      return { message_id: sent.length, text, extra };
    },
    replyWithPhoto: async (photo, extra) => {
      sent.push({ photo, extra });
      return { message_id: sent.length, photo, caption: extra.caption };
    },
  };

  await sendAiAssistantHub(ctx, "en");
  await sendAiAssistantHub(ctx, "en");

  assert.equal(sent.length, 2);
  assert.match(sent[0].photo.source, /assets[\\/]favorites-hub-banner\.jpg$/);
  assert.match(sent[0].extra.caption, new RegExp(messages.en.aiAssistantTitle));
  assert.ok(sent[0].extra.reply_markup.keyboard.length > 0);
  assert.equal(sent[1].photo, undefined);
  assert.match(sent[1].text, new RegExp(messages.en.aiAssistantTitle));
  assert.ok(ctx.user.sectionTipsShownAt.favoritesBanner instanceof Date);
});

test("failed Favorites banner delivery falls back to text without marking the banner shown", async () => {
  const ctx = {
    user: { userId: 16 },
    reply: async (text, extra) => ({ message_id: 1, text, extra }),
    replyWithPhoto: async () => {
      throw new Error("photo delivery failed");
    },
  };

  const sent = await sendAiAssistantHub(ctx, "en");

  assert.match(sent.text, new RegExp(messages.en.aiAssistantTitle));
  assert.equal(ctx.user.sectionTipsShownAt, undefined);
});

test("Favorites entry shows its tip once and failed hub delivery does not mark it", async () => {
  const replies = [];
  const ctx = {
    callbackData: callBacks.aiAssistant,
    callbackMessageId: 12,
    userId: 12,
    user: { userId: 12, lang: "en" },
    answerCb: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  await handleCallback(ctx);
  await handleCallback(ctx);
  const hubs = replies.filter((entry) => entry.text.startsWith(messages.en.aiAssistantTitle));
  assert.equal(hubs.length, 2);
  assert.match(hubs[0].text, /Favorites are things you genuinely love/);
  assert.doesNotMatch(hubs[1].text, /Favorites are things you genuinely love/);
  assert.ok(ctx.user.sectionTipsShownAt.favorites instanceof Date);

  const failedCtx = {
    callbackData: callBacks.aiAssistant,
    callbackMessageId: 13,
    userId: 13,
    user: { userId: 13, lang: "en" },
    answerCb: async () => true,
    reply: async () => {
      throw new Error("delivery failed");
    },
  };
  await assert.rejects(handleCallback(failedCtx), /delivery failed/);
  assert.equal(failedCtx.user.sectionTipsShownAt, undefined);
});

test("For Later shows its inline-capture tip once and marks it only after delivery", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const ctx = {
    botInfo: { username: "hey_muze_test_bot" },
    userId: 14,
    user: {
      userId: 14,
      lang: "fa",
      aiLists: { movies: { topTen: [], watchlist: [] } },
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length, text, extra };
    },
  };
  User.findOneAndUpdate = async () => ctx.user;

  try {
    await openAiListManager(ctx, "fa", "movies", "watchlist");
    await openAiListManager(ctx, "fa", "movies", "watchlist");
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.match(replies[0].text, /@hey_muze_test_bot/);
  assert.match(replies[0].text, /برای بعد ذخیره کنی/);
  assert.doesNotMatch(replies[1].text, /@hey_muze_test_bot/);
  assert.ok(ctx.user.sectionTipsShownAt.forLaterInline instanceof Date);

  const failedCtx = {
    botInfo: { username: "hey_muze_test_bot" },
    userId: 15,
    user: {
      userId: 15,
      lang: "en",
      aiLists: { books: { topTen: [], watchlist: [] } },
    },
    reply: async () => {
      throw new Error("delivery failed");
    },
  };
  User.findOneAndUpdate = async () => failedCtx.user;
  try {
    await assert.rejects(
      openAiListManager(failedCtx, "en", "books", "watchlist"),
      /delivery failed/,
    );
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
  assert.equal(failedCtx.user.sectionTipsShownAt, undefined);
});

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
  assert.equal(buttons[1].text, messages.en.aiSuggestionPaidCancelButton);
  assert.equal(buttons[1].callback_data, `${callBacks.aiPaidSuggestionCancel}music`);
  assert.equal(buttons.length, 2);
});

test("suggestion limit offers paid confirmation when Stars spending is enabled", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalCreate = AiPaidSuggestion.create;
  const originalSettings = { ...starEconomy };
  const replies = [];
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
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length, text, extra };
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

  const finalReply = replies.at(-1);
  const buttons = finalReply.extra.reply_markup.inline_keyboard.flat();
  assert.match(finalReply.text, /free suggestions/);
  assert.match(finalReply.text, /1 Star/);
  assert.equal(buttons[0].callback_data, `${callBacks.aiPaidSuggestionConfirm}PAID91`);
  assert.equal(buttons[1].callback_data, `${callBacks.aiPaidSuggestionCancel}music`);
});
const {
  handleAiCallback,
  isAiCallback,
  isSuggestionCallbackValidForState,
} = require("../src/flows/ai-callbacks");
const {
  getSuggestionMood,
  setSuggestionMood,
} = require("../src/services/ai-suggestion-cache");
const {
  clearAiSectionEntryMessage,
  clearRememberedAiListMessage,
  shouldKeepAiListTitleForCallback,
} = require("../src/flows/ai-cards");
const {
  buildTopTenListMessage,
  buildTopTenSavedMessage,
  buildWatchlistMessage,
  formatAiItemsList,
  getDuplicateListMessage,
  getNeedTopTenMessage,
  getTopTenManageEntryMessage,
  toTitleSet,
} = require("../src/services/ai-list-ui");
const { resolveReplyKeyboardAction } = require("../src/services/reply-keyboard-navigation");

test("AI text state predicate recognizes only AI-owned text states", () => {
  assert.equal(isAiTextState("ai_chat_movies"), true);
  assert.equal(isAiTextState("ai_manage_music_top_ten_add_input"), true);
  assert.equal(isAiTextState("ai_manage_random_watchlist_comment_input"), true);
  assert.equal(isAiTextState("ai_suggest_context_books"), true);
  assert.equal(isAiTextState("ai_suggest_generating_books"), true);

  assert.equal(isAiTextState("editing_name"), false);
  assert.equal(isAiTextState("discussion_create_title"), false);
  assert.equal(isAiTextState("idle"), false);
});

test("AI text button predicates accept localized keyboard labels", () => {
  assert.equal(isAiBackText(messages.en.aiBack), true);
  assert.equal(isAiBackText(messages.fa.aiBack), true);
  assert.equal(isAiBackText("Back"), true);
  assert.equal(isAiBackText("برگشت"), true);

  assert.equal(isAiSectionListText(messages.en.aiSectionListButtonMovies, "movies"), true);
  assert.equal(isAiSectionListText(messages.fa.aiSectionListButtonRandom, "random"), true);
  assert.equal(isAiSectionTopTenText(messages.en.aiSectionTopTenButton), true);
  assert.equal(isAiSectionTopTenText(`🎵 ${messages.fa.aiSectionTopTenButton}`), true);
  assert.equal(isAiSectionSuggestText(messages.fa.aiSectionSuggestButton), true);
  assert.equal(isAiSectionSuggestText(`🎬 ${messages.en.aiSectionSuggestButton}`), true);
});

test("a taste check starts automatically only before the first attempt or successful free result", () => {
  assert.equal(shouldStartAutomaticTasteCheck({}), true);
  assert.equal(shouldStartAutomaticTasteCheck({
    freeClassificationAutoAttemptedAt: new Date("2026-01-01T00:00:00Z"),
  }), false);
  assert.equal(shouldStartAutomaticTasteCheck({
    freeClassificationUsedAt: new Date("2026-01-01T00:00:00Z"),
  }), false);
});

test("suggestion save buttons name the concrete section list", () => {
  const musicAddButtons = keyboardButtons(aiSuggestionAddKeyboard("en", "music"));
  const booksAddedButtons = keyboardButtons(aiSuggestionAddedOptionsKeyboard("fa", "books"));
  const rejectedButtons = keyboardButtons(aiSuggestionNextKeyboard("fa", "movies"));

  assert.equal(musicAddButtons[0].text, "➕ Save to 🎵📋 listen later list");
  assert.equal(booksAddedButtons[1].text, "رفتن به 📚📋 لیست «بعدا می‌خونم»");
  assert.equal(booksAddedButtons[2].text, "❤️ رفتن به لیست «محبوب‌ها»");
  assert.equal(rejectedButtons[1].text, "❤️ رفتن به لیست «محبوب‌ها»");
  assert.equal(messages.en.aiSuggestionAdded.replace("{listName}", "📚📋 read later list"), "👩‍🦳 Saved to 📚📋 read later list.");
  assert.equal(messages.fa.aiSuggestionAdded.replace("{listName}", "🎵📋 لیست «بعدا گوش می‌دم»"), "👩‍🦳 در 🎵📋 لیست «بعدا گوش می‌دم» ذخیره شد.");
  assert.equal(messages.fa.aiSuggestionAddedDoneMovies, "👩‍🦳 در 🎬📋 لیست «بعدا می‌بینم» ذخیره شد. (دیده‌شده)");
  assert.equal(messages.fa.aiSuggestionAddedDoneMusic, "👩‍🦳 در 🎵📋 لیست «بعدا گوش می‌دم» ذخیره شد. (گوش‌داده‌شده)");
  assert.equal(messages.fa.aiSuggestionAddedDoneBooks, "👩‍🦳 در 📚📋 لیست «بعدا می‌خونم» ذخیره شد. (خوانده‌شده)");
  assert.doesNotMatch(messages.fa.aiSuggestionChooseAction, /حالا|بعدش/);
  assert.doesNotMatch(messages.fa.aiSuggestionNextGuidance, /حالا/);
});

test("AI-authored list promotion confirmation uses the Muze emoji", () => {
  assert.equal(messages.fa.aiWatchlistPromotedToTopTen, "👩‍🦳 به محبوب‌هات اضافه شد.");
  assert.equal(messages.en.aiWatchlistPromotedToTopTen, "👩‍🦳 Added to your favorites.");
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

test("AI bottom Back replaces reply controls with the media hub keyboard", async () => {
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

  assert.equal(replies.length, 2);
  assert.equal(replies[0].text, "⁣");
  assert.equal(replies[0].extra?.reply_markup?.remove_keyboard, true);
  assert.equal(replies[1].text, `${messages.fa.aiAssistantTitle}\n\n${messages.fa.aiAssistantMenu}`);
  assert.equal(keyboardButtons(replies[1].extra).at(-1).text, messages.fa.aiBack);
  assert.equal(edits.length, 0);
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

test("music add prompt accepts songs, albums, artists, bands, and titled audio", () => {
  assert.equal(getAiListAddPrompt("en", "music", "topTen"), messages.en.aiMusicFavoritesAddPrompt);
  assert.equal(getAiListAddPrompt("fa", "books", "topTen"), messages.fa.aiBookFavoritesAddPrompt);
  assert.match(getAiListAddPrompt("en", "movies", "topTen"), /movie or series/);
  assert.match(getAiListAddPrompt("fa", "movies", "topTen"), /فیلم یا سریال/);
  assert.match(messages.en.aiMusicListManageAddPrompt, /song, album, artist, or band/);
  assert.match(messages.fa.aiMusicListManageAddPrompt, /آهنگ، آلبوم، خواننده یا گروه موسیقی/);
});

test("add prompt starts with Cancel and post-save prompt returns to list", () => {
  const firstPrompt = aiListCancelAddKeyboard("en", "movies", "watchlist");
  const nextPrompt = aiListCancelAddKeyboard("en", "movies", "watchlist", { backToList: true });
  const firstInterestPrompt = aiInterestTopTenChipKeyboard("en", [], 0);
  const nextInterestPrompt = aiInterestTopTenChipKeyboard("en", ["Chess"], 0, { backToList: true });

  assert.equal(keyboardButtons(firstPrompt).at(-1).text, messages.en.cancelEdit);
  assert.equal(keyboardButtons(nextPrompt).at(-1).text, messages.en.aiListManageAddBackToList);
  assert.equal(keyboardButtons(firstInterestPrompt).at(-1).text, messages.en.cancelEdit);
  assert.equal(keyboardButtons(nextInterestPrompt).at(-1).text, messages.en.aiListManageAddBackToList);
});

test("pressing Add retains the remembered list card", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];
  const edits = [];

  User.findOneAndUpdate = async () => ({});

  const ctx = {
    callbackData: `${callBacks.aiListManageAdd}movies:top_ten`,
    callbackMessageId: 40,
    isReplyKeyboardAction: true,
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
      deleteCallbackMessageIfPossible: async () => (
        ctx.isReplyKeyboardAction ? false : ctx.deleteMessage(ctx.callbackMessageId)
      ),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(deletedIds.includes(39), false);
  assert.equal(deletedIds.includes(40), false);
  assert.equal(ctx.user.aiLastListMessageId, null);
  assert.equal(replies.filter((reply) => reply.text === messages.en.aiMovieFavoritesAddPrompt).length, 1);
  assert.equal(replies.some((reply) => reply.text === "."), false);
  assert.equal(ctx.user.aiPendingInputMessageId, 81);
  assert.equal(edits.length, 0);
  assert.equal(keyboardButtons(replies.at(-1).extra).at(-1).text, messages.en.cancelEdit);
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
      deleteCallbackMessageIfPossible: async () => (
        ctx.isReplyKeyboardAction ? false : ctx.deleteMessage(ctx.callbackMessageId)
      ),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(replies.filter((reply) => reply.text === messages.en.aiListManageAddPrompt).length, 1);
  assert.equal(deletedIds.includes(91), false);
  assert.equal(keyboardButtons(replies.at(-1).extra).at(-1).text, messages.en.cancelEdit);
  assert.equal(ctx.user.aiPendingInputMessageId, 91);
});

test("Top Ten saved message contains only confirmation and progress guidance", async () => {
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

test("Top Ten saved message can omit its progress prompt when add mode supplies guidance", async () => {
  const text = await buildTopTenSavedMessage({
    ctx: { userId: 1 },
    lang: "fa",
    section: "books",
    item: "نتاشایباشسمنیاب",
    items: [{ title: "نتاشایباشسمنیاب" }],
    includeNextPrompt: false,
  });

  assert.match(text, /^✅/);
  assert.doesNotMatch(text, /یکی دیگه هم بفرست/);
});

test("media favorites do not show preliminary taste labels before all 10 are complete", async () => {
  const cases = [
    ["books", ["سمفونی مردگان", "سال بلوا", "بوف کور"]],
    ["movies", ["Interstellar", "Arrival", "The Matrix"]],
    ["music", ["Enter Sandman", "Master of Puppets", "Metallica"]],
  ];

  for (const [section, titles] of cases) {
    const items = titles.map((title) => ({ title }));
    const savedText = await buildTopTenSavedMessage({
      ctx: { userId: 1 }, lang: "fa", section, item: titles.at(-1), items, includeNextPrompt: false,
    });
    const managerText = await getTopTenManageEntryMessage({
      userId: 1,
      user: { aiLists: { [section]: { topTen: items } } },
    }, "fa", section);

    for (const text of [savedText, managerText]) {
      assert.match(text, /۳|3/);
      assert.match(text, /۱۰|10/);
      assert.doesNotMatch(text, /برداشت موقت|برچسب فعلی|کلاسیک‌خوان|سای‌فای‌گیک|متال‌هد/);
    }
  }
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
  const replyKeyboardMessage = replies.find((reply) => reply.extra?.reply_markup?.keyboard);
  const replyLabels = keyboardButtons(replyKeyboardMessage?.extra).map((button) => button.text);

  assert.deepEqual(deletedIds, []);
  assert.equal(ctx.user.aiSectionPendingCommentItem, null);
  assert.equal(ctx.user.aiSectionPendingCommentListType, null);
  assert.equal(ctx.user.state, "ai_manage_movies_watchlist");
  assert.match(finalReply.text, /Arrival/);
  assert.match(finalReply.text, /\/cm_mv_l_1/);
  assert.doesNotMatch(finalReply.text, /لغو شد/);
  assert.equal(replyLabels.includes(messages.fa.cancelEdit), false);
  assert.equal(replyLabels.includes(messages.fa.aiListManageAddLaterMovies), true);
  assert.equal(keyboardButtons(finalReply.extra).length, 0);
});

test("AI comment copy names the item instead of the list type", () => {
  assert.equal(
    formatAiCommentPrompt("fa", "topTen", "Dune"),
    "👩‍🦳 کامنت برای «Dune» رو بفرست (تا 120 کاراکتر).",
  );
  assert.equal(
    formatAiCommentSaved("fa", "topTen", "Dune"),
    "👩‍🦳 کامنت برای «Dune» ذخیره شد.",
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
  assert.deepEqual(deletedIds, [55, 91]);
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
    callbackData: `${callBacks.aiListManageShow}movies:watchlist`,
    callbackMessageId: 60,
    userId: 82,
    user: {
      userId: 82,
      lang: "en",
      state: "ai_manage_movies_watchlist",
      navigationMode: "ai_suggestion_added:movies",
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
  const buttons = keyboardButtons(managerReply.extra);

  assert.deepEqual(deletedIds, []);
  assert.match(managerReply.text, /Arrival/);
  assert.match(managerReply.text, /\/cm_mv_l_1/);
  assert.equal(ctx.user.state, "ai_manage_movies_watchlist");
  assert.equal(ctx.user.navigationMode, "ai_list:movies:watchlist");
  assert.equal(buttons.length, 0);
  assert.equal(
    resolveReplyKeyboardAction(messages.en.aiListManageAddLaterMovies, {
      mode: ctx.user.navigationMode,
      state: ctx.user.state,
      user: ctx.user,
    }).callbackData,
    `${callBacks.aiListManageAdd}movies:watchlist`,
  );
  assert.equal(
    resolveReplyKeyboardAction(messages.en.aiSuggestionGoToFavoritesButton, {
      mode: ctx.user.navigationMode,
      state: ctx.user.state,
      user: ctx.user,
    }).callbackData,
    `${callBacks.aiListManageBack}movies`,
  );
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.aiListManageShow}movies:watchlist`), false);
});

test("entering Books uses its banner once and keeps later manager cards text-only", async () => {
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
    replyWithPhoto: async (photo, extra) => {
      replies.push({ photo, extra });
      return { message_id: 100 + replies.length, photo, extra };
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

    ctx.callbackMessageId = 61;
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
      editCallbackMessageOrReply: async (callbackCtx, text, extra) => (
        callbackCtx.editMessageText(callbackCtx.callbackMessageId, text, extra)
      ),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deletedIds, [60, 61]);
  assert.deepEqual(edits, []);
  assert.equal(replies.length, 2);
  assert.match(replies[0].photo.source, /assets[\\/]books-section-banner\.jpg$/);
  assert.match(replies[0].extra.caption, /📚 Books/);
  assert.match(replies[0].extra.caption, /Dune/);
  assert.equal(replies[1].photo, undefined);
  assert.match(replies[1].text, /📚 Books/);
  assert.match(replies[1].text, /Dune/);
  assert.equal(ctx.user.aiSectionEntryMessageId, null);
  assert.equal(ctx.user.aiLastListMessageId, 102);
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

  assert.deepEqual(deletedIds, []);
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
      deleteCallbackMessageIfPossible: async () => (
        ctx.isReplyKeyboardAction ? false : ctx.deleteMessage(ctx.callbackMessageId)
      ),
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deletedIds, []);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /Your favorites list is still empty/);
  assert.equal(ctx.user.aiActionMessageId, null);
  assert.equal(ctx.user.aiActionContext, "");
  assert.equal(ctx.user.state, "ai_manage_music_top_ten");
});

test("suggestion mode prompt can return to the section Top Ten", async () => {
  const keyboard = aiSuggestionModeKeyboard("en", "movies");
  const buttons = keyboardButtons(keyboard);

  assert.equal(buttons.at(-1).text, messages.en.aiBack);
  assert.equal(keyboard.reply_markup.one_time_keyboard, true);
});

test("queued suggestion keyboard taps are ignored while generation is active", async () => {
  const ctx = {
    userId: 82,
    user: { userId: 82, lang: "en", state: "ai_suggest_generating_books" },
    reply: async () => {
      throw new Error("generating taps must stay quiet");
    },
  };

  assert.equal(await handleAiText(
    ctx,
    "en",
    messages.en.aiSuggestionFromTopTenButton,
    ctx.user.state,
  ), null);
  assert.equal(await handleAiText(ctx, "en", messages.en.aiBack, ctx.user.state), null);
});

test("stale Back preserves suggestion-result controls", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  User.findOneAndUpdate = async () => ({});
  const ctx = {
    userId: 83,
    user: {
      userId: 83,
      lang: "en",
      state: "ai_chat_books",
      navigationMode: "ai_suggestion_result:books",
      aiActionMessageId: 70,
      aiActionContext: "suggest_result:books",
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 80 + replies.length };
    },
  };

  try {
    await handleAiText(ctx, "en", messages.en.aiBack, ctx.user.state);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(replies.length, 1);
  for (const reply of replies) {
    assert.equal(reply.text, messages.en.aiSuggestionUseButtons);
    const buttons = keyboardButtons(reply.extra);
    assert.equal(buttons.some((button) => button.text === messages.en.aiSuggestionRejectButton), true);
    assert.equal(buttons.some((button) => button.text === messages.en.aiBack), false);
  }
  assert.equal(ctx.user.state, "ai_chat_books");
  assert.equal(ctx.user.navigationMode, "ai_suggestion_result:books");
  assert.equal(ctx.user.aiActionContext, "suggest_result:books");
});

test("typed text cannot skip feedback on a pending suggestion", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const ctx = {
    userId: 84,
    user: {
      userId: 84,
      lang: "en",
      state: "ai_chat_movies",
      navigationMode: "ai_suggestion_result:movies",
      aiActionMessageId: 70,
      aiActionContext: "suggest_result:movies",
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 80 + replies.length };
    },
  };
  User.findOneAndUpdate = async () => ({});

  try {
    await handleAiText(ctx, "en", "series only", ctx.user.state);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.en.aiSuggestionUseButtons);
  assert.equal(ctx.user.aiActionContext, "suggest_result:movies");
});

test("typed text after suggestion feedback starts a replacement mood request", async () => {
  const replies = [];
  const ctx = {
    userId: 85,
    user: {
      userId: 85,
      lang: "en",
      state: "ai_chat_movies",
      navigationMode: "ai_suggestion_next:movies",
      aiLists: {
        movies: {
          topTen: [{ title: "Arrival" }, { title: "Inception" }],
          watchlist: [],
        },
      },
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 90 + replies.length };
    },
  };

  await handleAiText(ctx, "en", "series only", ctx.user.state);

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /at least 3/i);
  assert.notEqual(replies[0].text, messages.en.aiSectionUseButtonsOnly);
});

test("suggestion mood prompt states and enforces the 80-character limit", async () => {
  const replies = [];
  const ctx = {
    userId: 82,
    user: {
      userId: 82,
      lang: "fa",
      state: "ai_suggest_context_books",
      aiLists: { books: { topTen: [{ title: "A" }, { title: "B" }, { title: "C" }], watchlist: [] } },
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length, text, extra };
    },
  };

  await handleAiText(ctx, "fa", "غمگین ".repeat(20), ctx.user.state);

  assert.match(messages.fa.aiSuggestionModePrompt, /نوع، حال‌وهوا یا ژانر/);
  assert.match(messages.fa.aiSuggestionContextPrompt, /فقط سریال/);
  assert.doesNotMatch(messages.fa.aiSuggestionModePrompt, /نویسه|کاراکتر/);
  assert.match(messages.fa.aiSuggestionContextTooLong, /۸۰ کاراکتر/);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.fa.aiSuggestionContextTooLong);
  assert.equal(ctx.user.state, "ai_suggest_context_books");
});

test("starting a fresh suggestion session clears the previous mood", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const ctx = {
    callbackData: `${callBacks.aiSectionSuggestMenu}books`,
    userId: 82,
    user: {
      userId: 82,
      lang: "en",
      state: "ai_manage_books_top_ten",
      aiLists: {
        books: {
          topTen: [{ title: "A" }, { title: "B" }, { title: "C" }],
          watchlist: [],
        },
      },
    },
    answerCb: async () => true,
    reply: async (text, extra) => ({ message_id: 201, text, extra }),
  };
  User.findOneAndUpdate = async () => ctx.user;
  setSuggestionMood(ctx.userId, "books", "dark and strange");

  try {
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => true,
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(getSuggestionMood(ctx.userId, "books"), "");
  assert.equal(ctx.user.state, "ai_suggest_context_books");
  assert.equal(ctx.user.navigationMode, "ai_suggestion_mode:books");
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
  assert.deepEqual(events, ["reply"]);
  assert.equal(replies[0].text, `${messages.en.aiAssistantTitle}\n\n${messages.en.aiAssistantMenu}`);
  assert.ok(updates.some((update) => update?.state === "idle"));
});

test("AI top-ten Back retains prior cards before fallback reply", async () => {
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
        throw new Error("Back should retain the tracked list card");
      },
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(events, ["reply"]);
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
  const buttons = keyboardButtons(managerReply.extra);
  const labels = buttons.map((button) => button.text);

  assert.match(managerReply.text, /هنوز خالیه/);
  assert.match(managerReply.text, /بعدا سراغشون بری/);
  assert.match(managerReply.text, /اولین مورد/);
  assert.equal(labels.includes(messages.fa.aiListManageAddLaterMusic), true);
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.aiListManageShow}music:watchlist`), false);
});

test("back to list after adding uses the current item count", async () => {
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
  const buttons = keyboardButtons(managerReply.extra);
  const labels = buttons.map((button) => button.text);

  assert.equal(ctx.user.state, "ai_manage_random_top_ten");
  assert.match(managerReply.text, /Chess/);
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.aiListManageShow}random:top_ten`), false);
  assert.equal(labels.some((label) => /shareable message/i.test(label)), false);
});

test("back to list works from the completion card after the 10th item", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const items = Array.from({ length: 10 }, (_, index) => ({ title: `Movie ${index + 1}` }));
  const ctx = {
    callbackData: `${callBacks.aiListManageCancelAdd}movies:top_ten:back`,
    callbackMessageId: 63,
    userId: 85,
    user: {
      userId: 85,
      lang: "en",
      state: "ai_manage_movies_top_ten",
      aiPendingInputMessageId: 63,
      aiLists: { movies: { topTen: items } },
    },
    answerCb: async () => true,
    deleteMessage: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 130 + replies.length };
    },
  };

  User.findOne = async () => ctx.user;
  User.findOneAndUpdate = async (query, update) => {
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => ctx.deleteMessage(ctx.callbackMessageId),
    });
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(ctx.user.state, "ai_manage_movies_top_ten");
  assert.match(replies.at(-1).text, /Movie 10/);
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

  const savedReply = replies.at(-1);
  const buttons = savedReply.extra.reply_markup.inline_keyboard.flat();

  assert.equal(ctx.user.state, "ai_manage_random_top_ten_add_input");
  assert.equal(replies.some((reply) => reply.text === "deleted:38"), false);
  assert.match(savedReply.text, /Added "Chess"|Saved "Chess"|Chess/);
  assert.match(savedReply.text, /Send the next title here/);
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
  const buttons = keyboardButtons(reply.extra);

  assert.match(reply.text, /^👩‍🦳/);
  assert.match(reply.text, /2\/10/);
  assert.equal(ctx.user.state, "ai_manage_movies_top_ten_add_input");
  assert.equal(buttons.some((button) => button.text === messages.en.aiListManageAddBackToList), true);
  assert.equal(buttons.some((button) => button.text === messages.en.aiListManageAdd), false);
});

test("Top Ten add flow shows completion with Back to list when the 10th item completes the list", async () => {
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

  const savedReply = replies.at(-1);
  const buttons = keyboardButtons(savedReply.extra);
  const labels = buttons.map((button) => button.text);

  assert.equal(ctx.user.state, "ai_manage_random_top_ten");
  assert.match(savedReply.text, /10\/10/);
  assert.doesNotMatch(savedReply.text, /\{goal\}/);
  assert.equal(replies.length, 1);
  assert.equal(labels.includes(messages.en.aiListManageAddBackToList), true);
  assert.equal(labels.includes(messages.en.aiListManageAdd), false);
});

test("repeat media completion returns directly to the refreshed Favorites list", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const initialItems = Array.from({ length: 9 }, (_, index) => ({ title: `Book ${index + 1}` }));
  const ctx = {
    userId: 88,
    user: {
      userId: 88,
      lang: "en",
      state: "ai_manage_books_top_ten_add_input",
      aiLists: { books: { topTen: [...initialItems], watchlist: [] } },
      aiTaste: { books: {
        labelKey: "novel_reader",
        classificationStatus: "confirmed",
        freeClassificationUsedAt: new Date("2026-01-01T00:00:00Z"),
      } },
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };
  User.findOne = async () => ctx.user;
  User.findOneAndUpdate = async () => ({});

  try {
    await handleAiText(ctx, "en", "Book 10", ctx.user.state);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const listReply = replies.at(-1);
  const labels = keyboardButtons(listReply.extra).map((button) => button.text);
  assert.equal(replies.length, 1);
  assert.equal(ctx.user.state, "ai_manage_books_top_ten");
  assert.match(listReply.text, /Saved "Book 10"/);
  assert.match(listReply.text, /Book 1/);
  assert.doesNotMatch(listReply.text, /Now we can find a label/);
  assert.equal(labels.includes(messages.en.aiListManageAddBackToList), false);
  assert.equal(labels.includes(messages.en.aiTasteReviewButton), true);
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
  assert.match(reply.text, /محبوب‌های این بخش/);
  assert.doesNotMatch(reply.text, /تاپ ۱۰/);
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
  const buttons = savedReply.extra.reply_markup.keyboard.flat();

  assert.equal(ctx.user.state, "ai_manage_movies_watchlist_add_input");
  assert.match(savedReply.text, /Saved "Arrival" to 🎬📋 watch later/);
  assert.match(savedReply.text, /Send the next title here/);
  assert.doesNotMatch(savedReply.text, /1\. Arrival/);
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
  assert.equal(secondButtons.some((button) => button.text.includes("Poetry")), true);
  assert.equal(getInterestTopTenChipTitle(9, "en"), "Poetry");
});

test("AI callback predicate keeps AI cards only for AI callbacks", () => {
  assert.equal(isAiCallback(callBacks.aiListManageMenu), true);
  assert.equal(isAiCallback(`${callBacks.aiListManageShow}movies:watchlist`), true);
  assert.equal(isAiCallback("ai:list:share:movies:watchlist"), false);
  assert.equal(isAiCallback(`${callBacks.aiTasteRetry}books`), true);
  assert.equal(isAiCallback(callBacks.aiTasteClose), true);
  assert.equal(isAiCallback(callBacks.aiBack), true);

  assert.equal(isAiCallback(callBacks.profile), false);
  assert.equal(isAiCallback(callBacks.discussions), false);
  assert.equal(shouldKeepAiListTitleForCallback(callBacks.aiAssistant, isAiCallback), false);
  assert.equal(shouldKeepAiListTitleForCallback(callBacks.profile, isAiCallback), false);
});

test("suggestion callbacks are valid only inside their matching AI state", () => {
  const fromTopTen = `${callBacks.aiSectionSuggestFromTopTen}movies`;
  const cancelContext = `${callBacks.aiSectionSuggestContextCancel}books`;

  assert.equal(isSuggestionCallbackValidForState(fromTopTen, "ai_chat_movies"), true);
  assert.equal(isSuggestionCallbackValidForState(fromTopTen, "ai_manage_movies_top_ten"), true);
  assert.equal(isSuggestionCallbackValidForState(fromTopTen, "idle"), false);
  assert.equal(isSuggestionCallbackValidForState(cancelContext, "ai_suggest_context_books"), true);
  assert.equal(isSuggestionCallbackValidForState(cancelContext, "idle"), false);
  assert.equal(
    isSuggestionCallbackValidForState(`${callBacks.aiSectionSuggestMenu}unknown`, "ai_chat_unknown"),
    false,
  );
});

test("suggestion callback edits the tapped card through waiting and final states", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
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
  User.findOneAndUpdate = async () => ({});

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
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deletedIds, []);
  assert.equal(replies.length, 0);
  assert.equal(edits[0].messageId, 55);
  assert.equal(edits[0].text, messages.en.aiThinking);
  assert.deepEqual(edits[0].extra.reply_markup.inline_keyboard, []);
  assert.equal(edits.every((entry) => entry.messageId === 55), true);
  assert.match(edits.at(-1).text, /free suggestions/);
  assert.equal(ctx.user.state, "ai_suggest_context_music");
  assert.equal(ctx.user.navigationMode, "ai_suggestion_mode:music");
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
      { title: "Dune", comment: "reread", commentSource: "ai", watched: true },
      { title: "Foundation", watched: false },
    ],
    "Empty",
    { topTenTitleSet, includeWatched: true },
  );

  assert.match(rendered, /1\. ✔️ Dune 🏆\n✨ reread/);
  assert.match(rendered, /2\. ○ Foundation/);
});

test("AI list UI treats unmarked legacy comments as AI explanations", () => {
  const rendered = formatAiItemsList(
    "Watchlist",
    [{ title: "The Seventh Seal", comment: "A legacy recommendation" }],
    "Empty",
  );

  assert.match(rendered, /✨ A legacy recommendation/);
});

test("AI list UI separates legacy movie metadata and comments", () => {
  const rendered = formatAiItemsList(
    "لیست",
    [{
      title: "Paris, Texas (1984, Dir. Wim Wenders)",
      comment: "سکوت و تنهایی‌اش به فیلم‌های محبوبت می‌خورد.",
      commentSource: "ai",
      watched: false,
    }],
    "خالی",
    { includeWatched: true, lang: "fa", section: "movies" },
  );

  assert.match(rendered, /1\. ○ Paris, Texas — 1984, کارگردان: Wim Wenders/);
  assert.match(rendered, /✨ سکوت و تنهایی‌اش/);
  assert.doesNotMatch(rendered, /Paris, Texas \(1984/);
});

test("AI list UI builds section-titled list messages from user data", () => {
  const ctx = {
    user: {
      aiLists: {
        movies: {
          topTen: [{ title: "Heat", comment: "tight", commentSource: "ai" }],
          watchlist: [
            { title: "Heat" },
            { title: "Arrival", comment: "rewatch", commentSource: "ai" },
            { title: "Solaris", comment: "این یه کامنت تستیه", commentSource: "user" },
          ],
        },
      },
    },
  };

  const topTenText = buildTopTenListMessage({ ctx, lang: "en", section: "movies" });
  const watchlistText = buildWatchlistMessage({ ctx, lang: "en", section: "movies" });

  assert.match(topTenText, /❤️ My favorite movies/);
  assert.match(topTenText, /1\. Heat\n✨ tight/);
  assert.match(topTenText, /Update comment 👉 \/cm_mv_t_1/);
  assert.match(topTenText, /Remove 👉 \/rm_mv_t_1/);
  assert.match(watchlistText, /1\. ○ Heat 🏆/);
  assert.match(watchlistText, /2\. ○ Arrival\n✨ rewatch/);
  assert.match(watchlistText, /3\. ○ Solaris\n📝 این یه کامنت تستیه/);
  assert.doesNotMatch(watchlistText, /✨ این یه کامنت تستیه/);
  assert.match(watchlistText, /────────────────────────/);
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
  const booksUnlocked = await getTopTenManageEntryMessage({
    userId: 502,
    user: {
      aiLists: {
        books: {
          topTen: ["Symphony of the Dead", "Year of Turmoil", "The Blind Owl"]
            .map((title) => ({ title })),
        },
      },
    },
  }, "en", "books");

  assert.match(empty, /genuinely love/);
  assert.match(empty, /Start with 3 favorites/);
  assert.match(early, /2\/3 favorites/);
  assert.match(early, /Add 1 more/);
  assert.match(early, /movie or series suggestions/);
  assert.match(unlocked, /Suggestions unlocked/);
  assert.match(unlocked, /3\/10/);
  assert.doesNotMatch(unlocked, /Current label|Movie Buff/);
  assert.match(booksUnlocked, /Suggestions unlocked/);
  assert.match(booksUnlocked, /3\/10/);
  assert.doesNotMatch(booksUnlocked, /Current label|Classics Reader/);

  const persianBookEarly = await getTopTenManageEntryMessage({
    userId: 502,
    user: { aiLists: { books: { topTen: [{ title: "کتاب اول" }] } } },
  }, "fa", "books");
  assert.match(persianBookEarly, /بعدش می‌تونی برای کتاب ازم پیشنهاد بگیری/);

  const emptyButtons = keyboardButtons(aiListManageMenuKeyboard("en", "books", "topTen", { itemCount: 0 }));
  const earlyButtons = keyboardButtons(aiListManageMenuKeyboard("fa", "music", "topTen", { hasItems: true, itemCount: 2 }));
  assert.equal(emptyButtons[0].text, messages.en.aiFavoritesAddFirstBooks);
  assert.equal(earlyButtons[0].text, messages.fa.aiFavoritesAddAnotherMusic.replace("{count}", "2").replace("{goal}", "10"));
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

test("AI list manager keeps broad actions in reply controls and filters on the inline card", () => {
  const emptyKeyboard = aiListManageMenuKeyboard("en", "movies", "watchlist");
  const emptyButtons = keyboardButtons(emptyKeyboard);
  const emptyLabels = emptyButtons.map((button) => button.text);
  const keyboard = aiListManageMenuKeyboard("en", "movies", "watchlist", {
    hasItems: true,
  });
  const buttons = keyboardButtons(keyboard);
  const labels = buttons.map((button) => button.text);
  assert.equal(emptyButtons.some((button) => button.callback_data === `${callBacks.aiListManageShow}movies:watchlist`), false);
  assert.equal(emptyLabels.includes(messages.en.aiListManageShowWatchedMovies), false);
  assert.ok(labels.includes(messages.en.aiListManageAddLaterMovies));
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.aiListManageShow}movies:watchlist`), false);
  assert.equal(labels.includes(messages.en.aiListManageShowWatchedMovies), false);
  assert.equal(labels.includes(messages.en.aiListManageShowNotWatchedMovies), false);
  const filterLabels = keyboardButtons(aiWatchlistCardKeyboard("en", "movies", {
    watchlistItems: [
      { title: "Arrival", watched: true },
      { title: "Heat", watched: false },
    ],
  })).map((button) => button.text);
  assert.ok(filterLabels.includes(messages.en.aiListManageShowWatchedMovies));
  assert.ok(filterLabels.includes(messages.en.aiListManageShowNotWatchedMovies));
  const completedOnlyLabels = keyboardButtons(aiWatchlistCardKeyboard("en", "movies", {
    watchlistItems: [{ title: "Arrival", watched: true }],
  })).map((button) => button.text);
  assert.equal(completedOnlyLabels.includes(messages.en.aiListManageShowWatchedMovies), false);
  assert.equal(completedOnlyLabels.includes(messages.en.aiListManageShowNotWatchedMovies), false);
  assert.equal(
    keyboardButtons(aiListManageMenuKeyboard("en", "movies", "topTen", { hasItems: true, itemCount: 6 }))
      .some((button) => /shareable message/i.test(button.text)),
    false,
  );
  assert.equal(
    keyboardButtons(aiListManageMenuKeyboard("en", "movies", "topTen", { hasItems: true, itemCount: 10 }))
      .some((button) => button.text === messages.en.aiListManageAdd),
    false,
  );
  assert.ok(labels.includes(messages.en.aiSuggestionGoToFavoritesButton));
  assert.equal(
    keyboardButtons(aiListManageMenuKeyboard("en", "movies", "topTen", { hasItems: true, itemCount: 1 }))
      .some((button) => button.text === messages.en.aiSectionListButtonMovies),
    false,
  );
  assert.ok(
    keyboardButtons(aiListManageMenuKeyboard("en", "movies", "topTen", {
      hasItems: true,
      itemCount: 1,
      hasWatchlistItems: true,
    })).some((button) => button.text === messages.en.aiSectionListButtonMovies),
  );
  const favoriteRows = aiListManageMenuKeyboard("en", "movies", "topTen", {
    itemCount: 3,
    hasWatchlistItems: true,
  }).reply_markup.keyboard;
  assert.equal(favoriteRows.at(-2)[0].text, messages.en.aiSectionListButtonMovies);
  assert.equal(favoriteRows.at(-1)[0].text, messages.en.aiBack);
  assert.equal(
    keyboardButtons(aiListManageMenuKeyboard("en", "movies", "topTen", { hasItems: true, itemCount: 1 }))
      .some((button) => button.text === `🎬 ${messages.en.aiSectionSuggestButton}`),
    false,
  );
  assert.ok(
    keyboardButtons(aiListManageMenuKeyboard("en", "movies", "topTen", { hasItems: true, itemCount: 3 }))
      .some((button) => button.text === `🎬 ${messages.en.aiSectionSuggestButton}`),
  );
  assert.equal(labels.includes(messages.en.aiListManageRemove), false);
  assert.equal(labels.includes(messages.en.aiListManageComment), false);
  assert.equal(labels.includes(messages.en.aiListManageMoveToTopTen), false);
});

test("filtered watchlist keeps its filter inline while reply actions stay broad", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const ctx = {
    userId: 92,
    user: {
      userId: 92,
      lang: "en",
      state: "ai_manage_movies_watchlist",
      navigationMode: "ai_list_filter:movies:watched",
      sectionTipsShownAt: { forLaterInline: new Date() },
      aiLists: {
        movies: {
          topTen: [],
          watchlist: [
            { title: "Arrival", watched: true },
            { title: "Heat", watched: false },
          ],
        },
      },
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length, text, extra };
    },
  };

  User.findOneAndUpdate = async (query, update) => {
    Object.assign(ctx.user, update);
    return ctx.user;
  };

  try {
    await openAiListManager(ctx, "en", "movies", "watchlist", { filter: "watched" });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const manager = replies.at(-1);
  const labels = keyboardButtons(manager.extra).map((button) => button.text);
  assert.match(manager.text, /Arrival/);
  assert.doesNotMatch(manager.text, /Heat/);
  assert.match(manager.text, /\/rm_mv_l_1/);
  assert.equal(ctx.user.navigationMode, "ai_list_filter:movies:watched");
  assert.ok(labels.includes(messages.en.aiListManageShowAll));
  assert.ok(labels.includes(messages.en.aiListManageShowNotWatchedMovies));
  assert.equal(labels.includes(messages.en.aiListManageShowWatchedMovies), false);

  const resolve = (text) => resolveReplyKeyboardAction(text, {
    mode: ctx.user.navigationMode,
    state: ctx.user.state,
    user: ctx.user,
  })?.callbackData;
  assert.equal(resolve(messages.en.aiListManageAddLaterMovies), `${callBacks.aiListManageAdd}movies:watchlist`);
  assert.equal(resolve(messages.en.aiListManageShowAll), undefined);
  assert.equal(resolve(messages.en.aiListManageShowNotWatchedMovies), undefined);
  assert.equal(resolve(messages.en.aiSuggestionGoToFavoritesButton), `${callBacks.aiListManageBack}movies`);
});

test("For Later pagination preserves full-list command indexes", () => {
  const ctx = {
    user: {
      aiLists: {
        movies: {
          topTen: [],
          watchlist: Array.from({ length: 7 }, (_, index) => ({
            title: `Movie ${index + 1}`,
            watched: false,
          })),
        },
      },
    },
  };

  const firstPage = buildWatchlistMessage({ ctx, lang: "en", section: "movies", page: 0 });
  const secondPage = buildWatchlistMessage({ ctx, lang: "en", section: "movies", page: 1 });
  assert.match(firstPage, /Movie 1/);
  assert.match(firstPage, /Movie 5/);
  assert.doesNotMatch(firstPage, /Movie 6/);
  assert.match(secondPage, /Movie 6/);
  assert.match(secondPage, /\/rm_mv_l_6/);
  assert.match(secondPage, /Movie 7/);
  assert.doesNotMatch(secondPage, /Movie 5/);
});

test("For Later page callbacks edit the current card and remember the page", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const edits = [];
  const replies = [];
  const ctx = {
    callbackData: `${callBacks.aiListManageShow}movies:watchlist:all:1`,
    callbackMessageId: 81,
    userId: 93,
    user: {
      userId: 93,
      lang: "en",
      state: "ai_manage_movies_watchlist",
      navigationMode: "ai_list:movies:watchlist",
      aiLastListMessageId: 81,
      aiLastListSection: "movies",
      aiLastListType: "watchlist",
      aiLists: {
        movies: {
          topTen: [],
          watchlist: Array.from({ length: 7 }, (_, index) => ({
            title: `Movie ${index + 1}`,
            watched: false,
          })),
        },
      },
    },
    answerCb: async () => true,
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
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
    await handleAiCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => false,
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(replies.length, 0);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].messageId, 81);
  assert.match(edits[0].text, /Movie 6/);
  assert.match(edits[0].text, /\/rm_mv_l_6/);
  assert.doesNotMatch(edits[0].text, /Movie 1/);
  assert.equal(ctx.user.aiLastListPage, 1);
  assert.equal(
    keyboardButtons(edits[0].extra).some((button) => (
      button.callback_data === `${callBacks.aiListManageShow}movies:watchlist:all:0`
    )),
    true,
  );
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

  assert.match(rendered, /1\. ✔️ Lichess puzzles/);
  assert.match(rendered, /2\. ○ Photo walk/);
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
