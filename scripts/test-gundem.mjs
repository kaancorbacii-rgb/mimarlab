#!/usr/bin/env node
// GÜNDEM BİRİM TESTLERİ (kullanıcı isteği, 2026-09-06 madde 25).
//
// Bu depoda test koşucusu (jest/vitest) YOK ve npm bağımlılığı da yok — bu yüzden testler Node'un
// KENDİ `node:assert` modülüyle, tek bir çalıştırılabilir ESM dosyası olarak yazıldı. Aynı desen
// scripts/preflight-check.sh'in çalıştırdığı diğer statik kontrollerle uyumludur ve deploy hattına
// oradan bağlanır (preflight başarısız olursa deploy HİÇ BAŞLAMAZ).
//
// KAPSAM: hattın SAF (ağ/D1 gerektirmeyen) katmanları — feed ayrıştırma, mükerrer anahtarları,
// kalite kapısı, kategori whitelist'i, entity eşleştirme, görsel host doğrulaması, kaynak
// yapılandırmasının tutarlılığı. Ağ/D1 gerektiren uçlar (cron turu, /api/gundem, SSR) canlı
// doğrulamayla test edilir (bkz. scripts/smoke-test.sh'e eklenen Gündem bölümü).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseFeed, stripHtml, decodeEntities, normalizeImageUrl, extractPageMeta, feedTimeoutFor } from '../src/lib/gundemFeed.js';
import {
  normalizeSourceUrl, titleKey, contentHash, isAllowedImageHost, validateAiOutput,
  wordCount, isSingleParagraph, looksTurkish, looksEnglish, englishWordHits, titleLanguageOk, titleOverlapsSource,
  looksLikeProjectPublication, findCrossSourceDuplicate, jaccard, titleTokenSet,
} from '../src/lib/gundemQuality.js';
import { GUNDEM_CATEGORY_KEYS, isValidGundemCategory } from '../src/lib/gundemCategories.js';
import { GUNDEM_SOURCES, activeGundemSources, GUNDEM_IMAGE_HOSTS } from '../src/lib/gundemSources.js';
import { buildGundemEntityIndex, resolveGundemEntities } from '../src/lib/gundemEntities.js';
import { _isSourceDueForTests, classifyGundemRun } from '../src/lib/gundemIngest.js';
import { runRowFromStats, persistGundemRun, readLastGundemRun, assessGundemCronHealth, gundemCronHealthFields, GUNDEM_CRON_STALE_MS } from '../src/lib/gundemRuns.js';
import worker, { handleScheduled } from '../src/index.js';
import { hasHtmlExtractor, parseHtmlList, parseTurkishDate } from '../src/lib/gundemHtmlList.js';

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, message: err.message });
    console.error(`  FAIL ${name}\n       ${err.message.split('\n')[0]}`);
  }
}

function section(title) { console.log(`\n${title}`); }

// 40-80 kelime aralığında geçerli bir Türkçe özet üretir (testlerde tekrar tekrar lazım).
function validSummary(words = 55) {
  const base = 'Proje kentin merkezinde yer alan tarihi dokuyla ilişki kuran bir yapı olarak tasarlandı ve mimarlar cephede yerel taş ile ahşap malzemeyi bir arada kullandı';
  const tokens = base.split(' ');
  const out = [];
  while (out.length < words) out.push(tokens[out.length % tokens.length]);
  return out.slice(0, words).join(' ');
}

// =================================================================================================
section('1) Feed ayrıştırma (RSS/Atom)');
// =================================================================================================

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>Örnek</title>
  <item>
    <title><![CDATA[OMA completes new cultural centre in Seoul]]></title>
    <link>https://example.com/2026/09/oma-seoul-cultural-centre/</link>
    <dc:creator><![CDATA[Test Author]]></dc:creator>
    <pubDate>Sat, 06 Sep 2026 10:00:00 +0000</pubDate>
    <category><![CDATA[Competitions]]></category>
    <category><![CDATA[Korea]]></category>
    <guid isPermaLink="false">https://example.com/?p=1</guid>
    <description><![CDATA[<p>The building &amp; its plaza opened this week.</p>]]></description>
    <enclosure url="http://cdn.example.com/img/seoul.jpg" type="image/jpeg" length="0" />
  </item>
  <item>
    <title>İkinci içerik</title>
    <link>https://example.com/ikinci/</link>
    <pubDate>Fri, 05 Sep 2026 08:00:00 +0000</pubDate>
    <content:encoded><![CDATA[<div><img src="https://cdn.example.com/img/ikinci.jpg" width="800"><p>Gövde metni.</p></div>]]></content:encoded>
  </item>
</channel>
</rss>`;

await test('RSS: item sayısı, başlık CDATA, link, yazar, kategoriler', () => {
  const items = parseFeed(RSS_FIXTURE);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'OMA completes new cultural centre in Seoul');
  assert.equal(items[0].link, 'https://example.com/2026/09/oma-seoul-cultural-centre/');
  assert.equal(items[0].author, 'Test Author');
  assert.deepEqual(items[0].categories, ['Competitions', 'Korea']);
});

await test('RSS: enclosure görseli okunur ve https\'e yükseltilir', () => {
  const items = parseFeed(RSS_FIXTURE);
  assert.equal(items[0].image, 'https://cdn.example.com/img/seoul.jpg');
});

await test('RSS: enclosure yoksa gövdedeki ilk <img> kullanılır', () => {
  const items = parseFeed(RSS_FIXTURE);
  assert.equal(items[1].image, 'https://cdn.example.com/img/ikinci.jpg');
});

await test('RSS: description HTML\'i düz metne indirgenir, varlıklar çözülür', () => {
  const items = parseFeed(RSS_FIXTURE);
  assert.equal(items[0].excerpt, 'The building & its plaza opened this week.');
});

await test('RSS: pubDate epoch-ms\'e çevrilir', () => {
  const items = parseFeed(RSS_FIXTURE);
  assert.equal(items[0].publishedAt, Date.parse('Sat, 06 Sep 2026 10:00:00 +0000'));
});

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom başlığı</title>
    <link rel="alternate" href="https://example.org/atom-yazi"/>
    <id>tag:example.org,2026:1</id>
    <published>2026-09-04T12:00:00Z</published>
    <summary>Atom özeti.</summary>
  </entry>
</feed>`;

await test('Atom: <entry> + rel="alternate" link ayrıştırılır', () => {
  const items = parseFeed(ATOM_FIXTURE);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Atom başlığı');
  assert.equal(items[0].link, 'https://example.org/atom-yazi');
  assert.equal(items[0].publishedAt, Date.parse('2026-09-04T12:00:00Z'));
});

await test('Bozuk/boş XML çökmez, boş dizi döner', () => {
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed('<html><body>not a feed</body></html>'), []);
  assert.deepEqual(parseFeed(null), []);
});

await test('Absürt tarihler (1970 öncesi / uzak gelecek) null\'a düşer', () => {
  const old = parseFeed(RSS_FIXTURE.replace('Sat, 06 Sep 2026 10:00:00 +0000', 'Mon, 01 Jan 1900 00:00:00 +0000'));
  assert.equal(old[0].publishedAt, null);
});

await test('decodeEntities: sayısal + adlandırılmış varlıklar', () => {
  assert.equal(decodeEntities('a &amp; b &#8212; c &hellip;'), 'a & b — c …');
  // Tanınmayan varlık olduğu gibi bırakılır (uydurma yok).
  assert.equal(decodeEntities('&bilinmeyen;'), '&bilinmeyen;');
});

await test('stripHtml: script/style içerikleri de temizlenir', () => {
  assert.equal(stripHtml('<p>a</p><script>alert(1)</script><b>b</b>'), 'a b');
});

