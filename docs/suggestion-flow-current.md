# Current Suggestion Flow

This file summarizes the current production contract so future changes do not reintroduce retired behavior.

## Books

- AI returns one ordered batch of up to five real book candidates.
- Each candidate contains a display title/author and an official original title/author pair.
- Favorites and explicitly liked/read books are positive evidence. Read Later and recent items are neutral hard exclusions. Rejected books are negative evidence.
- Code removes duplicates using both display and original identities before any network verification.
- Open Library verifies the original title-author pairs in parallel. Only verified candidates may be displayed.
- Persian-dominant Favorites require Persian-script display title and author. Latin or romanized Persian display identities are rejected.
- No Google Books discovery, catalogue expansion, second-page searching, or extra ranking AI call is used.
- Do not display year, publisher, edition, rating, or other catalogue metadata.

## Movies and series

- AI may generate bounded candidate batches.
- Show title plus director or series creator; year and ratings are optional and not displayed.
- Persian requests require Persian display identity while retaining original identity for cross-language duplicate checks.
- Recommendations follow the dominant Favorites cluster and avoid unrelated genre jumps without an explicit signal.

## Music

- Retrieval-first: Apple/Deezer catalogue results provide authoritative title-artist pairs.
- AI ranks only retrieved candidates and writes mood plus the standalone description; it must not invent or rewrite title/artist.
- Persian title/artist localization is display-only. Source identity remains authoritative for duplicate checks, saving, and rejection.
- Exact rejected display/source identities are removed before ranking. Rejected tracks are also sent to the ranking AI as bounded negative taste evidence.
- Do not display album, year, rating, label, or other catalogue metadata.

## Placeholder

- Free and paid suggestion paths show one static placeholder: `👱‍♀️ در حال آماده‌کردن پیشنهاد...` / `👱‍♀️ Preparing your suggestion...`.
- The placeholder is deleted when the terminal result or fallback is sent; there is no dot animation and no repeated edit loop.
- The entire user-facing suggestion wait remains capped at 25 seconds.

## Title and creator display language

Suggestion identity display is section-specific and follows the dominant script of that section's favorites rather than the interface language:

- mostly Persian-script favorites → prefer established Persian title and creator names;
- mostly Latin-script favorites → keep official original/Latin title and creator names;
- tied or empty favorites → fall back to the interface language.

The interface language still controls labels, mood text, and the short descriptive reason. If a Persian display identity is not confidently available, the verified/original identity is shown instead of inventing a translation. This applies to books, movies/series, and music.
