const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const {
  handleAiText,
  isAiBackText,
  isAiSectionListText,
  isAiSectionSuggestText,
  isAiSectionTopTenText,
  isAiTextState,
} = require("../src/flows/ai-text");
const User = require("../src/models/user");
const {
  getAiListAddPrompt,
  getMeaningfulMusicTitle,
  isAudioDocument,
  resolveAiListAddInput,
} = require("../src/flows/ai-list-input");
const {
  aiInterestTopTenChipKeyboard,
  getInterestTopTenChipTitle,
} = require("../src/keyboards");
const {
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
  buildWatchlistMessage,
  formatAiItemsList,
  getDuplicateListMessage,
  getNeedTopTenMessage,
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
  assert.equal(isAiSectionSuggestText(messages.fa.aiSectionSuggestButton), true);
});

test("AI bottom Back keeps the keyboard-removal message so Bale clears reply controls", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
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
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
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
    await handleAiText(ctx, "fa", messages.fa.aiBack, ctx.user.state);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const keyboardRemovalReply = replies.find((reply) => reply.extra?.reply_markup?.remove_keyboard);
  assert.equal(Boolean(keyboardRemovalReply), true);
  assert.match(keyboardRemovalReply.text, /یکی از بخش‌ها رو انتخاب کن/);
  assert.equal(deletedIds.includes(1), false);
  assert.deepEqual(
    edits.find((edit) => edit.extra?.reply_markup?.inline_keyboard)
      .extra.reply_markup.inline_keyboard.at(-1)[0].callback_data,
    callBacks.aiBack,
  );
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
  assert.equal(getAiListAddPrompt("en", "music", "topTen"), messages.en.aiMusicListManageAddPrompt);
  assert.equal(getAiListAddPrompt("fa", "books", "topTen"), messages.fa.aiListManageAddPrompt);
  assert.match(messages.en.aiMusicListManageAddPrompt, /^🤖/);
  assert.match(messages.fa.aiMusicListManageAddPrompt, /آهنگ/);
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
  assert.match(finalEdit.text, /Added "Chess"|Saved "Chess"|Chess/);
  assert.equal(buttons.some((button) => button.text === messages.en.aiListManageAddDone), true);
  assert.equal(buttons.some((button) => button.text.includes("Chess")), false);
  assert.deepEqual(ctx.user.aiLists.random.topTen.map((entry) => entry.title), ["Chess"]);
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
  assert.match(savedReply.text, /Send the next item, or tap Done/);
  assert.equal(buttons.some((button) => button.text === messages.en.aiListManageAddDone), true);
  assert.deepEqual(ctx.user.aiLists.movies.watchlist.map((entry) => entry.title), ["Arrival"]);
});

test("Interests editor shares the paged onboarding chip catalog", () => {
  const firstPage = aiInterestTopTenChipKeyboard("en", ["Chess"], 0);
  const secondPage = aiInterestTopTenChipKeyboard("en", [], 1);
  const firstButtons = firstPage.reply_markup.inline_keyboard.flat();
  const secondButtons = secondPage.reply_markup.inline_keyboard.flat();
  const firstInterestButtons = firstButtons.filter((button) => (
    button.callback_data.startsWith(callBacks.aiInterestTopTenChip)
  ));

  assert.equal(firstButtons.some((button) => button.text.includes("Chess")), false);
  assert.equal(firstInterestButtons.length, 9);
  assert.equal(firstButtons.some((button) => button.text.includes("Travel")), true);
  assert.equal(firstButtons.some((button) => button.callback_data === `${callBacks.aiInterestTopTenMore}1`), true);
  assert.equal(secondButtons.some((button) => button.text.includes("Travel")), true);
  assert.equal(getInterestTopTenChipTitle(9, "en"), "Travel");
});

test("AI callback predicate keeps AI cards only for AI callbacks", () => {
  assert.equal(isAiCallback(callBacks.aiListManageMenu), true);
  assert.equal(isAiCallback(`${callBacks.aiListManageShow}movies:watchlist`), true);
  assert.equal(isAiCallback(`${callBacks.aiSectionSuggestWithContext}books`), true);
  assert.equal(isAiCallback(callBacks.aiBack), true);

  assert.equal(isAiCallback(callBacks.profile), false);
  assert.equal(isAiCallback(callBacks.discussions), false);
  assert.equal(shouldKeepAiListTitleForCallback(callBacks.aiAssistant, isAiCallback), true);
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
  assert.match(rendered, /2\. ⬜ Foundation/);
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

  assert.match(topTenText, /Movies/);
  assert.match(topTenText, /1\. Heat — tight/);
  assert.match(watchlistText, /1\. ⬜ Heat 🏆/);
  assert.match(watchlistText, /2\. ⬜ Arrival — rewatch/);
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
  assert.match(rendered, /2\. ⬜ Photo walk/);
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
