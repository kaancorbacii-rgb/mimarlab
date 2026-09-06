// RSS/Atom AYRIŞTIRICI + KAYNAK SAYFA ÖNİZLEME METADATA'SI OKUYUCUSU (Gündem hattı).
//
// NEDEN ELLE YAZILMIŞ AYRIŞTIRICI: bu depoda HİÇ npm bağımlılığı yok (bkz. wrangler.jsonc yorumu —
// package.json bile yok) ve Workers ortamında DOMParser bulunmaz. HTMLRewriter XML için tasarlanmadı
// (feed'lerde <content:encoded> gibi ad-alanlı etiketler ve CDATA blokları var). Bu yüzden
// ayrıştırma, sınırları BİLİNEN bir metin ayrıştırıcısıyla yapılır: yalnızca <item>/<entry>
// bloklarının içindeki BELLİ etiketler okunur, geri kalan her şey yok sayılır. Ayrıştırıcının
// "bir şeyi kaçırması" güvenlidir (o içerik yayınlanmaz), "fazladan bir şey uydurması" mümkün
// değildir — okunan her alan kaynağın kendi baytlarından birebir gelir.
//
// GÜVENLİK: XML/HTML'den çıkan HİÇBİR değer HTML olarak render edilmez. Metin alanları
// stripHtml()'den geçirilir, URL alanları new URL() ile doğrulanır, kart render'ı istemcide
// escapeHtml/escapeAttr kullanır (bkz. js/pages/gundem.js) ve SSR gövdesi sunucuda escape edilir
// (bkz. src/routes/gundem.js#gundemSsrBodyHtml). Bu, bu depodaki XSS escaping kuralının
// (feedback_xss_escaping_convention) Gündem'deki karşılığıdır.

import { safeFetch, limitResponseSize } from './safeFetch.js';

// Feed/sayfa gövdesi için üst sınırlar — safeFetch zaten zaman aşımı uyguluyor, bu da bellek/CPU
// tarafını kelepçeler (bkz. aiConfig.js#AI_MAX_PAGE_BYTES'taki aynı gerekçe, burada daha dar:
// bir RSS feed'i 3 MB'ı geçmemeli, bir <head> okuması için 1,5 MB fazlasıyla yeterli).
const FEED_MAX_BYTES = 3 * 1024 * 1024;
const PAGE_MAX_BYTES = 1.5 * 1024 * 1024;
const FEED_TIMEOUT_MS = 12000;
const PAGE_TIMEOUT_MS = 10000;

// XML/HTML varlıkları. Feed'lerde pratikte görülen küme — tanınmayan varlık OLDUĞU GİBİ bırakılır
// (metin biraz çirkin olur ama hiçbir şey bozulmaz/uydurulmaz).
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', deg: '°', eacute: 'é',
};

export function decodeEntities(text) {
  return String(text || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      // Geçersiz/kontrol karakterleri: olduğu gibi bırak (String.fromCodePoint aksi halde fırlatır).
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return whole;
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    const mapped = NAMED_ENTITIES[body.toLowerCase()];
    return mapped === undefined ? whole : mapped;
  });
}

// HTML etiketlerini söker, boşlukları tekilleştirir. Feed açıklamalarındaki <p>/<a>/<img> gibi
// işaretlemeyi düz metne indirger — AI'ye ve özet doğrulamasına giden metin her zaman düz metindir.
export function stripHtml(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

// <tag ...>içerik</tag> — ilk eşleşmenin İÇERİĞİ. CDATA sarmalayıcısı varsa soyulur.
function tagContent(xml, tagName) {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const m = re.exec(xml);
  if (!m) return '';
  return unwrapCdata(m[1]);
}

function allTagContents(xml, tagName) {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(unwrapCdata(m[1]));
  return out;
}

function unwrapCdata(text) {
  const trimmed = String(text || '').trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(trimmed);
  return cdata ? cdata[1] : trimmed;
}

// <tag attr="değer" ... /> biçimindeki KENDİ KENDİNE KAPANAN etiketlerden bir özniteliği okur
// (enclosure/media:content/media:thumbnail/link rel=alternate hepsi bu biçimde).
function selfClosingAttr(xml, tagName, attrName) {
  const re = new RegExp(`<${tagName}\\s[^>]*?${attrName}\\s*=\\s*["']([^"']+)["'][^>]*>`, 'i');
  const m = re.exec(xml);
  return m ? decodeEntities(m[1]) : '';
}

// http:// görsel URL'lerini https'e yükseltir (sayfa https servis edildiğinden karışık içerik
// tarayıcıda engellenirdi — gerçek durum: Dezeen enclosure'ları http:// veriyor). Geçersiz URL
// null döner ve içerik görselsiz sayılır (yani yayınlanmaz).
export function normalizeImageUrl(raw, baseUrl) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
  } catch { return null; }
  if (parsed.protocol === 'http:') parsed.protocol = 'https:';
  if (parsed.protocol !== 'https:') return null;
  return parsed.href;
}

