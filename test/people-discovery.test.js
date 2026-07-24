const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/user");
const messages = require("../src/messages");
const { operationalLimits } = require("../src/services/operational-limits");
const { callBacks } = require("../src/constants");
const {
  peopleHubKeyboard,
  peopleDiscoverListKeyboard,
  peopleDiscoverEmptyKeyboard,
  peopleDiscoverLanguageKeyboard,
} = require("../src/keyboards");
const {
  ensurePeopleDiscoveryCodes,
  findPeopleBySharedTaste,
  getEffectivePeopleLanguageFilter,
  getSharedSections,
  paginatePeopleDiscovery,
  sortPeopleDiscoveryItems,
} = require("../src/services/people-discovery");
const {
  buildPeopleHubText,
  buildPeopleDiscoveryText,
  formatPeopleDiscoveryRequirementText,
} = require("../src/services/people-discovery-ui");
const { areTasteItemsEquivalent } = require("../src/services/taste-item-matching");
const { handleSavedProfilesCallback, sendPeopleHub } = require("../src/flows/saved-profiles");

function userWithMusic(userId, items, extra = {}) {
  return {
    userId,
    publicProfileCode: `u_${userId}`,
    firstName: `User ${userId}`,
    profileName: `User ${userId}`,
    aiLists: {
      music: {
        topTen: items.map((title) => ({ title })),
        watchlist: [],
      },
    },
    ...extra,
  };
}

test("people discovery requires the default 2 items in one viewer section", async () => {
  const originalFind = User.find;
  let called = false;
  User.find = () => {
    called = true;
    return {
      select: () => ({ limit: () => ({ lean: async () => [] }) }),
    };
  };

  try {
    const result = await findPeopleBySharedTaste(userWithMusic(1, ["one"]));

    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_enough_data");
    assert.equal(called, false);
  } finally {
    User.find = originalFind;
  }
});

test("people discovery returns users with at least 2 shared items and skips self, banned query, and weak matches", async () => {
  const originalFind = User.find;
  let query;
  User.find = (value) => {
    query = value;
    return {
      select: () => ({
        limit: () => ({
          lean: async () => [
            userWithMusic(2, ["metallica", "nirvana", "queen", "radiohead"]),
            userWithMusic(3, ["metallica"]),
            userWithMusic(4, ["metallica", "nirvana", "queen"], { publicProfileCode: "u_SAVED" }),
          ],
        }),
      }),
    };
  };

  try {
    const result = await findPeopleBySharedTaste({
      ...userWithMusic(1, ["metallica", "nirvana", "queen", "pink floyd"]),
      savedProfileCodes: ["u_SAVED"],
    });

    assert.equal(result.ok, true);
    assert.equal(query.userId.$ne, 1);
    assert.equal(query.bannedAt, null);
    assert.deepEqual(query.showProfileInPeopleDiscovery, { $ne: false });
    assert.equal(query.lang, "fa");
    assert.deepEqual(result.items.map((item) => item.userId), [2, 4]);
    assert.equal(result.items[0].sharedSections[0].count, 3);
    assert.equal(result.items[1].isSaved, true);
  } finally {
    User.find = originalFind;
  }
});

test("people language filter follows interface language until explicitly changed", () => {
  assert.equal(getEffectivePeopleLanguageFilter({ lang: "en", peopleLanguageFilter: "" }), "en");
  assert.equal(getEffectivePeopleLanguageFilter({ lang: "en", peopleLanguageFilter: "fa" }), "fa");
  assert.equal(getEffectivePeopleLanguageFilter({ lang: "fa", peopleLanguageFilter: "all" }), "all");
});

test("people discovery applies an explicit language filter and All removes it", async () => {
  const originalFind = User.find;
  const queries = [];
  User.find = (query) => {
    queries.push(query);
    return {
      select: () => ({
        limit: () => ({
          lean: async () => [],
        }),
      }),
    };
  };

  try {
    const viewer = userWithMusic(1, ["metallica", "nirvana"]);
    await findPeopleBySharedTaste(viewer, { languageFilter: "en" });
    await findPeopleBySharedTaste(viewer, { languageFilter: "all" });

    assert.equal(queries[0].lang, "en");
    assert.equal(Object.hasOwn(queries[1], "lang"), false);
  } finally {
    User.find = originalFind;
  }
});

