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

const { PHOTO_SPACE_OPTIONS, PHOTO_SPACE_LABELS, PHOTO_SPACE_DRAWING_LABELS } = photoSpaceTaxonomyJs;

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

section('madde 2 — /fotograf: sıra, mekan filtresi, künye, menü');

// image_spaces SAKLAMA BİÇİMİ v2 (2026-09-18 beşinci tur, bkz. src/lib/photoSpaceClassify.js):
// { v: 2, scene, spaces: [{label, confidence}] }. v1'in düz dizileri artık "AI bakmadı" sayılır —
// o davranışın kendi kelepçesi scripts/test-2026-09-18-photo-space-signals.mjs'te.
const v2 = (...labels) => ({ v: 2, scene: 'ic_mekan', spaces: labels.map(l => (typeof l === 'string' ? { label: l, confidence: null } : l)) });

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
        JSON.stringify({ 'projects/eski-1.jpg': v2('Mutfak'), 'projects/eski-2.jpg': v2('Banyo') }));
  db.prepare(
    `INSERT INTO projects (slug,title,location,images,image_spaces,claimed_by_user_id,created_at)
     VALUES ('yeni','Yeni Proje','Ankara',?,?,NULL,'2026-09-01 10:00:00')`
  ).run(JSON.stringify(['projects/yeni-1.jpg', 'projects/yeni-2.jpg']),
        JSON.stringify({ 'projects/yeni-1.jpg': v2('Yatak Odası'), 'projects/yeni-2.jpg': v2('Yatak Odası', 'Banyo') }));
  // Gizli (arşiv) proje — hiçbir koşulda görünmemeli.
  db.prepare(`INSERT INTO projects (slug,title,images,created_at,hidden_at) VALUES ('gizli','Gizli',?,'2026-09-05 10:00:00','2026-09-06')`)
    .run(JSON.stringify(['projects/gizli-1.jpg']));
  // BLURLU (önizleme) proje — madde 10: blur kalkana kadar bu sayfada GÖRÜNMEZ.
  db.prepare(`INSERT INTO projects (slug,title,images,created_at,hidden_at,preview_at) VALUES ('blurlu','Blurlu',?,'2026-09-07 10:00:00','2026-09-08','2026-09-08')`)
    .run(JSON.stringify(['projects/blurlu-1.jpg']));
  // Künye bağı + fotoğrafçı: eski projede firma, yeni projede yalnızca mimar; görsel başına fotoğrafçı.
  db.prepare(`INSERT INTO offices (id,name,slug,created_at) VALUES (1,'A Mimarlık','a-mimarlik',?)`).run(NOW);
  db.prepare(`INSERT INTO architects (id,name,slug,created_at) VALUES (7,'Ayşe Mimar','ayse-mimar',?)`).run(NOW);
  const eskiId = db.prepare(`SELECT id FROM projects WHERE slug='eski'`).get().id;
  const yeniId = db.prepare(`SELECT id FROM projects WHERE slug='yeni'`).get().id;
  db.prepare(`INSERT INTO project_designers (project_id,office_id) VALUES (?,1)`).run(eskiId);
  db.prepare(`INSERT INTO project_designers (project_id,architect_id) VALUES (?,7)`).run(yeniId);
  db.prepare(`UPDATE projects SET photo_credit_text='Cemal Emden', image_credits=?, discipline='["Mimari"]', category='["Konut"]', project_date='2019', awards='["Ulusal Mimarlık Ödülü"]' WHERE slug='eski'`).run(JSON.stringify({ 'projects/eski-2.jpg': 'Stüdyo X' }));
  // KÜNYE eşleşmesi (2026-09-18): açıklamasında "banyo" geçen, görselleri AI'ın HENÜZ BAKMADIĞI bir
  // proje + AI'ın bakıp "mekan yok" dediği ([]) bir görsel. Yükleme sırası: en eski.
  // hamam-1: AI bakmadı (null); hamam-2: AI baktı, mekan yok ([]); hamam-3: ÇİZİM (havuza girmez);
  // hamam-4: yeni {label,confidence} biçimi — birincil 'Tuvalet & Banyo', ikincil düşük güvenli 'Mutfak'.
  db.prepare(`INSERT INTO projects (slug,title,description,images,image_spaces,created_at) VALUES ('hamam','Hamam Evi','Yenilenen banyo ve hamam hacimleri', ?, ?, '2025-06-01 10:00:00')`)
    .run(JSON.stringify(['projects/hamam-1.jpg', 'projects/hamam-2.jpg', 'projects/hamam-3.jpg', 'projects/hamam-4.jpg']),
         JSON.stringify({ 'projects/hamam-2.jpg': v2(), 'projects/hamam-3.jpg': { v: 2, scene: 'cizim', spaces: [{ label: 'Plan Çizimi', confidence: 0.95 }] },
                          'projects/hamam-4.jpg': v2({ label: 'Tuvalet & Banyo', confidence: 0.9 }, { label: 'Mutfak', confidence: 0.5 }) }));
  // Kurucu düşüşü: 'hamam' projesinin mimarı yok, firması 'B Mimarlık'; firmanın kurucusu 'Kurucu Kişi'.
  db.prepare(`INSERT INTO offices (id,name,slug,created_at) VALUES (2,'B Mimarlık','b-mimarlik',?)`).run(NOW);
  db.prepare(`INSERT INTO architects (id,name,slug,created_at) VALUES (8,'Kurucu Kişi','kurucu-kisi',?)`).run(NOW);
  db.prepare(`INSERT INTO office_founders (office_id,architect_id) VALUES (2,8)`).run();
  const hamamId = db.prepare(`SELECT id FROM projects WHERE slug='hamam'`).get().id;
  db.prepare(`INSERT INTO project_designers (project_id,office_id) VALUES (?,2)`).run(hamamId);
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
    'projects/yeni-1.jpg', 'projects/yeni-2.jpg', 'projects/eski-1.jpg', 'projects/eski-2.jpg', 'projects/hamam-1.jpg', 'projects/hamam-2.jpg', 'projects/hamam-4.jpg',
  ], 'çizim (hamam-3) havuzda HİÇ yok');
  assert.equal(data.total, 7);
});

