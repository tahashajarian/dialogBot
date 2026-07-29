const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const {
  onboardingCompleteKeyboard,
  onboardingLanguageKeyboard,
  onboardingSectionsKeyboard,
  onboardingWelcomeKeyboard,
} = require("../src/keyboards");
const {
  NEW_USER_WINDOW_MS,
  getOnboardingCompletionDestination,
  handleOnboardingCallback,
  handleOnboardingText,
  isOnboardingCallback,
  isOnboardingInProgress,
  resumeOnboarding,
  sendMuzeWelcome,
  shouldOfferOnboarding,
} = require("../src/flows/onboarding");
const User = require("../src/models/user");

test("onboarding is offered only to recent empty or already-started accounts", () => {
  const now = new Date("2026-06-13T10:00:00.000Z");
  const fresh = { createdAt: new Date(now.getTime() - 1000), onboardingVersion: 0 };
  assert.equal(shouldOfferOnboarding(fresh, now), true);
  assert.equal(shouldOfferOnboarding({ ...fresh, onboardingVersion: 1 }, now), false);
  assert.equal(shouldOfferOnboarding({
    ...fresh,
    aiLists: { movies: { topTen: [{ title: "Dune" }] } },
  }, now), false);
  assert.equal(shouldOfferOnboarding({
    ...fresh,
    createdAt: new Date(now.getTime() - NEW_USER_WINDOW_MS - 1),
  }, now), false);
  assert.equal(shouldOfferOnboarding({
    ...fresh,
    createdAt: new Date(now.getTime() - NEW_USER_WINDOW_MS - 1),
    state: "onboarding_favorites:books",
  }, now), true);
});

test("welcome copy and controls match the Favorites-first onboarding", () => {
  for (const lang of ["fa", "en"]) {
    assert.match(messages[lang].onboardingWelcome, /^👩‍🦳/);
    assert.match(messages[lang].onboardingWelcome, lang === "fa" ? /۳ تا/ : /three things/i);
    assert.match(messages[lang].onboardingWelcome, lang === "fa" ? /دکمه‌ها/ : /buttons/);
    assert.doesNotMatch(messages[lang].onboardingWelcome, /choose a few interests|چند علاقه/);
    assert.deepEqual(
      onboardingWelcomeKeyboard(lang).reply_markup.keyboard.flat(),
      [{ text: messages[lang].onboardingStartButton }],
    );
  }
  assert.deepEqual(
    onboardingLanguageKeyboard().reply_markup.keyboard.flat().map((button) => button.text),
    ["🇮🇷 فارسی", "🇬🇧 English"],
  );
});

test("onboarding category picker contains only the three media sections", () => {
  for (const lang of ["fa", "en"]) {
    const labels = onboardingSectionsKeyboard(lang).reply_markup.keyboard.flat().map(({ text }) => text);
    assert.deepEqual(labels, [
      messages[lang].aiSuggestMovies,
      messages[lang].aiSuggestMusic,
      messages[lang].aiSuggestBooks,
    ]);
    assert.match(messages[lang].onboardingSectionPrompt, /^👩‍🦳/);
  }
});

test("onboarding callbacks are limited to the new scoped actions", () => {
  assert.equal(isOnboardingCallback(callBacks.onboardingStart), true);
  assert.equal(isOnboardingCallback(`${callBacks.onboardingSection}movies`), true);
  assert.equal(isOnboardingCallback(`${callBacks.onboardingSuggestion}books`), true);
  assert.equal(isOnboardingCallback(`${callBacks.onboardingInterest}2`), true);
  assert.equal(isOnboardingCallback(callBacks.onboardingTasteSetupStart), true);
  assert.equal(isOnboardingCallback(callBacks.discussions), false);
});

test("start action moves from the exact welcome state to category selection", async () => {
  const originalUpdate = User.findOneAndUpdate;
  const updates = [];
  User.findOneAndUpdate = async (_filter, update) => {
    updates.push(update);
    return {};
  };
  const replies = [];
  const ctx = {
    userId: 7,
    callbackData: callBacks.onboardingStart,
    user: { userId: 7, lang: "en", state: "onboarding_welcome" },
    answerCb: async () => {},
    reply: async (text, extra) => replies.push({ text, extra }),
  };
  try {
    await handleOnboardingCallback(ctx, "en", {});
  } finally {
    User.findOneAndUpdate = originalUpdate;
  }
  assert.equal(ctx.user.state, "onboarding_sections");
  assert.equal(ctx.user.navigationMode, "onboarding_sections");
  assert.equal(replies[0].text, messages.en.onboardingSectionPrompt);
  assert.ok(updates.some((update) => update.state === "onboarding_sections"));
});

test("typing at category selection reuses the existing button guidance", async () => {
  const replies = [];
  await handleOnboardingText({
    userId: 8,
    user: { state: "onboarding_sections" },
    text: "movies",
    reply: async (text, extra) => replies.push({ text, extra }),
  }, "en");
  assert.equal(replies[0].text, messages.en.sectionTextUseBottomButtons);
  assert.deepEqual(
    replies[0].extra.reply_markup.keyboard.flat().map(({ text }) => text),
    [
      messages.en.aiSuggestMovies,
      messages.en.aiSuggestMusic,
      messages.en.aiSuggestBooks,
    ],
  );
});

