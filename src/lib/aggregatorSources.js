// YAYIN/AGREGATÖR KAYNAK BAĞLANTILARI — proje künyesindeki "Kaynak" alanında görünmesi YASAK olan
// adresler tek yerden burada tanımlanır.
//
// KULLANICI İSTEĞİ (2026-09-14): "Hiçbir projenin kaynak kısmında arkitera, archello, archdaily,
// divisare gibi linkler olmasın. Bu linkler varsa bunları sil ve mimarlık firmalarının
// websitelerinin linklerini koy. Websiteleri yoksa da boş bırak. Zaten kişi veya firma kaydı olan
// bir fotoğrafçı varsa link girme."
//
// NEDEN: künyedeki "Kaynak", profili OLMAYAN fotoğrafçı/kaynak adını tıklanabilir yapan TEK
// bağlantıdır (bkz. js/components/project-meta.js#photographerChipList ve src/lib/seo.js#
// fetchProjectPhotographers). O bağlantı MİMARLAB'ın kendi içeriğini bir yayın/agregatör sitesine
// çıkartıyordu — projenin gerçek sahibi olan mimarlık firmasına değil. Kullanıcının kuralı: o
// alanda ya projeyi yapan firmanın KENDİ sitesi durur, ya da hiçbir şey durmaz.
//
// ÜÇ YERDE KULLANILIR (üçü de aynı listeyi okur, ikinci bir kopya YOK):
//   1. YAZMA KAPISI — src/lib/canonicalSync.js#syncProject: böyle bir adres projects tablosuna
//      (photo_credit_url / source_url) HİÇ yazılmaz, yani temizlik bir daha bozulmaz.
//   2. OKUMA KAPISI — src/routes/project.js, src/lib/seo.js, src/lib/projectPool.js: D1'de kalmış
//      eski bir değer künyede bağlantıya DÖNÜŞMEZ (temizlik betiği çalışmadan önce de site doğru).
//   3. TEMİZLİK — scripts/purge-aggregator-project-sources.mjs: D1'deki mevcut satırları tarar,
//      firmanın websitesiyle DEĞİŞTİRİR ya da boşaltır.
//
// İSTEMCİ KOPYASI: js/components/project-meta.js#isAggregatorSourceUrl (o dosya klasik bir
// <script>, ES modülü değil — import edemez). Marka listesi iki dosyada da AYNI olmalı; biri
// değişirse diğeri de güncellenmeli (scripts/test-2026-09-14-aggregator-source-links.mjs iki
// listeyi karşılaştırır ve ayrışırsa preflight'ı kırar).

// Eşleşme ALAN ADI ETİKETİ üzerinden yapılır, tam alan adı listesi üzerinden DEĞİL: aynı yayının
// onlarca yerel alan adı var (archdaily.com, archdaily.com.tr, archdaily.com.br, archdaily.mx,
// plataformaarquitectura.cl ...) ve hepsini tek tek saymak listeyi ilk yeni alan adında eskitirdi.
// "www.archdaily.com.tr" -> etiketler [www, archdaily, com, tr]; etiketlerden biri bu kümedeyse
// satır bir yayın/agregatör adresidir. Etiket TAM eşleşir (içerik araması değil), yani
// "divisare-mimarlik.com" gibi gerçek bir firma alan adı yanlışlıkla yakalanmaz.
//
// Kullanıcının saydığı dört marka (arkitera, archello, archdaily, divisare) + "gibi" dediği aynı
// türden yayınlar. Gündem tarafında zaten tanınan yayıncılar da buradadır (bkz.
// src/lib/gundemSources.js) — bir haber kaynağı, bir projenin künyesinde "kaynak" olarak
// durmamalıdır; orası projenin sahibinin adresi içindir.
export const AGGREGATOR_SOURCE_BRANDS = [
  // Kullanıcının adıyla saydıkları
  'arkitera', 'archello', 'archdaily', 'divisare',
  // ArchDaily / Divisare'in diğer marka adları
  'plataformaarquitectura', 'europaconcorsi',
  // Türkiye'deki aynı türden yayınlar
  'arkiv', 'arkitektuel', 'mimarizm', 'mimdap', 'bigumigu', 'mimarlikdergisi', 'xxi', 'yapi',
  // Uluslararası aynı türden yayınlar
  'dezeen', 'designboom', 'architizer', 'archilovers', 'archiproducts', 'archpaper',
  'architectural-review', 'architectsjournal', 'worldarchitecture', 'metalocus', 'floornature',
  'arch2o', 'archeyes',
];

const BRAND_SET = new Set(AGGREGATOR_SOURCE_BRANDS);

// Ham (şemasız olabilen) bir değerden alan adını çıkarır. externalHttpUrl ile AYNI hoşgörü:
// "archello.com/project/x" da "https://www.archello.com/project/x" kadar geçerli bir agregatör
// adresidir — D1'de ikisi de duruyor (bkz. src/lib/externalUrl.js'teki "şemasız saklanmış değer"
// notu). Burada externalUrl.js'i İMPORT ETMİYORUZ: bu modül istemci kopyasıyla birlikte
// kendi kendine yeten tek bir kural olarak kalsın diye alan adı doğrudan okunur.
function hostOf(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  let candidate = raw;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    // Şemalı: yalnızca http(s) anlamlıdır (javascript:/mailto: zaten bağlantıya dönüşmüyor).
    if (!/^https?:/i.test(raw)) return '';
  } else {
    candidate = `https://${raw.replace(/^\/\//, '')}`;
  }
  try { return new URL(candidate).hostname.toLowerCase(); } catch { return ''; }
}

