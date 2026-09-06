// GÜNDEM SSR GÖVDESİ (kullanıcı isteği, 2026-09-06 madde 14: "JS kapalıyken Gündem içerikleri HTML
// içinde görünür olmalı").
//
// KAPSAM SINIRI — aynı maddenin AÇIK uyarısı: "Gündem kartlarının kaynak makalelerin kopyası gibi
// görünmesine neden olacak full-text içerik üretme." Bu yüzden buradan çıkan HTML, ekranda görünen
// kartın BİREBİR aynısıdır ve yalnızca şunları içerir: MİMARLAB'ın kendi Türkçe başlığı, MİMARLAB'ın
// kendi tek paragraflık özeti, tarih/kategori/kaynak adı, önizleme görseli ve KAYNAĞA GİDEN GÖRÜNÜR
// BAĞLANTI. Kaynak makalenin metninden tek cümle bile buraya girmez.
//
// NEDEN AYRI BİR lib DOSYASI: iki tüketicisi var — /gundem liste sayfası (src/routes/gundem.js) ve
// /gundem/:slug detay meta'sı (src/lib/seo.js). seo.js'in bir route dosyasından import etmesi
// (lib → route yönünde bir bağımlılık) bu depodaki katman düzenini bozardı; ortak parça buraya alındı.
//
// ESCAPING: her değer escapeHtml/escapeAttr'dan geçer. Bu içeriğin kaynağı ÜÇÜNCÜ TARAF feed'lerdir
// (başlık/özet AI'den geçse de kaynak metni etkileyebilir), yani burada escaping isteğe bağlı bir
// nezaket değil, gerçek bir XSS savunmasıdır — bkz. bu depodaki escapeAttr kuralı.

import { GUNDEM_CATEGORIES } from './gundemCategories.js';

export function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatTrDate(ms) {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return ''; }
}

export function gundemCategoryLabel(key) {
  const found = GUNDEM_CATEGORIES.find(c => c.key === key);
  return found ? found.label : '';
}

// Tek bir kart. `linkTitle=false` (detay sayfası) başlığı bağlantıya sarmaz — sayfa zaten o içeriğin
// kendisidir, kendine link vermek anlamsız olurdu. `showTitle=false` başlığı TAMAMEN atlar: detay
// sayfasında başlık zaten sayfanın H1'idir (src/index.js#injectMeta onu kayda göre doldurur), kart
// içinde ikinci kez basmak aynı metni ekranda iki kez gösterirdi.
//
// GÖRSEL: kaynağın kendi CDN'inden gelir (bkz. migrations/0099 dosya başı). width/height ÖZNİTELİKLERİ
// zorunlu — kaynak görselinin gerçek oranını bilmiyoruz ve CSS aspect-ratio ile kırpıyoruz, ama bu
// iki öznitelik olmadan JS'siz görünümde CLS oluşur (madde 19). referrerpolicy="no-referrer":
// ziyaretçinin hangi MİMARLAB sayfasında olduğu bilgisi üçüncü taraf sunucularına sızmaz.
export function gundemSsrCard(row, { linkTitle = true, showTitle = true } = {}) {
  if (!row) return '';
  const date = formatTrDate(row.source_published_at || row.published_at);
  // js/pages/gundem.js#cardHtml ile AYNI metadata dili (tarih gri / kategori kalın-koyu / kaynak
  // orta noktadan sonra) — ikisi ayrışırsa JS yüklendiği anda görünür bir sıçrama olurdu.
  // Kaynak adı = kaynağa giden TEK bağlantı (kullanıcı isteği 2026-09-07 madde 3). Ayrı bir
  // "Kaynağa git" satırı YOK; atıf yine her kartta görünür ve tıklanabilir durumda.
  // rel="nofollow noopener external": otomatik toplanan dış bağlantı için doğru sinyal.
  const meta =
    `<span class="gundem-date">${escapeHtml(date)}</span>` +
    `<span class="gundem-cat">${escapeHtml(gundemCategoryLabel(row.category))}</span>` +
    `<a class="gundem-src" href="${escapeAttr(row.source_url)}" rel="nofollow noopener external" target="_blank">${escapeHtml(row.source_name)}</a>`;
  // linkTitle artık YALNIZCA liste SSR'ında (JS kapalıyken içeriğe ulaşmanın tek yolu) kullanılır.
  // JS açıkken kart başlığı tıklanabilir DEĞİLDİR (madde 1) — istemci kartı kendi işaretlemesini
  // basar ve orada başlık düz metindir.
  const href = `/gundem/${encodeURIComponent(row.slug)}`;
  const titleHtml = linkTitle
    ? `<a href="${escapeAttr(href)}">${escapeHtml(row.title)}</a>`
    : escapeHtml(row.title);
  return `<article class="gundem-ssr-card">` +
    `<img class="gundem-ssr-img" src="${escapeAttr(row.image_url)}" alt="" width="640" height="400" loading="lazy" decoding="async" referrerpolicy="no-referrer">` +
    `<div class="gundem-ssr-body">` +
      `<p class="gundem-ssr-meta">${meta}</p>` +
      (showTitle ? `<h2 class="gundem-ssr-title">${titleHtml}</h2>` : '') +
      `<p class="gundem-ssr-summary">${escapeHtml(row.summary)}</p>` +
    `</div>` +
  `</article>`;
}

export function gundemSsrList(rows) {
  if (!rows || !rows.length) return '';
  return `<div class="gundem-ssr-list">${rows.map(r => gundemSsrCard(r)).join('')}</div>`;
}
