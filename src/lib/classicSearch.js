// MİMARLAB klasik (anahtar kelime) arama — TEK getirme + TEK sıralama, iki tüketici.
//
// NEDEN BU DOSYA VAR (arama denetimi, 2026-09-07 — üretim uçlarıyla ölçüldü):
//   * Üst navigasyondaki öneri penceresi (/api/public/search-suggest) ile /arama sayfası
//     (/api/public/search + /api/products?search + /api/offices?search ×2) DÖRT ayrı eşleştirme
//     koduyla çalışıyordu. Aynı sorgu için pencere "Galata Apartmanı"nı, sayfa "Galatasaray
//     Lisesi"ni ilk sıraya koyuyordu; pencere "cami" için "21 sonuç" derken sayfa 70 buluyordu.
//   * Hiçbir yolda SIRALAMA yoktu: eşleşenler veritabanı sırasıyla (id) geliyordu. "galata" için
//     tam kelime eşleşen "Galata Kulesi", önek eşleşen "Galatasaray Lisesi"nin arkasında kalıyordu.
//   * Eşleştirme düz alt-dizeydi: "taş cephe" ("tas cephe") yalnızca "…Cephe Tasarımı"nı buluyordu
//     ("tas" ⊂ "tasarımı"), "ofis" sorgusu ofisinin adında "Ofisi" geçen 25 KİŞİYİ listeliyordu.
//
// ARTIK: bu modül her varlık türü için (a) SQLite'ta katlanmış kolonlar üzerinde sınırlı bir ADAY
// getirme (bkz. src/lib/searchFold.js — indexli önek + substring, en fazla RETRIEVAL_LIMIT satır,
// kısa ad önce), (b) JS'te KELİME TABANLI, kademeli bir skorlama yapar. Öneri penceresi ile tam
// sayfa AYNI listeyi paylaşır — pencere ilk 3'ü, sayfa ilk 20'yi gösterir, ikisi de aynı gerçek
// toplamı söyler. Skorlama deterministiktir (aynı sorgu → aynı sıra) ve bir sonucun neden üstte
// olduğu `score` alanından okunabilir.
//
// KADEME (kelime başına): tam kelime 3 > kök eşleşmesi 2,6 ("ofisi"~"ofis", "koltuğu"~"koltuk")
// > önek 2 ("gal" → "Galata", otomatik tamamlama için şart) > kelime içi 1 (yalnızca 4+ harfli
// sorgu kelimelerinde; "tas" ⊂ "tasarım" artık eşleşmez). Bir alan ANCAK sorgunun TÜM kelimeleri
// eşleşiyorsa aday olur. Alan düzeyinde: sorguya birebir eşit +6, sorguyla başlıyor +3, sorgu
// ifadesini kelime sınırında içeriyor +2. Kişi/proje/ürün ADI, konum/kategori/künye gibi ikincil
// alanlardan daha ağırdır (bkz. FIELD_WEIGHTS) — "ofis" sorgusu ofisinin adında "Ofisi" geçen
// kişileri hâlâ bulur ama adında "Ofis" geçen firmaların ARKASINA koyar.
//
// LLM/embedding YOK — bu, /api/ai/search'ün (src/lib/searchEngine.js) yanında yaşayan, ucuz ve
// öngörülebilir klasik kanaldır; arama.html ikisini birleştirir.

import { foldTr } from './textMatch.js';
import { foldSqlExpr, stripPunctSqlExpr, foldAccentsSqlExpr, foldAccents, escapeLike, SQL_MAX_WORDS } from './searchFold.js';
import { stemTr, hardenFinal, phraseInHay } from './searchConcepts.js';
import { fetchOfficeProductCounts } from './officeProductCounts.js';
import { normalizeOfficeCats, officePath } from './officeUrl.js';
import officeKindJs from '../../office-kind.js';

const { isBrandOffice, isPureBrandOffice } = officeKindJs;