test("people discovery also returns an exact same-section taste-label match", async () => {
  const originalFind = User.find;
  User.find = () => ({
    select: () => ({
      limit: () => ({
        lean: async () => [
          userWithMusic(2, ["jazz one"], {
            aiTaste: { music: { labelKey: "rocker" } },
          }),
          userWithMusic(3, ["classical one"], {
            aiTaste: { music: { labelKey: "classical_listener" } },
          }),
        ],
      }),
    }),
  });

  try {
    const result = await findPeopleBySharedTaste(userWithMusic(1, ["metal one"], {
      aiTaste: { music: { labelKey: "rocker" } },
    }));

    assert.equal(result.ok, true);
    assert.deepEqual(result.items.map((item) => item.userId), [2]);
    assert.deepEqual(result.items[0].sharedSections, []);
    assert.deepEqual(result.items[0].sharedTasteLabels, [{ section: "music", labelKey: "rocker" }]);
  } finally {
    User.find = originalFind;
  }
});

test("people discovery honors a changed admin minimum", async () => {
  const originalMinimum = operationalLimits.peopleDiscoveryMinSharedItems;
  const originalFind = User.find;
  let called = false;
  operationalLimits.peopleDiscoveryMinSharedItems = 3;
  User.find = () => {
    called = true;
    return {
      select: () => ({ limit: () => ({ lean: async () => [] }) }),
    };
  };

  try {
    const result = await findPeopleBySharedTaste(userWithMusic(1, ["one", "two"]));

    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_enough_data");
    assert.equal(called, false);
  } finally {
    operationalLimits.peopleDiscoveryMinSharedItems = originalMinimum;
    User.find = originalFind;
  }
});

