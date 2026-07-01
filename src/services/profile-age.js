const AGE_RANGES = Object.freeze([
  [13, 17],
  [18, 24],
  [25, 34],
  [35, 44],
  [45, 54],
  [55, 64],
  [65, 79],
]);

const MIN_PROFILE_AGE = AGE_RANGES[0][0];
const MAX_PROFILE_AGE = AGE_RANGES[AGE_RANGES.length - 1][1];

function getProfileAgeRange(startAge) {
  const normalizedStart = Number(startAge) || 0;
  return AGE_RANGES.find(([start]) => start === normalizedStart) || AGE_RANGES[0];
}

function isValidProfileAgeRangeStart(startAge) {
  return Boolean(AGE_RANGES.find(([start]) => start === Number(startAge)));
}

function isValidProfileAge(age) {
  const normalizedAge = Number(age);
  return Number.isInteger(normalizedAge) && normalizedAge >= MIN_PROFILE_AGE && normalizedAge <= MAX_PROFILE_AGE;
}

module.exports = {
  AGE_RANGES,
  MAX_PROFILE_AGE,
  MIN_PROFILE_AGE,
  getProfileAgeRange,
  isValidProfileAge,
  isValidProfileAgeRangeStart,
};
