const test = require('node:test');
const assert = require('node:assert/strict');
const { uniqueCandidates } = require('../src/services/music-candidate-retriever');
const { parseRankedMusic } = require('../src/services/ai-music-retrieval-ranker');
const { cleanCatalogueTitleForDisplay } = require('../src/services/music-display');

test('retrieved music candidates are deduplicated by title and artist', () => {
  const result = uniqueCandidates([
    { title: 'Eshgh e Sorat', artist: 'Kiosk' },
    { title: 'Eshgh-e Sorat', artist: 'Kiosk' },
    { title: 'Yarom Bia', artist: 'Kiosk' },
  ]);
  assert.equal(result.length, 2);
});

test('music ranker can only select an existing candidate', () => {
  assert.deepEqual(parseRankedMusic('{"index":2,"mood":"گرم","reason":"ریتم روان؛ گرم و صمیمی.","localizedTitle":"عشق سرعت","localizedArtist":"کیوسک"}', 3, 'fa'), {
    index: 1,
    mood: 'گرم',
    reason: 'ریتم روان؛ گرم و صمیمی.',
  });
  assert.deepEqual(parseRankedMusic('{"index":1,"mood":"warm","reason":"clear","localizedTitle":"عشق سرعت","localizedArtist":"کیوسک"}', 3, 'en'), {
    index: 0,
    mood: 'warm',
    reason: 'clear',
  });
  assert.equal(parseRankedMusic('{"index":5,"mood":"x","reason":"y"}', 3), null);
});


test('music display removes duplicated Persian title and release metadata', () => {
  assert.equal(
    cleanCatalogueTitleForDisplay('Bezar To Hale Khodam Basham ( بذار تو حال خودم باشم ) - Single', 'بذار تو حال خودم باشم'),
    'Bezar To Hale Khodam Basham',
  );
  assert.equal(cleanCatalogueTitleForDisplay('Stalker - Single', ''), 'Stalker');
});
