const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const {
  getOnboardingInterestChipTitle,
  helpKeyboard,
  helpRulesKeyboard,
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
  handleOnboardingCallback,
  isOnboardingCallback,
  retireOnboardingPrompt,
  shouldOfferOnboarding,
  shouldOfferTasteSetupNudge,
} = require("../src/flows/onboarding");
const User = require("../src/models/user");

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

test("post-invite taste setup nudge is separate from fresh onboarding", () => {
  const oldInviteUser = {
    createdAt: new Date("2026-06-13T09:00:00.000Z"),
    onboardingVersion: 0,
    state: "idle",
  };
  const now = new Date("2026-06-13T10:00:00.000Z");

  assert.equal(shouldOfferOnboarding(oldInviteUser, now), false);
  assert.equal(shouldOfferTasteSetupNudge(oldInviteUser), true);
  assert.equal(shouldOfferTasteSetupNudge({ ...oldInviteUser, onboardingTasteSetupNudgedAt: new Date() }), false);
  assert.equal(shouldOfferTasteSetupNudge({ ...oldInviteUser, onboardingVersion: 1 }), false);
  assert.equal(shouldOfferTasteSetupNudge({
    ...oldInviteUser,
    aiLists: { random: { topTen: [{ title: "Chess" }, { title: "Movies" }, { title: "Books" }] } },
  }), false);
});

test("welcome copy stays general while onboarding welcome carries the starter tip", () => {
  for (const lang of ["fa", "en"]) {
    assert.match(messages[lang].welcome, /^👩‍🦳/);
    assert.match(messages[lang].welcome, /🌿/);
    assert.match(messages[lang].welcome, /🏷/);
    assert.match(messages[lang].welcome, /💬/);
    assert.doesNotMatch(messages[lang].welcome, /3 interests|۳ علاقه/);
    assert.match(messages[lang].welcomeWithName, /^👩‍🦳/);
    assert.doesNotMatch(messages[lang].welcomeWithName, /3 interests|۳ علاقه/);
    assert.match(messages[lang].onboardingWelcome, /^👩‍🦳/);
    assert.match(messages[lang].onboardingWelcome, /shared interests|هم‌سلیقه/);
    assert.match(messages[lang].onboardingWelcomeWithName, /^👩‍🦳/);
    assert.match(messages[lang].onboardingWelcomeWithName, /shared interests|هم‌سلیقه/);
  }
});

test("post-invite taste setup callbacks start or dismiss without completing onboarding", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const updates = [];
  const edits = [];
  const deleted = [];

  User.findOneAndUpdate = async (filter, update) => {
    updates.push({ filter, update });
    return {};
  };

  const ctx = {
    callbackData: callBacks.onboardingTasteSetupStart,
    callbackMessageId: 42,
    userId: 7,
    user: {
      userId: 7,
      lang: "en",
      state: "idle",
      onboardingVersion: 0,
    },
    answerCb: async () => {},
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return { message_id: messageId };
    },
    deleteMessage: async (messageId) => {
      deleted.push(messageId);
      return true;
    },
  };

  try {
    await handleOnboardingCallback(ctx, "en", {
      editCallbackMessageOrReply: (_ctx, text, keyboard) => ctx.editMessageText(ctx.callbackMessageId, text, keyboard),
      deleteCallbackMessageIfPossible: (_ctx) => ctx.deleteMessage(_ctx.callbackMessageId),
    });

    assert.ok(updates.some((entry) => entry.update.state === "onboarding_taste_setup_interests"));
    assert.equal(updates.some((entry) => entry.update.onboardingVersion), false);
    assert.equal(edits[0].messageId, 42);
    assert.match(edits[0].text, /Choose 3 things you like/);

    ctx.callbackData = callBacks.onboardingTasteSetupDismiss;
    await handleOnboardingCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: (_ctx) => ctx.deleteMessage(_ctx.callbackMessageId),
    });

    assert.deepEqual(deleted, [42]);
    assert.equal(updates.some((entry) => entry.update.onboardingSkippedAt), false);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
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
      assert.match(messages[lang][key], /^👩‍🦳/, `${lang}.${key}`);
    }
  }
});

