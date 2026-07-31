function normalizeDisplay(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '');
}

function hasPersianScript(value) {
  return /[\u0600-\u06FF]/.test(String(value || ''));
}

function cleanCatalogueTitleForDisplay(value, localizedTitle = '') {
  let title = String(value || '').trim();
  if (!title) return '';

  title = title.replace(/\s*[-–—]\s*(?:single|ep|album)\s*$/i, '').trim();

  title = title.replace(/\s*\(([^()]*)\)\s*/g, (match, inner) => {
    const normalizedInner = normalizeDisplay(inner);
    const normalizedLocalized = normalizeDisplay(localizedTitle);
    if (hasPersianScript(inner) || (normalizedLocalized && normalizedInner === normalizedLocalized)) return ' ';
    return ` (${String(inner).trim()}) `;
  });

  return title.replace(/\s{2,}/g, ' ').replace(/\s+([)])/g, '$1').trim();
}

module.exports = { cleanCatalogueTitleForDisplay, hasPersianScript, normalizeDisplay };
