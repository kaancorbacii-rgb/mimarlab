#!/usr/bin/env node
// GÜNDEM — MAKALE GÖVDESİ ÇIKARIMI VE KAYNAK METNİN ZENGİNLEŞMESİ (BİRİM TESTLERİ)
// (kullanıcı isteği, 2026-09-13: "Gündem sayfasındaki içeriklerin başlıklarını ve metinlerini
// daha doğru bir Türkçe ve özetleme sistemiyle YENİDEN KAYNAKLARDAN ÇEK".)
//
// NE KORUYOR: src/lib/gundemArticleText.js bu depodaki EN KIRILGAN türden bir modül — üçüncü taraf
// HTML'i regex ile ayrıştırıyor. Bir deseni yanlış daraltmak/genişletmek sessiz bir bozulmadır:
// hat çalışmaya devam eder, yalnızca özetler eskisi gibi yüzeysel kalır ya da (daha kötüsü) modele
// çerez uyarısı/fotoğraf kredisi/ilgili haber teaser'ı gider ve bunlar "kaynakta geçen bilgi"
// sayılıp özete sızar. Buradaki testler tam olarak o iki yönü kelepçeler.
//
// AĞ YOK, D1 YOK, AI YOK: hepsi saf fonksiyon çağrısı — preflight'ta (deploy öncesi) çalışabilsin.
import assert from 'node:assert/strict';

import { extractArticleText, articleRegion, jsonLdArticleBody, ARTICLE_MAX_CHARS } from '../src/lib/gundemArticleText.js';
import { extractPageMeta } from '../src/lib/gundemFeed.js';
import { buildSourceText } from '../src/lib/gundemSourceText.js';
import { SOURCE_TEXT_MAX_CHARS, EXCERPT_MAX_CHARS } from '../src/lib/gundemQuality.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}

// Gerçek bir mimarlık haberi sayfasının iskeleti: <head> og etiketleri, üst menü, çerez bandı,
// makale gövdesi, fotoğraf kredisi, ilgili haberler bloğu ve footer.
const P1 = 'Snøhetta, Trondheim kıyısındaki eski bir konserve fabrikasını kent kütüphanesine dönüştüren projesini tamamladı ve yapı bu ay ziyarete açıldı.';
const P2 = 'Ofis, 1912 tarihli tuğla yapının taşıyıcı sistemini koruyarak iç mekâna çapraz lamine ahşaptan yeni bir galeri katı ekledi ve cepheyi özgün açıklıklarıyla bıraktı.';
const P3 = 'Kütüphanenin zemin katı gün boyu kamuya açık bir geçit olarak kurgulandı; üst katlarda okuma salonları, çocuk bölümü ve bir kayıt stüdyosu bulunuyor.';
const P4 = 'Proje, belediyenin 2019 yılında açtığı iki aşamalı yarışmanın birincisi olarak seçilmişti ve toplam 4.200 metrekarelik bir alanı kapsıyor.';

const PAGE = `<!doctype html><html><head>
<meta property="og:title" content="Snohetta converts Trondheim cannery into public library">
<meta property="og:description" content="Snøhetta has completed a library inside a former cannery in Trondheim.">
<meta property="og:image" content="https://static.dezeen.com/uploads/2026/09/library.jpg">
<link rel="canonical" href="https://www.dezeen.com/2026/09/13/snohetta-trondheim-library/">
<script type="application/ld+json">{"@type":"NewsArticle","headline":"Snohetta library"}</script>
</head><body>
<nav><p>Mimarlık Tasarım İç Mimarlık Etkinlikler Abone Ol</p></nav>
<div class="cookie-banner"><p>Bu sitede çerez kullanıyoruz. Çerez politikamızı kabul ederek devam edebilirsiniz.</p></div>
<article>
  <p>${P1}</p>
  <figure><img src="a.jpg"><figcaption><p>Yapının kuzey cephesi. Fotoğraf: Ivar Kvaal</p></figcaption></figure>
  <p>${P2}</p>
  <h2>Ahşap galeri katı</h2>
  <p>${P3}</p>
  <p>Photography is by Ivar Kvaal unless otherwise stated.</p>
  <p>${P4}</p>
  <p>Kısa.</p>
</article>
<div class="related-posts">
  <p>İlgili haber: Snøhetta'nın Oslo'daki opera binası on beş yıl sonra yeniden değerlendiriliyor ve bu yazıda ele alınıyor.</p>
</div>
<footer><p>Tüm hakları saklıdır. Bültenimize abone olarak haftalık özetleri e-postanızda alabilirsiniz.</p></footer>
</body></html>`;