// Grup başına D1'den çekilecek EN FAZLA aday. Kısa adlar önce çekildiğinden (ORDER BY length),
// sınır aşıldığında düşenler en uzun (dolayısıyla en az "tam eşleşme" olası) adlardır. Eşleşme
// sayısı bu sınırın altındaysa toplam KESİNDİR; üstündeyse `capped` bayrağı döner ve arayüz
// "400+" der — uydurma bir sayı değil.
export const RETRIEVAL_LIMIT = 400;

const FIELD_WEIGHTS = { primary: 1.0, secondary: 0.8, tertiary: 0.55 };

// Klasik aramanın metin normalizasyonu = foldTr + aksan katlama (bkz. searchFold.js#foldAccents'in
// üstündeki gerekçe, kullanıcı isteği 2026-09-08 madde 2). foldTr'nin KENDİSİ değiştirilmedi:
// birkaç uç onu generated fold kolonlarıyla EŞİTLİK ile karşılaştırıyor ve o eşitlikler bozulurdu.
// Sorgu ve belge tarafı BU fonksiyondan geçer, SQL aday koşulu da (likeCondition) kolonu aynı
// katlamadan geçirir — üç taraf birlikte değişmeli.
function foldSearch(s) {
  return foldAccents(foldTr(s || ''));
}

function tokensOf(folded) {
  return folded.split(/[^a-z0-9]+/).filter(Boolean);
}

// Ardışık TEK HARFLİK token dizilerini tek bir token'a birleştirir: ["r","a","f","studio"] ->
// ["raf","studio"]. Noktalı/ayrık yazılan kısaltmaların ("R.A.F.", "A&B", "S.O.M.") bitişik
// yazılışıyla AYNI biçime inmesini sağlar; sorgu VE belge tarafında AYNI şekilde uygulandığından
// hangi tarafın noktalı yazıldığı fark etmez. En az İKİ harf gerekir — tek bir baş harf ("M. Ali")
// bir kısaltma değildir, olduğu gibi bırakılır ve önek eşleşmesiyle ("m" -> "Mehmet") çalışır.
function mergeInitials(toks) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2) out.push(run.join(''));
    else out.push(...run);
    run = [];
  };
  for (const t of toks) {
    if (t.length === 1) { run.push(t); continue; }
    flush();
    out.push(t);
  }
  flush();
  return out;
}

// Tek bir sorgu kelimesinin bir alanın kelimeleriyle en iyi eşleşme kademesi (0 = eşleşmiyor).
function wordGrade(word, toks) {
  let best = 0;
  const st = stemTr(word);
  const hd = hardenFinal(st);
  for (const w of toks) {
    if (w === word) return 3;
    if (best < 2.6) {
      if (w === st || w === hd) { best = 2.6; continue; }
      if (w.length >= 4 && w.length <= word.length + 6) {
        const sw = stemTr(w);
        if (sw === word || sw === st || hardenFinal(sw) === hd) { best = 2.6; continue; }
      }
    }
    if (best < 2 && w.startsWith(word)) { best = 2; continue; }
    if (best < 1 && word.length >= 4 && w.includes(word)) best = 1;
  }
  return best;
}

