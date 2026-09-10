#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-10 (sekizinci tur) — BİRİM TESTLERİ
//   madde 2: "Renzo Piano Building Workshop firmasının yöneticisi Galataport projesinden ... firma
//            ismini sildi. Böyle bir durumda 1 gün sonra bu projeden düzenleme yetkisinin bu
//            kullanıcıdan kalkması gerekiyor."
//   madde 3/6: öneri şeritleri ve ana sayfa karuselleri önizleme ("blurlu") kayıtları göstermesin
//            (noPreview=1).
//   madde 4: admin > Üyeler > profil atama aramasının Türkçe karakterlerle çalışması.
//   madde 5: bir firmaya birden fazla kullanıcı yönetici olabilsin (sunucu tarafı çoklu sahiplik).
//
// scripts/test-2026-09-10-round2.mjs ile AYNI desen: test koşucusu yok, node:assert + node:sqlite
// üzerinde GERÇEK bir SQLite ve schema.sql; canlı route/lib fonksiyonları import edilir.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { canUserEditProjectBySlug } from '../src/lib/projectClaimAccess.js';
import { recordProjectEditGrace, clearProjectEditGrace, projectEditGraceState, PROJECT_EDIT_GRACE_MS } from '../src/lib/projectEditGrace.js';
import { handleAdminRoute } from '../src/routes/admin.js';
import { handleProjectListRoute } from '../src/routes/project.js';
import { handleSubmissionRoute } from '../src/routes/submissions.js';
import { syncApprovedSubmissionToCanonical } from '../src/lib/canonicalSync.js';
import { parseSubmissionRow } from '../src/lib/submissionTypes.js';
import { sha256Hex } from '../src/lib/crypto.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  return db;
}
// KV/cache bağımlılıkları — cachedPublicJson KV yoksa doğrudan üreticiyi çağırır; burada yine de
// tam bir no-op KV verilir ki hiçbir uç ortam eksikliğinden farklı bir yola sapmasın.
function envFor(db) {
  return {
    DB: d1(db),
    CACHE: { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [] }; } },
  };
}

// offices: 1 Renzo Piano Building Workshop, architects: 1 Bir Mimar
// projects: 1 Galataport (künyesinde RPBW var)
function seed(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO offices (slug, name, loc, cats, source) VALUES
      ('renzo-piano-building-workshop', 'Renzo Piano Building Workshop', 'İtalya', '["Mimarlık"]', 'legacy_static'),
      ('sisecam', 'Şişecam', 'İstanbul', '["Cam"]', 'legacy_static');
    INSERT INTO projects (slug, title, location, build_status, images, source, created_at)
      VALUES ('galataport', 'Galataport', 'İstanbul / Beyoğlu', 'built', '["a.webp"]', 'legacy_static', datetime('now'));
    INSERT INTO project_designers (project_id, architect_id, office_id) VALUES (1, NULL, 1);
  `);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-mgr', 'mgr@example.com', 'x', 'Yönetici', 'user', ?)`).run(now);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-mgr2', 'mgr2@example.com', 'x', 'İkinci Yönetici', 'user', ?)`).run(now);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-admin', 'a@example.com', 'x', 'Admin', 'admin', ?)`).run(now);
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position) VALUES ('c1', 'u-mgr', 'office', 'Renzo Piano Building Workshop', 'approved', ?, ?, 'Yönetici')`).run(now, now);
}
async function withSessions(db, ids) {
  const now = Date.now();
  for (const uid of ids) {
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .run(await sha256Hex(`tok-${uid}`), uid, now, now + 3600_000);
  }
}
const req = (uid, path, init = {}) => new Request(`https://mimarlab.com${path}`, {
  ...init,
  headers: { 'Content-Type': 'application/json', ...(uid ? { Cookie: `__Host-mimarlab_session=tok-${uid}` } : {}), ...(init.headers || {}) },
});
const user = (id, role = 'user') => ({ id, role });

// ---------------------------------------------------------------------------------------------
section("madde 2 — künyeden çıkarılan firmanın yetkisi 1 GÜN sonra kalkar");

