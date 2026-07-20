const test = require("node:test");
const assert = require("node:assert/strict");
const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const { MODES, isKnownProfileNavigationLabel, normalizeReplyButtonText, resolveReplyKeyboardAction } = require("../src/services/reply-keyboard-navigation");
const { getDiscussionTasteLabelOptionText } = require("../src/services/ai-section");
const { starEconomy } = require("../src/services/star-settings");

test("global reply navigation resolves both languages with Telegram direction marks", () => {
  for (const lang of ["fa", "en"]) {
    const result = resolveReplyKeyboardAction(`\u200f  ${messages[lang].mainMenuMe}  \u200e`, { mode: MODES.GLOBAL });
    assert.equal(result.callbackData, callBacks.profile);
    assert.equal(result.global, true);
  }
  assert.equal(normalizeReplyButtonText("  A   B  "), "A B");
});

test("Home restores bot-language switching as a global bottom action", () => {
  const { mainMenuKeyboard } = require("../src/keyboards");
  const labels = mainMenuKeyboard("fa").reply_markup.keyboard.flat().map((button) => button.text);
  assert.ok(labels.includes(messages.fa.language));
  assert.equal(resolveReplyKeyboardAction(messages.fa.language, { mode: MODES.GLOBAL, state: "idle", user: { lang: "fa" } }).callbackData, callBacks.language);
  assert.equal(resolveReplyKeyboardAction(messages.fa.language, { mode: MODES.DISCUSSIONS, state: "idle", user: { lang: "fa" } }), null);
});

test("normal language selection is inline while onboarding keeps scoped reply buttons", () => {
  const { languageKeyboard, onboardingLanguageKeyboard } = require("../src/keyboards");
  const normalRows = languageKeyboard("fa").reply_markup.inline_keyboard;
  assert.equal(languageKeyboard("fa").reply_markup.keyboard, undefined);
  assert.deepEqual(normalRows[0].map((button) => button.callback_data), [callBacks.langSetFa, callBacks.langSetEn]);
  assert.equal(normalRows.at(-1)[0].callback_data, callBacks.languageClose);
  assert.ok(onboardingLanguageKeyboard().reply_markup.keyboard);
  const context = { mode: MODES.LANGUAGE, state: "idle", user: { lang: "fa" } };
  assert.equal(resolveReplyKeyboardAction("🇮🇷 فارسی", context).callbackData, callBacks.langSetFa);
  assert.equal(resolveReplyKeyboardAction("🇬🇧 English", context).callbackData, callBacks.langSetEn);
  assert.equal(resolveReplyKeyboardAction(messages.fa.aiBack, context).callbackData, callBacks.menuMain);
  assert.equal(resolveReplyKeyboardAction("🇬🇧 English", { ...context, mode: MODES.GLOBAL }), null);
  const onboarding = { mode: "onboarding_language", state: "onboarding_language", user: { lang: "fa" } };
  assert.equal(resolveReplyKeyboardAction("🇮🇷 فارسی", onboarding).callbackData, callBacks.langSetFa);
  assert.equal(resolveReplyKeyboardAction("🇮🇷 فارسی", { ...onboarding, state: "idle" }), null);
});

test("onboarding buttons resolve only in the exact server-side step and language", () => {
  const welcome = { mode: "onboarding_welcome", state: "onboarding_welcome", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction(messages.en.onboardingStartButton, welcome).callbackData, callBacks.onboardingStart);
  assert.equal(resolveReplyKeyboardAction(messages.fa.onboardingStartButton, welcome), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.onboardingStartButton, { ...welcome, mode: "onboarding_interests:0", state: "onboarding_interests" }), null);

  const picker = { mode: "onboarding_interests:0", state: "onboarding_interests", user: { lang: "en", aiLists: { random: { topTen: [] } } } };
  assert.equal(resolveReplyKeyboardAction("🎬 Movies", picker).callbackData, `${callBacks.onboardingInterest}0:0`);
  assert.equal(resolveReplyKeyboardAction(messages.en.onboardingMoreButton, picker).callbackData, `${callBacks.onboardingMore}1`);
  assert.equal(resolveReplyKeyboardAction("🎬 Movies", { ...picker, mode: "onboarding_interests:1" }), null);

  const selected = { ...picker, user: { lang: "en", aiLists: { random: { topTen: [{ title: "Movies" }] } } } };
  assert.equal(resolveReplyKeyboardAction("🎬 Movies ✓", selected).callbackData, `${callBacks.onboardingInterestRemove}0:0`);
  assert.equal(resolveReplyKeyboardAction("🎬 Movies", selected), null);

  const custom = { mode: "onboarding_custom:2", state: "onboarding_custom_interest:2", user: { lang: "fa" } };
  assert.equal(resolveReplyKeyboardAction(messages.fa.onboardingCustomCancelButton, custom).callbackData, `${callBacks.onboardingCustomCancel}2`);
  assert.equal(resolveReplyKeyboardAction(messages.fa.onboardingCustomCancelButton, { ...custom, state: "idle" }), null);
});

test("onboarding completion and taste nudge actions expire outside their server modes", () => {
  const complete = { mode: "onboarding_complete:1:0", state: "idle", user: { lang: "fa" } };
  assert.equal(resolveReplyKeyboardAction(messages.fa.onboardingInvitationButton, complete).callbackData, callBacks.discussionInvitations);
  assert.equal(resolveReplyKeyboardAction(messages.fa.onboardingMainMenuButton, complete).callbackData, callBacks.menuMain);
  assert.equal(resolveReplyKeyboardAction(messages.fa.onboardingDiscussionContinueButton, complete), null);
  assert.equal(resolveReplyKeyboardAction(messages.fa.onboardingInvitationButton, { ...complete, mode: MODES.GLOBAL }), null);

  const nudge = { mode: "onboarding_taste_nudge", state: "idle", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction(messages.en.onboardingTasteSetupStartButton, nudge).callbackData, callBacks.onboardingTasteSetupStart);
  assert.equal(resolveReplyKeyboardAction(messages.en.onboardingTasteSetupLaterButton, nudge).callbackData, callBacks.onboardingTasteSetupDismiss);
  assert.equal(resolveReplyKeyboardAction(messages.en.onboardingTasteSetupStartButton, { ...nudge, mode: MODES.GLOBAL }), null);
});

test("safe onboarding destinations recover from a stale completion keyboard", () => {
  for (const lang of ["fa", "en"]) {
    const idleGlobal = { mode: MODES.GLOBAL, state: "idle", user: { lang } };
    assert.equal(resolveReplyKeyboardAction(messages[lang].onboardingMainMenuButton, idleGlobal).callbackData, callBacks.menuMain);
    assert.equal(resolveReplyKeyboardAction(messages[lang].onboardingFavoritesButton, idleGlobal).callbackData, callBacks.aiAssistant);
    assert.equal(resolveReplyKeyboardAction(messages[lang].discussionActiveList, idleGlobal).callbackData, callBacks.discussionListActive);
    assert.equal(resolveReplyKeyboardAction(messages[lang].onboardingFavoritesButton, { ...idleGlobal, state: "editing_bio" }), null);
  }
});

test("global destination labels do not activate outside the global mode", () => {
  assert.equal(resolveReplyKeyboardAction(messages.en.people, { mode: MODES.PROFILE, state: "idle", user: { lang: "en" } }), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.mainMenuMe, { mode: MODES.FAVORITES, state: "idle", user: { lang: "en" } }), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.people, { mode: MODES.GLOBAL, state: "idle", user: { lang: "en" } }).callbackData, callBacks.people);
});

