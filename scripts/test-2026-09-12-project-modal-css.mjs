// PROJE POPUP'I KENDİ STİLİNİ TAŞIR — kaynak-seviyeli koruma.
//
// KULLANICI BİLDİRİMİ (2026-09-12, üç ayrı projede tekrarlandı): "popup'ı açınca sayfa böyle
// gözüktü, yenileyince düzeldi." Popup çıplak HTML olarak çiziliyordu.
//
// KÖK NEDEN: proje popup'ının kuralları proje.html'in satır içi <style>'ındaydı; modül, diğer üç
// varlık modalının aksine (kişi/firma/ürün kendi CSS'lerini JS'ten enjekte eder) "sayfamın CSS'i
// zaten var" varsayımıyla çalışıyordu. 2026-09-12 performans turu popup'ı HER sayfada aynı
// belgede açılır yapınca varsayım çöktü — ana sayfadan/kişi/firma popup'ından açılan proje
// popup'ında o kuralların hiçbiri yoktu. F5 düzeltiyordu çünkü yenileme gerçek /proje/:slug
// sayfasını (CSS'iyle birlikte) yüklüyordu.
//
// ÇÖZÜM: kurallar css/project-detail.css'e TAŞINDI (tek kaynak); proje.html ve en-iyi-100.html
// <link>'ler, lazy-modals.js popup'ı açmadan önce aynı dosyayı yükleyip bekler.
//
// BU TEST O ÇÖZÜMÜN AŞINMASINI ENGELLER: proje popup'ının kullandığı bir sınıf YALNIZCA bir
// sayfanın satır içi <style>'ında tanımlıysa deploy durur — çünkü o sınıf, popup başka bir
// sayfadan açıldığında var olmayacaktır.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0, failed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failed++; failures.push({ name, message: e.message }); console.log('  FAIL', name); console.log('       ' + String(e.message).split('\n').slice(0, 4).join('\n       ')); }
}
const section = (t) => console.log('\n' + t);

