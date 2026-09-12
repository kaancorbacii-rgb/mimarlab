#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-12 (ikinci tur) — beş madde, tek test dosyası.
//
// MADDE 1 — Footer'daki "Ücretsiz Üye Ol" yeniden "Üye Ol". Metin İKİ yerde (bülten bandındaki CTA
//   + Topluluk sütunundaki bağlantı); biri atlanırsa aynı footer iki farklı metin gösterir.
//
// MADDE 2 — "Mobil görünümde ... e-posta yazma çubuğunun sağ tarafı gösteren ok işareti
//   gözükmüyor." KÖK NEDEN (kaynak okunarak bulundu, canlı davranışla birebir): ≤560px bloğunda
//   `.footer-subscribe-btn{padding:0 14px; ...}` kuralı `.footer-newsletter-btn`in padding:0'ından
//   SONRA geliyor; aynı özgüllükte kaynak sırası kazanır, buton 28px geniş ve
//   `*{box-sizing:border-box}` yürürlükte olduğundan içeriğe 0px kalıyor ve flex çocuğu olan SVG
//   sıfıra büzülüyordu. Masaüstünde sorun yoktu (orada sıra tersi). Bu test o media bloğunda
//   padding'in TEKRAR sıfırlandığını sabitler.
//
// MADDE 3 — "Ana sayfadaki carosellerde ... gönderi sayısını 6'ya düşür." Slot sabiti DÖRT yerde
//   birlikte yaşıyor (index.html, src/index.js gömülü veri, homeCarousels.js seçim sınırı,
//   admin.html önizlemesi); biri geride kalırsa ya karusel ile admin önizlemesi ayrışır ya da
//   gömülü veri karuselin beklediğinden az/çok kayıt taşır.
//
// MADDE 4 — Karusellerin altındaki altı "Son ..." şeridi. Sözleşme: şeritler karusellerin ZATEN
//   çektiği listenin 7-12. kayıtlarını gösterir, yani liste uçlarından karusel + şerit kadar
//   (6+6=12) kayıt çekilmeli ve gömülü veri (#ml-home-data) de 12 taşımalı. Gömülü gövdenin şekli
//   değiştiği için sürüm v:1 -> v:2; iki tarafın sürümü ayrışırsa istemci gömülü veriyi SESSİZCE
//   yok sayar (ya da yarım dolu şerit çizer). Gözlemci hedefi de kilitlenir: şeritler içerikleri
//   gelene kadar `hidden` durur ve hidden bir elemanın layout kutusu olmadığından
//   IntersectionObserver onu asla kesişmiş saymaz — bu yüzden KAPSAYICI gözlenir.
//
// MADDE 5 — Hesabım > "Firma / Marka Bilgileri" kutusunda "Yetkili Kullanıcılar" satırı. Liste
//   sunucudan gelir (GET /api/claims/office-managers) ve iki yönlü bir kapı taşır: (a) görebilmek
//   için isteyenin KENDİSİ de o firmanın yetkilisi olmalı, (b) listelenen hesaplar da yalnızca
//   yetkili pozisyonlardaki (OFFICE_EDIT_POSITIONS) onaylı hesaplar olmalı. Aşağıdaki testler
//   GERÇEK rota + node:sqlite + GERÇEK schema.sql ile çalışır (statik grep değil): yetki kuralı
//   sapınca burada durur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleClaimsRoute } from '../src/routes/claims.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { HOME_SLOT_COUNT } from '../src/lib/homeCarousels.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const chrome = read('js/components/site-chrome.js');
const indexHtml = read('index.html');
const serverIndex = read('src/index.js');
const adminHtml = read('admin.html');

console.log('\nmadde 1 — footer: "Üye Ol"');

