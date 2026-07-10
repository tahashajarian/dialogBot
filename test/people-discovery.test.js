const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/user");
const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const { peopleHubKeyboard, peopleDiscoverListKeyboard } = require("../src/keyboards");
const {
  ensurePeopleDiscoveryCodes,
  findPeopleBySharedTaste,
  getSharedSections,
  paginatePeopleDiscovery,
} = require("../src/services/people-discovery");
const {
  buildPeopleDiscoveryText,
} = require("../src/services/people-discovery-ui");

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

test("people discovery requires at least 3 items in one viewer section", async () => {
  const originalFind = User.find;
  let called = false;
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
    User.find = originalFind;
  }
});

test("people discovery returns users with at least 3 shared items and skips self, banned query, and weak matches", async () => {
  const originalFind = User.find;
  let query;
  User.find = (value) => {
    query = value;
    return {
      select: () => ({
        limit: () => ({
          lean: async () => [
            userWithMusic(2, ["metallica", "nirvana", "queen", "radiohead"]),
            userWithMusic(3, ["metallica", "nirvana"]),
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
    assert.deepEqual(result.items.map((item) => item.userId), [2, 4]);
    assert.equal(result.items[0].sharedSections[0].count, 3);
    assert.equal(result.items[1].isSaved, true);
  } finally {
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

test("People hub keeps one people discovery entry", () => {
  const hidden = peopleHubKeyboard("fa").reply_markup.inline_keyboard.flat();
  const visible = peopleHubKeyboard("fa").reply_markup.inline_keyboard.flat();

  assert.ok(!hidden.some((button) => button.callback_data === callBacks.peopleTasteMatches));
  assert.ok(!visible.some((button) => button.callback_data === callBacks.peopleTasteMatches));
  assert.equal(visible[0].callback_data, callBacks.peopleDiscover);
  assert.equal(visible[0].text, messages.fa.peopleDiscover);
});

test("people pagination uses canonical discover callbacks", () => {
  const buttons = peopleDiscoverListKeyboard("en", { mode: "taste", page: 0, totalPages: 2 })
    .reply_markup.inline_keyboard.flat();

  assert.ok(buttons.some((button) => button.callback_data === `${callBacks.peopleDiscoverPage}1`));
  assert.ok(!buttons.some((button) => button.callback_data === `${callBacks.peopleTasteMatchesPage}1`));
});

test("people discovery Back uses generic label and returns to People hub", () => {
  const buttons = peopleDiscoverListKeyboard("fa").reply_markup.inline_keyboard.flat();
  const backButton = buttons.at(-1);

  assert.equal(backButton.callback_data, callBacks.people);
  assert.equal(backButton.text, messages.fa.aiBack);
});

test("people discovery UI uses a distinct no-match message", () => {
  const text = buildPeopleDiscoveryText(messages, "fa", [], {
    emptyText: messages.fa.peopleDiscoverNoMatches,
  });

  assert.match(text, /کسی با حداقل ۳ انتخاب مشترک/);
  assert.doesNotMatch(text, /برو به بخش لیست‌ها/);
});

test("people discovery pagination uses configured page size", () => {
  const page = paginatePeopleDiscovery(Array.from({ length: 7 }, (_, index) => ({ index })), 1);

  assert.equal(page.items.length, 2);
  assert.equal(page.page, 1);
  assert.equal(page.totalPages, 2);
  assert.equal(page.startIndex, 5);
});

test("shared sections require 3 overlaps in the same section", () => {
  const shared = getSharedSections(
    { music: ["a", "b", "c"], movies: ["x", "y"] },
    { music: ["a", "b", "c", "d"], movies: ["x", "y"] },
  );

  assert.deepEqual(shared, [{ section: "music", count: 3 }]);
});
