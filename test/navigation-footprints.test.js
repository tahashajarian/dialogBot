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

test("navigation cleanup retires legacy cards without sending footprint messages", async () => {
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

  assert.equal(sent, null);
  assert.deepEqual(replies, []);
});

test("retiring an old card creates no replacement footprint", async () => {
  let finishDelete;
  const deletePending = new Promise((resolve) => {
    finishDelete = resolve;
  });
  const replies = [];
  const ctx = {
    user: { navigationLastCardMessageId: 41 },
    deleteMessage: async () => deletePending,
    reply: async (text) => {
      replies.push(text);
      return { message_id: 42 };
    },
  };

  const sending = sendNavigationFootprint(ctx, { lang: "en", destination: "discussions" });
  await Promise.resolve();

  assert.deepEqual(replies, []);
  finishDelete(true);
  assert.equal(await sending, null);
});