await test('gizli/arşiv VE blurlu (önizleme) proje görselleri havuzda YOK (madde 10)', async () => {
  const { env } = await photoFixture();
  const data = await photos(env);
  assert.ok(!data.items.some(i => i.url.includes('gizli')));
  assert.ok(!data.items.some(i => i.url.includes('blurlu')), 'blur kalkana kadar gösterilmez');
  assert.equal(data.total, 7);
});

await test('mekan filtresi: yalnızca o etiketi taşıyan görseller, sıra KORUNUR', async () => {
  const { env } = await photoFixture();
  const data = await photos(env, `?space=${encodeURIComponent('Yatak Odası')}`);
  assert.deepEqual(data.items.map(i => i.url), ['projects/yeni-1.jpg', 'projects/yeni-2.jpg']);
  assert.equal(data.total, 2);
});

await test('listede OLMAYAN bir mekan değeri filtreyi SESSİZCE yok sayar (boş sayfa göstermez)', async () => {
  const { env } = await photoFixture();
  assert.equal((await photos(env, '?space=Uydurma')).total, 7);
  // Çizim etiketi aranabilir DEĞİL: filtre değeri olarak gelirse de yok sayılır (tüm havuz).
  assert.equal((await photos(env, `?space=${encodeURIComponent('Plan Çizimi')}`)).total, 7);
});

await test('sayfalama: limit/offset + hasMore', async () => {
  const { env } = await photoFixture();
  const p1 = await photos(env, '?limit=2&offset=0');
  assert.deepEqual(p1.items.map(i => i.url), ['projects/yeni-1.jpg', 'projects/yeni-2.jpg']);
  assert.equal(p1.hasMore, true);
  const p2 = await photos(env, '?limit=2&offset=2');
  assert.deepEqual(p2.items.map(i => i.url), ['projects/eski-1.jpg', 'projects/eski-2.jpg']);
  assert.equal(p2.hasMore, true);
  assert.equal((await photos(env, '?limit=3&offset=4')).hasMore, false);
});