await test('normalizeImageUrl: geçersiz/protokolsüz URL null döner', () => {
  assert.equal(normalizeImageUrl('javascript:alert(1)'), null);
  assert.equal(normalizeImageUrl('not a url'), null);
  assert.equal(normalizeImageUrl(''), null);
  assert.equal(normalizeImageUrl('/rel.jpg', 'https://x.com/a/b'), 'https://x.com/rel.jpg');
});

await test('extractPageMeta: og:image/og:description/canonical <head>\'den okunur', () => {
  const html = `<html><head>
    <meta property="og:image" content="https://cdn.example.com/og.jpg">
    <meta name="og:description" content="Kısa açıklama">
    <link rel="canonical" href="https://example.com/kanonik">
    </head><body><meta property="og:image" content="https://kotu.example/sahte.jpg"></body></html>`;
  const meta = extractPageMeta(html, 'https://example.com/sayfa');
  assert.equal(meta.image, 'https://cdn.example.com/og.jpg');
  assert.equal(meta.description, 'Kısa açıklama');
  assert.equal(meta.canonical, 'https://example.com/kanonik');
});

// =================================================================================================
section('2) TEST 1/2 — Mükerrer kontrolü');
// =================================================================================================

await test('TEST 1: aynı source_url iki kez → aynı normalize anahtar (tek kayıt)', () => {
  const a = normalizeSourceUrl('https://www.example.com/haber/');
  const b = normalizeSourceUrl('https://example.com/haber');
  assert.equal(a, b);
});

await test('TEST 2a: izleme parametreli aynı URL → aynı anahtar', () => {
  const a = normalizeSourceUrl('https://example.com/haber');
  const b = normalizeSourceUrl('https://example.com/haber?utm_source=newsletter&utm_medium=email');
  assert.equal(a, b);
});

await test('TEST 2b: fragment ve şema farkı anahtarı değiştirmez', () => {
  const a = normalizeSourceUrl('http://example.com/haber#bolum-2');
  const b = normalizeSourceUrl('https://example.com/haber');
  assert.equal(a, b);
});

await test('TEST 2c: FARKLI URL + KELİME SIRASI değişmiş aynı başlık → aynı title_key', () => {
  const a = titleKey('OMA completes new cultural centre in Seoul');
  const b = titleKey('In Seoul, OMA completes new cultural centre');
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

// BİLİNEN SINIR — bilinçli olarak test edilir ki ileride "neden yakalamıyor?" diye aranmasın.
// title_key kelime KÖKÜ almaz (stemming yok): "completes" ile "completed" farklı token'lardır.
// Aynı olayı FARKLI KELİMELERLE yazan iki ayrı yayın bu basamakta yakalanmaz; onun için semantik
// benzerlik (embedding) gerekirdi ve Vectorize kullanıcı isteğinde açıkça kapsam dışı (madde 29).
// Aynı yayının aynı başlığı farklı URL'den tekrar gelmesi ise 1., 2. ve 3. basamaklarda yakalanır.
await test('BİLİNEN SINIR: farklı KELİMELERLE yazılmış aynı olay ayrı anahtar üretir', () => {
  assert.notEqual(
    titleKey('OMA completes new cultural centre in Seoul'),
    titleKey('OMA unveils cultural venue in the Korean capital')
  );
});

await test('title_key Türkçe karakterleri katlar', () => {
  assert.equal(titleKey('Yarışma Ödülü İstanbul'), titleKey('yarisma odulu istanbul'));
});

await test('title_key FARKLI haberleri ayırır', () => {
  assert.notEqual(
    titleKey('OMA completes cultural centre in Seoul'),
    titleKey('BIG unveils residential tower in Copenhagen')
  );
});

await test('content_hash: aynı içerik aynı, farklı içerik farklı', async () => {
  const h1 = await contentHash('Başlık', 'Açıklama metni');
  const h2 = await contentHash('Başlık', 'Açıklama metni');
  const h3 = await contentHash('Başka başlık', 'Bambaşka bir açıklama');
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.equal(h1.length, 32);
});

// =================================================================================================
section('3) TEST 5 — Görsel doğrulaması');
// =================================================================================================

const fakeSource = { imageHosts: ['images.adsttc.com'] };

await test('TEST 5a: beyan edilmiş host kabul edilir', () => {
  assert.equal(isAllowedImageHost('https://images.adsttc.com/x.jpg', fakeSource), true);
});

await test('TEST 5b: beyan edilmemiş host REDDEDİLİR (CSP ile hizalı)', () => {
  assert.equal(isAllowedImageHost('https://tracker.evil.com/pixel.gif', fakeSource), false);
});

await test('TEST 5c: http:// ve geçersiz URL reddedilir', () => {
  assert.equal(isAllowedImageHost('http://images.adsttc.com/x.jpg', fakeSource), false);
  assert.equal(isAllowedImageHost('bozuk', fakeSource), false);
  assert.equal(isAllowedImageHost(null, fakeSource), false);
});

// =================================================================================================
section('4) TEST 3/4/7 — AI çıktısı kalite kapısı');
// =================================================================================================

const ctx = {
  sourceTitle: 'OMA completes new cultural centre in Seoul',
  sourceExcerpt: 'The building and its plaza opened this week in Seoul.',
  fallbackCategory: 'haber',
};

await test('TEST 3: geçerli çıktı kabul edilir (Türkçe, tek paragraf, 40-80 kelime)', () => {
  const r = validateAiOutput({
    confident: true,
    title: 'OMA imzalı kültür merkezi Seul’de açıldı',
    summary: validSummary(55),
    category: 'haber',
    entities: [],
  }, ctx);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.category, 'haber');
});

await test('TEST 3a: 40 kelimenin ALTINDAKİ özet reddedilir', () => {
  const r = validateAiOutput({ title: 'OMA kültür merkezi Seul', summary: validSummary(20), category: 'haber' }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'summary_too_short');
});

await test('TEST 3b: 80 kelimenin ÜSTÜNDEKİ özet reddedilir', () => {
  const r = validateAiOutput({ title: 'OMA kültür merkezi Seul', summary: validSummary(120), category: 'haber' }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'summary_too_long');
});

await test('TEST 3c: ÇOK PARAGRAFLI özet reddedilir', () => {
  const r = validateAiOutput({
    title: 'OMA kültür merkezi Seul',
    summary: validSummary(30) + '\n\n' + validSummary(30),
    category: 'haber',
  }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'summary_not_single_paragraph');
});

await test('TEST 3d: İNGİLİZCE özet reddedilir (Türkçe zorunlu)', () => {
  const english = Array.from({ length: 55 }, () => 'building').join(' ');
  const r = validateAiOutput({ title: 'OMA kültür merkezi Seul açıldı', summary: english, category: 'haber' }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'summary_not_turkish');
});

await test('TEST 3e: kaynakla ALAKASIZ başlık reddedilir (halüsinasyon kapısı)', () => {
  const r = validateAiOutput({
    title: 'Kayseri’de yeni tramvay hattı hizmete girdi',
    summary: validSummary(55),
    category: 'haber',
  }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'title_unrelated');
});

await test('TEST 3f: clickbait başlık reddedilir', () => {
  const r = validateAiOutput({
    title: 'Seoul’deki bu projeye inanamayacaksınız',
    summary: validSummary(55),
    category: 'haber',
  }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'title_clickbait');
});

// İLK CANLI TUR REGRESYONU (2026-09-06 20:30): 8 içeriğin 3'ü `title_not_turkish` ile elendi,
// çünkü başlık kapısı özet kapısıyla AYNI looksTurkish() kontrolünü kullanıyordu ve yalnızca özel
// adlardan oluşan geçerli Türkçe başlıkları da reddediyordu.
// TOLERANS BANDI (ölçüm, 2026-09-06): model düzeltmeli denemeden sonra 37-39 kelimelik KUSURSUZ
// özetler üretiyordu; sert 40 tabanı bunları eliyordu. İstek "YAKLAŞIK 40-80" diyor.
await test('TOLERANS: 37 kelimelik özet kabul edilir (hedef 40, taban 36)', () => {
  const r = validateAiOutput({
    title: 'OMA imzalı kültür merkezi Seul’de açıldı',
    summary: validSummary(37), category: 'haber',
  }, ctx);
  assert.equal(r.ok, true, r.reason);
});

await test('TOLERANS: 35 kelime hâlâ REDDEDİLİR (bant sınırsız değil)', () => {
  const r = validateAiOutput({ title: 'OMA kültür merkezi Seul', summary: validSummary(35), category: 'haber' }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'summary_too_short');
});

await test('TOLERANS: 85 kelime kabul, 95 kelime reddedilir', () => {
  assert.equal(validateAiOutput({ title: 'OMA kültür merkezi Seul açıldı', summary: validSummary(85), category: 'haber' }, ctx).ok, true);
  assert.equal(validateAiOutput({ title: 'OMA kültür merkezi Seul açıldı', summary: validSummary(95), category: 'haber' }, ctx).reason, 'summary_too_long');
});

await test('TEST 3g: özel adlardan oluşan Türkçe başlık REDDEDİLMEZ (canlı tur regresyonu)', () => {
  // Ne Türkçe'ye özgü harf ne Türkçe işlev kelimesi var — ama İngilizce de değil.
  assert.equal(titleLanguageOk('Plaza Corporate Kuzey Kulesi'), true);
  assert.equal(titleLanguageOk('OMA Seoul Kultur Merkezi'), true);
});

await test('TEST 3h: gerçekten İNGİLİZCE kalmış başlık reddedilir', () => {
  assert.equal(titleLanguageOk('OMA completes new cultural centre in Seoul'), false);
  assert.equal(titleLanguageOk('The Overlook House by Migration Studios'), false);
  assert.equal(looksEnglish('OMA completes new cultural centre in Seoul'), true);
});

await test('TEST 3i: Türkçe işareti taşıyan başlık, İngilizce kelime içerse de geçer', () => {
  // Kaynak adı özel ad olarak korunabilir; Türkçe ekler başlığı yine Türkçe yapar.
  assert.equal(titleLanguageOk("The Architectural Review'dan Fallingwater değerlendirmesi"), true);
});

// EŞİK 2 (ölçüm, 2026-09-06): çevrilmiş ama özgün adın artikelini koruyan başlıklar eleniyordu.
await test('TEST 3j: tek İngilizce artikel içeren ÇEVRİLMİŞ başlık geçer ("The Overlook Evi")', () => {
  assert.equal(englishWordHits('The Overlook Evi'), 1);
  assert.equal(titleLanguageOk('The Overlook Evi'), true);
  // Gerçekten çevrilmemiş başlık birden fazla İngilizce işlev kelimesi taşır:
  assert.ok(englishWordHits('OMA completes new cultural centre in Seoul') >= 2);
});

await test('TEST 4: boş başlık/özet reddedilir (AI başarısızsa yayın YOK)', () => {
  assert.equal(validateAiOutput({ title: '', summary: validSummary(55) }, ctx).reason, 'title_empty');
  assert.equal(validateAiOutput({ title: 'OMA kültür merkezi Seul', summary: '' }, ctx).reason, 'summary_empty');
  assert.equal(validateAiOutput(null, ctx).reason, 'ai_not_object');
  assert.equal(validateAiOutput('metin', ctx).reason, 'ai_not_object');
});

await test('TEST 4b: modelin "özetleyemedim" meta yanıtı reddedilir', () => {
  const meta = 'Bu içerik için kaynak metin yeterli bilgi yok ' + validSummary(45);
  const r = validateAiOutput({ title: 'OMA kültür merkezi Seul', summary: meta, category: 'haber' }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'summary_meta_response');
});

await test('TEST 7: whitelist DIŞI kategori sessizce fallback\'e düşer, içerik reddedilmez', () => {
  const r = validateAiOutput({
    title: 'OMA imzalı kültür merkezi Seul’de açıldı',
    summary: validSummary(55),
    category: 'spor',
  }, ctx);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.category, 'haber');
  assert.ok(GUNDEM_CATEGORY_KEYS.includes(r.category));
});

