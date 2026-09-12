#!/usr/bin/env node
// VARLIK POPUP'LARININ KORUMASIZ GLOBAL BAĞIMLILIKLARI — STATİK KONTROL
//
// KULLANICI BİLDİRİMİ (2026-09-12): "Mesajlarda isme tıklayınca yanlış popup çıkıyor." Ekranda
// adsız/fotoğrafsız, bölümleri boş bir kişi popup'ı vardı. Kök neden: architect-modal.js
// `slugify()`'ı KORUMASIZ çağırıyor (updateHeadMeta -> canonicalUrl) ama o global save-widget.js'te
// tanımlı ve /hesabim o dosyayı yüklemiyor — renderItem, bölümlerin görünürlüğünü açtıktan hemen
// sonra ReferenceError ile düşüyor, yarım çizilmiş popup ekranda kalıyordu.
//
// SINIF HATASI, TEK BİR HATA DEĞİL: aynı taramada badge-shared.js (initials/officeColor/logoUrl/
// verifiedBadgeHtml) ve image-cdn.js (cdnImg/cdnSrcset) için de AYNI boşluk çıktı. kisi/firma/urun/
// proje.html bu dosyaları kendi <script> etiketleriyle yüklediğinden sorun orada hiç görünmüyor;
// popup'lar artık o sayfaların DIŞINDAN da açılabildiği için (bkz. js/components/lazy-modals.js#
// ENTITY_MODULES) bağımlılıkların lazy-modals'ta BİLDİRİLMİŞ olması şart.
//
// BU TEST NE YAPAR: varlık modallerini (ve onların bildirilen bileşenlerini) tarar, ortak kök
// dosyaların tanımladığı global'lerden KORUMASIZ (typeof/window kontrolü olmadan) çağrılanları
// bulur ve her birinin lazy-modals.js'teki bağımlılık listelerinde YER ALDIĞINI doğrular. Yeni bir
// korumasız kullanım eklenirse (ör. awards-shared.js'ten bir fonksiyon) deploy burada durur.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`); }
}

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// Yorumlar taramaya karışmasın: örnek kod içeren Türkçe yorumlar yanlış pozitif üretirdi.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Global tanımlayan ortak kök dosyalar (hepsi klasik <script>, top-level function/const bildirimleri).
const SHARED_GLOBAL_FILES = ['badge-shared.js', 'image-cdn.js', 'save-widget.js', 'awards-shared.js', 'profession-shared.js'];

// Varlık popup'ının açılmasıyla GERÇEKTEN çalışan dosyalar (modalin kendisi + lazy-modals'ın onun
// için yüklediği bileşenler).
const ENTITY_FILES = [
  'js/components/architect-modal.js',
  'js/components/office-modal.js',
  'js/components/product-modal.js',
  'js/components/claim-correction-box.js',
  'js/components/message-button.js',
  'js/components/social-links.js',
  'js/components/gallery.js',
];

function globalsDefinedBy(file) {
  const names = new Set();
  for (const m of read(file).matchAll(/^(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  return names;
}

// `name(` biçiminde çağrılıyor mu — üye erişimi (`x.name(`) hariç.
function callsUnguarded(code, name) {
  const esc = name.replace(/\$/g, '\\$');
  const called = new RegExp(`(?<![.\\w$])${esc}\\s*\\(`).test(code);
  if (!called) return false;
  const guarded = new RegExp(`typeof\\s+${esc}\\s*!==\\s*['"]undefined['"]`).test(code) || new RegExp(`window\\.${esc}\\b`).test(code);
  return !guarded;
}

const lazySrc = read('js/components/lazy-modals.js');

console.log('\nVarlık popup\'larının korumasız global bağımlılıkları');

const needed = new Map(); // shared dosya -> onu korumasız kullanan varlık dosyaları
for (const shared of SHARED_GLOBAL_FILES) {
  if (!existsSync(new URL('../' + shared, import.meta.url))) continue;
  const defs = globalsDefinedBy(shared);
  for (const entity of ENTITY_FILES) {
    const code = stripComments(read(entity));
    const localDefs = new Set([...code.matchAll(/(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
    const used = [...defs].filter(n => !localDefs.has(n) && callsUnguarded(code, n));
    if (used.length) {
      if (!needed.has(shared)) needed.set(shared, []);
      needed.get(shared).push(`${entity.split('/').pop()} (${used.join(', ')})`);
    }
  }
}

test('tarama gerçekten bir şey buldu (test kendi kendine boşa düşmüyor)', () => {
  assert.ok(needed.size >= 3, `beklenen >=3 ortak dosya, bulunan: ${[...needed.keys()].join(', ') || 'hiç'}`);
});

for (const [shared, users] of needed) {
  test(`${shared} lazy-modals bağımlılıklarında bildirilmiş`, () => {
    assert.ok(
      lazySrc.includes(`'${shared}'`),
      `${shared} KORUMASIZ kullanılıyor ama lazy-modals.js'te bildirilmemiş.\n` +
      `Kullananlar: ${users.join(' | ')}\n` +
      `Bu dosyayı <script> ile yüklemeyen bir sayfadan (ör. /hesabim) popup açılırsa ` +
      `ReferenceError ile YARIM çizilir. Çözüm: ENTITY_UI_DEPS'e ekle.`
    );
  });
}

test('bilinen üç bağımlılık ENTITY_UI_DEPS bloğunda (yanlışlıkla başka bir listeye düşmemiş)', () => {
  const block = lazySrc.slice(lazySrc.indexOf('const ENTITY_UI_DEPS'), lazySrc.indexOf('const ENTITY_MODULES'));
  for (const f of ['badge-shared.js', 'image-cdn.js', 'save-widget.js']) {
    assert.ok(block.includes(`'${f}'`), `${f} ENTITY_UI_DEPS bloğunda değil`);
  }
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