// Bir <item>/<entry> bloğundan görsel adayını çıkarır. SIRA önemli: yayıncının AÇIKÇA "bu içeriğin
// görseli budur" dediği alanlar (enclosure/media:content/media:thumbnail) önce gelir; gövdedeki ilk
// <img> yalnızca son çare — o da yayıncının kendi HTML'inde kendi verdiği görseldir.
function extractFeedImage(itemXml, linkUrl) {
  const enclosureType = selfClosingAttr(itemXml, 'enclosure', 'type');
  const enclosure = selfClosingAttr(itemXml, 'enclosure', 'url');
  // type verilmişse görsel olduğunu doğrula; verilmemişse (ArchDaily böyle) uzantıya bakılmaz —
  // host doğrulaması zaten kalite kapısında yapılıyor (bkz. gundemQuality.js#isAllowedImageHost).
  if (enclosure && (!enclosureType || /^image\//i.test(enclosureType))) {
    const url = normalizeImageUrl(enclosure, linkUrl);
    if (url) return url;
  }
  for (const tag of ['media:content', 'media:thumbnail']) {
    const mediumOk = !/<media:content\s[^>]*medium\s*=\s*["'](?!image)/i.test(itemXml) || tag !== 'media:content';
    if (!mediumOk) continue;
    const url = normalizeImageUrl(selfClosingAttr(itemXml, tag, 'url'), linkUrl);
    if (url) return url;
  }
  const body = `${tagContent(itemXml, 'content:encoded')} ${tagContent(itemXml, 'description')}`;
  const img = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(body);
  if (img) {
    const url = normalizeImageUrl(decodeEntities(img[1]), linkUrl);
    if (url) return url;
  }
  return null;
}

// Atom <link rel="alternate" href="..."> ya da RSS <link>metin</link>.
function extractLink(itemXml) {
  const plain = tagContent(itemXml, 'link');
  if (plain && /^https?:\/\//i.test(plain.trim())) return decodeEntities(plain.trim());
  const alternate = /<link\s[^>]*rel\s*=\s*["']alternate["'][^>]*href\s*=\s*["']([^"']+)["']/i.exec(itemXml)
    || /<link\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/i.exec(itemXml);
  return alternate ? decodeEntities(alternate[1]) : '';
}

// RSS pubDate (RFC 822) ve Atom published/updated (ISO 8601) — Date bunların ikisini de anlar.
// Ayrıştırılamayan/absürt tarihler null döner; çağıran tarafta "tarihi yok" ayrı ele alınır.
function parseFeedDate(raw) {
  if (!raw) return null;
  const ms = Date.parse(String(raw).trim());
  if (!Number.isFinite(ms)) return null;
  // 1990 öncesi ya da 2 günden fazla gelecekteki tarihler bozuk sayılır (bazı feed'lerde görülüyor).
  if (ms < 631152000000 || ms > Date.now() + 2 * 86400000) return null;
  return ms;
}

// Feed XML'ini normalize edilmiş item listesine çevirir.
export function parseFeed(xml) {
  const text = String(xml || '');
  let blocks = text.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi);
  if (!blocks || !blocks.length) blocks = text.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi);
  if (!blocks) return [];
  return blocks.map(block => {
    const link = extractLink(block);
    const description = tagContent(block, 'description') || tagContent(block, 'summary');
    const contentEncoded = tagContent(block, 'content:encoded') || tagContent(block, 'content');
    return {
      title: stripHtml(tagContent(block, 'title')),
      link,
      guid: stripHtml(tagContent(block, 'guid')) || stripHtml(tagContent(block, 'id')) || link,
      publishedAt: parseFeedDate(tagContent(block, 'pubDate') || tagContent(block, 'published') || tagContent(block, 'updated')),
      author: stripHtml(tagContent(block, 'dc:creator') || tagContent(block, 'author')).slice(0, 120),
      categories: allTagContents(block, 'category').map(c => stripHtml(c)).filter(Boolean).slice(0, 12),
      // Özet üretimi için kullanılan METİN: yayıncının kendi kısa açıklaması önce; yoksa gövdenin
      // BAŞI (tamamı değil — bkz. EXCERPT_MAX_CHARS, "tam makale kopyalama" yasağı).
      excerpt: stripHtml(description) || stripHtml(contentEncoded),
      image: extractFeedImage(block, link),
    };
  }).filter(it => it.title && it.link);
}

// Kaynak makalenin <head>'indeki ÜÇÜNCÜ TARAF ÖNİZLEME metadata'sı — yayıncının paylaşım/önizleme
// için AÇIKÇA yayımladığı alanlar. Sayfa GÖVDESİ okunmaz, saklanmaz, yayımlanmaz.
export function extractPageMeta(html, baseUrl) {
  // <head> ile sınırla — gövdedeki bir kullanıcı yorumunda geçen sahte bir <meta> etiketinin
  // okunmaması için (savunmacı; ayrıca aranan bölgeyi küçülterek CPU'yu da düşürür).
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 200000);
  const metaContent = (key) => {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${key}["']`, 'i'),
    ];
    for (const re of patterns) {
      const m = re.exec(head);
      if (m && m[1]) return decodeEntities(m[1]);
    }
    return '';
  };
  const canonicalRaw = /<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i.exec(head);
  let canonical = null;
  if (canonicalRaw) {
    try { canonical = new URL(decodeEntities(canonicalRaw[1]), baseUrl).href; } catch { canonical = null; }
  }
  return {
    image: normalizeImageUrl(metaContent('og:image') || metaContent('twitter:image'), baseUrl),
    description: stripHtml(metaContent('og:description') || metaContent('description')),
    canonical,
    publishedAt: parseFeedDate(metaContent('article:published_time')),
  };
}

// Feed'i çeker ve ayrıştırır. safeFetch: SSRF koruması + her yönlendirme hop'unda yeniden doğrulama
// + zaman aşımı (bkz. o dosya). Accept başlığı, bazı sunucuların feed yerine HTML dönmesini önler.
//
// source.type === 'html' ise (RSS'i olmayan ya da robots.txt'si feed'i kapatan kaynaklar, bkz.
// src/lib/gundemHtmlList.js) AYNI şekilde item dizisi döner — çağıran taraf farkı görmez.
export async function fetchFeed(feedUrl, source = null) {
  const isHtml = source && source.type === 'html';
  const { response, finalUrl } = await safeFetch(feedUrl, { timeoutMs: FEED_TIMEOUT_MS, maxRedirects: 4, headers: {
    Accept: isHtml
      ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1'
      : 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1',
  } });
  if (!response.ok) throw new Error(`feed_http_${response.status}`);
  const body = await limitResponseSize(response, FEED_MAX_BYTES).text();
  if (isHtml) {
    const { parseHtmlList } = await import('./gundemHtmlList.js');
    return parseHtmlList(source.id, body, finalUrl);
  }
  return parseFeed(body);
}

// Makale sayfasının önizleme metadata'sı (yalnızca imageStrategy:'og' olan kaynaklar için).
export async function fetchPageMeta(pageUrl) {
  const { response, finalUrl } = await safeFetch(pageUrl, { timeoutMs: PAGE_TIMEOUT_MS, maxRedirects: 4, headers: {
    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  } });
  if (!response.ok) throw new Error(`page_http_${response.status}`);
  const contentType = response.headers.get('Content-Type') || '';
  if (!/text\/html|application\/xhtml/i.test(contentType)) throw new Error('page_not_html');
  const html = await limitResponseSize(response, PAGE_MAX_BYTES).text();
  return { ...extractPageMeta(html, finalUrl), finalUrl };
}
