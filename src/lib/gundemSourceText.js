// GÜNDEM — MODELE GİDEN KAYNAK METNİN HAZIRLANMASI (kullanıcı isteği, 2026-09-13 madde 8:
// "modele gereksiz HTML, navigation, cookie text, footer, reklam, sosyal medya metni veya tekrar
// eden içeriğin gönderilip gönderilmediğini kontrol et").
//
// NE DEĞİŞTİ VE NEDEN: hat, feed'in `description`'ı ile makale <head>'inin `og:description`'ını
// DÜZ BİR ŞEKİLDE BİRLEŞTİRİP (`[a, b].join(' ')`) modele veriyordu. Canlı feed'lerde ölçülen iki
// somut sorun:
//
//   1. TEKRAR. Dezeen/ArchDaily gibi yayıncılarda `og:description` feed'in `description`'ının
//      BİREBİR AYNISIDIR (ya da ilk cümlesidir). Model aynı metni iki kez görüyordu; bu hem
//      kırpma bütçesinin yarısını yiyordu hem de modeli "bu bilgi önemli, tekrar et" yönünde
//      yanlış koşullandırıyordu.
//   2. BOILERPLATE. Feed `description`'larının sonunda yayıncının kendi eklediği sabit metin
//      bulunur — WordPress tabanlı yayıncılarda "The post X appeared first on Dezeen.",
//      Türkçe kaynaklarda "Devamını oku", "Bu yazı ilk olarak ... yayınlandı", bülten/çerez/
//      paylaş çağrıları. Bunlar içerik DEĞİL, modele giden gürültüdür ve "kaynakta geçen bilgi"
//      sayıldıkları için özete sızabilirler.
//
// AYRICA: kırpma artık KELİMENİN ORTASINDAN değil, CÜMLE SINIRINDAN yapılır (madde 8: "Input çok
// uzunsa anlamlı içerik kaybına yol açacak şekilde rastgele truncate etme"). Yarım kalan bir cümle
// modelin o cümleyi tahminle tamamlamasına — yani uydurmaya — davetiyedir.
//
// KAPSAM SINIRI (bilinçli): bu modül YENİ veri ÇEKMEZ. Kullanıcı isteği "RSS/HTML veri çekme
// sistemini değiştirme" diyor ve mevcut tasarımda makale GÖVDESİ hiç indirilmez (bkz.
// gundemFeed.js#fetchPageMeta — yalnızca <head>). Yani buradaki iş, VAR OLAN metni daha temiz ve
// daha yoğun biçimde modele vermektir; kaynak sayfadan daha fazla metin çekmek değil.

import { EXCERPT_MAX_CHARS } from './gundemQuality.js';
import { foldTr } from './textMatch.js';

// Kaynak metnin YETERLİLİK sınıfları. Kullanıcı isteği madde 7: "RSS yalnızca kısa bir excerpt
// veriyorsa model bunu tam makale gibi yorumlamasın... özeti yapay şekilde uzatma."
// Bu sınıf hem PROMPT'a (hedef uzunluk) hem KALİTE KAPISINA (kabul tabanı) girer — aksi halde
// 15 kelimelik bir excerpt'ten 50 kelimelik özet istemek, modeli doldurmaya yani uydurmaya zorlar.
export const SOURCE_EMPTY_MAX_WORDS = 8;   // bu kadar ve altı: kaynak pratikte hiçbir şey söylemiyor
export const SOURCE_THIN_MAX_WORDS = 45;   // bu kadar ve altı: tek paragraflık excerpt
export const SOURCE_RICH_MIN_WORDS = 90;   // bu kadar ve üstü: sentezlenecek gerçek bir metin var

// -----------------------------------------------------------------------------------------------
// BOILERPLATE DESENLERİ
// -----------------------------------------------------------------------------------------------
// YALNIZCA TARTIŞMASIZ kalıplar. "now open for entries" gibi ifadeler bilerek DIŞARIDA bırakıldı:
// bir yarışma duyurusunda o cümle haberin KENDİSİDİR, boilerplate değil. Buradaki her desen ya
// yayın altyapısının otomatik eklediği bir kuyruk (WordPress "The post ... appeared first on ...")
// ya da bir arayüz çağrısıdır (paylaş/abone ol/çerez).
// TÜRKÇE DESENLERDE \b KULLANILMAZ — GERÇEK BULGU (bu dosyanın regresyon testi, 2026-09-13):
// JavaScript'te `\b` yalnızca ASCII [A-Za-z0-9_] sınıfına göre sınır hesaplar. "ç", "ş", "ı"
// bu sınıfın DIŞINDA olduğundan `/\bçerez\b/` ifadesi "Çerez politikamızı" metniyle HİÇ
// eşleşmez (baştaki "ç" non-word, önündeki boşluk da non-word → sınır yok) ve `/\bPaylaş\b/`
// sondaki "ş" yüzünden aynı şekilde kaçar. Yani Türkçe boilerplate desenleri sessizce ÖLÜ KODDU.
// Çözüm: sınır kontrolü Türkçe harfleri de kapsayan açık lookaround'larla yapılır.
const TW = '[A-Za-z0-9_çğıöşüÇĞİÖŞÜ]';
const B0 = `(?<!${TW})`;  // kelime başı
const B1 = `(?!${TW})`;   // kelime sonu
const tr = (body, flags = 'gi') => new RegExp(`${B0}(?:${body})${B1}`, flags);

