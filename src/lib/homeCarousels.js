// ANA SAYFA KARUSELLERİNİN ELLE SEÇİMİ (kullanıcı isteği, 2026-09-12 madde 1: "Admin panelinde;
// ana sayfadaki tüm carosel içeriklerini açılabilir menüden seçebileyim. Örneğin 3 proje seçersem
// diğer 6 tanesi son eklenenler olsun.")
//
// SÖZLEŞME. Admin, her karusel için sıralı bir slug listesi seçer (bkz. admin.html "Ana Sayfa"
// sekmesi). Bu liste site_settings'te virgülle ayrılmış tek bir metin olarak yaşar — yeni bir tablo
// açılmadı, mevcut anahtar/değer ayar mekanizması (bkz. src/lib/siteSettings.js#DEFAULT_SETTINGS)
// jenerik çalıştığından bu dört satır tek başına anahtarları yönetilebilir kılar. `featured_project_slugs`
// ZATEN vardı (2026-08 öne çıkan projeler); üç kardeşi onunla BİREBİR aynı biçimi kullanır.
//
// UYGULAMA YERİ — LİSTE UÇLARI, ana sayfa DEĞİL. Seçim, ilgili liste ucuna `pin=slug1,slug2`
// parametresi olarak taşınır (bkz. applyPinnedOrder'ın çağrıldığı dört handler). Neden burada:
//   * Havuzun TAMAMI o handler'ın elindedir — admin'in seçtiği kayıt doğal sırada 300. olsa bile
//     ilk 6'ya girer. Eleme/sıralama dışarıda yapılsaydı (eski davranış: ana sayfa 24 proje çekip
//     JS'te başa alıyordu) seçilen kayıt çekilen pencereye düşmediğinde SESSİZCE kaybolurdu.
//   * Gizli/silinmiş/önizleme (blurlu) kayıtlar havuzdan zaten elenmiştir — pinlenmiş bir slug o
//     süzgeçlerden geçemiyorsa karusele de girmez (yayından kaldırılan bir seçim sessizce düşer,
//     admin ayrı bir temizlik yapmak zorunda kalmaz).
//   * Yanıt `pin=` DEĞERİ ANAHTARLI önbelleklenir (caches.default anahtarı tam URL'dir) — admin
//     seçimi değiştirdiği an URL değişir, yani eski gövde dönme ihtimali yoktur.
//
// ANA SAYFA DIŞINDA HİÇBİR ETKİSİ YOKTUR: parametreyi yalnızca src/index.js#loadHomeData ve
// index.html'in yedek fetch yolu gönderir; /proje, /kisi, /firma, /urun liste sayfaları göndermez.

// site_settings anahtarı -> hangi karusel. admin.html ve public uç bu tabloyu paylaşır.
export const HOME_FEATURED_KEYS = {
  projects: 'featured_project_slugs',
  architects: 'featured_architect_slugs',
  offices: 'featured_office_slugs',
  products: 'featured_product_slugs',
};

// Ana sayfada her karusel kaç slot gösterir (index.html#PROJECT_CAROUSEL_SLOTS ile AYNI).
// 9 -> 6 (kullanıcı isteği, 2026-09-12: "carosellerde gösterilen her bir kategori için gönderi
// sayısını 6'ya düşür"). Seçimin üst sınırı da budur: karusele giremeyecek bir slug'ı kaydetmenin
// anlamı yok. Karusellerin ALTINDAKİ "Son ..." şeritleri aynı listenin 7-12. kayıtlarıdır, yani
// seçilmeyen kayıtlar oraya kayar — seçim onları da doğru sıraya iter.
export const HOME_SLOT_COUNT = 6;

// "a, b, c" -> ['a','b','c']. Boş/tekrarlı girdiler düşer, slot sayısıyla sınırlanır — admin
// kutusuna 50 slug yapıştırsa bile ilk 6'dan fazlası zaten karusele giremez.
export function parseFeaturedSlugs(raw) {
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const slug = part.trim();
    if (slug && !out.includes(slug)) out.push(slug);
    if (out.length >= HOME_SLOT_COUNT) break;
  }
  return out;
}

// Ayar nesnesinden (getSiteSettings çıktısı) dört karuselin seçimini okur.
export function featuredSlugsFromSettings(settings, key) {
  return parseFeaturedSlugs(settings && settings[HOME_FEATURED_KEYS[key]]);
}

// `pin=` parametresini okur (liste handler'ları için). parseFeaturedSlugs ile AYNI normalizasyon.
export function pinnedSlugsFromUrl(url) {
  return parseFeaturedSlugs(url.searchParams.get('pin'));
}

// Seçilen slug'ları listenin BAŞINA, VERİLEN SIRAYLA taşır; geri kalan her şey kendi doğal
// sırasında (son eklenenler / popülerlik — uca göre) arkadan devam eder. Havuzda bulunmayan bir
// slug sessizce yok sayılır. Yeni dizi döner, girdi dizisine dokunulmaz.
export function applyPinnedOrder(list, pinnedSlugs) {
  if (!pinnedSlugs.length) return list;
  const bySlug = new Map();
  for (const item of list) if (item && item.slug && !bySlug.has(item.slug)) bySlug.set(item.slug, item);
  const head = [];
  const taken = new Set();
  for (const slug of pinnedSlugs) {
    const item = bySlug.get(slug);
    if (item && !taken.has(slug)) { head.push(item); taken.add(slug); }
  }
  if (!head.length) return list;
  return [...head, ...list.filter(item => !(item && taken.has(item.slug)))];
}

// Bir liste ucu URL'ine `pin=` ekler (boşsa URL'e DOKUNMAZ — parametresiz URL en sık görülen,
// dolayısıyla en sıcak önbellek anahtarıdır; gereksiz yere ondan sapmamak önemli).
export function withPinParam(path, pinnedSlugs) {
  if (!pinnedSlugs.length) return path;
  return `${path}&pin=${encodeURIComponent(pinnedSlugs.join(','))}`;
}
