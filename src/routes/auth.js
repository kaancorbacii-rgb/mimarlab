import { json, errorJson, readJson, sessionCookieHeader, clearSessionCookieHeader, parseCookies, sessionCookieName } from '../lib/http.js';
import { hashPassword, verifyPassword, newId, randomToken, sha256Hex } from '../lib/crypto.js';
import { createSession, destroySession, getSessionUser, publicUser } from '../lib/auth.js';
import { isSafeUrlValue, isInvalidSchoolValue } from '../lib/submissionTypes.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';
import {
  isGoogleConfigured, buildGoogleAuthUrl, handleGoogleCallback,
  isLinkedInConfigured, buildLinkedInAuthUrl, handleLinkedInCallback,
} from '../lib/oauth.js';
import { cascadeDeleteAccount } from '../lib/cascadeDelete.js';
import { createNotification } from '../lib/notify.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TTL_SECONDS = 60 * 60; // 1 saat
// 'fotografci' — kullanıcı isteği (2026-09-01 madde 6): fotoğrafçılar da site içinde profili olan
// kişilerdir (bkz. migrations/0080_project_photographers.sql başlığındaki gerekçe), bu yüzden meslek
// listesine eklendi. 'muhendis' — kullanıcı isteği (2026-09-01, "tüm meslek sorulan yerlere Mühendis
// seçeneğini de ekle; Tasarımcı seçeneğinden sonra gelsin").
// BU LİSTENİN BİLİNÇLİ KOPYALARI (biri değişirse HEPSİ birlikte güncellenmeli):
//   uye-ol.html                              — üye ol formundaki onay kutuları
//   js/components/auth-modal.js#PROFESSION_LABELS — Hesabım > Profili Düzenle
//   kisi-ekle.html#MESLEK_OPTIONS / #PROFESSION_LABELS
//   kisi.html#PROFESSION_ORDER               — /kisi "Meslek" filtresinin sırası
//   admin.html#UD_PROFESSION_LABELS          — admin kullanıcı detayı
export const PROFESSIONS = new Set(['mimar', 'ic_mimar', 'peyzaj_mimari', 'sehir_plancisi', 'restorator', 'tasarimci', 'muhendis', 'fotografci', 'ogrenci', 'diger']);
// users.profession artık BİRDEN ÇOK meslek taşıyabilir (kullanıcı isteği, 2026-09-01 madde 6: "bir
// kullanıcı siteye üye olurken ya da profilini düzenlerken artık birden fazla meslek seçebilsin") —
// biçim: virgülle ayrılmış slug listesi ("mimar,fotografci"). Ayrı bir user_professions tablosu
// AÇILMADI: alan yalnızca gösterim amaçlı (hiçbir sorgu profession'a göre JOIN/filtre yapmıyor),
// bir tablo eklemek okuma yollarının tamamını N+1'e sokardı. TEK meslekli eski satırlar bu biçimin
// zaten geçerli bir örneği olduğundan hiçbir veri taşıması gerekmez.
const MAX_PROFESSIONS = 4;
export function normalizeProfessions(value) {
  if (typeof value !== 'string') return { ok: true, value: null };
  const slugs = [...new Set(value.split(',').map(s => s.trim()).filter(Boolean))];
  if (!slugs.length) return { ok: true, value: null };
  if (slugs.length > MAX_PROFESSIONS) return { ok: false };
  if (slugs.some(s => !PROFESSIONS.has(s))) return { ok: false };
  return { ok: true, value: slugs.join(',') };
}
const DEPTS = new Set(['mimarlik', 'ic_mimarlik', 'peyzaj_mimarligi', 'sehir_bolge_planlama', 'restorasyon', 'diger']);
// kisi-ekle.html'deki POZISYON_OPTIONS ile BİREBİR aynı (bkz. kullanıcı isteği: "Mimar ekle sayfası
// ile profilini düzenle bölümünü tam bir senkronizasyon haline getir") — 'Ortak'/'Ekip Lideri' bu
// listede eskiden yoktu, hesap profili formu o formdaki tüm seçenekleri sunmadığından.
export const POSITIONS = new Set(['Kurucu', 'Kurucu Ortak', 'Ortak', 'Ekip Lideri', 'Ekip Üyesi', 'Akademisyen', 'Serbest Çalışan', 'Öğrenci', 'Emekli', 'İşsiz']);

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
  if (path === '/api/auth/google/start' && method === 'GET') return oauthStart(request, env, url, 'google');
  if (path === '/api/auth/google/callback' && method === 'GET') return oauthCallback(request, env, url, 'google');
  if (path === '/api/auth/linkedin/start' && method === 'GET') return oauthStart(request, env, url, 'linkedin');
  if (path === '/api/auth/linkedin/callback' && method === 'GET') return oauthCallback(request, env, url, 'linkedin');
  return errorJson('Bulunamadı', 404);
}