// Bir alanın sorguya puanı; sorgunun herhangi bir kelimesi eşleşmiyorsa null (alan aday DEĞİL).
export function fieldScore(text, words) {
  const folded = foldSearch(text).trim();
  if (!folded || !words.length) return null;
  const rawToks = tokensOf(folded);
  const merged = mergeInitials(rawToks);
  // Eşleştirme token'ları HER İKİ biçimi de taşır: ham ("r","a","f") ve birleştirilmiş ("raf").
  // Böylece "r.a.f. studio" da "raf studio" da aynı kaydı bulur — sorgu hangi biçimde yazılırsa
  // yazılsın (queryWords birleştirilmiş biçimi üretir, ham biçim eski davranışı korur).
  const toks = merged.length === rawToks.length ? rawToks : [...rawToks, ...merged];
  let sum = 0;
  for (const w of words) {
    const g = wordGrade(w, toks);
    if (!g) return null;
    sum += g;
  }
  let score = sum / words.length;
  // İfade (tam eşleşme/önek) karşılaştırması ham `folded` üzerinde DEĞİL, token'lara ayrılıp tek
  // boşlukla birleştirilmiş biçim üzerinde yapılır — aksi halde queryWords artık noktalamayı attığı
  // için "r a f studio" hiçbir zaman "r.a.f. studio"ya eşit/önek sayılmaz ve tam ad eşleşmesi
  // (+6/+3) kaybolurdu. Alfabetik-boşluklu sıradan adlarda iki biçim ZATEN aynıdır.
  const norm = merged.join(' ');
  const phrase = words.join(' ');
  if (norm === phrase) score += 6;
  else if (norm.startsWith(phrase)) score += 3;
  else if (phraseInHay(norm, phrase)) score += 2;
  // Aynı kademede daha KISA alan önce: "Galata Kulesi" (13) "Galatasaray Üniversitesi (Ortaköy
  // Yerleşkesi)"nden (44) önce. Küçük bir ek, kademeyi asla geçmez.
  score += Math.max(0, 1 - folded.length / 80) * 0.5;
  return score;
}

// rows: D1 satırları; fields: [{ get: row => metin, weight }]. Sorgunun tüm kelimelerini EN AZ BİR
// alanda taşıyan satırlar, en iyi alan puanı × alan ağırlığıyla sıralanır.
export function rankRows(rows, fields, words, nameOf) {
  const out = [];
  for (const row of rows) {
    let best = 0;
    for (const f of fields) {
      const s = fieldScore(f.get(row), words);
      if (s != null && s * f.weight > best) best = s * f.weight;
    }
    if (best > 0) out.push({ row, score: best });
  }
  out.sort((a, b) => (b.score - a.score) || String(nameOf(a.row) || '').localeCompare(String(nameOf(b.row) || ''), 'tr'));
  return out;
}

// GERÇEK BULGU (kullanıcı isteği, 2026-09-08 madde 4): sorgu kelimeleri BOŞLUKLA, alan kelimeleri
// ise tokensOf ile HARF/RAKAM DIŞI HER ŞEYLE bölünüyordu — iki taraf farklı alfabede konuşuyordu.
// "r.a.f. studio" sorgusu ["r.a.f.", "studio"] üretiyor, "R.A.F. Studio" adı ise ["r","a","f",
// "studio"] token'larına ayrılıyordu; "r.a.f." hiçbir token'a eşit/önek/alt-dize olmadığı için
// wordGrade 0 dönüyor, fieldScore null veriyor ve firma aramada HİÇ çıkmıyordu (SQL adayı doğru
// geliyordu — kayıp tamamen JS skorlamasındaydı). Kök çözüm: sorgu da BİREBİR tokensOf ile
// bölünür, böylece nokta/kesme/tire/& içeren her ad ("R.A.F.", "St. Regis", "M. Ali", "A&B")
// kendiliğinden eşleşir. Tek yönlü bir GENİŞLEME değildir: tek harflik parçalar (r/a/f) yalnızca
// tam token eşleşmesi ya da token öneki olarak sayıldığından yanlış pozitif üretmez.
export function queryWords(rawQ) {
  return mergeInitials(tokensOf(foldSearch(String(rawQ || ''))));
}

