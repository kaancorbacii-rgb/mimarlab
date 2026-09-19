#!/usr/bin/env node
// BÜLTEN KAPSAMI + GÜNDEM BİLDİRİMİ + POPUP AÇILIŞ KARESİ — BİRİM TESTLERİ
// (kullanıcı isteği, 2026-09-12 madde 2 ve 3)
//
//   madde 2  "Bundan sonra yeni kişi, firma ve markalar e-posta bildirimi olarak gitmesin.
//             Her 5 gündem gönderisinden 1'i e-posta olarak gitsin."
//   madde 3  "Bazen popup açılırken önce normal sayfaymış gibi çok kısa süreliğine görülüp
//             kayboluyor. Sonra popup olarak karşımıza çıkıyor."
//
// İKİ SESSİZ REGRESYON RİSKİ, İKİSİ DE SÖZDİZİMİ KONTROLÜNDEN GEÇER:
//   * Kapsam kapısı TYPE_LABEL tablosunda (bkz. src/lib/newsletterNotify.js) — oraya architects/
//     offices satırı geri EKLENİRSE kişi/firma/marka mailleri sessizce yeniden akar. Ayrıca o
//     türler sayacı ARTIRMAMALI, yoksa proje/ürünlerin "5'te 1" sırasını yiyip onların
//     gönderimini seyreltirler.
//   * Gündem sayacı ('gundem') paylaşılan içerik sayacından ('global') AYRI olmalı; tek sayaca
//     düşerse yoğun otomatik gündem hattı proje/ürün maillerini pratikte hiç göndermez.
//
// scripts/test-2026-09-12-archive-live-guard.mjs İLE AYNI desen: gerçek schema.sql'e karşı
// node:sqlite D1 shim'i + fetch stub'ı (Resend'e giden gerçek istek yakalanır, ağa çıkılmaz).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { notifyNewsletterOfNewContent, notifyNewsletterOfNewGundem } from '../src/lib/newsletterNotify.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}

function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}

// Tek abone + RESEND_API_KEY dolu: gönderim kararı yalnızca "5'te 1" kapısına kalsın.
function freshEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO newsletter_subscribers (id, email, unsubscribe_token, created_at)
           VALUES ('s1', 'abone@example.com', 'tok-1', 1000)`);
  return { env: { DB: d1(db), RESEND_API_KEY: 'test-key' }, db };
}

function counterOf(db, key) {
  const row = db.prepare('SELECT count FROM newsletter_notify_counter WHERE key = ?').get(key);
  return row ? Number(row.count) : null;
}

// Resend'e giden her batch isteğini yakalar; ağ kullanılmaz.
function captureFetch() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

const projectRow = (n) => ({ slug: `proje-${n}`, title: `Proje ${n}`, description: 'Açıklama', images: JSON.stringify(['/projects/a.jpg']) });
const gundemRow = (n) => ({ slug: `haber-${n}`, title: `Haber ${n}`, summary: 'Özet', image_url: 'https://cdn.example.com/a.jpg' });

console.log('\nKapsam: kişi/firma/marka bülten maili ALMAZ (madde 2)');

// 2026-09-19: BÜLTEN İPTAL (newsletterNotify.js#NEWSLETTER_ENABLED = false, footer formu kaldırıldı).
// "N'de 1 mail" ve footer metni testleri kaldırıldı — kapalı bir özelliği ölçüyorlardı. Gönderimin
// GERÇEKTEN kapalı olduğu scripts/test-2026-09-19-ai-cost-caps.mjs'te kelepçeli.
await test('architects: mail gitmez ve sayaç HİÇ artmaz', async () => {
  const { env, db } = freshEnv();
  const f = captureFetch();
  try {
    for (let i = 0; i < 12; i++) {
      await notifyNewsletterOfNewContent(env, 'architects', { name: 'Mimar', slug: 'mimar', about: 'x', title: 'Mimar' });
    }
  } finally { f.restore(); }
  assert.equal(f.calls.length, 0, 'kişi için Resend çağrısı yapılmış');
  assert.equal(counterOf(db, 'global'), null, 'kişi gönderisi "5\'te 1" sayacını tüketmiş');
});

await test('offices (firma VE marka aynı tür): mail gitmez ve sayaç HİÇ artmaz', async () => {
  const { env, db } = freshEnv();
  const f = captureFetch();
  try {
    for (let i = 0; i < 12; i++) {
      await notifyNewsletterOfNewContent(env, 'offices', { name: 'Firma', slug: 'firma', about: 'x', title: 'Firma' });
    }
  } finally { f.restore(); }
  assert.equal(f.calls.length, 0, 'firma/marka için Resend çağrısı yapılmış');
  assert.equal(counterOf(db, 'global'), null, 'firma/marka gönderisi sayacı tüketmiş');
});

await test('kaynak: TYPE_LABEL ve buildLink kişi/firma/marka TANIMI TAŞIMIYOR', () => {
  // Davranış testleri tek bir mutasyonu (yalnızca TYPE_LABEL'a satır eklenmesi) yakalamaz — o
  // durumda buildLink null döndüğü için mail yine çıkmaz. Kapsamın İKİ yarısı da (etiket + link)
  // burada kaynak seviyesinde sabitlenir; ikisi birlikte geri gelirse test düşer.
  const src = readFileSync(new URL('../src/lib/newsletterNotify.js', import.meta.url), 'utf8');
  const labelBlock = src.slice(src.indexOf('const TYPE_LABEL = {'), src.indexOf('};', src.indexOf('const TYPE_LABEL = {')));
  for (const key of ['architects', 'offices']) {
    assert.ok(!labelBlock.includes(key), `TYPE_LABEL'a ${key} geri eklenmiş — kişi/firma/marka maili yeniden akar`);
  }
  const linkBlock = src.slice(src.indexOf('function buildLink('), src.indexOf('function truncateSummary('));
  for (const path of ['/kisi/', '/firma/', '/marka/']) {
    assert.ok(!linkBlock.includes(path), `buildLink ${path} dalı geri eklenmiş`);
  }
});

