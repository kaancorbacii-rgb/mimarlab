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
// MADDE 4 — Karusellerin altındaki altı "Son ..." şeridi KALDIRILDI (kullanıcı isteği, 2026-09-12
//   üçüncü tur: "Ana sayfaya koyduğumuz Son projeler, son kişiler, son firmalar, son markalar,
//   son ürünler, son gündem içerikleri bölümlerini kaldır"). Kaldırma üç dosyaya dokunur ve
//   yarısı kalırsa sessiz bir kusur doğar: (a) index.html'de şeritlerin HTML/CSS/JS'i ve
//   /api/offices?brands=1 + /api/gundem istekleri tamamen gitmeli — geride kalan bir
//   createRail/loadRailExtras artık var olmayan bir DOM düğümünü arar ve ana sayfa betiği
//   ReferenceError'la düşerdi; (b) liste uçları yeniden TAM karusel slotu (6) kadar çekmeli —
//   şerit için eklenen +6 kaydın alıcısı yok; (c) gömülü gövdenin şekli değiştiğinden sürüm
//   v:2 -> v:3 ve iki taraf AYNI sürümü taşımalı — ayrışırsa istemci gömülü veriyi sessizce yok
//   sayar (ya da eski bir belge yeni gövdeyi yanlış okuyup yarım dolu karusel çizer).
//
// MADDE 5 — Hesabım > "Firma / Marka Bilgileri" kutusunda "Yetkili Kullanıcılar" satırı. Liste
//   sunucudan gelir (GET /api/claims/office-managers) ve iki yönlü bir kapı taşır: (a) görebilmek
//   için isteyenin KENDİSİ de o firmanın yetkilisi olmalı, (b) listelenen hesaplar da yalnızca
//   yetkili pozisyonlardaki (OFFICE_EDIT_POSITIONS) onaylı hesaplar olmalı. Aşağıdaki testler
//   GERÇEK rota + node:sqlite + GERÇEK schema.sql ile çalışır (statik grep değil): yetki kuralı
//   sapınca burada durur.
// MADDE 6 (ikinci tur, kullanıcı isteği 2026-09-12) — "Yetkili Kullanıcılar" satırındaki X:
//   yetkiyi KALDIRIR (admin tarafından verilmiş olsa bile) ama künyeye DOKUNMAZ ("bu X işareti
//   kişileri bu popuplardan silmez"). İptal, yeni bir tablo açmadan profile_claims'in kendi
//   satırında status='revoked' olarak yaşar — claim yolundaki tüm kapılar status='approved'
//   aradığı için kendiliğinden kapanır; KURUCU BAĞI yolunda ise iptal kaydı iki fonksiyonda
//   (canEditOfficeViaFounderLink, fetchOfficeFounderLinks) açıkça okunur. Yeni tablo bilerek
//   SEÇİLMEDİ: migration'lar deploy ile otomatik uygulanmıyor (bkz. CLAUDE.md), tablo gelmeden
//   canlıya çıkan kod yetki sorgularını düşürürdü.
//
// MADDE 7 — "+" ile e-postadan yetki verme: kayıtlı ÜYE zorunlu (kullanıcı kararı: davet tutulmaz,
//   hata verilir). Kayıt, admin atamasının kullandığı AYNI satırdır (approved + 'Yönetici').
//
// MADDE 8 — Atama artık ÜNVAN değil, YALNIZCA YETKİ: her firma/marka ataması 'Yönetici' olarak
//   donar ve atanan hesaplar firma/kişi pop-up'larının Kurucular/Ekip listelerinde ARTIK
//   GÖRÜNMEZ (kullanıcı kararı: "Kalksın — rol = sadece yetki"). Künye yalnızca office_founders
//   ve künye kutularındaki adlardan beslenir.
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

console.log('\nmadde 4 — ana sayfa şeritleri kaldırıldı');