// Değer bir yayın/agregatör adresiyse o markanın adını, değilse '' döner (hata mesajlarında ve
// temizlik raporunda "hangi site yüzünden" yazabilmek için ad döner, salt boolean değil).
export function aggregatorBrandOf(value) {
  const host = hostOf(value);
  if (!host) return '';
  for (const label of host.split('.')) {
    if (BRAND_SET.has(label)) return label;
  }
  return '';
}

export function isAggregatorSourceUrl(value) {
  return aggregatorBrandOf(value) !== '';
}

// Yazma/okuma kapılarının kullandığı süzgeç: agregatör adresi '' olur, diğer her şey DOKUNULMADAN
// geçer (normalizasyon burada YAPILMAZ — o externalHttpUrl'in işi, bkz. src/lib/externalUrl.js).
export function dropAggregatorSourceUrl(value) {
  return isAggregatorSourceUrl(value) ? '' : value;
}

// Künyedeki kaynak bağlantısının TEK karar noktası: photo_credit_url ÖNCELİKLİ, boşsa (ya da
// agregatör olduğu için elendiyse) source_url. `a || b` yerine bu fonksiyon kullanılır çünkü iki
// kolon AYRI kaynaklardan doluyor (elle girilen "Kaynak" kutusu vs. AI akışının "Kaynak Bağlantı"
// kutusu, bkz. src/routes/project.js#handleProjectDetailRoute) — biri agregatör, diğeri firmanın
// kendi sitesi olabilir ve o durumda firmanınki kullanılmalıdır.
export function firstUsableSourceUrl(values) {
  for (const v of values || []) {
    const raw = String(v == null ? '' : v).trim();
    if (!raw) continue;
    if (isAggregatorSourceUrl(raw)) continue;
    return raw;
  }
  return '';
}

// KURALIN KENDİSİ — bir projenin iki kaynak kolonuna ne yazılacağına karar verir. Kullanıcının
// 2026-09-14'teki cümlesi burada satır satır kodlanmıştır ve TEK yerdedir: temizlik betiği
// (scripts/purge-aggregator-project-sources.mjs) bunu çağırır, testi de (scripts/
// test-2026-09-14-aggregator-source-links.mjs) bunu çağırır — betiğin içinde ikinci bir kopya YOK.
//
// GİRDİLER (çağıran D1'den okur):
//   photoCreditUrl / sourceUrl        — projenin iki kolonu, ham hâlleriyle.
//   everyPhotographerHasProfile       — künyedeki fotoğrafçı adlarının HEPSİ bir kişi (architects)
//                                       ya da firma/marka (offices) kaydına karşılık geliyor mu.
//   officeWebsite                     — projeyi yapan mimarlık firmasının websitesi (yoksa '').
// ÇIKTI: { nextPhotoCreditUrl, nextSourceUrl, changed, removedBrands, reason }
export function planProjectSourceUrls({ photoCreditUrl = '', sourceUrl = '', everyPhotographerHasProfile = false, officeWebsite = '' } = {}) {
  const creditBrand = aggregatorBrandOf(photoCreditUrl);
  const sourceBrand = aggregatorBrandOf(sourceUrl);
  const removedBrands = [...new Set([creditBrand, sourceBrand].filter(Boolean))];
  const trim = (v) => String(v == null ? '' : v).trim();

  // (a) YALNIZCA agregatör olan kolon boşaltılır — agregatör olmayan bir değer (ör. fotoğrafçının
  // kendi sitesi) ASLA silinmez; kullanıcı yalnızca yayın/agregatör adreslerinin gitmesini istedi.
  let nextPhotoCreditUrl = creditBrand ? '' : trim(photoCreditUrl);
  const nextSourceUrl = sourceBrand ? '' : trim(sourceUrl);

  let reason;
  if (!removedBrands.length) {
    reason = 'agregatör yok — dokunulmadı';
  } else if (nextPhotoCreditUrl || nextSourceUrl) {
    // (b) Temizlikten sonra hâlâ kullanılabilir bir kaynak kaldı — yerine bir şey konmaz.
    reason = 'agregatör silindi, mevcut diğer kaynak korundu';
  } else if (everyPhotographerHasProfile) {
    // (c) "Zaten kişi veya firma kaydı olan bir fotoğrafçı varsa link girme." Künye zaten o profile
    // gider (bkz. js/components/project-meta.js#photographerChipList) — bağlantı hiç kullanılmaz.
    reason = 'fotoğrafçının profili var, bağlantı girilmedi';
  } else if (trim(officeWebsite) && !isAggregatorSourceUrl(officeWebsite)) {
    // (d) "mimarlık firmalarının websitelerinin linklerini koy."
    nextPhotoCreditUrl = trim(officeWebsite);
    reason = 'firma sitesi yazıldı';
  } else {
    // (e) "Websiteleri yoksa da boş bırak."
    reason = 'firma sitesi yok, boş bırakıldı';
  }

  const changed = nextPhotoCreditUrl !== trim(photoCreditUrl) || nextSourceUrl !== trim(sourceUrl);
  return { nextPhotoCreditUrl, nextSourceUrl, changed, removedBrands, reason };
}
