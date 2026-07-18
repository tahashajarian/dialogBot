const SENSITIVE_NAME_TERMS = [
  // English sexual-content terms and common compounds.
  "sex", "sexchat", "sexroom", "sextalk", "sexdating", "sexting", "sexy",
  "porn", "porno", "pornography", "xxx", "nude", "nudes", "naked", "erotic",
  "adultchat", "adultroom", "adultdating", "adultcontent", "sexual", "sexualchat",
  "nsfw", "18plus", "hookup", "hookups", "onenightstand", "fetish", "bdsm", "orgy",
  "striptease", "camgirl", "camboy", "onlyfans", "penis", "vagina", "pussy", "dick",
  "cock", "boobs", "tits", "blowjob", "handjob", "masturbation", "rape", "prostitute",
  "prostitution", "s3x", "pr0n", "seks", "seksi",

  // Persian equivalents and common spellings.
  "سکس", "سکسچت", "سکسی", "پورن", "پورنو", "لخت", "برهنه", "اروتیک", "جنسی",
  "رابطهجنسی", "چتجنسی", "چتبزرگسالان", "محتوایبزرگسال", "بزرگسالان", "شهوت",
  "شهوانی", "تحریکجنسی", "همخوابگی", "همبستری", "خودارضایی", "واژن", "آلتجنسی",
  "کیر", "کص", "جنده", "فاحشه", "فحشا", "تجاوزجنسی", "لواط",
];

const LETTER_SEPARATOR = "[\\s\\p{P}\\p{S}\\p{Cf}]*";

function normalizeSensitiveName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u0640\u064b-\u065f\u0670]/g, "");
}

function buildSensitiveTermPattern(term) {
  const characters = [...term].map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(
    `(?<!\\p{L})${characters.join(LETTER_SEPARATOR)}(?!\\p{L})`,
    "u",
  );
}

const SENSITIVE_NAME_PATTERNS = SENSITIVE_NAME_TERMS.map(buildSensitiveTermPattern);

function hasSensitiveName(value) {
  const normalized = normalizeSensitiveName(value);
  return SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(normalized));
}

module.exports = {
  hasSensitiveName,
  normalizeSensitiveName,
};
