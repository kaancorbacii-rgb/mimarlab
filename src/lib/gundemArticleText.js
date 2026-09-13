// GÜNDEM — KAYNAK MAKALENİN GÖVDE METNİNİN ÇIKARILMASI (kullanıcı isteği, 2026-09-13:
// "Gündem sayfasındaki içeriklerin başlıklarını ve metinlerini daha doğru bir Türkçe ve
// özetleme sistemiyle YENİDEN KAYNAKLARDAN ÇEK").
//
// =============================================================================================
// NEDEN GEREKLİ — ÖLÇÜLEN DARBOĞAZ
// =============================================================================================
// Üretim zinciri (bkz. gundemAi.js) bugün itibarıyla kaynağı ANLAYIP yazacak biçimde kurgulandı:
// olgu çıkarımı → editoryal başlık → sentezlenmiş özet → öz-denetim. Ama zincirin ÖNÜNDEKİ
// malzeme değişmedi: modele giden kaynak metin yalnızca (a) feed'in `description` alanı ve
// (b) makale <head>'indeki `og:description` idi. Bu iki alan pratikte AYNI bir-iki cümledir
// (bkz. gundemSourceText.js dosya başı, "TEKRAR" maddesi), yani tipik bir kayıtta modelin elinde
// 20-35 kelime bulunuyordu.
//
// Bunun iki doğrudan sonucu vardı:
//   1. sourceAdequacy neredeyse her zaman 'thin' çıkıyordu → prompt "hedef 35-55 kelime, metni tam
//      makale gibi yorumlama" diyordu → özetler yapısal olarak kısa ve yüzeysel kalıyordu.
//   2. "Kaynağın farklı bölümlerindeki bilgileri sentezle" talimatının KARŞILIĞI YOKTU: ortada
//      tek bir paragraf vardı, sentezlenecek ikinci bir bölüm yoktu. Özet, kaçınılmaz olarak
//      og:description'ın yeniden yazımına dönüşüyordu.
//
// Yani sorun promptta değil, GİRDİDEYDİ. Bu modül girdiyi düzeltir: makalenin kendi gövdesinden
// ilk paragrafları çıkarır, böylece modele 300-500 kelimelik gerçek bir metin gider ve özet
// "çevrilmiş bir cümle" değil, okunmuş bir yazının özeti olur.
//
// =============================================================================================
// "TAM MAKALE KOPYALAMA" YASAĞI İHLAL EDİLMİYOR
// =============================================================================================
// Kural (2026-09-06 madde 6) kaynağın metnini YAYINLAMAYI/SAKLAMAYI yasaklar. Burada:
//   * Gövde metni D1'e YAZILMAZ, KV'ye yazılmaz, API'den dönmez, kullanıcıya hiç gösterilmez.
//     Yalnızca AI çağrısının girdisi olarak bellekte durur ve çağrı bitince düşer.
//   * ARTICLE_MAX_CHARS ile kelepçelenir (2600 karakter ≈ ilk birkaç paragraf) — makalenin
//     tamamı hiçbir koşulda alınmaz.
//   * Yayınlanan tek şey, bu metinden ÜRETİLEN özgün Türkçe başlık ve özettir; zaten kartta
//     kaynak adı ve kaynağa giden bağlantı da bulunur.
//
// =============================================================================================
// NEDEN REGEX, NEDEN "KAPSAYICI BULMA" DEĞİL DE "PARAGRAF TOPLAMA"
// =============================================================================================
// Workers ortamında DOMParser yok ve bu depoda HİÇ npm bağımlılığı yok (bkz. gundemFeed.js dosya
// başı). Readability benzeri bir kapsayıcı-puanlama algoritması iç içe etiketleri saymayı
// gerektirir; regex ile iç içe <div> saymak güvenilir DEĞİLDİR ve yanlış saydığında sessizce
// yanlış bölgeyi döndürür.
//
// Bunun yerine daha dar ama YANILMASI ZOR bir yol seçildi: sayfanın "makale bölgesi" kaba bir
// başlangıç/bitiş işaretiyle daraltılır, o bölgedeki <p> blokları sırayla toplanır ve her biri
// tek tek elenir (çok kısa olan, boilerplate olan, künye/fotoğraf kredisi olan atılır). Bir <p>
// kaçarsa kayıp yalnızca bir paragraftır; yanlış bir bölge seçilmesi gibi bütünsel bir hata
// üretmez. Elde hiç paragraf kalmazsa fonksiyon BOŞ döner ve hat eskisi gibi og:description ile
// çalışmaya devam eder — yani bu modül hiçbir koşulda mevcut davranışı BOZAMAZ.

import { decodeEntities } from './gundemFeed.js';

// Modele giden gövde metninin üst sınırı. EXCERPT_MAX_CHARS (1200) feed açıklaması için
// tasarlanmıştı; gövde metni için ayrı ve daha geniş bir tavan gerekiyor, ama "tam makale"
// olmayacak kadar dar: 2600 karakter tipik bir mimarlık haberinin ilk 4-6 paragrafıdır.
export const ARTICLE_MAX_CHARS = 2600;