test("onboarding keyboard shows selected interests without a separate continue action", () => {
  const keyboard = onboardingInterestsKeyboard("en", ["شطرنج"]);
  const buttons = keyboard.reply_markup.inline_keyboard.flat();
  const interestButtons = buttons.filter((button) => (
    button.callback_data.startsWith(callBacks.onboardingInterest) &&
    !button.callback_data.startsWith(callBacks.onboardingInterestRemove)
  ));

  assert.equal(buttons.some((button) => button.text.includes("Chess") && button.text.includes("✓")), true);
  assert.equal(interestButtons.length, 11);
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.onboardingInterestRemove}0:0`), true);
  assert.equal(buttons.some((button) => button.text.includes("Movies")), true);
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.onboardingMore}1`), true);
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.onboardingCustom}0`), true);
  assert.equal(buttons.some((button) => button.callback_data === callBacks.onboardingSkip), false);
  assert.equal(buttons.some((button) => button.callback_data === callBacks.onboardingContinue), false);

  const readyKeyboard = onboardingInterestsKeyboard("en", ["Movies", "Books", "Chess"]);
  const readyButtons = readyKeyboard.reply_markup.inline_keyboard.flat();
  assert.equal(readyButtons.some((button) => button.callback_data === callBacks.onboardingContinue), false);
});

test("onboarding chips mark selected built-ins across languages", () => {
  const englishKeyboard = onboardingInterestsKeyboard("en", ["فیلم", "شطرنج"]);
  const persianKeyboard = onboardingInterestsKeyboard("fa", ["Movies", "Chess"]);
  const englishButtons = englishKeyboard.reply_markup.inline_keyboard.flat();
  const persianButtons = persianKeyboard.reply_markup.inline_keyboard.flat();

  assert.equal(englishButtons.some((button) => button.text.includes("Movies") && button.text.includes("✓")), true);
  assert.equal(englishButtons.some((button) => button.text.includes("Chess") && button.text.includes("✓")), true);
  assert.equal(persianButtons.some((button) => button.text.includes("فیلم") && button.text.includes("✓")), true);
  assert.equal(persianButtons.some((button) => button.text.includes("شطرنج") && button.text.includes("✓")), true);
});

test("onboarding keeps selected built-in chips in their original grid positions", () => {
  const plainRows = onboardingInterestsKeyboard("en", []).reply_markup.inline_keyboard;
  const selectedRows = onboardingInterestsKeyboard("en", ["Chess"]).reply_markup.inline_keyboard;
  const plainChess = plainRows.flat().find((button) => button.text.includes("Chess"));
  const selectedChess = selectedRows.flat().find((button) => button.text.includes("Chess"));

  assert.equal(plainRows[1][0], plainChess);
  assert.equal(selectedRows[1][0], selectedChess);
  assert.equal(selectedRows[1][0].text, `${plainRows[1][0].text} ✓`);
  assert.equal(selectedRows[1][0].callback_data, `${callBacks.onboardingInterestRemove}0:0`);
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
  assert.equal(getOnboardingInterestChipTitle(9, "en"), "Art");
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

test("onboarding completion leads with active discussions", () => {
  const buttons = onboardingCompleteKeyboard("en").reply_markup.inline_keyboard.flat();
  const callbackData = buttons.map((button) => button.callback_data);

  assert.deepEqual(callbackData, [
    callBacks.discussionListActive,
    callBacks.aiAssistant,
    callBacks.menuMain,
  ]);
  assert.equal(buttons[0].text, messages.en.discussionActiveList);
  assert.equal(buttons[1].text, messages.en.onboardingFavoritesButton);
});

test("onboarding completion shows invitation copy and action only when one exists", () => {
  const plainText = buildOnboardingCompleteText("en");
  const invitedText = buildOnboardingCompleteText("en", { hasInvitation: true });
  const plainButtons = onboardingCompleteKeyboard("en").reply_markup.inline_keyboard.flat();
  const invitedButtons = onboardingCompleteKeyboard("en", { hasInvitation: true }).reply_markup.inline_keyboard.flat();

  assert.doesNotMatch(plainText, /prepared an invitation/);
  assert.match(invitedText, /prepared an invitation/);
  assert.equal(plainButtons.some((button) => button.callback_data === callBacks.discussionInvitations), false);
  assert.equal(invitedButtons[0].callback_data, callBacks.discussionInvitations);
});

test("help is available from the main menu and onboarding completion", () => {
  const mainCallbacks = mainMenuKeyboard("fa").reply_markup.inline_keyboard
    .flat()
    .map((button) => button.callback_data);
  const helpCallbacks = helpKeyboard("fa").reply_markup.inline_keyboard
    .flat()
    .map((button) => button.callback_data);
  const rulesCallbacks = helpRulesKeyboard("fa").reply_markup.inline_keyboard
    .flat()
    .map((button) => button.callback_data);

  assert.ok(mainCallbacks.includes(callBacks.help));
  assert.deepEqual(helpCallbacks, [
    callBacks.profileStars,
    callBacks.helpRules,
    callBacks.aiAssistant,
    callBacks.discussionListActive,
    callBacks.menuMain,
  ]);
  assert.deepEqual(rulesCallbacks, [
    callBacks.help,
    callBacks.menuMain,
  ]);
  assert.match(messages.fa.helpRules, /^📜/);
  assert.match(messages.en.helpRules, /^📜/);
  assert.match(messages.fa.helpRulesText, /💡/);
  assert.match(messages.en.helpRulesText, /💡/);
  assert.match(messages.fa.helpRulesText, /۳۰ پیام در ۱۰ دقیقه/);
  assert.match(messages.en.helpRulesText, /30 messages per 10 minutes/);
  assert.match(messages.fa.helpRulesText, /ذخیره‌کردن پروفایل‌ها خصوصی است/);
  assert.match(messages.en.helpRulesText, /Saved profiles are private/);
  assert.match(messages.fa.helpRulesText, /گزارش‌ها فقط از کاربران متفاوت/);
  assert.match(messages.en.helpRulesText, /Reports count only from different users/);
  assert.match(messages.fa.helpRulesText, /۳ دعوت در هر ۲۴ ساعت/);
  assert.match(messages.en.helpRulesText, /3 per 24 hours/);
  assert.match(messages.fa.helpGoToLists, /^🎬🎵📚/);
  assert.match(messages.en.helpGoToLists, /^🎬🎵📚/);
  assert.match(messages.fa.helpText, /^👩‍🦳/);
  assert.match(messages.en.helpText, /^👩‍🦳/);
  assert.match(messages.fa.helpText, /🎬🎵📚 فیلم، موسیقی، کتاب/);
  assert.match(messages.en.helpText, /🎬🎵📚 Movies, Music, Books/);
  assert.match(messages.fa.helpText, /برای بعد/);
  assert.match(messages.en.helpText, /Save for later/);
  assert.match(messages.fa.helpText, /۳ انتخاب/);
  assert.match(messages.en.helpText, /3 favorites/);
  assert.match(messages.fa.helpText, /👥 آدم‌ها/);
  assert.match(messages.fa.helpText, /آدم‌هایی با انتخاب‌های مشترک/);
  assert.match(messages.en.helpText, /👥 People/);
  assert.match(messages.en.helpText, /people with shared choices/);
  assert.ok(messages.fa.helpText.length < 900);
  assert.ok(messages.en.helpText.length < 900);
});

test("main menu uses the warmer Me label without renaming profile copy", () => {
  const faButtons = mainMenuKeyboard("fa").reply_markup.inline_keyboard.flat();
  const enButtons = mainMenuKeyboard("en").reply_markup.inline_keyboard.flat();

  assert.equal(faButtons.find((button) => button.callback_data === callBacks.profile)?.text, "👤 من");
  assert.equal(enButtons.find((button) => button.callback_data === callBacks.profile)?.text, "👤 Me");
  assert.equal(messages.fa.profile, "👤 پروفایل");
  assert.equal(messages.en.profile, "👤 Profile");
});

test("onboarding copy reports compact progress without inferring a vibe", () => {
  const progress = buildOnboardingPrompt("en", 2, "Coffee");
  const initial = buildOnboardingPrompt("en");
  assert.match(progress, /2 of 3 selected/);
  assert.match(progress, /^👩‍🦳/);
  assert.doesNotMatch(progress, /first taste profile/);
  assert.ok(progress.length <= initial.length * 1.1);
  assert.doesNotMatch(progress, /learn.*about you/i);

  const complete = buildOnboardingCompleteText("fa", [
    { title: "گیم" },
    { title: "یوتیوب" },
    { title: "پادکست" },
  ]);

  assert.match(complete, /^👩‍🦳/);
  assert.match(complete, /گفت‌وگوهای فعال/);
  assert.match(complete, /پیشنهادهای شخصی‌تری/);
  assert.match(complete, /گفت‌وگوهای مرتبط/);
  assert.doesNotMatch(complete, /گیم/);
  assert.doesNotMatch(complete, /گیمر/);
  assert.doesNotMatch(complete, /تاپ ۱۰/);
  assert.doesNotMatch(complete, /بیشتر بشناسمت/);
  assert.doesNotMatch(complete, /\{(?:items|emoji|label|style)\}/);
});

test("onboarding callback predicate owns only onboarding actions", () => {
  assert.equal(isOnboardingCallback(callBacks.onboardingStart), true);
  assert.equal(isOnboardingCallback(`${callBacks.onboardingInterest}2`), true);
  assert.equal(isOnboardingCallback(`${callBacks.onboardingInterestRemove}2`), true);
  assert.equal(isOnboardingCallback(`${callBacks.onboardingMore}1`), true);
  assert.equal(isOnboardingCallback(`${callBacks.onboardingCustom}1`), true);
  assert.equal(isOnboardingCallback(`${callBacks.onboardingCustomCancel}1`), true);
  assert.equal(isOnboardingCallback(callBacks.onboardingContinue), true);
  assert.equal(isOnboardingCallback(callBacks.onboardingTasteSetupStart), true);
  assert.equal(isOnboardingCallback(callBacks.onboardingTasteSetupDismiss), true);
  assert.equal(isOnboardingCallback(callBacks.onboardingSkip), false);
  assert.equal(isOnboardingCallback(callBacks.discussions), false);
});
