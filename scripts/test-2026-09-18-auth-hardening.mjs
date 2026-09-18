#!/usr/bin/env node
// AUTH SIKILAŞTIRMA — denetim 2026-09-18'in üç bulgusu + MEVCUT KULLANICI regresyonu.
//
// 1) OPEN REDIRECT: `next` doğrulaması "/\evil.com"u geçiriyordu (tarayıcı "\"yi "/" sayar).
//    Server (src/routes/auth.js#safeNextPath) ve istemci (js/components/auth-modal.js#mlSafeNextPath)
//    kopyaları AYNI vektör listesiyle koşturulur; her çıktı mimarlab.com'a karşı çözüldüğünde
//    origin DEĞİŞMEMELİ.
// 2) FORGOT-PASSWORD TIMING: kayıtlı e-postada token INSERT + Resend çağrısı yanıttan önce await
//    ediliyordu (canlı: ~200 ms vs ~560-790 ms). Yanıttan önce koşan SQL iki durumda BİREBİR aynı
//    olmalı; token/e-posta ctx.waitUntil'de.
// 3) OAUTH STATE BAĞLAMASI: state başka tarayıcıda da geçerliydi (login CSRF). Artık HttpOnly
//    __Host- bağlama çerezinin hash'i state'te; eşleşmezse kod değişimine hiç geçilmez.
// 4) REGRESYON: bugünkü formatta saklanmış bir parola hash'iyle giriş, mevcut oturumlar, users
//    satırlarına hiç UPDATE yapılmaması.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err && err.stack || err).split('\n').slice(0, 5).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

globalThis.HTMLRewriter = class { on() { return this; } transform(res) { return res; } };
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };

const worker = (await import('../src/index.js')).default;
const { safeNextPath, handleAuthRoute } = await import('../src/routes/auth.js');
const { signState, verifyState } = await import('../src/lib/oauth.js');
const { verifyPassword } = await import('../src/lib/crypto.js');

// ---- İstemci kopyası: auth-modal.js'ten GERÇEK kaynak çıkarılır ------------------------------
const modalSrc = read('js/components/auth-modal.js');
const clientFnSrc = modalSrc.split('// ML_SAFE_NEXT_PATH_BEGIN')[1].split('// ML_SAFE_NEXT_PATH_END')[0];
const mlSafeNextPath = new Function(`${clientFnSrc}; return mlSafeNextPath;`)();

