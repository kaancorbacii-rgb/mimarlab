// GÜNDEM KALİTE KAPISI + MÜKERRER ANAHTARLARI (kullanıcı isteği, 2026-09-06 madde 8, 10, 26).
//
// TEMEL İLKE (madde 26): "AI ne üretirse yayınla" DEĞİL. Bu dosyadaki her fonksiyon REDDETME
// yönünde çalışır — emin olunamayan içerik yayınlanmaz. "Yanlış pozitif yayınlamaktansa o gün 1
// içerik eksik yayınlanması tercih edilir" kuralı burada uygulanır.

import { foldTr } from './textMatch.js';
import { GUNDEM_IMAGE_HOSTS } from './gundemSources.js';
import { isValidGundemCategory } from './gundemCategories.js';

// Özet uzunluğu — kullanıcı isteği madde 9: "YAKLAŞIK 40-80 kelime".
//
// İKİ AYRI SAYI, bilerek:
//   * SUMMARY_MIN/MAX_WORDS  → modele VERİLEN hedef (prompt bu aralığı söyler).
//   * SUMMARY_MIN/MAX_ACCEPT → KABUL eşiği; hedefin %10 dışına kadar tolere eder.
//
// NEDEN (ölçüm, 2026-09-06 — gerçek modelle 6 içerik üzerinde iki turlu deneme): düzeltmeli
// yeniden deneme sonrası model 37 ve 39 kelimelik, içerik olarak KUSURSUZ özetler üretti ve sert
// 40 tabanı bunları eledi. İsteğin kendi ifadesi "yaklaşık" olduğundan, tek kelimelik sapmayı
// yayın engeline çevirmek isteği daha iyi karşılamıyor — aksine iyi içeriği kaybettiriyordu
// (madde 26'nın "eksik yayınlamak yeğdir" ilkesi ŞÜPHELİ içerik içindir, doğru ama 3 kelime kısa
// içerik için değil). Gerçekten kısa olan (22-27 kelime) çıktılar bu bandın de dışında kalır ve
// elenmeye devam eder.
export const SUMMARY_MIN_WORDS = 40;
export const SUMMARY_MAX_WORDS = 80;
export const SUMMARY_MIN_ACCEPT = 36;
export const SUMMARY_MAX_ACCEPT = 88;
export const TITLE_MIN_CHARS = 12;
export const TITLE_MAX_CHARS = 140;

// AI'ye giden kaynak metnin üst sınırı. "Tam makale kopyalama" yasağının (madde 6) teknik
// karşılığı: gövde zaten hiç çekilmiyor, feed'in kendi kısa açıklaması bile bu sınırla kırpılıyor.
export const EXCERPT_MAX_CHARS = 1200;

// -----------------------------------------------------------------------------------------------
// MÜKERRER ANAHTARLARI
// -----------------------------------------------------------------------------------------------

// URL'i mükerrer kontrolü için normalize eder: şema/host küçültülür, "www." atılır, izleme
// parametreleri (utm_*, fbclid vb.) SİLİNİR, sondaki eğik çizgi kaldırılır. AYNI haberin
// bültenden/sosyal medyadan gelen farklı takip parametreli URL'i böylece aynı anahtara düşer.
export function normalizeSourceUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return String(raw || '').trim().toLowerCase(); }
  u.hash = '';
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  const drop = [];
  u.searchParams.forEach((_, key) => {
    if (/^(utm_|ref$|ref_|fbclid$|gclid$|mc_cid$|mc_eid$|source$|_ga$)/i.test(key)) drop.push(key);
  });
  drop.forEach(k => u.searchParams.delete(k));
  u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return u.href.replace(/\?$/, '');
}

// Başlık anahtarı — AYNI haberi FARKLI URL (hatta farklı kaynak) üzerinden ikinci kez yayınlamayı
// engelleyen 4. basamak. Türkçe katlama (foldTr) + noktalama temizliği + çok kısa/işlevsel
// kelimelerin atılması + alfabetik sıralama: kelime sırası değişmiş ("OMA completes centre" vs
// "New centre completed by OMA") başlıklar bile aynı anahtara düşer.
const TITLE_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'by', 'with', 'from', 'is', 'are', 'as', 'its', 'new',
  've', 'ile', 'bir', 'bu', 'icin', 'da', 'de', 'den', 'dan', 'nin', 'nun', 'yeni',
]);
export function titleKey(title) {
  const words = foldTr(String(title || ''))
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !TITLE_STOPWORDS.has(w));
  // 12 kelimeden sonrası ayırt edici değil, yalnızca gürültü — uzun başlıklarda kuyruk farkı
  // yüzünden aynı haberin iki kez geçmesini önler.
  return [...new Set(words)].sort().slice(0, 12).join(' ');
}