test("old-language labels cannot activate after language changes", () => {
  assert.equal(resolveReplyKeyboardAction(messages.fa.people, { mode: MODES.GLOBAL, state: "idle", user: { lang: "en" } }), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.people, { mode: MODES.GLOBAL, state: "idle", user: { lang: "en" } }).callbackData, callBacks.people);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileEditName, { mode: MODES.PROFILE, state: "idle", user: { lang: "fa" } }), null);
});

test("mode-specific labels do not activate from a stale keyboard", () => {
  assert.equal(resolveReplyKeyboardAction(messages.en.aiSuggestBooks, { mode: MODES.PEOPLE }), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionMyList, { mode: MODES.FAVORITES }), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.aiSuggestBooks, { mode: MODES.FAVORITES }).callbackData, callBacks.aiSuggestBooks);
});

test("empty People discovery actions work only in the empty-result mode in both languages", () => {
  for (const lang of ["en", "fa"]) {
    const empty = { mode: "people_discovery_empty", state: "idle", user: { lang } };
    assert.equal(resolveReplyKeyboardAction(messages[lang].peopleGoToLists, empty), null);
    assert.equal(resolveReplyKeyboardAction(messages[lang].aiBack, empty).callbackData, callBacks.menuMain);
    assert.equal(resolveReplyKeyboardAction(messages[lang].peopleGoToLists, { ...empty, mode: "people" }), null);
    assert.equal(resolveReplyKeyboardAction(messages[lang].peopleGoToLists, { ...empty, mode: "people_discovery_results:0:2" }), null);
  }
});

test("saved-profile pagination and Back are bound to the exact server page", () => {
  const first = { mode: "saved_profiles:0:3", state: "idle", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction(`${messages.en.discussionListMorePage} ➡️`, first).callbackData, `${callBacks.savedProfilesPage}1`);
  assert.equal(resolveReplyKeyboardAction(`🔙 ${messages.en.discussionListPrevPage}`, first), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.aiBack, first).callbackData, callBacks.menuMain);

  const middleFa = { mode: "saved_profiles:1:3", state: "idle", user: { lang: "fa" } };
  assert.equal(resolveReplyKeyboardAction(`${messages.fa.discussionListMorePage} ➡️`, middleFa).callbackData, `${callBacks.savedProfilesPage}2`);
  assert.equal(resolveReplyKeyboardAction(`🔙 ${messages.fa.discussionListPrevPage}`, middleFa).callbackData, `${callBacks.savedProfilesPage}0`);
  assert.equal(resolveReplyKeyboardAction(`${messages.en.discussionListMorePage} ➡️`, middleFa), null);
  assert.equal(resolveReplyKeyboardAction(messages.fa.aiBack, { ...middleFa, mode: "people" }).callbackData, callBacks.menuMain);
});

test("See People result pagination uses exact-page bottom actions in both languages", () => {
  const { getPeopleListReturnPage } = require("../src/flows/saved-profiles");
  const first = { mode: "people_discovery_results:0:3", state: "idle", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction(`${messages.en.discussionListMorePage} ➡️`, first).callbackData, `${callBacks.peopleDiscoverPage}1`);
  assert.equal(resolveReplyKeyboardAction(`🔙 ${messages.en.discussionListPrevPage}`, first), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.aiBack, first).callbackData, callBacks.menuMain);

  const middle = { mode: "people_discovery_results:1:3", state: "idle", user: { lang: "fa" } };
  assert.equal(resolveReplyKeyboardAction(`${messages.fa.discussionListMorePage} ➡️`, middle).callbackData, `${callBacks.peopleDiscoverPage}2`);
  assert.equal(resolveReplyKeyboardAction(`🔙 ${messages.fa.discussionListPrevPage}`, middle).callbackData, `${callBacks.peopleDiscoverPage}0`);
  assert.equal(resolveReplyKeyboardAction(`${messages.en.discussionListMorePage} ➡️`, middle), null);
  assert.equal(getPeopleListReturnPage("people_discovery_results:1:3"), 1);
  assert.equal(getPeopleListReturnPage("public_profile:people:u_A1:2:unsaved:0"), 2);
  assert.equal(getPeopleListReturnPage("public_profile:saved:u_A1:2:saved:0"), null);
  assert.equal(getPeopleListReturnPage("", { peopleLastListMessageId: 44, peopleLastListPage: 2 }), 2);
  assert.equal(getPeopleListReturnPage("", { peopleLastListMode: "browse", peopleLastListPage: 1 }), 1);
});

test("temporary states and active rooms suppress hub reply navigation", () => {
  assert.equal(resolveReplyKeyboardAction(messages.en.people, { mode: MODES.GLOBAL, state: "editing_name" }), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.people, { mode: MODES.GLOBAL, activeDiscussionId: "room" }), null);
});

test("feature-switched Advanced Search cannot be activated by stale text", () => {
  assert.equal(resolveReplyKeyboardAction(messages.en.advancedSearchButton, { mode: MODES.PEOPLE, advancedSearchEnabled: false }), null);
});

test("own-profile actions resolve only while the server says profile", () => {
  assert.equal(resolveReplyKeyboardAction(messages.fa.profileEditName, { mode: MODES.GLOBAL }), null);
  assert.equal(resolveReplyKeyboardAction(messages.fa.profileEditName, { mode: MODES.PROFILE }).callbackData, callBacks.profileEditName);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileAddPhoto, { mode: MODES.PROFILE }).callbackData, callBacks.profileEditPhoto);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileAddPhoto, { mode: MODES.GLOBAL }), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileEditBio, { mode: MODES.PROFILE }).callbackData, callBacks.profileEditBio);
  assert.equal(resolveReplyKeyboardAction(messages.en.profilePrivacySafetyButton, { mode: MODES.PROFILE }).callbackData, callBacks.profilePrivacy);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileEditAge, { mode: MODES.PROFILE }).callbackData, callBacks.profileEditAge);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileEditGender, { mode: MODES.PROFILE }).callbackData, callBacks.profileEditGender);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileEditInterests, { mode: MODES.PROFILE }).callbackData, callBacks.profileEditInterests);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileMoreSettings, { mode: MODES.PROFILE }).callbackData, callBacks.profileSettings);
});

test("own Profile keeps Back as the final bottom-keyboard row", () => {
  const { profileKeyboard } = require("../src/keyboards");
  for (const lang of ["en", "fa"]) {
    const rows = profileKeyboard(lang, true).reply_markup.keyboard;
    assert.deepEqual(rows.at(-1).map((button) => button.text), [messages[lang].cancel]);
    assert.equal(rows.slice(0, -1).flat().some((button) => button.text === messages[lang].cancel), false);
  }
});

test("Guide, flattened Profile, and Privacy actions remain mode scoped", () => {
  assert.equal(resolveReplyKeyboardAction(messages.en.helpRules, { mode: MODES.HELP }).callbackData, callBacks.helpRules);
  assert.equal(resolveReplyKeyboardAction(messages.en.helpRules, { mode: MODES.PROFILE }), null);
  assert.equal(resolveReplyKeyboardAction(messages.fa.profilePrivacySafetyButton, { mode: MODES.PROFILE }).callbackData, callBacks.profilePrivacy);
  assert.equal(resolveReplyKeyboardAction(messages.fa.profilePrivacySafetyButton, { mode: MODES.PROFILE_SETTINGS }).callbackData, callBacks.profilePrivacy);
  assert.equal(resolveReplyKeyboardAction(messages.fa.accountDeleteButton, { mode: MODES.PROFILE_PRIVACY }).callbackData, callBacks.accountDelete);
  assert.equal(resolveReplyKeyboardAction(messages.fa.accountDeleteButton, { mode: MODES.PROFILE_SETTINGS }), null);
  assert.equal(resolveReplyKeyboardAction(messages.fa.accountDeleteButton, { mode: MODES.PROFILE }), null);
});

