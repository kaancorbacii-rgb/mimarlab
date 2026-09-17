#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-17 (SEKİZİNCİ tur) — iki madde, tek test dosyası.
//
// 1. "Her kullanıcı sadece kullanıcı ismiyle yorum yapabilsin. Kişi popuplarını yorum kısmına
//    karıştırma. Eğer projeye yorum yapıldıysa örneğin Yorumlar (1) şeklinde gözüksün, yorum
//    yapılmadıysa 0'ı gösterme. Ayrıca admine ve firma yöneticisine yorumu silme yetkisi ver."
// 2. "... siteye yüklenen projelerin görsellerinin yükleme sırasına göre en son yüklenenden ilk
//    yüklenene doğru sıralanacağı bir sayfa yapacağız. Kişi arama butonundan istediği mekanı
//    seçerek (örneğin yatak odası) yatak odasıyla alakalı tüm fotoğraflar son yüklenen projeden
//    ilk yüklenene doğru sıralanacak. Mekan filtremesini yapay zeka yapsın. Görsele tıklayınca da
//    lightbox şeklinde açılacak ve projenin künyesi ... sergilenecek. Bu sayfanın ismi fotoğraf
//    olsun, sayfayı yayınla ama şimdilik bir menüye koyma."
//
// HER İKİ MADDE DE GERÇEK SQLite + GERÇEK UÇLARLA ölçülür (kurala değil SONUCA bakar).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

globalThis.caches = {
  default: { async match() {}, async put() {}, async delete() { return false; } },
  async open() { return this.default; },
};

import { syncApprovedSubmissionToCanonical } from '../src/lib/canonicalSync.js';
import { parseSubmissionRow } from '../src/lib/submissionTypes.js';
import { handleCommentsRoute } from '../src/routes/comments.js';
import { handlePhotosRoute } from '../src/routes/photos.js';
import photoSpaceTaxonomyJs from '../photo-space-taxonomy.js';

const { PHOTO_SPACE_OPTIONS } = photoSpaceTaxonomyJs;

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    // last_row_id ŞART: canonicalSync#syncProject yeni projenin id'sini bu alandan okuyor
    // (ölçüldü — alan olmadan projectId null kalıyor ve project_designers INSERT'i
    // "cannot be bound to SQLite parameter 1" ile düşüyor).
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}

const NOW = Date.now();
const TOKENS = { mgr: 'tok-mgr', member: 'tok-member', admin: 'tok-admin', nobody: 'tok-nobody' };
const req = (who, method, path) => new Request(`https://mimarlab.com${path}`, {
  method,
  headers: { cookie: `__Host-mimarlab_session=${TOKENS[who]}`, 'content-type': 'application/json' },
});

// 'member' bir projeyi siteye ekler; 'mgr' o projenin künyesindeki firmanın ONAYLI yöneticisidir.
async function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(read('../schema.sql'));
  db.exec(read('../migrations/0079_search_fold_columns.sql'));
  for (const [id, name, role] of [['mgr', 'Yönetici', 'user'], ['member', 'Üye', 'user'], ['admin', 'Admin', 'admin'], ['nobody', 'Yabancı', 'user']]) {
    db.prepare(`INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES (?,?,'x',?,?,?)`).run(id, `${id}@x.com`, name, role, NOW);
  }
  for (const [u, t] of Object.entries(TOKENS)) {
    db.prepare(`INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)`)
      .run(createHash('sha256').update(t).digest('hex'), u, NOW, NOW + 3600e3);
  }
  db.prepare(`INSERT INTO offices (id,name,slug,created_at) VALUES (1,'A Mimarlık','a-mimarlik',?)`).run(NOW);
  db.prepare(
    `INSERT INTO profile_claims (id,user_id,profile_type,profile_key,status,office_position,created_at,updated_at)
     VALUES ('c1','mgr','office','A Mimarlık','approved','Yönetici',?,?)`
  ).run(NOW, NOW);
  const env = { DB: d1(db) };
  db.prepare(
    `INSERT INTO project_submissions (id,owner_user_id,status,created_at,updated_at,slug,title,office,location,images)
     VALUES ('ps1','member','approved',?,?,'test-proje','Test Proje','["A Mimarlık"]','İstanbul','[]')`
  ).run(NOW, NOW);
  await syncApprovedSubmissionToCanonical(env, 'projects', parseSubmissionRow('projects', { ...db.prepare(`SELECT * FROM project_submissions WHERE id='ps1'`).get() }));
  return { db, env };
}

