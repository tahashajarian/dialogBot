# Current Suggestion Flow

This file summarizes the current production contract so future changes do not reintroduce retired behavior.

## Books

- Catalogue retrieval first attempts to build a real, display-script-compatible pool from Google Books and Open Library and ranks it by candidate index.
- When that pool has fewer than three items, AI returns one ordered batch of five established canonical book identities with optional high-confidence Persian display fields. Keeping the JSON batch compact avoids truncation and filler duplicates.
- Each fallback candidate contains an official original title/author pair; Persian display fields remain ineligible until that canonical pair is verified.
- Favorites and explicitly liked/read books are positive evidence. Read Later and recent items are neutral hard exclusions. Rejected books are negative evidence.
- Code removes known canonical duplicates before verification, then removes localized/translated duplicates after display resolution.
- Open Library verifies fallback title-author pairs in parallel. Only verified candidates may be displayed. Recent authors remain excluded unless explicitly requested; Favorite authors are held back until the final verified fallback tier.
- Persian-dominant Favorites prefer Persian-script display title and author. If localization is the sole blocker after every stronger candidate is exhausted, a verified canonical original identity may be shown rather than inventing a translation or failing.
- The fallback uses the cached Persian resolver only when a verified candidate lacks safe Persian display fields.
- Do not display year, publisher, edition, rating, or other catalogue metadata.
- A catalogue pool is not sufficient by itself: the ranker may decline the entire pool when evidence does not support the request. Never fall back to the first retrieved record or attach a generic reason to an unranked book.
- Keep catalogue fan-out bounded and cache successful search responses for six hours. Do not cache outages, throttling responses, or timeouts.
- If the live Google Books endpoint returns an authorization 403, open a process-level circuit breaker instead of repeating doomed requests; Open Library remains available and a valid configured API key prevents this path.

## Movies and series

- AI may generate bounded candidate batches.
- Show title plus director or series creator; year and ratings are optional and not displayed.
- Persian-dominant Favorites require Persian display identity while retaining Wikidata identity for cross-language duplicate checks.
- Explicit high-signal requests such as comedy, horror, or documentary must be supported by the candidate's concrete explanation before catalogue verification. Localized and original titles are shown together only when they are genuinely different.
- Recommendations follow the dominant Favorites cluster and avoid unrelated genre jumps without an explicit signal.

## Music

- Retrieval-first: Apple/Deezer catalogue results provide authoritative title-artist pairs. Catalogue-related artists and one bounded adjacent-artist discovery call widen the pool before track retrieval.
- AI ranks only retrieved candidates and writes mood plus the standalone description; it must not invent or rewrite title/artist.
- Persian title/artist localization is display-only. Source identity remains authoritative for duplicate checks, saving, and rejection.
- Persian artist discovery uses international-catalogue spellings for search, while ranking prefers already-Persian catalogue identities whenever they are relevant; localization remains a fallback rather than a reason to invent a name.
- Favorite, recent, and saturated For Later artists are cooled down unless explicitly requested. Exact rejected display/source identities and alternate Favorite recordings are removed before ranking. Rejected tracks are also sent to the ranking AI as bounded negative taste evidence.
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

The interface language still controls labels, mood text, and the short descriptive reason. Movies and music reject a candidate when the required display identity is unavailable. Books may use the documented verified original-identity fallback only after all stronger Persian-display candidates are exhausted; no section may invent a translation.