test("Profile Settings buttons remain routed while the emoji picker is open", () => {
  const context = { mode: MODES.PROFILE_SETTINGS, state: "editing_profile_emoji", user: { lang: "en" } };
  const expected = new Map([
    [messages.en.profileEditBio, callBacks.profileEditBio],
    [messages.en.profileEmojiButton, callBacks.profileEmoji],
    [messages.en.profilePrivacySafetyButton, callBacks.profilePrivacy],
    [messages.en.profileBackToProfile, callBacks.profileSettingsBack],
  ]);

  for (const [label, callbackData] of expected) {
    assert.equal(resolveReplyKeyboardAction(label, context)?.callbackData, callbackData);
  }
  assert.equal(resolveReplyKeyboardAction(messages.en.profileEditPetPreference, context), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileEditLocation, context), null);
});

test("dashboard-enabled optional Profile fields are routed", () => {
  const previousPet = starEconomy.profilePetPreferenceEnabled;
  const previousLocation = starEconomy.profileLocationEnabled;
  const context = { mode: MODES.PROFILE, state: "idle", user: { lang: "en" } };
  try {
    starEconomy.profilePetPreferenceEnabled = true;
    starEconomy.profileLocationEnabled = true;
    assert.equal(resolveReplyKeyboardAction(messages.en.profileEditPetPreference, context), null);
    assert.equal(resolveReplyKeyboardAction(messages.en.profileEditLocation, context).callbackData, callBacks.profileEditLocation);
  } finally {
    starEconomy.profilePetPreferenceEnabled = previousPet;
    starEconomy.profileLocationEnabled = previousLocation;
  }
});

test("Privacy buttons and restriction list are exact-mode actions", () => {
  const context = { mode: MODES.PROFILE_PRIVACY, state: "idle", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction(messages.en.profileEditLocation, context), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileEditLocation, { mode: MODES.PROFILE_SETTINGS, state: "idle", user: { lang: "en" } }), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileHideFromPeopleDiscovery, context).callbackData, `${callBacks.profileSetPeopleDiscovery}0`);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileShowInPeopleDiscovery, context).callbackData, `${callBacks.profileSetPeopleDiscovery}1`);
  const restrictions = messages.en.profileInvitationRestrictionsButton;
  assert.equal(resolveReplyKeyboardAction(restrictions, context).callbackData, callBacks.profileInvitationRestrictions);
  assert.equal(resolveReplyKeyboardAction(restrictions, { mode: MODES.PROFILE_SETTINGS, state: "idle", user: { lang: "en" } }), null);
});

test("Favorites list-manager actions retain trusted section and list context", () => {
  assert.equal(resolveReplyKeyboardAction(messages.en.aiFavoritesAddFirstMovies, { mode: "ai_list:movies:topTen", state: "ai_manage_movies_top_ten" }).callbackData, `${callBacks.aiListManageAdd}movies:top_ten`);
  const another = messages.en.aiFavoritesAddAnotherMovies.replace("{count}", "4").replace("{goal}", "10");
  assert.equal(resolveReplyKeyboardAction(another, { mode: "ai_list:movies:topTen", state: "ai_manage_movies_top_ten" }).callbackData, `${callBacks.aiListManageAdd}movies:top_ten`);
  assert.equal(resolveReplyKeyboardAction(messages.en.aiFavoritesAddFirstMovies, { mode: "ai_list:books:topTen", state: "ai_manage_books_top_ten" }), null);
  assert.equal(resolveReplyKeyboardAction(messages.fa.aiFavoritesAddFirstMovies, { mode: "ai_list:movies:topTen", state: "ai_manage_movies_top_ten" }).callbackData, `${callBacks.aiListManageAdd}movies:top_ten`);
  assert.equal(resolveReplyKeyboardAction(messages.fa.aiFavoritesAddFirstMovies, { mode: "ai_list:movies:topTen", state: "ai_manage_movies_top_ten_add_input" }), null);
  const listButton = messages.en.aiSectionListButtonMovies;
  const emptyWatchlist = {
    mode: "ai_list:movies:topTen",
    state: "ai_manage_movies_top_ten",
    user: { lang: "en", aiLists: { movies: { watchlist: [] } } },
  };
  const populatedWatchlist = {
    ...emptyWatchlist,
    user: { lang: "en", aiLists: { movies: { watchlist: [{ title: "Arrival" }] } } },
  };
  assert.equal(resolveReplyKeyboardAction(listButton, emptyWatchlist), null);
  assert.equal(
    resolveReplyKeyboardAction(listButton, populatedWatchlist).callbackData,
    `${callBacks.aiListManageMenu}movies:watchlist`,
  );
});

test("every visible Favorites manager button resolves in its exact section", () => {
  const { aiListManageMenuKeyboard } = require("../src/keyboards");
  for (const lang of ["en", "fa"]) {
    for (const section of ["movies", "music", "books"]) {
      const user = {
        lang,
        aiLists: {
          [section]: {
            topTen: Array.from({ length: 6 }, (_, index) => ({ title: `Favorite ${index + 1}` })),
            watchlist: [{ title: "Later" }],
          },
        },
      };
      const context = {
        mode: `ai_list:${section}:topTen`,
        state: `ai_manage_${section}_top_ten`,
        user,
      };
      const labels = aiListManageMenuKeyboard(lang, section, "topTen", {
        hasItems: true,
        itemCount: 6,
        hasWatchlistItems: true,
      }).reply_markup.keyboard.flat().map((button) => button.text);

      for (const label of labels) {
        assert.ok(resolveReplyKeyboardAction(label, context), `${lang}/${section}: ${label}`);
      }
    }
  }
});

test("completed media Favorites expose the taste-label review action", () => {
  const { aiListManageMenuKeyboard } = require("../src/keyboards");
  const topTen = Array.from({ length: 10 }, (_, index) => ({ title: `Favorite ${index + 1}` }));
  const user = { lang: "fa", aiLists: { books: { topTen, watchlist: [] } } };
  const labels = aiListManageMenuKeyboard("fa", "books", "topTen", {
    hasItems: true, itemCount: 10,
  }).reply_markup.keyboard.flat().map((button) => button.text);
  assert.ok(labels.includes(messages.fa.aiTasteReviewButton));
  assert.equal(resolveReplyKeyboardAction(messages.fa.aiTasteReviewButton, {
    mode: "ai_list:books:topTen",
    state: "ai_manage_books_top_ten",
    user,
  }).callbackData, `${callBacks.aiTasteReview}books`);
});

test("an earned taste label remains reviewable after the list drops below 10", () => {
  const { aiListManageMenuKeyboard } = require("../src/keyboards");
  const topTen = Array.from({ length: 9 }, (_, index) => ({ title: `Favorite ${index + 1}` }));
  const user = {
    lang: "en",
    aiLists: { movies: { topTen, watchlist: [] } },
    aiTaste: { movies: { labelKey: "drama_lover", classificationStatus: "confirmed" } },
  };
  const labels = aiListManageMenuKeyboard("en", "movies", "topTen", {
    hasItems: true, itemCount: 9, hasTasteLabel: true,
  }).reply_markup.keyboard.flat().map((button) => button.text);
  assert.ok(labels.includes(messages.en.aiTasteReviewButton));
  assert.equal(resolveReplyKeyboardAction(messages.en.aiTasteReviewButton, {
    mode: "ai_list:movies:topTen", state: "ai_manage_movies_top_ten", user,
  }).callbackData, `${callBacks.aiTasteReview}movies`);
});

