const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseDeezerTrack, verifyDeezerSuggestion } = require('../src/services/deezer-suggestion-verifier');

test('Deezer verifier accepts exact title and artist', async () => {
  const result = await verifyDeezerSuggestion(
    { title: 'Eshgh e Sorat', metadata: 'Artist: Kiosk' },
    { fetchImpl: async () => ({ ok: true, json: async () => ({ data: [
      { title_short: 'Eshgh e Sorat', artist: { name: 'Kiosk' } },
    ] }) }) },
  );
  assert.equal(result.ok, true);
});

test('Deezer verifier rejects wrong artist pairing', () => {
  const match = chooseDeezerTrack([
    { title_short: 'Faseleha', artist: { name: 'Another Artist' } },
  ], 'Faseleha', 'Ehsan Khajeh Amiri');
  assert.equal(match, null);
});