await test('künye: firma (yoksa mimar) + fotoğrafçı; "paylaşan" YOK (madde 4/5/6)', async () => {
  const { env } = await photoFixture();
  const data = await photos(env);
  const eski1 = data.items.find(i => i.url === 'projects/eski-1.jpg');
  assert.equal(eski1.projectTitle, 'Eski Proje');
  assert.equal(eski1.projectSlug, 'eski');
  assert.equal(eski1.projectLocation, 'İzmir');
  assert.deepEqual(eski1.spaces, ['Mutfak']);
  assert.equal(eski1.credit, 'A Mimarlık', 'firma varsa firma');
  assert.equal(eski1.creditType, 'office');
  assert.equal(eski1.photographer, 'Cemal Emden', 'görsel başına etiket yoksa projenin künyesi');
  const eski2 = data.items.find(i => i.url === 'projects/eski-2.jpg');
  assert.equal(eski2.photographer, 'Stüdyo X', 'görsel başına fotoğrafçı (image_credits) öncelikli');
  const yeni = data.items.find(i => i.url === 'projects/yeni-1.jpg');
  assert.equal(yeni.credit, 'Ayşe Mimar', 'firma yoksa mimar');
  assert.equal(yeni.creditType, 'architect');
  assert.equal(yeni.photographer, null);
  assert.equal(eski1.ownerName, undefined, '"Projeyi paylaşan" alanı KALDIRILDI');
  assert.equal(eski1.ownerPhoto, undefined);
  // 2026-09-18 madde 3: lightbox künyesi proje pop-up'ındaki alanları taşır.
  assert.deepEqual(eski1.offices, ['A Mimarlık']); assert.deepEqual(eski1.architects, []);
  assert.deepEqual(eski1.discipline, ['Mimari']); assert.deepEqual(eski1.category, ['Konut']);
  assert.equal(eski1.projectDate, '2019'); assert.deepEqual(eski1.awards, ['Ulusal Mimarlık Ödülü']);
});

await test('ARAMA KALİTESİ (2026-09-18 üçüncü tur): künye ikincil sonucu YOK, çizim yok, iki kademe', async () => {
  const { env } = await photoFixture();
  // Künyesinde "banyo" geçen ama AI'ın bakmadığı hamam-1 ARTIK sonuca girmez (alakasız sonuç kaynağıydı).
  const data = await photos(env, `?space=${encodeURIComponent('Tuvalet & Banyo')}`);
  assert.deepEqual(data.items.map(i => i.url), ['projects/hamam-4.jpg']);
  assert.ok(!data.items.some(i => i.via), 'via alanı kalktı');
  // hamam-4'te 'Mutfak' ikincil ve düşük güvenli (0.5 < SECONDARY_MIN) → Mutfak aramasında ÇIKMAZ;
  // eski-1'in düz-string 'Mutfak' etiketi (güven bilinmiyor, birincil) çıkar.
  const mutfak = await photos(env, '?space=Mutfak');
  assert.deepEqual(mutfak.items.map(i => i.url), ['projects/eski-1.jpg']);
  // Kademe kuralı doğrudan (2026-09-18 beşinci turda ÖLÇÜMLE yeniden kuruldu — tam tablo
  // scripts/test-2026-09-18-photo-space-signals.mjs'te): birincil LLM etiketi CLIP desteğiyle önce;
  // ikincil etiket YALNIZCA CLIP de destekliyorsa; her kademede yükleme sırası.
  const { selectPhotos, spaceTier, SECONDARY_MIN } = await import('../src/routes/photos.js');
  const clip = (l, p) => ({ t: l, s: [[l, p]] });
  const pool = { projects: {}, items: [
    { url: 'a', projectSlug: 'p', spaces: [{ label: 'Havuz', confidence: 0.6, primary: true }, { label: 'Bahçe', confidence: 0.6, primary: false }], clip: clip('Bahçe', 0.5) },
    { url: 'b', projectSlug: 'p', spaces: [{ label: 'Bahçe', confidence: 0.9, primary: true }], clip: clip('Bahçe', 0.9) },
    { url: 'c', projectSlug: 'p', spaces: [{ label: 'Havuz', confidence: 0.9, primary: true }, { label: 'Bahçe', confidence: 0.8, primary: false }] },
    { url: 'd', projectSlug: 'p', spaces: [{ label: 'Havuz', confidence: 0.9, primary: true }, { label: 'Bahçe', confidence: 0.3, primary: false }], clip: clip('Bahçe', 0.5) },
    { url: 'e', projectSlug: 'p', spaces: null },
  ] };
  assert.deepEqual(selectPhotos(pool, 'Bahçe').map(x => x.url), ['b', 'a'], 'b çifte onay, a ikincil+CLIP; c CLIP desteksiz ikincil (yok), d düşük güven, e yok');
  assert.equal(spaceTier(pool.items[3], 'Bahçe'), 0);
  assert.ok(SECONDARY_MIN > 0.5);
  // Kurucu düşüşü: mimarı olmayan projede firmanın kurucusu "Mimar" satırında.
  const hamam = (await photos(env)).items.find(i => i.url === 'projects/hamam-4.jpg');
  assert.deepEqual(hamam.offices, ['B Mimarlık']); assert.deepEqual(hamam.architects, ['Kurucu Kişi']);
  // Havuz eski/yeni biçimi normalize eder; çizim etiketi tanınır.
  const { normalizeStoredSpaces } = await import('../src/lib/photoPool.js');
  assert.deepEqual(normalizeStoredSpaces(v2('Mutfak', 'Uydurma')), [{ label: 'Mutfak', confidence: null, primary: true }]);
  assert.deepEqual(normalizeStoredSpaces({ v: 2, scene: 'cizim', spaces: [{ label: 'Kesit Çizimi', confidence: 0.8 }] }), [{ label: 'Kesit Çizimi', confidence: 0.8, primary: true }]);
  assert.equal(normalizeStoredSpaces(undefined), null);
});

