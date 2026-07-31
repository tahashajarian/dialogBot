# Current Suggestion Flow

This file summarizes the current production contract so future changes do not reintroduce retired behavior.

## Books

- AI generates the recommendation directly from Favorites and optional mood.
- Show title, author, mood when supplied, and the short standalone description.
- Year and external catalogue verification are not required.
- Rejected, saved, recent, and Favorite titles remain exclusion/negative signals.

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

- Free and paid suggestion paths use the same editable placeholder flow.
- Persian copy avoids tanvin and does not expose internal verification steps.
- Telegram edit failure must fall back to a visible terminal result without losing the suggestion.
