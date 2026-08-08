const test = require("node:test");
const assert = require("node:assert/strict");

const { getAiListDuplicateMatch } = require("../src/services/ai-list-duplicates");

test("detects near-duplicate Top Ten music entries", () => {
  const items = [{ title: "enter sand man" }];

  assert.equal(getAiListDuplicateMatch("enter sand man", items)?.type, "exact");
  assert.equal(getAiListDuplicateMatch("enter sand man metlica", items)?.type, "fuzzy_substring");
  assert.equal(getAiListDuplicateMatch("enter sadman metlica", items)?.type, "fuzzy_substring");
});

test("detects separator and ordering variants", () => {
  const items = [{ title: "Metallica - Enter Sandman" }];

  const match = getAiListDuplicateMatch("enter sandman metallica", items);
  assert.ok(match);
  assert.ok(match.score >= 88);
});

test("detects movie typos in all sections", () => {
  const items = [{ title: "forest gump" }];

  const match = getAiListDuplicateMatch("forset gump", items);
  assert.ok(match);
  assert.ok(match.score >= 88);
});

test("detects Persian joiner and character variants", () => {
  assert.equal(
    getAiListDuplicateMatch("سن پطرزبورگ", [{ title: "سن‌پطرزبورگ" }])?.type,
    "exact",
  );
  assert.equal(
    getAiListDuplicateMatch("كيارستمي", [{ title: "کیارستمی" }])?.type,
    "exact",
  );
  assert.equal(
    getAiListDuplicateMatch("کفرناحوم", [{ title: "کفرناحوم — نادین لبکی" }])?.type,
    "exact",
  );
});

test("detects one-token typos with stricter short threshold", () => {
  const items = [{ title: "Metallica" }];

  assert.ok(getAiListDuplicateMatch("metalica", items));
  assert.ok(getAiListDuplicateMatch("metallca", items));
});

test("does not overmatch risky short or one-token subset entries", () => {
  assert.equal(getAiListDuplicateMatch("Batman Returns", [{ title: "Batman" }]), null);
  assert.equal(getAiListDuplicateMatch("Badman", [{ title: "Batman" }]), null);
  assert.equal(getAiListDuplicateMatch("Megadeth", [{ title: "Metallica" }]), null);
});
