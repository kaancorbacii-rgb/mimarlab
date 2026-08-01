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

// response: safeFetch'ten dönen Response (henüz tüketilmemiş). baseUrl: göreli linkleri mutlak
// hale getirmek için kullanılan (yönlendirme sonrası) gerçek sayfa adresi.
export async function extractPageContent(response, baseUrl, { maxChars = AI_MAX_CONTENT_CHARS, maxImages = 60 } = {}) {
  const titleParts = [];
  const textParts = [];
  const images = [];
  const seenImages = new Set();
  let metaDescription = null;
  let heroImage = null;

  function addImage(raw) {
    if (images.length >= maxImages) return;
    const abs = absolutize(raw, baseUrl);
    if (!abs || ICON_PATTERN.test(abs) || seenImages.has(abs)) return;
    seenImages.add(abs);
    images.push(abs);
  }

  let rewriter = new HTMLRewriter()
    .on('title', { text(t) { titleParts.push(t.text); } })
    .on('meta[name="description"]', {
      element(el) { if (!metaDescription) metaDescription = el.getAttribute('content'); },
    })
    .on('meta[property="og:description"]', {
      element(el) { if (!metaDescription) metaDescription = el.getAttribute('content'); },
    })
    .on('meta[property="og:image"]', {
      element(el) { if (!heroImage) heroImage = el.getAttribute('content'); },
    })
    .on('img', {
      element(el) {
        addImage(el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original'));
      },
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

  const heroAbs = absolutize(heroImage, baseUrl);
  const finalImages = [];
  if (heroAbs && !ICON_PATTERN.test(heroAbs)) finalImages.push(heroAbs);
  for (const img of images) if (img !== heroAbs) finalImages.push(img);

  let text = textParts.join(' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  if (text.length > maxChars) text = text.slice(0, maxChars);

  return {
    title: titleParts.join('').trim(),
    metaDescription: metaDescription ? metaDescription.trim() : null,
    text,
    images: finalImages,
  };
}