test("a saved No-label shortlist remains reviewable after the list drops below 10", () => {
  const { aiListManageMenuKeyboard } = require("../src/keyboards");
  const topTen = Array.from({ length: 7 }, (_, index) => ({ title: `Favorite ${index + 1}` }));
  const user = {
    lang: "fa",
    aiLists: { music: { topTen, watchlist: [] } },
    aiTaste: { music: {
      classificationStatus: "skipped",
      suggestedLabelKeys: ["metalhead", "music_buff"],
      freeClassificationUsedAt: new Date("2026-01-01T00:00:00Z"),
    } },
  };
  const labels = aiListManageMenuKeyboard("fa", "music", "topTen", {
    hasItems: true, itemCount: 7, hasTasteLabel: true,
  }).reply_markup.keyboard.flat().map((button) => button.text);
  assert.ok(labels.includes(messages.fa.aiTasteReviewButton));
  assert.equal(resolveReplyKeyboardAction(messages.fa.aiTasteReviewButton, {
    mode: "ai_list:music:topTen", state: "ai_manage_music_top_ten", user,
  }).callbackData, `${callBacks.aiTasteReview}music`);
});

test("For Later Add works after entering from a saved suggestion", () => {
  for (const [lang, section, key] of [
    ["en", "movies", "aiListManageAddLaterMovies"],
    ["fa", "music", "aiListManageAddLaterMusic"],
    ["fa", "books", "aiListManageAddLaterBooks"],
  ]) {
    const user = { lang };
    const result = resolveReplyKeyboardAction(messages[lang][key], {
      mode: `ai_list:${section}:watchlist`,
      state: `ai_manage_${section}_watchlist`,
      user,
    });
    assert.equal(result.callbackData, `${callBacks.aiListManageAdd}${section}:watchlist`);
  }
});

test("Back changes meaning after returning from a media list to Favorites", () => {
  for (const section of ["movies", "music", "books"]) {
    const manager = resolveReplyKeyboardAction(messages.en.aiBack, { mode: `ai_list:${section}:topTen`, state: `ai_manage_${section}_top_ten` });
    assert.equal(manager.callbackData, `${callBacks.aiListManageBack}${section}`);
  }
  const favorites = resolveReplyKeyboardAction(messages.en.aiBack, { mode: MODES.FAVORITES, state: "idle" });
  assert.equal(favorites.callbackData, callBacks.menuMain);
});

test("age ranges and exact ages resolve only in their matching edit mode", () => {
  assert.equal(resolveReplyKeyboardAction("\u206613-17\u2069", { mode: "profile_age", state: "editing_age" }).callbackData, `${callBacks.profileAgeRangeSet}13`);
  assert.equal(resolveReplyKeyboardAction("17", { mode: "profile_age_range:13", state: "editing_age" }).callbackData, `${callBacks.profileAgeSet}17`);
  assert.equal(resolveReplyKeyboardAction("18", { mode: "profile_age_range:13", state: "editing_age" }), null);
  assert.equal(resolveReplyKeyboardAction("17", { mode: MODES.PROFILE, state: "idle" }), null);
  assert.equal(resolveReplyKeyboardAction("🔙", { mode: "profile_age_range:13", state: "editing_age" }).callbackData, callBacks.profileAgeRangeBack);
});

test("gender and pet choices are scoped to their profile picker states", () => {
  assert.equal(resolveReplyKeyboardAction(messages.en.genderOptionFemaleButton, { mode: "profile_gender", state: "editing_gender" }).callbackData, `${callBacks.profileGenderSet}female`);
  assert.equal(resolveReplyKeyboardAction(messages.fa.petOptionCatButton, { mode: "profile_pet", state: "editing_pet_preference" }), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.genderOptionFemaleButton, { mode: "profile_pet", state: "editing_pet_preference" }), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.petOptionCatButton, { mode: MODES.PROFILE, state: "idle" }), null);

  const previous = starEconomy.profilePetPreferenceEnabled;
  try {
    starEconomy.profilePetPreferenceEnabled = true;
    assert.equal(resolveReplyKeyboardAction(messages.fa.petOptionCatButton, {
      mode: "profile_pet", state: "editing_pet_preference",
    }).callbackData, `${callBacks.profilePetSet}cat`);
  } finally {
    starEconomy.profilePetPreferenceEnabled = previous;
  }
});

test("Profile Back exits every inline profile picker instead of becoming picker input", () => {
  const previousPet = starEconomy.profilePetPreferenceEnabled;
  starEconomy.profilePetPreferenceEnabled = true;
  try {
    const cases = [
      { mode: "profile_age", state: "editing_age" },
      { mode: "profile_gender", state: "editing_gender" },
      { mode: "profile_pet", state: "editing_pet_preference" },
      { mode: "profile_interests:0", state: "editing_interests" },
      { mode: "profile_emoji", state: "editing_profile_emoji" },
      { mode: "profile_emoji", state: "profile_emoji_confirm:0:3:abc" },
    ];
    for (const context of cases) {
      assert.equal(
        resolveReplyKeyboardAction(messages.fa.cancel, { ...context, user: { lang: "fa" } })?.callbackData,
        callBacks.profileCancelEdit,
        `${context.mode}/${context.state}`,
      );
    }
  } finally {
    starEconomy.profilePetPreferenceEnabled = previousPet;
  }
});

test("Interests chips resolve add, selected removal, More, and Done from the trusted page", () => {
  const emptyUser = { lang: "en", aiLists: { random: { topTen: [] } } };
  const add = resolveReplyKeyboardAction("🎬 Movies", { mode: "profile_interests:0", state: "editing_interests", user: emptyUser });
  assert.equal(add.callbackData, `${callBacks.profileInterestChip}0:0`);
  const selectedUser = { lang: "en", aiLists: { random: { topTen: [{ title: "Movies" }] } } };
  const remove = resolveReplyKeyboardAction("🎬 Movies ✓", { mode: "profile_interests:0", state: "editing_interests", user: selectedUser });
  assert.equal(remove.callbackData, `${callBacks.profileInterestRemove}0:0`);
  assert.equal(resolveReplyKeyboardAction(messages.en.onboardingMoreButton, { mode: "profile_interests:0", state: "editing_interests", user: emptyUser }).callbackData, `${callBacks.profileInterestMore}1`);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileInterestsDone, { mode: "profile_interests:0", state: "editing_interests", user: emptyUser }).callbackData, callBacks.profileInterestsDone);
  assert.equal(resolveReplyKeyboardAction("🎬 Movies", { mode: MODES.PROFILE, state: "idle", user: emptyUser }), null);
});

test("stale Profile keyboard labels cannot become custom Interests", () => {
  assert.equal(isKnownProfileNavigationLabel(messages.fa.profileEditInterests), true);
  assert.equal(isKnownProfileNavigationLabel(messages.en.profileMoreSettings), true);
  assert.equal(isKnownProfileNavigationLabel("Astronomy"), false);
});