await test('TEST 7b: kategori whitelist\'i tam olarak beş değer', () => {
  assert.deepEqual(GUNDEM_CATEGORY_KEYS, ['haber', 'etkinlik', 'gorus', 'yarisma', 'kariyer']);
  assert.equal(isValidGundemCategory('yarisma'), true);
  assert.equal(isValidGundemCategory('spor'), false);
  assert.equal(isValidGundemCategory(null), false);
});

await test('yardımcılar: wordCount / isSingleParagraph / looksTurkish / titleOverlapsSource', () => {
  assert.equal(wordCount('bir iki üç'), 3);
  assert.equal(wordCount(''), 0);
  assert.equal(isSingleParagraph('tek satır'), true);
  assert.equal(isSingleParagraph('iki\nsatır'), false);
  assert.equal(isSingleParagraph('- madde imi ile başlayan'), false);
  assert.equal(looksTurkish('İstanbul’da yeni bir yapı'), true);
  assert.equal(looksTurkish('a building opened today'), false);
  // 1. kademe: başlıkta geçen özel ad (3 harfli akronim dahil) tek başına yeterli.
  assert.equal(titleOverlapsSource('OMA’dan Seul’de kültür merkezi', ctx.sourceTitle, ctx.sourceExcerpt, ''), true);
  // 2. kademe: başlık hiç örtüşmese de özet kaynakla örtüşüyorsa geçer — şehir adı çeviride
  // yerelleşmiş ("Seoul" → "Seul") doğru bir başlık bu sayede elenmez.
  assert.equal(
    titleOverlapsSource('Seul’de kültür merkezi', ctx.sourceTitle, ctx.sourceExcerpt,
      'Seoul kentinde açılan cultural centre yapısı ve plaza bu hafta ziyarete açıldı'),
    true
  );
  // Ne başlık ne özet örtüşüyor → gerçek halüsinasyon, reddedilir.
  assert.equal(titleOverlapsSource('Kayseri tramvay hattı', ctx.sourceTitle, ctx.sourceExcerpt, 'Kayseri kentinde raylı sistem yatırımı tamamlandı'), false);
  // Kaynak hiç metin vermemişse kapı bir şey söyleyemez, engellemez.
  assert.equal(titleOverlapsSource('Herhangi bir başlık', '', '', ''), true);
});

// =================================================================================================
section('5) Entity eşleştirme — YENİ ENTITY UYDURULMAZ');
// =================================================================================================

const index = buildGundemEntityIndex({
  offices: [
    { slug: 'oma', name: 'OMA', cats: 'Mimarlık', productCount: 0 },
    { slug: 'autoban', name: 'Autoban', cats: 'Mimarlık · Mobilya', productCount: 12 },
    { slug: 'studio-a', name: 'Studio', cats: 'Mimarlık', productCount: 0 },
  ],
  architects: [{ slug: 'nevzat-sayin', name: 'Nevzat Sayın' }],
  products: [{ slug: 'koltuk-x', title: 'Koltuk X' }],
  projects: [{ slug: 'kultur-merkezi-seul', title: 'Kültür Merkezi Seul' }],
});

