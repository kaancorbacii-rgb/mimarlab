#!/usr/bin/env node
// GÜVENLİ GÖRÜŞME GATEWAY'İ / GOOGLE MEET BİRİM+ENTEGRASYON TESTLERİ (kullanıcı isteği, 2026-09-08).
//
// scripts/test-gundem.mjs ile AYNI desen: test koşucusu yok, npm bağımlılığı yok, yalnızca
// node:assert. FARKI: D1 burada sahte bir "SQL-benzeri" nesne DEĞİL, Node'un kendi node:sqlite
// modülü üzerinde çalışan gerçek bir SQLite'tır — schema.sql BİREBİR yüklenir (migrations/0104 ile
// eklenen kolonlar dahil), yani sorguların gerçek şemaya karşı geçerliliği de test edilir.
// Google API sahte fetch ile taklit edilir (token ucu + Calendar events ucu); JWT imzası gerçek bir
// RSA anahtar çiftiyle atılıp DOĞRULANIR. Saat sahtedir (Date.now geçici olarak değiştirilir).
//
// KAPSAM (kullanıcı isteğindeki 13 senaryo, numaralar korunarak):
//   1 geçerli kullanıcı + doğru booking -> 200      2 yetkisiz kullanıcı -> 403
//   3 giriş yok -> 401 (API) / 302 /giris?next= (sayfa)  4 15 dk'dan erken -> meetLink YOK
//   5 katılım penceresi -> meetLink VAR              6 görüşme bitti -> meetLink YOK
//   7 meet_link mevcut -> ikinci Meet oluşturulmaz    8 Google hata -> booking bozulmaz, failed
//   9 aynı onay iki kez / eşzamanlı -> tek Meet       10 geçersiz room_uuid -> 404
//   12 refresh = her istek sunucuda yeniden yetki     13 yetkisiz yanıtta Meet adresi sızmaz
//   (11 mobil düzen: tarayıcıda, bkz. son rapor)

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { meetingWindow, createMeetForConsultation, retryPendingMeets, maybeRetryMeetOnAccess, ensureRoomUuid, resolveConsultationAccess, ROOM_UUID_RE } from '../src/lib/consultationMeet.js';
import { safeErrorMessage, getServiceAccountToken, _resetTokenCacheForTests, missingMeetSecrets } from '../src/lib/googleMeet.js';
import { handleConsultationsRoute, buildRoomState } from '../src/routes/consultations.js';
import { handleAdminRoute } from '../src/routes/admin.js';
import worker from '../src/index.js';
import { sha256Hex } from '../src/lib/crypto.js';

let passed = 0;
let failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 3).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

// ---- D1 shim (node:sqlite) --------------------------------------------------------------------
function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql, []) };
}
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return db;
}

// ---- sahte saat -------------------------------------------------------------------------------
const realNow = Date.now;
function withClock(ms, fn) {
  Date.now = () => ms;
  return Promise.resolve().then(fn).finally(() => { Date.now = realNow; });
}

