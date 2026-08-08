# Current Suggestion Flow

This file summarizes the current production contract so future changes do not reintroduce retired behavior.

## Taste evidence and model routing

- Favorites in the active media section are the only positive taste evidence used to select or rank suggestions.
- For Later, recent, liked, and rejected history may prevent repeats, but must not steer taste or ranking. Taste badges must not influence suggestions.
- `MODEL_NAME` / `OPENAI_MODEL` is the main model for movie generation and fallback book generation. `FAST_MODEL_NAME` / `OPENAI_FAST_MODEL` is the fast model for bounded ranking, adjacent-artist discovery, and short explanations; it falls back to the main model when unset.
- An unusable fast-model result is retried once with the main model.

## Books

- AI returns one ordered batch of five established official original book identities. Keeping the JSON batch compact avoids truncation and filler duplicates.
- Each fallback candidate contains an official original title/author pair and remains ineligible until that pair is verified.
- Favorites and the optional current request are the only taste evidence. Read Later, recent, liked/read, and rejected books are hard exclusions only.
- Code removes known canonical duplicates before verification, then checks verified catalogue aliases across languages.
- Code checks at most the first five non-duplicate candidates in order, stopping at the first verified result or the existing deadline. Open Library verifies each exact title-author pair first; strict Wikidata verification is the fallback when Open Library is unavailable or has no matching record. Only an exact title and author relationship from either source may be displayed.
- Open Library title matching is exact after punctuation, case, and accent normalization across the work title and its returned edition titles. Combined-title records, study guides, notes, summaries, analysis, criticism, companions, and workbooks cannot verify the requested book.
- Wikidata accepts a missing or unusual book classification only when the title exactly matches, an exact P50 author relationship exists, and the entity is not classified as a movie or television work.
- Verification stops at the first usable candidate and caches successful identities for six hours and catalogue mismatches for fifteen minutes. Catalogue outages are never cached.
- Google Books is not used. Set `OPEN_LIBRARY_CONTACT_EMAIL` to identify regular Open Library traffic.
- Recent authors remain excluded unless explicitly requested; Favorite authors are held back until the final verified fallback tier.
- Display the verified requested original identity: Persian originals stay Persian and non-Persian books use their official English/international identity.
- Do not display year, publisher, edition, rating, or other catalogue metadata.
- A catalogue pool is not sufficient by itself: the ranker may decline the entire pool when evidence does not support the request. Never fall back to the first retrieved record or attach a generic reason to an unranked book.
- If both Open Library and Wikidata are unavailable or neither confirms the exact pair, show no suggestion. A second model call must never serve as identity verification.

## Movies and series

- AI generates bounded candidate batches ordered from strongest to weakest relevance.
- Duplicate and request checks run before verification. Remaining candidates are verified in parallel, and the highest-ranked generated candidate that survives every safeguard is selected without another model call.
- Show title plus director or series creator; year and ratings are optional and not displayed.
- The model infers the strongest repeated national-cinema, language, genre, theme, mood, pacing, and style patterns directly from Favorites; the current request may override them.
- Use the official original-language title: Persian works stay Persian, while non-Persian works use their official English/international title and are never translated into Persian for display.
- Keep the verified identity role in result metadata: directors remain Director/کارگردان and series creators remain Creator/سازنده. Persian reasons must contain only natural Persian wording.
- Explicit high-signal requests such as comedy, horror, or documentary must be supported by the candidate's concrete explanation before catalogue verification.
- Recommendations follow the dominant Favorites cluster and avoid unrelated genre jumps without an explicit signal.

## Music

- Retrieval-first: Apple/Deezer catalogue results provide authoritative title-artist pairs. Catalogue-related artists and one bounded adjacent-artist discovery call widen the pool before track retrieval.
- AI ranks only retrieved candidates and writes mood plus the standalone description; it must not invent or rewrite title/artist.
- Display the selected catalogue title and artist unchanged. Persian originals stay Persian; non-Persian music uses its official English/international catalogue identity.
- Persian artist discovery may use international-catalogue spellings for search, but it may not rewrite, translate, or transliterate the selected identity.
- Favorite artists guide discovery. Recent creators, For Later works, liked/listened works, and exact rejected display/source identities are exclusions only; they must not steer musical taste.
- Do not display album, year, rating, label, or other catalogue metadata.

## Placeholder

- Free and paid suggestion paths show one static placeholder: `👱‍♀️ در حال آماده‌کردن پیشنهاد...` / `👱‍♀️ Preparing your suggestion...`.
- The placeholder is deleted when the terminal result or fallback is sent; there is no dot animation and no repeated edit loop.
- The entire user-facing suggestion wait remains capped at 25 seconds.

## Title and creator identity

Movies, Books, and Music use one rule: display the verified official original identity. Persian originals stay Persian; non-Persian works use their official English/international title and creator spelling. Favorites script, interface language, and the optional mood/request never change identity. The interface language controls only labels, mood text, and the short reason. Verified aliases across languages are used only for duplicate and exclusion checks; no section may invent a translation or transliteration.