const BOILERPLATE_PATTERNS = [
  // WordPress/feed kuyrukları
  /\bThe post\b[^.]*\bappeared first on\b[^.]*\.?/gi,
  /\bThis (?:article|post|story)\b[^.]*\bappeared first on\b[^.]*\.?/gi,
  tr('Bu (?:yazı|haber|içerik)[^.]*ilk olarak[^.]*yayın?lan(?:mıştır|dı)\\.?'),
  // "Devamı", "daha fazla oku" tipi bağlantı metinleri
  /\b(?:Read more|Continue reading|Read the full (?:story|article)|More on this story)\b[^.]*\.?/gi,
  tr('(?:Devamını oku|Devamı için|Haberin devamı|Tümünü oku|Yazının devamı)[^.]*\\.?'),
  // İlgili içerik blokları (feed açıklamasına gömülü olarak geliyor)
  /\bRelated(?:\s+(?:story|stories|article|articles|news))?\s*:\s*[^.]*\.?/gi,
  tr('İlgili\\s+(?:haber|içerik|yazı)(?:ler)?\\s*:\\s*[^.]*\\.?'),
  // Bülten/abonelik/paylaşım/çerez/reklam — arayüz metni, içerik değil
  /\b(?:Subscribe|Sign up)\b[^.]*\bnewsletter\b[^.]*\.?/gi,
  /\bnewsletter\b[^.]*\b(?:subscribe|sign up)\b[^.]*\.?/gi,
  tr('(?:Bültenimize|E-bültenimize)[^.]*(?:abone|kaydol|üye)[^.]*\\.?'),
  /\b(?:Share this|Share on|Follow us on|Join us on)\b[^.]*\.?/gi,
  tr('(?:Paylaş|Bizi takip et|Takip edin)\\s*[:!]?'),
  /\b(?:cookie|cookies)\b[^.]*\b(?:consent|policy|accept|settings)\b[^.]*\.?/gi,
  tr('çerez(?:ler)?(?:i|imizi|leri)?[^.]*(?:politika|kullan|kabul|ayar)\\w*[^.]*\\.?'),
  /\b(?:Advertisement|Sponsored (?:content|post)|Promoted)\b\s*\.?/gi,
  tr('(?:Reklam|Sponsorlu (?:içerik|haber)|İş birliği)\\s*[:.]?'),
  // Yorum/etiket arayüzü
  /\b(?:Leave a comment|Comments? \(\d+\)|View comments)\b[^.]*\.?/gi,
  tr('(?:Yorum yap|Yorumlar \\(\\d+\\)|Yorum yaz)[^.]*\\.?'),
  // "Kaynak: X" / "Source: X" atıf satırı — atıf zaten kartta var, modele bilgi katmaz
  /\b(?:Kaynak|Source)\s*:\s*\S+\s*$/gi,
  // Yarım kalan kuyruklar: "[...]", "…", "(more…)"
  /\[\s*(?:\.{3}|…)\s*\]/g,
  /\(\s*more\s*(?:\.{3}|…)?\s*\)/gi,
];

