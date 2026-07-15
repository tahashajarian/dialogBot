const INTEREST_SUGGESTION_FALLBACKS = [
  { keywords: ["coding", "programming", "کدنویسی", "برنامه نویسی", "برنامه‌نویسی", "technology", "تکنولوژی"], fa: ["ساخت یک پروژه کوچک آخرهفته", "چون کدنویسی را از مصرف محتوا به ساختن تبدیل می‌کند."], en: ["Build a tiny weekend project", "It turns your coding interest into something tangible."] },
  { keywords: ["chess", "شطرنج", "strategy", "استراتژی"], fa: ["پازل روزانه شطرنج در Lichess", "یک تمرین کوتاه و مستقیم برای علاقه‌ات به استراتژی است."], en: ["Daily Lichess puzzles", "A short, direct way to deepen your strategy interest."] },
  { keywords: ["photography", "عکاسی", "art", "هنر", "writing", "نوشتن"], fa: ["چالش ثبت یک موضوع در ۷ روز", "به علاقه خلاقانه‌ات یک مسیر ساده و قابل انجام می‌دهد."], en: ["A seven-day one-theme challenge", "It gives your creative interest a simple, doable direction."] },
  { keywords: ["travel", "سفر", "nature", "طبیعت", "walking", "پیاده روی", "پیاده‌روی"], fa: ["طراحی یک مسیر پیاده‌روی تازه در شهرت", "سفر و کشف را به یک تجربه نزدیک و عملی تبدیل می‌کند."], en: ["Map a new walking route in your city", "It turns exploration into something nearby and practical."] },
  { keywords: ["gaming", "game", "گیم", "بازی"], fa: ["امتحان یک بازی مستقل کوتاه خارج از سبک همیشگی‌ات", "تنوع می‌دهد بدون اینکه تعهد زمانی بزرگی بخواهد."], en: ["Try a short indie game outside your usual genre", "It adds variety without demanding a huge time commitment."] },
  { keywords: ["food", "غذا", "cooking", "آشپزی", "coffee", "قهوه", "cafe", "کافه"], fa: ["بازسازی یک طعم محبوب در خانه", "غذا و کنجکاوی را به یک تجربه شخصی وصل می‌کند."], en: ["Recreate a favorite flavor at home", "It connects food curiosity with a personal experiment."] },
  { keywords: ["sports", "ورزش", "gym", "باشگاه", "football", "فوتبال"], fa: ["یک چالش حرکتی ۱۴ روزه قابل اندازه‌گیری", "با علاقه ورزشی‌ات جور است و پیشرفت واضحی نشان می‌دهد."], en: ["A measurable 14-day movement challenge", "It fits your active interests and makes progress visible."] },
  { keywords: ["podcast", "پادکست", "youtube", "یوتیوب", "science", "علم", "history", "تاریخ", "psychology", "روانشناسی"], fa: ["ساخت یک پلی‌لیست یادگیری سه‌قسمتی", "کنجکاوی‌ات را از پخش پراکنده به یک مسیر کوچک تبدیل می‌کند."], en: ["Build a three-episode learning playlist", "It turns scattered curiosity into a small learning path."] },
];

const DEFAULT_INTEREST_SUGGESTION_FALLBACK = {
  fa: ["یک پروژه کوچک از ترکیب دو علاقه‌ات", "کمکت می‌کند علایقت را به یک تجربه واقعی تبدیل کنی."],
  en: ["A small project combining two interests", "It turns your interests into a real, personal experience."],
};

module.exports = { DEFAULT_INTEREST_SUGGESTION_FALLBACK, INTEREST_SUGGESTION_FALLBACKS };
