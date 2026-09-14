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
// username: 2026-09-14'ten itibaren kayıtta ZORUNLU (kullanıcı isteği madde 1) — her çağrı için
// benzersiz bir kullanıcı adı üretilir, aksi halde ad soyad kuralını değil kullanıcı adı tekilliğini
// test etmiş olurduk. dob ARTIK ZORUNLU DEĞİL (aynı istek: doğum yılı kutusu formdan kaldırıldı).
async function signup(name, email, username) {
  const req = new Request('https://mimarlab.com/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `203.0.113.${++ipSeq}` },
    body: JSON.stringify({ name, email, username: username || `kullanici${ipSeq}`, password: 'Sifre1234!', password_confirm: 'Sifre1234!', botCheck: true, kvkkAccepted: true }),
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

// KULLANICI ADI KURALLARI (kullanıcı isteği, 2026-09-14 madde 1/5/8) — aynı formun ikinci tekillik
// kapısı. Kural kaynağı src/lib/username.js; burada UÇTAN UCA (gerçek rota + D1) doğrulanır.
await test('Kullanıcı adı zorunlu ve biçimi doğrulanır', async () => {
  const noUser = await signup('Zeynep Demir', 'zd@example.com', ' ');
  assert.equal(noUser.status, 400);
  const bad = await signup('Zeynep Demir', 'zd2@example.com', 'ab');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /3-30/);
});

await test('Türkçe harfler ASCII\'ye katlanır ve @ ile yazılsa da temizlenir', async () => {
  const r = await signup('Kaan Çorbacı', 'kaan@example.com', '@Kaan.Çorbacı');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(db.prepare('SELECT username FROM users WHERE email = ?').get('kaan@example.com').username, 'kaan.corbaci');
});

await test('Aynı kullanıcı adı ikinci hesapta alınamaz (409)', async () => {
  const r = await signup('Başka Kişi', 'baska@example.com', 'kaan.corbaci');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /kullanıcı adı alınmış/);
});

await test('Giriş kullanıcı adıyla da yapılabilir (madde 8)', async () => {
  const req = (body) => new Request('https://mimarlab.com/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${++ipSeq}` },
    body: JSON.stringify(body),
  });
  const byUsername = await auth.handleAuthRoute(req({ identifier: 'kaan.corbaci', password: 'Sifre1234!' }), env, new URL('https://mimarlab.com/api/auth/login'));
  assert.equal(byUsername.status, 200, 'kullanıcı adıyla giriş başarısız');
  // Türkçe/büyük harfli yazım da aynı hesaba düşer (kayıttaki AYNI katlama).
  const folded = await auth.handleAuthRoute(req({ identifier: 'Kaan.Çorbacı', password: 'Sifre1234!' }), env, new URL('https://mimarlab.com/api/auth/login'));
  assert.equal(folded.status, 200, 'katlanmış kullanıcı adıyla giriş başarısız');
  const byEmail = await auth.handleAuthRoute(req({ email: 'kaan@example.com', password: 'Sifre1234!' }), env, new URL('https://mimarlab.com/api/auth/login'));
  assert.equal(byEmail.status, 200, 'e-posta ile giriş bozulmuş');
  const wrong = await auth.handleAuthRoute(req({ identifier: 'kaan.corbaci', password: 'yanlis-sifre' }), env, new URL('https://mimarlab.com/api/auth/login'));
  assert.equal(wrong.status, 401);
});

await test('Hesabım: kullanıcı adı değiştirilebilir, başkasının adı alınamaz', async () => {
  const id = userId('kaan@example.com');
  const ok = await auth.updateUserProfileFields(env, id, { username: 'KaanC' });
  assert.ok(!ok.error, ok.error);
  assert.equal(ok.user.username, 'kaanc');
  const clash = await auth.updateUserProfileFields(env, id, { username: 'kullanici1' });
  assert.equal(clash.status, 409);
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
