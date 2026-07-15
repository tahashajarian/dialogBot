async function mapWithConcurrency(items = [], limit = 1, mapper) {
  if (typeof mapper !== "function") throw new TypeError("mapper must be a function");
  const values = Array.from(items || []);
  if (!values.length) return [];

  const concurrency = Math.max(1, Math.min(values.length, Math.floor(Number(limit)) || 1));
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

module.exports = { mapWithConcurrency };
