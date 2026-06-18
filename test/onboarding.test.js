const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const {
  getOnboardingInterestChipTitle,
  helpKeyboard,
  mainMenuKeyboard,
  onboardingCompleteKeyboard,
  onboardingCustomInterestKeyboard,
  onboardingInterestsKeyboard,
  onboardingLanguageKeyboard,
  onboardingWelcomeKeyboard,
} = require("../src/keyboards");
const {
  NEW_USER_WINDOW_MS,
  buildOnboardingCompleteText,
  buildOnboardingPrompt,
  getOnboardingPage,
  isOnboardingCallback,
  retireOnboardingPrompt,
  shouldOfferOnboarding,
} = require("../src/flows/onboarding");

test("onboarding is offered only to recent empty accounts", () => {
  const now = new Date("2026-06-13T10:00:00.000Z");
  const newUser = {
    createdAt: new Date(now.getTime() - 1000),
    onboardingVersion: 0,
  };

  assert.equal(shouldOfferOnboarding(newUser, now), true);
  assert.equal(shouldOfferOnboarding({ ...newUser, onboardingVersion: 1 }, now), false);
  assert.equal(shouldOfferOnboarding({
    ...newUser,
    aiLists: { movies: { topTen: [{ title: "Dune" }] } },
  }, now), false);
  assert.equal(shouldOfferOnboarding({
    ...newUser,
    createdAt: new Date(now.getTime() - NEW_USER_WINDOW_MS - 1),
  }, now), false);
});

test("welcome copy uses bot and tip markers in both languages", () => {
  for (const lang of ["fa", "en"]) {
    assert.match(messages[lang].welcome, /^🤖/);
    assert.match(messages[lang].welcome, /💡/);
    assert.match(messages[lang].welcome, /🧩/);
    assert.match(messages[lang].welcome, /✨/);
    assert.match(messages[lang].welcome, /💬/);
    assert.match(messages[lang].welcome, /📌/);
    assert.match(messages[lang].welcomeWithName, /^🤖/);
    assert.match(messages[lang].welcomeWithName, /💡/);
  }
});

test("bot-authored picker prompts start with the bot marker", () => {
  const promptKeys = [
    "chooseLanguage",
    "discussionCreateAskTitle",
    "discussionCreateAskDescription",
    "discussionJoinRulePrompt",
    "discussionSelectOptionPrompt",
    "discussionChooseSection",
    "discussionChooseCapacity",
    "discussionChooseTasteLabel",
    "discussionChooseTopTenItem",
    "aiListManageAddPrompt",
    "aiInterestTopTenAddPrompt",
    "aiListManageRemovePrompt",
    "aiWatchlistTogglePrompt",
    "aiWatchlistCommentPrompt",
    "aiTopTenCommentPrompt",
    "aiWatchlistPromotePrompt",
    "aiSuggestionModePrompt",
    "aiSuggestionContextPrompt",
  ];

  for (const lang of ["fa", "en"]) {
    for (const key of promptKeys) {
      assert.match(messages[lang][key], /^🤖/, `${lang}.${key}`);
    }
  }
});

test("onboarding keyboard shows one page, removes selected interests, and keeps escape routes", () => {
  const keyboard = onboardingInterestsKeyboard("en", ["Chess"]);
  const buttons = keyboard.reply_markup.inline_keyboard.flat();
  const interestButtons = buttons.filter((button) => button.callback_data.startsWith(callBacks.onboardingInterest));

  assert.equal(buttons.some((button) => button.text.includes("Chess")), false);
  assert.equal(interestButtons.length, 9);
  assert.equal(buttons.some((button) => button.text.includes("Travel")), true);
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.onboardingMore}1`), true);
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.onboardingCustom}0`), true);
  assert.equal(buttons.some((button) => button.callback_data === callBacks.onboardingSkip), true);
});

test("onboarding welcome waits for one clear start action", () => {
  const keyboard = onboardingWelcomeKeyboard("fa");
  const buttons = keyboard.reply_markup.inline_keyboard.flat();

  assert.deepEqual(buttons, [{
    text: messages.fa.onboardingStartButton,
    callback_data: callBacks.onboardingStart,
  }]);
});

test("first-time language picker has no route around language selection", () => {
  const buttons = onboardingLanguageKeyboard().reply_markup.inline_keyboard.flat();

  assert.deepEqual(buttons.map((button) => button.callback_data), [
    callBacks.langSetFa,
    callBacks.langSetEn,
  ]);
  assert.equal(buttons.some((button) => button.callback_data === callBacks.menuMain), false);
});