// En fazla kaç paragraf alınır. Karakter tavanı zaten var; bu ikinci sınır, çok kısa paragraflarla
// yazılmış sayfalarda (ör. tek cümlelik paragraflar) ilgisiz alanlara kaymayı engeller.
const ARTICLE_MAX_PARAGRAPHS = 14;

// Bir paragrafın "gövde metni" sayılması için en az bu kadar karakter olması gerekir. Altındakiler
// pratikte arayüz metni, etiket listesi, tarih satırı ya da fotoğraf altyazısıdır.
const MIN_PARAGRAPH_CHARS = 60;

// Gövdeye HİÇ girmemesi gereken bloklar. Bunlar önce SÖKÜLÜR; içlerindeki <p>'ler hiç görülmez.
const DROP_BLOCKS = [
  /<script[\s\S]*?<\/script>/gi,
  /<style[\s\S]*?<\/style>/gi,
  /<noscript[\s\S]*?<\/noscript>/gi,
  /<template[\s\S]*?<\/template>/gi,
  /<svg[\s\S]*?<\/svg>/gi,
  /<iframe[\s\S]*?<\/iframe>/gi,
  /<form[\s\S]*?<\/form>/gi,
  /<nav[\s\S]*?<\/nav>/gi,
  /<aside[\s\S]*?<\/aside>/gi,
  /<figcaption[\s\S]*?<\/figcaption>/gi,
  /<blockquote[^>]*class="[^"]*twitter[^"]*"[\s\S]*?<\/blockquote>/gi,
];

// Makale bölgesinin BAŞLANGICI. Sırayla denenir; ilk bulunan kazanır. Hiçbiri yoksa <body> (o da
// yoksa belgenin başı) kullanılır — o durumda paragraf elemesi tek başına çalışır.
const REGION_START = [
  /<article\b[^>]*>/i,
  /<[^>]+itemprop\s*=\s*["']articleBody["'][^>]*>/i,
  /<[^>]+class\s*=\s*["'][^"']*(?:entry-content|article-body|article__body|post-content|post__content|content__article-body|story-body|yazi-icerik|icerik-metin)[^"']*["'][^>]*>/i,
  /<main\b[^>]*>/i,
];

// Makale bölgesinin BİTİŞİ — gövdeden sonra gelen ve gövde SANILABİLECEK bloklar. İlgili içerik
// teaser'ları uzun <p> taşıyabildiği için bu kesme önemlidir.
const REGION_END = [
  /<\/article>/i,
  /<[^>]+(?:id|class)\s*=\s*["'][^"']*(?:related|more-from|read-next|recommend|comments?|disqus|newsletter|subscribe|sidebar|benzer-|ilgili-)[^"']*["'][^>]*>/i,
  /<footer\b/i,
];

// Paragraf düzeyinde eleme. gundemSourceText.js#BOILERPLATE_PATTERNS cümle düzeyinde temizlik
// yapar; buradakiler ise paragrafın TAMAMINI attıran işaretlerdir (fotoğraf kredisi, künye
// listesi, çerez uyarısı, abonelik çağrısı, telif satırı).
const DROP_PARAGRAPH = [
  /^(?:photograph|photo|image|render|visualisation|visualization)s?\s+(?:is|are|by|courtesy)/i,
  /^(?:photography|photos?|images?|renders?)\s*(?::|by)/i,
  /^(?:fotoğraf|görsel|render|çizim)(?:lar)?\s*[::]/i,
  /^(?:words?|text|yazı|metin)\s*[::]/i,
  /^(?:project|proje)\s+(?:credits?|künye)/i,
  /^(?:credits?|künye)\s*[::]?$/i,
  /\b(?:subscribe|sign up)\b[^.]{0,60}\bnewsletter\b/i,
  /(?:bültenimize|e-bültenimize)[^.]{0,60}(?:abone|kaydol)/i,
  /\bcookies?\b[^.]{0,60}\b(?:consent|policy|accept|settings)\b/i,
  /çerez(?:ler)?[^.]{0,60}(?:politika|kabul|ayar)/i,
  /^(?:©|copyright|telif)/i,
  /\ball rights reserved\b/i,
  /^(?:share|paylaş|follow us|bizi takip)/i,
  /^the post\b[\s\S]*\bappeared first on\b/i,
  /^(?:read|see)\s+(?:more|also)\b/i,
  /^(?:ayrıca|devamı|devamını)\s+(?:oku|okuyun|bakın)/i,
  /^advertisement$/i,
];

// <p> ve <h2>/<h3> blokları. Ara başlıklar da alınır: mimarlık yayınlarında ara başlık çoğu zaman
// yazının bir bölümünün konusunu söyler ve modelin "farklı bölümleri sentezlemesine" yardım eder.
const BLOCK_RE = /<(p|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/gi;

// Bir bloğun iç HTML'ini düz metne indirger. stripHtml() burada KULLANILMAZ çünkü o, blok
// sınırlarını boşlukla değiştirirken <br> gibi satır sonlarını da yutuyor; burada <br> anlamlı
// bir ayraçtır (bazı yayıncılar paragrafları <br><br> ile ayırır).
function blockToText(inner) {
  return decodeEntities(
    String(inner || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, '')
  ).replace(/\s+/g, ' ').trim();
}

// Makale bölgesini daralt. Başlangıç işareti bulunamazsa <body>'den, bitiş işareti bulunamazsa
// belgenin sonuna kadar alınır.
export function articleRegion(html) {
  const doc = String(html || '');
  let start = -1;
  for (const re of REGION_START) {
    const m = re.exec(doc);
    if (m) { start = m.index + m[0].length; break; }
  }
  if (start < 0) {
    const body = /<body\b[^>]*>/i.exec(doc);
    start = body ? body.index + body[0].length : 0;
  }
  const rest = doc.slice(start);
  let end = rest.length;
  for (const re of REGION_END) {
    const m = re.exec(rest);
    // Bölgenin HEMEN başındaki bir eşleşme (ör. sayfanın en üstünde duran bir "ilgili" kutusu)
    // gövdeyi sıfırlardı; makul bir taban (400 karakter) altındaki bitişler yok sayılır.
    if (m && m.index > 400 && m.index < end) end = m.index;
  }
  return rest.slice(0, end);
}

// JSON-LD `articleBody` — bazı yayıncılar (ArchDaily dahil) gövdeyi burada düz metin olarak da
// verir. Varsa EN GÜVENİLİR kaynaktır: hiç işaretleme taşımaz, arayüz metni içermez.
export function jsonLdArticleBody(html) {
  const doc = String(html || '');
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(doc)) !== null) {
    let parsed;
    try { parsed = JSON.parse(m[1].trim()); } catch { continue; }
    const stack = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) { stack.push(...node); continue; }
      if (!node || typeof node !== 'object') continue;
      if (typeof node.articleBody === 'string' && node.articleBody.trim().length > 200) {
        return decodeEntities(node.articleBody).replace(/\s+/g, ' ').trim();
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v);
    }
  }
  return '';
}

