// Dış bir sayfadan (AI otomatik ekleme akışı) modele gönderilecek temiz metni ve görsel adaylarını
// çıkarır. `<script>`/`<style>` içeriğini toplamamak için "bütün body metnini topla" yerine bilinen
// görünür-içerik etiketlerine (başlık, paragraf, liste vb.) taranır — script/style zaten bu
// seçicilere hiç eşleşmediği için ayrıca filtrelemeye gerek kalmaz. HTMLRewriter Cloudflare
// Workers'a gömülü; npm bağımlılığı gerekmiyor (bkz. src/index.js#injectMeta'daki aynı API).

import { AI_MAX_CONTENT_CHARS } from './aiConfig.js';

const CONTENT_SELECTORS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote', 'figcaption', 'td', 'dt', 'dd'];

// Favicon/logo/ikon gibi projeyle/ürünle ilgisi olmayan görselleri aday listesine hiç almamak için
// basit bir dosya adı/yol sezgisi — kesin değil ama modele gidecek gürültüyü baştan azaltıyor.
const ICON_PATTERN = /favicon|sprite|spacer|blank\.(gif|png)|[-_.]logo[-_.]|\/logo\.[a-z]+(\?|$)|[-_.]icon[-_.]|\.svg(\?|$)/i;

function absolutize(raw, baseUrl) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;
  try {
    const abs = new URL(trimmed, baseUrl);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
    return abs.href;
  } catch {
    return null;
  }
}

// `srcset="a.jpg 480w, b.jpg 1200w"` ya da yoğunluk tabanlı `"a.jpg 1x, b.jpg 2x"` biçimlerini
// ayrıştırıp EN YÜKSEK çözünürlüklü adayı döner — sayfalar genelde <img src> alanına küçük bir
// thumbnail, gerçek büyük görseli ise srcset/data-srcset'e koyar (bkz. kullanıcı isteği: "fotoğrafları
// iyi çözünürlükte çeksin"). 'w' tanımlayıcıları gerçek piksel genişliği olduğundan doğrudan
// kıyaslanabilir; 'x' (yoğunluk) tanımlayıcılarının gerçek genişliği bilinmez, o yüzden kabaca bir
// temel genişlik (800px) ile ölçeklenip yalnızca kendi aralarında sıralanabilir bir skor üretilir.
function bestFromSrcset(raw) {
  if (!raw) return null;
  let best = null;
  let bestScore = -1;
  for (const part of String(raw).split(',')) {
    const m = part.trim().match(/^(\S+)(?:\s+([\d.]+)(w|x))?$/);
    if (!m) continue;
    const value = m[2] ? parseFloat(m[2]) : 1;
    const score = m[3] === 'w' ? value : value * 800;
    if (score > bestScore) { bestScore = score; best = m[1]; }
  }
  return best;
}

