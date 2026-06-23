const axios = require("axios");

const GEOCODE_TIMEOUT_MS = 1200;
const CITY_ADDRESS_FIELDS = [
  "city",
  "town",
  "village",
  "municipality",
  "hamlet",
  "suburb",
  "city_district",
  "district",
  "county",
  "state",
];

function firstText(...values) {
  return values
    .map((value) => String(value || "").trim())
    .find(Boolean) || null;
}

function extractCityFromReverseGeocode(data) {
  const address = data?.address || {};
  return firstText(...CITY_ADDRESS_FIELDS.map((field) => address[field]));
}

async function resolveCityByCoordinates(latitude, longitude) {
  try {
    const response = await axios.get("https://nominatim.openstreetmap.org/reverse", {
      params: {
        format: "jsonv2",
        lat: latitude,
        lon: longitude,
        "accept-language": "en",
      },
      timeout: GEOCODE_TIMEOUT_MS,
      headers: {
        "User-Agent": "DialogBot/1.0",
      },
    });

    return extractCityFromReverseGeocode(response?.data);
  } catch {
    return null;
  }
}

module.exports = {
  extractCityFromReverseGeocode,
  resolveCityByCoordinates,
};
