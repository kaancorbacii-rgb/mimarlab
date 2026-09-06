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

import { parseFeed, stripHtml, decodeEntities, normalizeImageUrl, extractPageMeta } from '../src/lib/gundemFeed.js';
import {
  normalizeSourceUrl, titleKey, contentHash, isAllowedImageHost, validateAiOutput,
  wordCount, isSingleParagraph, looksTurkish, titleOverlapsSource,
} from '../src/lib/gundemQuality.js';
import { GUNDEM_CATEGORY_KEYS, isValidGundemCategory } from '../src/lib/gundemCategories.js';
import { GUNDEM_SOURCES, activeGundemSources, GUNDEM_IMAGE_HOSTS } from '../src/lib/gundemSources.js';
import { buildGundemEntityIndex, resolveGundemEntities } from '../src/lib/gundemEntities.js';

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
section('6) TEST 6 — Kaynak yapılandırması tutarlılığı');
// =================================================================================================

await test('Her kaynağın zorunlu alanları tam ve tipleri doğru', () => {
  for (const s of GUNDEM_SOURCES) {
    assert.ok(s.id && typeof s.id === 'string', `id eksik: ${s.name}`);
    assert.ok(s.name && s.domain && s.feedUrl, `temel alan eksik: ${s.id}`);
    assert.ok(['rss', 'atom'].includes(s.type), `geçersiz type: ${s.id}`);
    assert.equal(typeof s.enabled, 'boolean', `enabled boolean değil: ${s.id}`);
    assert.ok(isValidGundemCategory(s.defaultCategory), `defaultCategory whitelist dışı: ${s.id}`);
    assert.ok(['feed', 'og'].includes(s.imageStrategy), `geçersiz imageStrategy: ${s.id}`);
    assert.ok(Array.isArray(s.imageHosts), `imageHosts dizi değil: ${s.id}`);
    assert.ok(Number.isFinite(s.fetchIntervalMin) && s.fetchIntervalMin > 0, `fetchIntervalMin: ${s.id}`);
    assert.ok(Number.isFinite(s.maxItemsPerRun) && s.maxItemsPerRun > 0, `maxItemsPerRun: ${s.id}`);
    assert.ok(['tr', 'en'].includes(s.language), `geçersiz language: ${s.id}`);
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

// =================================================================================================
console.log('');
if (failed) {
  console.error(`GÜNDEM TESTLERİ BAŞARISIZ — ${passed} geçti, ${failed} başarısız.`);
  failures.forEach(f => console.error(`  - ${f.name}: ${f.message.split('\n')[0]}`));
  process.exit(1);
}
console.log(`Gündem testleri geçti — ${passed} test.`);