// response: safeFetch'ten dönen Response (henüz tüketilmemiş). baseUrl: göreli linkleri mutlak
// hale getirmek için kullanılan (yönlendirme sonrası) gerçek sayfa adresi.
export async function extractPageContent(response, baseUrl, { maxChars = AI_MAX_CONTENT_CHARS, maxImages = 60 } = {}) {
  const titleParts = [];
  const textParts = [];
  const images = [];
  const seenImages = new Set();
  const jsonLdBlocks = [];
  let metaDescription = null;
  let heroImage = null;
  let ogTitle = null;

  function addImage(raw, { front = false } = {}) {
    const abs = absolutize(raw, baseUrl);
    if (!abs || ICON_PATTERN.test(abs) || seenImages.has(abs)) return;
    if (images.length >= maxImages && !front) return;
    seenImages.add(abs);
    if (front) images.unshift(abs); else images.push(abs);
  }

  let rewriter = new HTMLRewriter()
    // Sade "title" seçici SVG içindeki <title> (ikonların erişilebilirlik etiketi) gibi head dışı
    // eşleşmeleri de yakalayıp sayfa başlığına karıştırabiliyordu (bkz. BBC News gibi sitelerdeki
    // gömülü SVG ikonlar) — "head > title" yalnızca gerçek sayfa başlığıyla eşleşir.
    .on('head > title', { text(t) { titleParts.push(t.text); } })
    .on('meta[name="description"]', {
      element(el) { if (!metaDescription) metaDescription = el.getAttribute('content'); },
    })
    .on('meta[property="og:description"]', {
      element(el) { if (!metaDescription) metaDescription = el.getAttribute('content'); },
    })
    .on('meta[property="og:title"]', {
      // Sekme başlığı (<title>) çoğu sitede " | Site Adı" gibi eklerle kirlenir; og:title genelde
      // yalnızca içeriğe özgü, temiz bir başlıktır — modele ayrı, daha güvenilir bir sinyal olarak
      // ayrıca verilir (bkz. buildUserText).
      element(el) { if (!ogTitle) ogTitle = el.getAttribute('content'); },
    })
    .on('meta[property="og:image"]', {
      element(el) { if (!heroImage) heroImage = el.getAttribute('content'); },
    })
    .on('meta[property="og:image:secure_url"]', {
      element(el) { if (!heroImage) heroImage = el.getAttribute('content'); },
    })
    .on('link[rel="image_src"]', {
      element(el) { if (!heroImage) heroImage = el.getAttribute('href'); },
    })
    .on('img', {
      element(el) {
        const hiRes = bestFromSrcset(el.getAttribute('srcset')) || bestFromSrcset(el.getAttribute('data-srcset'));
        const plain = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original');
        addImage(hiRes || plain);
      },
    })
    // <picture><source srcset="..."></picture> — responsive galerilerde asıl yüksek çözünürlüklü
    // adaylar genelde burada olur, <img> ise yalnızca eski tarayıcılar için düşük çözünürlüklü bir
    // yedektir.
    .on('picture source', {
      element(el) {
        const best = bestFromSrcset(el.getAttribute('srcset')) || bestFromSrcset(el.getAttribute('data-srcset'));
        if (best) addImage(best);
      },
    })
    // schema.org JSON-LD (bkz. aşağıdaki parseJsonLd) — sitenin kendi yapısal verisi, gövde
    // metninden çıkarılan serbest metinden daha güvenilir bir başlık/açıklama/görsel kaynağıdır.
    .on('script[type="application/ld+json"]', {
      text(t) { jsonLdBlocks.push(t.text); },
    });
  for (const selector of CONTENT_SELECTORS) {
    rewriter = rewriter.on(selector, {
      text(t) {
        if (t.text && t.text.trim()) textParts.push(t.text);
        if (t.lastInTextNode) textParts.push('\n');
      },
    });
  }

  // HTMLRewriter bir streaming transform'dur; handler'lar yalnızca çıktı stream'i TÜKETİLDİKÇE
  // çalışır — bu yüzden sonuçları okumadan önce mutlaka .text() ile drain etmemiz gerekiyor.
  await rewriter.transform(response).text();

  const structured = parseJsonLd(jsonLdBlocks.join(''));
  for (const imgUrl of structured.images) addImage(imgUrl, { front: true });

  const heroAbs = absolutize(heroImage, baseUrl);
  if (heroAbs && !ICON_PATTERN.test(heroAbs)) addImage(heroAbs, { front: true });

  let text = textParts.join(' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  if (text.length > maxChars) text = text.slice(0, maxChars);

  return {
    title: titleParts.join('').trim(),
    ogTitle: ogTitle ? ogTitle.trim() : null,
    metaDescription: metaDescription ? metaDescription.trim() : null,
    structuredName: structured.name,
    structuredDescription: structured.description,
    text,
    images,
  };
}

// JSON-LD bloklarını (birden fazla <script> etiketi, tek bir dizi, ya da @graph sarmalayıcısı
// olabilir) toleranslı biçimde ayrıştırır. Tek bir bozuk blok tüm çıkarımı düşürmesin diye her
// blok kendi try/catch'i içinde işlenir. Yalnızca içerikle ilgili tipler (Article/Product/
// CreativeWork vb.) dikkate alınır — Organization/BreadcrumbList/WebSite gibi site-geneli
// meta tipleri (genelde başlık/açıklama taşımaz ya da yanıltıcı olur) atlanır.
const RELEVANT_LD_TYPES = new Set([
  'Article', 'NewsArticle', 'BlogPosting', 'CreativeWork', 'Product', 'ImageObject',
  'Place', 'LandmarksOrHistoricalBuildings', 'House', 'Residence', 'ApartmentComplex',
]);

function parseJsonLd(rawConcat) {
  const result = { name: null, description: null, images: [] };
  // Ayrı <script> bloklarının metni text() event'lerinde art arda geldiğinden burada birleşik
  // tutuluyor olabilir; her biri kendi içinde geçerli bir JSON dizini olduğundan üst seviye JSON
  // nesnelerini kabaca ayırmak için '}{' sınırında bölmeyi dene, olmazsa tek blok gibi işle.
  const chunks = rawConcat.includes('}{') ? rawConcat.split(/(?<=\})\s*(?=\{)/) : [rawConcat];
  const flat = [];
  for (const chunk of chunks) {
    if (!chunk || !chunk.trim()) continue;
    let parsed;
    try { parsed = JSON.parse(chunk); } catch { continue; }
    const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed]);
    for (const node of arr) if (node && typeof node === 'object') flat.push(node);
  }

  function imageUrlsFrom(v) {
    if (!v) return [];
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) return v.flatMap(imageUrlsFrom);
    if (typeof v === 'object') return imageUrlsFrom(v.url || v.contentUrl);
    return [];
  }

  for (const node of flat) {
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    const isRelevant = types.some(t => t && RELEVANT_LD_TYPES.has(t));
    if (!result.name && isRelevant && typeof (node.name || node.headline) === 'string') {
      result.name = (node.name || node.headline).trim();
    }
    if (!result.description && isRelevant && typeof node.description === 'string') {
      result.description = node.description.trim();
    }
    // KASITLI OLARAK datePublished/dateCreated ALINMAZ: Article/NewsArticle gibi tiplerde bu alan
    // KONUNUN (ör. binanın) değil, İÇİNDE BULUNDUĞU MAKALENİN yayın tarihidir — gerçek testte
    // (Wikipedia'nın Fallingwater/Sydney Opera House sayfaları) bunun proje tarihiyle hiçbir ilgisi
    // olmadığı, hatta yıllarca farklı olabildiği doğrulandı; modele "güvenilir yapısal veri" diye
    // verilirse SAYFA İÇERİĞİ'ndeki doğru tarihin üzerine yanlışlıkla tercih edilebilirdi.
    if (isRelevant) result.images.push(...imageUrlsFrom(node.image));
  }
  result.images = result.images.filter(u => typeof u === 'string' && u.trim()).slice(0, 5);
  return result;
}
