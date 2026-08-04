// Faz 3 — ID-first canonical tablolardan (architects/offices/projects/products, bkz.
// migrations/0022_id_first_entities.sql) okuma yapan route'ların ortak yardımcıları. Bu tablolardaki
// JSON kolonları (awards/cats/category/type/discipline/period/images/specs) migrate/merge
// script'leri tarafından hep `JSON.stringify` ile yazıldı (bkz. scripts/migrate-to-id-first.js#sqlJson,
// scripts/merge-submissions-to-id-first.js#sqlJson) — src/lib/submissionTypes.js#parseSubmissionRow'daki
// AYNI "arrayFields listesine göre JSON.parse et" deseninin canonical tablo karşılığı.

const JSON_FIELDS = {
  architects: ['awards'],
  offices: ['cats', 'awards'],
  projects: ['category', 'type', 'discipline', 'period', 'images'],
  products: ['images', 'specs'],
};

export function parseCanonicalRow(entityType, row) {
  if (!row) return row;
  const out = { ...row };
  for (const field of JSON_FIELDS[entityType] || []) {
    if (out[field] == null) { out[field] = entityType === 'offices' && field === 'cats' ? null : []; continue; }
    try { out[field] = JSON.parse(out[field]); }
    catch { out[field] = entityType === 'offices' && field === 'cats' ? null : []; }
  }
  return out;
}
