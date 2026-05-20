const axios = require("axios");

const GEOCODE_TIMEOUT_MS = 1200;

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

    const address = response?.data?.address || {};
    return address.city || address.town || address.village || address.county || null;
  } catch {
    return null;
  }
}

module.exports = {
  resolveCityByCoordinates,
};
