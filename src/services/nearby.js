const EARTH_RADIUS_KM = 6371.0088;

function normalizeCoordinates(value = {}) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

function buildGeoPoint(value = {}) {
  const coordinates = normalizeCoordinates(value);
  if (!coordinates) return null;
  return {
    type: "Point",
    coordinates: [coordinates.longitude, coordinates.latitude],
  };
}

function hasValidGeoPoint(point = {}) {
  return point?.type === "Point"
    && Array.isArray(point.coordinates)
    && Boolean(normalizeCoordinates({
      longitude: point.coordinates[0],
      latitude: point.coordinates[1],
    }));
}

function buildNearbyGeoQuery(point, radiusKm) {
  if (!hasValidGeoPoint(point)) return null;
  const radius = Number(radiusKm);
  if (!Number.isFinite(radius) || radius <= 0) return null;
  const strictRadiusKm = Math.max(0, radius - 1e-9);
  return {
    $geoWithin: {
      $centerSphere: [
        point.coordinates,
        strictRadiusKm / EARTH_RADIUS_KM,
      ],
    },
  };
}

function toPlainItemWithRuntimeFields(item) {
  if (typeof item?.toObject !== "function") return item;
  const plainItem = item.toObject();
  for (const key of Object.keys(item)) {
    if (key !== "_doc" && !key.startsWith("$") && !(key in plainItem)) {
      plainItem[key] = item[key];
    }
  }
  return plainItem;
}

function partitionNearby(items = [], nearbyIds = new Set(), getId = (item) => item?.userId) {
  const nearby = [];
  const others = [];
  for (const item of items || []) {
    if (nearbyIds.has(String(getId(item)))) {
      const plainItem = toPlainItemWithRuntimeFields(item);
      nearby.push({ ...plainItem, isNearby: true });
    }
    else others.push(item);
  }
  return [...nearby, ...others];
}

module.exports = {
  buildGeoPoint,
  buildNearbyGeoQuery,
  hasValidGeoPoint,
  normalizeCoordinates,
  partitionNearby,
};