// SQL aday koşulu: verilen katlanmış alanlardan HERHANGİ BİRİ sorgunun TÜM kelimelerini alt-dize
// olarak içeriyor. Bu, JS skorlamasının kabul edebileceği her satırı kapsayan (yanlış negatifi
// olmayan) bir ÜST KÜMEDİR: JS'in "tam kelime/kök/önek/kelime içi" kademelerinin hepsi bir alt-dize
// eşleşmesini gerektirir. Tek istisna Türkçe kök eşleşmesi ("koltuğu" → "koltuk"): sorgu kelimesi
// belge kelimesinden UZUN olabilir; bunun için sorgunun kökü de OR'a eklenir.
// NOKTALAMA: her kolon stripPunctSqlExpr ile sarmalanır (bkz. o fonksiyonun gerekçesi) — sorgu
// kelimeleri queryWords'ten zaten yalnızca harf/rakam olarak geldiğinden iki taraf aynı alfabede
// karşılaşır ve "raf" sorgusu "R.A.F. Studio" adını ADAY olarak getirebilir. Ek bir OR dalı DEĞİL,
// kolonun kendisi dönüştürülür: OR dalı terim sayısını ikiye katlayıp D1'in ifade-ağacı derinlik
// sınırına (bkz. proje notu) yaklaştırırdı, oysa bu biçim aday kümesinin ÜST KÜME olma garantisini
// bozmadan terim sayısını AYNI bırakır.
function likeCondition(columns, words) {
  const variants = words.slice(0, SQL_MAX_WORDS).map(w => {
    const st = hardenFinal(stemTr(w));
    return (st !== w && st.length >= 3) ? [w, st] : [w];
  });
  const params = [];
  const cond = columns.map(rawCol => {
    const col = foldAccentsSqlExpr(stripPunctSqlExpr(rawCol));
    return `(${variants.map(vs => `(${vs.map(v => { params.push(`%${escapeLike(v)}%`); return `${col} LIKE ? ESCAPE '\\'`; }).join(' OR ')})`).join(' AND ')})`;
  }).join(' OR ');
  return { cond: `(${cond})`, params };
}

async function all(env, sql, params) {
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return results;
}

function firstImage(raw) {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return (Array.isArray(arr) && typeof arr[0] === 'string' && arr[0]) ? arr[0] : null;
  } catch { return null; }
}

