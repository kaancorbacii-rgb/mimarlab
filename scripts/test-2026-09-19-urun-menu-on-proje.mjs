// 2026-09-19 — ÜRÜN ana menü + footer'dan kaldırıldı, /proje'de En İyi 100'ün yanına taşındı.
// Kullanıcı isteği: "ÜRÜN başlığını ana menü ve footer menüsünden kaldırıp proje sayfasındaki En İyi
// 100 başlığının yanına koy. Ürün başlığı aşağı doğru çentikli olsun ve buna tıklayınca projeler
// kısmına sığacak şekilde hali hazırda olduğu gibi menü açılsın ... Tümünü Gör'e tıkladığı zaman
// ürün sayfası açılsın. Menü tablet ve mobil görünümde de açılabilir olsun."
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const chrome = read('../js/components/site-chrome.js');
const proje = read('../proje.html');
const menu = read('../js/components/nav-product-menu.js');

test('NAV_ITEMS ürün taşımaz', () => {
  const block = chrome.slice(chrome.indexOf('const NAV_ITEMS = ['), chrome.indexOf('const LOGO_LIGHT'));
  assert.ok(!/key: 'urun'/.test(block));
});

test('footer "Ana Menü" sütunu /urun taşımaz', () => {
  const col = chrome.slice(chrome.indexOf('<h4>Ana Menü</h4>'), chrome.indexOf('<h4>Topluluk</h4>'));
  assert.ok(!col.includes('href="/urun"'));
});

test('proje.html: çentikli Ürün tetikleyicisi En İyi 100\'ün hemen yanında, menü paneli sonuç çubuğunda', () => {
  const toggle = proje.slice(proje.indexOf('<div class="view-toggle" id="view-toggle">'), proje.indexOf('id="view-toggle-top100"'));
  assert.match(toggle, /id="view-toggle-urun"[^>]*href="\/urun"[^>]*aria-controls="proje-urun-menu"/);
  assert.match(toggle, /M1 1l4 4 4-4/, "aşağı çentik");
  const bar = proje.slice(proje.indexOf('<div class="result-bar">'), proje.indexOf('id="active-chips"'));
  assert.ok(bar.includes('id="proje-urun-menu"'), 'panel .result-bar içinde (ızgara genişliğine oturur)');
  assert.match(proje, /\.result-bar\{[^}]*position:relative/);
  assert.match(proje, /catalog-taxonomy\.js/);
  assert.match(proje, /js\/components\/nav-product-menu\.js/);
});

test('menü: masaüstü sütunları + mobil akordeon, "Tümünü Gör" -> /urun, tablet/mobilde gizlenmez', () => {
  assert.match(menu, /function initInline\(\)/);
  assert.match(menu, /initInline\(\);/);
  const html = menu.slice(menu.indexOf('function inlineMenuHtml'), menu.indexOf('function initInline'));
  assert.match(html, /class="mega-viewall" href="\/urun">Tümünü Gör/);
  assert.match(html, /mobilePanelHtml\('proje-urun-sub'\)/);
  assert.match(menu, /\.proje-urun-menu\{display:none; position:absolute;[^}]*left:0; right:0;/);
  assert.ok(!/\.proje-urun-menu\{display:none !important/.test(menu), 'panel hiçbir kırılımda zorla gizlenmez');
});

console.log(`\n${failed ? 'BAŞARISIZ' : 'TAMAM'} — ${passed} geçti, ${failed} kaldı`);
if (failed) process.exit(1);