await test('künyedeyken düzenleyebilir (temel durum)', async () => {
  const db = freshDb(); seed(db);
  assert.equal(await canUserEditProjectBySlug(envFor(db), user('u-mgr'), 'galataport'), true);
});

await test('künyeden çıkarılınca yetki HEMEN bitmez — 24 saatlik pencere açılır', async () => {
  const db = freshDb(); seed(db);
  const env = envFor(db);
  // Künye yeniden yazılıyor: RPBW çıkarıldı, yerine kimse gelmedi.
  db.exec(`DELETE FROM project_designers WHERE project_id = 1`);
  await recordProjectEditGrace(env, 1, { architects: [], offices: ['Renzo Piano Building Workshop'] }, { architects: [], offices: [] });

  assert.equal(await projectEditGraceState(env, 1, 'u-mgr'), 'grace');
  assert.equal(await canUserEditProjectBySlug(env, user('u-mgr'), 'galataport'), true, 'pencere açıkken hâlâ düzenleyebilmeli');
  const row = db.prepare(`SELECT revoke_at, created_at, removed_key FROM project_edit_grace WHERE project_id = 1 AND user_id = 'u-mgr'`).get();
  assert.equal(row.revoke_at - row.created_at, PROJECT_EDIT_GRACE_MS, 'pencere tam 24 saat olmalı');
  assert.equal(row.removed_key, 'Renzo Piano Building Workshop');
});

await test('24 saat dolunca yetki KALKAR', async () => {
  const db = freshDb(); seed(db);
  const env = envFor(db);
  db.exec(`DELETE FROM project_designers WHERE project_id = 1`);
  await recordProjectEditGrace(env, 1, { architects: [], offices: ['Renzo Piano Building Workshop'] }, { architects: [], offices: [] });
  // Zamanı ileri sarmak yerine damgayı geçmişe çekmek AYNI şeydir (karşılaştırma revoke_at > now).
  db.prepare(`UPDATE project_edit_grace SET revoke_at = ? WHERE project_id = 1`).run(Date.now() - 1000);

  assert.equal(await projectEditGraceState(env, 1, 'u-mgr'), 'revoked');
  assert.equal(await canUserEditProjectBySlug(env, user('u-mgr'), 'galataport'), false);
});

await test('taslak SAHİBİ bile olsa, pencere dolunca gönderiyi açamaz (owner_user_id dalı kapanır)', async () => {
  const db = freshDb(); seed(db);
  await withSessions(db, ['u-mgr']);
  const env = envFor(db);
  const now = Date.now();
  // Kullanıcı projeyi bir kez düzenlemiş: kendi adına bir project_submissions taslağı var.
  db.prepare(`INSERT INTO project_submissions (id, owner_user_id, status, created_at, updated_at, title, slug, claimed_slug, build_status)
              VALUES ('ps-1', 'u-mgr', 'approved', ?, ?, 'Galataport', 'galataport', 'galataport', 'built')`).run(now, now);

  // Önce: künyeden çıkarıldı ama pencere AÇIK → taslağı hâlâ açabilir.
  db.exec(`DELETE FROM project_designers WHERE project_id = 1`);
  await recordProjectEditGrace(env, 1, { architects: [], offices: ['Renzo Piano Building Workshop'] }, { architects: [], offices: [] });
  let res = await handleSubmissionRoute(req('u-mgr', '/api/projects/ps-1'), env, new URL('https://mimarlab.com/api/projects/ps-1'));
  assert.equal(res.status, 200, 'pencere açıkken taslak okunabilmeli');

  // Sonra: pencere doldu → owner_user_id eşleşse bile 404.
  db.prepare(`UPDATE project_edit_grace SET revoke_at = ? WHERE project_id = 1`).run(Date.now() - 1000);
  res = await handleSubmissionRoute(req('u-mgr', '/api/projects/ps-1'), env, new URL('https://mimarlab.com/api/projects/ps-1'));
  assert.equal(res.status, 404, 'pencere dolunca sahiplik dalı da kapanmalı');
});