// "next" yalnızca SİTE İÇİ göreli bir yol olabilir (bkz. kullanıcı isteği: açık yönlendirme/open
// redirect'e izin verilmez) — "//evil.com" (protokole göreli) ve "https://..." gibi mutlak/harici
// hedefler reddedilir, geçersizse güvenli varsayılana (hesabim.html) düşülür.
function safeNextPath(raw) {
  const next = (raw || '').trim();
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('://')) return '/hesabim.html';
  return next;
}

function redirectResponse(location, extraHeaders) {
  return new Response(null, { status: 302, headers: { Location: location, ...extraHeaders } });
}

async function oauthStart(request, env, url, provider) {
  const configured = provider === 'google' ? isGoogleConfigured(env) : isLinkedInConfigured(env);
  if (!configured) {
    return redirectResponse(`/giris-yap.html?oauth_error=not_configured`);
  }
  const next = safeNextPath(url.searchParams.get('next'));
  const authUrl = provider === 'google'
    ? await buildGoogleAuthUrl(request, env, next)
    : await buildLinkedInAuthUrl(request, env, next);
  return redirectResponse(authUrl);
}

// Google/LinkedIn callback: e-posta sağlayıcı tarafından doğrulanmış sayıldığından (bkz.
// handleGoogleCallback/handleLinkedInCallback'teki email_verified kontrolü), aynı e-postayla var
// olan bir hesap varsa doğrudan oturum açılır (hesap eşleştirme = e-posta) — yoksa `users`
// tablosuna (bkz. kullanıcı isteği: şemaya DOKUNULMADAN) mevcut sütunlarla yeni bir satır eklenir.
// Kullanıcı şifresini asla girmediğinden password_hash rastgele/kullanılamaz bir değerle NOT NULL
// kısıtını karşılar — bu kullanıcı ileride yalnızca sosyal girişle oturum açabilir (bkz. login()'in
// DUMMY_PASSWORD_HASH ile eşleşme olasılığı olmadığından güvenlik açığı oluşturmaz).
async function upsertOAuthUser(env, { email, name, photoUrl }) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  let user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(normalizedEmail).first();
  if (!user) {
    const id = newId();
    const now = Date.now();
    const passwordHash = await hashPassword(randomToken());
    const displayName = (name || '').trim() || normalizedEmail.split('@')[0];
    await env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, name, photo_url, kvkk_accepted_at, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, normalizedEmail, passwordHash, displayName, photoUrl || null, now, 'user', now).run();
    user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  } else {
    // Mevcut hesap sosyal girişle eşleşti (bkz. yukarıdaki e-posta eşleştirme yorumu) — profilinde
    // ad soyad veya fotoğraf eksikse sağlayıcıdan (Google/LinkedIn) gelen verilerle otomatik doldurulur;
    // dolu alanların ÜZERİNE YAZILMAZ (kullanıcı isteği: yalnızca boş alanlar otomatik doldurulsun).
    const trimmedName = (name || '').trim();
    const updates = [];
    const values = [];
    if (!user.name && trimmedName) { updates.push('name = ?'); values.push(trimmedName); }
    if (!user.photo_url && photoUrl) { updates.push('photo_url = ?'); values.push(photoUrl); }
    if (updates.length) {
      values.push(user.id);
      await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
      user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    }
  }
  return user;
}