console.log('\nKapsam: proje/ürün hâlâ 5 paylaşımda 1 gönderilir (mevcut davranış korunuyor)');



console.log('\nGündem: her 10 gönderiden 1\'i (2026-09-18 — eskiden 5\'te 1)');



await test('gundem: slug/title eksikse sessizce döner ve sayaç artmaz', async () => {
  const { env, db } = freshEnv();
  const f = captureFetch();
  try {
    await notifyNewsletterOfNewGundem(env, { slug: '', title: 'Başlık' });
    await notifyNewsletterOfNewGundem(env, { slug: 'haber', title: '' });
    await notifyNewsletterOfNewGundem(env, null);
  } finally { f.restore(); }
  assert.equal(f.calls.length, 0);
  assert.equal(counterOf(db, 'gundem'), null);
});

await test('gundem: RESEND_API_KEY yoksa hiç D1\'e dokunmaz (sayaç boşa akmaz)', async () => {
  const { env, db } = freshEnv();
  delete env.RESEND_API_KEY;
  const f = captureFetch();
  try { for (let i = 1; i <= 6; i++) await notifyNewsletterOfNewGundem(env, gundemRow(i)); }
  finally { f.restore(); }
  assert.equal(f.calls.length, 0);
  assert.equal(counterOf(db, 'gundem'), null);
});

console.log('\nYayın kapılarının ikisi de gündem bildirimini çağırıyor (kaynak-seviyeli)');

await test('gundemIngest.js (otomatik hat) ve gundemAdmin.js (kullanıcı onayı) notify çağırıyor', () => {
  const ingest = readFileSync(new URL('../src/lib/gundemIngest.js', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../src/routes/gundemAdmin.js', import.meta.url), 'utf8');
  assert.match(ingest, /notifyNewsletterOfNewGundem\(env, \{/, 'otomatik yayın hattı bülteni bildirmiyor');
  assert.match(admin, /notifyNewsletterOfNewGundem\(env, \{/, 'admin onay kapısı bülteni bildirmiyor');
  // İkinci onay/arşivden geri alma tekrar mail göndermemeli.
  assert.match(admin, /if \(row\.status !== 'published'\)/, 'admin kapısında "ilk kez yayına girdi" koruması yok');
});

console.log('\nFooter + Üye Ol metinleri (madde 1 ve 2)');

// NOT (2026-09-12 ikinci tur): footer metni kullanıcı isteğiyle "Ücretsiz Üye Ol"dan tekrar
// "Üye Ol"a döndü — bu testin footer beklentisi artık orada, tek yerde yaşıyor (bkz.
// scripts/test-2026-09-12-home-rails.mjs#madde 1). Burada yalnızca bülten AÇIKLAMASI kalır.

await test('Üye Ol başlığı: "MİMARLAB\'a Ücretsiz Katıl" (sayfa + popup AYNI metin)', () => {
  const page = readFileSync(new URL('../uye-ol.html', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../js/components/auth-modal.js', import.meta.url), 'utf8');
  for (const [name, src] of [['uye-ol.html', page], ['auth-modal.js', modal]]) {
    assert.match(src, /auth-title">MİMARLAB'a Ücretsiz Katıl</, `${name} başlığı güncellenmemiş`);
  }
});

console.log('\nPopup açılış karesi: boot veil ayaktayken animasyon oynamaz (madde 3)');

await test('modal-shell: .boot-instant kuralı + open() içinde pm-boot-loading kapısı', () => {
  const shell = readFileSync(new URL('../js/components/modal-shell.js', import.meta.url), 'utf8');
  assert.match(shell, /\.modal-shell-overlay\.boot-instant \.modal-shell-panel\{transition:none;\}/,
    'boot-instant CSS kuralı kayıp — overlay yine 300 ms fade ile açılır ve veil kalkınca çıplak sayfa görünür');
  assert.match(shell, /pm-boot-loading'\)/, "open() artık boot veil'i sorgulamıyor");
  // Sınıf AYNI senkron akışta eklenip kaldırılmalı (kapanış animasyonu korunsun).
  const openBlock = shell.slice(shell.indexOf('function open({ triggerEl: trigger = null'));
  assert.match(openBlock, /classList\.add\('boot-instant'\)/);
  assert.match(openBlock, /classList\.remove\('boot-instant'\)/);
  // CSS sırası: kural .open'dan SONRA gelmeli (aynı specificity, sonra gelen kazanır).
  assert.ok(shell.indexOf('.modal-shell-overlay.boot-instant') > shell.indexOf('.modal-shell-overlay.open{'),
    'boot-instant kuralı .open kuralından ÖNCE — transition:none ezilir');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) {
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