await test('makale gövdesinden paragraflar sırayla çıkarılır', () => {
  const text = extractArticleText(PAGE);
  assert.ok(text.includes(P1), 'ilk paragraf alınmalı');
  assert.ok(text.includes(P2), 'ikinci paragraf alınmalı');
  assert.ok(text.includes(P3), 'üçüncü paragraf alınmalı');
  assert.ok(text.includes(P4), 'dördüncü paragraf alınmalı');
  assert.ok(text.indexOf(P1) < text.indexOf(P4), 'paragraf sırası korunmalı');
});

await test('ara başlık (h2) gövdeye katılır — bölüm konusu modele bilgi verir', () => {
  assert.ok(extractArticleText(PAGE).includes('Ahşap galeri katı'), 'h2 alınmalı');
});

await test('navigation, çerez bandı ve footer gövdeye GİRMEZ', () => {
  const text = extractArticleText(PAGE);
  assert.ok(!/çerez/i.test(text), 'çerez uyarısı sızmamalı');
  assert.ok(!/Abone Ol/i.test(text), 'üst menü sızmamalı');
  assert.ok(!/Tüm hakları saklıdır/i.test(text), 'footer sızmamalı');
});

await test('fotoğraf kredisi ve figcaption gövdeye GİRMEZ', () => {
  const text = extractArticleText(PAGE);
  assert.ok(!/Photography is by/i.test(text), 'kredi paragrafı elenmeli');
  assert.ok(!/kuzey cephesi/i.test(text), 'figcaption elenmeli');
});

await test('"ilgili haberler" teaser\'ı gövdeye GİRMEZ (bölge </article> ile biter)', () => {
  assert.ok(!/opera binası/i.test(extractArticleText(PAGE)), 'ilgili içerik sızmamalı');
});

await test('çok kısa paragraf (arayüz metni) alınmaz', () => {
  assert.ok(!extractArticleText(PAGE).includes('Kısa.'), '60 karakterin altındaki paragraf elenmeli');
});

await test('<article> yoksa entry-content / <main> bölgesi kullanılır', () => {
  const html = `<html><body><nav><p>menü</p></nav><div class="entry-content"><p>${P1}</p><p>${P2}</p></div></body></html>`;
  const text = extractArticleText(html);
  assert.ok(text.includes(P1) && text.includes(P2));
});

await test('hiç uygun paragraf yoksa BOŞ döner (hat eski davranışa düşer)', () => {
  assert.equal(extractArticleText('<html><body><p>kısa</p></body></html>'), '');
  assert.equal(extractArticleText(''), '');
  assert.equal(extractArticleText(null), '');
});

await test('JSON-LD articleBody varsa ve daha uzunsa o tercih edilir', () => {
  const body = `${P1} ${P2} ${P3} ${P4} ${P1} ${P2}`;
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', articleBody: body })}</script></head><body><article><p>${P1}</p></article></body></html>`;
  const text = extractArticleText(html);
  assert.ok(text.length > P1.length * 3, 'JSON-LD gövdesi seçilmeli');
  assert.equal(jsonLdArticleBody(html).slice(0, 40), body.slice(0, 40));
});

await test('bozuk JSON-LD betiği çıkarımı DÜŞÜRMEZ', () => {
  const html = `<html><head><script type="application/ld+json">{bozuk json</script></head><body><article><p>${P1}</p><p>${P2}</p></article></body></html>`;
  assert.ok(extractArticleText(html).includes(P2));
});

await test('gövde ARTICLE_MAX_CHARS ile kelepçelenir ve cümle sınırında kesilir', () => {
  const long = Array.from({ length: 60 }, (_, i) => `<p>${P2.replace('Ofis', `Ofis ${i}`)}</p>`).join('');
  const text = extractArticleText(`<html><body><article>${long}</article></body></html>`);
  assert.ok(text.length <= ARTICLE_MAX_CHARS, `tavan aşıldı: ${text.length}`);
  assert.ok(/[.!?]$/.test(text), 'cümle sınırında bitmeli');
});