async function oauthCallback(request, env, url, provider) {
  const configured = provider === 'google' ? isGoogleConfigured(env) : isLinkedInConfigured(env);
  if (!configured) return redirectResponse('/giris-yap.html?oauth_error=not_configured');

  // gerçek bulgu: handleGoogleCallback/handleLinkedInCallback içindeki token-exchange/userinfo
  // fetch() çağrıları (bkz. src/lib/oauth.js) try/catch içinde değildi — HTTP durumu kötü dönerse
  // zaten { error: '...' } ile nazikçe ele alınıyor, ama Workers'ta gerçekleşebilecek bir ağ
  // seviyesi istisna (DNS/timeout/geçici kesinti) src/index.js'teki genel catch'e düşüp kullanıcıyı
  // Google/LinkedIn'in onay ekranından döndüğünde çıplak bir 500 JSON'una bırakıyordu — bu
  // fonksiyondaki HER DİĞER hata yolu zaten aynı oauth_error yönlendirme desenini kullanıyor,
  // burası da aynı desene alınır.
  let result;
  try {
    result = provider === 'google'
      ? await handleGoogleCallback(request, env, url)
      : await handleLinkedInCallback(request, env, url);
  } catch (err) {
    console.error(`oauthCallback(${provider}) failed`, err);
    return redirectResponse('/giris-yap.html?oauth_error=network_error');
  }
  if (result.error) return redirectResponse(`/giris-yap.html?oauth_error=${encodeURIComponent(result.error)}`);

  const ip = clientIp(request);
  if (!(await checkRateLimit(env, `oauth-${provider}`, ip, 20, 15 * 60 * 1000))) {
    return redirectResponse('/giris-yap.html?oauth_error=rate_limited');
  }

  try {
    const user = await upsertOAuthUser(env, result.profile);
    const { token, maxAge } = await createSession(env, user.id);
    return redirectResponse(safeNextPath(result.next), { 'Set-Cookie': sessionCookieHeader(token, request, maxAge) });
  } catch (err) {
    console.error(`oauthCallback(${provider}) session creation failed`, err);
    return redirectResponse('/giris-yap.html?oauth_error=network_error');
  }
}