await test('altı şeridin HTML\'i, CSS\'i ve JS\'i index.html\'de kalmadı', () => {
  for (const id of ['rail-projects', 'rail-architects', 'rail-offices', 'rail-brands', 'rail-products', 'rail-gundem']) {
    assert.ok(!indexHtml.includes(`id="${id}"`), `${id} şeridi hâlâ HTML'de`);
  }
  for (const title of ['Son Projeler', 'Son Kişiler', 'Son Firmalar', 'Son Markalar', 'Son Ürünler', 'Son Gündem İçerikleri']) {
    assert.ok(!indexHtml.includes(`>${title}<`), `"${title}" başlığı hâlâ ana sayfada`);
  }
  // Kapsayıcı + CSS sınıfları: geride kalan bir kural ölü ağırlıktır, kalan bir kapsayıcı ise
  // IntersectionObserver'ı yeniden canlandırırdı.
  // Kapsayıcının kendisi: id VE class ayrı ayrı aranır (bu dosyanın ADI da "home-rails" geçtiği
  // için çıplak alt dizgi araması index.html'deki test referansına takılırdı).
  assert.ok(!indexHtml.includes('id="home-rails"'), 'şerit kapsayıcısı (#home-rails) hâlâ duruyor');
  assert.ok(!indexHtml.includes('class="home-rails"'), 'şerit kapsayıcısı (.home-rails) hâlâ duruyor');
  assert.ok(!indexHtml.includes('.home-rails{'), 'şerit kapsayıcısının CSS kuralı hâlâ duruyor');
  assert.ok(!/\.rail-[a-z]/.test(indexHtml), 'şerit CSS kuralları hâlâ duruyor');
});

await test('şerit JS\'i tamamen gitti (var olmayan DOM\'u arayan kod kalmadı)', () => {
  for (const sym of ['createRail', 'loadRailExtras', 'railExtrasLoaded', 'HOME_RAIL_SLOTS', 'RAIL_IMG',
                     'projeRail', 'kisiRail', 'firmaRail', 'markaRail', 'urunRail', 'gundemRail']) {
    assert.ok(!indexHtml.includes(sym), `${sym} hâlâ index.html'de — ana sayfa betiği düşebilir`);
  }
  assert.ok(!indexHtml.includes('/api/offices?brands=1&sort=newest'), 'marka şeridinin isteği hâlâ atılıyor');
  assert.ok(!indexHtml.includes("fetchPublicJson('/api/gundem"), 'gündem şeridinin isteği hâlâ atılıyor');
  assert.ok(!serverIndex.includes('HOME_RAIL_SLOTS'), 'src/index.js hâlâ şerit slotu taşıyor');
});

await test('liste uçları yeniden TAM karusel slotu kadar çekiyor (şerit için +6 yok)', () => {
  assert.match(indexHtml, /const HOME_LIST_FETCH_LIMIT = PROJECT_CAROUSEL_SLOTS;/);
  assert.match(serverIndex, /const HOME_LIST_LIMIT = HOME_SLOTS;/);
  for (const ep of ['architects', 'offices', 'products']) {
    assert.ok(indexHtml.includes(`pick('${ep}', '/api/${ep}?limit=' + HOME_LIST_FETCH_LIMIT`), `index.html ${ep} ucu eski limiti kullanıyor`);
    assert.ok(serverIndex.includes(`/api/${ep}?limit=\${HOME_LIST_LIMIT}`), `src/index.js ${ep} ucu eski limiti kullanıyor`);
  }
});

await test('karusel yanıtın ilk 6\'sını çizer (şerit kuyruğu kalmadı)', () => {
  assert.match(indexHtml, /const head = \(list\) => notPreview\(list\)\.slice\(0, PROJECT_CAROUSEL_SLOTS\);/);
  assert.ok(!indexHtml.includes('const tail = '), 'şeridi besleyen tail() hâlâ duruyor');
});

