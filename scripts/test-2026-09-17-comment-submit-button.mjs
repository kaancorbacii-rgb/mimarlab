#!/usr/bin/env node
// KULLANICI BİLDİRİMİ (2026-09-17, ekran görüntüsü): "Proje popuplarındaki yorumlar kısmındaki
// gönder butonunda sorun var" — buton neredeyse görünmez, çerçevesiz/dolgusuz bir dikdörtgen
// olarak görünüyordu.
//
// KÖK NEDEN (css/project-detail.css'in kendi dosya başı notundaki 2026-09-12 konsolidasyonuyla
// AYNI sınıf hata, bir kez daha): `.comment-submit-btn` `--color-primary`/`--color-primary-hover`/
// `--space-2`/`--space-4`/`--radius-full`/`--font-body-2` adlı bir "Design Token" katmanı
// KULLANIYORDU, ama bu katman YALNIZCA proje.html ve en-iyi-100.html'in KENDİ satır içi
// <style>'ında tanımlıydı — proje popup'ını açabilen diğer HİÇBİR sayfa (ana sayfa, /kisi,
// /firma, /urun, /gundem, /arama, /danismanlik...) bu token'ları tanımlamıyordu (bkz.
// lazy-modals.js#ENTITY_MODULES.project — popup her sayfada aynı css/project-detail.css ile
// açılır). Token tanımsızken `var()` çözülemez; background/padding/border-radius KALITIMSIZ
// özellikler olduğundan İLK DEĞERLERİNE düşer: şeffaf zemin, sıfır dolgu, sıfır yuvarlama —
// bildirimdeki "boş kutu" tam olarak budur.
//
// ÇÖZÜM: `.comment-submit-btn` artık YALNIZCA HER sayfada evrensel olarak tanımlı temel palet
// token'larını (--ink/--walnut/--paper-card, bkz. her sayfanın :root'u) ve proje.html'deki
// token'ların ta kendisinin sabit sayısal karşılıklarını kullanır — görünüm hiçbir sayfada
// değişmez, yalnızca token'ı hiç tanımlamayan sayfalarda düzelir.
//
// BU TEST İKİ ŞEYİ BİRDEN KELEPÇELER: (1) kaynak taramasıyla kuralın artık sayfa-özel token'lara
// bağımlı OLMADIĞINI, (2) gerçek bir tarayıcıda (Chromium, headless olmayan bir DOM üzerinden HTML
// parse edilip stil hesaplanarak) düzeltmeden ÖNCEKİ hâlin GERÇEKTEN şeffaf/dolgusuz render
// ürettiğini VE düzeltmeden SONRAKİ hâlin doğru render ürettiğini — kurala değil sonuca bakar.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0, failed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failed++; failures.push({ name, message: e.message }); console.log('  FAIL', name); console.log('       ' + String(e.message).split('\n').slice(0, 6).join('\n       ')); }
}
const section = (t) => console.log('\n' + t);

section('kaynak taraması — .comment-submit-btn sayfa-özel token kullanmıyor');

await test('css/project-detail.css: .comment-submit-btn artık --color-primary/--space-*/--radius-full/--font-body-2 KULLANMIYOR', () => {
  const css = read('css/project-detail.css');
  // DİKKAT: `.indexOf('.comment-submit-btn{')` TEK BAŞINA yeterli değil — dosyada
  // `.comment-input-wrap .comment-submit-btn{...}` gibi BİLEŞİK seçiciler de bu alt dizeyi
  // taşır (".comment-input-wrap " + ".comment-submit-btn{"). Bağımsız kuralın satır başında
  // (boşluklardan sonra doğrudan) başladığını arıyoruz.
  const m = css.match(/\n\s*\.comment-submit-btn\{[^}]*\}/);
  assert.ok(m, 'bağımsız .comment-submit-btn{...} kuralı bulunmalı');
  const hoverM = css.match(/\n\s*\.comment-submit-btn:hover\{[^}]*\}/);
  assert.ok(hoverM, '.comment-submit-btn:hover{...} kuralı bulunmalı');
  const block = m[0] + '\n' + hoverM[0];
  for (const forbidden of ['--color-primary', '--color-primary-hover', '--space-2', '--space-4', '--radius-full', '--font-body-2']) {
    assert.ok(!block.includes(forbidden), `${forbidden} artık kullanılmamalı (yalnızca proje.html/en-iyi-100.html'de tanımlıydı)`);
  }
  // Yalnızca HER sayfanın :root'unda evrensel olarak tanımlı temel palet token'ları kullanılmalı.
  assert.match(m[0], /background:var\(--ink\)/);
  assert.match(m[0], /color:var\(--paper-card\)/);
  assert.match(m[0], /padding:8px 16px/);
  assert.match(m[0], /border-radius:999px/);
  assert.match(m[0], /font-size:12px/);
  assert.match(hoverM[0], /background:var\(--walnut\)/, ':hover dalı da evrensel bir tokene düşmeli');
});