// ---- D1 shim (node:sqlite) + SQL günlüğü ------------------------------------------------------
function d1(db, log) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { log.push(sql); const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { log.push(sql); return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { log.push(sql); const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(s) { return Promise.all(s.map(x => x.run())); } };
}
const quiet = { log: console.log, error: console.error, warn: console.warn };
function mute() { console.log = () => {}; console.error = () => {}; console.warn = () => {}; }
function unmute() { Object.assign(console, quiet); }

// Bugünkü (değişmeyen) formatta üretilmiş sabit hash: PBKDF2-SHA256, 100k, "saltHex:hashHex".
// Mevcut D1 satırlarındaki hash'lerin temsilcisidir — bu değer çalışmıyorsa mevcut kullanıcılar
// da giriş YAPAMAZ.
const LEGACY_PASSWORD = 'EskiSifre!2024';
const LEGACY_HASH = '23b5d7a7b0350e5e58553e3034f06dbf:3ee6555bbc53aa52aff708d06e60c77dc4d2cac54f5415a5ae757327df1a32d9';
const USER = { id: 'u-existing-1', email: 'mevcut.uye@example.com', username: 'mevcutuye', name: 'Mevcut Üye' };

function freshEnv(extra = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(read('schema.sql'));
  db.prepare('INSERT INTO users (id, email, username, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(USER.id, USER.email, USER.username, LEGACY_HASH, USER.name, 'user', 1700000000000);
  const log = [];
  const env = {
    DB: d1(db, log),
    ASSETS: { fetch: async () => new Response('<!doctype html><title>t</title>', { status: 200, headers: { 'Content-Type': 'text/html' } }) },
    GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret',
    LINKEDIN_CLIENT_ID: 'lid', LINKEDIN_CLIENT_SECRET: 'lsecret',
    ...extra,
  };
  return { db, env, log };
}
function makeCtx() {
  const pending = [];
  return { pending, waitUntil(p) { pending.push(p); }, passThroughOnException() {}, async drain() { await Promise.all(pending); } };
}
const usersSnapshot = (db) => JSON.stringify(db.prepare('SELECT * FROM users ORDER BY id').all());
const setCookies = (res) => (typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const cookieValue = (list, name) => {
  for (const c of list) { const m = c.match(new RegExp(`^${name}=([^;]*)`)); if (m) return m[1]; }
  return null;
};
function statePayload(location) {
  const state = new URL(location).searchParams.get('state');
  const enc = state.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(enc, 'base64').toString('utf8'));
}
async function call(env, method, path, { body, cookie, ctx } = {}) {
  const headers = { 'CF-Connecting-IP': '203.0.113.7' };
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  mute();
  try {
    return await worker.fetch(new Request(`https://mimarlab.com${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' }), env, ctx || makeCtx());
  } finally { unmute(); }
}

// =================================================================================================
section('1) Open redirect — server + istemci kopyası');
const ORIGIN = 'https://mimarlab.com';
const BLOCKED = [
  '//evil.com', '///evil.com', '/\\evil.com', '/\\/evil.com', '\\\\evil.com', '\\/evil.com',
  'https://evil.com', 'http://evil.com/x', 'javascript:alert(1)', 'evil.com', ' //evil.com', '\t//evil.com',
  '/%5Cevil.com', '/%5cevil.com', '/%255Cevil.com', '/%25255cevil.com', '/%2F%2Fevil.com', '/%2f/evil.com', '/%2F%5Cevil.com',
  '/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/%09/evil.com', '/%0a/evil.com',
  '/x%0d%0aSet-Cookie:%20a=1', '/x\r\nLocation: https://evil.com', '/x%00', '/%E0%A4%A',
  '/redirect?u=https://evil.com', '/%2F%2F%65vil.com', '', '   ',
];
const ALLOWED = {
  '/hesabim.html': '/hesabim.html',
  '/hesabim': '/hesabim',
  '/gorusme/3f1c2a9e-0000-4000-8000-000000000001': '/gorusme/3f1c2a9e-0000-4000-8000-000000000001',
  '/proje/kc-evi?sekme=1#kunye': '/proje/kc-evi?sekme=1#kunye',
  '/kisi/kaan-%C3%A7orbac%C4%B1': '/kisi/kaan-%C3%A7orbac%C4%B1',
};

await test('bypass vektörlerinin HEPSİ server tarafında varsayılana düşer', () => {
  for (const v of BLOCKED) assert.equal(safeNextPath(v), '/hesabim.html', `geçti: ${JSON.stringify(v)}`);
  assert.equal(safeNextPath(null), '/hesabim.html');
  assert.equal(safeNextPath(undefined), '/hesabim.html');
  assert.equal(safeNextPath(42), '/hesabim.html');
});
await test('meşru site yolları DEĞİŞMEDEN geçer (server)', () => {
  for (const [v, want] of Object.entries(ALLOWED)) assert.equal(safeNextPath(v), want, v);
});
await test('istemci kopyası (auth-modal.js) her vektörde server ile AYNI kararı verir', () => {
  for (const v of [...BLOCKED, ...Object.keys(ALLOWED), null]) {
    assert.equal(mlSafeNextPath(v, '/hesabim.html', ORIGIN), safeNextPath(v), `ayrıştı: ${JSON.stringify(v)}`);
  }
});
await test('her çıktı tarayıcı gibi çözüldüğünde origin mimarlab.com olarak kalır', () => {
  for (const v of [...BLOCKED, ...Object.keys(ALLOWED)]) {
    const out = safeNextPath(v);
    assert.equal(new URL(out, ORIGIN).origin, ORIGIN, `dış origin: ${JSON.stringify(v)} -> ${out}`);
    assert.ok(!/[\x00-\x1f\x7f\\]/.test(out), `kontrol karakteri/ters bölü: ${JSON.stringify(out)}`);
  }
});
await test('eski dize kontrolü "/\\evil.com"u geçiriyordu (kelepçe anlamlı mı)', () => {
  const legacy = (n) => (!n || !n.startsWith('/') || n.startsWith('//') || n.includes('://')) ? '/hesabim.html' : n;
  assert.equal(new URL(legacy('/\\evil.com'), ORIGIN).host, 'evil.com');
});
await test('istemci: loginNextPath artık mlSafeNextPath üzerinden karar veriyor', () => {
  assert.match(modalSrc, /function loginNextPath\(\)[\s\S]{0,300}return mlSafeNextPath\(next, '\/hesabim', window\.location\.origin\);/);
  assert.ok(!/next\.startsWith\('\/\/'\) \|\| next\.includes\('\:\/\/'\)\) return '\/hesabim'/.test(modalSrc), 'eski kontrol kalmış');
});

// =================================================================================================
section('2) OAuth state — tarayıcı bağlaması');
const realFetch = globalThis.fetch;
let providerCalls = [];
function mockProviders(profile) {
  providerCalls = [];
  globalThis.fetch = async (input, init) => {
    const u = String(input && input.url ? input.url : input);
    providerCalls.push(u);
    if (u.includes('oauth2.googleapis.com/token') || u.includes('linkedin.com/oauth/v2/accessToken')) {
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }
    if (u.includes('openidconnect.googleapis.com') || u.includes('api.linkedin.com/v2/userinfo')) {
      return new Response(JSON.stringify(profile), { status: 200 });
    }
    return realFetch(input, init);
  };
}
async function start(env, provider, next) {
  const res = await call(env, 'GET', `/api/auth/${provider}/start?next=${encodeURIComponent(next)}`);
  const loc = res.headers.get('location');
  const bind = cookieValue(setCookies(res), `__Host-mimarlab_oauth_${provider}`);
  return { res, loc, bind, state: new URL(loc).searchParams.get('state') };
}
const cb = (env, provider, state, cookie) => call(env, 'GET', `/api/auth/${provider}/callback?code=c1&state=${encodeURIComponent(state)}`, { cookie });

await test('/start: __Host- bağlama çerezi HttpOnly+Secure+SameSite=Lax+Path=/, state yalnızca HASH taşır', async () => {
  const { env } = freshEnv();
  const { res, bind, loc } = await start(env, 'google', '/gorusme/abc');
  assert.equal(res.status, 302);
  assert.match(loc, /^https:\/\/accounts\.google\.com\//);
  const raw = setCookies(res).find(c => c.startsWith('__Host-mimarlab_oauth_google='));
  assert.ok(raw, 'bağlama çerezi yok');
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=600']) assert.ok(raw.includes(attr), `${attr} yok: ${raw}`);
  assert.ok(!/Domain=/i.test(raw));
  assert.match(bind, /^[0-9a-f]{64}$/);
  const p = statePayload(loc);
  assert.equal(p.bind, sha256(bind));
  assert.ok(!loc.includes(bind), 'çerez değeri URL\'e sızdı');
  assert.equal(p.next, '/gorusme/abc');
});
await test('/start: "/\\evil.com" state\'e hiç girmez', async () => {
  const { env } = freshEnv();
  const { loc } = await start(env, 'google', '/\\evil.com');
  assert.equal(statePayload(loc).next, '/hesabim.html');
});
await test('callback: çerez YOKSA invalid_state ve sağlayıcıya HİÇ istek atılmaz', async () => {
  const { env, db } = freshEnv();
  mockProviders({ email: USER.email, email_verified: true, name: USER.name });
  const { state } = await start(env, 'google', '/hesabim.html');
  const res = await cb(env, 'google', state, '');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /oauth_error=invalid_state/);
  assert.equal(providerCalls.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
  assert.ok(setCookies(res).some(c => c.startsWith('__Host-mimarlab_oauth_google=;') && c.includes('Max-Age=0')), 'bağlama çerezi silinmedi');
});
await test('callback: yanlış çerez / BAŞKA tarayıcının state\'i (login CSRF) reddedilir', async () => {
  const { env, db } = freshEnv();
  mockProviders({ email: 'saldirgan@example.com', email_verified: true, name: 'S' });
  const attacker = await start(env, 'google', '/hesabim.html');
  const victim = await start(env, 'google', '/hesabim.html');
  const r1 = await cb(env, 'google', attacker.state, `__Host-mimarlab_oauth_google=${victim.bind}`);
  assert.match(r1.headers.get('location'), /oauth_error=invalid_state/);
  const r2 = await cb(env, 'google', attacker.state, `__Host-mimarlab_oauth_google=${'0'.repeat(64)}`);
  assert.match(r2.headers.get('location'), /oauth_error=invalid_state/);
  assert.equal(providerCalls.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 1, 'saldırgan hesabı açıldı');
});
await test('callback: bağlamasız ESKİ biçim state (deploy anında yarıda kalan akış) reddedilir', async () => {
  const { env } = freshEnv();
  mockProviders({ email: USER.email, email_verified: true });
  const legacyState = await signState('gsecret', 'google', '/hesabim.html');
  const res = await cb(env, 'google', legacyState, `__Host-mimarlab_oauth_google=${'a'.repeat(64)}`);
  assert.match(res.headers.get('location'), /oauth_error=invalid_state/);
  assert.equal(providerCalls.length, 0);
});
await test('callback: doğru tarayıcı -> MEVCUT hesaba e-postayla eşleşir, oturum açılır, users DEĞİŞMEZ', async () => {
  const { env, db, log } = freshEnv();
  const before = usersSnapshot(db);
  mockProviders({ email: USER.email.toUpperCase(), email_verified: true, name: 'Farklı Ad' });
  const { state, bind } = await start(env, 'google', '/gorusme/abc');
  log.length = 0;
  const res = await cb(env, 'google', state, `__Host-mimarlab_oauth_google=${bind}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/gorusme/abc');
  const cookies = setCookies(res);
  assert.ok(cookieValue(cookies, '__Host-mimarlab_session'), 'oturum çerezi yok');
  assert.ok(cookies.some(c => c.startsWith('__Host-mimarlab_oauth_google=;')), 'bağlama çerezi silinmedi');
  assert.equal(db.prepare('SELECT user_id FROM sessions').get().user_id, USER.id);
  assert.equal(usersSnapshot(db), before, 'users satırı değişti');
  assert.ok(!log.some(s => /UPDATE\s+users/i.test(s)), 'UPDATE users çalıştı');
});
await test('callback: LinkedIn de aynı bağlamayla çalışır; yeni kullanıcı kaydı eskisi gibi açılır', async () => {
  const { env, db } = freshEnv();
  mockProviders({ email: 'yeni.li@example.com', name: 'Yeni Linkedin' });
  const { state, bind } = await start(env, 'linkedin', '/hesabim.html');
  const res = await cb(env, 'linkedin', state, `__Host-mimarlab_oauth_linkedin=${bind}`);
  assert.equal(res.headers.get('location'), '/hesabim.html');
  const row = db.prepare("SELECT role FROM users WHERE email = 'yeni.li@example.com'").get();
  assert.equal(row.role, 'user');
});
await test('callback: imzalı state\'e gömülmüş "/\\evil.com" callback\'te de reddedilir', async () => {
  const { env } = freshEnv();
  mockProviders({ email: USER.email, email_verified: true });
  const bind = 'b'.repeat(64);
  const state = await signState('gsecret', 'google', '/\\evil.com', sha256(bind));
  const res = await cb(env, 'google', state, `__Host-mimarlab_oauth_google=${bind}`);
  assert.equal(res.headers.get('location'), '/hesabim.html');
});
await test('Google Meet kurulumu: signState/verifyState bağlamasız kullanım geriye uyumlu', async () => {
  const s = await signState('gsecret', 'google-meet', '');
  const p = await verifyState('gsecret', 'google-meet', s);
  assert.ok(p && !('bind' in p));
});
globalThis.fetch = realFetch;

// =================================================================================================
section('3) forgot-password — zamanlama eşitliği');
function mockResend(delayMs, sent) {
  globalThis.fetch = async (input, init) => {
    const u = String(input && input.url ? input.url : input);
    if (u.startsWith('https://api.resend.com/')) {
      await new Promise(r => setTimeout(r, delayMs));
      sent.push(JSON.parse(init.body));
      return new Response('{}', { status: 200 });
    }
    return realFetch(input, init);
  };
}
async function forgot(env, email, ctx) {
  return call(env, 'POST', '/api/auth/forgot-password', { body: { email }, ctx });
}
await test('yanıttan ÖNCE koşan SQL var/yok e-postada birebir aynı; gövde + durum aynı', async () => {
  const sent = [];
  mockResend(0, sent);
  const a = freshEnv({ RESEND_API_KEY: 'k' });
  const b = freshEnv({ RESEND_API_KEY: 'k' });
  const ctxA = makeCtx(); const ctxB = makeCtx();
  const rA = await forgot(a.env, USER.email, ctxA);
  const sqlA = [...a.log];
  const rB = await forgot(b.env, 'yok.boyle@example.com', ctxB);
  const sqlB = [...b.log];
  assert.deepEqual(sqlA, sqlB);
  assert.equal(rA.status, rB.status);
  assert.equal(await rA.text(), await rB.text());
  assert.ok(!sqlA.some(s => /password_resets/.test(s)), 'token yanıttan önce yazılıyor');
  await ctxA.drain(); await ctxB.drain();
  assert.equal(a.db.prepare('SELECT COUNT(*) n FROM password_resets').get().n, 1);
  assert.equal(b.db.prepare('SELECT COUNT(*) n FROM password_resets').get().n, 0);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, USER.email);
});
await test('Resend 400 ms gecikse bile yanıt süreleri eşit (fark < 120 ms)', async () => {
  const sent = [];
  mockResend(400, sent);
  const times = { yes: [], no: [] };
  for (let i = 0; i < 3; i++) {
    for (const [k, email] of [['yes', USER.email], ['no', `yok${i}@example.com`]]) {
      const { env } = freshEnv({ RESEND_API_KEY: 'k' });
      const ctx = makeCtx();
      const t0 = performance.now();
      await forgot(env, email, ctx);
      times[k].push(performance.now() - t0);
      await ctx.drain();
    }
  }
  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(avg(times.yes) - avg(times.no)) < 120, JSON.stringify(times));
  assert.ok(avg(times.yes) < 300, `kayıtlı e-posta hâlâ e-postayı bekliyor: ${avg(times.yes)} ms`);
  assert.equal(sent.length, 3);
});
await test('e-postadaki token tek kullanımlık çalışır; e-posta başına 3/saat sınırı korunur', async () => {
  const sent = [];
  mockResend(0, sent);
  const { env, db } = freshEnv({ RESEND_API_KEY: 'k' });
  for (let i = 0; i < 4; i++) { const ctx = makeCtx(); await forgot(env, USER.email, ctx); await ctx.drain(); }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM password_resets').get().n, 3, '4. istek token üretti');
  const token = new URL(sent[0].html.match(/href="([^"]+)"/)[1]).searchParams.get('token');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM password_resets WHERE token_hash = ?').get(sha256(token)).n, 1);
  const r1 = await call(env, 'POST', '/api/auth/reset-password', { body: { token, newPassword: 'YeniSifre!2025' } });
  assert.equal(r1.status, 200);
  const r2 = await call(env, 'POST', '/api/auth/reset-password', { body: { token, newPassword: 'Baska!2026x' } });
  assert.equal(r2.status, 401);
});
await test('ctx olmadan çağrıldığında (Workers dışı) eski sıralı davranış', async () => {
  const sent = [];
  mockResend(0, sent);
  const { env, db } = freshEnv({ RESEND_API_KEY: 'k' });
  mute();
  const res = await handleAuthRoute(new Request('https://mimarlab.com/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: USER.email }) }), env, new URL('https://mimarlab.com/api/auth/forgot-password'));
  unmute();
  assert.equal(res.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM password_resets').get().n, 1);
  assert.equal(sent.length, 1);
});
globalThis.fetch = realFetch;

// =================================================================================================
section('4) Regresyon — mevcut kullanıcılar ve kimlik bilgileri');
await test('sabit (bugünkü formatta) hash doğrulanır — algoritma/format değişmedi', async () => {
  assert.equal(await verifyPassword(LEGACY_PASSWORD, LEGACY_HASH), true);
  assert.equal(await verifyPassword('yanlis', LEGACY_HASH), false);
  assert.match(read('src/lib/crypto.js'), /const PBKDF2_ITERATIONS = 100000;/);
});
await test('mevcut kullanıcı e-posta ve kullanıcı adıyla giriş yapar; users satırı DEĞİŞMEZ', async () => {
  const { env, db, log } = freshEnv();
  const before = usersSnapshot(db);
  const r1 = await call(env, 'POST', '/api/auth/login', { body: { identifier: `  ${USER.email.toUpperCase()} `, password: LEGACY_PASSWORD } });
  assert.equal(r1.status, 200);
  const sess = cookieValue(setCookies(r1), '__Host-mimarlab_session');
  assert.ok(sess);
  const r2 = await call(env, 'POST', '/api/auth/login', { body: { email: USER.username, password: LEGACY_PASSWORD } });
  assert.equal(r2.status, 200);
  const r3 = await call(env, 'POST', '/api/auth/login', { body: { identifier: USER.email, password: 'yanlis-sifre' } });
  assert.equal(r3.status, 401);
  assert.deepEqual(await r3.json(), { error: 'E-posta/kullanıcı adı veya şifre hatalı.' });
  const me = await call(env, 'GET', '/api/auth/me', { cookie: `__Host-mimarlab_session=${sess}` });
  assert.equal((await me.json()).user.email, USER.email);
  assert.equal(usersSnapshot(db), before);
  assert.ok(!log.some(s => /UPDATE\s+users/i.test(s)));
});
await test('önceden açılmış oturumlar forgot-password ve OAuth girişinden sonra da geçerli (logout yok)', async () => {
  const { env, db, log } = freshEnv();
  const oldToken = 'f'.repeat(64);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(oldToken), USER.id, Date.now(), Date.now() + 86400000);
  const ctx = makeCtx();
  await forgot(env, USER.email, ctx); await ctx.drain();
  mockProviders({ email: USER.email, email_verified: true });
  const { state, bind } = await start(env, 'google', '/hesabim.html');
  await cb(env, 'google', state, `__Host-mimarlab_oauth_google=${bind}`);
  globalThis.fetch = realFetch;
  const me = await call(env, 'GET', '/api/auth/me', { cookie: `__Host-mimarlab_session=${oldToken}` });
  assert.equal(me.status, 200);
  assert.ok(!log.some(s => /DELETE FROM sessions/i.test(s)), 'oturum silindi');
});
await test('signup ve logout akışları değişmedi', async () => {
  const { env } = freshEnv();
  const r = await call(env, 'POST', '/api/auth/signup', { body: { name: 'Yeni Üye', username: 'yeniuye', email: 'yeni@example.com', password: 'Sifre12345', password_confirm: 'Sifre12345', botCheck: true, kvkkAccepted: true } });
  assert.equal(r.status, 201);
  const sess = cookieValue(setCookies(r), '__Host-mimarlab_session');
  const dup = await call(env, 'POST', '/api/auth/signup', { body: { name: 'X', username: 'baskaad', email: 'yeni@example.com', password: 'Sifre12345', password_confirm: 'Sifre12345', botCheck: true, kvkkAccepted: true } });
  assert.equal(dup.status, 409);
  const out = await call(env, 'POST', '/api/auth/logout', { cookie: `__Host-mimarlab_session=${sess}` });
  assert.ok(setCookies(out).some(c => c.startsWith('__Host-mimarlab_session=;') && c.includes('Max-Age=0')));
  const me = await call(env, 'GET', '/api/auth/me', { cookie: `__Host-mimarlab_session=${sess}` });
  assert.equal(me.status, 401);
});
await test('bu değişiklik migration/şema dokunuşu içermez: auth kodunda users UPDATE yolu eklenmedi', () => {
  const src = read('src/routes/auth.js');
  const updates = (src.match(/UPDATE users SET/g) || []).length;
  assert.equal(updates, 4, 'auth.js\'teki UPDATE users sayısı değişti (oauth dolgu, change/reset password, profil)');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
