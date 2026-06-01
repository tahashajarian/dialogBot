const test = require("node:test");
const assert = require("node:assert/strict");

const { paginateItems } = require("../src/services/pagination");

test("paginateItems returns bounded page and stable start index", () => {
  const items = Array.from({ length: 12 }, (_, index) => index + 1);
  const paged = paginateItems(items, 2, 5);

  assert.equal(paged.page, 2);
  assert.equal(paged.totalPages, 3);
  assert.equal(paged.startIndex, 10);
  assert.deepEqual(paged.items, [11, 12]);
});

test("paginateItems clamps invalid pages", () => {
  const items = [1, 2];
  const paged = paginateItems(items, 99, 5);

  assert.equal(paged.page, 0);
  assert.equal(paged.totalPages, 1);
  assert.equal(paged.startIndex, 0);
  assert.deepEqual(paged.items, [1, 2]);
});
