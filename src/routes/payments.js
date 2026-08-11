import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';
import { createNotification } from '../lib/notify.js';
import { initializeCheckoutForm, retrieveCheckoutForm, isIyzicoConfigured } from '../lib/iyzico.js';
import { getBadgePrice, normalizeTarget, verifyOfficeTargetOwnership } from './badges.js';
import { BADGE_RANK } from '../lib/badgeAccess.js';
import { invalidatePublicCache } from '../lib/publicCache.js';

const BADGE_RENTAL_MS = 30 * 24 * 60 * 60 * 1000; // rozetler aylık kiralanır (bkz. src/routes/badges.js)

export async function handlePaymentsRoute(request, env, url) {
  const path = url.pathname;
  if (path === '/api/payments/checkout' && request.method === 'POST') return startCheckout(request, env, url);
  if (path === '/api/payments/callback' && request.method === 'POST') return handleCallback(request, env, url);
  return errorJson('Bulunamadı', 404);
}

// TC Kimlik No resmi (11 haneli) checksum algoritması — kamuya açık, standart bir doğrulamadır.
function isValidTcKimlik(v) {
  if (!/^[1-9][0-9]{10}$/.test(v)) return false;
  const d = v.split('').map(Number);
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8];
  const evenSum = d[1] + d[3] + d[5] + d[7];
  const check10 = (((oddSum * 7) - evenSum) % 10 + 10) % 10;
  if (check10 !== d[9]) return false;
  const sumFirst10 = d.slice(0, 10).reduce((a, b) => a + b, 0);
  return (sumFirst10 % 10) === d[10];
}

function normalizeGsm(raw) {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('90')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return /^5\d{9}$/.test(digits) ? `+90${digits}` : null;
}

