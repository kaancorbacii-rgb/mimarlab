// GÜNDEM — HTML LİSTE SAYFASI ÇIKARIMI (kullanıcı isteği, 2026-09-07 madde 8).
//
// NE ZAMAN KULLANILIR: yalnızca kaynağın RSS/Atom'u YOKSA ya da robots.txt tarafından KAPATILMIŞSA.
// Bu, orijinal isteğin "RSS/API varsa ÖNCELİKLE onu kullan" kuralının korunmuş hâlidir — HTML
// çıkarımı bir tercih değil, son çaredir ve kaynak kaynak gerekçelendirilir.
//
// GERÇEK ÖRNEK (mimdap.org, ölçüm 2026-09-07): kategori feed'leri teknik olarak ÇALIŞIYOR
// (200, 10 item) ama sitenin robots.txt'si `Disallow: */feed/` diyor. Feed'i kullanmak robots'u
// çiğnemek olurdu; kategori SAYFALARI ise robots'ta açık (`Allow: /`, yalnızca /wp-admin/ vb.
// kapalı) ve kullanıcının verdiği adresler zaten bunlar. Bu yüzden mimdap HTML'den okunur.
//
// TASARIM: HTML yapısı siteye özgüdür, "genel bir liste ayrıştırıcısı" yazmak kırılgan olurdu
// (sessizce yanlış alan okuyup uydurma içerik üretebilirdi). Bunun yerine kaynak başına AÇIK bir
// çıkarıcı yazılır ve EXTRACTORS kaydına eklenir. Bir site şablonunu değiştirirse çıkarıcı sıfır
// item döner — içerik uydurulmaz, kaynak o turda sessizce boş geçer (bkz. gundemIngest'in
// kaynak sağlığı sayacı bunu görünür kılar).
//
// GÜVENLİK: buradan çıkan hiçbir değer HTML olarak render edilmez; metinler stripHtml'den,
// URL'ler new URL() doğrulamasından geçer — gundemFeed.js ile aynı sözleşme.

import { stripHtml, decodeEntities, normalizeImageUrl } from './gundemFeed.js';

// Türkçe ay adları — mimdap tarihleri "6 Eylül 2026" biçiminde basıyor.
const TR_MONTHS = {
  ocak: 0, şubat: 1, subat: 1, mart: 2, nisan: 3, mayıs: 4, mayis: 4, haziran: 5,
  temmuz: 6, ağustos: 7, agustos: 7, eylül: 8, eylul: 8, ekim: 9, kasım: 10, kasim: 10, aralık: 11, aralik: 11,
};

export function parseTurkishDate(text) {
  const m = /(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})/.exec(String(text || ''));
  if (!m) return null;
  const month = TR_MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;
  // UTC öğlen: saat dilimi kaymasının günü bir gün öne/arkaya atmasını engeller (tarih yalnızca
  // gün hassasiyetinde biliniyor, saat bilgisi yok).
  const d = Date.UTC(Number(m[3]), month, Number(m[1]), 12, 0, 0);
  if (!Number.isFinite(d)) return null;
  return d;
}

// --------------------------------------------------------------------------------------------
// mimdap.org — WordPress teması, kategori sayfası <article> blokları.
// Yapı (ölçüm 2026-09-07): her <article id="post-NNNN"> içinde
//   görsel : <img data-src="https://mimdap.org/wp-content/uploads/..."> (tembel yükleme; gerçek
//            adres data-src'de, ayrıca <noscript><img src=...> kopyasında)
//   başlık : <h3 ...><a href="URL">Başlık</a></h3>
//   tarih  : <div class="text-xs text-secondary ...">6 Eylül 2026</div>
//   özet   : <p class="line-clamp-3 ...">...</p>
// --------------------------------------------------------------------------------------------
function extractMimdap(html, baseUrl) {
  const blocks = html.match(/<article[^>]*\bid="post-\d+"[\s\S]*?<\/article>/gi) || [];
  return blocks.map(block => {
    const linkMatch = /<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!linkMatch) return null;
    const link = decodeEntities(linkMatch[1]);
    const title = stripHtml(linkMatch[2]);
    if (!link || !title) return null;

    // data-src ÖNCE denenir: tembel yükleyici gerçek adresi oraya koyar, src'de base64 yer tutucu
    // bulunur. Yer tutucuyu görsel sanmamak için data: şemalı değerler normalizeImageUrl'de
    // zaten eleniyor, ama sırayı doğru kurmak gereksiz bir <noscript> ayrıştırmasını da önler.
    const dataSrc = /<img[^>]+data-src="([^"]+)"/i.exec(block);
    const noscriptSrc = /<noscript>\s*<img[^>]+src="([^"]+)"/i.exec(block);
    const plainSrc = /<img[^>]+src="(?!data:)([^"]+)"/i.exec(block);
    const rawImage = (dataSrc && dataSrc[1]) || (noscriptSrc && noscriptSrc[1]) || (plainSrc && plainSrc[1]) || null;

    const dateMatch = /<div[^>]*class="[^"]*text-secondary[^"]*"[^>]*>\s*([^<]{6,40}?)\s*<\/div>/i.exec(block);
    const excerptMatch = /<p[^>]*class="[^"]*line-clamp-3[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block);

    return {
      title,
      link,
      guid: link,
      publishedAt: dateMatch ? parseTurkishDate(dateMatch[1]) : null,
      author: null,
      categories: [],
      excerpt: excerptMatch ? stripHtml(excerptMatch[1]) : '',
      image: normalizeImageUrl(rawImage ? decodeEntities(rawImage) : null, baseUrl),
    };
  }).filter(Boolean);
}

// Kaynak id -> çıkarıcı. Yeni bir HTML kaynağı eklemek = burada bir satır + kendi çıkarıcısı.
const EXTRACTORS = {
  mimdap: extractMimdap,
};

export function hasHtmlExtractor(sourceId) {
  return Object.prototype.hasOwnProperty.call(EXTRACTORS, sourceId);
}

// Bir HTML liste sayfasını, gundemFeed.js#parseFeed ile AYNI şekildeki item dizisine çevirir —
// böylece hattın geri kalanı (mükerrer/görsel/AI/kalite) kaynağın RSS mi HTML mi olduğunu hiç
// bilmez ve iki yol için ayrı mantık oluşmaz.
export function parseHtmlList(sourceId, html, baseUrl) {
  const fn = EXTRACTORS[sourceId];
  if (!fn) return [];
  try {
    return fn(String(html || ''), baseUrl).filter(it => it.title && it.link);
  } catch {
    // Şablon değiştiyse sessizce boş dön — uydurma içerik üretmektense hiç içerik üretmemek.
    return [];
  }
}