await test('Mevcut firma TAM eşleşmeyle bulunur ve doğru öneke bağlanır', () => {
  const out = resolveGundemEntities(index, [{ name: 'OMA', kind: 'office' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'office');
  assert.equal(out[0].key, 'oma');
  assert.equal(out[0].href, '/firma/oma');
});

await test('Mevcut kişi bulunur (Türkçe karakter katlamasıyla)', () => {
  const out = resolveGundemEntities(index, [{ name: 'nevzat sayin', kind: 'architect' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].href, '/kisi/nevzat-sayin');
});

await test('AI\'nin UYDURDUĞU isim hiçbir kayda bağlanmaz (kenar oluşmaz)', () => {
  const out = resolveGundemEntities(index, [
    { name: 'Zaha Hadid Architects', kind: 'office' },
    { name: 'Uydurma Mimarlık A.Ş.', kind: 'office' },
  ]);
  assert.deepEqual(out, []);
});

await test('AI\'nin yanlış tür tahmini yok sayılır, KAYDIN gerçek türü kullanılır', () => {
  const out = resolveGundemEntities(index, [{ name: 'Nevzat Sayın', kind: 'office' }]);
  assert.equal(out[0].type, 'architect');
});

await test('Çok jenerik ad ("Studio") asla eşleşmez', () => {
  assert.deepEqual(resolveGundemEntities(index, [{ name: 'Studio', kind: 'office' }]), []);
});

await test('Kısa proje adı eşiği: 6 karakterin altındaki proje adları dizine girmez', () => {
  const smallIndex = buildGundemEntityIndex({ projects: [{ slug: 'y-evi', title: 'Y Evi' }] });
  assert.deepEqual(resolveGundemEntities(smallIndex, [{ name: 'Y Evi', kind: 'project' }]), []);
});

await test('BELİRSİZ ad (aynı isimde iki kayıt) eşleşmez', () => {
  const dupIndex = buildGundemEntityIndex({
    offices: [
      { slug: 'atolye-1', name: 'Atölye Mim', cats: 'Mimarlık', productCount: 0 },
      { slug: 'atolye-2', name: 'Atölye Mim', cats: 'Mimarlık', productCount: 0 },
    ],
  });
  assert.deepEqual(resolveGundemEntities(dupIndex, [{ name: 'Atölye Mim', kind: 'office' }]), []);
});

await test('Aynı kayıt iki kez önerilse de tek kenar üretilir', () => {
  const out = resolveGundemEntities(index, [{ name: 'OMA', kind: 'office' }, { name: 'oma', kind: 'office' }]);
  assert.equal(out.length, 1);
});

await test('Saf marka kaydı /marka/ önekine bağlanır (officeUrl tek kaynağı)', () => {
  const brandIndex = buildGundemEntityIndex({
    offices: [{ slug: 'ersa', name: 'Ersa Mobilya', cats: 'Mobilya', productCount: 40 }],
  });
  const out = resolveGundemEntities(brandIndex, [{ name: 'Ersa Mobilya', kind: 'office' }]);
  assert.equal(out[0].href, '/marka/ersa');
});

// =================================================================================================
section('5b) Kaynak zamanlaması (cron ızgarası kayması)');
// =================================================================================================
// CANLI REGRESYON (2026-09-06 21:30): kaynak 20:30:40'ta işlenmişti, bir sonraki tur 21:30:00'da
// tetiklendi — aradan 59 dk 20 sn geçti ve sert `>= 60 dk` kontrolü 7 SANİYEYLE kaçtı. 60 dakikalık
// aralık böylece pratikte 90 dakikaya çıkıyordu, sessizce.
const MIN = 60000;
await test('CRON KAYMASI: 59 dk 20 sn geçmiş 60 dakikalık kaynak DUE sayılır', () => {
  const src = { fetchIntervalMin: 60 };
  const now = 1000 * MIN;
  const health = { last_run_at: now - (59 * MIN + 20000), consecutive_failures: 0 };
  assert.equal(_isSourceDueForTests(src, health, now), true);
});

await test('CRON KAYMASI: 30 dk geçmiş 60 dakikalık kaynak HÂLÂ due DEĞİL (hız artmıyor)', () => {
  const src = { fetchIntervalMin: 60 };
  const now = 1000 * MIN;
  assert.equal(_isSourceDueForTests(src, { last_run_at: now - 30 * MIN, consecutive_failures: 0 }, now), false);
});

await test('CRON KAYMASI: 180 dakikalık kaynak 150 dk sonra due DEĞİL, 179 dk sonra due', () => {
  const src = { fetchIntervalMin: 180 };
  const now = 1000 * MIN;
  assert.equal(_isSourceDueForTests(src, { last_run_at: now - 150 * MIN, consecutive_failures: 0 }, now), false);
  assert.equal(_isSourceDueForTests(src, { last_run_at: now - 179 * MIN, consecutive_failures: 0 }, now), true);
});

await test('Hiç çalışmamış kaynak her zaman due', () => {
  assert.equal(_isSourceDueForTests({ fetchIntervalMin: 60 }, null, Date.now()), true);
  assert.equal(_isSourceDueForTests({ fetchIntervalMin: 60 }, { last_run_at: null }, Date.now()), true);
});

await test('Üst üste hata veren kaynak soğutma penceresine alınır', () => {
  const src = { fetchIntervalMin: 60 };
  const now = 1000 * MIN;
  const failing = { last_run_at: now - 90 * MIN, consecutive_failures: 4 };
  // 90 dk geçti ama soğutma 240 dk — henüz due değil.
  assert.equal(_isSourceDueForTests(src, failing, now), false);
  assert.equal(_isSourceDueForTests(src, { ...failing, last_run_at: now - 240 * MIN }, now), true);
});

// =================================================================================================
section('5c) Proje içeriği filtresi (kullanıcı isteği 2026-09-07 madde 4)');
// =================================================================================================
await test('ArchDaily proje yayını kalıbı ("X / Y") yakalanır — AI çağrısı harcanmaz', () => {
  assert.equal(looksLikeProjectPublication('Grava House / remyarchitects'), true);
  assert.equal(looksLikeProjectPublication('Plaza Corporate - North Tower / Biselli Katchborian Arquitetos'), true);
  assert.equal(looksLikeProjectPublication('The Overlook House / Migration Studios'), true);
});

await test('Makale/haber başlıkları proje sayılmaz', () => {
  assert.equal(looksLikeProjectPublication('Building the India of the Imagination: Cinema and the Making of Place'), false);
  assert.equal(looksLikeProjectPublication('Muğla Büyükşehir Belediyesi Yarışmasında Birincilik Açıklandı'), false);
  assert.equal(looksLikeProjectPublication('Eski Gece Kulübü Kütüphaneye Dönüştü'), false);
  assert.equal(looksLikeProjectPublication(''), false);
  assert.equal(looksLikeProjectPublication(null), false);
});

await test('Makale işareti taşıyan "/" başlığı proje sayılmaz (yanlış pozitif koruması)', () => {
  // İki nokta üst üste = makale işareti; eğik çizgi olsa bile proje yayını değildir.
  assert.equal(looksLikeProjectPublication('Interview: Zaha Hadid Architects / gelecek üzerine'), false);
});

// =================================================================================================
section('5d) Siteler arası mükerrer (kullanıcı isteği 2026-09-07 madde 6)');
// =================================================================================================
await test('AYNI olayı anlatan iki FARKLI sitenin Türkçe başlığı mükerrer sayılır', () => {
  const recent = [{ slug: 'a', title: 'OMA imzalı kültür merkezi Seul’de ziyarete açıldı' }];
  const dup = findCrossSourceDuplicate('Seul’de OMA kültür merkezi açıldı ziyarete', recent);
  assert.ok(dup, 'mükerrer yakalanmalıydı');
  assert.equal(dup.slug, 'a');
});

await test('FARKLI olaylar mükerrer sayılmaz', () => {
  const recent = [{ slug: 'a', title: 'OMA imzalı kültür merkezi Seul’de ziyarete açıldı' }];
  assert.equal(findCrossSourceDuplicate('Muğla’da hizmet binası yarışması sonuçlandı', recent), null);
  // Benzer konulu ama ayrı iki yarışma birleştirilmemeli.
  assert.equal(findCrossSourceDuplicate('Gliwice bulvarları için kentsel tasarım yarışması', [
    { slug: 'b', title: 'Geri dönüştürülmüş malzeme pavyonu yarışması açıldı' },
  ]), null);
});

await test('Ayırt edici token taşımayan başlık engellenmez (karar verilemez)', () => {
  assert.equal(findCrossSourceDuplicate('Yeni bir', [{ slug: 'a', title: 'Yeni bir' }]), null);
});

await test('jaccard/titleTokenSet temel davranış', () => {
  assert.equal(jaccard(titleTokenSet('aaa bbb'), titleTokenSet('aaa bbb')), 1);
  assert.equal(jaccard(titleTokenSet('aaa bbb'), titleTokenSet('ccc ddd')), 0);
  assert.equal(titleTokenSet('bir bu ve').size, 0); // durak kelimeler elenir
});

// =================================================================================================
section('5e) HTML liste çıkarımı (mimdap)');
// =================================================================================================
const MIMDAP_FIXTURE = `<div>
<article id="post-333789" class="post"><div><div class="relative">
<img data-lazyloaded="1" src="data:image/svg+xml;base64,AAAA" data-src="https://mimdap.org/wp-content/uploads/2026/09/hamam.jpg" alt="x" />
<noscript><img src="https://mimdap.org/wp-content/uploads/2026/09/hamam.jpg" /></noscript></div>
<div><h3 class="mb-2"><a href="https://mimdap.org/haberler/antalyada-roma-hamami/">Antalya'da 1700 yıllık Roma Hamamı</a></h3>
<div class="text-xs text-secondary pl-1 mb-2">6 Eylül 2026</div>
<p class="line-clamp-3 font-sans">Antalya&#8217;nın Konyaaltı ilçesinde bulunan hamam&hellip;</p>
</div></div></article>
</div>`;

await test('mimdap: başlık/link/görsel/tarih/özet doğru çıkarılır', () => {
  const items = parseHtmlList('mimdap', MIMDAP_FIXTURE, 'https://mimdap.org/kategori/haberler/');
  assert.equal(items.length, 1);
  const it = items[0];
  assert.equal(it.title, "Antalya'da 1700 yıllık Roma Hamamı");
  assert.equal(it.link, 'https://mimdap.org/haberler/antalyada-roma-hamami/');
  // data-src tercih edilir; base64 yer tutucu ASLA görsel sayılmaz.
  assert.equal(it.image, 'https://mimdap.org/wp-content/uploads/2026/09/hamam.jpg');
  assert.equal(it.publishedAt, Date.UTC(2026, 8, 6, 12, 0, 0));
  assert.ok(it.excerpt.includes('Konyaaltı'));
  assert.ok(!it.excerpt.includes('&#8217;'), 'HTML varlıkları çözülmeliydi');
});

await test('mimdap: şablon değişirse SIFIR item döner (uydurma yok)', () => {
  assert.deepEqual(parseHtmlList('mimdap', '<div>bambaşka bir sayfa</div>', 'https://mimdap.org/'), []);
  assert.deepEqual(parseHtmlList('bilinmeyen-kaynak', MIMDAP_FIXTURE, 'https://x.com/'), []);
});

await test('Türkçe tarih ayrıştırma', () => {
  assert.equal(parseTurkishDate('6 Eylül 2026'), Date.UTC(2026, 8, 6, 12, 0, 0));
  assert.equal(parseTurkishDate('1 Ocak 2026'), Date.UTC(2026, 0, 1, 12, 0, 0));
  assert.equal(parseTurkishDate('12 Aralık 2025'), Date.UTC(2025, 11, 12, 12, 0, 0));
  assert.equal(parseTurkishDate('bozuk tarih'), null);
});

// =================================================================================================
section('6) TEST 6 — Kaynak yapılandırması tutarlılığı');
// =================================================================================================

await test('Her kaynağın zorunlu alanları tam ve tipleri doğru', () => {
  for (const s of GUNDEM_SOURCES) {
    assert.ok(s.id && typeof s.id === 'string', `id eksik: ${s.name}`);
    assert.ok(s.name && s.domain && s.feedUrl, `temel alan eksik: ${s.id}`);
    assert.ok(['rss', 'atom', 'html'].includes(s.type), `geçersiz type: ${s.id}`);
    assert.equal(typeof s.enabled, 'boolean', `enabled boolean değil: ${s.id}`);
    assert.ok(isValidGundemCategory(s.defaultCategory), `defaultCategory whitelist dışı: ${s.id}`);
    assert.ok(['feed', 'og'].includes(s.imageStrategy), `geçersiz imageStrategy: ${s.id}`);
    assert.ok(Array.isArray(s.imageHosts), `imageHosts dizi değil: ${s.id}`);
    assert.ok(Number.isFinite(s.fetchIntervalMin) && s.fetchIntervalMin > 0, `fetchIntervalMin: ${s.id}`);
    assert.ok(Number.isFinite(s.maxItemsPerRun) && s.maxItemsPerRun > 0, `maxItemsPerRun: ${s.id}`);
    assert.ok(['tr', 'en'].includes(s.language), `geçersiz language: ${s.id}`);
  }
});

await test('type:html olan her ETKİN kaynağın kayıtlı bir çıkarıcısı var', () => {
  for (const s of activeGundemSources().filter(x => x.type === 'html')) {
    assert.equal(hasHtmlExtractor(s.id), true, `HTML çıkarıcısı yok: ${s.id}`);
  }
});

await test('extraListUrls girdileri geçerli URL ve whitelist kategorisi taşır', () => {
  for (const s of GUNDEM_SOURCES) {
    for (const e of s.extraListUrls || []) {
      assert.doesNotThrow(() => new URL(e.url), `geçersiz extraListUrl: ${s.id}`);
      assert.ok(isValidGundemCategory(e.category), `whitelist dışı kategori: ${s.id}/${e.category}`);
    }
  }
});

await test('Kaynak id\'leri benzersiz (mükerrer kontrolü buna bağlı)', () => {
  const ids = GUNDEM_SOURCES.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

await test('TEST 6: kapalı kaynaklar gerekçe taşır ve tur listesine GİRMEZ', () => {
  const disabled = GUNDEM_SOURCES.filter(s => !s.enabled);
  for (const s of disabled) {
    assert.ok(s.disabledReason && s.disabledReason.length > 10, `disabledReason eksik: ${s.id}`);
  }
  const activeIds = activeGundemSources().map(s => s.id);
  for (const s of disabled) assert.ok(!activeIds.includes(s.id), `kapalı kaynak turda: ${s.id}`);
});

await test('Etkin her kaynak en az bir görsel host\'u beyan eder', () => {
  for (const s of activeGundemSources()) {
    assert.ok(s.imageHosts.length > 0, `etkin kaynağın imageHosts\'u boş: ${s.id}`);
  }
});

await test('GUNDEM_IMAGE_HOSTS = etkin kaynakların host\'larının birleşimi (CSP tek kaynağı)', () => {
  const expected = [...new Set(activeGundemSources().flatMap(s => s.imageHosts))].sort();
  assert.deepEqual(GUNDEM_IMAGE_HOSTS, expected);
  // Kapalı bir kaynağın host'u CSP'yi genişletmemeli.
  const disabledHosts = GUNDEM_SOURCES.filter(s => !s.enabled).flatMap(s => s.imageHosts);
  for (const h of disabledHosts) {
    if (!expected.includes(h)) assert.ok(!GUNDEM_IMAGE_HOSTS.includes(h), `kapalı kaynağın host'u CSP'de: ${h}`);
  }
});

await test('feedTimeoutFor — kaynağa özel zaman aşımı varsayılanın ALTINA inemez ve tavanla kelepçelenir', () => {
  // CANLI BULGU (denetim, 2026-09-10): bigumigu son 18 cron turunun 9'unda zaman aşımıyla düştü;
  // ölçülen gerçek yanıt süreleri 7,96-11,34 sn, varsayılan zaman aşımı ise 12 sn — yani kayıp
  // rastgeleydi. Kaynağa özel `feedTimeoutMs` eklendi; bu test o alanın sözleşmesini sabitler.
  const D = feedTimeoutFor(null);                       // varsayılan
  assert.equal(feedTimeoutFor(undefined), D);
  assert.equal(feedTimeoutFor({}), D, 'alan yoksa varsayılan');
  assert.equal(feedTimeoutFor({ feedTimeoutMs: 0 }), D, 'geçersiz değer varsayılana düşmeli');
  assert.equal(feedTimeoutFor({ feedTimeoutMs: -5 }), D);
  assert.equal(feedTimeoutFor({ feedTimeoutMs: 'abc' }), D);
  assert.equal(feedTimeoutFor({ feedTimeoutMs: D - 5000 }), D, 'varsayılanın ALTINA indirilemez');
  assert.equal(feedTimeoutFor({ feedTimeoutMs: 20000 }), 20000);
  assert.ok(feedTimeoutFor({ feedTimeoutMs: 10 * 60000 }) <= 25000, 'tavanı aşamaz');
});

await test('feedTimeoutMs kullanan her kaynak tur bütçesinin çok altında kalır', () => {
  // Tur bütçesi 120 sn (gundemIngest.js#runBudgetMs) ve feed'ler 3'erli gruplar hâlinde çekiliyor.
  for (const src of activeGundemSources()) {
    if (src.feedTimeoutMs === undefined) continue;
    assert.ok(Number.isFinite(src.feedTimeoutMs) && src.feedTimeoutMs > 0, `${src.id}: geçersiz feedTimeoutMs`);
    assert.ok(feedTimeoutFor(src) <= 25000, `${src.id}: tavanı aşıyor`);
    assert.ok(feedTimeoutFor(src) * 3 < 120000, `${src.id}: tek grup tur bütçesini yiyebilir`);
  }
  // Bulgunun kendisi: bigumigu ölçülen en kötü değerin (11,34 sn) en az iki katını beklemeli.
  const bigumigu = activeGundemSources().find(s => s.id === 'bigumigu');
  assert.ok(bigumigu, 'bigumigu kaynağı kayboldu');
  assert.ok(feedTimeoutFor(bigumigu) >= 20000, 'bigumigu zaman aşımı 12sn varsayılanına geri döndürülmüş');
});

await test('Etkin kaynakların gerçek görselleri kalite kapısından geçer', () => {
  for (const s of activeGundemSources()) {
    const sample = `https://${s.imageHosts[0]}/ornek.jpg`;
    assert.equal(isAllowedImageHost(sample, s), true, `kendi host'u reddedildi: ${s.id}`);
  }
});

await test('categoryHints yalnızca whitelist kategorilerine işaret eder', () => {
  for (const s of GUNDEM_SOURCES) {
    for (const hint of s.categoryHints || []) {
      assert.ok(hint.match instanceof RegExp, `hint.match RegExp değil: ${s.id}`);
      assert.ok(isValidGundemCategory(hint.category), `hint kategorisi whitelist dışı: ${s.id}/${hint.category}`);
    }
  }
});

await test('gundemIngest.js: `options` yalnızca runGundemIngestion içinde kullanılır', () => {
  // GERÇEK BULGU (canlı, 2026-09-07): INSERT satırına `options.ingestMode` yazılmıştı, ama o satır
  // `publishCandidate` gövdesindeydi ve `options` YALNIZCA `runGundemIngestion`'ın parametresi.
  // Sonuç: HER yayın denemesi ReferenceError ile düştü, `publish_failed` diye sayıldı ve hat
  // saatlerce SIFIR içerik üretti — kaynak sağlığı 13/13 "başarılı" göründüğü için hiç alarm
  // vermedi. Bu sınıf hata yalnızca gerçek AI + D1 ile dönen bir turda ortaya çıkar, saf birim
  // testleriyle YAKALANAMAZ; bu yüzden statik kapsam kontrolü olarak eklendi. (Depoda eslint/
  // no-undef yok ve tek bir kural için npm bağımlılığı eklenmedi.)
  //
  // NOT: fonksiyon sınırı, gövdeleri brace sayarak DEĞİL, 0. sütundaki `function` başlıklarıyla
  // bulunur. Bu dosyada `sourceUrlOf` ve `mergeSourceIntoItem` publishCandidate'in İÇİNDE ama
  // 0. sütunda yazılmıştır; brace saymaya dayanan bir tarama bu yüzden hatalı bölge çıkarır.
  const src = readFileSync(new URL('../src/lib/gundemIngest.js', import.meta.url), 'utf8').split('\n');
  const heads = [];
  src.forEach((line, i) => { if (/^(export )?(async )?function \w+/.test(line)) heads.push(i); });
  // 2026-09-07: runGundemIngestion artık bir sarmalayıcı (kalıcı tur kaydı) + runGundemIngestionInner
  // (asıl tur). `options` ikisinde de meşru; publishCandidate gibi diğer fonksiyonlarda DEĞİL.
  const allowed = [];
  heads.forEach((h, idx) => {
    if (/function runGundemIngestion(Inner)?\b/.test(src[h])) allowed.push([h, idx + 1 < heads.length ? heads[idx + 1] : src.length]);
  });
  assert.ok(allowed.length >= 1, 'runGundemIngestion bulunamadı — dosya biçimi değişmiş olabilir');
  const offenders = [];
  src.forEach((line, i) => {
    if (allowed.some(([a, b]) => i >= a && i < b)) return;
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // yorum satırı
    if (/(?<![.\w$])options\b/.test(line)) offenders.push(`satır ${i + 1}: ${line.trim()}`);
  });
  assert.equal(offenders.length, 0,
    `\`options\` runGundemIngestion dışında kullanılmış (ReferenceError olur): ${offenders.join(' | ')}`);
});

// =================================================================================================
// TUR SAĞLIK SINIFLANDIRMASI (hardening denetimi, 2026-09-07)
// =================================================================================================
// classifyGundemRun, "cron başarılı göründü ama içerik üretilmedi" sınıfını yakalayan tek yerdir;
// yanlış negatifi 1ff0e1b7'yi tekrar görünmez kılar, yanlış pozitifi ise hata logunu gürültüye
// boğup uyarıyı işe yaramaz hale getirir. İkisi de burada kilitleniyor.
const RUN = (o) => ({ candidates:0, published:0, duplicate:0, qualityFailed:0, sourcesTried:13, sourcesFailed:0, skipped:{}, ...o });

await test('classifyGundemRun: sağlıklı tur (yayın var) anomali üretmez', () => {
  assert.deepEqual(classifyGundemRun(RUN({ candidates:20, published:12, duplicate:8 })), []);
});

await test('classifyGundemRun: 0 yayın ama hepsi mükerrer -> anomali YOK (normal davranış)', () => {
  // Bu tam da uyarıya dönüşMEMESİ gereken durum: hat çalışıyor, sadece yeni içerik yok.
  assert.deepEqual(classifyGundemRun(RUN({ candidates:14, published:0, duplicate:14 })), []);
});

await test('classifyGundemRun: 0 yayın ama hepsi kalite kapısından döndü -> anomali YOK', () => {
  assert.deepEqual(classifyGundemRun(RUN({ candidates:6, published:0, qualityFailed:6 })), []);
});

await test('classifyGundemRun: hiç aday yoksa anomali YOK', () => {
  assert.deepEqual(classifyGundemRun(RUN({ candidates:0 })), []);
});

await test('classifyGundemRun: 1ff0e1b7 imzası (publish_failed) yakalanır', () => {
  // Gerçek olayın şekli: 20 aday yazma aşamasına geldi, hepsi ReferenceError ile düştü.
  const got = classifyGundemRun(RUN({ candidates:20, published:0, skipped:{ publish_failed:20 } }));
  assert.ok(got.includes('publish_failed'), `publish_failed yakalanmadı: ${JSON.stringify(got)}`);
});

await test('classifyGundemRun: publish_failed yayın olsa BİLE yakalanır', () => {
  // Kısmi bozulma da görünür olmalı — 3 yayın geçmiş olması 9 hatayı gizlememeli.
  const got = classifyGundemRun(RUN({ candidates:12, published:3, duplicate:0, skipped:{ publish_failed:9 } }));
  assert.ok(got.includes('publish_failed'));
});

await test('classifyGundemRun: aday hiçbir kapı tarafından sahiplenilmezse yakalanır', () => {
  const got = classifyGundemRun(RUN({ candidates:9, published:0, duplicate:0, qualityFailed:0 }));
  assert.ok(got.includes('candidates_vanished'), JSON.stringify(got));
});

await test('classifyGundemRun: tüm kaynaklar düşerse yakalanır', () => {
  const got = classifyGundemRun(RUN({ sourcesTried:13, sourcesFailed:13 }));
  assert.ok(got.includes('all_sources_failed'), JSON.stringify(got));
});

await test('classifyGundemRun: kaynakların bir kısmı düşerse anomali YOK (izolasyon çalışıyor)', () => {
  // Tek bir kaynağın bozulması diğerlerini durdurmuyor; bu beklenen dayanıklılık davranışıdır.
  assert.deepEqual(classifyGundemRun(RUN({ sourcesTried:13, sourcesFailed:2, candidates:11, published:7, duplicate:4 })), []);
});

// =================================================================================================
// GÜNDEM CRON OBSERVABILITY (2026-09-07) — gundem_runs + backfill≠cron + /api/_health + dispatcher
// =================================================================================================
// Bellek-içi D1 taklidi: yalnızca bu modülün kullandığı prepare/bind/first/run yüzeyi. Satırlar
// ingest_mode'a göre filtrelenir ve started_at DESC sıralanır — readLastGundemRun'un WHERE'ini
// gerçekten uyguladığını (backfill'i ELEDİĞİNİ) kanıtlamak için bind edilen mod okunur.
function fakeRunsDb(rows, { throwOnRead = false, throwOnWrite = false } = {}) {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (throwOnRead) throw new Error('D1 read down');
              const mode = args[0];
              return rows.filter(r => r.ingest_mode === mode).sort((a, b) => b.started_at - a.started_at)[0] || null;
            },
            async run() {
              if (throwOnWrite) throw new Error('D1 write down');
              const cols = (sql.match(/\(([^)]+)\) VALUES/) || [, ''])[1].split(',').map(c => c.trim());
              const row = {}; cols.forEach((c, i) => { row[c] = args[i]; });
              writes.push(row); rows.push(row);
              return { success: true };
            },
          };
        },
      };
    },
  };
}
const H = 3600 * 1000;
const NOW = 1_800_000_000_000;
const cronRow = (o) => ({ ingest_mode: 'cron', started_at: NOW - 2 * H, ok: 1, disabled: 0, published: 5, publish_failed: 0, anomalies: '[]', error: null, ...o });

