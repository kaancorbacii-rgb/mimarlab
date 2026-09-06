// HUB SAYFALARI İÇİN SUNUCU TARAFI ItemList YAPILANDIRILMIŞ VERİSİ (SEO).
//
// =============================================================================================
// GEÇMİŞ — NEDEN GÖRÜNÜR LİSTE DEĞİL
// =============================================================================================
// İlk sürüm (2026-09-05) aynı veriyi hub sayfalarının GÖVDESİNE görünür bir bağlantı listesi
// olarak basıyordu. Kullanıcı bunu aynı gün kaldırttı: /kisi, /firma, /marka, /urun sayfalarının
// tepesinde yüzlerce çıplak isim görünüyordu (kart ızgarası hazır olunca listeyi gizleyen
// `body.grid-ready` kancası YALNIZCA proje.html'e eklenmişti, diğer dört sayfada liste kalıcı
// olarak ekranda kalıyordu). Sayfa tasarımına ait olmayan bir metin bloğuydu.
//
// =============================================================================================
// ŞİMDİKİ ÇÖZÜM
// =============================================================================================
// Aynı SEO ihtiyacı (hub sayfasının, altındaki detay sayfalarını Googlebot'a bildirmesi) artık
// sayfanın GÖRÜNEN içeriğine hiç dokunmadan, sayfanın KENDİ SEO meta bloğuyla bütünleşik biçimde
// karşılanır: <head> içine schema.org ItemList basılır ve her öğe, ilgili gönderinin BAŞLIĞI
// (proje/ürün başlığı, kişi/firma/marka adı) + kanonik URL'sidir. Bu, detay sayfalarındaki
// jsonLd/breadcrumbJsonLd enjeksiyonuyla (bkz. src/index.js#injectMeta) aynı mekanizmadır.
//
// VERİ KAYNAĞI: liste uçlarının KENDİ KV önbellekli havuzları (fetchActiveProjectPoolCached /
// fetchArchitectPool / fetchOfficePool / fetchProductPool). Bu, /neden-mimarlab sayaçlarındaki
// AYNI "tek kaynak" kuralıdır (bkz. src/routes/platform.js) — ayrı bir SELECT açmak, sayfada
// listelenen kümeden SAPAN bir liste üretme riski taşırdı. Havuzlar zaten önbellekli olduğu için
// ek D1 maliyeti YOKTUR.
//
// SINIR (ITEMS_PER_HUB): ItemList tek bir sayfaya binlerce öğe koymak için değil; 100 öğe hem
// Google'ın rahatça işlediği bir aralıktır hem de sayfa ağırlığını makul tutar. Geri kalan
// kayıtlara sitemap + detay sayfalarındaki "Benzer/Diğer" şeritleri üzerinden ulaşılır.
import { officePath } from './officeUrl.js';

const ITEMS_PER_HUB = 100;

const SITE_ORIGIN = 'https://mimarlab.com';

// Her hub için: havuzdan {url, name} üreten eşleyici.
const HUBS = {
  '/proje': {
    name: 'Projeler',
    map: (it) => ({ url: `${SITE_ORIGIN}/proje/${it.slug}`, name: it.title }),
  },
  '/kisi': {
    name: 'Kişiler',
    map: (it) => ({ url: `${SITE_ORIGIN}/kisi/${it.slug}`, name: it.name }),
  },
  // Not: iki ofis hub'ı da KANONİK öneki kullanır (bkz. src/lib/officeUrl.js) — havuz kaydı cats ve
  // productCount taşıdığından ayrım burada da doğru yapılabiliyor. /firma listesinde saf markalar
  // zaten yok, ama Autoban gibi karma kayıtlar /marka listesinde görünüyor ve onların kanonik URL'i
  // /firma/:slug olarak KALIR — hub bağlantısı da o yüzden koşulsuz değil, kayda göre üretilir.
  '/firma': {
    name: 'Firmalar',
    map: (it) => ({ url: `${SITE_ORIGIN}${officePath(it.slug, it.cats, it.productCount)}`, name: it.name }),
  },
  '/urun': {
    name: 'Ürünler',
    map: (it) => ({ url: `${SITE_ORIGIN}/urun/${it.slug}`, name: it.title }),
  },
  '/marka': {
    name: 'Markalar',
    map: (it) => ({ url: `${SITE_ORIGIN}${officePath(it.slug, it.cats, it.productCount)}`, name: it.name }),
  },
};

export function isHubPath(pathname) {
  return Object.prototype.hasOwnProperty.call(HUBS, pathname);
}

/**
 * Hub sayfası için ItemList JSON-LD nesnesi üretir. Hata durumunda null döner — SEO iyileştirmesi
 * hiçbir koşulda sayfanın SERVİS EDİLMESİNİ engellememeli (havuz okunamazsa sayfa eskisi gibi
 * çalışmaya devam eder, yalnızca ItemList olmaz).
 */
export async function hubItemListJsonLd(pathname, loadPool) {
  const hub = HUBS[pathname];
  if (!hub) return null;
  let pool;
  try {
    pool = await loadPool();
  } catch (err) {
    console.error('hubLinks: havuz okunamadı', pathname, err && err.message);
    return null;
  }
  if (!Array.isArray(pool) || !pool.length) return null;

  const elements = [];
  for (const it of pool) {
    const m = hub.map(it);
    if (!m || !m.url || !m.name) continue;
    elements.push({ '@type': 'ListItem', position: elements.length + 1, url: m.url, name: String(m.name) });
    if (elements.length >= ITEMS_PER_HUB) break;
  }
  if (!elements.length) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: hub.name,
    url: `${SITE_ORIGIN}${pathname}`,
    numberOfItems: elements.length,
    itemListElement: elements,
  };
}
