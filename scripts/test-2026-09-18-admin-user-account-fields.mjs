// 2026-09-18 — Admin > Üyeler detay pop-up'ı YALNIZCA hesap alanlarını gösterir.
// Kullanıcı isteği: "admin panelinde siteye üye olan kullanıcıların gözüktüğü paneldeki doğum yılı,
// üniversite vs. gibi bilgileri kaldır. Sadece Ad Soyad, kullanıcı adı ve e-posta gözüksün."
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const start = html.indexOf('<h3>Profil Bilgileri</h3>');
const end = html.indexOf('id="ud-save-btn"', start);
const section = html.slice(start, end);

test('Profil Bilgileri: yalnızca Ad Soyad, Kullanıcı Adı, E-posta', () => {
  const labels = [...section.matchAll(/<label>([^<]+)<\/label>/g)].map(m => m[1]);
  assert.deepEqual(labels, ['Ad Soyad', 'Kullanıcı Adı', 'E-posta']);
});

test('E-posta salt okunur, kaldırılan alanların id\'leri hiçbir yerde yok', () => {
  assert.match(section, /id="ud-f-email"[^>]*readonly/);
  for (const id of ['ud-f-dob', 'ud-f-school', 'ud-f-profession', 'ud-f-position', 'ud-f-about']) {
    assert.ok(!html.includes(id), `${id} hâlâ admin.html'de`);
  }
});

test('Kaydet gövdesi yalnızca name + username taşır (e-posta gönderilmez)', () => {
  const a = html.indexOf("getElementById('ud-save-btn').addEventListener");
  const body = html.slice(a, html.indexOf('};', a));
  assert.match(body, /name: document\.getElementById\('ud-f-name'\)/);
  assert.match(body, /username: document\.getElementById\('ud-f-username'\)/);
  assert.ok(!/email|dob|school|profession|position|about/.test(body), 'gövdede fazladan alan var');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) process.exit(1);
