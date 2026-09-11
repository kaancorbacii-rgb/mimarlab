#!/usr/bin/env node
// 2026-09-11 — ÖNİZLEME POPUP'INDA YAYINDAKİ KARTLAR NET (kullanıcı isteği): "Sitede yayında olan
// blursuz projeleri hiçbir yerde blurlu göstermene gerek yok ... Aynı mantığı kişi, firma, marka ve
// ürün popuplarında da uygula." modal-shell.js'teki preview-blur CSS'i yalnızca kaydın KENDİ
// medyasını blurlamalı; başka kayda giden kartlar muaf, önizleme/fotoğrafçı kartları yeniden blurlu.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 4).join('\n       ')}`); }
}
const src = readFileSync(new URL('../js/components/modal-shell.js', import.meta.url), 'utf8');
const B = '.modal-shell-overlay.preview-blur .modal-shell-body ';

function ruleBody(selector) {
  const i = src.indexOf(selector);
  assert.ok(i >= 0, `seçici yok: ${selector}`);
  const open = src.indexOf('{', i);
  return src.slice(open + 1, src.indexOf('}', open));
}

test('başka kayda giden her detay bağlantısındaki görsel muaf (proje/kişi/firma/marka/ürün/gündem)', () => {
  for (const x of ['proje', 'kisi', 'firma', 'marka', 'urun', 'gundem']) {
    assert.ok(src.includes(`${B}a[href^="/${x}/"] img`), x);
    assert.ok(src.includes(`${B}a[href^="/${x}/"] .related-card-placeholder`), x);
  }
  assert.match(ruleBody(`${B}img.om-team-avatar.om-team-avatar`), /filter:none; transform:none;/);
});

test('önizleme ve sahipsiz fotoğrafçı kartları (kendisi ya da atası işaretli) yeniden blurlu', () => {
  for (const c of ['ml-preview-card', 'ml-photo-blur']) {
    assert.ok(src.includes(`${B}.${c} a[href] img`), c);
    assert.match(ruleBody(`${B}a.${c}[href] [style*="background-image"]`), /blur\(9px\)/, c);
  }
});

test('kural sırası: genel blur < muafiyet < yeniden blur', () => {
  const general = src.indexOf(`${B}img:not(.preview-blur-exempt)`);
  const exempt = src.indexOf(`${B}a[href^="/proje/"] img`);
  const reblur = src.indexOf(`${B}.ml-preview-card a[href] img`);
  assert.ok(general > 0 && general < exempt && exempt < reblur);
});

test('stil şablonunda backtick ve çift eğik çizgi yok (enjekte CSS bozulmasın)', () => {
  const a = src.indexOf('/* BAŞKA KAYITLARA GİDEN KARTLAR MUAF');
  const b = src.indexOf('/* Kapatma (X) butonu', a);
  const block = src.slice(a, b);
  assert.ok(!block.includes('`'));
  assert.ok(!block.includes('//'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