await test('KENDİ projesini yükleyen normal üye etkilenmez (damgası hiç yazılmaz)', async () => {
  const db = freshDb(); seed(db);
  await withSessions(db, ['u-mgr2']);
  const env = envFor(db);
  const now = Date.now();
  db.prepare(`INSERT INTO project_submissions (id, owner_user_id, status, created_at, updated_at, title, slug, claimed_slug, build_status)
              VALUES ('ps-2', 'u-mgr2', 'approved', ?, ?, 'Galataport', 'galataport', 'galataport', 'built')`).run(now, now);
  db.exec(`DELETE FROM project_designers WHERE project_id = 1`);
  await recordProjectEditGrace(env, 1, { architects: [], offices: ['Renzo Piano Building Workshop'] }, { architects: [], offices: [] });

  assert.equal(await projectEditGraceState(env, 1, 'u-mgr2'), null, 'künyeyle bağı olmayan üyeye damga yazılmamalı');
  const res = await handleSubmissionRoute(req('u-mgr2', '/api/projects/ps-2'), env, new URL('https://mimarlab.com/api/projects/ps-2'));
  assert.equal(res.status, 200, 'kendi gönderisini süresiz düzenleyebilmeli');
});

await test('isim künyeye GERİ eklenirse damga silinir (yanlışlıkla silme geri alınır)', async () => {
  const db = freshDb(); seed(db);
  const env = envFor(db);
  db.exec(`DELETE FROM project_designers WHERE project_id = 1`);
  await recordProjectEditGrace(env, 1, { architects: [], offices: ['Renzo Piano Building Workshop'] }, { architects: [], offices: [] });
  assert.equal(await projectEditGraceState(env, 1, 'u-mgr'), 'grace');

  db.exec(`INSERT INTO project_designers (project_id, architect_id, office_id) VALUES (1, NULL, 1)`);
  await clearProjectEditGrace(env, 1, { architects: [], offices: ['Renzo Piano Building Workshop'] });
  assert.equal(await projectEditGraceState(env, 1, 'u-mgr'), null);
  assert.equal(await canUserEditProjectBySlug(env, user('u-mgr'), 'galataport'), true);
});

await test('künyede BAŞKA bir sahiplenilmiş ad kalıyorsa damga hiç yazılmaz', async () => {
  const db = freshDb(); seed(db);
  const env = envFor(db);
  const now = Date.now();
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position) VALUES ('c2', 'u-mgr', 'office', 'Şişecam', 'approved', ?, ?, 'Yönetici')`).run(now, now);
  // RPBW çıkarıldı ama Şişecam künyede kaldı — kullanıcı bir şey kaybetmedi.
  await recordProjectEditGrace(env, 1, { architects: [], offices: ['Renzo Piano Building Workshop'] }, { architects: [], offices: ['Şişecam'] });
  assert.equal(await projectEditGraceState(env, 1, 'u-mgr'), null);
});

await test('admin her zaman düzenleyebilir (damga admin\'i bağlamaz)', async () => {
  const db = freshDb(); seed(db);
  const env = envFor(db);
  db.exec(`DELETE FROM project_designers WHERE project_id = 1`);
  await recordProjectEditGrace(env, 1, { architects: [], offices: ['Renzo Piano Building Workshop'] }, { architects: [], offices: [] });
  db.prepare(`UPDATE project_edit_grace SET revoke_at = ? WHERE project_id = 1`).run(Date.now() - 1000);
  assert.equal(await canUserEditProjectBySlug(env, user('u-admin', 'admin'), 'galataport'), true);
});

await test('GERÇEK AKIŞ: künyeyi syncProject üzerinden değiştirmek damgayı kendiliğinden yazar', async () => {
  const db = freshDb(); seed(db);
  const env = envFor(db);
  const now = Date.now();
  // Projeyi canonical'a bağlayan taslak (proje-ekle.html?claim=galataport akışının ürettiği satır).
  db.prepare(`INSERT INTO project_submissions (id, owner_user_id, status, created_at, updated_at, title, slug, claimed_slug, build_status, office, designer)
              VALUES ('ps-sync', 'u-mgr', 'approved', ?, ?, 'Galataport', 'galataport', 'galataport', 'built', '[]', '[]')`).run(now, now);

  // Yönetici kaydediyor: Firma kutusundan RPBW SİLİNDİ (office = []).
  const row = parseSubmissionRow('projects', db.prepare(`SELECT * FROM project_submissions WHERE id = 'ps-sync'`).get());
  await syncApprovedSubmissionToCanonical(env, 'projects', { ...row, office: [], designer: ['Bir Mimar'] });

  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM project_designers WHERE project_id = 1 AND office_id = 1`).get().n, 0, 'künye bağı gerçekten silinmeli');
  assert.equal(await projectEditGraceState(env, 1, 'u-mgr'), 'grace', 'silme ANINDA damga yazılmalı');
  assert.equal(await canUserEditProjectBySlug(env, user('u-mgr'), 'galataport'), true, '24 saat dolmadan yetki sürmeli');

  // Aynı kullanıcı ismi geri koyuyor → damga silinir.
  await syncApprovedSubmissionToCanonical(env, 'projects', { ...row, office: ['Renzo Piano Building Workshop'], designer: [] });
  assert.equal(await projectEditGraceState(env, 1, 'u-mgr'), null, 'geri ekleyince damga kalkmalı');
});

