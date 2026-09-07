// OFİS BAŞINA ÜRÜN SAYISI — tek, paylaşılan ve İNDEKSLENEBİLİR hesaplama.
//
// =============================================================================================
// NEDEN AYRI BİR MODÜL (production denetimi, 2026-09-07)
// =============================================================================================
// Bu sayaç iki AYRI sıcak yolda gerekiyor ve ikisinde de AYNI kuralı uygulamak ZORUNDA:
//   * src/routes/office.js#fetchOfficePool  — /api/offices havuzu, dolayısıyla /firma ve /marka
//     listeleri (`?brands=1` filtresinin TEK kaynağı).
//   * src/index.js#listCanonicalEntityUrls  — sitemap; saf markalar /marka/:slug altında yaşadığı
//     için kanonik URL öneki (bkz. src/lib/officeUrl.js#officePath) bu sayaca bağlı.
// İki yerde de ELLE yazılmış, birebir aynı alt sorgu duruyordu; biri değişirse sitemap ile
// listedeki URL öneki sessizce ayrışırdı. Artık tek kaynak burası.
//
// =============================================================================================
// NEDEN "her ofis için bir alt sorgu" DEĞİL (ölçülmüş)
// =============================================================================================
// Eski biçim her iki yolda da şuydu:
//     (SELECT COUNT(*) FROM products pr WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL
//        AND (pr.brand_office_id = o.id OR pr.brand_name_raw = o.name COLLATE NOCASE))
// `OR`'un iki tarafı FARKLI kolonlara baktığından SQLite hiçbir index kullanamıyor; EXPLAIN QUERY
// PLAN "CORRELATED SCALAR SUBQUERY / SCAN pr" diyor — yani products tablosunun TAMAMI, ofis
// BAŞINA bir kez taranıyor. Canlı D1'de ölçüldü (2026-09-07, 793 ofis / 758 ürün):
//     havuz sorgusu (eski hâli)            : 606.751 satır okundu, 1.900 ms
//     aynı sorgu bu alt sorgu ÇIKARILINCA  :   8.829 satır okundu,    31 ms
//     bu modüldeki tek toplu sorgu         :   5.294 satır okundu,     7 ms
// Yani sayaç, ofis havuzunun D1 maliyetinin ~%98'ini tek başına üretiyordu.
//
// =============================================================================================
// EŞDEĞERLİK — DAVRANIŞ DEĞİŞMEZ
// =============================================================================================
// UNION iki dalı da (id eşleşmesi / ad eşleşmesi) (ürün, ofis) çifti düzeyinde TEKİLLEŞTİRİR, bu
// yüzden grup başına COUNT(*) eski `COUNT(*) ... WHERE (A OR B)` ile matematiksel olarak aynıdır —
// iki koşulu birden sağlayan ürün iki kez sayılmaz. Ad karşılaştırması SQL'de KALIR (COLLATE
// NOCASE): JS'e taşımak, src/routes/office.js dosya başındaki uyarının anlattığı sessiz sapmayı
// (SQLite NOCASE yalnızca ASCII katlar, JS'in Türkçe küçültmesi farklı davranır) geri getirirdi.
//
// PARİTE CANLI VERİYLE DOĞRULANDI (2026-09-07): eski alt sorgu ile bu toplu sorgunun çıktısı 793
// ofisin TAMAMINDA birebir eşleşti (0 fark; sayacı sıfırdan farklı olan 29 ofis dahil).

/**
 * Ofis id -> ürün sayısı eşlemesi döner. Sayacı 0 olan ofisler haritada YOKTUR — çağıran taraf
 * `map.get(id) || 0` ile okumalıdır (eski alt sorgu 0 döndürüyordu, davranış aynıdır).
 */
export async function fetchOfficeProductCounts(env) {
  const { results } = await env.DB.prepare(
    `SELECT office_id, COUNT(*) AS product_count FROM (
       SELECT pr.id AS product_id, pr.brand_office_id AS office_id
         FROM products pr
        WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL AND pr.brand_office_id IS NOT NULL
       UNION
       SELECT pr.id, o.id
         FROM products pr JOIN offices o ON o.name = pr.brand_name_raw COLLATE NOCASE
        WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL
     ) GROUP BY office_id`
  ).all();
  const map = new Map();
  for (const row of results || []) {
    if (row.office_id == null) continue;
    map.set(row.office_id, row.product_count || 0);
  }
  return map;
}
