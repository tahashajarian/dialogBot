const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildInlineConfirmationContent,
  buildInlineResultId,
  handleChosenInlineListResult,
  handleInlineListQuery,
  normalizeBotUsername,
  parseChosenInlineSelection,
  parseInlineListTitle,
} = require("../src/flows/inline-list-capture");

test("inline query treats the complete text as the item title", () => {
  assert.equal(parseInlineListTitle("  The   Grand Budapest Hotel "), "The Grand Budapest Hotel");
  assert.equal(parseInlineListTitle("سمفونی مردگان"), "سمفونی مردگان");
  assert.equal(parseInlineListTitle(""), "");
});

test("typing an item returns Movie, Series, Music, and Book choices without buttons", async () => {
  const answers = [];
  const ctx = {
    inlineQuery: {
      query: "Dune",
      from: { id: 42, language_code: "en" },
    },
    botInfo: { username: "hey_muze_test_bot" },
    answerInlineQuery: async (results, extra) => {
      answers.push({ results, extra });
      return true;
    },
  };
  await handleInlineListQuery(ctx, {
    allowQuery: () => true,
    getUser: async () => ({ userId: 42, lang: "en", bannedAt: null }),
  });

  assert.equal(answers.length, 1);
  assert.equal(answers[0].extra.cache_time, 0);
  assert.equal(answers[0].extra.is_personal, true);
  assert.equal(Object.hasOwn(answers[0].extra, "button"), false);
  assert.deepEqual(
    answers[0].results.map((result) => result.title),
    [
    "🎬 Save “Dune” to Movie Library",
    "📺 Save “Dune” to Series Library",
    "🎵 Save “Dune” to Music Library",
    "📚 Save “Dune” to Book Library",
    ],
  );
  for (const result of answers[0].results) {
    assert.equal(result.type, "article");
    assert.equal(Object.hasOwn(result, "description"), false);
    assert.equal(Object.hasOwn(result, "reply_markup"), false);
    assert.match(result.input_message_content.message_text, /Dune/);
    assert.match(result.input_message_content.message_text, /Open Muze$/);
    assert.equal(result.input_message_content.entities[0].url, "https://t.me/hey_muze_test_bot");
    assert.deepEqual(result.input_message_content.link_preview_options, { is_disabled: true });
  }
  assert.match(answers[0].results[0].input_message_content.message_text, /for your Movie Library/);
  assert.match(answers[0].results[1].input_message_content.message_text, /for your Series Library/);
  assert.match(answers[0].results[2].input_message_content.message_text, /for your Music Library/);
  assert.match(answers[0].results[3].input_message_content.message_text, /for your Book Library/);
});

test("empty query is intentionally blank and performs no user lookup", async () => {
  let lookups = 0;
  const answers = [];
  await handleInlineListQuery({
    inlineQuery: { query: "", from: { id: 42, language_code: "en" } },
    answerInlineQuery: async (results, extra) => answers.push({ results, extra }),
  }, {
    allowQuery: () => true,
    getUser: async () => {
      lookups += 1;
      return null;
    },
  });
  assert.equal(lookups, 0);
  assert.deepEqual(answers[0].results, []);
  assert.equal(Object.hasOwn(answers[0].extra, "button"), false);
});

test("people without an account receive choices while banned accounts do not", async () => {
  const inactiveAnswers = [];
  await handleInlineListQuery({
    inlineQuery: { query: "Dune", from: { id: 42, language_code: "en" } },
    answerInlineQuery: async (results, extra) => inactiveAnswers.push({ results, extra }),
  }, {
    allowQuery: () => true,
    getUser: async () => null,
  });
  assert.equal(inactiveAnswers[0].results.length, 4);
  assert.match(inactiveAnswers[0].results[0].input_message_content.message_text, /^Sent/);

  const bannedAnswers = [];
  await handleInlineListQuery({
    inlineQuery: { query: "Dune", from: { id: 42, language_code: "en" } },
    answerInlineQuery: async (results, extra) => bannedAnswers.push({ results, extra }),
  }, {
    allowQuery: () => true,
    getUser: async () => ({ userId: 42, lang: "en", bannedAt: new Date() }),
  });
  assert.deepEqual(bannedAnswers[0].results, []);
});