await test('footer bülten bandı ve Topluluk sütunu "Üye Ol" diyor ("Ücretsiz" kalmadı)', () => {
  assert.match(chrome, /footer-subscribe-btn" href="\/uye-ol">Üye Ol</);
  assert.match(chrome, /<a href="\/uye-ol">Üye Ol<\/a>/, 'Topluluk sütunundaki bağlantı güncellenmemiş');
  assert.ok(!/Ücretsiz Üye Ol/.test(chrome), 'footer\'da hâlâ "Ücretsiz Üye Ol" geçiyor');
});

console.log('\nmadde 2 — mobilde bülten gönder okunun görünürlüğü');

await test('≤560px bloğunda .footer-newsletter-btn padding\'i SIFIRLANIR (ok büzülmez)', () => {
  const block = chrome.slice(chrome.indexOf('@media (max-width: 560px)'));
  const btnRule = block.match(/\.footer-newsletter-btn\{[^}]*\}/);
  assert.ok(btnRule, 'mobil blokta .footer-newsletter-btn kuralı yok');
  assert.match(btnRule[0], /padding:\s*0\s*;/, '.footer-subscribe-btn{padding:0 14px} bu kuralı ezer, ok 0px kalır');
  // İkinci güvence: ikon hiçbir dar kutuda büzülmesin.
  assert.match(chrome, /\.footer-newsletter-btn-icon\{flex-shrink:0;\}/);
});

console.log('\nmadde 3 — karusel slot sayısı 6 (dört dosya hizalı)');

await test('index.html / src/index.js / homeCarousels.js / admin.html aynı slot sayısını taşır', () => {
  const idx = Number(indexHtml.match(/const PROJECT_CAROUSEL_SLOTS = (\d+);/)[1]);
  const srv = Number(serverIndex.match(/const HOME_SLOTS = (\d+);/)[1]);
  const adm = Number(adminHtml.match(/const HOME_CAROUSEL_SLOTS = (\d+);/)[1]);
  assert.equal(idx, 6, 'index.html#PROJECT_CAROUSEL_SLOTS');
  assert.equal(srv, 6, 'src/index.js#HOME_SLOTS');
  assert.equal(HOME_SLOT_COUNT, 6, 'homeCarousels.js#HOME_SLOT_COUNT');
  assert.equal(adm, 6, 'admin.html#HOME_CAROUSEL_SLOTS');
});

console.log('\nmadde 4 — ana sayfa şeritleri');

await test('altı şerit HTML\'de sabit: başlık + "Tümünü Gör" hedefi', () => {
  for (const [id, title, href] of [
    ['rail-projects', 'Son Projeler', '/proje'],
    ['rail-architects', 'Son Kişiler', '/kisi'],
    ['rail-offices', 'Son Firmalar', '/firma'],
    ['rail-brands', 'Son Markalar', '/marka'],
    ['rail-products', 'Son Ürünler', '/urun'],
    ['rail-gundem', 'Son Gündem İçerikleri', '/gundem'],
  ]) {
    const section = indexHtml.slice(indexHtml.indexOf(`id="${id}"`));
    assert.ok(indexHtml.includes(`id="${id}"`), `${id} şeridi yok`);
    assert.ok(section.slice(0, 600).includes(`>${title}<`), `${id} başlığı "${title}" değil`);
    assert.ok(section.slice(0, 900).includes(`href="${href}"`), `${id} "Tümünü Gör" hedefi ${href} değil`);
  }
});

await test('şerit slotu 6 ve liste uçları karusel + şerit kadar çekiyor (6+6=12)', () => {
  assert.equal(Number(indexHtml.match(/const HOME_RAIL_SLOTS = (\d+);/)[1]), 6);
  assert.equal(Number(serverIndex.match(/const HOME_RAIL_SLOTS = (\d+);/)[1]), 6);
  assert.match(indexHtml, /const HOME_LIST_FETCH_LIMIT = PROJECT_CAROUSEL_SLOTS \+ HOME_RAIL_SLOTS;/);
  assert.match(serverIndex, /const HOME_LIST_LIMIT = HOME_SLOTS \+ HOME_RAIL_SLOTS;/);
  for (const ep of ['architects', 'offices', 'products']) {
    assert.ok(indexHtml.includes(`pick('${ep}', '/api/${ep}?limit=' + HOME_LIST_FETCH_LIMIT`), `index.html ${ep} ucu eski limiti kullanıyor`);
    assert.ok(serverIndex.includes(`/api/${ep}?limit=\${HOME_LIST_LIMIT}`), `src/index.js ${ep} ucu eski limiti kullanıyor`);
  }
});

