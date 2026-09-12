// Önceki/Sonraki gezinme (proje/mimar/firma/ürün detay sayfalarındaki AYNI dairesel/sıralı id
// tabanlı desen) — bu dosya src/routes/project.js#fetchAdjacentProject, architect.js#
// fetchAdjacentArchitect, office.js#fetchAdjacentOffice, product.js#fetchAdjacentProduct
// tarafından paylaşılan tek SQL/mantık kaynağıdır (denetim bulgusu, AUDIT-010, 2026-08-14): dört
// dosya da neredeyse birebir aynı 4 sorguyu (id<?/id>? + dairesel sarma fallback'i) kopyalamıştı,
// yalnızca tablo/kolon adları ve dönen şekil (prevProject/nextProject vs prevItem/nextItem)
// farklıydı — davranış BİREBİR AYNI kalır, her çağıran kendi dış şeklini kendi wrapper'ında korur.

// images (JSON dizi metni) alanından ilk görseli çıkarır — bozuk/boş JSON'da sessizce null döner.
export function firstImage(imagesJson) {
  try { const arr = imagesJson ? JSON.parse(imagesJson) : []; return arr[0] || null; } catch { return null; }
}

// table: 'projects'|'architects'|'offices'|'products' (sabit, kod içinde kontrol edilen değer —
// kullanıcı girdisinden GELMEZ, string interpolation güvenli). titleCol: name/title. imageCol:
// images (JSON dizi, imageIsJsonArray:true) | photo_url/logo_url (düz değer, imageIsJsonArray
// false/verilmemiş). extraWhere/extraBindValue: project.js'in build_status=? kısıtı gibi opsiyonel
// ek koşul + tek bind değeri (yalnızca projects kullanır, diğer üçü geçmez).
export async function fetchAdjacentEntity(env, table, id, { titleCol, imageCol, imageIsJsonArray = false, extraWhere, extraBindValue } = {}) {
  const where = `deleted_at IS NULL AND hidden_at IS NULL${extraWhere ? ` AND ${extraWhere}` : ''}`;
  const cols = `id, slug, ${titleCol}, ${imageCol}`;
  const extraArgs = extraBindValue !== undefined ? [extraBindValue] : [];
  // PARALEL (performans denetimi, 2026-09-12): prev/next birbirinden bağımsız iki sorgu ARDIŞIK
  // await ediliyordu; sarma yedekleri (ilk/son kayıt) de ayrı ayrı. Canlıda ölçüldü: detay API'nin
  // soğuk (cache MISS) yolu 0,7-2,1 sn ve maliyetin çoğu bu tür ardışık D1 gidiş-dönüşleri (PoP
  // D1'den uzaksa her biri ~100 ms+). Sorgular ve sonuçları aynen korunur, yalnızca aynı anda gider.
  let [prev, next] = await Promise.all([
    env.DB.prepare(`SELECT ${cols} FROM ${table} WHERE ${where} AND id < ? ORDER BY id DESC LIMIT 1`).bind(...extraArgs, id).first(),
    env.DB.prepare(`SELECT ${cols} FROM ${table} WHERE ${where} AND id > ? ORDER BY id ASC LIMIT 1`).bind(...extraArgs, id).first(),
  ]);
  if (!prev || !next) {
    const [wrapPrev, wrapNext] = await Promise.all([
      prev ? Promise.resolve(prev) : env.DB.prepare(`SELECT ${cols} FROM ${table} WHERE ${where} ORDER BY id DESC LIMIT 1`).bind(...extraArgs).first(),
      next ? Promise.resolve(next) : env.DB.prepare(`SELECT ${cols} FROM ${table} WHERE ${where} ORDER BY id ASC LIMIT 1`).bind(...extraArgs).first(),
    ]);
    prev = wrapPrev; next = wrapNext;
  }
  if (prev && prev.id === id) prev = null;
  if (next && next.id === id) next = null;
  const shape = (row) => row ? { slug: row.slug, title: row[titleCol], image: imageIsJsonArray ? firstImage(row[imageCol]) : (row[imageCol] || null) } : null;
  return { prev: shape(prev), next: shape(next) };
}
