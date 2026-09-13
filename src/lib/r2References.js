// R2 NESNESİ SİLMEDEN ÖNCE "BAŞKA BİR SATIR HÂLÂ KULLANIYOR MU" KAPISI.
//
// KULLANICI BİLDİRİMİ (2026-09-13): "Ertegün Evi projesinin görselleri kırılmış, sorunu tespit et
// ve kökten düzelt." — aynı şikâyetin 2026-09-10'daki ilk turu yalnızca SEMPTOMU örtmüştü
// (js/components/broken-image-fallback.js: kırık <img> yerine baş harfli yer tutucu). Ölçülen
// durum ikisinde de aynı: D1'deki görsel YOLU duruyor, karşılık gelen R2 NESNESİ yok (/media/... ->
// 404). scripts/build-image-manifest.py dosya başı notu bunu canlıda saymıştı: 29.827 referansın
// 32'si ölü, 29'u TEK BİR projeye ait — ertegun-evi.
//
// KÖK NEDEN (bu dosyanın kapattığı boşluk): bu depoda BİR R2 NESNESİNE BİRDEN ÇOK D1 SATIRI
// REFERANS VEREBİLİR, ama silme yolları bunu HİÇ kontrol etmiyordu.
//   * "Arşivle" akışı canonical satırın alanlarını (images DAHİL, bkz. src/routes/legacyContent.js#
//     currentCanonicalProjectFields -> `images: p.images`) OLDUĞU GİBİ bir *_submissions arşiv
//     taslağına KOPYALAR. O andan itibaren AYNI R2 anahtarlarını İKİ satır gösterir.
//   * Admin panelinden o taslak satır silinince (DELETE /api/admin/submissions/:type/:id, bkz.
//     src/routes/admin.js) taslağın görselleri R2'den SİLİNİR; canonical satır ise claimed_slug'lı
//     olduğu için hayatta kalır (o akıştaki markCanonicalDeletedForSubmission claimed kayıtlarda
//     bilerek no-op'tur). Sonuç: canlı/arşivden geri alınabilir bir kayıt, artık var OLMAYAN
//     nesneleri gösteren görsel yollarıyla kalır — TAM OLARAK kullanıcının gördüğü kırık görsel.
//   * Aynı tehlike diğer yönlerde de var: bir taslağın galerisinden çıkarılan görsel canonical
//     satırda hâlâ duruyorsa (cleanupReplacedR2Media), ya da bir ürün versiyonu ile ürün galerisi
//     aynı kareyi paylaşıyorsa (bkz. canonicalSync.js#variantReferencedKeys — o korumanın YALNIZCA
//     ürün versiyonlarını kapsayan dar hâli).
// Kaybolan R2 nesnesinin geri dönüşü YOKTUR; bu yüzden doğru yer, silmenin kendisidir.
//
// KURAL: bir anahtar, BAŞKA hiçbir D1 satırından referans edilmiyorsa silinir. Şüphe varsa
// (sorgu hatası, tablo/kolon okunamadı) anahtar KORUNUR — en kötü ihtimalle bir R2 yetimi kalır,
// ki onu src/lib/r2Reconcile.js zaten raporluyor ve admin elle temizleyebiliyor. Ters yön (kırık
// görsel) geri alınamaz.
//
// ÇAĞRI SIRASI SÖZLEŞMESİ: silme yolları artık D1 satırını ÖNCE siler, R2 temizliğini SONRA yapar
// (bkz. canonicalSync.js#hardDeleteCanonicalRow, legacyContent.js/admin.js silme dalları). Aksi
// halde satır kendi anahtarlarına "hâlâ referans" gibi görünür ve hiçbir şey silinemezdi.

// Görsel/dosya yolu TAŞIYABİLEN her tablo ve kolon. src/lib/r2Reconcile.js#SOURCES ile AYNI küme
// olmalı (o, ters yönü — hiç referans edilmeyen nesneleri — tarar); ikisi ayrışırsa biri fazladan
// siler ya da fazladan korur. Buradaki fark: bu tarama kolonun HAM METNİNE bakar, bu yüzden
// products.variants gibi İÇ İÇE JSON alanları (versiyon galerileri) da kendiliğinden kapsanır.
export const MEDIA_REFERENCE_SOURCES = [
  { table: 'architects', columns: ['photo_url', 'portfolio'] },
  { table: 'offices', columns: ['logo_url', 'cover_url'] },
  { table: 'projects', columns: ['images'] },
  { table: 'products', columns: ['images', 'files', 'variants'] },
  { table: 'architect_submissions', columns: ['photo_url', 'portfolio'] },
  { table: 'office_submissions', columns: ['logo_url', 'cover_url'] },
  { table: 'project_submissions', columns: ['images', 'photoCreditUrl'] },
  { table: 'product_submissions', columns: ['images', 'files', 'variants'] },
  { table: 'material_submissions', columns: ['images', 'files', 'variants'] },
  { table: 'users', columns: ['photo_url'] },
  { table: 'gundem_items', columns: ['images', 'image_url'] },
  { table: 'office_jobs', columns: ['image_url'] },
];

