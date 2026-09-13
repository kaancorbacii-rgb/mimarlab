#!/usr/bin/env node
// 'mimarlab:authchange' OLAY HEDEFİ — BİRİM TESTLERİ
// (kullanıcı bildirimi, 2026-09-13: "Bir hesaba giriş yaptığımda ana sayfadaki Senin İçin kısmı
//  otomatik olarak gelmiyor. Sayfayı yenileyince düzeliyor.")
//
// KÖK NEDEN: olay auth-nav.js'te WINDOW üzerinde yayınlanıyor, ama index.html onu DOCUMENT
// üzerinde dinliyordu. window'a dispatch edilen bir olay document dinleyicilerine ULAŞMAZ —
// window, document'in ÜSTÜNDEDİR; ne yakalama ne köpürme yolu document'ten geçer. Dinleyici
// hiç çalışmıyordu ve HİÇBİR HATA VERMİYORDU: giriş çağrısı kutusu sessizce yerinde kalıyordu.
//
// BU EN SESSİZ REGRESYON TÜRÜ: yeni bir sayfa bu olayı dinlemek istediğinde 'document' yazmak
// tamamen makul görünür, konsola hiçbir uyarı düşmez ve yalnızca "giriş sonrası bir şey
// güncellenmiyor" olarak, çoğu zaman fark edilmeden ortaya çıkar. Bu yüzden hedef hizalanması
// kod tabanı genelinde kelepçelenir.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const EVENT = 'mimarlab:authchange';

// Olayı dinleyebilecek TÜM istemci kaynakları: kök HTML sayfaları + kök .js + js/ altındaki her şey.
function sourceFiles() {
  const out = [];
  for (const f of readdirSync(root)) {
    if (f.endsWith('.html') || f.endsWith('.js')) out.push(f);
  }
  const walk = (dir) => {
    for (const e of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}${e.name}/`);
      else if (e.name.endsWith('.js')) out.push(`${dir}${e.name}`);
    }
  };
  walk('js/');
  return out;
}

console.log(`\n1 — olayın yayın hedefi`);

await test('auth-nav.js olayı WINDOW üzerinde yayınlıyor (tek yayın noktası)', () => {
  const s = read('auth-nav.js');
  const dispatches = [...s.matchAll(new RegExp(`(\\w+)\\.dispatchEvent\\(new CustomEvent\\('${EVENT}'`, 'g'))];
  assert.equal(dispatches.length, 1, `${EVENT} tam olarak bir yerden yayınlanmalı`);
  assert.equal(dispatches[0][1], 'window', `${EVENT} window üzerinde yayınlanmalı`);
});

console.log(`\n2 — her dinleyici AYNI hedefte`);

await test('hiçbir dosya bu olayı document üzerinde dinlemiyor', () => {
  const offenders = [];
  for (const f of sourceFiles()) {
    const s = read(f);
    if (!s.includes(EVENT)) continue;
    // Yorum satırlarında olay adının geçmesi serbest; aranan şey GERÇEK bir document dinleyicisi.
    const re = new RegExp(`document\\.addEventListener\\(\\s*['"]${EVENT}['"]`, 'g');
    if (re.test(s)) offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    `bu dosyalar ${EVENT}'i document üzerinde dinliyor — window'a dispatch edilen olay onlara ULAŞMAZ`);
});

await test('olayı dinleyen her dosya window.addEventListener kullanıyor', () => {
  const listeners = [];
  for (const f of sourceFiles()) {
    const s = read(f);
    const re = new RegExp(`(\\w+)\\.addEventListener\\(\\s*['"]${EVENT}['"]`, 'g');
    for (const m of s.matchAll(re)) listeners.push({ file: f, target: m[1] });
  }
  // En az bir dinleyici olmalı — regex bozulursa test sessizce "geçmesin".
  assert.ok(listeners.length >= 5, `beklenenden az dinleyici bulundu (${listeners.length}) — regex bozulmuş olabilir`);
  const bad = listeners.filter(l => l.target !== 'window');
  assert.deepEqual(bad, [], 'window dışında bir hedefte dinleyen var');
});

console.log('\n3 — ana sayfa "Senin İçin" bloğu giriş sinyalini gerçekten işliyor');

await test('index.html authchange geldiğinde akışı yeniden yüklüyor', () => {
  const s = read('index.html');
  assert.match(s, new RegExp(`window\\.addEventListener\\('${EVENT}', \\(\\) => \\{[\\s\\S]{0,200}?foryouStarted = false;[\\s\\S]{0,80}?startForYou\\(\\);`),
    'authchange dinleyicisi foryouStarted bayrağını sıfırlayıp startForYou çağırmalı');
  // startForYou tek-seferlik bayrakla korunuyor; bayrak sıfırlanmazsa ikinci çağrı sessizce hiçbir
  // şey yapmaz — düzeltmenin ASIL işleyen kısmı budur.
  assert.match(s, /function startForYou\(\)\{\s*\n\s*if\(foryouStarted\) return;/);
});

console.log(`\n${failed ? 'BAŞARISIZ' : 'TAMAM'} — ${passed} geçti, ${failed} kaldı`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