// Ödeme başlatma: kart bilgisi hiç bu uçtan geçmez — yalnızca iyzico'nun Checkout Form'unu
// başlatmak için gereken alıcı/ödeme bilgilerini iyzico'ya iletip dönen hosted sayfa adresini
// (paymentPageUrl) döneriz; kullanıcı kartını doğrudan iyzico'nun kendi sayfasında girer.
// TC Kimlik No/telefon/adres gibi kişisel veriler burada DB'ye yazılmaz, yalnızca iyzico'ya
// iletilir (veri minimizasyonu).
async function startCheckout(request, env, url) {
  if (!isIyzicoConfigured(env)) {
    return errorJson('Ödeme altyapısı şu anda kullanılamıyor. Lütfen daha sonra tekrar dene.', 503);
  }

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  const ip = clientIp(request);
  if (!(await checkRateLimit(env, 'payment-checkout', user.id, 8, 60 * 60 * 1000))) {
    return errorJson('Çok fazla deneme yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }
  if (!(await checkRateLimit(env, 'payment-checkout-ip', ip, 20, 60 * 60 * 1000))) {
    return errorJson('Çok fazla deneme yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const badgeType = body.badgeType;
  const target = normalizeTarget(body);
  if (!target) return errorJson('Geçersiz hedef.');
  // bkz. src/routes/badges.js#getBadgePrice — tutar İSTEMCİDEN asla alınmaz, targetType'a göre
  // (self/office) burada sunucu tarafında hesaplanır (kullanıcı isteği: "Backend checkout /
  // Iyzico tutarını da seçime göre doğrula").
  const price = getBadgePrice(badgeType, target.targetType);
  if (price === undefined) return errorJson('Geçersiz rozet türü.');
  if (!(await verifyOfficeTargetOwnership(env, user.id, target))) {
    return errorJson('Bu firmayı önce onaylı şekilde sahiplenmen gerekiyor.');
  }

  const name = (body.name || '').trim().slice(0, 100);
  const surname = (body.surname || '').trim().slice(0, 100);
  const identityNumber = (body.identityNumber || '').trim();
  const address = (body.address || '').trim().slice(0, 300);
  const city = (body.city || '').trim().slice(0, 80);
  const gsmNumber = normalizeGsm(body.phone);

  if (!name || !surname) return errorJson('Ad ve soyad gerekli.');
  if (!isValidTcKimlik(identityNumber)) return errorJson('Geçerli bir T.C. Kimlik Numarası gir.');
  if (!gsmNumber) return errorJson('Geçerli bir cep telefonu numarası gir.');
  if (!address || address.length < 8) return errorJson('Geçerli bir adres gir.');
  if (!city) return errorJson('Şehir gerekli.');

  const now = Date.now();
  const active = await env.DB.prepare(
    `SELECT id, badge_type FROM badge_requests WHERE user_id = ? AND target_type = ? AND target_key IS ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`
  ).bind(user.id, target.targetType, target.targetKey, now).first();
  // Daha yüksek bir kademeye hemen yükseltme yapılabilir; aynı ya da daha düşük bir kademe
  // seçilemez — bunun için mevcut rozetin süresinin dolması gerekir (bkz. satin-al.html "Zaten
  // aktif bir rozetin var" paneli, aynı kuralı istemci tarafında da uygular).
  if (active && (BADGE_RANK[badgeType] || 0) <= (BADGE_RANK[active.badge_type] || 0)) {
    return errorJson('Bu hedef için zaten aktif bir rozetin var. Aynı ya da daha düşük bir kademeye geçemezsin — bunun için mevcut rozetinin süresi dolmalı. Daha yüksek bir kademeye hemen yükseltebilirsin.');
  }

  // Bekleyen eski bir talep/ödeme denemesi varsa değiştir (kullanıcı kademe değiştirip yeniden deneyebilsin).
  await env.DB.prepare(
    `DELETE FROM badge_requests WHERE user_id = ? AND target_type = ? AND target_key IS ? AND status = 'pending'`
  ).bind(user.id, target.targetType, target.targetKey).run();

  const id = newId();
  await env.DB.prepare(
    `INSERT INTO badge_requests (id, user_id, badge_type, target_type, target_key, status, price_try, created_at, updated_at, payment_provider)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, 'iyzico')`
  ).bind(id, user.id, badgeType, target.targetType, target.targetKey, price, now, now).run();

  const priceStr = price.toFixed(2);
  const origin = new URL(request.url).origin;
  const fullName = `${name} ${surname}`;
  const payload = {
    locale: 'tr',
    conversationId: id,
    price: priceStr,
    paidPrice: priceStr,
    currency: 'TRY',
    paymentGroup: 'PRODUCT',
    enabledInstallments: [1],
    callbackUrl: `${origin}/api/payments/callback`,
    buyer: {
      id: user.id,
      name, surname,
      identityNumber,
      email: user.email,
      gsmNumber,
      registrationAddress: address,
      city,
      country: 'Turkey',
      ip,
    },
    billingAddress: { address, contactName: fullName, city, country: 'Turkey' },
    shippingAddress: { address, contactName: fullName, city, country: 'Turkey' },
    basketItems: [
      { id: badgeType, price: priceStr, name: `MİMARLAB ${badgeType} rozeti (aylık)`, category1: 'Üyelik', itemType: 'VIRTUAL' },
    ],
  };

  let result;
  try {
    result = await initializeCheckoutForm(env, payload);
  } catch (err) {
    console.error('iyzico initialize failed', err);
    await env.DB.prepare(`UPDATE badge_requests SET status='rejected', updated_at=? WHERE id=?`).bind(Date.now(), id).run();
    return errorJson('Ödeme başlatılamadı, lütfen tekrar dene.', 502);
  }

  if (result.status !== 'success' || !result.paymentPageUrl) {
    await env.DB.prepare(`UPDATE badge_requests SET status='rejected', updated_at=? WHERE id=?`).bind(Date.now(), id).run();
    return errorJson(result.errorMessage || 'Ödeme başlatılamadı, lütfen tekrar dene.', 502);
  }

  await env.DB.prepare(`UPDATE badge_requests SET payment_token = ? WHERE id = ?`).bind(result.token || null, id).run();

  return json({ paymentPageUrl: result.paymentPageUrl });
}

// iyzico, ödeme sonrası kullanıcının tarayıcısını bu uca (callbackUrl) bir POST ile yönlendirir;
// gövdede yalnızca "token" gelir. Ödemenin gerçekten başarılı olup olmadığı ASLA bu isteğin kendi
// içeriğinden değil, token ile iyzico'ya yapılan sunucu-sunucu "detail" doğrulamasından okunur —
// aksi halde biri callbackUrl'e rastgele bir token ile POST atıp rozet aktive edebilirdi.
// conversationId (bizim ürettiğimiz badge_requests.id) eşleşmesi, hangi talebin aktive
// edileceğini oturum/çerez olmadan güvenle belirler (Lax çerezler cross-site POST'ta gitmeyebilir).
async function handleCallback(request, env, url) {
  const origin = new URL(request.url).origin;
  const fail = () => Response.redirect(`${origin}/rozet-al?payment=failed`, 302);

  if (!isIyzicoConfigured(env)) return fail();

  const ip = clientIp(request);
  if (!(await checkRateLimit(env, 'payment-callback-ip', ip, 40, 60 * 60 * 1000))) return fail();

  let token = '';
  try {
    const form = await request.formData();
    token = (form.get('token') || '').toString();
  } catch {
    return fail();
  }
  if (!token) return fail();

  let result;
  try {
    result = await retrieveCheckoutForm(env, token);
  } catch (err) {
    console.error('iyzico retrieve failed', err);
    return fail();
  }

  const conversationId = result.conversationId;
  const row = conversationId
    ? await env.DB.prepare(`SELECT id, user_id, target_type, target_key FROM badge_requests WHERE id = ? AND status = 'pending'`).bind(conversationId).first()
    : null;
  if (!row) return fail();

  if (result.status === 'success' && result.paymentStatus === 'SUCCESS') {
    const now = Date.now();
    const expiresAt = now + BADGE_RENTAL_MS;
    // Bir kullanıcı aynı HEDEF için aynı anda yalnızca 1 aktif rozet tutabilir: bu bir yükseltme
    // ise (bkz. startCheckout'taki BADGE_RANK kontrolü), eski aktif/bekleyen kaydı geçersiz kıl —
    // aksi halde iki aktif satır birikirdi (bkz. src/routes/admin.js#handleBadgesAdmin aynı deseni
    // manuel onay yolunda uygular).
    await env.DB.prepare(
      `UPDATE badge_requests SET status='rejected', updated_at=? WHERE user_id = ? AND target_type = ? AND target_key IS ? AND id != ? AND status IN ('pending', 'active')`
    ).bind(now, row.user_id, row.target_type, row.target_key, row.id).run();
    await env.DB.prepare(
      `UPDATE badge_requests SET status='active', expires_at=?, payment_id=?, updated_at=? WHERE id=?`
    ).bind(expiresAt, result.paymentId || null, now, row.id).run();
    // gerçek bulgu: /api/public/badges artık önbelleklendiğinden (bkz. publicCache.js#
    // CACHEABLE_PATHS) burada temizlenmezse yeni aktive edilen rozet mimar/marka profil sayfasında
    // en fazla s-maxage (5dk) kadar görünmezdi — admin.js#handleBadgesAdmin'in manuel onay yolundaki
    // AYNI çağrının kart ödemesi karşılığı.
    await invalidatePublicCache(env);
    // gerçek bulgu: ödeme zaten doğrulanıp rozet zaten 'active' yapıldıktan SONRA çalışan bu
    // best-effort bildirim adımı sarmalanmamıştı — atarsa kullanıcı, parası çekilip rozeti aktive
    // olmuş olmasına rağmen çıplak 500 hatasına düşüyordu (bkz. src/index.js'teki genel catch).
    // sendContactNotificationEmail/sendPasswordResetEmail'deki AYNI "logla, yut" deseni.
    try {
      await createNotification(env, row.user_id, 'badge_active', 'Rozetin aktif edildi', 'Ödemen alındı, rozetin artık aktif.', '/hesabim');
    } catch (err) {
      console.error('badge_active notification failed', err);
    }
    return Response.redirect(`${origin}/hesabim?payment=success`, 302);
  }

  await env.DB.prepare(`UPDATE badge_requests SET status='rejected', updated_at=? WHERE id=?`).bind(Date.now(), row.id).run();
  return fail();
}
