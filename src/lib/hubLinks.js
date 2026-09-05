// HUB SAYFALARI İÇİN SUNUCU TARAFI İÇ LİNK GRAFİĞİ (SEO denetimi, 2026-09-05).
//
// =============================================================================================
// TESPİT EDİLEN SORUN
// =============================================================================================
// /proje, /kisi, /firma, /urun, /marka sayfalarının HAM HTML'i (JS çalışmadan, yani Googlebot'un
// ilk gördüğü hâl) ölçüldüğünde:
//     sayfa    gövde metni   detay sayfasına iç link
//     /proje       198 bayt            0
//     /kisi        184 bayt            0
//     /firma       280 bayt            0
//     /urun        255 bayt            0
//     /marka       280 bayt            0
// Yani sitenin 4.000 detay sayfasına giden HİÇBİR iç bağlantı yoktu; keşif tamamen sitemap'e
// bağlıydı. İç bağlantı hem tarama (crawl) hem de sayfa önemi (internal PageRank) için birincil
// sinyaldir — iç linki olmayan sayfalar "orphan" muamelesi görür. Hub sayfalarının kendisi de
// indekslenecek bir içerik taşımıyordu.
//
// =============================================================================================
// ÇÖZÜM VE NEDEN BU BİÇİMDE
// =============================================================================================
// Detay sayfaları için ZATEN var olan `#ssr-entity-body` konteynerine (bkz. src/index.js#
// injectMeta) hub sayfalarında GERÇEK, GÖRÜNÜR bir bağlantı listesi basılır. Liste JS yüklenince
// asıl ızgara tarafından değiştirilir — bu klasik progressive enhancement'tır, gizli metin ya da
// cloaking DEĞİL: JS'siz kullanıcı da botun gördüğünün AYNISINI görür.
//
// VERİ KAYNAĞI: liste uçlarının KENDİ KV önbellekli havuzları (fetchActiveProjectPoolCached /
// fetchArchitectPool / fetchOfficePool / fetchProductPool). Bu, /neden-mimarlab sayaçlarındaki
// AYNI "tek kaynak" kuralıdır (bkz. src/routes/platform.js) — ayrı bir SELECT açmak, sayfada
// listelenen kümeden SAPAN bir bağlantı listesi üretme riski taşırdı. Havuzlar zaten önbellekli
// olduğu için ek D1 maliyeti YOKTUR.
//
// SINIR (LINKS_PER_HUB): tek bir sayfaya binlerce bağlantı basmak hem sayfa ağırlığını hem de
// "link spam" görüntüsünü artırır. 100 bağlantı, Google'ın sayfa başına rahatça izlediği bir
// aralıktır ve tarama grafiğini başlatmak için yeterlidir; geri kalanına sitemap + detay
// sayfalarındaki "Benzer/Diğer Projeler" şeritleri üzerinden ulaşılır.
const LINKS_PER_HUB = 100;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Her hub için: havuzdan {href, label, meta} üreten eşleyici.
const HUBS = {
  '/proje': {
    heading: 'Projeler',
    intro: 'MİMARLAB arşivindeki mimari projeler — konum, yıl ve künye bilgileriyle.',
    map: (it) => ({ href: `/proje/${it.slug}`, label: it.title, meta: [it.location, it.date].filter(Boolean).join(' · ') }),
  },
  '/kisi': {
    heading: 'Kişiler',
    intro: 'Mimarlar, iç mimarlar, tasarımcılar ve fotoğrafçılar.',
    map: (it) => ({ href: `/kisi/${it.slug}`, label: it.name, meta: [it.office, it.position].filter(Boolean).join(' · ') }),
  },
  '/firma': {
    heading: 'Firmalar',
    intro: 'Mimarlık ve tasarım ofisleri.',
    map: (it) => ({ href: `/firma/${it.slug}`, label: it.name, meta: [it.loc, it.cats].filter(Boolean).join(' · ') }),
  },
  '/urun': {
    heading: 'Ürünler',
    intro: 'Mimari ürünler ve yapı malzemeleri.',
    map: (it) => ({ href: `/urun/${it.slug}`, label: it.title, meta: [it.brand, it.category].filter(Boolean).join(' · ') }),
  },
  '/marka': {
    heading: 'Markalar',
    intro: 'Ürünleriyle MİMARLAB’da yer alan markalar.',
    map: (it) => ({ href: `/firma/${it.slug}`, label: it.name, meta: [it.loc, it.cats].filter(Boolean).join(' · ') }),
  },
};

export function isHubPath(pathname) {
  return Object.prototype.hasOwnProperty.call(HUBS, pathname);
}

/**
 * Hub sayfası için SSR gövdesi (HTML string) üretir. Hata durumunda null döner — SEO iyileştirmesi
 * hiçbir koşulda sayfanın SERVİS EDİLMESİNİ engellememeli (havuz okunamazsa sayfa eskisi gibi
 * çalışmaya devam eder, yalnızca bağlantı listesi olmaz).
 */
export async function hubLinksHtml(pathname, loadPool) {
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

  const items = [];
  for (const it of pool) {
    const m = hub.map(it);
    if (!m || !m.href || !m.label) continue;
    items.push(m);
    if (items.length >= LINKS_PER_HUB) break;
  }
  if (!items.length) return null;

  const links = items.map(m => `<li><a href="${esc(m.href)}">${esc(m.label)}</a>${
    m.meta ? `<span>${esc(m.meta)}</span>` : ''}</li>`).join('');
  return `<div class="ssr-hub"><h2>${esc(hub.heading)}</h2><p>${esc(hub.intro)}</p><ul class="ssr-hub-list">${links}</ul></div>`;
}
