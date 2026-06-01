function paginateItems(items = [], page = 0, pageSize = 5) {
  const safePageSize = Math.max(1, Number(pageSize) || 5);
  const totalPages = Math.max(1, Math.ceil((items || []).length / safePageSize));
  const normalizedPage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const start = normalizedPage * safePageSize;
  return {
    page: normalizedPage,
    totalPages,
    startIndex: start,
    items: (items || []).slice(start, start + safePageSize),
  };
}

module.exports = {
  paginateItems,
};
