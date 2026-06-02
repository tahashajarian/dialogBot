const test = require("node:test");
const assert = require("node:assert/strict");

const {
  toSavedProfileListItems,
  isCodeSaved,
  buildSavedProfileListItems,
  paginateSavedProfiles,
  buildSavedProfilesListText,
  buildProfileSavedFooter,
} = require("../src/services/saved-profiles-ui");
const messages = require("../src/messages");

test("toSavedProfileListItems builds stable rows with deduped codes", () => {
  const byCode = new Map([
    ["u_A1", { profileName: "Ali", firstName: "A" }],
    ["u_B2", { firstName: "Sara" }],
  ]);
  const rows = toSavedProfileListItems(["u_A1", "u_B2", "u_A1", ""], byCode);
  assert.deepEqual(rows, [
    { code: "u_A1", name: "Ali" },
    { code: "u_B2", name: "Sara" },
  ]);
});

test("isCodeSaved checks case-insensitive membership", () => {
  assert.equal(isCodeSaved(["u_A1", "u_B2"], "u_a1"), true);
  assert.equal(isCodeSaved(["u_A1", "u_B2"], "u_c3"), false);
});

test("buildSavedProfileListItems normalizes and hydrates user labels", async () => {
  const rows = await buildSavedProfileListItems({
    codes: ["/u_a1", "u_b2", "u_a1"],
    normalizePublicProfileCode: (value) => {
      const raw = String(value || "").replace("/", "").trim();
      return raw ? `u_${raw.slice(2).toUpperCase()}` : "";
    },
    findUsersByCodes: async () => ([
      { publicProfileCode: "u_A1", profileName: "Ali" },
      { publicProfileCode: "u_B2", firstName: "Sara" },
    ]),
  });
  assert.deepEqual(rows, [
    { code: "u_A1", name: "Ali" },
    { code: "u_B2", name: "Sara" },
  ]);
});

test("buildSavedProfilesListText separates rows with readable action links", () => {
  const text = buildSavedProfilesListText(messages, "en", [
    { code: "u_A1", name: "Ali" },
    { code: "u_B2", name: "Sara" },
  ]);

  assert.match(text, /⭐ Saved profiles/);
  assert.match(text, /1\.\n👤 Ali\n👁 View profile 👉 \/u_A1\n🗑 Remove 👉 \/unsave_A1/);
  assert.match(text, /Ali[\s\S]*\n\n2\.\n👤 Sara/);
});

test("paginateSavedProfiles keeps stable numbering across pages", () => {
  const items = Array.from({ length: 6 }, (_, index) => ({
    code: `u_A${index + 1}`,
    name: `User ${index + 1}`,
  }));
  const paged = paginateSavedProfiles(items, 1);
  const text = buildSavedProfilesListText(messages, "en", paged.items, { startIndex: paged.startIndex });

  assert.equal(paged.page, 1);
  assert.equal(paged.totalPages, 2);
  assert.match(text, /6\.\n👤 User 6/);
});

test("buildProfileSavedFooter shows saved status or save command", () => {
  assert.equal(buildProfileSavedFooter(messages, "en", "u_A1", true), "🤖 ⭐ Saved");
  assert.equal(buildProfileSavedFooter(messages, "en", "u_A1", false), "🤖 ⭐ Save profile 👉 /save_A1");
});

test("buildSavedProfilesListText uses Persian digits in fa", () => {
  const text = buildSavedProfilesListText(messages, "fa", [
    { code: "u_A1", name: "Ali" },
    { code: "u_B2", name: "Sara" },
  ]);

  assert.match(text, /۱\./);
  assert.match(text, /۲\./);
});