await test('runRowFromStats: mevcut payload kovalanır, yeniden hesaplanmaz', () => {
  const stats = {
    sourcesTried: 13, sourcesOk: 12, sourcesFailed: 1, candidates: 9, duplicate: 3, published: 4, qualityFailed: 2, aiCalls: 6,
    skipped: { project_prefilter: 5, publish_failed: 0, ai_not_confident: 1, min_words: 1 }, anomalies: [],
    bySource: { a: { found: 20, fresh: 11 }, b: { found: 7, fresh: 3 } },
  };
  const row = runRowFromStats({ id: 'x', startedAt: 1000, finishedAt: 4000, ingestMode: 'cron', stats, error: null });
  assert.equal(row.fetched, 27); assert.equal(row.within_freshness, 14); assert.equal(row.project_filtered, 5);
  assert.equal(row.ai_rejected, 1); assert.equal(row.quality_rejected, 1); // qualityFailed 2 - ai 1
  assert.equal(row.published, 4); assert.equal(row.publish_failed, 0); assert.equal(row.duration_ms, 3000);
  assert.equal(row.ok, 1); assert.equal(row.ingest_mode, 'cron');
});

await test('runRowFromStats: istisnayla biten tur ok=0 + error taşır, backfill modu korunur', () => {
  const row = runRowFromStats({ id: 'x', startedAt: 1, finishedAt: 2, ingestMode: 'backfill', stats: null, error: new Error('boom') });
  assert.equal(row.ok, 0); assert.equal(row.error, 'boom'); assert.equal(row.ingest_mode, 'backfill');
});

