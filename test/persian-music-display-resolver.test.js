const test = require("node:test");
const assert = require("node:assert/strict");

const { parsePersianMusicDisplay } = require("../src/services/persian-music-display-resolver");

test("Persian music display resolver accepts only complete Persian-script fields", () => {
  assert.deepEqual(parsePersianMusicDisplay('{"localizedTitle":"من و بارون","localizedArtist":"بابک جهانبخش"}'), {
    localizedTitle: "من و بارون",
    localizedArtist: "بابک جهانبخش",
  });
  assert.deepEqual(parsePersianMusicDisplay('{"localizedTitle":"Mano Baroon","localizedArtist":"Babak"}'), {
    localizedTitle: "",
    localizedArtist: "",
  });
});