test("inline query hides only sections whose own For Later list is full", async () => {
  const answers = [];
  await handleInlineListQuery({
    inlineQuery: { query: "Dune", from: { id: 42, language_code: "en" } },
    answerInlineQuery: async (results, extra) => answers.push({ results, extra }),
  }, {
    allowQuery: () => true,
    getUser: async () => ({
      userId: 42,
      lang: "en",
      aiLists: {
        movies: {
          watchlist: Array.from({ length: 100 }, (_, index) => ({ title: `Movie ${index}` })),
        },
        series: { watchlist: [] },
        music: { watchlist: [] },
        books: { watchlist: [] },
      },
    }),
  });

  assert.deepEqual(
    answers[0].results.map((result) => result.title),
    [
    "📺 Save “Dune” to Series Library",
    "🎵 Save “Dune” to Music Library",
    "📚 Save “Dune” to Book Library",
    ],
  );
});

test("chosen result is bound to its user, section, and normalized query", () => {
  const resultId = buildInlineResultId(42, "movies", "Dune");
  assert.deepEqual(parseChosenInlineSelection(resultId, 42, "Dune"), {
    ok: true,
    section: "movies",
    title: "Dune",
  });
  assert.equal(parseChosenInlineSelection(resultId, 99, "Dune").ok, false);
  assert.equal(parseChosenInlineSelection(resultId, 42, "Arrival").ok, false);
  assert.equal(parseChosenInlineSelection("invalid", 42, "Dune").ok, false);
});

test("open-bot footer validates the username and uses safe text-link entities", () => {
  assert.equal(normalizeBotUsername("@hey_muze_test_bot"), "hey_muze_test_bot");
  assert.equal(normalizeBotUsername("bad username"), "");
  const titleText = "✅ Added “<b>Dune</b>” to Movie Library.";
  const content = buildInlineConfirmationContent({
    text: titleText,
    lang: "en",
    botUsername: "hey_muze_test_bot",
  });
  assert.match(content.message_text, /<b>Dune<\/b>/);
  assert.equal(Object.hasOwn(content, "parse_mode"), false);
  assert.deepEqual(content.entities, [{
    type: "text_link",
    offset: titleText.length + 2,
    length: "Open Muze".length,
    url: "https://t.me/hey_muze_test_bot",
  }]);
});

test("chosen category saves directly to watchlist without opening the bot", async () => {
  const addCalls = [];
  const ctx = {
    chosenInlineResult: {
      result_id: buildInlineResultId(42, "books", "Piranesi"),
      from: { id: 42 },
      query: "Piranesi",
    },
  };
  const result = await handleChosenInlineListResult(ctx, {
    getUser: async (userId, options) => {
      assert.equal(userId, 42);
      assert.equal(options.force, true);
      return { userId: 42, bannedAt: null };
    },
    addListItem: async (...args) => {
      addCalls.push(args);
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "saved");
  assert.equal(addCalls[0][0], 42);
  assert.equal(addCalls[0][1], "books");
  assert.equal(addCalls[0][2], "watchlist");
  assert.deepEqual(addCalls[0][3], { title: "Piranesi", comment: "" });
});

test("chosen category is staged when the person has not started the bot", async () => {
  const staged = [];
  const result = await handleChosenInlineListResult({
    chosenInlineResult: {
      result_id: buildInlineResultId(42, "movies", "Dune"),
      from: { id: 42 },
      query: "Dune",
    },
  }, {
    getUser: async () => null,
    stagePendingItem: async (selection) => {
      staged.push(selection);
      return { ok: true, status: "staged" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "staged");
  assert.deepEqual(staged, [{ userId: 42, section: "movies", title: "Dune" }]);
});

test("duplicate chosen items are successful and tampered results never mutate", async () => {
  const validContext = {
    chosenInlineResult: {
      result_id: buildInlineResultId(42, "music", "Space Song"),
      from: { id: 42 },
      query: "Space Song",
    },
  };
  const duplicate = await handleChosenInlineListResult(validContext, {
    getUser: async () => ({ userId: 42, bannedAt: null }),
    addListItem: async () => ({ ok: false, reason: "exists" }),
  });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.status, "already_saved");

  let mutations = 0;
  const tampered = await handleChosenInlineListResult({
    chosenInlineResult: {
      ...validContext.chosenInlineResult,
      query: "Different Song",
    },
  }, {
    getUser: async () => ({ userId: 42 }),
    addListItem: async () => {
      mutations += 1;
    },
  });
  assert.equal(tampered.ok, false);
  assert.equal(mutations, 0);
});