await test('persistGundemRun: D1 yazması patlasa bile FIRLATMAZ (ingestion asla engellenmez)', async () => {
  const db = fakeRunsDb([], { throwOnWrite: true });
  const out = await persistGundemRun({ DB: db }, { startedAt: NOW, ingestMode: 'cron', stats: { published: 1 }, error: null });
  assert.equal(out, null);
});

await test('persistGundemRun: satır gundem_runs\'a ingest_mode ile yazılır', async () => {
  const db = fakeRunsDb([]);
  await persistGundemRun({ DB: db }, { startedAt: NOW, ingestMode: 'backfill', stats: { published: 2, skipped: {} }, error: null });
  assert.equal(db.writes.length, 1); assert.equal(db.writes[0].ingest_mode, 'backfill'); assert.equal(db.writes[0].published, 2);
});

// --- İSTENEN REGRESYON TESTLERİ 1-4 ---------------------------------------------------------------
await test('1) backfill kaydı cron tazeliğini KARŞILAMAZ (yalnızca backfill varsa -> no_run)', async () => {
  const db = fakeRunsDb([{ ingest_mode: 'backfill', started_at: NOW - 1 * H, ok: 1, disabled: 0, published: 68, publish_failed: 0, anomalies: '[]' }]);
  const row = await readLastGundemRun({ DB: db }, 'cron');
  assert.equal(row, null, 'readLastGundemRun backfill satırını cron diye döndürdü');
  const h = assessGundemCronHealth(row, NOW);
  assert.equal(h.healthy, false); assert.equal(h.status, 'no_run');
});

