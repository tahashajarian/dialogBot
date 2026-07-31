function countScriptLetters(value = "") {
  const text = String(value || "").normalize("NFKC");
  return {
    fa: (text.match(/[\u0621-\u063a\u0641-\u064a\u066e-\u066f\u0671-\u06d3\u06fa-\u06fc]/giu) || []).length,
    en: (text.match(/[A-Za-z]/g) || []).length,
  };
}

function classifyItemScript(value = "") {
  const text = String(value || "").normalize("NFKC");
  const firstScriptLetter = text.match(/[A-Za-z\u0621-\u063a\u0641-\u064a\u066e-\u066f\u0671-\u06d3\u06fa-\u06fc]/iu)?.[0] || "";
  if (!firstScriptLetter) return "";
  return /[A-Za-z]/.test(firstScriptLetter) ? "en" : "fa";
}

function getPreferredSuggestionDisplayLanguage(items = [], fallbackLang = "fa") {
  const votes = { fa: 0, en: 0 };
  for (const item of Array.isArray(items) ? items : []) {
    const script = classifyItemScript(item?.title ?? item);
    if (script) votes[script] += 1;
  }
  if (votes.fa === votes.en) return fallbackLang === "en" ? "en" : "fa";
  return votes.fa > votes.en ? "fa" : "en";
}

module.exports = {
  classifyItemScript,
  countScriptLetters,
  getPreferredSuggestionDisplayLanguage,
};