// ---- sahte Google ------------------------------------------------------------------------------
// Test RSA anahtarı: PKCS#8 PEM olarak env'e girer; JWT imzası SPKI ile doğrulanır.
async function makeKeyPair() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const b64 = Buffer.from(pkcs8).toString('base64').match(/.{1,64}/g).join('\n');
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, publicKey: kp.publicKey };
}
const KEYS = await makeKeyPair();
function googleEnv(overrides = {}) {
  return {
    GOOGLE_CLIENT_EMAIL: 'meet-bot@mimarlab-test.iam.gserviceaccount.com',
    // Secret'lar çoğu zaman kaçışlı "\n" ile saklanır — ikisi de kabul edilmeli.
    GOOGLE_PRIVATE_KEY: KEYS.pem.replace(/\n/g, '\\n'),
    GOOGLE_CALENDAR_ID: 'test-calendar@group.calendar.google.com',
    ...overrides,
  };
}
function b64urlDecode(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

// fakeGoogle: token + events uçlarını taklit eder; çağrıları kaydeder; davranışı seçeneklerle değişir.
function fakeGoogle(opts = {}) {
  const calls = { token: 0, insert: 0, get: 0, bodies: [], urls: [], assertions: [] };
  let eventCounter = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.urls.push(url);
    if (url === 'https://oauth2.googleapis.com/token') {
      calls.token++;
      const assertion = new URLSearchParams(init.body).get('assertion');
      calls.assertions.push(assertion);
      if (opts.tokenFails) return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), { status: 400 });
      return new Response(JSON.stringify({ access_token: 'ya29.' + 'x'.repeat(80), expires_in: 3599, token_type: 'Bearer' }), { status: 200 });
    }
    if (url.includes('/calendar/v3/calendars/') && init.method === 'POST') {
      calls.insert++;
      calls.bodies.push(JSON.parse(init.body));
      if (opts.insertDelayMs) await new Promise((r) => setTimeout(r, opts.insertDelayMs));
      if (opts.insertFails) return new Response(JSON.stringify({ error: { code: 400, message: 'Invalid conference type value.', status: 'INVALID_ARGUMENT' } }), { status: 400 });
      const id = `evt_${++eventCounter}`;
      if (opts.pendingFirst) {
        return new Response(JSON.stringify({ id, conferenceData: { createRequest: { status: { statusCode: 'pending' } } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ id, hangoutLink: `https://meet.google.com/abc-defg-${eventCounter}` }), { status: 200 });
    }
    if (url.includes('/calendar/v3/calendars/') && init.method === 'GET') {
      calls.get++;
      const id = decodeURIComponent(url.split('/events/')[1].split('?')[0]);
      return new Response(JSON.stringify({ id, conferenceData: { entryPoints: [{ entryPointType: 'video', uri: `https://meet.google.com/pend-ing-${id}` }] } }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, calls };
}

// ---- veri fikstürü -----------------------------------------------------------------------------
const SLOT = { date: '2026-09-14', time: '20:00' };          // Pazartesi
const START = Date.parse('2026-09-14T20:00:00+03:00');       // = 17:00Z
const MIN = 60 * 1000;
const BUYER = 'user-buyer', HOST = 'user-host', OTHER = 'user-other', ADMIN = 'user-admin';
const TOKENS = { [BUYER]: 'tok-buyer', [HOST]: 'tok-host', [OTHER]: 'tok-other', [ADMIN]: 'tok-admin' };

async function seed(db, { status = 'approved', meet = {} } = {}) {
  const now = realNow();
  const ins = (sql, ...p) => db.prepare(sql).run(...p);
  for (const [id, role] of [[BUYER, 'user'], [HOST, 'user'], [OTHER, 'user'], [ADMIN, 'admin']]) {
    ins(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', ?, ?, ?)`, id, `${id}@example.com`, id, role, now);
    ins(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`, await sha256Hex(TOKENS[id]), id, now, now + 86400e3 * 365);
  }
  ins(`INSERT INTO architects (slug, name, position, photo_url, claimed_by_user_id) VALUES ('kaan-corbaci', 'Kaan Çorbacı', 'Mimar', '/mimarlar/kaan.webp', ?)`, HOST);
  const roomUuid = crypto.randomUUID();
  ins(`INSERT INTO consultation_requests (id, user_id, host_slug, requested_date, requested_time, price_try, status, created_at, updated_at, contact_name, contact_email, contact_phone, room_uuid, meet_link, meet_status, meet_event_id)
       VALUES ('c1', ?, 'kaan-corbaci', ?, ?, 1500, ?, ?, ?, 'Ayşe Yılmaz', 'ayse@example.com', '05311112233', ?, ?, ?, ?)`,
    BUYER, SLOT.date, SLOT.time, status, now, now, roomUuid, meet.link || null, meet.status || null, meet.eventId || null);
  return roomUuid;
}
function row(db, id = 'c1') { return db.prepare('SELECT * FROM consultation_requests WHERE id = ?').get(id); }
function notifs(db) { return db.prepare('SELECT user_id, type, title, body, link FROM notifications ORDER BY rowid').all(); }
function req(path, { user, method = 'GET', body, https = false } = {}) {
  const headers = {};
  const cookieName = https ? '__Host-mimarlab_session' : 'mimarlab_session';
  if (user) headers.Cookie = `${cookieName}=${TOKENS[user]}`;
  if (body) headers['Content-Type'] = 'application/json';
  return new Request(`${https ? 'https://mimarlab.com' : 'http://localhost:8787'}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}
async function roomApi(env, roomUuid, user) {
  const r = req(`/api/consultations/room/${roomUuid}`, { user });
  const res = await handleConsultationsRoute(r, env, new URL(r.url));
  return { status: res.status, body: await res.json() };
}

// =================================================================================================
section('1) Zaman kilidi — meetingWindow (sahte saat, sunucu tarafı)');
// =================================================================================================
const R = { requested_date: SLOT.date, requested_time: SLOT.time };
await test('1a) 19:00 -> waiting (buton pasif)', () => { const w = meetingWindow(R, START - 60 * MIN); assert.equal(w.phase, 'waiting'); assert.equal(w.joinable, false); });
await test('1b) 19:44:59 -> hâlâ waiting', () => assert.equal(meetingWindow(R, START - 15 * MIN - 1000).phase, 'waiting'));
await test('1c) 19:45 -> soon (buton AKTİF)', () => { const w = meetingWindow(R, START - 15 * MIN); assert.equal(w.phase, 'soon'); assert.equal(w.joinable, true); });
await test('1d) 20:00 -> open', () => assert.equal(meetingWindow(R, START).phase, 'open'));
await test('1e) 20:44:59 -> open', () => assert.equal(meetingWindow(R, START + 45 * MIN - 1000).phase, 'open'));
await test('1f) 20:45 -> ended (buton pasif)', () => { const w = meetingWindow(R, START + 45 * MIN); assert.equal(w.phase, 'ended'); assert.equal(w.joinable, false); });
await test('1g) sınırlar: startsAt = 2026-09-14T17:00Z (İstanbul +03:00), joinOpensAt = -15dk, endsAt = +45dk', () => {
  const w = meetingWindow(R, START);
  assert.equal(new Date(w.startsAt).toISOString(), '2026-09-14T17:00:00.000Z');
  assert.equal(w.joinOpensAt, START - 15 * MIN); assert.equal(w.endsAt, START + 45 * MIN);
});
await test('1h) bozuk tarih -> invalid, joinable=false', () => { const w = meetingWindow({ requested_date: 'x', requested_time: 'y' }, START); assert.equal(w.phase, 'invalid'); assert.equal(w.joinable, false); });

// =================================================================================================
section('2) buildRoomState — Meet adresi yalnızca pencere içinde ve yalnızca hazırsa');
// =================================================================================================
const access = { isBuyer: true, isHost: false, allowed: true, host: { name: 'Kaan Çorbacı', slug: 'kaan-corbaci' } };
const readyRow = { ...R, id: 'c1', room_uuid: 'r', status: 'approved', host_slug: 'kaan-corbaci', meet_link: 'https://meet.google.com/aaa-bbbb-ccc', meet_status: 'ready' };
await test('2a) waiting: meetLink alanı HİÇ yok', () => assert.equal('meetLink' in buildRoomState({}, readyRow, access, null, START - 60 * MIN), false));
await test('2b) soon: meetLink var', () => assert.equal(buildRoomState({}, readyRow, access, null, START - 15 * MIN).meetLink, readyRow.meet_link));
await test('2c) open: meetLink var', () => assert.equal(buildRoomState({}, readyRow, access, null, START + 10 * MIN).meetLink, readyRow.meet_link));
await test('2d) ended: meetLink yok', () => assert.equal('meetLink' in buildRoomState({}, readyRow, access, null, START + 45 * MIN), false));
await test('2e) status=pending: phase not_approved, meetLink yok (pencere içinde olsa da)', () => {
  const s = buildRoomState({}, { ...readyRow, status: 'pending' }, access, null, START);
  assert.equal(s.phase, 'not_approved'); assert.equal('meetLink' in s, false);
});
await test('2f) meet_status=failed: meetLink yok, meetStatus=failed', () => {
  const s = buildRoomState({}, { ...readyRow, meet_link: null, meet_status: 'failed' }, access, null, START);
  assert.equal('meetLink' in s, false); assert.equal(s.meetStatus, 'failed');
});
await test('2g) yanıt sunucu saatini ve sınırları taşır (istemci saatine güvenilmez)', () => {
  const s = buildRoomState({}, readyRow, access, null, START);
  assert.equal(s.serverNow, START); assert.equal(s.startsAt, START); assert.equal(s.durationMin, 45); assert.equal(s.joinEarlyMin, 15); assert.equal(s.timezone, 'Europe/Istanbul');
});

// =================================================================================================
section('3) Erişim kontrolü — GET /api/consultations/room/:uuid (gerçek şema, gerçek oturum)');
// =================================================================================================
{
  const db = freshDb();
  const uuid = await seed(db, { meet: { link: 'https://meet.google.com/xyz-abcd-efg', status: 'ready', eventId: 'evt' } });
  const env = { DB: d1(db) };
  await test('3.1) alıcı + doğru oda -> 200, isBuyer', async () => withClock(START - 60 * MIN, async () => {
    const r = await roomApi(env, uuid, BUYER); assert.equal(r.status, 200); assert.equal(r.body.isBuyer, true); assert.equal(r.body.host.name, 'Kaan Çorbacı');
  }));
  await test('3.1b) danışman (architects.claimed_by_user_id) -> 200, isHost', async () => {
    const r = await roomApi(env, uuid, HOST); assert.equal(r.status, 200); assert.equal(r.body.isHost, true);
  });
  await test('3.2) yetkisiz kullanıcı -> 403', async () => { const r = await roomApi(env, uuid, OTHER); assert.equal(r.status, 403); });
  await test('3.13) 403 yanıtında Meet adresi SIZMAZ', async () => {
    const r = await roomApi(env, uuid, OTHER); assert.equal(JSON.stringify(r.body).includes('meet.google.com'), false);
  });
  await test('3.3) oturum yok -> 401', async () => { const r = await roomApi(env, uuid, null); assert.equal(r.status, 401); });
  await test('3.10) geçersiz biçimli room_uuid -> 404 (D1\'e gitmeden)', async () => { const r = await roomApi(env, 'not-a-uuid', BUYER); assert.equal(r.status, 404); });
  await test('3.10b) geçerli biçimli ama bilinmeyen room_uuid -> 404', async () => { const r = await roomApi(env, crypto.randomUUID(), BUYER); assert.equal(r.status, 404); });
  await test('3.4) 15 dk\'dan erken: 200 ama meetLink YOK', async () => withClock(START - 16 * MIN, async () => {
    const r = await roomApi(env, uuid, BUYER); assert.equal(r.status, 200); assert.equal(r.body.phase, 'waiting'); assert.equal('meetLink' in r.body, false);
  }));
  await test('3.5) katılım penceresi (19:45): meetLink VAR', async () => withClock(START - 15 * MIN, async () => {
    const r = await roomApi(env, uuid, BUYER); assert.equal(r.body.phase, 'soon'); assert.equal(r.body.meetLink, 'https://meet.google.com/xyz-abcd-efg');
  }));
  await test('3.5b) katılım penceresi (20:30): meetLink VAR', async () => withClock(START + 30 * MIN, async () => {
    const r = await roomApi(env, uuid, BUYER); assert.equal(r.body.phase, 'open'); assert.equal(r.body.meetLink, 'https://meet.google.com/xyz-abcd-efg');
  }));
  await test('3.6) görüşme bitti (20:45): meetLink YOK', async () => withClock(START + 45 * MIN, async () => {
    const r = await roomApi(env, uuid, BUYER); assert.equal(r.body.phase, 'ended'); assert.equal('meetLink' in r.body, false);
  }));
  await test('3.12) refresh: yetki her istekte yeniden kurulur — oturum silinince aynı istek 401', async () => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(BUYER);
    const r = await roomApi(env, uuid, BUYER); assert.equal(r.status, 401);
  });
  await test('3.x) yanıtlar önbelleğe girmez (Cache-Control: private, no-store)', async () => {
    const r = req(`/api/consultations/room/${uuid}`, { user: HOST });
    const res = await handleConsultationsRoute(r, env, new URL(r.url));
    assert.match(res.headers.get('Cache-Control') || '', /no-store/);
  });
}

// =================================================================================================
section('4) Sayfa rotası — /gorusme/:room_uuid (worker.fetch, kabuk + sunucu tarafı yetki)');
// =================================================================================================
{
  const db = freshDb();
  const uuid = await seed(db, { meet: { link: 'https://meet.google.com/xyz-abcd-efg', status: 'ready' } });
  const shellHtml = readFileSync(new URL('../gorusme.html', import.meta.url), 'utf8');
  const env = {
    DB: d1(db),
    ASSETS: { fetch: async (r) => new URL(r.url).pathname === '/gorusme' ? new Response(shellHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : new Response('nope', { status: 404 }) },
  };
  const ctx = { waitUntil() {} };
  const page = (path, user) => worker.fetch(req(path, { user }), env, ctx);
  await test('4.3) giriş yok -> 302 /giris?next=/gorusme/<uuid>', async () => {
    const res = await page(`/gorusme/${uuid}`, null);
    assert.equal(res.status, 302); assert.equal(new URL(res.headers.get('Location')).pathname, '/giris');
    assert.equal(new URL(res.headers.get('Location')).searchParams.get('next'), `/gorusme/${uuid}`);
  });
  await test('4.1) alıcı -> 200 kabuk; kabukta Meet adresi ve kişisel veri YOK; Cache-Control no-store', async () => {
    const res = await page(`/gorusme/${uuid}`, BUYER);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(html.includes('meet.google.com/xyz'), false); assert.equal(html.includes('Ayşe'), false);
    assert.match(res.headers.get('Cache-Control'), /no-store/);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  });
  await test('4.2) yetkisiz kullanıcı -> 403 (kabuk erişim ekranı)', async () => { assert.equal((await page(`/gorusme/${uuid}`, OTHER)).status, 403); });
  await test('4.10) bilinmeyen/geçersiz uuid -> 404; çıplak /gorusme -> 404', async () => {
    assert.equal((await page(`/gorusme/${crypto.randomUUID()}`, BUYER)).status, 404);
    assert.equal((await page('/gorusme/abc', BUYER)).status, 404);
    assert.equal((await page('/gorusme', BUYER)).status, 404);
  });
  await test('4.x) güvenlik başlıkları sayfada da var (CSP, X-Frame-Options DENY)', async () => {
    const res = await page(`/gorusme/${uuid}`, BUYER);
    assert.equal(res.headers.get('X-Frame-Options'), 'DENY'); assert.ok(res.headers.get('Content-Security-Policy'));
  });
}

// =================================================================================================
section('5) Google Meet oluşturma — idempotency, hata yönetimi, JWT');
// =================================================================================================
await test('5.7) meet_link zaten var -> Google\'a HİÇ gidilmez, mevcut döner', async () => {
  const db = freshDb(); await seed(db, { meet: { link: 'https://meet.google.com/old-link-xyz', status: 'ready' } });
  const g = fakeGoogle();
  const res = await createMeetForConsultation({ DB: d1(db), ...googleEnv() }, 'c1', { fetchImpl: g.fetchImpl });
  assert.equal(res.status, 'ready'); assert.equal(res.alreadyExisted, true); assert.equal(res.meetLink, 'https://meet.google.com/old-link-xyz');
  assert.equal(g.calls.token + g.calls.insert, 0); assert.equal(row(db).meet_link, 'https://meet.google.com/old-link-xyz');
});
await test('5.a) başarı: event id + Meet adresi D1\'e yazılır, meet_status=ready, iki tarafa bildirim (link /gorusme/:uuid, Meet adresi bildirimde YOK)', async () => {
  _resetTokenCacheForTests();
  const db = freshDb(); const uuid = await seed(db);
  const g = fakeGoogle();
  const res = await createMeetForConsultation({ DB: d1(db), ...googleEnv() }, 'c1', { fetchImpl: g.fetchImpl, now: () => START - 3 * 86400e3 });
  assert.equal(res.status, 'ready'); assert.equal(g.calls.insert, 1);
  const r = row(db);
  assert.equal(r.meet_link, 'https://meet.google.com/abc-defg-1'); assert.equal(r.meet_event_id, 'evt_1'); assert.equal(r.meet_status, 'ready'); assert.equal(r.meet_error, null); assert.ok(r.meet_created_at);
  assert.equal(r.status, 'approved');
  const n = notifs(db);
  assert.equal(n.length, 2);
  assert.deepEqual(n.map((x) => x.user_id).sort(), [BUYER, HOST].sort());
  for (const x of n) { assert.equal(x.type, 'consultation_meet_ready'); assert.equal(x.link, `/gorusme/${uuid}`); assert.equal(JSON.stringify(x).includes('meet.google.com'), false); }
  assert.match(n.find((x) => x.user_id === BUYER).body, /Danışmanlık görüşmeniz hazır/);
});
await test('5.b) Google isteği: conferenceDataVersion=1, createRequest.requestId benzersiz (oda kimliği), hangoutsMeet, 20:00-20:45 Europe/Istanbul', async () => {
  _resetTokenCacheForTests();
  const db = freshDb(); const uuid = await seed(db);
  const g = fakeGoogle();
  await createMeetForConsultation({ DB: d1(db), ...googleEnv() }, 'c1', { fetchImpl: g.fetchImpl });
  const insertUrl = g.calls.urls.find((u) => u.includes('/events?'));
  assert.match(insertUrl, /conferenceDataVersion=1/); assert.match(insertUrl, /calendars\/test-calendar%40group\.calendar\.google\.com\/events/);
  const body = g.calls.bodies[0];
  assert.equal(body.conferenceData.createRequest.requestId, `mimarlab-${uuid}`);
  assert.equal(body.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
  assert.deepEqual(body.start, { dateTime: '2026-09-14T20:00:00', timeZone: 'Europe/Istanbul' });
  assert.deepEqual(body.end, { dateTime: '2026-09-14T20:45:00', timeZone: 'Europe/Istanbul' });
  assert.equal(body.extendedProperties.private.mimarlab_consultation_id, 'c1');
  assert.equal(JSON.stringify(body).includes('PRIVATE KEY'), false);
});
await test('5.c) JWT: RS256, iss/scope/aud doğru, imza gerçek anahtarla DOĞRULANIR; sub yalnızca GOOGLE_IMPERSONATE_USER varsa', async () => {
  _resetTokenCacheForTests();
  const g = fakeGoogle();
  await getServiceAccountToken(googleEnv(), { fetchImpl: g.fetchImpl, now: () => START });
  const [h, c, s] = g.calls.assertions[0].split('.');
  const header = JSON.parse(b64urlDecode(h)); const claims = JSON.parse(b64urlDecode(c));
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
  assert.equal(claims.iss, 'meet-bot@mimarlab-test.iam.gserviceaccount.com'); assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/calendar.events'); assert.equal(claims.exp - claims.iat, 3600); assert.equal('sub' in claims, false);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', KEYS.publicKey, b64urlDecode(s), new TextEncoder().encode(`${h}.${c}`));
  assert.equal(ok, true, 'JWT imzası doğrulanamadı');
  _resetTokenCacheForTests();
  const g2 = fakeGoogle();
  await getServiceAccountToken(googleEnv({ GOOGLE_IMPERSONATE_USER: 'kaan@mimarlab.com' }), { fetchImpl: g2.fetchImpl, now: () => START });
  assert.equal(JSON.parse(b64urlDecode(g2.calls.assertions[0].split('.')[1])).sub, 'kaan@mimarlab.com');
});
await test('5.d) token isolate içinde önbellenir (ikinci çağrı token ucuna gitmez)', async () => {
  _resetTokenCacheForTests();
  const g = fakeGoogle();
  await getServiceAccountToken(googleEnv(), { fetchImpl: g.fetchImpl, now: () => START });
  await getServiceAccountToken(googleEnv(), { fetchImpl: g.fetchImpl, now: () => START + 10 * MIN });
  assert.equal(g.calls.token, 1);
});
await test('5.8) Google hata veriyor -> booking BOZULMAZ (status approved kalır), meet_status=failed, meet_error güvenli, bildirim yok', async () => {
  _resetTokenCacheForTests();
  const db = freshDb(); await seed(db);
  const g = fakeGoogle({ insertFails: true });
  const res = await createMeetForConsultation({ DB: d1(db), ...googleEnv() }, 'c1', { fetchImpl: g.fetchImpl });
  assert.equal(res.status, 'failed');
  const r = row(db);
  assert.equal(r.status, 'approved'); assert.equal(r.meet_link, null); assert.equal(r.meet_status, 'failed');
  assert.match(r.meet_error, /google_http_400: Invalid conference type value/);
  assert.equal(r.meet_error.includes('ya29'), false); assert.equal(notifs(db).length, 0);
});
await test('5.8b) token ucu hata veriyor -> failed, hata metninde belirteç/anahtar yok', async () => {
  _resetTokenCacheForTests();
  const db = freshDb(); await seed(db);
  const g = fakeGoogle({ tokenFails: true });
  const res = await createMeetForConsultation({ DB: d1(db), ...googleEnv() }, 'c1', { fetchImpl: g.fetchImpl });
  assert.equal(res.status, 'failed'); assert.match(row(db).meet_error, /google_token_error: Invalid JWT Signature/);
  assert.equal(g.calls.insert, 0);
});
await test('5.e) credential eksik -> uygulama bozulmaz: failed + "config_missing: <isimler>", Google\'a gidilmez, satır sağlam', async () => {
  const db = freshDb(); await seed(db);
  const g = fakeGoogle();
  const res = await createMeetForConsultation({ DB: d1(db), GOOGLE_CLIENT_EMAIL: 'x@y.iam.gserviceaccount.com' }, 'c1', { fetchImpl: g.fetchImpl });
  assert.equal(res.status, 'failed'); assert.equal(res.error, 'config_missing: GOOGLE_PRIVATE_KEY, GOOGLE_CALENDAR_ID');
  assert.equal(g.calls.token + g.calls.insert, 0); assert.equal(row(db).status, 'approved'); assert.equal(row(db).meet_status, 'failed');
  assert.deepEqual(missingMeetSecrets({}), ['GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_CALENDAR_ID']);
});
await test('5.f) bozuk private key -> config_invalid, anahtar içeriği hata metnine girmez', async () => {
  _resetTokenCacheForTests();
  const db = freshDb(); await seed(db);
  const g = fakeGoogle();
  await createMeetForConsultation({ DB: d1(db), ...googleEnv({ GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' }) }, 'c1', { fetchImpl: g.fetchImpl });
  assert.match(row(db).meet_error, /config_invalid/); assert.equal(row(db).meet_error.includes('AAAA'), false);
});
await test('5.g) başarısız denemeden sonra yeniden deneme başarılı olur (failed -> ready)', async () => {
  _resetTokenCacheForTests();
  const db = freshDb(); await seed(db);
  const bad = fakeGoogle({ insertFails: true });
  await createMeetForConsultation({ DB: d1(db), ...googleEnv() }, 'c1', { fetchImpl: bad.fetchImpl });
  assert.equal(row(db).meet_status, 'failed');
  const good = fakeGoogle();
  const res = await createMeetForConsultation({ DB: d1(db), ...googleEnv() }, 'c1', { fetchImpl: good.fetchImpl });
  assert.equal(res.status, 'ready'); assert.equal(row(db).meet_status, 'ready'); assert.equal(row(db).meet_error, null);
});
await test('5.h) konferans "pending" dönerse etkinlik yeniden okunur ve bağlantı oradan alınır', async () => {
  _resetTokenCacheForTests();
  const db = freshDb(); await seed(db);
  const g = fakeGoogle({ pendingFirst: true });
  const res = await createMeetForConsultation({ DB: d1(db), ...googleEnv() }, 'c1', { fetchImpl: g.fetchImpl, sleep: async () => {} });
  assert.equal(res.status, 'ready'); assert.equal(g.calls.get, 1); assert.match(row(db).meet_link, /^https:\/\/meet\.google\.com\/pend-ing-evt_1$/);
});
await test('5.9) aynı onay/webhook İKİ kez ART ARDA -> tek Meet (ikinci çağrı Google\'a gitmez)', async () => {
  _resetTokenCacheForTests();
  const db = freshDb(); await seed(db);
  const g = fakeGoogle();
  const env = { DB: d1(db), ...googleEnv() };
  const a = await createMeetForConsultation(env, 'c1', { fetchImpl: g.fetchImpl });
  const b = await createMeetForConsultation(env, 'c1', { fetchImpl: g.fetchImpl });
  assert.equal(a.status, 'ready'); assert.equal(b.status, 'ready'); assert.equal(b.alreadyExisted, true);
  assert.equal(g.calls.insert, 1); assert.equal(notifs(db).length, 2);
});
await test('5.9b) EŞZAMANLI iki çağrı -> tek Meet (kilit), ikincisi in_progress ile çekilir', async () => {
  _resetTokenCacheForTests();
  const db = freshDb(); await seed(db);
  const g = fakeGoogle({ insertDelayMs: 30 });
  const env = { DB: d1(db), ...googleEnv() };
  const [a, b] = await Promise.all([
    createMeetForConsultation(env, 'c1', { fetchImpl: g.fetchImpl }),
    createMeetForConsultation(env, 'c1', { fetchImpl: g.fetchImpl }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, ['ready', 'skipped']); assert.equal([a, b].find((x) => x.status === 'skipped').reason, 'in_progress');
  assert.equal(g.calls.insert, 1); assert.equal(notifs(db).length, 2); assert.equal(row(db).meet_status, 'ready');
});
await test('5.i) onaylı olmayan rezervasyon için Meet oluşturulmaz', async () => {
  const db = freshDb(); await seed(db, { status: 'pending' });
  const g = fakeGoogle();
  const res = await createMeetForConsultation({ DB: d1(db), ...googleEnv() }, 'c1', { fetchImpl: g.fetchImpl });
  assert.equal(res.status, 'skipped'); assert.equal(res.reason, 'not_approved'); assert.equal(g.calls.insert, 0);
});
await test('5.j) safeErrorMessage: Bearer/uzun belirteç/e-posta/PEM temizlenir, 240 karakterle kesilir', () => {
  const m = safeErrorMessage(new Error(`fail Bearer ya29.${'a'.repeat(90)} user@example.com -----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY----- ${'z'.repeat(400)}`));
  assert.equal(m.includes('ya29'), false); assert.equal(m.includes('user@example.com'), false); assert.equal(m.includes('abc'), false);
  assert.ok(m.length <= 240); assert.match(m, /Bearer \[redacted\]/);
});
await test('5.k) eski satıra room_uuid tembel atanır ve iki kez çağrılınca AYNI kalır', async () => {
  const db = freshDb(); await seed(db);
  db.prepare("UPDATE consultation_requests SET room_uuid = NULL WHERE id = 'c1'").run();
  const env = { DB: d1(db) };
  const r1 = row(db); const u1 = await ensureRoomUuid(env, r1);
  assert.match(u1, ROOM_UUID_RE);
  const u2 = await ensureRoomUuid(env, row(db)); assert.equal(u2, u1); assert.equal(row(db).room_uuid, u1);
});

// =================================================================================================
section('6) Yeniden deneme yolları — cron turu ve erişim anı (kelepçeli)');
// =================================================================================================
await test('6.a) retryPendingMeets: onaylı+Meet\'siz+gelecek satır denenir, geçmiş satır atlanır', async () => {
  _resetTokenCacheForTests();
  const db = freshDb(); await seed(db);
  db.prepare(`INSERT INTO consultation_requests (id, user_id, host_slug, requested_date, requested_time, price_try, status, created_at, updated_at, room_uuid)
              VALUES ('c-old', ?, 'kaan-corbaci', '2026-09-13', '18:00', 1500, 'approved', 0, 0, ?)`).run(BUYER, crypto.randomUUID());
  // c-old: SQL tarih süzgecinin İÇİNDE (dün) ama görüşmesi bitmiş (18:00+45dk < sahte "şimdi" 20:00) -> JS'te atlanır
  const g = fakeGoogle();
  const stats = await retryPendingMeets({ DB: d1(db), ...googleEnv() }, { fetchImpl: g.fetchImpl, now: () => START - 86400e3 });
  assert.equal(stats.ready, 1); assert.equal(stats.skipped, 1); assert.equal(g.calls.insert, 1);
  assert.equal(row(db).meet_status, 'ready'); assert.equal(row(db, 'c-old').meet_link, null);
});
await test('6.b) maybeRetryMeetOnAccess: 5 dk içinde en fazla 1 deneme (rate_limits kelepçesi)', async () => {
  _resetTokenCacheForTests();
  const db = freshDb(); await seed(db);
  const g = fakeGoogle({ insertFails: true });
  const env = { DB: d1(db), ...googleEnv() };
  await withClock(START - 60 * MIN, async () => {
    await maybeRetryMeetOnAccess(env, row(db), { fetchImpl: g.fetchImpl });
    await maybeRetryMeetOnAccess(env, row(db), { fetchImpl: g.fetchImpl });
  });
  assert.equal(g.calls.insert, 1); assert.equal(row(db).meet_status, 'failed');
});
await test('6.c) maybeRetryMeetOnAccess: görüşme bittiyse denenmez; Meet varsa dokunulmaz', async () => {
  const db = freshDb(); await seed(db);
  const g = fakeGoogle();
  const env = { DB: d1(db), ...googleEnv() };
  await withClock(START + 60 * MIN, async () => { await maybeRetryMeetOnAccess(env, row(db), { fetchImpl: g.fetchImpl }); });
  assert.equal(g.calls.insert, 0);
});
await test('6.d) resolveConsultationAccess: kimlikler satırdan türetilir (host = architects.claimed_by_user_id)', async () => {
  const db = freshDb(); await seed(db);
  const env = { DB: d1(db) };
  const r = row(db);
  assert.equal((await resolveConsultationAccess(env, { id: BUYER }, r)).isBuyer, true);
  assert.equal((await resolveConsultationAccess(env, { id: HOST }, r)).isHost, true);
  assert.equal((await resolveConsultationAccess(env, { id: OTHER }, r)).allowed, false);
  assert.equal((await resolveConsultationAccess(env, null, r)).allowed, false);
});

// =================================================================================================
section('7) Admin onay akışı — ödeme onayı -> Meet -> D1 -> bildirim; ikinci onay yeni Meet üretmez');
// =================================================================================================
{
  _resetTokenCacheForTests();
  const db = freshDb(); const uuid = await seed(db, { status: 'pending' });
  const g = fakeGoogle();
  const env = { DB: d1(db), ...googleEnv() };
  const realFetch = globalThis.fetch;
  globalThis.fetch = g.fetchImpl; // admin.js fetchImpl geçirmez — global fetch sahtelenir
  try {
    await test('7.a) PATCH approved -> status approved, Meet hazır, alıcıya onay + her iki tarafa Meet bildirimi', async () => {
      const r = req('/api/admin/consultations/c1', { user: ADMIN, method: 'PATCH', body: { status: 'approved' } });
      const res = await handleAdminRoute(r, env, new URL(r.url));
      const body = await res.json();
      assert.equal(res.status, 200); assert.equal(body.meet.status, 'ready');
      assert.equal(row(db).status, 'approved'); assert.equal(row(db).meet_status, 'ready'); assert.equal(g.calls.insert, 1);
      const n = notifs(db);
      assert.equal(n.filter((x) => x.type === 'consultation_payment_approved').length, 1);
      assert.equal(n.filter((x) => x.type === 'consultation_meet_ready').length, 2);
      assert.equal(n.find((x) => x.type === 'consultation_meet_ready').link, `/gorusme/${uuid}`);
    });
    await test('7.9) aynı onay ikinci kez -> reddedilir ("zaten işleme alınmış"), ikinci Meet YOK', async () => {
      const r = req('/api/admin/consultations/c1', { user: ADMIN, method: 'PATCH', body: { status: 'approved' } });
      const res = await handleAdminRoute(r, env, new URL(r.url));
      assert.equal(res.status, 400); assert.equal(g.calls.insert, 1);
    });
    await test('7.b) POST create-meet (admin) idempotent: Meet varken Google\'a gitmez, adres yanıtta yok', async () => {
      const r = req('/api/admin/consultations/c1/create-meet', { user: ADMIN, method: 'POST' });
      const res = await handleAdminRoute(r, env, new URL(r.url));
      const body = await res.json();
      assert.equal(res.status, 200); assert.equal(body.status, 'ready'); assert.equal('meetLink' in body, false); assert.equal(g.calls.insert, 1);
    });
    await test('7.c) create-meet admin DEĞİLSE 403, oturumsuz 401', async () => {
      let r = req('/api/admin/consultations/c1/create-meet', { user: BUYER, method: 'POST' });
      assert.equal((await handleAdminRoute(r, env, new URL(r.url))).status, 403);
      r = req('/api/admin/consultations/c1/create-meet', { method: 'POST' });
      assert.equal((await handleAdminRoute(r, env, new URL(r.url))).status, 401);
    });
    await test('7.d) Google hata verirken onay yine BAŞARILI kalır (500 yok, status approved, meet failed)', async () => {
      db.prepare(`INSERT INTO consultation_requests (id, user_id, host_slug, requested_date, requested_time, price_try, status, created_at, updated_at, contact_name, room_uuid)
                  VALUES ('c2', ?, 'kaan-corbaci', '2026-09-16', '19:00', 1500, 'pending', 0, 0, 'Mehmet', ?)`).run(BUYER, crypto.randomUUID());
      const bad = fakeGoogle({ insertFails: true }); globalThis.fetch = bad.fetchImpl;
      const r = req('/api/admin/consultations/c2', { user: ADMIN, method: 'PATCH', body: { status: 'approved' } });
      const res = await handleAdminRoute(r, env, new URL(r.url));
      const body = await res.json();
      assert.equal(res.status, 200); assert.equal(body.ok, true); assert.equal(body.meet.status, 'failed');
      assert.equal(row(db, 'c2').status, 'approved'); assert.equal(row(db, 'c2').meet_status, 'failed');
    });
  } finally { globalThis.fetch = realFetch; }
}

// =================================================================================================
section('8) Detay ucu — roomUrl yalnızca onaylı rezervasyonda, Meet adresi hiç yok');
// =================================================================================================
{
  const db = freshDb(); const uuid = await seed(db, { meet: { link: 'https://meet.google.com/xyz-abcd-efg', status: 'ready' } });
  const env = { DB: d1(db) };
  await test('8.a) GET /api/consultations/:id (alıcı) -> roomUrl=/gorusme/<uuid>, meetStatus=ready, meet adresi YOK', async () => {
    const r = req('/api/consultations/c1', { user: BUYER });
    const res = await handleConsultationsRoute(r, env, new URL(r.url)); const body = await res.json();
    assert.equal(res.status, 200); assert.equal(body.roomUrl, `/gorusme/${uuid}`); assert.equal(body.meetStatus, 'ready');
    assert.equal(JSON.stringify(body).includes('meet.google.com'), false);
  });
  await test('8.b) pending rezervasyonda roomUrl null', async () => {
    db.prepare("UPDATE consultation_requests SET status = 'pending' WHERE id = 'c1'").run();
    const r = req('/api/consultations/c1', { user: BUYER });
    const body = await (await handleConsultationsRoute(r, env, new URL(r.url))).json();
    assert.equal(body.roomUrl, null);
  });
}

// =================================================================================================
console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(`  - ${f.name}: ${f.message.split('\n')[0]}`); process.exit(1); }
