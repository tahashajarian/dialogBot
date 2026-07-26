const test = require("node:test");
const assert = require("node:assert/strict");

const { isLowQualityAiListItem } = require("../src/services/ai-input-quality");

test("detects obvious keyboard mash and placeholder TopTen inputs", () => {
  assert.equal(isLowQualityAiListItem(";klahdflkj aldshf"), true);
  assert.equal(isLowQualityAiListItem("asdfghjkl"), true);
  assert.equal(isLowQualityAiListItem("Test"), true);
  assert.equal(isLowQualityAiListItem("تست"), true);
  assert.equal(isLowQualityAiListItem("هیچی"), true);
  assert.equal(isLowQualityAiListItem("نتاشایباشسمنیاب"), true);
});

test("allows real-looking multilingual list items", () => {
  assert.equal(isLowQualityAiListItem("The Godfather"), false);
  assert.equal(isLowQualityAiListItem("Breaking Bad"), false);
  assert.equal(isLowQualityAiListItem("Master of Puppets"), false);
  assert.equal(isLowQualityAiListItem("کافه‌گردی"), false);
  assert.equal(isLowQualityAiListItem("شطرنج"), false);
});
