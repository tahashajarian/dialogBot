const test = require("node:test");
const assert = require("node:assert/strict");

const {
  toSavedProfileListItems,
  isCodeSaved,
  buildSavedProfileListItems,
} = require("../src/services/saved-profiles-ui");

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