test("Movies add and comment input controls resolve across every recovery state", () => {
  const mode = "ai_list:movies:topTen";
  assert.equal(resolveReplyKeyboardAction(messages.en.cancelEdit, { mode, state: "ai_manage_movies_top_ten_add_input" }).callbackData, `${callBacks.aiListManageCancelAdd}movies:top_ten`);
  assert.equal(resolveReplyKeyboardAction(messages.fa.aiListManageAddBackToList, { mode, state: "ai_manage_movies_top_ten_add_input" }).callbackData, `${callBacks.aiListManageCancelAdd}movies:top_ten:back`);
  assert.equal(resolveReplyKeyboardAction(messages.fa.aiListManageAddBackToList, { mode: "ai_list_completion:movies:topTen", state: "ai_manage_movies_top_ten" }).callbackData, `${callBacks.aiListManageCancelAdd}movies:top_ten:back`);
  assert.equal(resolveReplyKeyboardAction(messages.en.cancelEdit, { mode, state: "ai_manage_movies_top_ten_comment_input" }).callbackData, `${callBacks.aiListManageCancelComment}movies:top_ten`);
  assert.equal(resolveReplyKeyboardAction(messages.en.cancelEdit, { mode, state: "ai_manage_books_top_ten_add_input" }), null);
});

test("suggestion source selection uses section-scoped bottom actions", () => {
  assert.equal(resolveReplyKeyboardAction(messages.en.aiSuggestionFromTopTenButton, { mode: "ai_suggestion_mode:movies", state: "ai_chat_movies" }).callbackData, `${callBacks.aiSectionSuggestFromTopTen}movies`);
  assert.equal(resolveReplyKeyboardAction(messages.en.aiBack, { mode: "ai_suggestion_mode:music", state: "ai_chat_music" }).callbackData, `${callBacks.aiListManageMenu}music:top_ten`);
  assert.equal(resolveReplyKeyboardAction(messages.en.aiSuggestionFromTopTenButton, { mode: "ai_suggestion_mode:books", state: "ai_chat_movies" }), null);
});

test("suggestion result Save, Done, and Reject buttons work in every media section", () => {
  const doneKeys = { movies: "aiSuggestionAddDoneButtonMovies", music: "aiSuggestionAddDoneButtonMusic", books: "aiSuggestionAddDoneButtonBooks" };
  for (const section of ["movies", "music", "books"]) {
    const mode = `ai_suggestion_result:${section}`;
    const state = `ai_chat_${section}`;
    const listName = require("../src/services/ai-section").getSectionListLabel(messages, "en", section);
    const addText = messages.en.aiSuggestionAddToListButton.replace("{listName}", listName);
    assert.equal(resolveReplyKeyboardAction(addText, { mode, state, user: { lang: "en" } }).callbackData, `${callBacks.aiSectionAddSuggestion}${section}`);
    assert.equal(resolveReplyKeyboardAction(messages.en[doneKeys[section]], { mode, state }).callbackData, `${callBacks.aiSectionAddSuggestionDone}${section}`);
    assert.equal(resolveReplyKeyboardAction(messages.fa.aiSuggestionRejectButton, { mode, state }).callbackData, `${callBacks.aiSectionRejectSuggestion}${section}`);
  }
  assert.equal(resolveReplyKeyboardAction(messages.en.aiSuggestionRejectButton, { mode: "ai_suggestion_result:books", state: "ai_chat_movies" }), null);
});

test("suggestion result buttons win over a stale mood-entry state", () => {
  const mode = "ai_suggestion_result:books";
  const state = "ai_suggest_context_books";
  const user = { lang: "fa" };
  const saveText = messages.fa.aiSuggestionAddToListButton.replace(
    "{listName}",
    messages.fa.aiSectionListLabelBooks,
  );

  assert.equal(
    resolveReplyKeyboardAction(saveText, { mode, state, user }).callbackData,
    `${callBacks.aiSectionAddSuggestion}books`,
  );
  assert.equal(
    resolveReplyKeyboardAction(messages.fa.aiSuggestionAddDoneButtonBooks, { mode, state, user }).callbackData,
    `${callBacks.aiSectionAddSuggestionDone}books`,
  );
  assert.equal(
    resolveReplyKeyboardAction(messages.fa.aiSuggestionRejectButton, { mode, state, user }).callbackData,
    `${callBacks.aiSectionRejectSuggestion}books`,
  );
});

test("post-save and post-reject suggestion actions replace the old result mode", () => {
  for (const section of ["movies", "music", "books"]) {
    // Save for later and already watched/listened/read intentionally enter this same mode.
    const added = { mode: `ai_suggestion_added:${section}`, state: `ai_chat_${section}`, user: { lang: "fa" } };
    assert.equal(resolveReplyKeyboardAction(messages.fa.aiSuggestionAnotherButton, added).callbackData, `${callBacks.aiSectionAnotherSuggestion}${section}`);
    const listText = messages.fa.aiSuggestionGoToListButton.replace("{listName}", require("../src/services/ai-section").getSectionListLabel(messages, "fa", section));
    assert.equal(resolveReplyKeyboardAction(listText, added).callbackData, `${callBacks.aiListManageShow}${section}:watchlist`);
    assert.equal(resolveReplyKeyboardAction(messages.fa.aiSuggestionGoToFavoritesButton, added).callbackData, `${callBacks.aiListManageMenu}${section}:top_ten`);
  }

  const rejected = { mode: "ai_suggestion_next:movies", state: "ai_chat_movies", user: { lang: "fa" } };
  assert.equal(resolveReplyKeyboardAction(messages.fa.aiSuggestionAnotherButton, rejected).callbackData, `${callBacks.aiSectionAnotherSuggestion}movies`);
  assert.equal(resolveReplyKeyboardAction(messages.fa.aiSuggestionAddToListButton.replace("{listName}", "x"), rejected), null);
});

test("suggestion context Cancel works only while that section awaits context", () => {
  assert.equal(resolveReplyKeyboardAction(messages.fa.cancelEdit, { mode: "ai_suggestion_context:movies", state: "ai_suggest_context_movies", user: { lang: "fa" } }).callbackData, `${callBacks.aiSectionSuggestContextCancel}movies`);
  assert.equal(resolveReplyKeyboardAction(messages.en.cancelEdit, { mode: "ai_suggestion_context:books", state: "ai_suggest_context_books", user: { lang: "en" } }).callbackData, `${callBacks.aiSectionSuggestContextCancel}books`);
  assert.equal(resolveReplyKeyboardAction(messages.en.cancelEdit, { mode: "ai_suggestion_context:books", state: "ai_chat_books", user: { lang: "en" } }), null);
  assert.equal(resolveReplyKeyboardAction(messages.fa.cancelEdit, { mode: "ai_suggestion_context:movies", state: "ai_suggest_context_books", user: { lang: "fa" } }), null);
});

test("filtered For Later rows keep commands bound to original list indexes", () => {
  const { formatAiItemsList } = require("../src/services/ai-list-ui");
  const text = formatAiItemsList("Seen", [{ title: "Arrival", watched: true, commandIndex: 3 }], "Empty", {
    includeWatched: true, includeActions: true, canPromote: true, lang: "en", section: "movies", listType: "watchlist",
  });
  assert.match(text, /\/un_mv_l_3/);
  assert.match(text, /\/tt_mv_l_3/);
  assert.match(text, /\/cm_mv_l_3/);
  assert.match(text, /\/rm_mv_l_3/);
});

test("filtered For Later mode exposes only Show all and restores the full-list action", () => {
  const { aiListManageMenuKeyboard } = require("../src/keyboards");
  const filteredButtons = aiListManageMenuKeyboard("en", "movies", "watchlist", { hasItems: true, itemCount: 3, filter: "watched" }).reply_markup.keyboard.flat().map((button) => button.text);
  assert.ok(filteredButtons.includes(messages.en.aiListManageShowAll));
  assert.ok(!filteredButtons.includes(messages.en.aiListManageShowWatchedMovies));
  assert.ok(!filteredButtons.includes(messages.en.aiListManageShowNotWatchedMovies));
  assert.equal(resolveReplyKeyboardAction(messages.en.aiListManageShowAll, { mode: "ai_list_filter:movies:watched", state: "ai_manage_movies_watchlist", user: { lang: "en" } }).callbackData, `${callBacks.aiListManageShow}movies:watchlist:all`);
  assert.equal(resolveReplyKeyboardAction(messages.en.aiListManageShowAll, { mode: "ai_list:movies:watchlist", state: "ai_manage_movies_watchlist", user: { lang: "en" } }), null);
});

