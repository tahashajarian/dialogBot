function normalizeDiscussionText(value, maxLength) {
  return Array.from(String(value || "").trim().replace(/\s+/g, " "))
    .slice(0, maxLength)
    .join("");
}

function hasLink(value) {
  return /https?:\/\/|www\.|t\.me\/|telegram\.me\/|bale\.ai\//i.test(String(value || ""));
}

module.exports = {
  hasLink,
  normalizeDiscussionText,
};
