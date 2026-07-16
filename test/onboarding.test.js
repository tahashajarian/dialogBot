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
  handleOnboardingText,
  isOnboardingCallback,
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
    assert.match(messages[lang].onboardingWelcome, /buttons below|دکمه‌های پایین/);
    assert.match(messages[lang].onboardingWelcomeWithName, /^👩‍🦳/);
    assert.match(messages[lang].onboardingWelcomeWithName, /shared interests|هم‌سلیقه/);
    assert.match(messages[lang].onboardingWelcomeWithName, /buttons below|دکمه‌های پایین/);
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
    reply: async (text, extra) => ({ message_id: 43, text, extra }),
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
    ctx.isReplyKeyboardAction = true;
    await handleOnboardingCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: (_ctx) => ctx.deleteMessage(_ctx.callbackMessageId),
    });

    assert.deepEqual(deleted, []);
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
  const buttons = keyboard.reply_markup.keyboard.flat();

  assert.equal(buttons.some((button) => button.text.includes("Chess") && button.text.includes("✓")), true);
  assert.equal(buttons.some((button) => button.text.includes("Movies")), true);
  assert.equal(buttons.some((button) => button.text === messages.en.onboardingMoreButton), true);
  assert.equal(buttons.some((button) => button.text === messages.en.onboardingCustomButton), false);

  const readyKeyboard = onboardingInterestsKeyboard("en", ["Movies", "Books", "Chess"]);
  const readyButtons = readyKeyboard.reply_markup.keyboard.flat();
  assert.equal(readyButtons.some((button) => button.text === messages.en.onboardingStartButton), false);
});

test("onboarding chips mark selected built-ins across languages", () => {
  const englishKeyboard = onboardingInterestsKeyboard("en", ["فیلم", "شطرنج"]);
  const persianKeyboard = onboardingInterestsKeyboard("fa", ["Movies", "Chess"]);
  const englishButtons = englishKeyboard.reply_markup.keyboard.flat();
  const persianButtons = persianKeyboard.reply_markup.keyboard.flat();

  assert.equal(englishButtons.some((button) => button.text.includes("Movies") && button.text.includes("✓")), true);
  assert.equal(englishButtons.some((button) => button.text.includes("Chess") && button.text.includes("✓")), true);
  assert.equal(persianButtons.some((button) => button.text.includes("فیلم") && button.text.includes("✓")), true);
  assert.equal(persianButtons.some((button) => button.text.includes("شطرنج") && button.text.includes("✓")), true);
});

test("onboarding keeps selected built-in chips in their original grid positions", () => {
  const plainRows = onboardingInterestsKeyboard("en", []).reply_markup.keyboard;
  const selectedRows = onboardingInterestsKeyboard("en", ["Chess"]).reply_markup.keyboard;
  const plainChess = plainRows.flat().find((button) => button.text.includes("Chess"));
  const selectedChess = selectedRows.flat().find((button) => button.text.includes("Chess"));

  assert.equal(plainRows[1][0], plainChess);
  assert.equal(selectedRows[1][0], selectedChess);
  assert.equal(selectedRows[1][0].text, `${plainRows[1][0].text} ✓`);
  assert.equal(selectedRows[1][0].callback_data, undefined);
});

test("onboarding welcome waits for one clear start action", () => {
  const keyboard = onboardingWelcomeKeyboard("fa");
  const buttons = keyboard.reply_markup.keyboard.flat();

  assert.deepEqual(buttons, [{ text: messages.fa.onboardingStartButton }]);
});

test("first-time language picker has no route around language selection", () => {
  const buttons = onboardingLanguageKeyboard().reply_markup.keyboard.flat();

  assert.deepEqual(buttons.map((button) => button.text), ["🇮🇷 فارسی", "🇬🇧 English"]);
});

test("onboarding rotates through stable interest pages", () => {
  const firstPage = onboardingInterestsKeyboard("en", [], 0).reply_markup.keyboard.flat();
  const secondPage = onboardingInterestsKeyboard("en", [], 1).reply_markup.keyboard.flat();

  assert.equal(firstPage.some((button) => button.text.includes("Travel")), false);
  assert.equal(secondPage.some((button) => button.text.includes("Travel")), true);
  assert.equal(getOnboardingInterestChipTitle(9, "en"), "Art");
  assert.equal(getOnboardingPage(`${callBacks.onboardingMore}2`), 2);
});

test("onboarding completion leads with active discussions", () => {
  const buttons = onboardingCompleteKeyboard("en").reply_markup.keyboard.flat();
  assert.equal(buttons[0].text, messages.en.discussionActiveList);
  assert.equal(buttons[1].text, messages.en.onboardingFavoritesButton);
});