test("filtered For Later navigation returns to Favorites instead of add guidance", () => {
  for (const [lang, section, filter, addKey] of [
    ["en", "movies", "watched", "aiListManageAddLaterMovies"],
    ["fa", "music", "not_watched", "aiListManageAddLaterMusic"],
    ["en", "books", "watched", "aiListManageAddLaterBooks"],
  ]) {
    const context = {
      mode: `ai_list_filter:${section}:${filter}`,
      state: `ai_manage_${section}_watchlist`,
      user: { lang },
    };
    assert.equal(
      resolveReplyKeyboardAction(messages[lang].aiSuggestionGoToFavoritesButton, context).callbackData,
      `${callBacks.aiListManageBack}${section}`,
    );
    assert.equal(
      resolveReplyKeyboardAction(messages[lang][addKey], context).callbackData,
      `${callBacks.aiListManageAdd}${section}:watchlist`,
    );
  }
});

test("legacy Guide reply keyboards remain usable only in their existing modes", () => {
  assert.equal(resolveReplyKeyboardAction(messages.en.profileStarsBack, { mode: "help_stars", state: "idle", user: { lang: "en" } }).callbackData, callBacks.profileStarsBack);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileStarsBack, { mode: MODES.HELP, state: "idle", user: { lang: "en" } }), null);
  assert.equal(resolveReplyKeyboardAction(messages.fa.helpReferralButton, { mode: MODES.HELP, state: "idle", user: { lang: "fa" } }).callbackData, callBacks.helpReferral);
  assert.equal(resolveReplyKeyboardAction(messages.fa.helpBrowseDiscussions, { mode: MODES.HELP, state: "idle", user: { lang: "fa" } }), null);
  assert.equal(resolveReplyKeyboardAction(messages.fa.helpGoToLists, { mode: MODES.HELP, state: "idle", user: { lang: "fa" } }), null);
});

test("Guide reply buttons recover from the inline experiment's persisted global mode", () => {
  const context = { mode: MODES.GLOBAL, state: "idle", user: { lang: "fa" } };
  assert.equal(resolveReplyKeyboardAction(messages.fa.profileStarsButton, context).callbackData, callBacks.profileStars);
  assert.equal(resolveReplyKeyboardAction(messages.fa.helpReferralButton, context).callbackData, callBacks.helpReferral);
  assert.equal(resolveReplyKeyboardAction(messages.fa.helpRules, context).callbackData, callBacks.helpRules);
  assert.equal(resolveReplyKeyboardAction(messages.fa.helpBackToGuide, context).callbackData, callBacks.help);
  assert.equal(resolveReplyKeyboardAction(messages.fa.profileStarsBack, context).callbackData, callBacks.help);
  assert.equal(resolveReplyKeyboardAction(messages.fa.helpBackToMain, context).callbackData, callBacks.menuMain);
});

test("discussion list and invitation navigation is bound to its exact server page", () => {
  const active = { mode: "discussion_list:active:0:2:all:fa", state: "idle", activeDiscussionId: "room", user: { lang: "fa" } };
  assert.equal(resolveReplyKeyboardAction(`${messages.fa.discussionListMorePage} ➡️`, active).callbackData, `${callBacks.discussionListActivePage}1:all:fa`);
  assert.equal(resolveReplyKeyboardAction(messages.fa.discussionBack, active).callbackData, callBacks.menuMain);
  assert.equal(resolveReplyKeyboardAction("🌐 زبان گفت‌وگوها (فارسی)", active).callbackData, `${callBacks.discussionListLanguageOpen}all:fa`);
  assert.equal(resolveReplyKeyboardAction(`${messages.fa.discussionListMorePage} ➡️`, { ...active, mode: "discussions" }), null);
  const invitations = { mode: "discussion_invitations:1:3", state: "idle", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction(`⬅️ ${messages.en.discussionListPrevPage}`, invitations).callbackData, `${callBacks.discussionInvitationsPage}0`);
});

test("discussion hub remains actionable while the user still has an active room", () => {
  const context = { mode: MODES.DISCUSSIONS, state: "idle", activeDiscussionId: "room-1", user: { lang: "fa" } };
  assert.equal(resolveReplyKeyboardAction(messages.fa.discussionActiveList, context).callbackData, callBacks.discussionListActive);
  assert.equal(resolveReplyKeyboardAction(messages.fa.discussionMyList, context).callbackData, callBacks.discussionListMine);
  assert.equal(resolveReplyKeyboardAction(messages.fa.discussionInvitations, context).callbackData, callBacks.discussionInvitations);
  assert.equal(resolveReplyKeyboardAction(messages.fa.mainMenuMe, context), null);
});

test("discussion hub bottom buttons remain actionable under inline discussion cards", () => {
  const { discussionsMenuKeyboard } = require("../src/keyboards");
  const rows = discussionsMenuKeyboard("en").reply_markup.keyboard.map((row) => row.map((button) => button.text));
  assert.deepEqual(rows, [
    [messages.en.discussionActiveList, messages.en.discussionInvitations],
    [messages.en.discussionCreate, messages.en.discussionMyList],
    [messages.en.aiBack],
  ]);
  const modes = [
    "discussion_list:active:0:2:all:fa",
    "discussion_list:mine:0:1:all:all",
    "discussion_invitations:0:1",
    "discussion_language:all:fa",
  ];

  for (const mode of modes) {
    const context = { mode, state: "idle", activeDiscussionId: "room-1", user: { lang: "en" } };
    assert.equal(resolveReplyKeyboardAction(messages.en.discussionActiveList, context).callbackData, callBacks.discussionListActive);
    assert.equal(resolveReplyKeyboardAction(messages.en.discussionInvitations, context).callbackData, callBacks.discussionInvitations);
    assert.equal(resolveReplyKeyboardAction(messages.en.discussionCreate, context).callbackData, callBacks.discussionCreateStart);
    assert.equal(resolveReplyKeyboardAction(messages.en.discussionMyList, context).callbackData, callBacks.discussionListMine);
    assert.equal(resolveReplyKeyboardAction(messages.en.aiBack, context).callbackData, callBacks.menuMain);
  }
});

test("People hub bottom buttons remain actionable under inline People cards", () => {
  const modes = [
    "people_discovery_results:0:2",
    "people_discovery_empty",
    "saved_profiles:0:2",
  ];

  for (const mode of modes) {
    const context = { mode, state: "idle", user: { lang: "en" } };
    assert.equal(resolveReplyKeyboardAction(messages.en.peopleDiscover, context).callbackData, callBacks.peopleDiscover);
    assert.equal(resolveReplyKeyboardAction(messages.en.savedProfiles, context).callbackData, callBacks.savedProfiles);
    assert.equal(resolveReplyKeyboardAction(messages.en.advancedSearchButton, context).callbackData, callBacks.peopleAdvancedSearch);
    assert.equal(resolveReplyKeyboardAction(messages.en.aiBack, context).callbackData, callBacks.menuMain);
  }
});

