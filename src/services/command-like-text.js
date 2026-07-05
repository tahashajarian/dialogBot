function normalizeCommandCandidate(value) {
  return String(value || "")
    .trim()
    .replace(/^[\u200e\u200f\u202a-\u202e\u2066-\u2069]+/, "");
}

function isCommandLikeText(value) {
  return /^\/[A-Za-z0-9_]/.test(normalizeCommandCandidate(value));
}

module.exports = {
  isCommandLikeText,
};