// -----------------------------------------------------------------------------------------------
// ANA GİRİŞ
// -----------------------------------------------------------------------------------------------
// Dönen değer: makalenin ilk paragraflarından oluşan DÜZ METİN (en fazla ARTICLE_MAX_CHARS).
// Hiçbir şey çıkarılamazsa BOŞ DİZE döner — çağıran taraf bu durumda eski davranışa
// (og:description) düşer, bkz. gundemSourceText.js#buildSourceText.
export function extractArticleText(html, { maxChars = ARTICLE_MAX_CHARS } = {}) {
  let doc = String(html || '');
  if (!doc) return '';

  // JSON-LD, blokları sökmeden ÖNCE okunur (aksi halde <script> ile birlikte silinirdi).
  const fromJsonLd = jsonLdArticleBody(doc);

  for (const re of DROP_BLOCKS) doc = doc.replace(re, ' ');
  const region = articleRegion(doc);

  const paragraphs = [];
  const seen = new Set();
  let m;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(region)) !== null) {
    if (paragraphs.length >= ARTICLE_MAX_PARAGRAPHS) break;
    const text = blockToText(m[2]);
    const isHeading = m[1].toLowerCase() !== 'p';
    if (!text) continue;
    if (!isHeading && text.length < MIN_PARAGRAPH_CHARS) continue;
    // Ara başlıkta karakter tabanı aranmaz ama tek kelimelik arayüz başlıkları da alınmaz.
    if (isHeading && (text.length < 12 || text.length > 200)) continue;
    if (DROP_PARAGRAPH.some(re => re.test(text))) continue;
    const key = text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 120);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    paragraphs.push(isHeading ? `${text.replace(/[.:]\s*$/, '')}.` : text);
  }

  const fromParagraphs = paragraphs.join(' ').replace(/\s+/g, ' ').trim();

  // İki aday arasında UZUN olan seçilir: JSON-LD gövdesi varsa genelde daha eksiksizdir, ama
  // bazı yayıncılar oraya yalnızca ilk paragrafı ya da özeti koyar.
  const best = fromJsonLd.length > fromParagraphs.length ? fromJsonLd : fromParagraphs;
  if (best.length <= maxChars) return best;
  // Kırpma CÜMLE SINIRINDA yapılır (bkz. gundemSourceText.js#truncateAtSentence'taki aynı gerekçe:
  // yarım cümle modeli tahminle tamamlamaya iter).
  const head = best.slice(0, maxChars);
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (stop > maxChars * 0.4) return head.slice(0, stop + 1).trim();
  const space = head.lastIndexOf(' ');
  return (space > 0 ? head.slice(0, space) : head).trim();
}