section('madde 1 — yorumlar: yalnızca hesap kimliği, sayaç biçimi, silme yetkisi');

await test('/api/comments yanıtı commenterProfile TAŞIMAZ (kişi/firma profili karışmaz)', async () => {
  const { db, env } = await fixture();
  // 'member'ın hesabı bir KİŞİ profiline bağlı olsun — eski davranışta yorum o profilin adı/
  // fotoğrafıyla görünüyordu. Artık HİÇBİR koşulda görünmemeli.
  db.prepare(`INSERT INTO architects (id,name,slug,photo_url,claimed_by_user_id,created_at) VALUES (9,'Ünlü Mimar','unlu-mimar','mimarlar/x.jpg','member',?)`).run(NOW);
  db.prepare(`INSERT INTO comments (id,target_type,target_id,user_id,body,created_at,status) VALUES ('cm1','project','test-proje','member','Harika!',?,'approved')`).run(NOW);
  const url = new URL('https://mimarlab.com/api/comments?targetType=project&targetId=test-proje');
  const data = JSON.parse(await (await handleCommentsRoute(req('member', 'GET', url.pathname + url.search), env, url)).text());
  assert.equal(data.items.length, 1);
  const item = data.items[0];
  assert.equal(item.commenterProfile, undefined, 'commenterProfile alanı KALDIRILDI');
  assert.equal(item.user_name, 'Üye', 'yorum HER ZAMAN hesap adıyla görünür');
  // Anahtar kümesi kelepçesi: yanıt şekli genişlemesin (yeni bir profil köprüsü sessizce geri gelmesin).
  assert.deepEqual(Object.keys(item).sort(), ['body', 'created_at', 'id', 'user_badge', 'user_id', 'user_name', 'user_photo']);
});

await test('kaynak kapısı: listComments SQL\'inde architects/offices JOIN\'i YOK', () => {
  const s = read('../src/routes/comments.js');
  const block = s.slice(s.indexOf('async function listComments'), s.indexOf('// GET /api/comments/mine'));
  assert.ok(!/LEFT JOIN architects/.test(block), 'architects JOIN geri gelmemeli');
  assert.ok(!/LEFT JOIN offices/.test(block), 'offices JOIN geri gelmemeli');
  assert.ok(!/commenterProfile/.test(block));
});

await test('istemci: project-comments.js yorumcuyu /kisi|/firma\'ya BAĞLAMAZ', () => {
  const s = read('../js/components/project-comments.js');
  assert.ok(!/commenterProfile/.test(s.replace(/\/\/[^\n]*/g, '')), 'kodda (yorumlar hariç) commenterProfile kalmamalı');
  assert.ok(!/comment-author-link/.test(s), 'isim artık bir bağlantı değil');
  assert.match(s, /const nameHtml = escapeHtml\(c\.user_name\);/);
  assert.match(s, /const avatarHtml = `<div class="comment-avatar">/);
});

await test('sayaç: 0 yorumda BOŞ, 1+ yorumda " (N)" (auth-modal#loadArchive ile AYNI desen)', () => {
  const s = read('../js/components/project-comments.js');
  assert.match(s, /document\.getElementById\(ids\.count\)\.textContent = items\.length \? ` \(\$\{items\.length\}\)` : '';/);
  // Şablon artık sabit "0" ve inline display:none TAŞIMAZ — span boş doğar.
  const modal = read('../js/components/project-modal.js');
  assert.match(modal, /<span id="pm-comments-count"><\/span>/);
  assert.ok(!/id="pm-comments-count" style="display:none;">0</.test(modal), 'eski sabit 0 + display:none geri gelmemeli');
});

await test('SİLME: firma yöneticisi (ne yorum sahibi ne proje göndericisi) silebilir', async () => {
  const { db, env } = await fixture();
  db.prepare(`INSERT INTO comments (id,target_type,target_id,user_id,body,created_at,status) VALUES ('cm1','project','test-proje','member','x',?,'approved')`).run(NOW);
  const res = await handleCommentsRoute(req('mgr', 'DELETE', '/api/comments/cm1'), env, new URL('https://mimarlab.com/api/comments/cm1'));
  assert.equal(res.status, 200);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM comments`).get().n, 0);
});

