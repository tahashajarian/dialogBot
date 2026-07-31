const { getAiConfig } = require("../config");

const AI_SUGGESTION_STEP_DELAYS_MS = Object.freeze([7000, 20000]);
const AI_SUGGESTION_MAX_WAIT_MS = 25000;

function getAiSuggestionTimeoutMs(section, config = getAiConfig()) {
  const baseTimeoutMs = Math.max(1000, Number(config?.timeoutMs) || 20000);
  if (section === "books") {
    return Math.min(AI_SUGGESTION_MAX_WAIT_MS, baseTimeoutMs + 3000);
  }
  return AI_SUGGESTION_MAX_WAIT_MS;
}

module.exports = {
  AI_SUGGESTION_MAX_WAIT_MS,
  AI_SUGGESTION_STEP_DELAYS_MS,
  getAiSuggestionTimeoutMs,
};