await test('extractPageMeta og alanlarını okumaya devam ediyor (regresyon)', () => {
  const meta = extractPageMeta(PAGE, 'https://www.dezeen.com/2026/09/13/x/');
  assert.equal(meta.description, 'Snøhetta has completed a library inside a former cannery in Trondheim.');
  assert.equal(meta.image, 'https://static.dezeen.com/uploads/2026/09/library.jpg');
  assert.equal(meta.canonical, 'https://www.dezeen.com/2026/09/13/snohetta-trondheim-library/');
});

await test('gövde metni kaynak yeterliliğini thin -> rich taşır (asıl kazanç)', () => {
  const feedOnly = buildSourceText(['Snøhetta has completed a library inside a former cannery in Trondheim.'], { maxChars: SOURCE_TEXT_MAX_CHARS });
  assert.equal(feedOnly.adequacy, 'thin', 'yalnızca og:description ile kaynak zayıf kalıyordu');

  const withBody = buildSourceText(
    ['Snøhetta has completed a library inside a former cannery in Trondheim.', extractArticleText(PAGE)],
    { maxChars: SOURCE_TEXT_MAX_CHARS }
  );
  assert.equal(withBody.adequacy, 'rich', 'gövde metniyle kaynak zenginleşmeli');
  assert.ok(withBody.words > feedOnly.words * 3, 'gövde metni kelime sayısını belirgin artırmalı');
});

await test('kaynak metin tavanı gövde için genişledi ama sınırsız değil', () => {
  assert.ok(SOURCE_TEXT_MAX_CHARS > EXCERPT_MAX_CHARS, 'tavan genişlemeli');
  assert.ok(SOURCE_TEXT_MAX_CHARS <= 4000, 'tavan "tam makale" olacak kadar açılmamalı');
});

// -----------------------------------------------------------------------------------------------
// YABANCI DİL ARTIĞI KAPISI (src/lib/gundemFactCheck.js#foreignLanguageLeftover)
// -----------------------------------------------------------------------------------------------
// Bu kapı, yayında GERÇEKTEN görülen kusurlar üzerine kuruldu (2026-09-13 yeniden üretim turu):
// Türkçe cümlenin ortasında Çince karakter ("önemli bir 章 olan") ya da Almanca kelime ("İnşaat
// nächsten yıl başlayacak"). Aşağıdaki ikinci grup en az birincisi kadar önemli: kapının GERÇEK
// ofis adlarını elememesi gerekiyor — ilk sürümü tam da bunu yapıyordu.
const { foreignLanguageLeftover } = await import('../src/lib/gundemFactCheck.js');

await test('Latin dışı karakter (Çince/Kiril/Yunan) reddedilir', () => {
  assert.ok(foreignLanguageLeftover('Mimari tarihinde önemli bir 章 olan kubbe.'));
  assert.ok(foreignLanguageLeftover('Yapı artık 主要 olarak sergi mekânı.'));
  assert.ok(foreignLanguageLeftover('Проект Москвада tamamlandı.'));
});

await test('Almanca/Fransızca işlev kelimesi reddedilir', () => {
  assert.equal(foreignLanguageLeftover('İnşaat nächsten yıl başlayacak.'), 'nächsten');
  assert.ok(foreignLanguageLeftover('Yapı avec bir avlu çevresinde kurgulandı.'));
  assert.ok(foreignLanguageLeftover('Ofis self-yönetim modeliyle çalışıyor.'));
});

await test('GERÇEK ofis/proje adları reddedilMEZ (kapının en kritik yanı)', () => {
  for (const ok of [
    'Kengo Kuma and Associates, Kyoto’daki müzenin ek yapısını tamamladı.',
    'Allies and Morrison liderliğindeki ekip onay aldı.',
    'Cattle koltuğu Gibson Karlo tarafından Design By Them için tasarlandı.',
    'Snøhetta’nın Trondheim’daki kütüphanesi açıldı.',
    'Herzog & de Meuron’un Basel’deki yapısı yenilendi.',
    'Studio Ossidiana, Hollanda pavyonunu tasarlamak üzere seçildi.',
  ]) {
    assert.equal(foreignLanguageLeftover(ok), null, `yanlış red: ${ok}`);
  }
});

await test('temiz Türkçe metin temiz geçer', () => {
  assert.equal(foreignLanguageLeftover('Yapı, tuğla cepheli bir kütüphaneye dönüştürüldü.'), null);
  assert.equal(foreignLanguageLeftover(''), null);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(`- ${f.name}: ${f.message}`); process.exit(1); }