// Sürümün SAYISI burada BİLEREK sabitlenmez (o iş yeni gövdeyi ekleyen turun testinde: bkz.
// scripts/test-2026-09-12-home-bento.mjs). Burada kilitlenen şey, gövde her değiştiğinde iki
// tarafın BİRLİKTE değişmesi: sunucu v:N gömerken istemci v:N-1 bekliyorsa gömülü veri sessizce
// yok sayılır (her ziyaret gereksiz API isteği) ya da daha kötüsü yanlış şekilde okunur.
await test('#ml-home-data sürümü iki tarafta AYNI (şerit turunun 6 kayıtlık gövdesinden sonra ≥3)', () => {
  const srv = Number(serverIndex.match(/const data = \{\s*\n?\s*v: (\d+), t: Date\.now\(\)/)[1]);
  const cli = Number(indexHtml.match(/return \(d && d\.v === (\d+)\) \? d : null;/)[1]);
  assert.equal(srv, cli, `sunucu v:${srv} gömüyor, istemci v:${cli} bekliyor — gömülü veri yok sayılır`);
  assert.ok(srv >= 3, `sürüm şerit turunun altına düşmüş (v:${srv})`);
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
  // E-posta/kullanıcı id'si asla dönmez (source = yetkinin nereden geldiği: 'claim' | 'founder').
  assert.deepEqual([...new Set(items.flatMap(i => Object.keys(i)))].sort(), ['name', 'position', 'source']);
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

await test('istemci: satır "Görevin"in ALTINDA; yetkisiz yanıtta (null) hiç çizilmez', () => {
  const modal = read('js/components/auth-modal.js');
  const gorev = modal.indexOf("rows.push(['Görevin', role])");
  const yetkili = modal.indexOf("rows.push(['Yetkili Kullanıcılar'");
  assert.ok(gorev !== -1 && yetkili !== -1, 'satırlardan biri yok');
  assert.ok(yetkili > gorev, '"Yetkili Kullanıcılar" satırı "Görevin"in altında olmalı');
  // 403/ağ hatası cache'e null yazar -> Array.isArray false -> satır yok. (Boş dizi = yetkili ama
  // başka yetkili yok: satır + düğmesiyle çizilir, bkz. madde 6/7 testleri.)
  assert.match(modal, /firmManagersCache\[key\] = \(d && Array\.isArray\(d\.items\)\) \? d\.items : null;/);
  assert.match(modal, /\/api\/claims\/office-managers\?key=/);
});

console.log('\nmadde 6/7 — yetki kaldır (X) ve e-postayla yetki ver (+)');

async function post(env, uid, body) {
  const url = new URL('https://mimarlab.com/api/claims/office-managers');
  return handleClaimsRoute(new Request(url, {
    method: 'POST',
    headers: { cookie: `__Host-mimarlab_session=tok-${uid}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), env, url);
}
async function del(env, uid, key, name) {
  const url = new URL(`https://mimarlab.com/api/claims/office-managers?key=${encodeURIComponent(key)}&name=${encodeURIComponent(name)}`);
  return handleClaimsRoute(new Request(url, { method: 'DELETE', headers: { cookie: `__Host-mimarlab_session=tok-${uid}` } }), env, url);
}
const names = async (env, uid) => ((await (await managers(env, uid)).json()).items || []).map(i => i.name).sort();

await test('X: admin ATAMASIYLA gelen yetkiyi kaldırır — satır revoked olur, künyeye dokunulmaz', async () => {
  const { db, env } = await freshEnv();
  const res = await del(env, 'u-kurucu', OFFICE, 'Yönetici Kişi');
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(db.prepare(`SELECT status FROM profile_claims WHERE id = 'c-u-yonetici'`).get().status, 'revoked');
  assert.deepEqual(await names(env, 'u-kurucu'), ['Kurucu Bağı Kişi'], 'listeden düşmeli');
  // KÜNYE: office_founders satırları olduğu gibi durur (X kimseyi popup'tan silmez).
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM office_founders`).get().n, 1);
});

await test('X: KURUCU BAĞIYLA gelen yetkiyi de kaldırır — office_founders korunur, yetki kapanır', async () => {
  const { db, env } = await freshEnv();
  const { canEditOfficeViaFounderLink } = await import('../src/lib/claimedProfiles.js');
  const { OFFICE_EDIT_POSITIONS } = await import('../src/lib/projectClaimAccess.js');
  const founderUser = { id: 'u-founder', name: 'Kurucu Bağı Kişi' };
  assert.equal(await canEditOfficeViaFounderLink(env, founderUser, OFFICE, OFFICE_EDIT_POSITIONS), true, 'önce yetkili olmalı');
  assert.equal((await del(env, 'u-kurucu', OFFICE, 'Kurucu Bağı Kişi')).status, 200);
  assert.equal(await canEditOfficeViaFounderLink(env, founderUser, OFFICE, OFFICE_EDIT_POSITIONS), false, 'iptalden sonra yetki kalmamalı');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM office_founders WHERE architect_id = 10`).get().n, 1, 'kurucu bağı SİLİNMEMELİ');
  assert.deepEqual(await names(env, 'u-kurucu'), ['Yönetici Kişi']);
});

await test('X: yetkisiz kullanıcı kaldıramaz (403), kendini kaldıramaz (400), olmayan üye 404', async () => {
  const { env } = await freshEnv();
  assert.equal((await del(env, 'u-ekip', OFFICE, 'Yönetici Kişi')).status, 403);
  assert.equal((await del(env, 'u-yabanci', OFFICE, 'Yönetici Kişi')).status, 403);
  assert.equal((await del(env, 'u-kurucu', OFFICE, 'Kurucu Kişi')).status, 400, 'kendi yetkisi');
  assert.equal((await del(env, 'u-kurucu', OFFICE, 'Olmayan Kişi')).status, 404);
});

await test('+: kayıtlı üyeye yetki verir (approved + Yönetici) ve iptali geri alır', async () => {
  const { db, env } = await freshEnv();
  // önce yetkisiz bir hesap: Ekip Üyesi
  let res = await post(env, 'u-kurucu', { key: OFFICE, email: 'u-ekip@example.com' });
  assert.equal(res.status, 201, await res.clone().text());
  assert.equal((await res.json()).item.position, 'Yönetici');
  const row = db.prepare(`SELECT status, office_position FROM profile_claims WHERE user_id = 'u-ekip' AND profile_type = 'office'`).get();
  assert.deepEqual([row.status, row.office_position], ['approved', 'Yönetici']);
  assert.ok((await names(env, 'u-kurucu')).includes('Ekip Üyesi Kişi'));
  // iptal sonrası tekrar ekleme yetkiyi geri verir
  await del(env, 'u-kurucu', OFFICE, 'Ekip Üyesi Kişi');
  assert.equal(db.prepare(`SELECT status FROM profile_claims WHERE user_id = 'u-ekip' AND profile_type = 'office'`).get().status, 'revoked');
  assert.equal((await post(env, 'u-kurucu', { key: OFFICE, email: 'u-ekip@example.com' })).status, 201);
  assert.equal(db.prepare(`SELECT status FROM profile_claims WHERE user_id = 'u-ekip' AND profile_type = 'office'`).get().status, 'approved');
});

await test('+: kayıtlı OLMAYAN e-posta hata verir (davet kaydı tutulmaz), yetkisiz ekleyemez', async () => {
  const { db, env } = await freshEnv();
  const res = await post(env, 'u-kurucu', { key: OFFICE, email: 'yok@example.com' });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /kayıtlı bir üye yok/i);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM profile_claims WHERE profile_key = ?`).get(OFFICE).n, 3, 'hiçbir satır eklenmemeli');
  assert.equal((await post(env, 'u-yabanci', { key: OFFICE, email: 'u-ekip@example.com' })).status, 403);
  assert.equal((await post(env, 'u-kurucu', { key: 'Olmayan Firma', email: 'u-ekip@example.com' })).status, 403, 'yetkisi olmayan firma');
});

console.log('\nmadde 8 — atama = yalnızca yetki (künyede görünmez)');

await test('sunucu: firma ataması HER ZAMAN Yönetici olarak donar (admin seçimi yok sayılır)', () => {
  const admin = read('src/routes/admin.js');
  assert.match(admin, /function normalizeOfficePosition\(\) \{[\s\S]{0,80}?return MANAGER_POSITION;/, 'atama görevi sabitlenmemiş');
  assert.ok(!/normalizeOfficePosition\(body\.officePosition\)/.test(admin), 'admin hâlâ gönderilen görevi okuyor');
  const adminHtml = read('admin.html');
  assert.ok(!/id="ud-assign-office-position"/.test(adminHtml), 'atama kutusundaki görev seçici kaldırılmalı');
  assert.ok(!/<select class="claim-position-select"/.test(adminHtml), 'onay ekranındaki görev seçici kaldırılmalı');
  assert.ok(!/<select class="ud-claim-position-select"/.test(adminHtml), 'kullanıcı detayındaki görev seçici kaldırılmalı');
});

await test('firma pop-up payload: atanan hesap Kurucular/Ekip listelerinde YOK, claimed hâlâ true', async () => {
  const { db, env } = await freshEnv();
  db.prepare(`INSERT INTO architects (id, slug, name, position, source) VALUES (11, 'kurucu-kisi-profil', 'Kurucu Kişi', 'Kurucu', 'legacy_static')`).run();
  db.prepare(`INSERT INTO office_founders (office_id, architect_id) VALUES (1, 11)`).run();
  const { buildOfficePayload } = await import('../src/routes/office.js');
  const payload = await buildOfficePayload(env, 'yetki-mimarlik');
  const listed = [...payload.founders, ...payload.team].map(x => x.name);
  // Yapısal bağdan gelen kişi profilleri görünmeye DEVAM eder...
  assert.ok(listed.includes('Kurucu Kişi'), JSON.stringify(listed));
  assert.ok(listed.includes('Kurucu Bağı Kişi'), JSON.stringify(listed));
  // ...ama yalnızca ATAMASI olan hesaplar (Yönetici Kişi, Ekip Üyesi Kişi) görünmez.
  assert.ok(!listed.includes('Yönetici Kişi'), JSON.stringify(listed));
  assert.ok(!listed.includes('Ekip Üyesi Kişi'), JSON.stringify(listed));
  assert.equal(payload.claimed, true, 'atama hâlâ sahiplenme sayılır (kaynak ibaresi)');
});

await test('istemci: X ve + düğmeleri satırda, liste BOŞ olsa da satır çizilir', () => {
  const modal = read('js/components/auth-modal.js');
  assert.match(modal, /if \(Array\.isArray\(managers\)\) \{/, 'boş listede + görünmeli');
  assert.match(modal, /data-mgr-name=/, 'X düğmesi yok');
  assert.match(modal, /data-role="mgr-add"/, '+ düğmesi yok');
  assert.match(modal, /method: 'DELETE'/, 'X isteği yok');
  assert.match(modal, /künyesinden \(Kurucular, Ekip\) SİLİNMEZ/, 'onay metni kullanıcıya künyeye dokunulmadığını söylemeli');
});

console.log('\nmadde 9 — "Kaldır": yetkisi kaldırılan kullanıcı firmayı kutusundan çıkarır');

async function mine(env, uid) {
  const url = new URL('https://mimarlab.com/api/claims/mine');
  const res = await handleClaimsRoute(new Request(url, { headers: { cookie: `__Host-mimarlab_session=tok-${uid}` } }), env, url);
  return res.json();
}
async function dismiss(env, uid, key) {
  const url = new URL(`https://mimarlab.com/api/claims/office-link?key=${encodeURIComponent(key)}`);
  return handleClaimsRoute(new Request(url, { method: 'DELETE', headers: { cookie: `__Host-mimarlab_session=tok-${uid}` } }), env, url);
}

await test('yetkisi kaldırılan kullanıcı firmayı kutudan çıkarır: satır removed olur, listeden düşer', async () => {
  const { db, env } = await freshEnv();
  await del(env, 'u-kurucu', OFFICE, 'Yönetici Kişi');          // önce yetkisi kaldırılır
  const before = await mine(env, 'u-yonetici');
  assert.ok(before.items.some(i => i.profile_key === OFFICE), 'kaldırmadan önce kutuda görünmeli');
  assert.equal((await dismiss(env, 'u-yonetici', OFFICE)).status, 200);
  assert.equal(db.prepare(`SELECT status FROM profile_claims WHERE id = 'c-u-yonetici'`).get().status, 'removed');
  const after = await mine(env, 'u-yonetici');
  assert.ok(!after.items.some(i => i.profile_key === OFFICE), 'kaldırdıktan sonra kutuda görünmemeli');
});

await test('kurucu bağıyla görünen firma da kaldırılabilir; kurucu bağı ve yetki kapalı kalır', async () => {
  const { db, env } = await freshEnv();
  await del(env, 'u-kurucu', OFFICE, 'Kurucu Bağı Kişi');
  assert.ok((await mine(env, 'u-founder')).officeLinks.some(l => l.name === OFFICE));
  assert.equal((await dismiss(env, 'u-founder', OFFICE)).status, 200);
  assert.ok(!(await mine(env, 'u-founder')).officeLinks.some(l => l.name === OFFICE), 'kutudan düşmeli');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM office_founders WHERE architect_id = 10`).get().n, 1, 'künye bağı korunmalı');
  const { canEditOfficeViaFounderLink } = await import('../src/lib/claimedProfiles.js');
  const { OFFICE_EDIT_POSITIONS } = await import('../src/lib/projectClaimAccess.js');
  assert.equal(await canEditOfficeViaFounderLink(env, { id: 'u-founder' }, OFFICE, OFFICE_EDIT_POSITIONS), false, 'yetki geri gelmemeli');
});

await test('hâlâ YETKİLİ olan kullanıcı firmayı kutudan kaldıramaz (409)', async () => {
  const { env } = await freshEnv();
  const res = await dismiss(env, 'u-yonetici', OFFICE);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /hâlâ yetkilisin/i);
});

console.log('\nmadde 10 — "Görevin" künyeden okunur (Hesabım = kişi/firma pop-up\'ı)');

await test('myClaims: officeRole KÜNYEDEKİ görevi taşır, dondurulmuş claim görevini değil', async () => {
  const { db, env } = await freshEnv();
  // u-yonetici'nin kişi profili firmaya bağlı ve künyedeki görevi 'Ekip Lideri';
  // atamanın dondurulmuş görevi ise 'Yönetici'. Hesabım artık künyeyi göstermeli.
  db.prepare(`INSERT INTO architects (id, slug, name, position, source) VALUES (12, 'yonetici-kisi', 'Yönetici Kişi', 'Ekip Lideri', 'legacy_static')`).run();
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at) VALUES ('c-y-arch', 'u-yonetici', 'architect', 'Yönetici Kişi', 'approved', ?, ?)`).run(Date.now(), Date.now());
  db.prepare(`INSERT INTO office_founders (office_id, architect_id) VALUES (1, 12)`).run();
  const data = await mine(env, 'u-yonetici');
  const row = data.items.find(i => i.profile_key === OFFICE);
  assert.equal(row.officePosition, 'Yönetici', 'dondurulmuş yetki değeri korunur');
  assert.equal(row.officeRole, 'Ekip Lideri', 'Görevin satırı künyeden gelmeli');
});

await test('istemci: "Görevin" officeRole -> role -> hesap pozisyonu sırasıyla okunur (claim görevi DEĞİL)', () => {
  const modal = read('js/components/auth-modal.js');
  assert.match(modal, /const role = entry\.officeRole \|\| entry\.role \|\| \(accountUser && accountUser\.position\);/);
  assert.ok(!/const role = entry\.position \|\|/.test(modal), 'dondurulmuş claim görevi hâlâ okunuyor');
});

console.log('\nmadde 11 — firma yetkilisi firmanın gündem içeriğini düzenler');

await test('firma adına gönderilen gündem içeriğini firmanın DİĞER yetkilisi düzenler/siler, yabancı düzenleyemez', async () => {
  const { db, env } = await freshEnv();
  db.exec(readFileSync(new URL('../migrations/0113_gundem_user_submissions.sql', import.meta.url), 'utf8'));
  const now = Date.now();
  db.prepare(
    `INSERT INTO gundem_items (id, slug, title, summary, category, status, source_id, source_name, source_domain, source_url,
       image_url, image_host, content_hash, title_key, images, submitted_by, submitter_type, submitter_key, submitter_name, created_at, updated_at, published_at)
     VALUES ('g1', 'firma-haberi', 'Firma Haberi', 'özet', 'haber', 'published', 'user', ?, 'mimarlab.com', 'https://mimarlab.com/gundem',
       '/media/u/u-yonetici/a.webp', 'mimarlab.com', 'hash-g1', 'firma-haberi', ?, 'u-yonetici', 'office', 'yetki-mimarlik', ?, ?, ?, ?)`
  ).run(OFFICE, JSON.stringify(['/media/u/u-yonetici/a.webp']), OFFICE, now, now, now);
  const { handleGundemSubmitRoute } = await import('../src/routes/gundemSubmit.js');
  const call = (uid, method) => {
    const url = new URL('https://mimarlab.com/api/gundem-submissions/g1');
    return handleGundemSubmitRoute(new Request(url, { method, headers: { cookie: `__Host-mimarlab_session=tok-${uid}` } }), env, url);
  };
  // Gönderen u-yonetici; u-kurucu aynı firmanın BAŞKA bir yetkilisi.
  assert.equal((await call('u-kurucu', 'GET')).status, 200, 'firma yetkilisi içeriği açabilmeli');
  assert.equal((await call('u-yabanci', 'GET')).status, 404, 'yabancı görmemeli');
  assert.equal((await call('u-ekip', 'GET')).status, 404, 'Ekip Üyesi (yetkisiz) görmemeli');
  // Listede de görünür (aksi halde yetkiye ulaşılamaz).
  const listUrl = new URL('https://mimarlab.com/api/gundem-submissions/mine');
  const list = await (await handleGundemSubmitRoute(new Request(listUrl, { headers: { cookie: '__Host-mimarlab_session=tok-u-kurucu' } }), env, listUrl)).json();
  assert.ok((list.items || []).some(i => i.id === 'g1'), 'yönettiği firmanın içeriği listede olmalı');
  // Yetkisi X ile kaldırılırsa erişim de kapanır.
  await del(env, 'u-kurucu', OFFICE, 'Yönetici Kişi'); // (başka bir hesabı kaldırmak u-kurucu'yu etkilemez)
  assert.equal((await call('u-kurucu', 'DELETE')).status, 200, 'yetkili silebilmeli');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM gundem_items WHERE id = 'g1'`).get().n, 0);
});

console.log('\nmadde 12 — Arşivim kutusu İstatistikler\'in üstünde');

await test('Hesabım paneli sırası: Bildirimler/Mesajlar -> Arşivim -> İstatistikler', () => {
  const modal = read('js/components/auth-modal.js');
  const msgs = modal.indexOf('id="am-dash-messages"');
  const archive = modal.indexOf('id="am-archive-section"');
  const stats = modal.indexOf('id="am-stats-row"');
  assert.ok(msgs !== -1 && archive !== -1 && stats !== -1, 'bölümlerden biri yok');
  assert.ok(msgs < archive, 'Arşivim, Mesajlar satırının ALTINDA olmalı');
  assert.ok(archive < stats, 'Arşivim, İstatistikler\'in ÜSTÜNDE olmalı');
});

console.log('\nmadde 13 — "bilinçli dokunulmayanlar": kapalı kutunun verisi ertelenir');

await test('İstatistikler kutusu tembel: toplu yüklemede yok, ilk açılışta çekiliyor', () => {
  const modal = read('js/components/auth-modal.js');
  // Toplu tetikleme listesinde loadStats() ARTIK yok.
  const eager = modal.match(/\[loadBadges\(\)[^\]]*\]/);
  assert.ok(eager, 'toplu yükleme listesi bulunamadı');
  assert.ok(!/loadStats\(\)/.test(eager[0]), `loadStats hâlâ açılışta çağrılıyor: ${eager[0]}`);
  // Başlık tembel olarak işaretli ve kayıt defterinde karşılığı var.
  assert.match(modal, /data-collapse="am-stats-collapse am-stats-range" data-lazy="stats"/);
  assert.match(modal, /const lazySectionLoaders = \{ stats: \(\) => loadStats\(\) \};/);
  assert.match(modal, /if \(open && lazy && !lazySectionDone\.has\(lazy\) && lazySectionLoaders\[lazy\]\)/);
});

await test('kapalıyken veri GÖSTEREN kutular ertelenmedi (sayı/nokta/rozet kaybolmasın)', () => {
  const modal = read('js/components/auth-modal.js');
  const eager = modal.match(/\[loadBadges\(\)[^\]]*\]/)[0];
  for (const fn of ['loadBadges()', 'loadNotifications()', 'loadMessages()', 'loadArchive()']) {
    assert.ok(eager.includes(fn), `${fn} açılışta çağrılmalı — kapalı başlığında görünen verisi var`);
  }
});

console.log('\nmadde 14 — görsel türev merdiveni tek kaynak + deploy kapısı');

await test('worker tarafında merdivenin TEK kaynağı var, diğerleri import ediyor', () => {
  assert.match(read('src/lib/imageDerivative.js'), /export const DERIVATIVE_WIDTHS = \[400, 800, 1600\];/);
  for (const f of ['src/lib/derivativeIngest.js', 'src/lib/canonicalSync.js']) {
    const src = read(f);
    assert.ok(!/^(export )?const DERIVATIVE_WIDTHS(_[A-Z_]+)? = \[/m.test(src), `${f} hâlâ kendi kopyasını taşıyor`);
    assert.match(src, /import \{ DERIVATIVE_WIDTHS \} from '\.\/imageDerivative\.js';/, `${f} tek kaynaktan import etmeli`);
  }
  // derivativeIngest bunu yeniden export etmeli (src/routes/ai.js oradan alıyor).
  assert.match(read('src/lib/derivativeIngest.js'), /export \{ DERIVATIVE_WIDTHS \};/);
});

await test('kaçınılmaz üç kopya (iki tarayıcı dosyası + Python) aynı ve kapı bunu arıyor', () => {
  const ladder = /\[400, 800, 1600\]/;
  assert.match(read('image-cdn.js'), ladder);
  assert.match(read('image-upload.js'), ladder);
  assert.match(read('scripts/generate-image-derivatives.py'), /WIDTHS = \[400, 800, 1600\]/);
  const pf = read('scripts/preflight-check.sh');
  assert.match(pf, /5c\) Görsel türev merdiveni/);
  assert.match(pf, /türev merdiveni AYRIŞMIŞ/);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
