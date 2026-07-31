const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseItunesSong, verifyItunesSuggestion } = require('../src/services/itunes-suggestion-verifier');

test('iTunes verifier accepts a real title and artist pair', async () => {
  const result = await verifyItunesSuggestion(
    { title: 'Eshgh-e Sorat', metadata: 'Artist: Kiosk' },
    { fetchImpl: async () => ({ ok: true, json: async () => ({ results: [
      { wrapperType: 'track', kind: 'song', trackName: 'Eshgh e Sorat', artistName: 'Kiosk' },
    ] }) }) },
  );
  assert.equal(result.ok, true);
});

test('iTunes verifier rejects a title paired with the wrong artist', async () => {
  const result = await verifyItunesSuggestion(
    { title: 'Eshgh-e Sorat', metadata: 'Artist: Ebi' },
    { fetchImpl: async () => ({ ok: true, json: async () => ({ results: [
      { wrapperType: 'track', kind: 'song', trackName: 'Eshgh e Sorat', artistName: 'Kiosk' },
    ] }) }) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.qualityIssue, 'catalog_title_creator_mismatch');
});

test('iTunes matching ignores punctuation but not unrelated names', () => {
  const results = [{ wrapperType: 'track', kind: 'song', trackName: 'Eshgh e Sorat', artistName: 'Kiosk' }];
  assert.ok(chooseItunesSong(results, "Eshgh-e Sorat", 'Kiosk'));
  assert.equal(chooseItunesSong(results, 'Begoo Bargard', 'Ebi'), null);
});