// architects tablosunda Türkçe-duyarlı TAM ad eşleşmesi arar. SQL LIKE/COLLATE NOCASE yalnızca
// ASCII harfleri katladığından (bkz. src/routes/office.js#trLower'daki AYNI gerçek bulgu) eşleştirme
// JS tarafında yapılır; tablo birkaç yüz satır olduğundan bu tam tarama ucuzdur ve
// /api/public/check-name'in kullandığı normalize ile BİREBİR aynı sonucu verir.
function foldTrName(v) {
  return (v || '')
    .replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ')
    .replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function findArchitectByFoldedName(env, name) {
  const target = foldTrName(name);
  if (!target) return null;
  const { results } = await env.DB.prepare(
    `SELECT id, name, slug, claimed_by_user_id FROM architects WHERE deleted_at IS NULL`
  ).all();
  return results.find(r => foldTrName(r.name) === target) || null;
}

async function signup(request, env) {
  const ip = clientIp(request);
  if (!(await checkRateLimit(env, 'signup', ip, 10, 60 * 60 * 1000))) {
    return errorJson('Çok fazla kayıt denemesi yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const name = (body.name || '').trim();
  const dob = body.dob || null;
  const school = (body.school || '').trim() || null;
  const dept = body.dept || null;
  // bkz. normalizeProfessions — birden çok meslek virgülle ayrılmış tek bir string olarak gelir.
  const professionResult = normalizeProfessions(body.profession);
  const profession = professionResult.value;

  if (!name) return errorJson('Ad soyad gerekli.');
  if (!dob) return errorJson('Doğum tarihi gerekli.');
  if (!EMAIL_RE.test(email)) return errorJson('Geçerli bir e-posta adresi gir.');
  if (password.length < 8) return errorJson('Şifre en az 8 karakter olmalı.');
  if (body.password !== body.password_confirm) return errorJson('Şifreler eşleşmiyor.');
  if (!professionResult.ok) return errorJson('Geçersiz meslek.');
  if (dept && !DEPTS.has(dept)) return errorJson('Geçersiz bölüm.');
  if (isInvalidSchoolValue(school)) return errorJson('Geçerli bir üniversite adı gir (kısaltma kullanma).');
  if (!body.botCheck) return errorJson('Lütfen "Ben bir bot değilim" kutucuğunu işaretle.');
  if (!body.kvkkAccepted) return errorJson('Devam etmek için KVKK Aydınlatma Metni\'ni kabul etmelisin.');

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return errorJson('Bu e-posta ile zaten bir hesap var.', 409);

  // Kullanıcı isteği (2026-09-02): "Kişi sayfasında yer alan halihazırdaki bir ad soyadla siteye
  // tekrar üye olunamasın." Kişi dizinindeki (architects) bir adla AYNI ada sahip yeni hesap
  // açılamaz — aksi halde iki farklı kişi sitede aynı isimle görünür ve künye eşleştirmesi
  // (isim bazlı, bkz. proje belleği "duplicate name key limitation") belirsizleşir.
  // Karşılaştırma foldTrName ile Türkçe-duyarlı yapılır ("İnci" ile "inci" aynı sayılır);
  // aynı normalize karşılaştırma /api/public/check-name'de de kullanılıyor, iki taraf tutarlı.
  const nameClash = await findArchitectByFoldedName(env, name);
  if (nameClash) {
    return errorJson('Bu ad soyad Kişi sayfasında zaten kayıtlı. Bu profil sanaysa kayıt olduktan sonra "Bu profil bana ait" ile sahiplenebilirsin.', 409);
  }

  const id = newId();
  const now = Date.now();
  const passwordHash = await hashPassword(password);
  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, name, dob, school, dept, profession, kvkk_accepted_at, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, email, passwordHash, name, dob, school, dept, profession, now, 'user', now).run();

  // Kullanıcı isteği (2026-09-02 madde 4): kayıt olur olmaz kişiyi dizine davet eden bir bildirim.
  // link=/hesabim?dizin=1 — hesabim (Hesabım pop-up'ı) bu parametreyi görünce evet/hayır sorusunu
  // açar (bkz. js/components/auth-modal.js#maybeOpenDirectoryPrompt). createNotification hataları
  // kendi içinde yutar, yani bildirim yazılamazsa kayıt akışı ETKİLENMEZ.
  await createNotification(
    env, id, 'directory_invite',
    'Kişi sayfasında diğer profesyonellerle birlikte yer almak ister misin?',
    'Profilini tamamlayıp kişi dizininde görünmeyi seçebilirsin.',
    '/hesabim?dizin=1',
  );

  const { token, maxAge } = await createSession(env, id);
  const user = await env.DB.prepare(
    'SELECT id, email, name, dob, school, dept, photo_url, profession, position, awards, about, social_links, role, created_at FROM users WHERE id = ?'
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
    return errorJson('Çok fazla giriş denemesi yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '900' });
  }

  const body = await readJson(request);
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (email && !(await checkRateLimit(env, 'login-email', email, 10, 15 * 60 * 1000))) {
    return errorJson('Çok fazla giriş denemesi yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '900' });
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
  await destroySession(env, cookies[sessionCookieName(request)]);
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

  // gerçek bulgu: mevcut şifre denemesinde login'deki gibi bir hız sınırı yoktu — çalınmış/paylaşılan
  // bir oturum çerezine sahip biri currentPassword'ü deneme-yanılmayla bulmaya çalışabilirdi.
  // login-email limitiyle AYNI oran (15dk'da 10 deneme), burada e-posta yerine oturumdaki user.id anahtar.
  if (!(await checkRateLimit(env, 'change-password', user.id, 10, 15 * 60 * 1000))) {
    return errorJson('Çok fazla deneme yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '900' });
  }

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

  // gerçek bulgu: resetPassword (unutulan şifre akışı) şifre değişince TÜM oturumları kapatıyor, ama
  // oturum-içi bu akışta o desen hiç uygulanmıyordu — çalınmış/paylaşılan bir çerezle giriş yapmış bir
  // saldırganın oturumu, meşru kullanıcı şifresini değiştirdikten SONRA bile geçerli kalmaya devam
  // ederdi. resetPassword'ün aksine burada isteği yapan kendi oturumu (mevcut token) hariç tutulur —
  // kullanıcı kendi şifresini değiştirdiğinde beklenmedik şekilde çıkışa zorlanmamalı.
  const currentToken = parseCookies(request)[sessionCookieName(request)];
  const currentTokenHash = currentToken ? await sha256Hex(currentToken) : null;
  if (currentTokenHash) {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(user.id, currentTokenHash).run();
  } else {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
  }

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
  const ip = clientIp(request);
  // denetim bulgusu: bu uç, kardeşleri (login/forgot-password/change-password) aksine rate limit'siz
  // idi — token 32-byte rastgele + sha256 hash olduğundan kaba kuvvetle kırılması pratikte imkansız,
  // ama savunma derinliği için diğer hassas auth uçlarıyla aynı desene getirildi.
  if (!(await checkRateLimit(env, 'reset-password', ip, 10, 15 * 60 * 1000))) {
    return errorJson('Çok fazla deneme yapıldı, lütfen biraz sonra tekrar dene.', 429);
  }

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

// Profil alanlarını doğrulayıp günceller — hem kullanıcının kendi PATCH /api/profile isteğinde
// (aşağıda) hem de admin'in bir üyenin hesabını Admin Paneli > Üyeler'den düzenlemesinde (bkz.
// src/routes/admin.js#updateUserAdmin, kullanıcı isteği: "adminin üye hesaplarını görme ve
// düzenleme yetkisi olsun") AYNI doğrulama/kaydetme mantığı kullanılsın diye ayrı bir fonksiyona
// çıkarıldı — iki çağıran arasındaki tek fark hangi user id'nin güncellendiği.
export async function updateUserProfileFields(env, userId, body) {
  if ('photo_url' in body && !isSafeUrlValue(body.photo_url)) {
    return { error: 'Profil fotoğrafı bağlantısı geçersiz.' };
  }
  // bkz. normalizeProfessions — çoklu meslek (virgülle ayrılmış slug'lar). Doğrulanmış/normalize
  // edilmiş değer aşağıdaki genel `fields` döngüsünde yazılabilsin diye body'e geri yazılır.
  if ('profession' in body) {
    const result = normalizeProfessions(body.profession);
    if (!result.ok) return { error: 'Geçersiz meslek.' };
    body.profession = result.value;
  }
  if ('position' in body && body.position && !POSITIONS.has(body.position)) {
    return { error: 'Geçersiz pozisyon.' };
  }
  if ('school' in body && isInvalidSchoolValue(body.school)) {
    return { error: 'Geçerli bir üniversite adı gir (kısaltma kullanma).' };
  }
  // Kullanıcı isteği (2026-09-02): "...ya da profilini düzenle deyip aynı ad soyad seçilemesin."
  // signup'taki AYNI kontrol (bkz. findArchitectByFoldedName). KENDİ sahiplendiği profil hariç
  // tutulur — kullanıcı zaten bir mimar profiline sahipse adını o profille aynı bırakabilmeli,
  // aksi halde kendi profilini "çakışma" sayıp her kaydetmeyi engellerdik.
  if ('name' in body && body.name) {
    const clash = await findArchitectByFoldedName(env, body.name);
    if (clash && clash.claimed_by_user_id !== userId) {
      return { error: 'Bu ad soyad Kişi sayfasında zaten kayıtlı. Farklı bir ad soyad gir.' };
    }
  }
  // awards/social_links — bkz. kullanıcı isteği: "Mimar profiliyle henüz eşleşmemiş kullanıcılar da
  // ödül, sosyal medya ve açıklama ekleyebilsinler" — kisi-ekle.html'in aynı alanlarıyla AYNI JSON
  // dizi kalıbı (bkz. src/lib/submissionTypes.js#SUBMISSION_TYPES.architects). social_links'teki her
  // URL, photo_url ile AYNI isSafeUrlValue kontrolünden geçirilir (mevcut submission pipeline'ından
  // daha sıkı — orada bu alan hiç doğrulanmıyor, burada baştan güvenli tutulur).
  const fields = ['name', 'dob', 'school', 'dept', 'photo_url', 'profession', 'position', 'about'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (f in body) { updates.push(`${f} = ?`); values.push(body[f] || null); }
  }
  if ('awards' in body) {
    const awards = Array.isArray(body.awards) ? body.awards.filter(a => typeof a === 'string' && a) : [];
    updates.push('awards = ?'); values.push(JSON.stringify(awards));
  }
  if ('social_links' in body) {
    const links = Array.isArray(body.social_links)
      ? body.social_links.filter(s => s && typeof s.platform === 'string' && typeof s.url === 'string' && s.url && isSafeUrlValue(s.url))
        .map(s => ({ platform: s.platform, url: s.url }))
      : [];
    updates.push('social_links = ?'); values.push(JSON.stringify(links));
  }
  if (!updates.length) return { error: 'Güncellenecek bir şey yok.' };
  values.push(userId);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  const updated = await env.DB.prepare(
    'SELECT id, email, name, dob, school, dept, photo_url, profession, position, awards, about, social_links, role, created_at FROM users WHERE id = ?'
  ).bind(userId).first();
  return { user: publicUser(updated) };
}

export async function handleProfileRoute(request, env, url) {
  if (url.pathname !== '/api/profile' || request.method !== 'PATCH') return errorJson('Bulunamadı', 404);
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  const body = await readJson(request);
  const result = await updateUserProfileFields(env, user.id, body);
  if (result.error) return errorJson(result.error);
  return json({ user: result.user });
}

// DELETE /api/account — "Hesabımı Sil" (bkz. hesabim.html). Kullanıcının kendi isteğiyle hesabını
// ve bağlı kişisel verilerini kalıcı olarak siler (bkz. cascadeDeleteAccount), tüm oturumlarını
// (sadece isteği yapan tarayıcı değil, DELETE FROM sessions WHERE user_id=... ile HEPSİ) sonlandırır.
export async function handleAccountDeleteRoute(request, env, url) {
  if (url.pathname !== '/api/account' || request.method !== 'DELETE') return errorJson('Bulunamadı', 404);
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  await cascadeDeleteAccount(env, user.id);
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookieHeader(request) });
}