await test('2) eski cron + yeni backfill -> cron UNHEALTHY (stale) kalır', async () => {
  const db = fakeRunsDb([
    cronRow({ started_at: NOW - 40 * H }),
    { ingest_mode: 'backfill', started_at: NOW - 1 * H, ok: 1, disabled: 0, published: 68, publish_failed: 0, anomalies: '[]' },
  ]);
  const h = assessGundemCronHealth(await readLastGundemRun({ DB: db }, 'cron'), NOW);
  assert.equal(h.healthy, false); assert.equal(h.status, 'stale'); assert.ok(h.ageMs > GUNDEM_CRON_STALE_MS);
});

await test('3) yeni cron + 0 published -> çalışmış sayılır, HEALTHY (ok_no_content)', async () => {
  const db = fakeRunsDb([cronRow({ published: 0 })]);
  const h = assessGundemCronHealth(await readLastGundemRun({ DB: db }, 'cron'), NOW);
  assert.equal(h.healthy, true); assert.equal(h.status, 'ok_no_content');
});

await test('4a) yeni cron + publish_failed -> UNHEALTHY (anomaly) ve sayaç raporlanır', async () => {
  const db = fakeRunsDb([cronRow({ published: 0, publish_failed: 20, anomalies: '["publish_failed"]' })]);
  const h = assessGundemCronHealth(await readLastGundemRun({ DB: db }, 'cron'), NOW);
  assert.equal(h.healthy, false); assert.equal(h.status, 'anomaly'); assert.equal(h.publishFailed, 20); assert.deepEqual(h.anomalies, ['publish_failed']);
});