// ---------------------------------------------------------------------------------------------
section('madde 3/6 — noPreview=1 önizleme kayıtlarını listeden eler');

async function projectList(db, query) {
  const url = new URL(`https://mimarlab.com/api/projects${query}`);
  const res = await handleProjectListRoute(req(null, `/api/projects${query}`), envFor(db), url);
  return JSON.parse(await res.text());
}

await test('noPreview=1 önizleme projelerini elemeli, parametresiz istek onları GÖSTERMEYE devam etmeli', async () => {
  const db = freshDb(); seed(db);
  db.exec(`
    INSERT INTO projects (slug, title, location, build_status, images, source, created_at, hidden_at, preview_at)
      VALUES ('soluk-proje', 'Soluk Proje', 'İstanbul', 'built', '["b.webp"]', 'legacy_static', datetime('now'), datetime('now'), datetime('now'));
  `);
  const withPreview = await projectList(db, '?limit=24');
  const withoutPreview = await projectList(db, '?limit=24&noPreview=1');
  assert.ok(withPreview.items.some(p => p.slug === 'soluk-proje'), 'liste sayfası önizlemeyi göstermeye devam etmeli');
  assert.equal(withoutPreview.items.some(p => p.slug === 'soluk-proje'), false, 'öneri şeridi/karusel önizlemeyi görmemeli');
  assert.ok(withoutPreview.items.some(p => p.slug === 'galataport'), 'yayındaki proje elenmemeli');
  assert.equal(withoutPreview.total, withPreview.total - 1, 'toplam da elenmiş kümeyi yansıtmalı');
});

await test('bir FİLTRE aktifken de (havuz yolu) eleme çalışır', async () => {
  const db = freshDb(); seed(db);
  db.exec(`
    INSERT INTO projects (slug, title, location, build_status, images, source, created_at, hidden_at, preview_at)
      VALUES ('soluk-istanbul', 'Soluk İstanbul', 'İstanbul / Beyoğlu', 'built', '["b.webp"]', 'legacy_static', datetime('now'), datetime('now'), datetime('now'));
  `);
  const filtered = await projectList(db, '?limit=96&location=' + encodeURIComponent('İstanbul') + '&noPreview=1');
  assert.equal(filtered.items.some(p => p.slug === 'soluk-istanbul'), false);
});

