const INTEREST_CHIPS = [
  { emoji: "🎬", fa: "فیلم", en: "Movies" },
  { emoji: "📚", fa: "کتاب", en: "Books" },
  { emoji: "🎵", fa: "موسیقی", en: "Music" },
  { emoji: "♟", fa: "شطرنج", en: "Chess" },
  { emoji: "💻", fa: "کدنویسی", en: "Coding" },
  { emoji: "🔬", fa: "علم", en: "Science" },
  { emoji: "🧠", fa: "روانشناسی", en: "Psychology" },
  { emoji: "🏛", fa: "تاریخ", en: "History" },
  { emoji: "✍️", fa: "نوشتن", en: "Writing" },
  { emoji: "🎨", fa: "هنر", en: "Art" },
  { emoji: "📸", fa: "عکاسی", en: "Photography" },
  { emoji: "🧩", fa: "بازی فکری", en: "Board games" },
  { emoji: "🎲", fa: "منچ", en: "Mensch" },
  { emoji: "🎭", fa: "تئاتر", en: "Theater" },
  { emoji: "🎧", fa: "پادکست", en: "Podcast" },
  { emoji: "📺", fa: "یوتیوب", en: "YouTube" },
  { emoji: "✈️", fa: "سفر", en: "Travel" },
  { emoji: "🌿", fa: "طبیعت", en: "Nature" },
  { emoji: "🧗", fa: "کوهنوردی", en: "Hiking" },
  { emoji: "🐶", fa: "حیوانات", en: "Animals" },
  { emoji: "🚶", fa: "پیاده‌روی", en: "Walking" },
  { emoji: "☕", fa: "قهوه", en: "Coffee" },
  { emoji: "🏙", fa: "کافه‌گردی", en: "Cafes" },
  { emoji: "🍳", fa: "آشپزی", en: "Cooking" },
  { emoji: "🍜", fa: "غذا", en: "Food" },
  { emoji: "💪", fa: "سلامتی", en: "Wellness" },
  { emoji: "🧘", fa: "آرامش", en: "Calm" },
  { emoji: "🌱", fa: "رشد فردی", en: "Self growth" },
  { emoji: "💼", fa: "کسب‌وکار", en: "Business" },
  { emoji: "💰", fa: "سرمایه‌گذاری", en: "Investing" },
  { emoji: "⚽", fa: "فوتبال", en: "Football" },
  { emoji: "🏋️", fa: "باشگاه", en: "Gym" },
  { emoji: "🏊", fa: "شنا", en: "Swimming" },
  { emoji: "🎮", fa: "گیم", en: "Gaming" },
  { emoji: "🍥", fa: "انیمه", en: "Anime" },
  { emoji: "🗣", fa: "زبان‌آموزی", en: "Languages" },
  { emoji: "🎤", fa: "خوانندگی", en: "Singing" },
  { emoji: "👗", fa: "مد و فشن", en: "Fashion" },
  { emoji: "🎉", fa: "دورهمی", en: "Social events" },
];

function normalizeChipTitle(value) {
  return String(value || "").trim().toLowerCase();
}

function getInterestChipByTitle(title) {
  const normalized = normalizeChipTitle(title);
  if (!normalized) return null;
  return INTEREST_CHIPS.find((chip) => (
    normalizeChipTitle(chip.fa) === normalized ||
    normalizeChipTitle(chip.en) === normalized
  )) || null;
}

function getInterestChipTitle(chip, lang) {
  return lang === "fa" ? chip.fa : chip.en;
}

function canonicalizeInterestChipTitle(title) {
  const chip = getInterestChipByTitle(title);
  return chip ? chip.en : String(title || "").trim();
}

function localizeInterestChipTitle(title, lang) {
  const chip = getInterestChipByTitle(title);
  return chip ? getInterestChipTitle(chip, lang) : String(title || "").trim();
}

function localizeInterestChipItem(item, lang) {
  if (typeof item === "string") {
    return localizeInterestChipTitle(item, lang);
  }
  return {
    ...item,
    title: localizeInterestChipTitle(item?.title, lang),
  };
}

function isInterestChipSelected(chip, selectedTitles = []) {
  const selected = new Set(selectedTitles.map(normalizeChipTitle));
  return selected.has(normalizeChipTitle(chip.fa)) || selected.has(normalizeChipTitle(chip.en));
}

module.exports = {
  INTEREST_CHIPS,
  canonicalizeInterestChipTitle,
  getInterestChipByTitle,
  getInterestChipTitle,
  isInterestChipSelected,
  localizeInterestChipItem,
  localizeInterestChipTitle,
};