// Proje popup'ının şablonlarını üreten modüller (lazy-modals.js#ENTITY_MODULES.project ile aynı küme).
const POPUP_MODULES = [
  'js/components/project-modal.js', 'js/components/project-gallery.js', 'js/components/project-meta.js',
  'js/components/project-actions.js', 'js/components/project-comments.js', 'js/components/project-related.js',
  'js/components/project-products.js',
];
// Modüllerin kullandığı sınıf adları. class="..." yetmez: bu dosyalarda sınıflar dinamik de
// atanıyor (classList, şablon dizesi içinde koşullu ek, değişkene alınmış ad). Bu yüzden YORUMLAR
// SOYULUP kodda geçen TÜM dize değişmezlerinden sınıf gibi görünen belirteçler toplanır. Yorumları
// soymak şart: bu depoda yorumlar sınıf adlarını bolca anıyor (".related-section'u zaten tanımlar"
// gibi) ve onlar kullanım değildir — soyulmazsa kapı yanlış yere alarm verirdi.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
function classesUsedBy(files) {
  const out = new Set();
  for (const f of files) {
    const src = stripComments(read(f));
    for (const m of src.matchAll(/class=["'`]([^"'`$<>]+)["'`]/g)) {
      for (const c of m[1].split(/\s+/)) if (/^[a-z][a-z0-9-]{2,}$/.test(c)) out.add(c);
    }
    // Tüm dize değişmezleri: 'x-y', "x-y", `x-y` (şablon dizesinde boşlukla ayrılmış çoklu sınıf dahil).
    for (const m of src.matchAll(/['"`]([^'"`\n]{3,120})['"`]/g)) {
      for (const tok of m[1].split(/[\s>.#,:]+/)) if (/^[a-z][a-z0-9-]{2,}$/.test(tok) && tok.includes('-')) out.add(tok);
    }
  }
  return out;
}
// Bir CSS metninde tanımlı sınıflar.
function classesDefinedIn(css) {
  const out = new Set();
  for (const m of css.matchAll(/\.([a-z][a-z0-9-]*)/g)) out.add(m[1]);
  return out;
}
const inlineStyle = (html) => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
// JS'ten enjekte edilen tüm stiller (varlık modalleri, modal-shell, site-chrome, galeri ...).
function injectedCss() {
  const files = ['js/components/project-modal.js', 'js/components/modal-shell.js', 'js/components/architect-modal.js',
    'js/components/office-modal.js', 'js/components/product-modal.js', 'js/components/site-chrome.js',
    'js/components/gallery.js', 'js/components/image-lightbox.js', 'js/components/related-strip.js',
    'js/components/share-button.js', 'save-widget.js', 'rating-widget.js', 'js/components/image-hotspots.js',
    'js/components/hotspot-tagger.js', 'js/components/project-group-filter.js', 'badge-shared.js'];
  let css = '';
  for (const f of files) {
    let src; try { src = read(f); } catch { continue; }
    for (const m of src.matchAll(/style\.textContent\s*=\s*`([\s\S]*?)`/g)) css += '\n' + m[1];
    for (const m of src.matchAll(/textContent\s*=\s*`([\s\S]*?)`/g)) css += '\n' + m[1];
  }
  return css;
}

section('proje popup CSS\'i tek kaynakta ve her sayfadan erişilebilir');

await test('css/project-detail.css var ve popup\'ın çekirdek sınıflarını tanımlıyor', () => {
  const css = read('css/project-detail.css');
  const defined = classesDefinedIn(css);
  for (const c of ['detail-title', 'detail-meta', 'detail-info', 'designer-chip', 'related-section',
    'related-card', 'comment-row', 'pm-feedback-card', 'detail-gallery', 'meta-row']) {
    assert.ok(defined.has(c), `.${c} css/project-detail.css'te tanımlı olmalı`);
  }
});

await test('proje.html ve en-iyi-100.html aynı tek kaynağı <link>\'liyor', () => {
  for (const f of ['proje.html', 'en-iyi-100.html']) {
    assert.match(read(f), /<link rel="stylesheet" href="\/css\/project-detail\.css">/, `${f} paylaşılan CSS'i yüklemeli`);
  }
});

await test('lazy-modals proje modülünü açmadan ÖNCE CSS\'i yükleyip bekliyor', () => {
  const lm = read('js/components/lazy-modals.js');
  assert.match(lm, /cssDeps: \['css\/project-detail\.css'\]/, 'project modülü cssDeps bildirmeli');
  assert.match(lm, /const cssReady = Promise\.all\(\(mod\.cssDeps \|\| \[\]\)\.map\(loadCss\)\)/);
  assert.match(lm, /const depsReady = Promise\.all\(\[jsDepsReady, cssReady\]\)/, 'modül CSS hazır olmadan çalışmamalı');
  assert.match(lm, /pending\[key\] = cssReady\.then\(waitForPageScript\)/, 'sayfa kendi script\'ini taşısa da CSS beklenmeli');
});

// ASIL KAPI: popup'ın kullandığı hiçbir sınıf YALNIZCA bir sayfanın satır içi <style>'ında
// yaşamamalı. Yaşarsa popup başka bir sayfadan açıldığında o kural yoktur — bildirilen hata budur.
await test('popup\'ın hiçbir sınıfı yalnızca sayfa <style>\'ında tanımlı değil', () => {
  const used = classesUsedBy(POPUP_MODULES);
  const shared = classesDefinedIn(read('css/project-detail.css') + '\n' + injectedCss());
  const pageOnly = classesDefinedIn(inlineStyle(read('proje.html')));
  const leaked = [...used].filter(c => pageOnly.has(c) && !shared.has(c)).sort();
  assert.deepEqual(leaked, [],
    `Bu sınıflar YALNIZCA proje.html'in <style>'ında tanımlı; popup başka bir sayfadan açılınca stilsiz kalır. ` +
    `Kuralları css/project-detail.css'e taşı: ${leaked.join(', ')}`);
});

section('kişi / firma / ürün popup\'ları da CSS\'ini JS dizesinde taşımaz');

// Aynı sınıf hatanın diğer üç modalda oluşmasını engeller: CSS bir JS şablon dizesine geri
// taşınırsa (ya da bir sayfanın <style>'ına yazılırsa) o kural, popup başka bir yerden
// açıldığında yine eksik kalabilir. Kurallar artık gerçek stil dosyalarında.
const ENTITY_CSS = {
  architect: { file: 'css/architect-detail.css', module: 'js/components/architect-modal.js',
    pages: ['kisi.html', 'kisi-ekle.html'], probe: ['am-identity', 'detail-title', 'detail-meta'] },
  office: { file: 'css/office-detail.css', module: 'js/components/office-modal.js',
    pages: ['firma.html', 'firma-ekle.html', 'marka.html', 'marka-ekle.html', 'neden-mimarlab.html'],
    probe: ['om-identity', 'detail-title', 'detail-meta'] },
  product: { file: 'css/product-detail.css', module: 'js/components/product-modal.js',
    pages: ['urun.html', 'urun-ekle.html', 'proje.html', 'en-iyi-100.html'],
    probe: ['designer-chip', 'detail-title', 'detail-meta'] },
};

await test('üç modalın CSS\'i gerçek dosyada ve çekirdek sınıfları tanımlı', () => {
  for (const [key, cfg] of Object.entries(ENTITY_CSS)) {
    const defined = classesDefinedIn(read(cfg.file));
    for (const c of cfg.probe) assert.ok(defined.has(c), `${key}: .${c} ${cfg.file}'te tanımlı olmalı`);
  }
});

await test('modal modülleri artık <style> metni enjekte etmiyor (CSS JS dizesinde değil)', () => {
  for (const [key, cfg] of Object.entries(ENTITY_CSS)) {
    const src = read(cfg.module);
    assert.ok(!/style\.textContent\s*=\s*`/.test(src),
      `${key}: modül hâlâ JS dizesinden CSS enjekte ediyor — kurallar ${cfg.file}'e taşınmalı`);
    assert.match(src, new RegExp(`const href = '/${cfg.file.replace('/', '\\/')}'`),
      `${key}: modül güvenlik ağı olarak stil dosyasını <link>'lemeli`);
  }
});

await test('modülü kendi <script>\'iyle yükleyen HER sayfa stil dosyasını da <link>\'liyor', () => {
  for (const [key, cfg] of Object.entries(ENTITY_CSS)) {
    for (const page of cfg.pages) {
      assert.ok(read(page).includes(`<link rel="stylesheet" href="/${cfg.file}">`),
        `${page} ${cfg.file} dosyasını <link>'lemeli (popup o sayfada stilsiz açılır)`);
    }
    // Modülü <script> ile yükleyen başka bir sayfa varsa ve <link>'i yoksa yakala.
    const modRe = new RegExp(cfg.module.replace(/[/.]/g, m => '\\' + m));
    for (const page of ['kisi.html','firma.html','marka.html','urun.html','proje.html','en-iyi-100.html',
      'kisi-ekle.html','firma-ekle.html','marka-ekle.html','urun-ekle.html','neden-mimarlab.html','arama.html','index.html']) {
      const html = read(page);
      if (!modRe.test(html)) continue;
      assert.ok(html.includes(`<link rel="stylesheet" href="/${cfg.file}">`),
        `${page} ${cfg.module} yüklüyor ama ${cfg.file} <link>'i yok`);
    }
  }
});

await test('lazy-modals dört modalın da CSS\'ini açmadan önce yükleyip bekliyor', () => {
  const lm = read('js/components/lazy-modals.js');
  for (const f of ['css/architect-detail.css', 'css/office-detail.css', 'css/product-detail.css', 'css/project-detail.css']) {
    assert.ok(lm.includes(`cssDeps: ['${f}']`), `${f} cssDeps olarak bildirilmeli`);
  }
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(`  - ${f.name}: ${f.message}`); process.exit(1); }
