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
  let prev = await env.DB.prepare(`SELECT ${cols} FROM ${table} WHERE ${where} AND id < ? ORDER BY id DESC LIMIT 1`).bind(...extraArgs, id).first();
  let next = await env.DB.prepare(`SELECT ${cols} FROM ${table} WHERE ${where} AND id > ? ORDER BY id ASC LIMIT 1`).bind(...extraArgs, id).first();
  if (!prev) prev = await env.DB.prepare(`SELECT ${cols} FROM ${table} WHERE ${where} ORDER BY id DESC LIMIT 1`).bind(...extraArgs).first();
  if (!next) next = await env.DB.prepare(`SELECT ${cols} FROM ${table} WHERE ${where} ORDER BY id ASC LIMIT 1`).bind(...extraArgs).first();
  if (prev && prev.id === id) prev = null;
  if (next && next.id === id) next = null;
  const shape = (row) => row ? { slug: row.slug, title: row[titleCol], image: imageIsJsonArray ? firstImage(row[imageCol]) : (row[imageCol] || null) } : null;
  return { prev: shape(prev), next: shape(next) };
}