// Yalnızca GÖSTERİLECEK satırların görselleri çekilir (aday satırlarının tamamı için images JSON'u
// taşımak, öneri penceresinin eski "her tuş vuruşunda 1.804 JSON" maliyetini geri getirirdi).
async function imagesById(env, table, ids) {
  if (!ids.length) return new Map();
  const rows = await all(env, `SELECT id, images FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  return new Map(rows.map(r => [r.id, firstImage(r.images)]));
}

/**
 * classicSearch — dört varlık türünde sıralı klasik arama.
 * @returns {{ architects, offices, projects, products, totals, capped }} — her grup en fazla
 *   perGroup öğe; totals gerçek eşleşme sayısı (capped[grup] true ise en az bu kadar).
 */
export async function classicSearch(env, rawQ, { perGroup = 20 } = {}) {
  const words = queryWords(rawQ);
  const empty = { architects: [], offices: [], projects: [], products: [], totals: { architects: 0, offices: 0, projects: 0, products: 0 }, capped: {} };
  if (!words.length) return empty;

  const archCond = likeCondition(['a.name_fold', foldSqlExpr('o.name')], words);
  const officeCond = likeCondition(['o.name_fold', foldSqlExpr('o.loc')], words);
  const projCond = likeCondition(['p.title_fold', foldSqlExpr('p.location'), foldSqlExpr('designer_names')], words);
  const prodCond = likeCondition(['title_fold', 'brand_fold', foldSqlExpr('category')], words);

  const [archRows, officeRows, projRows, prodRows, productCounts] = await Promise.all([
    all(env,
      `SELECT a.id, a.slug, a.name, a.photo_url, o.name AS office_name
         FROM architects a LEFT JOIN offices o ON o.id = a.office_id AND o.deleted_at IS NULL
        WHERE a.deleted_at IS NULL AND a.hidden_at IS NULL AND ${archCond.cond}
        ORDER BY length(a.name) ASC LIMIT ${RETRIEVAL_LIMIT}`, archCond.params),
    all(env,
      `SELECT o.id, o.slug, o.name, o.loc, o.cats, o.logo_url
         FROM offices o
        WHERE o.deleted_at IS NULL AND o.hidden_at IS NULL AND ${officeCond.cond}
        ORDER BY length(o.name) ASC LIMIT ${RETRIEVAL_LIMIT}`, officeCond.params),
    // Künye (designer_names) GROUP_CONCAT olduğundan koşul HAVING'de — SQLite HAVING'de toplu
    // olmayan kolonlara da izin verir (bkz. legacyContent.js#handlePublicSearchFull'un eski sorgusu).
    all(env,
      `SELECT p.id, p.slug, p.title, p.location, p.project_date,
              GROUP_CONCAT(COALESCE(ar.name, ofc.name), '') AS designer_names
         FROM projects p
         LEFT JOIN project_designers pd ON pd.project_id = p.id
         LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL
         LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
        WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL
        GROUP BY p.id
       HAVING ${projCond.cond}
        ORDER BY length(p.title) ASC LIMIT ${RETRIEVAL_LIMIT}`, projCond.params),
    all(env,
      `SELECT id, slug, title, category, brand_name_raw
         FROM products
        WHERE deleted_at IS NULL AND hidden_at IS NULL AND ${prodCond.cond}
        ORDER BY length(title) ASC LIMIT ${RETRIEVAL_LIMIT}`, prodCond.params),
    fetchOfficeProductCounts(env),
  ]);

  const W = FIELD_WEIGHTS;
  const ranked = {
    architects: rankRows(archRows, [
      { get: r => r.name, weight: W.primary },
      { get: r => r.office_name, weight: W.tertiary },
    ], words, r => r.name),
    offices: rankRows(officeRows, [
      { get: r => r.name, weight: W.primary },
      { get: r => r.loc, weight: W.tertiary },
    ], words, r => r.name),
    projects: rankRows(projRows, [
      { get: r => r.title, weight: W.primary },
      { get: r => r.designer_names, weight: W.secondary },
      { get: r => r.location, weight: W.tertiary },
    ], words, r => r.title),
    products: rankRows(prodRows, [
      { get: r => r.title, weight: W.primary },
      { get: r => r.brand_name_raw, weight: W.secondary },
      { get: r => r.category, weight: W.tertiary },
    ], words, r => r.title),
  };

  const topProjects = ranked.projects.slice(0, perGroup);
  const topProducts = ranked.products.slice(0, perGroup);
  const [projImages, prodImages] = await Promise.all([
    imagesById(env, 'projects', topProjects.map(r => r.row.id)),
    imagesById(env, 'products', topProducts.map(r => r.row.id)),
  ]);

  const capped = {};
  for (const k of ['architects', 'offices', 'projects', 'products']) {
    const fetched = { architects: archRows, offices: officeRows, projects: projRows, products: prodRows }[k].length;
    if (fetched >= RETRIEVAL_LIMIT) capped[k] = true;
  }

  return {
    architects: ranked.architects.slice(0, perGroup).map(({ row: a, score }) => ({
      slug: a.slug, name: a.name, photo: a.photo_url, office: a.office_name || null, score: Number(score.toFixed(2)),
    })),
    offices: ranked.offices.slice(0, perGroup).map(({ row: o, score }) => {
      const cats = normalizeOfficeCats(o.cats);
      const count = productCounts.get(o.id) || 0;
      return {
        slug: o.slug, name: o.name, loc: o.loc, logo: o.logo_url, score: Number(score.toFixed(2)),
        // brand: MARKA bölümünde listelenir; pureBrand: yalnızca marka (FİRMA bölümünden düşer ve
        // kanonik adresi /marka/:slug) — bkz. office-kind.js / src/lib/officeUrl.js.
        brand: isBrandOffice(cats, count), pureBrand: isPureBrandOffice(cats, count),
        href: officePath(o.slug, cats, count),
      };
    }),
    projects: topProjects.map(({ row: p, score }) => ({
      slug: p.slug, title: p.title, location: p.location, date: p.project_date,
      image: projImages.get(p.id) || null, score: Number(score.toFixed(2)),
    })),
    products: topProducts.map(({ row: p, score }) => ({
      slug: p.slug, title: p.title, brand: p.brand_name_raw, category: p.category,
      image: prodImages.get(p.id) || null, score: Number(score.toFixed(2)),
    })),
    totals: {
      architects: ranked.architects.length, offices: ranked.offices.length,
      projects: ranked.projects.length, products: ranked.products.length,
    },
    capped,
  };
}
