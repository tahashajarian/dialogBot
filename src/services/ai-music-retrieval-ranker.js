const { getAiConfig } = require('../config');
const { getClient, requestFastSuggestionText } = require('./ai-client');
const { logger } = require('./logger');

const { cleanCatalogueTitleForDisplay } = require('./music-display');
const MUSIC_RANKING_TIMEOUT_MS = 7000;

function parseRankedMusic(value, count) {
  const clean = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(clean);
    const index = Number(parsed.index) - 1;
    const mood = String(parsed.mood || '').trim();
    const reason = String(parsed.reason || '').trim();
    if (!Number.isInteger(index) || index < 0 || index >= count || !mood || !reason) return null;
    return { index, mood, reason };
  } catch (_) {
    return null;
  }
}

async function rankRetrievedMusic({
  userId,
  lang,
  userText = '',
  favorites = [],
  recentCreators = [],
  candidates = [],
}, {
  config = getAiConfig(),
  requestText = requestFastSuggestionText,
  client,
} = {}) {
  const usable = candidates.slice(0, 30);
  if (!usable.length) return { ok: false, reason: 'no_catalog_candidates' };
  const openai = client || getClient(config);
  if (!openai) return { ok: false, reason: 'ranker_unavailable' };
  const rankingConfig = {
    ...config,
    timeoutMs: Math.min(
      MUSIC_RANKING_TIMEOUT_MS,
      Math.max(1000, Number(config?.timeoutMs) || MUSIC_RANKING_TIMEOUT_MS),
    ),
  };

  try {
    const list = usable.map((item, index) => `${index + 1}. ${item.title} — ${item.artist}`).join('\n');
    const result = await requestText(openai, {
      userId,
      config: rankingConfig,
      operation: 'music_retrieval_ranking',
      maxOutputTokens: 100,
      instructions: [
        'Choose exactly one item from the supplied real catalogue candidates. Never invent or rewrite a title or artist.',
        'Use the favorites and current mood/request as positive taste evidence.',
        'Select a track inside the dominant musical cluster of the Favorites. Do not jump to classical, soundtrack, novelty, tribute, karaoke, or genre-incongruent material merely because a title or distant artist relationship overlaps.',
        'Do not select a cover, live version, remaster, tribute, or alternate recording of a Favorite unless the current request explicitly asks for covers or alternate versions.',
        'Never choose an exact rejected track, even if it appears among the candidates.',
        'Never choose a recent creator unless the current request explicitly names that creator.',
        'Return only JSON: {"index": number, "mood": string, "reason": string}.',
        'The reason must describe the selected song itself, not the user or their list.',
        'Keep the selected catalogue title and artist exactly as supplied. Language and mood must never change their identity.',
        lang === 'fa'
          ? 'Write mood and reason in Persian. Reason should be a short standalone two-part phrase separated by «؛».'
          : 'Write mood and reason in English, concise and natural.',
      ].join(' '),
      input: `Request: ${userText || 'Suggest one song'}\nFavorites: ${favorites.join(' | ')}\nRecent creators: ${recentCreators.length ? recentCreators.join(' | ') : 'None'}\nCandidates:\n${list}`,
    }, (response) => Boolean(parseRankedMusic(response?.text, usable.length)));
    const ranked = parseRankedMusic(result.text, usable.length);
    if (!ranked) return { ok: false, reason: 'invalid_ranker_output' };
    const candidate = usable[ranked.index];
    const displayTitle = cleanCatalogueTitleForDisplay(candidate.title);
    return {
      ok: true,
      candidate,
      displayTitle,
      displayArtist: candidate.artist,
      mood: ranked.mood,
      reason: ranked.reason,
    };
  } catch (error) {
    logger.warn('Retrieved music ranking failed', { error: error?.message || String(error) });
    return { ok: false, reason: 'ranker_unavailable' };
  }
}

module.exports = { parseRankedMusic, rankRetrievedMusic };