await test('karusel ilk 6, şerit SONRAKİ 6 (aynı yanıt, ikinci istek yok)', () => {
  assert.match(indexHtml, /projeRail\.render\(pool\.slice\(PROJECT_CAROUSEL_SLOTS, PROJECT_CAROUSEL_SLOTS \+ HOME_RAIL_SLOTS\)\)/);
  assert.match(indexHtml, /const head = \(list\) => notPreview\(list\)\.slice\(0, PROJECT_CAROUSEL_SLOTS\);/);
  assert.match(indexHtml, /const tail = \(list\) => notPreview\(list\)\.slice\(PROJECT_CAROUSEL_SLOTS, PROJECT_CAROUSEL_SLOTS \+ HOME_RAIL_SLOTS\);/);
});

await test('#ml-home-data sürümü iki tarafta AYNI (v:2 — gövde artık 12 kayıt taşıyor)', () => {
  assert.match(serverIndex, /const data = \{ v: 2, t: Date\.now\(\)/);
  assert.match(indexHtml, /return \(d && d\.v === 2\) \? d : null;/);
});

await test('marka/gündem şeritleri ayrı uçlardan ve KAPSAYICI gözlenerek (hidden şerit değil) yüklenir', () => {
  assert.ok(indexHtml.includes("fetchPublicJson('/api/offices?brands=1&sort=newest&limit=' + HOME_RAIL_SLOTS + '&noPreview=1')"));
  assert.ok(indexHtml.includes("fetchPublicJson('/api/gundem?limit=' + HOME_RAIL_SLOTS)"));
  assert.match(indexHtml, /const anchorEl = document\.getElementById\('home-rails'\);/);
});

console.log('\nmadde 5 — Hesabım > Firma / Marka Bilgileri: "Yetkili Kullanıcılar"');

function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}

const OFFICE = 'Yetki Mimarlık';
const USERS = [
  ['u-kurucu', 'Kurucu Kişi'],
  ['u-yonetici', 'Yönetici Kişi'],
  ['u-ekip', 'Ekip Üyesi Kişi'],     // onaylı claim ama YETKİSİZ pozisyon
  ['u-founder', 'Kurucu Bağı Kişi'], // claim'i KİŞİ profilinde; firmaya office_founders ile bağlı
  ['u-yabanci', 'Yabancı Kişi'],
];

async function freshEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(read('schema.sql'));
  // name_fold generated kolonu — claimedProfiles.js#fetchOwnArchitectRows buna bağlı (schema.sql
  // canlı D1'in gerisinde; diğer testlerdeki AYNI satır).
  db.exec(read('migrations/0079_search_fold_columns.sql'));
  const now = Date.now();
  for (const [id, name] of USERS) {
    db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, 'x', 'user', ?)`).run(id, `${id}@example.com`, name, now);
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(await sha256Hex(`tok-${id}`), id, now, now + 3600_000);
  }
  db.prepare(`INSERT INTO offices (id, slug, name, source) VALUES (1, 'yetki-mimarlik', ?, 'legacy_static')`).run(OFFICE);
  for (const [uid, pos] of [['u-kurucu', 'Kurucu'], ['u-yonetici', 'Yönetici'], ['u-ekip', 'Ekip Üyesi']]) {
    db.prepare(
      `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position) VALUES (?, ?, 'office', ?, 'approved', ?, ?, ?)`
    ).run(`c-${uid}`, uid, OFFICE, now, now, pos);
  }
  // Kurucu bağı yolu: kişi kaydı + onaylı KİŞİ talebi + office_founders satırı.
  db.prepare(`INSERT INTO architects (id, slug, name, position, source) VALUES (10, 'kurucu-bagi-kisi', 'Kurucu Bağı Kişi', 'Ortak', 'legacy_static')`).run();
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at) VALUES ('c-founder', 'u-founder', 'architect', 'Kurucu Bağı Kişi', 'approved', ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO office_founders (office_id, architect_id) VALUES (1, 10)`).run();
  return { db, env: { DB: d1(db) } };
}

