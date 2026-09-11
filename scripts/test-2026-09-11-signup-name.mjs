#!/usr/bin/env node
// 2026-09-11 — ÜYE OL AD SOYAD KURALI (kullanıcı isteği): "Kullanıcılar sitede kayıtlı kişi
// isimleriyle aynı isimde kullanıcı hesabı oluşturabilsinler. Lakin aynı isimde yeniden bir kişi
// paylaşımı yapamasınlar. ... daha önce üye olan kullanıcı adıyla aynı isim yazılamaz."
//
// AYRIM: hesap adı (users.name) yalnızca DİĞER HESAPLARLA çakışamaz; Kişi profili (architects) adı
// hesap açmayı ENGELLEMEZ. Aynı adla yeni bir Kişi paylaşımı ise canonicalSync#isDuplicateCanonicalName
// kapısında reddedilmeye DEVAM eder. node:sqlite üzerinde gerçek şema, round11 ile aynı D1 shim'i.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 4).join('\n       ')}`); }
}

function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
db.exec(`INSERT INTO architects (slug, name, source) VALUES ('ayse-yilmaz', 'Ayşe Yılmaz', 'legacy_static'), ('mehmet-kaya', 'Mehmet Kaya', 'legacy_static');`);
const env = { DB: d1(db) };

const auth = await import('../src/routes/auth.js');
const { isDuplicateCanonicalName } = await import('../src/lib/canonicalSync.js');

let ipSeq = 0;
async function signup(name, email) {
  const req = new Request('https://mimarlab.com/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `203.0.113.${++ipSeq}` },
    body: JSON.stringify({ name, email, password: 'Sifre1234!', password_confirm: 'Sifre1234!', dob: '1990', botCheck: true, kvkkAccepted: true }),
  });
  const res = await auth.handleAuthRoute(req, env, new URL(req.url));
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const userId = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id;

await test('Kişi sayfasındaki bir adla üye olunabilir (Ayşe Yılmaz kişi profili var)', async () => {
  const r = await signup('Ayşe Yılmaz', 'ayse1@example.com');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(userId('ayse1@example.com'));
});

await test('Daha önce üye olan kullanıcının adıyla ikinci hesap açılamaz (409)', async () => {
  const r = await signup('Ayşe Yılmaz', 'ayse2@example.com');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /daha önce üye olunmuş/);
  assert.equal(userId('ayse2@example.com'), undefined);
});

await test('Çakışma Türkçe büyük/küçük harf, fazla boşluk ve NFD biçiminden bağımsız', async () => {
  for (const variant of ['AYŞE  YILMAZ', ' ayşe yılmaz ', 'Ayşe Yılmaz'.normalize('NFD')]) {
    const r = await signup(variant, `v${ipSeq}@example.com`);
    assert.equal(r.status, 409, `"${variant}" kabul edildi`);
  }
});

await test('Farklı bir ad (ikinci ad) kabul edilir', async () => {
  const r = await signup('Ayşe Nur Yılmaz', 'aysenur@example.com');
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

await test('Hesabım: başka bir hesabın adına geçilemez (status 409), Kişi adına geçilebilir, kendi adı serbest', async () => {
  const id = userId('aysenur@example.com');
  const clash = await auth.updateUserProfileFields(env, id, { name: 'ayşe yılmaz' });
  assert.equal(clash.status, 409);
  assert.match(clash.error, /daha önce üye olunmuş/);
  const own = await auth.updateUserProfileFields(env, id, { name: 'Ayşe Nur Yılmaz' });
  assert.ok(!own.error, own.error);
  const kisi = await auth.updateUserProfileFields(env, id, { name: 'Mehmet Kaya' });
  assert.ok(!kisi.error, kisi.error);
});

await test('Aynı adla YENİ kişi paylaşımı hâlâ reddedilir (isDuplicateCanonicalName)', async () => {
  assert.equal(await isDuplicateCanonicalName(env, 'architects', 'Ayşe Yılmaz'), true);
  assert.equal(await isDuplicateCanonicalName(env, 'architects', 'AYŞE YILMAZ'), true);
  assert.equal(await isDuplicateCanonicalName(env, 'architects', 'Zeynep Demir'), false);
});

await test('PATCH /api/profile ve admin kullanıcı düzenleme 409 durumunu iletir', async () => {
  const authSrc = readFileSync(new URL('../src/routes/auth.js', import.meta.url), 'utf8');
  const adminSrc = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  assert.match(authSrc, /errorJson\(result\.error, result\.status \|\| 400\)/);
  assert.match(adminSrc, /errorJson\(result\.error, result\.status \|\| 400\)/);
  assert.doesNotMatch(authSrc, /findArchitectByFoldedName\(/, 'signup hâlâ Kişi adını engelliyor');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
