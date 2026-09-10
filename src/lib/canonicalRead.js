// Faz 3 — ID-first canonical tablolardan (architects/offices/projects/products, bkz.
// migrations/0022_id_first_entities.sql) okuma yapan route'ların ortak yardımcıları. Bu tablolardaki
// JSON kolonları (awards/cats/category/type/discipline/period/images/specs) migrate/merge
// script'leri tarafından hep `JSON.stringify` ile yazıldı (bkz. scripts/migrate-to-id-first.js#sqlJson,
// scripts/merge-submissions-to-id-first.js#sqlJson) — src/lib/submissionTypes.js#parseSubmissionRow'daki
// AYNI "arrayFields listesine göre JSON.parse et" deseninin canonical tablo karşılığı.

const JSON_FIELDS = {
  // portfolio — kişi pop-up'ındaki "Portfolyo" galerisi (bkz. migrations/0105_architect_portfolio.sql).
  // projects.images ile AYNI sözleşme: bozuk/boş değer [] olur, bu yüzden okuyan taraf
  // (architect-modal.js) hiçbir zaman null kontrolü yapmak zorunda kalmaz.
  architects: ['awards', 'social_links', 'portfolio'],
  offices: ['cats', 'awards', 'social_links'],
  projects: ['category', 'type', 'discipline', 'period', 'images', 'awards'],
  // variants: ürün popup'ındaki "Versiyonlar" seçici (bkz. migrations/0086_product_variants.sql).
  // Diğer üçüyle AYNI sözleşme — JSON dizi, bozuk/boş değer [] olur, bu yüzden okuyan taraf
  // (product-modal.js) hiçbir zaman null kontrolü yapmak zorunda kalmaz.
  products: ['images', 'specs', 'files', 'variants'],
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

// AYNI arama, ama VARLIK yerine canonical ADI döner (satır yoksa null).
//
// NEDEN VAR (kullanıcı isteği, 2026-09-10: "firmaya yönetici atadım ama 'Bu firma sana mı ait?'
// kutusu kaybolmadı"): profile_claims.profile_key'in tek bir kanonik biçimi YOKTU — yazan her
// çağıran kendi elindeki anahtarı koyuyordu. Kişi/firma popup'ı kutuyu `name` ile sorguluyor
// (office-modal.js#getProfileKey -> o.name), ama önizleme kartlarının sahiplenme popup'ı
// (js/components/preview-cards.js) SLUG gönderiyordu ve POST /api/claims slug'ı da kabul edip
// (canonicalRowExistsByKey name|slug|legacy_key'in ÜÇÜNÜ de eşliyor) aynen yazıyordu. Sonuç:
// canlıda "udesign-mimarlik" ve "melis-varkal" anahtarlı iki ONAYLI satır — sahibinin gerçekten
// yetkisi var ama profil adıyla yapılan HİÇBİR sorgu onları görmüyor, yani davet kutusu
// kaybolmuyor, "Düzenle" butonu çıkmıyor, rozet/JOIN'ler ıskalıyordu.
//
// Bu yüzden anahtar artık YAZARKEN kanonik ada çevrilir (bkz. src/routes/claims.js#createClaim,
// src/routes/admin.js#handleClaimsAdmin, src/lib/claimedProfiles.js#ensurePendingOfficeClaims) —
// okuyan onlarca yeri alias'a toleranslı hâle getirmek yerine, tek bir yazma biçimi zorlanır.
export async function resolveCanonicalName(env, table, key) {
  if (!env || !env.DB || !table || !key) return null;
  const row = await env.DB.prepare(
    `SELECT name FROM ${table} WHERE deleted_at IS NULL AND (name = ? OR slug = ? OR legacy_key = ?)
      ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END LIMIT 1`
  ).bind(key, key, key, key).first();
  return row?.name || null;
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