async function managers(env, uid, key = OFFICE) {
  const url = new URL(`https://mimarlab.com/api/claims/office-managers?key=${encodeURIComponent(key)}`);
  const headers = {};
  if (uid) headers.cookie = `__Host-mimarlab_session=tok-${uid}`;
  return handleClaimsRoute(new Request(url, { method: 'GET', headers }), env, url);
}

await test('yetkili kullanıcı listeyi görür: yalnızca YETKİLİ pozisyonlar, KENDİSİ listede yok', async () => {
  const { env } = await freshEnv();
  const res = await managers(env, 'u-kurucu');
  assert.equal(res.status, 200, await res.clone().text());
  const { items } = await res.json();
  assert.deepEqual(items.map(i => i.name).sort(), ['Kurucu Bağı Kişi', 'Yönetici Kişi']);
  assert.deepEqual(items.find(i => i.name === 'Yönetici Kişi').position, 'Yönetici');
  assert.ok(!items.some(i => i.name === 'Kurucu Kişi'), 'isteyen kendi adını görmemeli');
  assert.ok(!items.some(i => i.name === 'Ekip Üyesi Kişi'), 'Ekip Üyesi yetkili değil, listeye girmemeli');
  // E-posta/kullanıcı id'si asla dönmez.
  assert.deepEqual([...new Set(items.flatMap(i => Object.keys(i)))].sort(), ['name', 'position']);
});

await test('kurucu bağıyla yetkili olan da listeyi görür (claim yolu olmadan)', async () => {
  const { env } = await freshEnv();
  const res = await managers(env, 'u-founder');
  assert.equal(res.status, 200, await res.clone().text());
  const { items } = await res.json();
  assert.deepEqual(items.map(i => i.name).sort(), ['Kurucu Kişi', 'Yönetici Kişi']);
});

await test('Ekip Üyesi / yabancı 403, anonim 401, anahtarsız istek 400', async () => {
  const { env } = await freshEnv();
  assert.equal((await managers(env, 'u-ekip')).status, 403);
  assert.equal((await managers(env, 'u-yabanci')).status, 403);
  assert.equal((await managers(env, null)).status, 401);
  const url = new URL('https://mimarlab.com/api/claims/office-managers');
  const res = await handleClaimsRoute(new Request(url, { headers: { cookie: '__Host-mimarlab_session=tok-u-kurucu' } }), env, url);
  assert.equal(res.status, 400);
});

await test('istemci: satır "Görevin"in ALTINDA ve yalnızca liste doluyken çizilir', () => {
  const modal = read('js/components/auth-modal.js');
  const gorev = modal.indexOf("rows.push(['Görevin', role])");
  const yetkili = modal.indexOf("rows.push(['Yetkili Kullanıcılar'");
  assert.ok(gorev !== -1 && yetkili !== -1, 'satırlardan biri yok');
  assert.ok(yetkili > gorev, '"Yetkili Kullanıcılar" satırı "Görevin"in altında olmalı');
  assert.match(modal, /if \(Array\.isArray\(managers\) && managers\.length\) \{/, 'boş/yetkisiz yanıtta satır çizilmemeli');
  assert.match(modal, /\/api\/claims\/office-managers\?key=/);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
