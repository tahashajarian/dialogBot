const { hasLink } = require("./link-detection");

function normalizeDiscussionText(value, maxLength) {
  return Array.from(String(value || "").trim().replace(/\s+/g, " "))
    .slice(0, maxLength)
    .join("");
}

module.exports = {
  hasLink,
  normalizeDiscussionText,
};