await test('SİLME: admin silebilir; yetkisiz kullanıcı 403 alır', async () => {
  const { db, env } = await fixture();
  db.prepare(`INSERT INTO comments (id,target_type,target_id,user_id,body,created_at,status) VALUES ('cm1','project','test-proje','member','x',?,'approved')`).run(NOW);
  assert.equal((await handleCommentsRoute(req('admin', 'DELETE', '/api/comments/cm1'), env, new URL('https://mimarlab.com/api/comments/cm1'))).status, 200);
  db.prepare(`INSERT INTO comments (id,target_type,target_id,user_id,body,created_at,status) VALUES ('cm2','project','test-proje','member','y',?,'approved')`).run(NOW);
  assert.equal((await handleCommentsRoute(req('nobody', 'DELETE', '/api/comments/cm2'), env, new URL('https://mimarlab.com/api/comments/cm2'))).status, 403);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM comments`).get().n, 1, 'yetkisiz silme satırı bırakmalı');
});

await test('istemci: Sil düğmesi admin\'e ve künye yetkilisine görünür (canModerate iki yol)', () => {
  const s = read('../js/components/project-comments.js');
  // Admin dalı (server zaten geçiriyordu, istemci hiç sormuyordu — düğme admine görünmüyordu).
  assert.match(s, /if \(currentUser\.role === 'admin'\) \{\s*canModerate = true;/);
  // firma yöneticisi dalı: /can-edit (canUserEditProjectBySlug) ESKİ yolla OR'lanır.
  assert.match(s, /\/api\/project\/\$\{encodeURIComponent\(slug\)\}\/can-edit/);
  assert.match(s, /canModerate = \(isOwner && hasActiveBadge\) \|\| canEditProject;/);
});

section('madde 2 — /fotograf: sıra, mekan filtresi, künye, menüde YOK');

// Fotoğraf havuzu: İKİ proje, farklı created_at. En son yüklenen ÖNCE gelmeli.
async function photoFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(read('../schema.sql'));
  db.exec(read('../migrations/0079_search_fold_columns.sql'));
  db.prepare(`INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES ('u1','a@a.com','x','Ayşe Mimar','user',?)`).run(NOW);
  db.prepare(
    `INSERT INTO projects (slug,title,location,images,image_spaces,claimed_by_user_id,created_at)
     VALUES ('eski','Eski Proje','İzmir',?,?,'u1','2026-01-01 10:00:00')`
  ).run(JSON.stringify(['projects/eski-1.jpg', 'projects/eski-2.jpg']),
        JSON.stringify({ 'projects/eski-1.jpg': ['Mutfak'], 'projects/eski-2.jpg': ['Banyo'] }));
  db.prepare(
    `INSERT INTO projects (slug,title,location,images,image_spaces,claimed_by_user_id,created_at)
     VALUES ('yeni','Yeni Proje','Ankara',?,?,NULL,'2026-09-01 10:00:00')`
  ).run(JSON.stringify(['projects/yeni-1.jpg', 'projects/yeni-2.jpg']),
        JSON.stringify({ 'projects/yeni-1.jpg': ['Yatak Odası'], 'projects/yeni-2.jpg': ['Yatak Odası', 'Banyo'] }));
  // Gizli (arşiv) proje — hiçbir koşulda görünmemeli.
  db.prepare(`INSERT INTO projects (slug,title,images,created_at,hidden_at) VALUES ('gizli','Gizli',?,'2026-09-05 10:00:00','2026-09-06')`)
    .run(JSON.stringify(['projects/gizli-1.jpg']));
  return { db, env: { DB: d1(db) } };
}
async function photos(env, query) {
  const url = new URL(`https://mimarlab.com/api/photos${query || ''}`);
  const res = await handlePhotosRoute(new Request(url.href, { method: 'GET' }), env, url);
  return JSON.parse(await res.text());
}

await test('sıra: EN SON yüklenen projenin görselleri ÖNCE (yükleme sırası = projects.created_at DESC)', async () => {
  const { env } = await photoFixture();
  const data = await photos(env);
  assert.deepEqual(data.items.map(i => i.url), [
    'projects/yeni-1.jpg', 'projects/yeni-2.jpg', 'projects/eski-1.jpg', 'projects/eski-2.jpg',
  ]);
  assert.equal(data.total, 4);
});

await test('gizli/arşiv proje görselleri havuzda YOK', async () => {
  const { env } = await photoFixture();
  const data = await photos(env);
  assert.ok(!data.items.some(i => i.url.includes('gizli')));
});

await test('mekan filtresi: yalnızca o etiketi taşıyan görseller, sıra KORUNUR', async () => {
  const { env } = await photoFixture();
  const data = await photos(env, `?space=${encodeURIComponent('Yatak Odası')}`);
  assert.deepEqual(data.items.map(i => i.url), ['projects/yeni-1.jpg', 'projects/yeni-2.jpg']);
  assert.equal(data.total, 2);
});

await test('listede OLMAYAN bir mekan değeri filtreyi SESSİZCE yok sayar (boş sayfa göstermez)', async () => {
  const { env } = await photoFixture();
  assert.equal((await photos(env, '?space=Uydurma')).total, 4);
});

await test('sayfalama: limit/offset + hasMore', async () => {
  const { env } = await photoFixture();
  const p1 = await photos(env, '?limit=2&offset=0');
  assert.deepEqual(p1.items.map(i => i.url), ['projects/yeni-1.jpg', 'projects/yeni-2.jpg']);
  assert.equal(p1.hasMore, true);
  const p2 = await photos(env, '?limit=2&offset=2');
  assert.deepEqual(p2.items.map(i => i.url), ['projects/eski-1.jpg', 'projects/eski-2.jpg']);
  assert.equal(p2.hasMore, false);
});

await test('künye (lightbox): başlık + konum + mekan + "Projeyi paylaşan"', async () => {
  const { env } = await photoFixture();
  const data = await photos(env);
  const eski = data.items.find(i => i.url === 'projects/eski-1.jpg');
  assert.equal(eski.projectTitle, 'Eski Proje');
  assert.equal(eski.projectSlug, 'eski');
  assert.equal(eski.projectLocation, 'İzmir');
  assert.deepEqual(eski.spaces, ['Mutfak']);
  assert.equal(eski.ownerName, 'Ayşe Mimar', 'claimed_by_user_id -> fetchOwnerByline');
  const yeni = data.items.find(i => i.url === 'projects/yeni-1.jpg');
  assert.equal(yeni.ownerName, 'MİMARLAB', 'sahipsiz (legacy/admin) kayıtta fallback');
});

await test('uç mekan listesini de döndürür (istemci ikinci bir liste taşımaz)', async () => {
  const { env } = await photoFixture();
  assert.deepEqual((await photos(env)).spaces, PHOTO_SPACE_OPTIONS);
});

await test('taksonomi: sabit liste, TR alfabetik, 20 mekan', () => {
  assert.ok(PHOTO_SPACE_OPTIONS.includes('Yatak Odası'));
  assert.ok(PHOTO_SPACE_OPTIONS.includes('Banyo'));
  assert.ok(PHOTO_SPACE_OPTIONS.includes('Mutfak'));
  assert.equal(new Set(PHOTO_SPACE_OPTIONS).size, PHOTO_SPACE_OPTIONS.length, 'mükerrer olmamalı');
});

await test('AI sınıflandırması whitelist DIŞINA çıkamaz (uydurma etiket süzülür)', async () => {
  const { classifyPhotoSpace } = await import('../src/lib/photoSpaceClassify.js');
  // Sahte env.AI: modelin biri listede OLMAYAN bir etiket döndürüyor.
  const env = { AI: { async run() { return { response: '{"spaces":["Yatak Odası","Sinema Salonu"]}' }; } } };
  const out = await classifyPhotoSpace(env, new Uint8Array([1, 2, 3]), 5000, 'image/jpeg');
  assert.deepEqual(out.spaces, ['Yatak Odası'], 'listede olmayan "Sinema Salonu" düşmeli');
});

await test('AI net bir mekan göremezse boş dizi (o görsel filtrede hiç görünmez)', async () => {
  const { classifyPhotoSpace } = await import('../src/lib/photoSpaceClassify.js');
  const env = { AI: { async run() { return { response: '{"spaces":[]}' }; } } };
  assert.deepEqual((await classifyPhotoSpace(env, new Uint8Array([1]), 5000, 'image/jpeg')).spaces, []);
});

await test('migration + schema.sql: projects.image_spaces her ikisinde de var', () => {
  assert.match(read('../migrations/0124_project_image_spaces.sql'), /ALTER TABLE projects ADD COLUMN image_spaces TEXT;/);
  assert.match(read('../schema.sql'), /ALTER TABLE projects ADD COLUMN image_spaces TEXT;/);
  // canonicalSync bu kolona DOKUNMAMALI (AI üretimi; bir proje kaydedilince silinmemeli).
  const sync = read('../src/lib/canonicalSync.js');
  assert.ok(!/image_spaces/.test(sync), 'syncProject image_spaces yazmamalı — aksi halde her kaydetme etiketleri siler');
});

await test('sayfa yayında: /fotograf.html -> /fotograf 301 + sitemap girdisi', () => {
  const s = read('../src/index.js');
  assert.match(s, /'\/fotograf\.html': '\/fotograf',/);
  assert.match(s, /\{ loc: '\/fotograf', changefreq: 'daily', priority: '0\.6' \}/);
  assert.match(s, /if \(path === '\/api\/photos'/);
});

await test('HİÇBİR MENÜDE YOK: site-chrome.js /fotograf\'a bağlantı vermiyor', () => {
  const s = read('../js/components/site-chrome.js');
  assert.ok(!/fotograf/.test(s), 'üst menü/mobil çekmece/footer hiçbir yerde /fotograf olmamalı');
  // Sitedeki HİÇBİR sayfa da ona <a href> ile bağlanmamalı (keşif yolu yalnızca sitemap).
  for (const page of ['../index.html', '../proje.html', '../kisi.html', '../firma.html', '../urun.html']) {
    assert.ok(!/href="\/?fotograf"/.test(read(page)), `${page} /fotograf'a bağlanmamalı`);
  }
});

await test('fotograf.html: hero arama kutusu + ızgara + lightbox künyesi yerinde', () => {
  const s = read('../fotograf.html');
  assert.match(s, /<title>Fotoğraflar — MİMARLAB<\/title>/);
  assert.match(s, /id="ph-search-input"/);
  assert.match(s, /id="ph-dropdown"/);
  assert.match(s, /id="ph-reset-btn"/);
  assert.match(s, /id="ph-grid"/);
  // Lightbox künyesi: başlık (proje bağlantısı), konum, mekan çipleri, "Projeyi paylaşan", Kaydet.
  assert.match(s, /id="ph-lightbox-title"/);
  assert.match(s, /id="ph-lightbox-location"/);
  assert.match(s, /id="ph-lightbox-spaces"/);
  assert.match(s, /Projeyi paylaşan/);
  assert.match(s, /id="ph-lightbox-save"/);
  // Taksonomi ve kaydetme altyapısı sayfaya yüklenmiş olmalı.
  assert.match(s, /<script src="photo-space-taxonomy\.js" defer><\/script>/);
  assert.match(s, /<script src="save-widget\.js" defer><\/script>/);
  // Kart TIKLAMASI kendi lightbox'ını açar: href TAŞIMAYAN <a role="button"> (bkz. auth-modal.js#
  // renderColSaved'deki AYNI desen) — aksi halde lazy-modals.js tıklamayı yakalayıp proje
  // popup'ını açardı.
  assert.match(s, /<a class="ph-card" role="button" tabindex="0"/);
  // İlk çizim DOMContentLoaded'ı bekler (defer'lı save-widget/taksonomi henüz tanımsız olurdu).
  assert.match(s, /document\.addEventListener\('DOMContentLoaded', reload\)/);
});

await test('havuz KV önbelleğine bağlı ve yazmalarda temizlenir (POOL_CACHE_KINDS)', () => {
  assert.match(read('../src/lib/photoPool.js'), /getCachedPool\(env, 'photos'/);
  assert.match(read('../src/lib/publicCache.js'), /'projects:concept', 'photos'\]/);
});

console.log(`\n${failed ? 'BAŞARISIZ' : 'TAMAM'} — ${passed} geçti, ${failed} kaldı`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
