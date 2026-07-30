function normalizeCatalogueTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function normalizeDigits(value) {
  return String(value || "")
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

function extractYear(value) {
  return normalizeDigits(value).match(/\b(?:18|19|20)\d{2}\b/)?.[0] || "";
}

module.exports = {
  extractYear,
  normalizeCatalogueTitle,
};