// HTML/markup artığı: gundemFeed.js#stripHtml zaten etiketleri söküyor ama HTML içinde kalan
// script/style gövdesi ya da kodlanmış varlık artıkları (&#8230;) metne sızabiliyor.
const MARKUP_LEFTOVERS = [
  /&(?:#x?[0-9a-f]+|[a-z]+);/gi,   // çözülmemiş varlık
  /<[^>]*>/g,                       // kaçmış etiket
  /\{[^{}]{0,80}\}/g,               // şablon/CSS artığı
  /https?:\/\/\S+/g,                // çıplak URL — modele bilgi katmaz, token yer
];

// Aynı cümlenin iki kez geçmesi (feed description + og:description birleşiminde en sık görülen
// gürültü). Karşılaştırma foldTr üzerinden yapılır ki büyük/küçük harf ve Türkçe karakter farkı
// aynı cümleyi iki ayrı cümle saymasın.
function dedupeSentences(sentences) {
  const seen = new Set();
  const out = [];
  for (const s of sentences) {
    const key = foldTr(s).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    if (key.length < 3) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// Cümlelere ayır. Kısaltmalar ("St.", "Inc.", "vb.") yüzünden kusursuz bir ayırma mümkün değil;
// burada amaç yayın kalitesinde tipografi değil, (a) tekrar tespiti ve (b) cümle sınırında kırpma.
// Fazla bölmek bu iki işin ikisini de bozmaz.
export function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?…])\s+(?=[A-ZÇĞİÖŞÜ0-9"“'(])/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Metni cümle sınırında kırp. Hiç cümle sınırı yoksa kelime sınırında kırpılır — hiçbir koşulda
// kelimenin ortasından kesilmez.
export function truncateAtSentence(text, maxChars) {
  const s = String(text || '');
  if (s.length <= maxChars) return s;
  const head = s.slice(0, maxChars);
  const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('… '));
  // Kırpma sonrası metnin en az üçte biri kalmalı; aksi halde tek uzun cümlelik bir kaynakta
  // metnin tamamını atmış olurduk. Eşik 0,5 değil 0,35: cümle sınırında kesmek her zaman
  // yeğdir (yarım cümle modeli tahminle tamamlamaya, yani uydurmaya iter) ve 1200 karakterlik
  // bütçede 100-200 karakter feda etmek anlamlı bir bilgi kaybı değildir.
  if (lastStop > maxChars * 0.35) return head.slice(0, lastStop + 1).trim();
  const lastSpace = head.lastIndexOf(' ');
  return (lastSpace > 0 ? head.slice(0, lastSpace) : head).trim();
}

export function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function sourceAdequacy(wordCount) {
  if (wordCount <= SOURCE_EMPTY_MAX_WORDS) return 'empty';
  if (wordCount <= SOURCE_THIN_MAX_WORDS) return 'thin';
  if (wordCount >= SOURCE_RICH_MIN_WORDS) return 'rich';
  return 'normal';
}

// Tek bir metin parçasını temizler (boilerplate + markup + boşluk normalizasyonu).
export function stripBoilerplate(raw) {
  let s = String(raw || '');
  for (const re of MARKUP_LEFTOVERS) s = s.replace(re, ' ');
  for (const re of BOILERPLATE_PATTERNS) s = s.replace(re, ' ');
  return s
    // Tipografik gürültü: tekrarlayan noktalama, kalan ayraç kalıntıları
    .replace(/\s*[|•·»]\s*/g, ' ')
    .replace(/\s*\.{3,}\s*/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// İKİ PARÇANIN ÖRTÜŞMESİ. og:description feed açıklamasının aynısı/ilk cümlesi olduğunda İKİNCİ
// parça hiç eklenmez. Ölçü, ikinci parçanın ayırt edici kelimelerinin ne kadarının birincide
// zaten bulunduğudur — birebir eşitlik aramak yetmez, çünkü yayıncılar aynı metni farklı kırpar.
const OVERLAP_DROP_RATIO = 0.7;

function overlapRatio(candidate, existingFold) {
  const tokens = [...new Set(foldTr(candidate).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3))];
  if (!tokens.length) return 1; // ayırt edici kelimesi yok: bilgi katmıyor, atılabilir
  let hits = 0;
  for (const t of tokens) if (existingFold.includes(t)) hits++;
  return hits / tokens.length;
}

// -----------------------------------------------------------------------------------------------
// ANA GİRİŞ
// -----------------------------------------------------------------------------------------------
// parts: modele verilecek metin parçaları, ÖNEM SIRASIYLA (feed açıklaması, sonra og:description).
// Dönen nesne:
//   text       → modele verilecek temizlenmiş metin (cümle sınırında kırpılmış)
//   words      → kelime sayısı
//   adequacy   → 'empty' | 'thin' | 'normal' | 'rich'
//   dropped    → örtüşme/boşluk nedeniyle atlanan parça sayısı (yalnızca gözlem/log)
//   truncated  → kırpma yapıldı mı
export function buildSourceText(parts, { maxChars = EXCERPT_MAX_CHARS } = {}) {
  const cleaned = [];
  let dropped = 0;
  let fold = '';
  for (const part of parts || []) {
    const c = stripBoilerplate(part);
    if (!c || countWords(c) < 3) { if (part) dropped++; continue; }
    if (fold && overlapRatio(c, fold) >= OVERLAP_DROP_RATIO) { dropped++; continue; }
    cleaned.push(c);
    fold += ` ${foldTr(c).replace(/[^a-z0-9\s]/g, ' ')}`;
  }
  const joined = dedupeSentences(splitSentences(cleaned.join(' '))).join(' ');
  const text = truncateAtSentence(joined, maxChars);
  const words = countWords(text);
  return {
    text,
    words,
    adequacy: sourceAdequacy(words),
    dropped,
    truncated: joined.length > text.length,
  };
}