test("category action enters the chosen Favorites input state with the regular prompt", async () => {
  const originalUpdate = User.findOneAndUpdate;
  User.findOneAndUpdate = async () => ({});
  const replies = [];
  const ctx = {
    userId: 9,
    callbackData: `${callBacks.onboardingSection}movies`,
    user: {
      userId: 9,
      lang: "en",
      state: "onboarding_sections",
      aiLists: { movies: { topTen: [] } },
    },
    answerCb: async () => {},
    reply: async (text, extra) => replies.push({ text, extra }),
  };
  try {
    await handleOnboardingCallback(ctx, "en", {});
  } finally {
    User.findOneAndUpdate = originalUpdate;
  }
  assert.equal(ctx.user.state, "onboarding_favorites:movies");
  assert.equal(ctx.user.navigationMode, "onboarding_favorites:movies");
  assert.equal(replies[0].text, messages.en.aiMovieFavoritesAddPrompt);
  assert.equal(replies[0].extra.reply_markup.remove_keyboard, true);
});

test("plain start can resume the persisted section and count", async () => {
  const originalUpdate = User.findOneAndUpdate;
  User.findOneAndUpdate = async () => ({});
  const replies = [];
  const ctx = {
    userId: 10,
    user: {
      userId: 10,
      lang: "fa",
      onboardingVersion: 0,
      state: "onboarding_favorites:books",
      aiLists: { books: { topTen: [{ title: "سمفونی مردگان" }] } },
    },
    reply: async (text, extra) => replies.push({ text, extra }),
  };
  try {
    await resumeOnboarding(ctx, "fa");
  } finally {
    User.findOneAndUpdate = originalUpdate;
  }
  assert.equal(isOnboardingInProgress(ctx.user), true);
  assert.equal(
    replies[0].text,
    messages.fa.onboardingResumeOne.replace("{section}", messages.fa.aiSectionNameBooks),
  );
  assert.match(replies[0].text, /۱ مورد/);
  assert.equal(ctx.user.state, "onboarding_favorites:books");
});

test("completion keyboard offers only Suggestion and Home for the completed section", () => {
  for (const lang of ["fa", "en"]) {
    const labels = onboardingCompleteKeyboard(lang, { section: "music" })
      .reply_markup.keyboard.flat().map(({ text }) => text);
    assert.deepEqual(labels, [
      messages[lang].onboardingSuggestionButton,
      messages[lang].onboardingMainMenuButton,
    ]);
    assert.equal(labels.includes(messages[lang].onboardingInvitationButton), false);
  }
});

test("completion destinations require the exact server-scoped keyboard", () => {
  const ctx = {
    isReplyKeyboardAction: true,
    user: { navigationMode: "onboarding_complete:movies" },
  };
  assert.equal(
    getOnboardingCompletionDestination(ctx, `${callBacks.onboardingSuggestion}movies`),
    "suggestion",
  );
  assert.equal(getOnboardingCompletionDestination(ctx, callBacks.menuMain), "main_menu");
  assert.equal(
    getOnboardingCompletionDestination({ ...ctx, isReplyKeyboardAction: false }, callBacks.menuMain),
    "",
  );
});

test("Favorites prompts request concrete works without encouraging creator entries", () => {
  for (const lang of ["fa", "en"]) {
    assert.match(messages[lang].aiMovieFavoritesAddPrompt, lang === "fa" ? /فیلم یا سریال/ : /movie or series/);
    assert.match(messages[lang].aiBookFavoritesAddPrompt, lang === "fa" ? /کتاب/ : /book/);
    assert.doesNotMatch(messages[lang].aiMovieFavoritesAddPrompt, lang === "fa" ? /کارگردان/ : /director/);
    assert.doesNotMatch(messages[lang].aiBookFavoritesAddPrompt, lang === "fa" ? /نویسنده/ : /author/);
    assert.doesNotMatch(messages[lang].aiTopTenInvalidItemQualityMovies, lang === "fa" ? /کارگردان/ : /director/);
    assert.doesNotMatch(messages[lang].aiTopTenInvalidItemQualityBooks, lang === "fa" ? /نویسنده/ : /author/);
  }
});

test("Muze welcome uses the cinematic banner with its greeting as caption", async () => {
  const replies = [];
  await sendMuzeWelcome({
    persistBannerFileIds: false,
    reply: async (text, extra) => ({ text, extra }),
    replyWithPhoto: async (photo, extra) => {
      replies.push({ photo, extra });
      return { photo: [], caption: extra.caption };
    },
  }, messages.en.onboardingWelcome, onboardingWelcomeKeyboard("en"));
  assert.equal(replies.length, 1);
  assert.match(replies[0].photo.source, /assets[\\/]muze-welcome-banner-cinematic-v2\.jpg$/);
  assert.equal(replies[0].extra.caption, messages.en.onboardingWelcome);
});
