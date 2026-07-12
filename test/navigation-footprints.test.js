const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveNavigationFootprint,
  sendNavigationFootprint,
} = require("../src/services/navigation-footprints");

test("navigation footprints resolve localized static destinations", () => {
  assert.equal(resolveNavigationFootprint("en", "profile"), "👤 Profile");
  assert.equal(resolveNavigationFootprint("fa", "people"), "👥 آدم‌ها");
});

test("discussion footprints use the established safe display title", () => {
  assert.equal(
    resolveNavigationFootprint("en", "discussion", { discussion: { title: "Film club" } }),
    "💬 Film club",
  );
  assert.equal(
    resolveNavigationFootprint("en", "discussion", { discussion: {} }),
    "💬 -",
  );
});

test("a footprint can remove the obsolete reply keyboard in the same permanent send", async () => {
  const replies = [];
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 42 };
    },
  };

  const sent = await sendNavigationFootprint(ctx, {
    lang: "en",
    destination: "profile",
    removeKeyboard: true,
  });

  assert.deepEqual(sent, { message_id: 42 });
  assert.deepEqual(replies, [{
    text: "👤 Profile",
    extra: { reply_markup: { remove_keyboard: true } },
  }]);
});