await test('4b) yeni cron + istisna (ok=0) -> UNHEALTHY (failed); kill switch -> disabled', () => {
  assert.equal(assessGundemCronHealth(cronRow({ ok: 0, error: 'TypeError' }), NOW).status, 'failed');
  assert.equal(assessGundemCronHealth(cronRow({ disabled: 1 }), NOW).status, 'disabled');
});

await test('4c) sıra önceliği: bayatlık her şeyden önce gelir (eski + anomalili -> stale)', () => {
  assert.equal(assessGundemCronHealth(cronRow({ started_at: NOW - 50 * H, publish_failed: 3, anomalies: '["publish_failed"]' }), NOW).status, 'stale');
});

// --- 6) /api/_health alanları ---------------------------------------------------------------------
await test('6a) health alanları: cron satırı doğru eşlenir, backfill görmezden gelinir', async () => {
  const db = fakeRunsDb([
    cronRow({ started_at: NOW - 3 * H, published: 7, publish_failed: 1, anomalies: '["publish_failed"]' }),
    { ingest_mode: 'backfill', started_at: NOW - 1 * H, ok: 1, disabled: 0, published: 99, publish_failed: 0, anomalies: '[]' },
  ]);
  const f = await gundemCronHealthFields({ DB: db }, NOW);
  assert.equal(f.gundemLastCronRun, new Date(NOW - 3 * H).toISOString());
  assert.equal(f.gundemLastCronRunAge, 3 * 3600);
  assert.equal(f.gundemLastCronPublished, 7); assert.equal(f.gundemLastCronPublishFailed, 1);
  assert.deepEqual(f.gundemLastCronAnomalies, ['publish_failed']);
  assert.equal(f.gundemCronStatus, 'anomaly'); assert.equal(f.gundemCronHealthy, false);
});

await test('6b) health alanları: tablo okunamazsa FIRLATMAZ, read_error döner (uç 200 kalır)', async () => {
  const f = await gundemCronHealthFields({ DB: fakeRunsDb([], { throwOnRead: true }) }, NOW);
  assert.equal(f.gundemCronStatus, 'read_error'); assert.equal(f.gundemCronHealthy, false); assert.equal(f.gundemLastCronRun, null);
});

await test('6c) health alanları: hiç satır yoksa no_run + null alanlar', async () => {
  const f = await gundemCronHealthFields({ DB: fakeRunsDb([]) }, NOW);
  assert.equal(f.gundemCronStatus, 'no_run'); assert.equal(f.gundemLastCronRun, null); assert.equal(f.gundemLastCronRunAge, null);
});

// --- 5) scheduled() dispatcher ---------------------------------------------------------------------
function fakeCtx() { const c = { waited: [] }; c.waitUntil = (p) => c.waited.push(p); return c; }
const GUNDEM_CRON = '0 1,5,9,13,17,21 * * *';
const VISUAL_CRON = '23 */6 * * *';

await test('5a) scheduled(): Gündem ifadesi -> gundem işçisi { ingestMode: "cron" } ile çağrılır, görsel dizin ÇAĞRILMAZ', async () => {
  const calls = { gundem: [], visual: [] };
  const runners = { gundem: async (env, opts) => { calls.gundem.push(opts); return { published: 1 }; }, visualIndex: async (env, t) => { calls.visual.push(t); return {}; } };
  const ctx = fakeCtx();
  await handleScheduled({ cron: GUNDEM_CRON }, {}, ctx, runners);
  assert.equal(calls.gundem.length, 1); assert.deepEqual(calls.gundem[0], { ingestMode: 'cron' });
  assert.equal(calls.visual.length, 0); assert.equal(ctx.waited.length, 1, 'ctx.waitUntil çağrılmadı');
});

await test('5b) scheduled(): görsel-dizin ifadesi -> yalnızca visualIndex (project+product), Gündem ÇAĞRILMAZ', async () => {
  const calls = { gundem: 0, visual: [] };
  const runners = { gundem: async () => { calls.gundem++; }, visualIndex: async (env, t) => { calls.visual.push(t); return {}; } };
  await handleScheduled({ cron: VISUAL_CRON }, {}, fakeCtx(), runners);
  assert.equal(calls.gundem, 0); assert.deepEqual(calls.visual, ['project', 'product']);
});

await test('5c) scheduled(): gundem işçisi fırlatırsa dispatcher REDDETMEZ, hata yutulup loglanır', async () => {
  const runners = { gundem: async () => { throw new Error('ingestion patladı'); }, visualIndex: async () => ({}) };
  const errs = []; const orig = console.error; console.error = (...a) => errs.push(a.join(' '));
  try {
    const settled = await handleScheduled({ cron: GUNDEM_CRON }, {}, fakeCtx(), runners);
    assert.ok(settled.every(r => r.status === 'fulfilled'), 'iş promise\'i reddedildi — Worker cron\'u düşürür');
  } finally { console.error = orig; }
  assert.ok(errs.some(e => e.includes('gundem cron başarısız') && e.includes('ingestion patladı')));
});

await test('5d) export default.scheduled gerçekten handleScheduled\'a bağlı (dispatcher kopmamış)', () => {
  assert.equal(typeof worker.scheduled, 'function');
  assert.ok(String(worker.scheduled).includes('handleScheduled'));
});

await test('5e) runGundemIngestion sarmalayıcısı: iç tur fırlatsa bile kayıt yazılır ve hata AYNEN yeniden fırlar', async () => {
  // gerçek ingestion'ı çalıştırmadan: kill switch KAPALI bir env ile iç fonksiyon erken döner ->
  // sarmalayıcı 'disabled' satırı yazar. Bu, "her çıkış yolu kaydedilir" iddiasının en ucuz kanıtı.
  const { runGundemIngestion } = await import('../src/lib/gundemIngest.js');
  const rows = [];
  const db = fakeRunsDb(rows);
  // getSiteSettings env.DB.prepare(...).all()/first() kullanır — burada basit bir şekil yeter:
  db.prepare = (sql) => ({
    bind: (...args) => ({
      async first() { return null; },
      async all() { return { results: [] }; },
      async run() { const cols=(sql.match(/\(([^)]+)\) VALUES/)||[,''])[1].split(',').map(c=>c.trim()); const r={}; cols.forEach((c,i)=>{r[c]=args[i];}); rows.push(r); return {}; },
    }),
    async all() { return { results: [] }; },
    async first() { return null; },
  });
  const stats = await runGundemIngestion({ DB: db, AI: {} }, {}, { ingestMode: 'cron' });
  assert.equal(stats.disabled, true);
  const run = rows.find(r => r.ingest_mode === 'cron');
  assert.ok(run, 'devre dışı tur gundem_runs\'a yazılmadı');
  assert.equal(run.disabled, 1); assert.equal(run.ok, 1);
});

// =================================================================================================
console.log('');
if (failed) {
  console.error(`GÜNDEM TESTLERİ BAŞARISIZ — ${passed} geçti, ${failed} başarısız.`);
  failures.forEach(f => console.error(`  - ${f.name}: ${f.message.split('\n')[0]}`));
  process.exit(1);
}
console.log(`Gündem testleri geçti — ${passed} test.`);