test("people discovery creates public codes only while preparing visible matches", async () => {
  const originalFind = User.find;
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  User.find = () => ({
    select: () => ({
      limit: () => ({
        lean: async () => [userWithMusic(2, ["metallica", "nirvana", "queen"], { publicProfileCode: "" })],
      }),
    }),
  });
  User.findOne = async () => userWithMusic(2, ["metallica", "nirvana", "queen"], { publicProfileCode: "" });
  User.findOneAndUpdate = async () => userWithMusic(2, ["metallica", "nirvana", "queen"], { publicProfileCode: "u_NEW1" });

  try {
    const result = await findPeopleBySharedTaste(userWithMusic(1, ["metallica", "nirvana", "queen"]));
    const prepared = await ensurePeopleDiscoveryCodes(result.items);

    assert.equal(result.ok, true);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].code, "");
    assert.match(prepared[0].code, /^u_[A-Z0-9]{4}$/);
  } finally {
    User.find = originalFind;
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("people discovery UI renders shared sections and save/view commands", () => {
  const text = buildPeopleDiscoveryText(messages, "fa", [{
    code: "u_AB12",
    name: "طاها",
    isSaved: false,
    sharedSections: [{ section: "music", count: 4 }],
  }], { showSharedSections: true });

  assert.match(text, /دیدن آدم‌ها/);
  assert.match(text, /۴ مورد مشترک/);
  assert.match(text, /\/u_AB12/);
  assert.match(text, /\/save_AB12/);
});

test("people discovery UI shows the localized shared taste label", () => {
  const text = buildPeopleDiscoveryText(messages, "fa", [{
    code: "u_AB12",
    name: "طاها",
    isSaved: false,
    sharedTasteLabels: [{ section: "movies", labelKey: "sci_fi_fan" }],
  }], { showSharedSections: true });

  assert.match(text, /فیلم‌ها: 🚀 علمی‌تخیلی‌باز/);
  assert.doesNotMatch(text, /sci_fi_fan/);
});

test("people discovery UI can hide shared sections for legacy plain rendering", () => {
  const text = buildPeopleDiscoveryText(messages, "fa", [{
    code: "u_AB12",
    name: "طاها",
    isSaved: false,
    sharedSections: [{ section: "music", count: 4 }],
  }]);

  assert.match(text, /دیدن آدم‌ها/);
  assert.doesNotMatch(text, /۴ مورد مشترک/);
  assert.match(text, /\/u_AB12/);
});

test("people discovery uses gender emoji with a neutral fallback", () => {
  const gendered = buildPeopleDiscoveryText(messages, "en", [{
    code: "u_A1",
    name: "Sara",
    genderEmoji: "👩",
  }]);
  const neutral = buildPeopleDiscoveryText(messages, "en", [{
    code: "u_A2",
    name: "Sam",
  }]);

  assert.match(gendered, /👩 Sara/);
  assert.doesNotMatch(gendered, /👤 Sara/);
  assert.match(neutral, /👤 Sam/);
});

test("people discovery shows localized age only when set", () => {
  const withAge = buildPeopleDiscoveryText(messages, "fa", [{
    code: "u_A1",
    name: "لاله",
    age: 28,
  }]);
  const withoutAge = buildPeopleDiscoveryText(messages, "en", [{
    code: "u_A2",
    name: "Sam",
  }]);

  assert.match(withAge, /🎂 ۲۸/);
  assert.doesNotMatch(withoutAge, /🎂/);
});

test("people discovery shows profile language flags only when requested for All results", () => {
  const items = [{
    code: "u_A1",
    name: "Sara",
    language: "en",
  }, {
    code: "u_A2",
    name: "علی",
    language: "fa",
  }];
  const mixed = buildPeopleDiscoveryText(messages, "fa", items, { showLanguage: true });
  const filtered = buildPeopleDiscoveryText(messages, "fa", items, { showLanguage: false });

  assert.match(mixed, /🇬🇧/);
  assert.match(mixed, /🇮🇷/);
  assert.doesNotMatch(filtered, /🇬🇧|🇮🇷/);
});

test("people discovery intro invites viewing and saving without privacy wording", () => {
  assert.match(messages.fa.peopleDiscoverIntro, /پروفایلشون رو ببینی/);
  assert.match(messages.en.peopleDiscoverIntro, /view their profile/);
  assert.doesNotMatch(messages.fa.peopleDiscoverIntro, /خصوصی/);
  assert.doesNotMatch(messages.en.peopleDiscoverIntro, /private/);
});

test("people discovery title shows the full result count", () => {
  const text = buildPeopleDiscoveryText(messages, "en", [{
    code: "u_AB12",
    name: "Taha",
    isSaved: false,
  }], { totalCount: 7 });

  assert.match(text, /See people \(7\)/);
});

test("People hub keeps one people discovery entry", () => {
  const hidden = peopleHubKeyboard("fa").reply_markup.keyboard.flat();
  const visible = peopleHubKeyboard("fa").reply_markup.keyboard.flat();

  assert.ok(!hidden.some((button) => button.text === messages.fa.peopleTasteMatches));
  assert.ok(!visible.some((button) => button.text === messages.fa.peopleTasteMatches));
  assert.equal(visible[0].text, messages.fa.peopleDiscover);
});

test("People first-visit guidance stays inside the bilingual hub only when requested", () => {
  for (const lang of ["fa", "en"]) {
    assert.equal(buildPeopleHubText(messages, lang), messages[lang].peopleMenu);
    assert.equal(
      buildPeopleHubText(messages, lang, { showFirstVisitTip: true }),
      `${messages[lang].peopleMenu}\n\n${messages[lang].peopleFirstVisitTip}`,
    );
    assert.match(messages[lang].peopleFirstVisitTip, /^💡/);
  }
});

test("failed People hub delivery does not mark its first-visit tip", async () => {
  const ctx = {
    userId: 5,
    user: { userId: 5 },
    reply: async () => ({ message_id: 1 }),
  };

  await assert.rejects(
    sendPeopleHub(ctx, "en", {
      send: async () => {
        throw new Error("delivery failed");
      },
    }),
    /delivery failed/,
  );
  assert.equal(ctx.user.sectionTipsShownAt, undefined);
});

test("people pagination uses canonical discover callbacks", () => {
  const replyMarkup = peopleDiscoverListKeyboard("en", {
    mode: "taste",
    page: 0,
    totalPages: 2,
    languageFilter: "en",
  }).reply_markup;
  const buttons = replyMarkup.inline_keyboard.flat();

  assert.ok(buttons.some((button) => button.text === `${messages.en.discussionListMorePage} ➡️`));
  assert.ok(buttons.some((button) => button.callback_data === `${callBacks.peopleDiscoverPage}1`));
  assert.ok(buttons.some((button) => button.callback_data === `${callBacks.peopleDiscoverLanguageOpen}en`));
  assert.equal(replyMarkup.keyboard, undefined);
});

test("people language picker marks the current choice and returns to results", () => {
  const buttons = peopleDiscoverLanguageKeyboard("en", "all").reply_markup.inline_keyboard.flat();

  assert.match(messages.fa.peopleDiscoverLanguagePicker, /زبانیه که هر نفر برای میوز انتخاب کرده/);
  assert.match(messages.en.peopleDiscoverLanguagePicker, /language each person selected for Muze/);
  assert.ok(buttons.some((button) => button.text === `✓ 🌐 ${messages.en.discussionLanguageBoth}`));
  assert.ok(buttons.some((button) => button.callback_data === `${callBacks.peopleDiscoverLanguageSet}fa`));
  assert.ok(buttons.some((button) => button.callback_data === `${callBacks.peopleDiscoverLanguageSet}en`));
  assert.equal(buttons.at(-1).callback_data, `${callBacks.peopleDiscoverPage}0`);
});

test("people discovery orders every unsaved profile before saved profiles", () => {
  const items = sortPeopleDiscoveryItems([
    { userId: 2, name: "Saved strong match", score: 100, isSaved: true },
    { userId: 3, name: "Unsaved weaker match", score: 10, isSaved: false },
    { userId: 4, name: "Saved weaker match", score: 5, isSaved: true },
    { userId: 5, name: "Unsaved strong match", score: 50, isSaved: false },
  ], { userId: 1 }, new Date("2026-07-24T12:00:00.000Z"));

  assert.deepEqual(items.map((entry) => entry.isSaved), [false, false, true, true]);
});

test("similar People scores rotate daily but stay stable throughout one UTC day", () => {
  const candidates = [
    { userId: 2, name: "A", score: 18, isSaved: false },
    { userId: 3, name: "B", score: 17, isSaved: false },
    { userId: 4, name: "C", score: 16, isSaved: false },
  ];
  const viewer = { userId: 1 };
  const morning = sortPeopleDiscoveryItems(candidates, viewer, new Date("2026-07-24T01:00:00.000Z"));
  const evening = sortPeopleDiscoveryItems(candidates, viewer, new Date("2026-07-24T22:00:00.000Z"));
  const nextDay = sortPeopleDiscoveryItems(candidates, viewer, new Date("2026-07-25T01:00:00.000Z"));

  assert.deepEqual(morning.map((entry) => entry.userId), evening.map((entry) => entry.userId));
  assert.notDeepEqual(morning.map((entry) => entry.userId), nextDay.map((entry) => entry.userId));
  assert.deepEqual(
    new Set(morning.map((entry) => entry.userId)),
    new Set(nextDay.map((entry) => entry.userId)),
  );
});

test("people discovery ends with delete-only Close", () => {
  const buttons = peopleDiscoverListKeyboard("fa").reply_markup.inline_keyboard.flat();
  const closeButton = buttons.at(-1);

  assert.equal(closeButton.text, messages.fa.discussionShareClose);
  assert.equal(closeButton.callback_data, callBacks.peopleListClose);
});

test("people discovery UI uses a distinct no-match message", () => {
  const emptyText = formatPeopleDiscoveryRequirementText(
    messages.fa.peopleDiscoverNoMatches,
    "fa",
    2,
  );
  const text = buildPeopleDiscoveryText(messages, "fa", [], {
    emptyText,
  });

  assert.match(text, /کسی با حداقل ۲ انتخاب مشترک/);
  assert.match(text, /علاقه‌مندی‌های پروفایلت/);
  assert.doesNotMatch(text, /هم‌سلیقه|شانس/);
  assert.doesNotMatch(text, /برو به بخش لیست‌ها/);
});

test("people discovery empty states link to media lists without opening profile Interests", () => {
  const buttons = peopleDiscoverListKeyboard("fa", { showLists: true })
    .reply_markup.inline_keyboard.flat();

  assert.ok(!buttons.some((button) => button.text === messages.fa.profileEditInterests));
  assert.ok(buttons.some((button) => button.text === messages.fa.peopleGoToLists));
});

test("people discovery empty state uses inline action and Close", () => {
  const keyboard = peopleDiscoverEmptyKeyboard("fa").reply_markup;
  const buttons = keyboard.inline_keyboard.flat();

  assert.equal(keyboard.keyboard, undefined);
  assert.deepEqual(buttons.map((button) => button.text), [
    messages.fa.peopleDiscoverLanguageFilterButton.replace("{language}", messages.fa.discussionLanguagePersian),
    messages.fa.peopleGoToLists,
    messages.fa.discussionShareClose,
  ]);
});

test("People list Close only deletes the tapped card", async () => {
  const events = [];
  const ctx = {
    callbackData: callBacks.peopleListClose,
    callbackMessageId: 42,
    answerCb: async () => events.push("answer"),
  };

  await handleSavedProfilesCallback(ctx, "en", {
    deleteCallbackMessageIfPossible: async (callbackCtx) => {
      events.push(`delete:${callbackCtx.callbackMessageId}`);
      return true;
    },
  });

  assert.deepEqual(events, ["answer", "delete:42"]);
});

test("people discovery pagination uses configured page size", () => {
  const page = paginatePeopleDiscovery(Array.from({ length: 7 }, (_, index) => ({ index })), 1);

  assert.equal(page.items.length, 2);
  assert.equal(page.page, 1);
  assert.equal(page.totalPages, 2);
  assert.equal(page.startIndex, 5);
});

test("shared sections use the default 2-overlap minimum in the same section", () => {
  const shared = getSharedSections(
    { music: ["a", "b", "c"], movies: ["x", "y"] },
    { music: ["a", "b", "c", "d"], movies: ["x", "y"] },
  );

  assert.deepEqual(shared, [
    { section: "music", count: 3 },
    { section: "movies", count: 2 },
  ]);
});

test("shared sections tolerate conservative typos in long titles", () => {
  const shared = getSharedSections(
    { movies: ["interstellar", "the godfather", "spirited away"] },
    { movies: ["intersteler", "the godfathar", "spirited awya"] },
  );

  assert.deepEqual(shared, [{ section: "movies", count: 3 }]);
});

test("shared sections keep short titles strict", () => {
  const shared = getSharedSections(
    { movies: ["her", "up", "it"] },
    { movies: ["here", "us", "its"] },
  );

  assert.deepEqual(shared, []);
});

test("taste matching ignores spacing and conservatively accepts nearby spelling in both languages", () => {
  assert.equal(areTasteItemsEquivalent("Enter Sandman", "Enter Sadman"), true);
  assert.equal(areTasteItemsEquivalent("Enter Sandman", "Enter Sand Man"), true);
  assert.equal(areTasteItemsEquivalent("شازده احتجاب", "شازده احتجلب"), true);
  assert.equal(areTasteItemsEquivalent("شازده احتجاب", "شازده‌احتجاب"), true);
  assert.equal(areTasteItemsEquivalent("علی", "علي"), true);
});

test("user schema indexes all three taste-label discovery lookups", () => {
  const indexNames = User.schema.indexes().map(([, options]) => options.name);

  assert.ok(indexNames.includes("people_movies_taste_label_candidates"));
  assert.ok(indexNames.includes("people_music_taste_label_candidates"));
  assert.ok(indexNames.includes("people_books_taste_label_candidates"));
});
