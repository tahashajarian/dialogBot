const test = require("node:test");
const assert = require("node:assert/strict");

const { getAiTasteItemFeedback } = require("../src/services/ai");

test("uses predefined feedback for known Interests chips", async () => {
  const faCoding = await getAiTasteItemFeedback({
    mode: "random",
    lang: "fa",
    item: "کدنویسی",
    labelKey: "tech_minded",
    labelTitle: "تکنولوژی‌ذهن",
  });
  const enGaming = await getAiTasteItemFeedback({
    mode: "random",
    lang: "en",
    item: "Gaming",
    labelKey: "gamer",
    labelTitle: "Gamer",
  });

  assert.equal(faCoding.ok, true);
  assert.equal(faCoding.matchType, "predefined");
  assert.equal(faCoding.text, "کدنویسی یعنی ذهنت اهل ساختنه.");
  assert.equal(enGaming.ok, true);
  assert.equal(enGaming.matchType, "predefined");
  assert.equal(enGaming.text, "Gaming says you enjoy challenge and flow.");
});
