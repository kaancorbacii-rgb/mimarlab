#!/usr/bin/env node
// "SENİN İÇİN" KARTLARI — KAYDET DÜĞMESİ, GÖRSEL KARUSELİ VE METİN HİZASI (BİRİM TESTLERİ)
// (kullanıcı isteği/bildirimi, 2026-09-13 madde 1 ve 2.)
//
//   madde 1  "Mobil görünümde ... üstteki gönderinin 3. satırdaki firma ve marka bilgisi alt
//             gönderiye daha yakın oluyor. Bunu üste yakın yap."
//   madde 2  "Senin için bölümünde de gönderilerde proje sayfasındaki gibi kaydet butonu ve ilk
//             üç görseli önizlemede görebileceğimiz ileri geri butonları olsun."
//
// ÜÇ SESSİZ REGRESYON RİSKİ — ÜÇÜ DE SÖZDİZİMİ KONTROLÜNDEN GEÇER, HİÇBİRİ ÇALIŞMA ZAMANINDA
// HATA VERMEZ:
//   1. Kaydet düğmesinin ANAHTARI. Ürünün kaydetme anahtarı slug DEĞİL, ratingKey'dir. Buraya
//      slug yazılırsa düğme çalışmaya devam eder ama AYRI bir anahtara yazar: ürün sayfasında
//      kaydedilen ürün ana sayfada "kaydedilmemiş" görünür. Anahtar üretimi bu yüzden tek
//      kaynaktan (product.js#ratingKeyFor) gelmek zorunda.
//   2. index.html'in save-widget.js / card-carousel.js'i YÜKLEMESİ. Etiket düşerse düğme sessizce
//      ölü bir <button>, karusel de basit bir görsel olur.
//   3. METİN BLOĞUNUN sabit yüksekliği. Sabit yükseklik BAŞLIĞA geri taşınırsa madde 1'deki kusur
//      (üçüncü satırın bir sonraki karta yapışması) aynen geri gelir.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

console.log('\nmadde 2 — Kaydet düğmesi ve görsel karuseli');

await test('sunucu kartı images + saveType + saveKey taşıyor', () => {
  const src = read('src/routes/forYou.js');
  for (const field of ['images,', 'saveType:', 'saveKey:']) {
    assert.ok(src.includes(field), `/api/foryou kartında ${field} alanı yok`);
  }
  assert.ok(src.includes("import { CARD_CAROUSEL_IMAGES } from '../lib/projectPool.js';"),
    'görsel sayısı ortak sabitten gelmiyor — üç yerde ayrışır');
});

await test('ÜRÜN kaydetme anahtarı ratingKeyFor ile üretiliyor (slug DEĞİL)', () => {
  const src = read('src/routes/forYou.js');
  assert.ok(src.includes("import { ratingKeyFor } from './product.js';"), 'ratingKeyFor içe aktarılmamış');
  assert.ok(src.includes('ratingKeyFor(row.title, row.brand_name_raw, submissionId)'),
    'anahtar ürün sayfasındakiyle aynı kolonlardan üretilmiyor');
  assert.ok(!src.includes('saveKey: row.slug,') || src.includes("saveType: 'project'"),
    'ürün kartında saveKey slug olamaz');
  // Marka adı KARTTA gösterilen o.name değil, anahtarın türetildiği brand_name_raw olmalı;
  // iki sorgu da bu kolonu SELECT etmeli, yoksa anahtar undefined ile üretilir.
  assert.equal((src.match(/pr\.brand_name_raw/g) || []).length, 2, 'iki ürün sorgusu da brand_name_raw seçmeli');
  assert.equal((src.match(/pr\.legacy_key/g) || []).length, 2, 'iki ürün sorgusu da legacy_key seçmeli');
  assert.ok(read('src/routes/product.js').includes('export function ratingKeyFor('), 'ratingKeyFor export edilmemiş');
});

await test('kart şablonu .content-card-photo[data-images] ve .card-save-btn basıyor', () => {
  const src = read('index.html');
  assert.ok(src.includes('foryou-thumb content-card-photo'),
    'karusel bileşeninin baktığı sınıf yok — ileri/geri okları hiç eklenmez');
  assert.ok(/data-images="\$\{escapeAttr\(JSON\.stringify\(images\)\)\}/.test(src), 'data-images basılmıyor');
  assert.ok(src.includes('class="card-save-btn"'), 'Kaydet düğmesi basılmıyor');
  // Düğme sunucudan gelen anahtarı kullanmalı; burada yeniden türetmek 1 numaralı riski geri getirir.
  assert.ok(src.includes('data-key="${escapeAttr(item.saveKey)}"'), 'düğme sunucunun anahtarını kullanmıyor');
  assert.ok(src.includes('data-type="${escapeAttr(item.saveType'), 'düğme sunucunun tipini kullanmıyor');
});

await test('index.html save-widget.js ve card-carousel.js yüklüyor', () => {
  const src = read('index.html');
  assert.ok(/<script src="save-widget\.js" defer><\/script>/.test(src), 'save-widget.js yüklenmiyor');
  assert.ok(/<script src="js\/components\/card-carousel\.js" defer><\/script>/.test(src), 'card-carousel.js yüklenmiyor');
  // Render fetch sonrası çalıştığı için bağlama iki yollu olmalı (hazırsa hemen, değilse load'da).
  assert.ok(src.includes('foryouPendingSaveWire'), 'save-widget geç gelirse düğmeler bağlanmadan kalır');
});

console.log('\nmadde 1 — üçüncü satır kendi başlığına yakın dursun');

await test('sabit yükseklik METİN BLOĞUNDA, başlıkta değil', () => {
  const src = read('index.html');
  assert.ok(/\.foryou-text\{[^}]*height:calc\(39px \+ 2\.6em\)/.test(src),
    'metin bloğunun sabit yüksekliği yok — kartlar farklı boyda çıkar');
  const titleRule = src.slice(src.indexOf('.foryou-title{'), src.indexOf('}', src.indexOf('.foryou-title{')));
  assert.ok(titleRule.includes('max-height:2.6em'), 'başlık max-height kullanmalı');
  assert.ok(!/[^-]height:2\.6em/.test(titleRule),
    'başlıkta SABİT yükseklik geri gelmiş — tek satırlık başlıkta boşluk yine başlıkla alt satır arasında kalır');
});

await test('üç metin satırı tek sarmalayıcıda (blok olarak birlikte hareket eder)', () => {
  const src = read('index.html');
  const card = src.slice(src.indexOf('return `<a class="foryou-card"'), src.indexOf('</a>`;', src.indexOf('return `<a class="foryou-card"')));
  const textBlock = card.slice(card.indexOf('<span class="foryou-text">'));
  for (const cls of ['foryou-reason', 'foryou-title', 'foryou-meta']) {
    assert.ok(textBlock.includes(cls), `${cls} metin sarmalayıcısının dışında kalmış`);
  }
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(`- ${f.name}: ${f.message}`); process.exit(1); }
