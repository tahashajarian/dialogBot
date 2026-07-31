const { getAiConfig } = require('../config');
const { getClient, requestSuggestionText } = require('./ai-client');
const { logger } = require('./logger');

const { cleanCatalogueTitleForDisplay, hasPersianScript, normalizeDisplay } = require('./music-display');

function parseRankedMusic(value, count, displayLanguage = 'en') {
  const clean = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(clean);
    const index = Number(parsed.index) - 1;
    const mood = String(parsed.mood || '').trim();
    const reason = String(parsed.reason || '').trim();
    if (!Number.isInteger(index) || index < 0 || index >= count || !mood || !reason) return null;
    const localizedTitle = String(parsed.localizedTitle || '').trim();
    const localizedArtist = String(parsed.localizedArtist || '').trim();
    return {
      index,
      mood,
      reason,
      localizedTitle: displayLanguage === 'fa' && hasPersianScript(localizedTitle) ? localizedTitle : '',
      localizedArtist: displayLanguage === 'fa' && hasPersianScript(localizedArtist) ? localizedArtist : '',
    };
  } catch (_) {
    return null;
  }
}

async function rankRetrievedMusic({ userId, lang, displayLanguage = lang, userText = '', favorites = [], rejectedSuggestions = [], candidates = [] }, {
  config = getAiConfig(),
  requestText = requestSuggestionText,
  client,
} = {}) {
  const usable = candidates.slice(0, 30);
  if (!usable.length) return { ok: false, reason: 'no_catalog_candidates' };
  const openai = client || getClient(config);
  if (!openai) return { ok: false, reason: 'ranker_unavailable' };

  try {
    const list = usable.map((item, index) => `${index + 1}. ${item.title} — ${item.artist}`).join('\n');
    const result = await requestText(openai, {
      userId,
      config,
      operation: 'music_retrieval_ranking',
      maxOutputTokens: 100,
      instructions: [
        'Choose exactly one item from the supplied real catalogue candidates. Never invent or rewrite a title or artist.',
        'Use the favorites and current mood/request as positive taste evidence.',
        'Use rejected tracks as negative taste evidence: reduce candidates with strongly similar style, mood, or character, but do not overgeneralize from one rejection.',
        'Never choose an exact rejected track, even if it appears among the candidates.',
        displayLanguage === 'fa'
          ? 'Return only JSON: {"index": number, "mood": string, "reason": string, "localizedTitle": string, "localizedArtist": string}.'
          : 'Return only JSON: {"index": number, "mood": string, "reason": string}.',
        'The reason must describe the selected song itself, not the user or their list.',
        displayLanguage === 'fa'
          ? 'For localizedTitle and localizedArtist, use only the established Persian-script song title and artist spelling when confidently known; otherwise return an empty string. Never invent or literally translate a title.'
          : 'Keep the selected song title and artist exactly as supplied in their original/Latin form.',
        lang === 'fa'
          ? 'Write mood and reason in Persian. Reason should be a short standalone two-part phrase separated by «؛».'
          : 'Write mood and reason in English, concise and natural.',
      ].join(' '),
      input: `Request: ${userText || 'Suggest one song'}\nFavorites: ${favorites.join(' | ')}\nRejected tracks: ${rejectedSuggestions.length ? rejectedSuggestions.join(' | ') : 'None'}\nCandidates:\n${list}`,
    });
    const ranked = parseRankedMusic(result.text, usable.length, displayLanguage);
    if (!ranked) return { ok: false, reason: 'invalid_ranker_output' };
    const candidate = usable[ranked.index];
    const localizedTitle = ranked.localizedTitle;
    const localizedArtist = ranked.localizedArtist;
    const cleanCandidateTitle = cleanCatalogueTitleForDisplay(candidate.title, localizedTitle);
    const displayTitle = displayLanguage === 'fa' && localizedTitle
      ? `${localizedTitle}${normalizeDisplay(localizedTitle) !== normalizeDisplay(cleanCandidateTitle) ? ` (${cleanCandidateTitle})` : ''}`
      : cleanCandidateTitle;
    return {
      ok: true,
      candidate,
      displayTitle,
      displayArtist: displayLanguage === 'fa' && localizedArtist ? localizedArtist : candidate.artist,
      mood: ranked.mood,
      reason: ranked.reason,
    };
  } catch (error) {
    logger.warn('Retrieved music ranking failed', { error: error?.message || String(error) });
    return { ok: false, reason: 'ranker_unavailable' };
  }
}

module.exports = { parseRankedMusic, rankRetrievedMusic };