test("discussion join-lock acknowledgement is bottom-mode scoped to its exact source", () => {
  const active = { mode: "discussion_join_error:active", state: "idle", activeDiscussionId: "room-1", user: { lang: "fa" } };
  assert.equal(resolveReplyKeyboardAction(messages.fa.acknowledgeButton, active).callbackData, `${callBacks.discussionJoinErrorAck}active`);
  assert.equal(resolveReplyKeyboardAction(messages.fa.acknowledgeButton, { ...active, mode: "discussion_list:active:0:1:all:fa" }), null);
  const saved = { mode: "discussion_join_error:saved:u_A1", state: "idle", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction(messages.en.acknowledgeButton, saved).callbackData, `${callBacks.discussionJoinErrorAck}saved:u_A1`);
  assert.equal(resolveReplyKeyboardAction("فهمیدم", active), null);
  assert.equal(resolveReplyKeyboardAction("Got it", saved), null);
});

test("acknowledgement copy is friendly and consistent in both languages", () => {
  assert.equal(messages.fa.acknowledgeButton, "👍 متوجه شدم");
  assert.equal(messages.en.acknowledgeButton, "👍 Got it");
  assert.equal(messages.fa.profileActiveDiscussionHelpDone, messages.fa.acknowledgeButton);
  assert.equal(messages.en.profileActiveDiscussionHelpDone, messages.en.acknowledgeButton);
  assert.match(messages.fa.aiSuggestionRejected, /👍 متوجه شدم/);
  assert.match(messages.en.aiSuggestionRejected, /👍 Got it/);
});

test("in-room invitation launcher stays inline with its actions and explicit Close", () => {
  const { discussionInviteModeKeyboard } = require("../src/keyboards");
  const rows = discussionInviteModeKeyboard("en").reply_markup.inline_keyboard;
  assert.deepEqual(rows.flat().map((button) => button.callback_data), [callBacks.discussionInviteModeSaved, callBacks.discussionInviteModeShare, callBacks.discussionInvitePickerClose]);

  const withoutSavedProfiles = discussionInviteModeKeyboard("en", { hasSavedProfiles: false })
    .reply_markup.inline_keyboard.flat();
  assert.deepEqual(withoutSavedProfiles.map((button) => button.callback_data), [
    callBacks.discussionInviteModeShare,
    callBacks.discussionInvitePickerClose,
  ]);
});

test("saved-profile invitation picker contains profile targets and explicit Close", () => {
  const { discussionInviteSavedProfilesKeyboard } = require("../src/keyboards");
  const rows = discussionInviteSavedProfilesKeyboard("fa", [
    { name: "Arman", code: "u_SEED001" },
    { name: "Nika", code: "u_SEED002" },
  ]).reply_markup.inline_keyboard;
  assert.deepEqual(rows.flat().map((button) => button.text), ["Arman", "Nika", messages.fa.discussionShareClose]);
  assert.equal(rows.at(-1)[0].callback_data, callBacks.discussionInvitePickerClose);
  assert.match(messages.fa.discussionInviteModeText, /^👩‍🦳/);
  assert.match(messages.fa.discussionInviteChooseSavedProfile, /^👩‍🦳/);
});

test("saved-profile invitation picker paginates with room-bound callbacks", () => {
  const { discussionInviteSavedProfilesKeyboard } = require("../src/keyboards");
  const discussionId = "507f1f77bcf86cd799439011";
  const firstPage = discussionInviteSavedProfilesKeyboard("en", [
    { name: "One", code: "u_1" },
    { name: "Two", code: "u_2" },
    { name: "Three", code: "u_3" },
    { name: "Four", code: "u_4" },
    { name: "Five", code: "u_5" },
  ], { page: 0, totalPages: 2, discussionId, discussionCode: "d_ROOM1" }).reply_markup.inline_keyboard;

  assert.equal(firstPage.filter((row) => row[0].callback_data.startsWith(callBacks.discussionInviteSavedTarget)).length, 5);
  assert.equal(
    firstPage[0][0].callback_data,
    `${callBacks.discussionInviteSavedTarget}u_1:d_ROOM1`,
  );
  assert.equal(
    firstPage.at(-2)[0].callback_data,
    `${callBacks.discussionInviteSavedPage}1:${discussionId}`,
  );
  assert.equal(firstPage.at(-1)[0].callback_data, callBacks.discussionInvitePickerClose);

  const secondPage = discussionInviteSavedProfilesKeyboard("en", [
    { name: "Six", code: "u_6" },
  ], { page: 1, totalPages: 2, discussionId, discussionCode: "d_ROOM1" }).reply_markup.inline_keyboard;
  assert.equal(
    secondPage.at(-2)[0].callback_data,
    `${callBacks.discussionInviteSavedPage}0:${discussionId}`,
  );
});

test("discussion-member profiles use Save/Saved status and a source-specific Close", () => {
  const { profilePublicActionsKeyboard } = require("../src/keyboards");
  const unsaved = profilePublicActionsKeyboard("en", "u_A1", { source: "discussion_members", isSaved: false }).reply_markup.inline_keyboard.flat();
  assert.ok(unsaved.some((button) => button.callback_data === `${callBacks.profileSaveByCode}u_A1:members`));
  assert.ok(unsaved.some((button) => button.callback_data === callBacks.profileCloseDiscussionMember));
  const saved = profilePublicActionsKeyboard("en", "u_A1", { source: "discussion_members", isSaved: true }).reply_markup.inline_keyboard.flat();
  assert.deepEqual(saved.map((button) => button.callback_data), [callBacks.profileCloseDiscussionMember]);
  assert.ok(!saved.some((button) => button.callback_data.startsWith(callBacks.profileUnsaveByCode)));
  const savedWithDiscussion = profilePublicActionsKeyboard("en", "u_A1", { source: "discussion_members", isSaved: true, hasDiscussions: true }).reply_markup.inline_keyboard.flat();
  assert.ok(savedWithDiscussion.some((button) => button.callback_data === `${callBacks.savedProfilesDiscussions}discussion_members:u_A1`));
});

test("People and Saved profile previews use source-aware inline actions", () => {
  const { profilePublicActionsKeyboard } = require("../src/keyboards");
  const peopleKeyboard = profilePublicActionsKeyboard("en", "u_A1", { source: "people", isSaved: false }).reply_markup;
  assert.deepEqual(peopleKeyboard.inline_keyboard.flat().map((button) => button.callback_data), [
    `${callBacks.profileSaveByCode}u_A1`,
    callBacks.profileCloseDiscussionMember,
  ]);

  const savedKeyboard = profilePublicActionsKeyboard("fa", "u_A1", { source: "saved", isSaved: true, hasDiscussions: true }).reply_markup;
  assert.deepEqual(savedKeyboard.inline_keyboard.flat().map((button) => button.callback_data), [
    `${callBacks.savedProfilesDiscussions}saved:u_A1`,
    `${callBacks.profileUnsaveByCode}u_A1`,
    callBacks.profileCloseDiscussionMember,
  ]);

  const peopleMode = { mode: "public_profile:people:u_A1:2:unsaved:0", state: "idle", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction(messages.en.profileSaveButton, peopleMode).callbackData, `${callBacks.profileSaveByCode}u_A1`);
  assert.equal(resolveReplyKeyboardAction(messages.en.aiBack, peopleMode).callbackData, callBacks.menuMain);
  assert.equal(resolveReplyKeyboardAction(messages.en.peopleDiscover, peopleMode).callbackData, callBacks.peopleDiscover);
  assert.equal(resolveReplyKeyboardAction(messages.en.savedProfiles, peopleMode).callbackData, callBacks.savedProfiles);
  assert.equal(resolveReplyKeyboardAction(messages.en.savedProfileRemove, peopleMode), null);

  const savedMode = { mode: "public_profile:saved:u_A1:1:saved:1", state: "idle", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction(messages.en.savedProfileDiscussions, savedMode).callbackData, `${callBacks.savedProfilesDiscussions}saved:u_A1`);
  assert.equal(resolveReplyKeyboardAction(messages.en.savedProfileRemove, savedMode).callbackData, `${callBacks.profileUnsaveByCode}u_A1`);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileBackToSaved, savedMode).callbackData, `${callBacks.savedProfilesPage}1`);
  assert.equal(resolveReplyKeyboardAction(messages.en.profileSaveButton, savedMode), null);
});