// Bir anahtarın kolon metninde görünebileceği YAZILIŞLAR. D1'de aynı görsel hem göreli
// ("/media/u/../x.webp") hem mutlak ("https://mimarlab.com/media/u/../x.webp") hem de yüzde
// kodlanmış biçimde saklanabiliyor (bkz. image-cdn.js#toLocalPath ve canonicalSync.js#
// collectMediaKeysFromValue'nun decodeURIComponent'i) — kodlanmış yazılışı aramazsak boşluklu/
// Türkçe karakterli bir dosya adı "referanssız" sanılır ve SİLİNİRDİ.
function keySpellings(key) {
  const out = [key];
  try {
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    if (encoded !== key) out.push(encoded);
  } catch { /* kodlanamayan anahtar — ham hâliyle aranır */ }
  return out;
}

// PRAGMA ile GERÇEKTEN var olan kolonlar. Şema migration'larla büyüyor (ör. offices.cover_url,
// gundem_items.images) ve yerel/test şemaları prod'dan geride olabilir; var olmayan bir kolonu
// sorguya koymak TÜM taramayı hataya düşürür, o da (yukarıdaki kurala göre) hiçbir şeyin
// silinememesi demektir. İzolat ömrü boyunca bir kez okunur — şema çalışma anında değişmez.
let sourcesMemo = null;

async function resolveSources(env) {
  if (sourcesMemo) return sourcesMemo;
  const statements = MEDIA_REFERENCE_SOURCES.map(s => env.DB.prepare(`PRAGMA table_info(${s.table})`));
  let infos = null;
  try {
    infos = await env.DB.batch(statements); // tek subrequest — bkz. deleteR2MediaKeys'teki limit notu
  } catch {
    infos = [];
    for (const st of statements) {
      try { infos.push(await st.all()); } catch { infos.push(null); }
    }
  }
  // PRAGMA hiç okunamadıysa (D1 bu PRAGMA'yı reddederse / tablo yoksa) BEYAN EDİLEN kolonlara
  // düşülür: taramanın tamamen devre dışı kalması, kolon isabetsizliğinden daha kötüdür — o
  // durumda hiçbir R2 nesnesi bir daha silinemezdi. Var olmayan kolon yüzünden hata veren bir
  // ifade zaten aşağıda (findReferencedKeys) TABLO BAZINDA yakalanır ve o anahtarlar KORUNUR.
  sourcesMemo = MEDIA_REFERENCE_SOURCES.map((src, i) => {
    const rows = (infos && infos[i] && infos[i].results) || null;
    if (!rows || !rows.length) return { table: src.table, columns: src.columns };
    const have = new Set(rows.map(r => r && r.name).filter(Boolean));
    return { table: src.table, columns: src.columns.filter(c => have.has(c)) };
  }).filter(s => s.columns.length);
  return sourcesMemo;
}

// Testler için: PRAGMA memosunu sıfırla (her testin kendi şemasıyla başlaması gerekir).
export function _resetSourcesMemo() { sourcesMemo = null; }

// LIKE parametre sayısını D1'in bind sınırının (~100) altında tutan parça boyutu. Kolonlar TEK bir
// ifadede birleştirildiğinden (aşağıdaki matchExpression) parametre sayısı = anahtar_sayısı x
// yazılış_sayısı (en fazla 2) — yani 40 anahtar/parça 80 bind demektir. Kolon başına ayrı LIKE
// yazan ilk sürüm aynı iş için 4 kata kadar çok İFADE üretiyordu; tarama zaten indeks kullanmayan
// bir tam tarama olduğundan birleştirme tarama maliyetini ARTIRMAZ, yalnızca ifade sayısını azaltır.
const KEYS_PER_STATEMENT = 40;