test("onboarding accepts a typed Persian interest directly from the current picker page", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const user = {
    userId: 7,
    lang: "fa",
    state: "onboarding_interests",
    navigationMode: "onboarding_interests:0",
    aiLists: { random: { topTen: [{ title: "Movies", comment: "", watched: false }] } },
  };
  User.findOne = async () => user;
  User.findOneAndUpdate = async () => user;

  try {
    await handleOnboardingText({
      userId: 7,
      user,
      text: "کتاب",
      reply: async (text, extra) => {
        replies.push({ text, extra });
        return { message_id: 1 };
      },
    }, "fa");
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /2 از 3 انتخاب شده/);
  const labels = replies[0].extra.reply_markup.keyboard.flat().map((button) => button.text);
  assert.ok(labels.some((label) => label.includes("کتاب") && label.includes("✓")));
  assert.equal(labels.includes(messages.fa.onboardingCustomButton), false);
  assert.equal(user.navigationMode, "onboarding_interests:0");
});

test("onboarding completion shows invitation copy and action only when one exists", () => {
  const plainText = buildOnboardingCompleteText("en");
  const invitedText = buildOnboardingCompleteText("en", { hasInvitation: true });
  const plainButtons = onboardingCompleteKeyboard("en").reply_markup.keyboard.flat();
  const invitedButtons = onboardingCompleteKeyboard("en", { hasInvitation: true }).reply_markup.keyboard.flat();

  assert.doesNotMatch(plainText, /prepared an invitation/);
  assert.match(invitedText, /prepared an invitation/);
  assert.equal(plainButtons.some((button) => button.text === messages.en.onboardingInvitationButton), false);
  assert.equal(invitedButtons[0].text, messages.en.onboardingInvitationButton);
});

test("help is available from the main menu and onboarding completion", () => {
  const mainLabels = mainMenuKeyboard("fa").reply_markup.keyboard
    .flat()
    .map((button) => button.text);
  const helpLabels = helpKeyboard("fa").reply_markup.keyboard
    .flat()
    .map((button) => button.text);
  const rulesLabels = helpRulesKeyboard("fa").reply_markup.keyboard
    .flat()
    .map((button) => button.text);

  assert.ok(mainLabels.includes(messages.fa.help));
  assert.deepEqual(helpLabels, [
    messages.fa.profileStarsButton,
    messages.fa.helpReferralButton,
    messages.fa.helpRules,
    messages.fa.helpBackToMain,
  ]);
  assert.deepEqual(rulesLabels, [
    messages.fa.helpBackToGuide,
    messages.fa.helpBackToMain,
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
  assert.match(messages.fa.helpGoToLists, /^محبوب‌های من/);
  assert.match(messages.en.helpGoToLists, /^My favorites/);
  assert.match(messages.fa.helpText, /^👩‍🦳/);
  assert.match(messages.en.helpText, /^👩‍🦳/);
  assert.match(messages.fa.helpText, /🎬🎵📚 فیلم، موسیقی و کتاب/);
  assert.match(messages.en.helpText, /🎬🎵📚 Movies, Music & Books/);
  assert.match(messages.fa.helpText, /بعداً می‌بینم/);
  assert.match(messages.en.helpText, /Watch Later/);
  assert.match(messages.fa.helpText, /۳ انتخاب/);
  assert.match(messages.en.helpText, /3 favorites/);
  assert.match(messages.fa.helpText, /👥 آدم‌ها/);
  assert.match(messages.fa.helpText, /محبوب‌های مشترک/);
  assert.match(messages.fa.helpText, /به گفت‌وگوهات دعوتشون کن/);
  assert.match(messages.en.helpText, /👥 People/);
  assert.match(messages.en.helpText, /people with shared favorites/);
  assert.match(messages.en.helpText, /invite them later/i);
  assert.match(messages.fa.helpText, /تنظیمات ← حذف حساب/);
  assert.match(messages.en.helpText, /Settings → Delete account/);
  assert.ok(messages.fa.helpText.length < 950);
  assert.ok(messages.en.helpText.length < 950);
});

test("main menu uses the warmer Me label without renaming profile copy", () => {
  const faButtons = mainMenuKeyboard("fa").reply_markup.keyboard.flat();
  const enButtons = mainMenuKeyboard("en").reply_markup.keyboard.flat();

  assert.ok(faButtons.some((button) => button.text === "👤 من"));
  assert.ok(enButtons.some((button) => button.text === "👤 Me"));
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
