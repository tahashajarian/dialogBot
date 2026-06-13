const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const {
  isAiBackText,
  isAiSectionListText,
  isAiSectionSuggestText,
  isAiSectionTopTenText,
  isAiTextState,
} = require("../src/flows/ai-text");
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

test("Interests editor shares the paged onboarding chip catalog", () => {
  const firstPage = aiInterestTopTenChipKeyboard("en", ["Chess"], 0);
  const secondPage = aiInterestTopTenChipKeyboard("en", [], 1);
  const firstButtons = firstPage.reply_markup.inline_keyboard.flat();
  const secondButtons = secondPage.reply_markup.inline_keyboard.flat();

  assert.equal(firstButtons.some((button) => button.text.includes("Chess")), false);
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