await test('yayına alınan bir kayıt şeritlere KENDİLİĞİNDEN geri girer', async () => {
  const db = freshDb(); seed(db);
  db.exec(`
    INSERT INTO projects (slug, title, location, build_status, images, source, created_at, hidden_at, preview_at)
      VALUES ('yayina-alinan', 'Yayına Alınan', 'İzmir', 'built', '["c.webp"]', 'legacy_static', datetime('now'), datetime('now'), datetime('now'));
  `);
  assert.equal((await projectList(db, '?limit=24&noPreview=1')).items.some(p => p.slug === 'yayina-alinan'), false);
  db.exec(`UPDATE projects SET hidden_at = NULL, preview_at = NULL WHERE slug = 'yayina-alinan'`);
  assert.ok((await projectList(db, '?limit=24&noPreview=1')).items.some(p => p.slug === 'yayina-alinan'));
});

// ---------------------------------------------------------------------------------------------
section('madde 4 — admin profil arama Türkçe karakterlerle çalışır');

async function profileOptions(db, type, q) {
  const path = `/api/admin/profile-options?type=${type}&q=${encodeURIComponent(q)}`;
  const res = await handleAdminRoute(req('u-admin', path), envFor(db), new URL(`https://mimarlab.com${path}`));
  return JSON.parse(await res.text());
}

await test('Türkçe harf/aksan/büyük-küçük farkı gözetmeden bulur', async () => {
  const db = freshDb(); seed(db);
  await withSessions(db, ['u-admin']);
  for (const q of ['Şişecam', 'şişecam', 'ŞİŞECAM', 'sisecam', 'SISECAM']) {
    const data = await profileOptions(db, 'office', q);
    assert.ok(data.items.includes('Şişecam'), `"${q}" ile bulunamadı`);
  }
});

await test('kelime ORTASINDAN da bulur (substring geri düşüşü)', async () => {
  const db = freshDb(); seed(db);
  await withSessions(db, ['u-admin']);
  const data = await profileOptions(db, 'office', 'piano building');
  assert.ok(data.items.includes('Renzo Piano Building Workshop'));
});

await test('slug ile de bulur', async () => {
  const db = freshDb(); seed(db);
  await withSessions(db, ['u-admin']);
  const data = await profileOptions(db, 'office', 'renzo-piano-building-workshop');
  assert.ok(data.items.includes('Renzo Piano Building Workshop'));
});

await test('options[] ad + slug + firma/marka ayrımını taşır', async () => {
  const db = freshDb(); seed(db);
  await withSessions(db, ['u-admin']);
  const data = await profileOptions(db, 'office', 'Renzo');
  const hit = data.options.find(o => o.name === 'Renzo Piano Building Workshop');
  assert.equal(hit.slug, 'renzo-piano-building-workshop');
  assert.equal(hit.kind, 'firma');
});

// ---------------------------------------------------------------------------------------------
section('madde 5 — bir firmaya birden fazla yönetici');

await test('ikinci kullanıcı da aynı firmaya onaylı olarak atanabilir ve projeyi düzenleyebilir', async () => {
  const db = freshDb(); seed(db);
  await withSessions(db, ['u-admin']);
  const env = envFor(db);
  const path = '/api/admin/claims';
  const res = await handleAdminRoute(
    req('u-admin', path, { method: 'POST', body: JSON.stringify({ userId: 'u-mgr2', profileType: 'office', profileKey: 'Renzo Piano Building Workshop', officePosition: 'Yönetici' }) }),
    env, new URL(`https://mimarlab.com${path}`)
  );
  assert.equal(res.status, 200, await res.text());

  const rows = db.prepare(`SELECT user_id FROM profile_claims WHERE profile_type='office' AND profile_key='Renzo Piano Building Workshop' AND status='approved' ORDER BY user_id`).all();
  assert.deepEqual(rows.map(r => r.user_id), ['u-mgr', 'u-mgr2'], 'iki yönetici yan yana durabilmeli');
  assert.equal(await canUserEditProjectBySlug(env, user('u-mgr'), 'galataport'), true);
  assert.equal(await canUserEditProjectBySlug(env, user('u-mgr2'), 'galataport'), true);
});

// ---------------------------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nBaşarısız testler:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
}
process.exit(failed ? 1 : 0);