// Kolonları tek bir metinde birleştirir — NULL'lar '' olur, aksi halde tek bir NULL kolon tüm
// ifadeyi NULL yapar ve satır HİÇ eşleşmez (yanlış negatif = nesnenin yanlışlıkla silinmesi).
function matchExpression(columns) {
  if (columns.length === 1) return `COALESCE(${columns[0]}, '')`;
  return columns.map(c => `COALESCE(${c}, '')`).join(" || '\n' || ");
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Verilen anahtarlardan HÂLÂ bir D1 satırından referans edilenlerin kümesi.
//
// İki aşama: (1) SQL LIKE ile ADAY satırlar çekilir — LIKE'ın '%' ve '_' joker karakterleri
// anahtarın içinde geçerse yalnızca FAZLA satır getirir, eksik değil; (2) dönen satırların ham
// metninde anahtar dizesi gerçekten aranır. Yanlış pozitif (fazladan "referanslı" saymak) nesneyi
// KORUR — güvenli yön; yanlış negatif mümkün değil.
export async function findReferencedKeys(env, keys) {
  const unique = [...new Set((keys || []).filter(k => typeof k === 'string' && k))];
  if (!unique.length) return new Set();
  const sources = await resolveSources(env);
  if (!sources.length) throw new Error('r2_reference_sources_unavailable');

  const statements = [];
  const plan = [];
  for (const { table, columns } of sources) {
    for (const part of chunk(unique, KEYS_PER_STATEMENT)) {
      const expr = matchExpression(columns);
      const binds = [];
      const clauses = [];
      for (const key of part) {
        for (const spelling of keySpellings(key)) {
          clauses.push(`${expr} LIKE ?`);
          binds.push(`%${spelling}%`);
        }
      }
      statements.push(env.DB.prepare(`SELECT ${columns.join(', ')} FROM ${table} WHERE ${clauses.join(' OR ')}`).bind(...binds));
      plan.push({ table, columns, part });
    }
  }

  const referenced = new Set();
  const markAll = (part) => { for (const key of part) referenced.add(key); };

  let results = null;
  try {
    // TEK subrequest: deleteR2MediaKeys, Workers'ın istek başına subrequest sınırına karşı bilerek
    // optimize edilmiş bir yolda çalışıyor (bkz. o fonksiyondaki not) — tablo başına ayrı sorgu
    // atmak o bütçeyi tüketirdi.
    results = await env.DB.batch(statements);
  } catch {
    results = [];
    for (let i = 0; i < statements.length; i++) {
      try {
        results.push(await statements[i].all());
      } catch (err) {
        // Bu tablo okunamadı (eksik tablo/kolon, geçici hata) — o parçadaki anahtarlar
        // "referanslı" sayılır, yani KORUNUR (bkz. dosya başı KURAL).
        console.error(JSON.stringify({ event: 'r2_reference_scan_table_failed', table: plan[i].table, reason: (err && err.message) || String(err) }));
        results.push(null);
        markAll(plan[i].part);
      }
    }
  }

  results.forEach((res, i) => {
    const { columns, part } = plan[i];
    for (const row of (res && res.results) || []) {
      const text = columns.map(c => (row && row[c] != null ? String(row[c]) : '')).join('\n');
      if (!text) continue;
      for (const key of part) {
        if (referenced.has(key)) continue;
        if (keySpellings(key).some(sp => text.includes(sp))) referenced.add(key);
      }
    }
  });
  return referenced;
}

// deleteR2MediaKeys'in kapısı: silinmesi GÜVENLİ olan anahtarlar. Tarama yapılamazsa BOŞ döner —
// yani hiçbir şey silinmez (bkz. dosya başı KURAL).
export async function filterUnreferencedKeys(env, keys) {
  const unique = [...new Set((keys || []).filter(k => typeof k === 'string' && k))];
  if (!unique.length) return [];
  if (!env || !env.DB) return unique; // D1 yok (ör. izole birim testi) — eski davranış
  try {
    const referenced = await findReferencedKeys(env, unique);
    const safe = unique.filter(k => !referenced.has(k));
    if (referenced.size) {
      console.log(JSON.stringify({ event: 'r2_delete_skipped_still_referenced', skipped: referenced.size, deleted: safe.length }));
    }
    return safe;
  } catch (err) {
    console.error(JSON.stringify({ event: 'r2_reference_check_failed', keyCount: unique.length, reason: (err && err.message) || String(err) }));
    return [];
  }
}