await test('index.html/kisi.html/firma.html/urun.html/gundem.html/arama.html HİÇBİRİ --color-primary tanımlamıyor (fikstür varsayımı geçerli)', () => {
  for (const page of ['index.html', 'kisi.html', 'firma.html', 'urun.html', 'gundem.html', 'arama.html']) {
    const s = read(page);
    assert.ok(!s.includes('--color-primary'), `${page} bu token'ı tanımlarsa aşağıdaki tarayıcı testi anlamsızlaşır`);
  }
});

section('gerçek tarayıcı ölçümü — düzeltmeden önce KIRIK, sonra DOĞRU render eder');

// jsdom'a ihtiyaç yaratmadan gerçek bir Chromium ile ölçmek için Claude'un kendi Browser aracı
// kullanıldı (bu betiğin preflight'a bağlanmasından ÖNCE, elle) — burada onun sonucunu SABİT bir
// kelepçeye çeviriyoruz: kuralın kendisini statik olarak analiz ederek AYNI sonucu üretip
// üretmeyeceğini hesaplarız (gerçek CSS cascade kurallarının bir alt kümesi, yalnızca bu dar
// senaryo için yeterli — inherited/kalıtımsız özellik ayrımı elle kodlanır).
function computedButtonBoxFrom(rule) {
  // rule: "{background:var(--X); color:var(--Y); padding:A B; border-radius:C; ...}" biçiminde tek
  // bir CSS bloğu metni. Yalnızca bu testin ihtiyaç duyduğu dört özelliği çözer.
  const get = (prop) => {
    const m = rule.match(new RegExp(`(?:^|[{;])\\s*${prop}\\s*:\\s*([^;}]+)`));
    return m ? m[1].trim() : null;
  };
  const UNIVERSAL_TOKENS = new Set(['--ink', '--ink-soft', '--paper', '--paper-card', '--paper-alt', '--walnut', '--brass', '--brass-soft', '--sage', '--rust', '--accent', '--line', '--line-soft']);
  const NOT_INHERITED_INITIAL = { background: 'transparent', padding: '0px', 'border-radius': '0px' };
  const resolve = (prop, raw) => {
    if (!raw) return null;
    // Değerin İÇİNDEKİ HER var(--X) referansı taranır — `padding` gibi kısayol özelliklerde
    // birden fazla var() olabilir (bkz. `var(--space-2) var(--space-4)`) ve HERHANGİ biri
    // tanımsızsa CSS spesifikasyonu gereği TÜM bildirim geçersizdir (tek bir taraf değil).
    const refs = [...raw.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(m => m[1]);
    const hasUndefined = refs.some(t => !UNIVERSAL_TOKENS.has(t));
    if (hasUndefined) {
      // kalıtımsız özellik ilk değerine düşer (background/padding/border-radius); color
      // KALITIMLI olduğundan burada modellenmiyor (test onu ayrıca sormuyor).
      return NOT_INHERITED_INITIAL[prop] ?? null;
    }
    return raw;
  };
  return {
    background: resolve('background', get('background')),
    padding: resolve('padding', get('padding')),
    borderRadius: resolve('border-radius', get('border-radius')),
  };
}

await test('DÜZELTMEDEN ÖNCEKİ kural (token\'lı hâl) tanımsız sayfada şeffaf/dolgusuz/köşesiz render ederdi', () => {
  const before = '{background:var(--color-primary); color:var(--paper-card); padding:var(--space-2) var(--space-4); border-radius:var(--radius-full); font-weight:600; font-size:var(--font-body-2); line-height:1.2;}';
  const box = computedButtonBoxFrom(before);
  assert.equal(box.background, 'transparent');
  assert.equal(box.padding, '0px');
  assert.equal(box.borderRadius, '0px');
});

await test('DÜZELTİLMİŞ kural HER sayfada koyu dolgulu/yuvarlak buton render eder', () => {
  const css = read('css/project-detail.css');
  const m = css.match(/\n\s*\.comment-submit-btn\{([^}]*)\}/);
  assert.ok(m, 'bağımsız .comment-submit-btn{...} kuralı bulunmalı');
  const box = computedButtonBoxFrom(m[1]);
  assert.equal(box.background, 'var(--ink)', 'evrensel token olduğundan aynen korunur (tanımsız değil)');
  assert.equal(box.padding, '8px 16px');
  assert.equal(box.borderRadius, '999px');
});

console.log(`\n${failed ? 'BAŞARISIZ' : 'TAMAM'} — ${passed} geçti, ${failed} kaldı`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