await test('künye bağlamı: fonksiyon duruyor ama ÜRETİMDE KAPALI (2026-09-18 beşinci tur ölçümü)', async () => {
  const { buildContextNote } = await import('../src/lib/photoSpaceClassify.js');
  const note = buildContextNote({ title: 'Hamam Evi', category: ['Konut'], description: 'Yenilenen banyo' });
  assert.match(note, /Proje adı: Hamam Evi/); assert.match(note, /Konut/); assert.match(note, /banyo/);
  assert.match(note, /yalnızca ipucu/);
  assert.equal(buildContextNote(null), '');
  const script = read('../scripts/photo-space-classify-backfill.mjs');
  assert.match(script, /classifyPhotoSpace\(env, img\.bytes, VISION_TIMEOUT_MS, img\.mime, contextOf\(state\.row\), CANDIDATES\)/);
  assert.match(script, /const contextOf = \(row\) => \(!WITH_CONTEXT \? null : \{/, 'bağlam yalnızca --with-context ile (deney)');
  assert.match(read('../.github/workflows/photo-space-classify.yml'), /if \[ "\$\{IN_CONTEXT\}" = "evet" \]; then argv\+=\("--with-context"\); fi/);
});

await test('uç mekan listesini de döndürür (istemci ikinci bir liste taşımaz)', async () => {
  const { env } = await photoFixture();
  assert.deepEqual((await photos(env)).spaces, PHOTO_SPACE_OPTIONS);
});

await test('taksonomi: 15 etiket VERİLEN SIRAYLA; çizimler AI listesinde var, ARAMADA YOK', () => {
  assert.deepEqual(PHOTO_SPACE_LABELS, [
    'Oturma Odası', 'Mutfak', 'Yatak Odası', 'Tuvalet & Banyo', 'Çalışma Odası', 'Koridor', 'Merdiven',
    'Balkon', 'Bahçe', 'Havuz', 'Resepsiyon', 'Depo', 'Plan Çizimi', 'Kesit Çizimi', 'Cephe Çizimi',
  ]);
  assert.deepEqual(PHOTO_SPACE_DRAWING_LABELS, ['Plan Çizimi', 'Kesit Çizimi', 'Cephe Çizimi']);
  assert.deepEqual(PHOTO_SPACE_OPTIONS, PHOTO_SPACE_LABELS.slice(0, 12), 'dropdown/filtre çizimsiz');
});

await test('AI sınıflandırması whitelist DIŞINA çıkamaz (uydurma etiket süzülür)', async () => {
  const { classifyPhotoSpace } = await import('../src/lib/photoSpaceClassify.js');
  // Sahte env.AI: modelin biri listede OLMAYAN bir etiket döndürüyor.
  const env = { AI: { async run() { return { response: '{"spaces":[{"label":"Yatak Odası","confidence":0.9},{"label":"Sinema Salonu","confidence":0.9}]}' }; } } };
  const out = await classifyPhotoSpace(env, new Uint8Array([1, 2, 3]), 5000, 'image/jpeg');
  assert.deepEqual(out.spaces, [{ label: 'Yatak Odası', confidence: 0.9 }], 'listede olmayan "Sinema Salonu" düşmeli');
  // Çizim etiketi AI whitelist'inde VAR (sonuçtan dışlamanın tek yolu onu tanımak).
  const dEnv = { AI: { async run() { return { response: '{"spaces":[{"label":"Plan Çizimi","confidence":0.9}]}' }; } } };
  assert.deepEqual((await classifyPhotoSpace(dEnv, new Uint8Array([1]), 5000, 'image/jpeg')).spaces, [{ label: 'Plan Çizimi', confidence: 0.9 }]);
});

await test('AI: düşük güvenli etiket ELENİR, eski düz-string çıktı biçimi hâlâ kabul (madde 11)', async () => {
  const { classifyPhotoSpace, SPACE_CONFIDENCE_MIN } = await import('../src/lib/photoSpaceClassify.js');
  const low = { AI: { async run() { return { response: '{"spaces":[{"label":"Mutfak","confidence":0.9},{"label":"Koridor","confidence":0.2}]}' }; } } };
  assert.deepEqual((await classifyPhotoSpace(low, new Uint8Array([1]), 5000, 'image/jpeg')).spaces, [{ label: 'Mutfak', confidence: 0.9 }]);
  assert.ok(SPACE_CONFIDENCE_MIN > 0.2 && SPACE_CONFIDENCE_MIN < 0.9);
  const legacy = { AI: { async run() { return { response: '{"spaces":["Havuz"]}' }; } } };
  assert.deepEqual((await classifyPhotoSpace(legacy, new Uint8Array([1]), 5000, 'image/jpeg')).spaces, [{ label: 'Havuz', confidence: null }]);
});

await test('AI arama eşlemesi (serbest metin -> etiket) whitelist\'ten geçer', async () => {
  const { normalizeQuerySpace, SPACE_QUERY_SCHEMA } = await import('../src/lib/photoSpaceClassify.js');
  assert.equal(normalizeQuerySpace({ space: 'Tuvalet & Banyo' }), 'Tuvalet & Banyo');
  assert.equal(normalizeQuerySpace({ space: 'Sinema' }), null);
  assert.equal(normalizeQuerySpace({ space: 'Plan Çizimi' }), null, 'çizim aranabilir etiket değil');
  assert.ok(!SPACE_QUERY_SCHEMA.schema.properties.space.enum.includes('Plan Çizimi'));
  assert.equal(normalizeQuerySpace({ space: null }), null);
  assert.ok(SPACE_QUERY_SCHEMA.schema.properties.space.enum.includes(null));
  const s = read('../src/routes/photos.js');
  assert.match(s, /\/api\/photos\/space-for-query/);
  assert.match(s, /checkRateLimit\(env, 'photo-space-query'/, 'herkese açık LLM ucu hız sınırsız olamaz');
  assert.match(read('../src/index.js'), /path === '\/api\/photos\/space-for-query'/);
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
  assert.match(s, /\{ loc: '\/fotograf', changefreq: 'daily', priority: '0\.8' \}/);
  assert.match(s, /path === '\/api\/photos'/);
});

await test('ANA MENÜ + FOOTER: FOTOĞRAF, PROJE\'den hemen sonra (ikinci tur madde 12)', () => {
  const s = read('../js/components/site-chrome.js');
  const block = s.slice(s.indexOf('const NAV_ITEMS = ['), s.indexOf('const LOGO_LIGHT'));
  const order = [...block.matchAll(/key: '([a-z0-9]+)'/g)].map(m => m[1]);
  assert.equal(order[0], 'proje'); assert.equal(order[1], 'fotograf');
  const col = s.slice(s.indexOf('<h4>Ana Menü</h4>'), s.indexOf('<h4>Topluluk</h4>'));
  const links = [...col.matchAll(/href="\/([a-z0-9-]+)"/g)].map(m => m[1]);
  assert.equal(links[0], 'proje'); assert.equal(links[1], 'fotograf');
  assert.match(read('../fotograf.html'), /data-nav-active="fotograf"/, 'sayfa kendi menü öğesini aktif işaretler');
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
  assert.match(s, /id="ph-lightbox-meta"/);
  assert.match(s, /id="ph-lightbox-spaces"/);
  assert.ok(!/Projeyi paylaşan/.test(s), '"Projeyi paylaşan" hiçbir yerde yok (madde 5)');
  assert.match(s, /id="ph-lightbox-save"/);
  // madde 7: Kaydet · Paylaş · X aynı satırda, başlık o satırdan SONRA.
  const bar = s.indexOf('id="ph-lightbox-bar"'); const title = s.indexOf('id="ph-lightbox-title"');
  assert.ok(bar > -1 && title > bar, 'başlık, düğme satırından sonra');
  assert.match(s, /id="ph-lightbox-share-slot"/);
  assert.match(s, /<script src="js\/components\/share-button\.js" defer><\/script>/);
  // madde 6: fotoğrafçı görselin hemen altında, "© Ad" biçiminde.
  assert.match(s, /id="ph-lightbox-credit"/);
  assert.match(s, /`© \$\{item\.photographer\}`/);
  // madde 8: sağ panel beyaz (temaya bağlanmaz).
  assert.match(s, /\.ph-lightbox-info\{[^}]*background:#fff/);
  // madde 9: görselin dışına tıklamak kapatır.
  assert.match(s, /e\.target === lbMedia\) closeLightbox\(\)/);
  // madde 3: arama kutusunda odak çerçevesi yok.
  assert.match(s, /\.ph-search-field input:focus-visible[^{]*\{box-shadow:none/);
  // madde 2: hero metni.
  assert.match(s, /Projeler arasından sana ilham verecek mekanları ara ve bul\./);
  // 2026-09-18: arama çubuğu yapışkan ve dropdown içeriğin ÜSTÜNDE; künye satırları; otomatik yükleme.
  assert.match(s, /\.ph-search-sticky\{[^}]*position:sticky/);
  assert.ok(!/\.ph-hero\{[^}]*overflow:hidden/.test(s), 'hero overflow:hidden dropdown\'ı kırpıyordu');
  assert.match(s, /id="ph-lightbox-meta"/); assert.match(s, /rows\.push\(\['Mimarlık Firması'/); assert.match(s, /rows\.push\(\['Ödül'/);
  assert.ok(!/rows\.push\(\['Fotoğraf'/.test(s), 'fotoğrafçı künye satırı değil (görselin altında)');
  // 2026-09-18 üçüncü tur: OTOMATİK yükleme YOK, yalnızca "Daha Fazla Göster" düğmesi.
  assert.ok(!/IntersectionObserver/.test(s.replace(/\/\/[^\n]*/g, '')), 'otomatik yükleme kalktı');
  assert.ok(!/id="ph-loadmore-sentinel"/.test(s));
  assert.match(s, /loadMoreBtn\.addEventListener\('click', \(\) => loadPage\(false\)\)/);
  assert.ok(!/künyesindeki bilgiye göre listelendi/.test(s), 'via metni silindi');
  assert.match(s, /rows\.push\(\['Mimar', list\(item\.architects\)\]\)/, 'künyede Mimar satırı');
  assert.match(s, /t\.kind !== 'drawing'/, 'dropdown çizimleri sunmaz');
  assert.match(s, /PHOTO_SPACE_TAXONOMY/, 'yerel eşleşme anahtar kelimeleri de kullanır');
  // madde 1: footer CSS bloğu sayfada var (site-chrome yalnızca markup'ı üretir).
  assert.match(s, /\.footer-top\{/); assert.match(s, /\.footer-col a\{/);
  // madde 4: kart altı etiketi firma/mimar.
  assert.match(s, /class="ph-card-credit"/);
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
