// Faz 3 — ID-first canonical tablolardan (architects/offices/projects/products, bkz.
// migrations/0022_id_first_entities.sql) okuma yapan route'ların ortak yardımcıları. Bu tablolardaki
// JSON kolonları (awards/cats/category/type/discipline/period/images/specs) migrate/merge
// script'leri tarafından hep `JSON.stringify` ile yazıldı (bkz. scripts/migrate-to-id-first.js#sqlJson,
// scripts/merge-submissions-to-id-first.js#sqlJson) — src/lib/submissionTypes.js#parseSubmissionRow'daki
// AYNI "arrayFields listesine göre JSON.parse et" deseninin canonical tablo karşılığı.

const JSON_FIELDS = {
  architects: ['awards', 'social_links'],
  offices: ['cats', 'awards', 'social_links'],
  projects: ['category', 'type', 'discipline', 'period', 'images'],
  products: ['images', 'specs'],
};

// Adla/slug'la/legacy_key ile bir canonical satırın VAR OLUP OLMADIĞINI arar — src/routes/
// architect.js#findArchitect/src/routes/office.js#findOffice/src/lib/seo.js#findArchitectRow|
// findOfficeRow'daki AYNI WHERE deseninin paylaşılan karşılığı (bkz. kullanıcı isteği: Legacy
// Bundle Elimination Faz 2 — "aynı slug kontrol/doğrulama mantığını sıfırdan yazma"). Yalnızca
// varlık kontrolü gerektiren çağıranlar için (bkz. src/routes/submissions.js#
// verifyClaimedProfileKey) — tam satırı okuyan diğer çağıranlar (architect.js/office.js/seo.js)
// kendi mevcut, çalışan sorgularını korur; onlara DOKUNULMADI, bu fonksiyon yalnızca YENİ bir
// kontrol noktası için eklendi.
export async function canonicalRowExistsByKey(env, table, key) {
  if (!env || !env.DB || !table || !key) return false;
  const row = await env.DB.prepare(
    `SELECT id FROM ${table} WHERE deleted_at IS NULL AND (name = ? OR slug = ? OR legacy_key = ?) LIMIT 1`
  ).bind(key, key, key).first();
  return !!row;
}

export function parseCanonicalRow(entityType, row) {
  if (!row) return row;
  const out = { ...row };
  for (const field of JSON_FIELDS[entityType] || []) {
    if (out[field] == null) { out[field] = entityType === 'offices' && field === 'cats' ? null : []; continue; }
    try { out[field] = JSON.parse(out[field]); }
    catch { out[field] = entityType === 'offices' && field === 'cats' ? null : []; }
  }
  // offices.yil bir TEXT kolon — bazı eski veri aktarımları ondalıklı geldi (ör. "1978.0", bkz.
  // gerçek bulgu: BİRİM Design detay sayfasında Kuruluş Yılı "1978.0" görünüyordu). Tüm okuma
  // yolları (office.js/architect.js/legacyContent.js) bu fonksiyondan geçtiğinden, tek noktadan
  // tamsayıya normalize edilir — ekranda/formlarda bir daha ".0" görünmez.
  if (entityType === 'offices' && out.yil != null) {
    const n = parseInt(out.yil, 10);
    if (!Number.isNaN(n)) out.yil = n;
  }
  return out;
}
