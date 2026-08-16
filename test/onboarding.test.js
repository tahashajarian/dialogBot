const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const {
  onboardingCompleteKeyboard,
  onboardingFavoritesInlineKeyboard,
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
const { buildOnboardingWelcome } = require("../src/flows/language-callbacks");

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

test("one onboarding welcome source supports optional names in both languages", () => {
  assert.equal(buildOnboardingWelcome({}, "fa"), messages.fa.onboardingWelcome);
  assert.equal(buildOnboardingWelcome({}, "en"), messages.en.onboardingWelcome);
  assert.match(buildOnboardingWelcome({ firstName: "طاها" }, "fa"), /^👩‍🦳 سلام طاها، من میوزم\./);
  assert.match(buildOnboardingWelcome({ firstName: "Taha" }, "en"), /^👩‍🦳 Hi Taha, I’m Muze\./);
  assert.match(buildOnboardingWelcome({ firstName: "Taha" }, "en"), /movies, music, and books/);
});

test("onboarding category picker contains the four media sections", () => {
  for (const lang of ["fa", "en"]) {
    const rows = onboardingSectionsKeyboard(lang).reply_markup.keyboard
      .map((row) => row.map(({ text }) => text));
    assert.deepEqual(rows, [
      [messages[lang].aiSuggestMusic, messages[lang].aiSuggestBooks],
      [messages[lang].aiSuggestMovies, messages[lang].aiSuggestSeries],
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
  assert.equal(isOnboardingCallback(callBacks.onboardingSectionBack), true);
  assert.equal(isOnboardingCallback(callBacks.onboardingFinishLater), true);
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
    replies[0].extra.reply_markup.keyboard.map((row) => row.map(({ text }) => text)),
    [
      [messages.en.aiSuggestMusic, messages.en.aiSuggestBooks],
      [messages.en.aiSuggestMovies, messages.en.aiSuggestSeries],
    ],
  );
});

test("typing on language and welcome screens repeats their scoped button guidance", async () => {
  const cases = [
    {
      state: "onboarding_language",
      lang: "fa",
      expectedKeyboard: onboardingLanguageKeyboard(),
    },
    {
      state: "onboarding_invite_language:d_SHARED",
      lang: "en",
      expectedKeyboard: onboardingLanguageKeyboard(),
    },
    {
      state: "onboarding_welcome",
      lang: "en",
      expectedKeyboard: onboardingWelcomeKeyboard("en"),
    },
  ];

  for (const { state, lang, expectedKeyboard } of cases) {
    const replies = [];
    await handleOnboardingText({
      user: { state },
      text: "hello",
      reply: async (text, extra) => replies.push({ text, extra }),
    }, lang);
    assert.deepEqual(replies, [{
      text: messages[lang].sectionTextUseBottomButtons,
      extra: expectedKeyboard,
    }]);
  }
});

test("manually typed onboarding inline labels are ignored", async () => {
  const replies = [];
  const ctx = {
    userId: 81,
    user: {
      state: "onboarding_favorites:movies",
      aiLists: { movies: { topTen: [] } },
    },
    text: messages.fa.onboardingChooseAnotherSectionButton,
    reply: async (...args) => replies.push(args),
  };

  assert.equal(await handleOnboardingText(ctx, "fa"), null);
  assert.deepEqual(replies, []);

  ctx.text = messages.en.onboardingFinishLaterButton;
  assert.equal(await handleOnboardingText(ctx, "fa"), null);
  assert.deepEqual(replies, []);
});

test("music onboarding resolves audio titles and formats structured duplicates", async () => {
  const originalFindOne = User.findOne;
  User.findOne = async () => ({
    userId: 82,
    aiLists: { music: { topTen: [{ title: "Faramooshi", comment: "", metadata: {} }] } },
  });
  const replies = [];
  const ctx = {
    userId: 82,
    user: {
      state: "onboarding_favorites:music",
      aiLists: { music: { topTen: [{ title: "Faramooshi", comment: "", metadata: {} }] } },
    },
    message: {
      audio: { title: "Faramooshi", file_name: "unrelated-file-name.mp3" },
      caption: "#proxy #music #forwarded lots of unrelated caption text",
      forward_origin: { type: "channel" },
    },
    reply: async (text, extra) => replies.push({ text, extra }),
  };

  try {
    await handleOnboardingText(ctx, "en");
  } finally {
    User.findOne = originalFindOne;
  }

  assert.equal(
    replies[0].text,
    messages.en.aiListDuplicateMatch.replace("{item}", "Faramooshi"),
  );
  assert.doesNotMatch(replies[0].text, /\[object Object\]/);
});

test("every category action enters its matching Favorites state and prompt", async () => {
  const originalUpdate = User.findOneAndUpdate;
  User.findOneAndUpdate = async () => ({});
  try {
    for (const [section, promptKey] of [
      ["movies", "aiMovieFavoritesAddPrompt"],
      ["series", "aiSeriesFavoritesAddPrompt"],
      ["music", "aiMusicFavoritesAddPrompt"],
      ["books", "aiBookFavoritesAddPrompt"],
    ]) {
      const replies = [];
      const ctx = {
        userId: 9,
        callbackData: `${callBacks.onboardingSection}${section}`,
        user: {
          userId: 9,
          lang: "en",
          state: "onboarding_sections",
          aiLists: { [section]: { topTen: [] } },
        },
        answerCb: async () => {},
        reply: async (text, extra) => {
          replies.push({ text, extra });
          return { message_id: 99 };
        },
        editMessageText: async (_messageId, text, extra) => {
          replies[0] = { text, extra };
          return { message_id: 99 };
        },
      };
      await handleOnboardingCallback(ctx, "en", {});
      assert.equal(ctx.user.state, `onboarding_favorites:${section}`);
      assert.equal(ctx.user.navigationMode, `onboarding_favorites:${section}`);
      assert.equal(replies[0].text, messages.en[promptKey]);
      assert.deepEqual(replies[0].extra, onboardingFavoritesInlineKeyboard("en"));
    }
  } finally {
    User.findOneAndUpdate = originalUpdate;
  }
});

test("before the first Favorite the only onboarding input control returns to sections", () => {
  for (const lang of ["fa", "en"]) {
    const labels = onboardingFavoritesInlineKeyboard(lang).reply_markup.inline_keyboard.flat()
      .map(({ text }) => text);
    assert.deepEqual(labels, [messages[lang].onboardingChooseAnotherSectionButton]);
  }
});

test("after the first Favorite the only onboarding input control finishes later", () => {
  for (const lang of ["fa", "en"]) {
    const labels = onboardingFavoritesInlineKeyboard(lang, { canFinishLater: true })
      .reply_markup.inline_keyboard.flat().map(({ text }) => text);
    assert.deepEqual(labels, [messages[lang].onboardingFinishLaterButton]);
  }
});

test("back before the first Favorite returns to the section picker", async () => {
  const originalUpdate = User.findOneAndUpdate;
  User.findOneAndUpdate = async () => ({});
  const replies = [];
  const retiredMarkups = [];
  const ctx = {
    userId: 11,
    callbackData: callBacks.onboardingSectionBack,
    user: {
      userId: 11,
      lang: "fa",
      state: "onboarding_favorites:music",
      navigationMode: "onboarding_favorites:music",
      onboardingPromptMessageId: 77,
      aiLists: { music: { topTen: [] } },
    },
    answerCb: async () => {},
    deleteMessage: async () => assert.fail("onboarding prompt should not be deleted"),
    editMessageReplyMarkup: async (messageId, markup) => {
      retiredMarkups.push({ messageId, markup });
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 };
    },
    editMessageText: async (_messageId, text, extra) => {
      replies[0] = { text, extra };
      return { message_id: 100 };
    },
  };
  try {
    await handleOnboardingCallback(ctx, "fa");
  } finally {
    User.findOneAndUpdate = originalUpdate;
  }
  assert.equal(ctx.user.state, "onboarding_sections");
  assert.equal(ctx.user.navigationMode, "onboarding_sections");
  assert.equal(replies[0].text, messages.fa.onboardingSectionPrompt);
  assert.deepEqual(retiredMarkups, [{ messageId: 77, markup: { inline_keyboard: [] } }]);
});

test("finishing later completes onboarding, preserves Favorites, and continues a shared profile", async () => {
  const originalUpdate = User.findOneAndUpdate;
  const updates = [];
  User.findOneAndUpdate = async (_filter, update) => {
    updates.push(update);
    return {};
  };
  const replies = [];
  const retiredMarkups = [];
  const sharedProfiles = [];
  const user = {
    userId: 12,
    lang: "fa",
    onboardingVersion: 0,
    state: "onboarding_favorites:books",
    navigationMode: "onboarding_favorites:books",
    onboardingPromptMessageId: 88,
    pendingProfileShareCode: "u_SHARED",
    aiLists: { books: { topTen: [{ title: "بوف کور" }] } },
  };
  const ctx = {
    userId: 12,
    callbackData: callBacks.onboardingFinishLater,
    user,
    answerCb: async () => {},
    deleteMessage: async () => assert.fail("onboarding prompt should not be deleted"),
    editMessageReplyMarkup: async (messageId, markup) => {
      retiredMarkups.push({ messageId, markup });
      return true;
    },
    reply: async (text, extra) => replies.push({ text, extra }),
  };
  try {
    await handleOnboardingCallback(ctx, "fa", {
      showSharedProfile: async (code) => sharedProfiles.push(code),
    });
  } finally {
    User.findOneAndUpdate = originalUpdate;
  }
  assert.equal(user.onboardingVersion, 1);
  assert.ok(user.onboardingCompletedAt instanceof Date);
  assert.equal(user.state, "idle");
  assert.equal(user.navigationMode, "global");
  assert.equal(user.aiLists.books.topTen[0].title, "بوف کور");
  assert.match(replies[0].text, /^🏠 خانه\n\n👩‍🦳/);
  assert.match(replies[0].text, /💡 با اضافه‌کردن ۲ مورد دیگه به بخش «📚 کتاب»/);
  assert.match(replies[0].text, /می‌تونی از «🎬🎵📚 محبوب‌های من» ادامه بدی/);
  assert.deepEqual(sharedProfiles, ["u_SHARED"]);
  assert.equal(user.pendingProfileShareCode, "");
  assert.deepEqual(retiredMarkups, [{ messageId: 88, markup: { inline_keyboard: [] } }]);
  assert.ok(updates.some((update) => update.onboardingCompletedAt instanceof Date));
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
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 101 };
    },
    editMessageText: async (_messageId, text, extra) => {
      replies[0] = { text, extra };
      return { message_id: 101 };
    },
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
  assert.deepEqual(
    replies[0].extra.reply_markup.inline_keyboard.flat(),
    [{
      text: messages.fa.onboardingFinishLaterButton,
      callback_data: callBacks.onboardingFinishLater,
    }],
  );
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
    assert.match(messages[lang].aiMovieFavoritesAddPrompt, /^👩‍🦳 🎬/);
    assert.match(messages[lang].aiMusicFavoritesAddPrompt, /^👩‍🦳 🎵/);
    assert.match(messages[lang].aiBookFavoritesAddPrompt, /^👩‍🦳 📚/);
    assert.match(messages[lang].aiMovieFavoritesAddPrompt, lang === "fa" ? /فیلم/ : /movie/);
    assert.doesNotMatch(messages[lang].aiMovieFavoritesAddPrompt, lang === "fa" ? /سریال/ : /series/);
    assert.match(messages[lang].aiSeriesFavoritesAddPrompt, lang === "fa" ? /سریال/ : /series/);
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
