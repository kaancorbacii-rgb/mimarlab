import { json, errorJson, readJson, sessionCookieHeader, clearSessionCookieHeader, parseCookies, SESSION_COOKIE } from '../lib/http.js';
import { hashPassword, verifyPassword, newId, randomToken, sha256Hex } from '../lib/crypto.js';
import { createSession, destroySession, getSessionUser, publicUser } from '../lib/auth.js';
import { isSafeUrlValue } from '../lib/submissionTypes.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TTL_SECONDS = 60 * 60; // 1 saat
const PROFESSIONS = new Set(['mimar', 'ic_mimar', 'peyzaj_mimari', 'sehir_plancisi', 'restorator', 'diger']);
const DEPTS = new Set(['mimarlik', 'ic_mimarlik', 'peyzaj_mimarligi', 'sehir_bolge_planlama', 'restorasyon', 'diger']);

export async function handleAuthRoute(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/auth/signup' && method === 'POST') return signup(request, env);
  if (path === '/api/auth/login' && method === 'POST') return login(request, env);
  if (path === '/api/auth/logout' && method === 'POST') return logout(request, env);
  if (path === '/api/auth/me' && method === 'GET') return me(request, env);
  if (path === '/api/auth/change-password' && method === 'POST') return changePassword(request, env);
  if (path === '/api/auth/forgot-password' && method === 'POST') return forgotPassword(request, env);
  if (path === '/api/auth/reset-password' && method === 'POST') return resetPassword(request, env);
  return errorJson('Bulunamadı', 404);
}

async function signup(request, env) {
  const ip = clientIp(request);
  if (!(await checkRateLimit(env, 'signup', ip, 10, 60 * 60 * 1000))) {
    return errorJson('Çok fazla kayıt denemesi yaptın. Lütfen biraz sonra tekrar dene.', 429);
  }

  const body = await readJson(request);
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const name = (body.name || '').trim();
  const dob = body.dob || null;
  const school = (body.school || '').trim() || null;
  const dept = body.dept || null;
  const profession = body.profession || null;

  if (!name) return errorJson('Ad soyad gerekli.');
  if (!dob) return errorJson('Doğum tarihi gerekli.');
  if (!EMAIL_RE.test(email)) return errorJson('Geçerli bir e-posta adresi gir.');
  if (password.length < 8) return errorJson('Şifre en az 8 karakter olmalı.');
  if (body.password !== body.password_confirm) return errorJson('Şifreler eşleşmiyor.');
  if (profession && !PROFESSIONS.has(profession)) return errorJson('Geçersiz meslek.');
  if (dept && !DEPTS.has(dept)) return errorJson('Geçersiz bölüm.');
  if (!body.botCheck) return errorJson('Lütfen "Ben bir bot değilim" kutucuğunu işaretle.');
  if (!body.kvkkAccepted) return errorJson('Devam etmek için KVKK Aydınlatma Metni\'ni kabul etmelisin.');

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return errorJson('Bu e-posta ile zaten bir hesap var.', 409);

  const id = newId();
  const now = Date.now();
  const passwordHash = await hashPassword(password);
  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, name, dob, school, dept, profession, kvkk_accepted_at, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, email, passwordHash, name, dob, school, dept, profession, now, 'user', now).run();

  const { token, maxAge } = await createSession(env, id);
  const user = await env.DB.prepare(
    'SELECT id, email, name, dob, school, dept, photo_url, profession, role, created_at FROM users WHERE id = ?'
  ).bind(id).first();

  return json({ user: publicUser(user) }, 201, {
    'Set-Cookie': sessionCookieHeader(token, request, maxAge),
  });
}

// Gerçek bir kullanıcıya ait olmayan, sabit biçimli bir hash: e-posta bulunamadığında da
// verifyPassword'ü (PBKDF2 maliyetiyle) çalıştırıp yanıt süresini var/yok kullanıcı arasında
// eşitlemek için kullanılır — aksi halde yanıt süresi farkı, e-posta adresinin kayıtlı olup
// olmadığını (hesap numaralandırma) sızdırabilirdi.
const DUMMY_PASSWORD_HASH = `${'a'.repeat(32)}:${'b'.repeat(64)}`;

async function login(request, env) {
  const ip = clientIp(request);
  if (!(await checkRateLimit(env, 'login', ip, 20, 15 * 60 * 1000))) {
    return errorJson('Çok fazla giriş denemesi yaptın. Lütfen biraz sonra tekrar dene.', 429);
  }

  const body = await readJson(request);
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (email && !(await checkRateLimit(env, 'login-email', email, 10, 15 * 60 * 1000))) {
    return errorJson('Çok fazla giriş denemesi yaptın. Lütfen biraz sonra tekrar dene.', 429);
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  const passwordOk = await verifyPassword(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
  if (!user || !passwordOk) {
    return errorJson('E-posta veya şifre hatalı.', 401);
  }

  const { token, maxAge } = await createSession(env, user.id);
  return json({ user: publicUser(user) }, 200, {
    'Set-Cookie': sessionCookieHeader(token, request, maxAge),
  });
}

async function logout(request, env) {
  const cookies = parseCookies(request);
  await destroySession(env, cookies[SESSION_COOKIE]);
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookieHeader(request) });
}