test("profile discussion view uses inline Back and Close while keeping the People hub available", () => {
  const { profileDiscussionBackKeyboard } = require("../src/flows/saved-profiles");
  const keyboard = profileDiscussionBackKeyboard("fa", "u_A1").reply_markup;
  assert.deepEqual(keyboard.inline_keyboard.flat().map((button) => button.callback_data), [
    `${callBacks.profileDiscussionsBack}u_A1`,
    callBacks.profileDiscussionsClose,
  ]);

  const mode = { mode: "profile_discussions:saved:u_A1:2", state: "idle", user: { lang: "fa" } };
  assert.equal(resolveReplyKeyboardAction(messages.fa.aiBack, mode).callbackData, callBacks.menuMain);
  assert.equal(resolveReplyKeyboardAction(messages.fa.peopleDiscover, mode).callbackData, callBacks.peopleDiscover);
  assert.equal(resolveReplyKeyboardAction(messages.en.aiBack, mode), null);
  assert.equal(resolveReplyKeyboardAction(messages.fa.aiBack, { ...mode, mode: "saved_profiles:2:3" }).callbackData, callBacks.menuMain);
});

test("saved-profile removal confirmation is exact-profile and source scoped", () => {
  const { savedProfileRemoveConfirmKeyboard, parseProfileUnsaveConfirmMode } = require("../src/flows/saved-profiles");
  const { parsePublicProfileNavigationMode } = require("../src/services/public-profile-navigation");
  const keyboard = savedProfileRemoveConfirmKeyboard("fa").reply_markup;
  assert.deepEqual(keyboard.inline_keyboard.flat().map((button) => button.callback_data), [
    callBacks.profileUnsaveConfirm,
    callBacks.profileUnsaveCancel,
  ]);
  assert.deepEqual(parseProfileUnsaveConfirmMode("profile_unsave_confirm:people:u_A1:2"), {
    origin: "people",
    code: "u_A1",
    page: 2,
  });
  assert.deepEqual(parsePublicProfileNavigationMode("public_profile:people:u_A1:2:saved:1"), {
    source: "people",
    code: "u_A1",
    page: 2,
    isSaved: true,
    hasDiscussions: true,
  });

  const confirmation = { mode: "profile_unsave_confirm:saved:u_A1:1", state: "idle", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction(messages.en.savedProfileRemoveConfirmButton, confirmation).callbackData, callBacks.profileUnsaveConfirm);
  assert.equal(resolveReplyKeyboardAction(messages.en.savedProfileRemoveCancelButton, confirmation).callbackData, callBacks.profileUnsaveCancel);
  assert.equal(resolveReplyKeyboardAction(messages.fa.savedProfileRemoveConfirmButton, confirmation), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.savedProfileRemoveConfirmButton, { ...confirmation, mode: "public_profile:saved:u_A1:1:saved:0" }), null);
});

test("discussion create and paid-capacity buttons are bound to their exact server modes", () => {
  const { discussionPaidCapacityConfirmKeyboard, discussionPaidCapacityAckKeyboard } = require("../src/keyboards");
  const preview = { mode: "discussion_create", state: "discussion_create_preview", user: { lang: "en", discussionDraftLanguage: "fa" } };
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionEditTitle, preview).callbackData, callBacks.discussionCreateEditTitle);
  assert.equal(resolveReplyKeyboardAction("🌐 Change language (Persian)", preview).callbackData, callBacks.discussionCreateToggleLanguage);
  assert.equal(resolveReplyKeyboardAction("🌐 Change language (English)", preview), null);
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionJoinRuleOpen, preview), null);
  const rule = { mode: "discussion_create", state: "discussion_create_join_rule", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionJoinRuleOpen, rule).callbackData, callBacks.discussionCreateRuleOpen);
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionCreateCancel, rule).callbackData, callBacks.discussionCreateCancel);
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionCancelEdit, rule), null);
  const ruleEdit = { mode: "discussion_create", state: "discussion_create_join_rule_edit", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionCancelEdit, ruleEdit).callbackData, callBacks.discussionCreateCancelEdit);
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionCreateCancel, ruleEdit), null);
  const tasteLabelText = getDiscussionTasteLabelOptionText(messages, "en", "movies", "cinephile");
  const tasteLabels = {
    mode: "discussion_create_taste_labels",
    state: "discussion_create_join_rule",
    user: { lang: "en", aiTaste: { movies: { labelKey: "cinephile" } } },
  };
  assert.equal(resolveReplyKeyboardAction(tasteLabelText, tasteLabels).callbackData, `${callBacks.discussionCreateSelectTaste}movies:cinephile`);
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionBack, tasteLabels).callbackData, callBacks.discussionCreateBackToJoinRule);
  assert.equal(resolveReplyKeyboardAction(tasteLabelText, rule), null);
  const capacityEdit = { mode: "discussion_create_capacity", state: "discussion_create_preview", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionCancelEdit, capacityEdit).callbackData, callBacks.discussionCreateCancelEdit);
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionCreateCancel, capacityEdit), null);
  const paidQuote = { mode: "discussion_create_paid_capacity:2:3", state: "discussion_create_preview", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction("Confirm creation — 3 Stars", paidQuote).callbackData, `${callBacks.discussionCreatePaidCapacityConfirm}2:3`);
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionPaidCapacityCancelButton, paidQuote).callbackData, callBacks.discussionCreatePaidCapacityCancel);
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionCreateConfirm, paidQuote), null);
  assert.equal(resolveReplyKeyboardAction("Confirm creation — 2 Stars", paidQuote), null);
  const paidError = { mode: "discussion_create_paid_capacity_error", state: "discussion_create_preview", user: { lang: "en" } };
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionEditCapacity, paidError).callbackData, callBacks.discussionCreateEditCapacity);
  assert.equal(resolveReplyKeyboardAction(messages.en.discussionBack, paidError).callbackData, callBacks.discussionCreatePaidCapacityAck);
  assert.equal(resolveReplyKeyboardAction("Confirm creation — 3 Stars", paidError), null);
  assert.ok(discussionPaidCapacityConfirmKeyboard("en", 2, 3).reply_markup.keyboard);
  assert.equal(discussionPaidCapacityConfirmKeyboard("en", 2, 3).reply_markup.inline_keyboard, undefined);
  const recoveryLabels = discussionPaidCapacityAckKeyboard("en").reply_markup.keyboard.flat().map((button) => button.text);
  assert.deepEqual(recoveryLabels, [messages.en.discussionEditCapacity, messages.en.discussionBack]);
  assert.match(messages.en.discussionPaidCapacityInsufficient, /Edit the capacity or return to the preview/);
});

test("discussion preview language button names the current draft language", () => {
  const { discussionCreateConfirmKeyboard } = require("../src/keyboards");
  const enButtons = discussionCreateConfirmKeyboard("en", "fa").reply_markup.keyboard.flat().map((button) => button.text);
  const faButtons = discussionCreateConfirmKeyboard("fa", "en").reply_markup.keyboard.flat().map((button) => button.text);
  assert.ok(enButtons.includes("🌐 Change language (Persian)"));
  assert.ok(faButtons.includes("🌐 تغییر زبان (انگلیسی)"));
});