// İçerik parmak izi (3. basamak) — normalize başlık + kaynak alıntısının ilk 400 karakteri.
// SHA-256, crypto.subtle ile (Workers'ta yerleşik, ek bağımlılık yok).
export async function contentHash(title, excerpt) {
  const basis = `${titleKey(title)}::${foldTr(String(excerpt || '')).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(basis));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// -----------------------------------------------------------------------------------------------
// PROJE YAYINI KAPISI (kullanıcı isteği, 2026-09-07 madde 4: "bu kısımda proje içeriği
// yayınlamanı istemiyorum")
// -----------------------------------------------------------------------------------------------
// MİMARLAB'ın ZATEN bir /proje bölümü var; Gündem'in tek tek yapı/proje tanıtımlarıyla dolması
// hem o bölümü tekrarlar hem de "bugün ne oluyor?" sorusunu cevaplamaz.
//
// UCUZ ÖN FİLTRE — AI'DEN ÖNCE ÇALIŞIR, dolayısıyla elenen içerik için AI çağrısı HARCANMAZ.
// ArchDaily/Archello gibi yayınlar proje gönderilerini değişmez bir kalıpla adlandırır:
//   "Grava House / remyarchitects"           "Plaza Corporate - North Tower / Biselli Katchborian"
// Yani "<yapı adı> / <ofis adı>". Makaleler bu kalıbı KULLANMAZ:
//   "Building the India of the Imagination: Cinema and the Making of Place"
// Eğik çizgi etrafında boşluk + iki tarafta da makul uzunlukta metin + başlıkta iki nokta/soru
// işareti gibi makale işaretlerinin OLMAMASI aranır.
//
// Bu ön filtre YALNIZCA bariz kalıbı yakalar; asıl karar AI'nin isProject alanındadır (bkz.
// gundemAi.js) — model, kalıba uymayan proje tanıtımlarını da işaretleyebilir.
const ARTICLE_MARKERS = /[:?]|^\d+\s|\b(guide|roundup|how|why|what|interview|opinion|list|best|top)\b/i;
export function looksLikeProjectPublication(title) {
  const s = String(title || '').trim();
  if (!s) return false;
  const m = /^(.{4,90})\s+\/\s+(.{2,80})$/.exec(s);
  if (!m) return false;
  // Sağ taraf (ofis adı) çok uzunsa ya da başlıkta makale işaretleri varsa proje sayma.
  if (ARTICLE_MARKERS.test(s)) return false;
  return true;
}

// -----------------------------------------------------------------------------------------------
// SİTELER ARASI MÜKERRER (kullanıcı isteği, 2026-09-07 madde 6: "Farklı sitelerde aynı içerikler
// olabilir buna dikkat et")
// -----------------------------------------------------------------------------------------------
// Mevcut dört basamak (source_url / canonical / content_hash / title_key) kaynağın KENDİ dilindeki
// metinden üretilir; bu yüzden aynı olayı farklı kelimelerle ya da farklı dilde yazan İKİ AYRI
// SİTE yakalanamıyordu (bkz. gundemIngest.js dosya başındaki "BİLİNEN SINIR" notu).
//
// ÇÖZÜM: karşılaştırmayı KAYNAK metninde değil, AI'nin ürettiği TÜRKÇE BAŞLIKTA yap. İki farklı
// site aynı olayı anlattığında Türkçe özetleri de aynı ayırt edici adları taşır ("OMA", "Seul",
// "Bauhaus") — çünkü ikisi de aynı olguyu özetliyor. Jaccard benzerliği bu örtüşmeyi ölçer.
//
// Vectorize/embedding EKLENMEDİ (kullanıcı isteği madde 29'da açıkça kapsam dışı); bu yöntem
// ek altyapı gerektirmez ve yalnızca zaten üretilmiş metni kullanır.
//
// EŞİK 0.55: ayırt edici token'ların yarısından fazlası ortaksa aynı olay sayılır. Daha düşük bir
// eşik farklı ama benzer konulu haberleri (iki ayrı yarışma duyurusu) yanlışlıkla birleştirirdi.
export const CROSS_SOURCE_SIMILARITY = 0.55;

export function titleTokenSet(title) {
  return new Set(
    foldTr(String(title || ''))
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !TITLE_STOPWORDS.has(w))
  );
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Yeni Türkçe başlık, YAKIN GEÇMİŞTEKİ yayınlardan biriyle aynı olayı mı anlatıyor?
// `recentTitles` çağıran tarafça (son N gün) verilir — tüm tabloyu taramak gereksiz.
export function findCrossSourceDuplicate(newTitle, recentTitles) {
  const a = titleTokenSet(newTitle);
  if (a.size < 2) return null; // ayırt edici token yoksa karar verilemez, engelleme
  for (const row of recentTitles || []) {
    const score = jaccard(a, titleTokenSet(row.title));
    if (score >= CROSS_SOURCE_SIMILARITY) return { slug: row.slug, title: row.title, score: Math.round(score * 100) / 100 };
  }
  return null;
}

// -----------------------------------------------------------------------------------------------
// GÖRSEL KAPISI
// -----------------------------------------------------------------------------------------------

// Görsel host'u, kaynak yapılandırmasında BEYAN EDİLMİŞ host'lardan biri olmalı. İki nedenle:
// (1) beyan edilmemiş bir host CSP img-src'de de olmayacağından kart canlıda görselsiz kalırdı —
// sessiz bir bozulma; (2) yayıncının kendi CDN'i dışında bir yere (ör. feed'e gömülü üçüncü taraf
// reklam/tracker görseli) bağlanmayı engeller.
export function isAllowedImageHost(imageUrl, source) {
  if (!imageUrl) return false;
  let host;
  try {
    const u = new URL(imageUrl);
    if (u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch { return false; }
  const declared = (source && source.imageHosts) || [];
  // Kaynağın kendi beyanı VE global CSP listesi — ikisinde de olmalı (ikinci kontrol, bir kaynağın
  // yanlışlıkla enabled:false kalıp host'unun CSP'ye girmemiş olması durumunu yakalar).
  return declared.includes(host) && GUNDEM_IMAGE_HOSTS.includes(host);
}

// -----------------------------------------------------------------------------------------------
// AI ÇIKTISI DOĞRULAMASI (madde 10)
// -----------------------------------------------------------------------------------------------

export function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

// Tek paragraf mı? Satır sonu/çift boşluk/madde imi taşıyan bir çıktı "tek paragraf" değildir.
export function isSingleParagraph(text) {
  const s = String(text || '');
  return !/\n/.test(s) && !/[••]\s/.test(s) && !/^\s*[-*]\s/m.test(s);
}

// Türkçe mi? Dil tespiti için ağır bir kütüphane eklemek yerine (kapsam dışı) iki ucuz sinyal:
// (a) Türkçeye özgü harflerin ya da (b) yüksek frekanslı Türkçe işlev kelimelerinin varlığı.
// Model yanlışlıkla İngilizce özet üretirse ikisi de tutmaz ve içerik reddedilir. Yanlış NEGATİF
// (gerçekten Türkçe bir metni reddetmek) yayın kaybına yol açar ama yanlış POZİTİFTEN (İngilizce
// metni Türkçe sanıp yayınlamak) tercih edilir — bu dosyanın temel ilkesi.
const TR_FUNCTION_WORDS = /\b(ve|ile|için|olarak|bir|bu|olan|yer|tarafından|üzerine|arasında|yeni|proje|tasarım|yapı|mimar|kent|bina|ofis)\b/i;
export function looksTurkish(text) {
  const s = String(text || '');
  if (/[çğıöşüÇĞİÖŞÜ]/.test(s)) return true;
  return TR_FUNCTION_WORDS.test(s);
}

// İngilizceye ÖZGÜ işlev kelimeleri. looksTurkish'in tersi DEĞİLDİR: bir metin ikisine de
// uymayabilir (ör. yalnızca özel adlardan oluşan kısa bir başlık).
// EŞİK 2 (ölçüm, 2026-09-06): tek bir İngilizce kelime yeterli sayılınca "The Overlook Evi"
// gibi ÇEVRİLMİŞ ama özgün adının artikelini koruyan başlıklar da eleniyordu. Gerçekten
// çevrilmemiş bir başlık ("OMA completes new cultural centre in Seoul") her zaman birden fazla
// İngilizce işlev kelimesi taşır — iki eşiği yanlış pozitifleri keser, gerçek hedefi kaçırmaz.
const EN_FUNCTION_WORDS = /\b(the|of|and|with|for|from|by|into|its|their|that|this|has|have|will|are|is|in|on|at|as|new|a|an|to)\b/gi;
export function englishWordHits(text) {
  const m = String(text || '').match(EN_FUNCTION_WORDS);
  return m ? new Set(m.map(w => w.toLowerCase())).size : 0;
}
export function looksEnglish(text) {
  return englishWordHits(text) >= 2;
}

// BAŞLIK dil kapısı — özet kapısından AYRI ve bilerek daha gevşek.
//
// GERÇEK BULGU (ilk canlı tur, 2026-09-06 20:30): 8 içeriğin 3'ü `title_not_turkish` ile elendi.
// Kapı, başlıkta da looksTurkish() arıyordu; ama geçerli bir Türkçe başlık ÖZEL ADLARDAN ibaret
// olabilir ve ne Türkçe'ye özgü bir harf ne de bir Türkçe işlev kelimesi içerebilir —
// ör. "Plaza Corporate Kuzey Kulesi". Bunlar doğru çevirilerdi ve yayınlanmaları gerekirdi.
// Özet (40-80 kelime akıcı Türkçe) için aynı kontrol güvenilirdir ve orada KORUNUR; asıl yakalamak
// istediğimiz "model başlığı hiç çevirmedi" durumu ise burada doğrudan sorulur: başlık İNGİLİZCE
// işlev kelimesi taşıyor VE hiçbir Türkçe işareti yoksa reddedilir.
export function titleLanguageOk(title) {
  if (looksTurkish(title)) return true;
  return !looksEnglish(title);
}

// AI ÇIKTISI KAYNAKLA İLGİLİ Mİ? (madde 10: "title kaynakla alakasız mı?", "AI kaynakta olmayan
// bariz entity üretmiş mi?")
//
// Yakalanmak İSTENEN: modelin konuyu tamamen kaybedip başka bir haber uydurması.
// Yakalanmak İSTENMEYEN: doğru ama serbest çevrilmiş bir başlık — madde 9 birebir çeviriyi AÇIKÇA
// serbest bırakıyor.
//
// GERÇEK BULGU (bu testlerin kendisi sırasında): ilk sürüm YALNIZCA başlığa bakıyor ve yalnızca
// 4+ karakterli token'ları sayıyordu. İki ayrı yoldan YANLIŞ NEGATİF üretiyordu:
//   (a) Şehir adları çeviride yerelleşir — "Seoul" → "Seul", "London" → "Londra". Doğru bir Türkçe
//       başlık kaynakla tek bir kelime bile paylaşmayabiliyordu.
//   (b) Mimarlıkta en ayırt edici özel adlar 3 harflidir (OMA, BIG, SOM, HOK, KPF) ve 4 karakter
//       eşiği tam da bunları eliyordu.
// Yanlış negatif "o gün 1 içerik eksik yayınlanır" demek DEĞİL, "o kaynaktan hiçbir şey yayınlanmaz"
// demekti — kapı, koruduğu şeyden çok daha fazlasını kesiyordu.
//
// ŞİMDİKİ ÖLÇÜ, iki kademeli:
//   1. Başlıktan en az BİR ayırt edici token kaynakta geçiyorsa → geçer (güçlü sinyal).
//   2. Geçmiyorsa özete bakılır: özet 40-80 kelimedir ve kaynaktan türetilmiştir, konu korunmuşsa
//      birkaç token mutlaka tutar. Burada eşik İKİ farklı token — tek bir tesadüfi kelimenin kapıyı
//      açmasını engeller.
// İkisi de tutmazsa model başka bir şeyden bahsediyordur ve içerik yayınlanmaz.
const OVERLAP_MIN_TOKEN_LEN = 3;
function distinctOverlapCount(text, haystack) {
  const tokens = new Set(
    foldTr(String(text || ''))
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= OVERLAP_MIN_TOKEN_LEN && !TITLE_STOPWORDS.has(w))
  );
  let hits = 0;
  for (const t of tokens) if (haystack.includes(t)) hits++;
  return hits;
}

export function titleOverlapsSource(aiTitle, sourceTitle, sourceExcerpt, aiSummary) {
  const haystack = foldTr(`${sourceTitle || ''} ${sourceExcerpt || ''}`);
  if (!haystack.trim()) return true; // kaynak hiç metin vermemişse bu kapı bir şey söyleyemez
  if (distinctOverlapCount(aiTitle, haystack) >= 1) return true;
  return distinctOverlapCount(aiSummary, haystack) >= 2;
}

// Tam doğrulama. Dönen `ok:false` her zaman bir `reason` taşır — bu değer cron loglarındaki
// skipped sayacının kırılımına girer (bkz. gundemIngest.js), yani hangi kapının kaç içeriği
// elediği canlıda ölçülebilir kalır.
export function validateAiOutput(ai, ctx) {
  if (!ai || typeof ai !== 'object') return { ok: false, reason: 'ai_not_object' };

  const title = typeof ai.title === 'string' ? ai.title.trim() : '';
  const summary = typeof ai.summary === 'string' ? ai.summary.replace(/\s+/g, ' ').trim() : '';

  if (!title) return { ok: false, reason: 'title_empty' };
  if (title.length < TITLE_MIN_CHARS) return { ok: false, reason: 'title_too_short' };
  if (title.length > TITLE_MAX_CHARS) return { ok: false, reason: 'title_too_long' };
  if (!titleLanguageOk(title)) return { ok: false, reason: 'title_not_turkish' };
  // NOT: kaynakla ilgililik kapısı BİLEREK aşağıda, özet doğrulandıktan SONRA çalışır — ölçü artık
  // başlık + özetin BİRLİKTE değerlendirilmesine dayanıyor (bkz. titleOverlapsSource'un iki kademeli
  // gerekçesi). Önce buradaydı ve özeti hiç göremediği için doğru içerikleri eliyordu.
  // Clickbait/promosyon kalıpları — modelin talimatı çiğnediği en görünür işaret.
  if (/(tıkla|kaçırma|inanamayacaksınız|şok|müthiş|efsane|hemen incele|şimdi satın)/i.test(title)) {
    return { ok: false, reason: 'title_clickbait' };
  }

  if (!summary) return { ok: false, reason: 'summary_empty' };
  if (!isSingleParagraph(ai.summary)) return { ok: false, reason: 'summary_not_single_paragraph' };
  const words = wordCount(summary);
  if (words < SUMMARY_MIN_ACCEPT) return { ok: false, reason: 'summary_too_short' };
  if (words > SUMMARY_MAX_ACCEPT) return { ok: false, reason: 'summary_too_long' };
  if (!looksTurkish(summary)) return { ok: false, reason: 'summary_not_turkish' };
  // Modelin "özetleyemedim/bilgi yok" gibi meta yanıtları — içerik değil, hata sinyalidir.
  if (/(yeterli bilgi (yok|bulunmuyor)|özetleyemiyorum|as an ai|kaynak metin)/i.test(summary)) {
    return { ok: false, reason: 'summary_meta_response' };
  }

  // HALÜSİNASYON KAPISI — başlık VE özet birlikte kaynakla karşılaştırılır (bkz. yukarıdaki
  // titleOverlapsSource gerekçesi). Buraya kadar gelen çıktı biçimsel olarak kusursuzdur; burada
  // sorulan tek şey "bu gerçekten AYNI haber mi?".
  if (!titleOverlapsSource(title, ctx.sourceTitle, ctx.sourceExcerpt, summary)) {
    return { ok: false, reason: 'title_unrelated' };
  }

  // Kategori: AI önerisi YALNIZCA whitelist'ten kabul edilir; dışındaysa sessizce kaynağın
  // varsayılanına düşülür (içerik reddedilmez — kategori kurtarılabilir bir alandır).
  const category = isValidGundemCategory(ai.category) ? ai.category : ctx.fallbackCategory;
  if (!isValidGundemCategory(category)) return { ok: false, reason: 'category_invalid' };

  return { ok: true, title, summary, category };
}