async function me(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Oturum yok.', 401);
  return json({ user: publicUser(user) });
}

async function changePassword(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  const body = await readJson(request);
  const currentPassword = body.currentPassword || '';
  const newPassword = body.newPassword || '';
  if (newPassword.length < 8) return errorJson('Yeni şifre en az 8 karakter olmalı.');

  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    return errorJson('Mevcut şifre hatalı.', 401);
  }

  const passwordHash = await hashPassword(newPassword);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, user.id).run();
  return json({ ok: true });
}

// E-posta gönderim sağlayıcısı henüz bağlanmadı: RESEND_API_KEY tanımlıysa Resend üzerinden gönderir,
// tanımlı değilse (yerel geliştirme / henüz yapılandırılmamış prod) sessizce hiçbir şey yapmaz.
async function sendPasswordResetEmail(env, user, token, request) {
  if (!env.RESEND_API_KEY) return;
  const resetUrl = `${new URL(request.url).origin}/sifre-sifirla.html?token=${encodeURIComponent(token)}`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.RESEND_FROM || 'MİMARLAB <no-reply@mimarlab.com>',
        to: user.email,
        subject: 'MİMARLAB şifre sıfırlama',
        html: `<p>Merhaba ${user.name},</p><p>Şifreni sıfırlamak için <a href="${resetUrl}">bu bağlantıya</a> tıkla. Bağlantı 1 saat geçerlidir.</p><p>Bu talebi sen yapmadıysan bu e-postayı yok sayabilirsin.</p>`,
      }),
    });
  } catch (err) {
    console.error('sendPasswordResetEmail failed', err);
  }
}

async function forgotPassword(request, env) {
  const ip = clientIp(request);
  // E-posta var/yok bilgisini sızdırmamak için her durumda aynı genel yanıt döner.
  const generic = { ok: true, message: 'Bu e-posta ile bir hesap varsa, şifre sıfırlama bağlantısı gönderildi.' };
  if (!(await checkRateLimit(env, 'forgot-password', ip, 10, 60 * 60 * 1000))) return json(generic);

  const body = await readJson(request);
  const email = (body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json(generic);
  if (!(await checkRateLimit(env, 'forgot-password-email', email, 3, 60 * 60 * 1000))) return json(generic);

  const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE email = ?').bind(email).first();
  if (!user) return json(generic);

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, used) VALUES (?, ?, ?, ?, 0)'
  ).bind(tokenHash, user.id, now, now + RESET_TTL_SECONDS * 1000).run();

  await sendPasswordResetEmail(env, user, token, request);
  return json(generic);
}

async function resetPassword(request, env) {
  const body = await readJson(request);
  const token = body.token || '';
  const newPassword = body.newPassword || '';
  if (!token) return errorJson('Geçersiz ya da eksik bağlantı.');
  if (newPassword.length < 8) return errorJson('Yeni şifre en az 8 karakter olmalı.');

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    'SELECT user_id, expires_at, used FROM password_resets WHERE token_hash = ?'
  ).bind(tokenHash).first();
  if (!row || row.used || row.expires_at < Date.now()) {
    return errorJson('Bu sıfırlama bağlantısının süresi dolmuş ya da geçersiz.', 401);
  }

  const passwordHash = await hashPassword(newPassword);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, row.user_id).run();
  await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE token_hash = ?').bind(tokenHash).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.user_id).run();

  return json({ ok: true });
}

export async function handleProfileRoute(request, env, url) {
  if (url.pathname !== '/api/profile' || request.method !== 'PATCH') return errorJson('Bulunamadı', 404);
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  const body = await readJson(request);
  if ('photo_url' in body && !isSafeUrlValue(body.photo_url)) {
    return errorJson('Profil fotoğrafı bağlantısı geçersiz.');
  }
  const fields = ['name', 'dob', 'school', 'dept', 'photo_url'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (f in body) { updates.push(`${f} = ?`); values.push(body[f] || null); }
  }
  if (!updates.length) return errorJson('Güncellenecek bir şey yok.');
  values.push(user.id);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  const updated = await env.DB.prepare(
    'SELECT id, email, name, dob, school, dept, photo_url, profession, role, created_at FROM users WHERE id = ?'
  ).bind(user.id).first();
  return json({ user: publicUser(updated) });
}
