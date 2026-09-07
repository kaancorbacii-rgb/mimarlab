// GÜNDEM ÖNBELLEK GEÇERSİZ KILMA (kullanıcı isteği, 2026-09-06 madde 20).
//
// Yeni bir Gündem içeriği yayınlandığında /gundem sayfasının ve /api/gundem liste varyantlarının
// s-maxage penceresi dolana kadar bayat kalmasını istemiyoruz. Bu depoda bunun ZATEN kanıtlanmış
// bir yolu var (bkz. src/lib/publicCache.js#invalidatePublicCache): (a) bu PoP'un caches.default
// girdilerini sil, (b) CF_ZONE_ID/CF_PURGE_TOKEN tanımlıysa purge-by-URL ile TÜM PoP'ları temizle.
// Aynı iki adım burada da uygulanır; yeni bir mekanizma icat edilmez.
//
// NEDEN invalidatePublicCache() DOĞRUDAN ÇAĞRILMIYOR: o fonksiyon proje/kişi/firma/ürün havuzlarını
// ve fingerprint'lerini de düşürür. Gündem yayını bu dört varlığın HİÇBİRİNİ değiştirmediğinden,
// her cron turunda site genelindeki tüm sıcak önbellekleri düşürmek saf bir maliyet olurdu
// (30 dakikada bir, günde 48 kez). Bu yüzden yalnızca Gündem'in kendi anahtarları hedeflenir.
//
// TAZELİK GARANTİSİ AYRICA ETag'DEN GELİR: /api/gundem, cachedPublicJson'a bir listFingerprint
// geçirir (bkz. src/routes/gundem.js) — purge bir PoP'u atlasa bile o PoP'taki girdi, fingerprint
// uyuşmadığı için bayat sayılıp yeniden hesaplanır (bkz. publicCache.js#cachedPublicJson'daki
// "HIT yolunda da tazelik doğrulaması" dalı).

import { purgeGlobalUrls } from './globalPurge.js';
import { cacheKeyFor } from './publicCache.js';
import { SSR_CACHE_VERSION } from './ssrCache.js';

const SITE_ORIGIN = 'https://mimarlab.com';

// /gundem sayfasının kendisi + liste ucunun ZİYARETÇİLERİN GERÇEKTEN İSTEDİĞİ varyantları.
// publicCache.js#HOMEPAGE_LIST_PATHS/DEFAULT_FIRST_PAGE_PATHS'teki AYNI ders: cache anahtarı TAM
// URL eşleşmesidir, bu yüzden sayfanın ilk yüklemede kurduğu sorgu dizesi burada BİREBİR yazılmalı
// — aksi halde purge sessizce hiçbir şeye dokunmaz (bu depodaki tekrar eden gerçek bulgu).
// js/pages/gundem.js#PAGE_SIZE ve kategori çipleri ile hizalı tutulmalıdır; ayrışırsa
// scripts/preflight-check.sh bunu yakalar.
export const GUNDEM_CACHE_PATHS = [
  '/gundem',
  '/api/gundem',
  '/api/gundem?page=1&limit=12',
  '/api/gundem?category=haber&page=1&limit=12',
  '/api/gundem?category=etkinlik&page=1&limit=12',
  '/api/gundem?category=yarisma&page=1&limit=12',
  // 'gorus' ve 'kariyer' 2026-09-07'de ÇİP OLMAKTAN ÇIKTI (bkz. gundemCategories.js#chip:false).
  // Sayfa artık bu iki URL'yi hiç istemediğinden purge listesinde tutmak boşa istek olurdu;
  // kategoriler whitelist'te DURUYOR, yalnızca filtre çipleri kaldırıldı.
];

export async function purgeGundemCache(env) {
  const urls = GUNDEM_CACHE_PATHS.map(p => `${SITE_ORIGIN}${p}`);
  await Promise.all([
    // Hatalar içeride yutulur (bkz. globalPurge.js) — cron turu bundan asla etkilenmez.
    purgeGlobalUrls(env, urls),
    ...GUNDEM_CACHE_PATHS.map(async p => {
      try { await caches.default.delete(cacheKeyFor(p)); } catch { /* caches API bazı ortamlarda yok */ }
    }),
    // /gundem SAYFASI (API değil) serveGundemListPage tarafından SÜRÜMLENMİŞ bir anahtarla
    // (?__cv=<SSR_CACHE_VERSION>) saklanır — çıplak '/gundem' anahtarını silmek o girdiye DOKUNMAZ.
    // ssrCache.js#purgeSsrDetailCache'teki AYNI tuzak ve AYNI çözüm; bu satır olmadan yeni yayınlanan
    // içerik sayfanın SSR gövdesinde s-maxage boyunca görünmezdi.
    (async () => {
      try {
        const keyUrl = new URL(`${SITE_ORIGIN}/gundem`);
        keyUrl.searchParams.set('__cv', SSR_CACHE_VERSION);
        await caches.default.delete(new Request(keyUrl));
      } catch { /* caches API bazı ortamlarda yok */ }
    })(),
  ]);
}