test("onboarding rotates through stable interest pages", () => {
  const firstPage = onboardingInterestsKeyboard("en", [], 0).reply_markup.inline_keyboard.flat();
  const secondPage = onboardingInterestsKeyboard("en", [], 1).reply_markup.inline_keyboard.flat();

  assert.equal(firstPage.some((button) => button.text.includes("Travel")), false);
  assert.equal(secondPage.some((button) => button.text.includes("Travel")), true);
  assert.equal(getOnboardingInterestChipTitle(9, "en"), "Travel");
  assert.equal(getOnboardingPage(`${callBacks.onboardingMore}2`), 2);
});

test("custom-interest input has a page-aware return action", () => {
  const keyboard = onboardingCustomInterestKeyboard("fa", 2);
  const [button] = keyboard.reply_markup.inline_keyboard.flat();

  assert.equal(button.callback_data, `${callBacks.onboardingCustomCancel}2`);
});

test("typed onboarding input retires the old picker before a fresh reply", async () => {
  const deleted = [];
  const ctx = {
    user: { onboardingPromptMessageId: 42 },
    deleteMessage: async (messageId) => {
      deleted.push(messageId);
      return true;
    },
  };

  await retireOnboardingPrompt(ctx, { persist: false });

  assert.deepEqual(deleted, [42]);
  assert.equal(ctx.user.onboardingPromptMessageId, null);
});

test("onboarding completion offers clear next actions", () => {
  const keyboard = onboardingCompleteKeyboard("en");
  const callbackData = keyboard.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);

  assert.deepEqual(callbackData, [
    callBacks.discussionListActive,
    callBacks.menuMain,
    callBacks.help,
  ]);
});

test("help is available from the main menu and onboarding completion", () => {
  const mainCallbacks = mainMenuKeyboard("fa").reply_markup.inline_keyboard
    .flat()
    .map((button) => button.callback_data);
  const helpCallbacks = helpKeyboard("fa").reply_markup.inline_keyboard
    .flat()
    .map((button) => button.callback_data);

  assert.ok(mainCallbacks.includes(callBacks.help));
  assert.deepEqual(helpCallbacks, [
    callBacks.aiAssistant,
    callBacks.discussionListActive,
    callBacks.menuMain,
  ]);
  assert.match(messages.fa.helpGoToLists, /^🎬🎵📚/);
  assert.match(messages.en.helpGoToLists, /^🎬🎵📚/);
  assert.match(messages.fa.helpText, /^🤖/);
  assert.match(messages.en.helpText, /^🤖/);
  assert.match(messages.fa.helpText, /🎬🎵📚 لیست‌ها/);
  assert.match(messages.en.helpText, /🎬🎵📚 Lists/);
  assert.match(messages.fa.helpText, /فهرست کارها/);
  assert.match(messages.en.helpText, /to-do list/);
  assert.match(messages.fa.helpText, /۳ مورد/);
  assert.match(messages.en.helpText, /3 Top 10 items/);
  assert.match(messages.fa.helpText, /بحث‌های ساخته‌شده‌شون رو ببینی/);
  assert.match(messages.en.helpText, /view discussions they created/);
  assert.ok(messages.fa.helpText.length < 900);
  assert.ok(messages.en.helpText.length < 900);
});

test("onboarding copy reports progress and a Persian starter vibe", () => {
  const progress = buildOnboardingPrompt("en", 2, "Coffee");
  const initial = buildOnboardingPrompt("en");
  assert.match(progress, /2\/3/);
  assert.match(progress, /^🤖/);
  assert.match(progress, /💡/);
  assert.ok(progress.length >= initial.length * 0.8);
  assert.doesNotMatch(progress, /learn.*about you/i);

  const complete = buildOnboardingCompleteText("fa", [
    { title: "گیم" },
    { title: "یوتیوب" },
    { title: "پادکست" },
  ]);

  assert.match(complete, /گیم/);
  assert.match(complete, /گیمر/);
  assert.match(complete, /^🤖/);
  assert.match(complete, /💡/);
  assert.doesNotMatch(complete, /بیشتر بشناسمت/);
  assert.doesNotMatch(complete, /\{(?:items|emoji|label|style)\}/);
});

test("onboarding callback predicate owns only onboarding actions", () => {
  assert.equal(isOnboardingCallback(callBacks.onboardingStart), true);
  assert.equal(isOnboardingCallback(`${callBacks.onboardingInterest}2`), true);
  assert.equal(isOnboardingCallback(`${callBacks.onboardingMore}1`), true);
  assert.equal(isOnboardingCallback(`${callBacks.onboardingCustom}1`), true);
  assert.equal(isOnboardingCallback(`${callBacks.onboardingCustomCancel}1`), true);
  assert.equal(isOnboardingCallback(callBacks.onboardingSkip), true);
  assert.equal(isOnboardingCallback(callBacks.discussions), false);
  assert.equal(messages.en.onboardingSkipButton.length > 0, true);
});
