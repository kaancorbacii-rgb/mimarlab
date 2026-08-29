import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { BADGE_RANK } from '../lib/badgeAccess.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';

// Fiyatlar TL/ay cinsinden (aylık abonelik); ödeme yöntemi havale/EFT (bkz. satin-al.html) —
// kredi/banka kartı (iyzico, bkz. src/routes/payments.js) henüz UI'da aktif değil. Havale
// talepleri burada 'pending' oluşturulur, admin havaleyi banka ekstresinden doğrulayıp panelden
// elle onaylar (bkz. src/routes/admin.js#handleBadgesAdmin). İki kademe satın alınabilir: verified
// (Doğrulanmış Üye), gold (Altın Üye) — bkz. badge-shared.js#BADGE_LABELS ile aynı anahtarlar.
// 'destekci' (Destekçi) ve 'platinum' (Elmas Üye) kullanıcı isteğiyle 2026-08-29'da satın alınabilir
// olmaktan çıkarıldı (bkz. BADGE_PRICES'ta artık yer almamaları — getBadgePrice bu tipler için
// undefined döner, createBadgeRequest bunu 'Geçersiz rozet türü.' olarak reddeder); eski durumdaki
// aktif kayıtlar aynı tarihte elle 'rejected' yapıldı (bkz. iade-et.html/admin.html — hâlâ o eski
// siparişleri ETİKETLEMEK için destekci/platinum'u BİLEREK içeriyorlar, ama artık hiçbiri satın
// alınamaz).
//
// BADGE_PRICES aşağıdaki "Bir firmam için" (targetType='office') tabanı — "Kendim için"
// (targetType='self') seçildiğinde her kademe SELF_DISCOUNT_TRY kadar ucuz (bkz. kullanıcı
// isteği). Fiyat İSTEMCİDEN asla alınmaz/güvenilmez: hem havale (createBadgeRequest) hem iyzico
// (src/routes/payments.js#startCheckout) targetType'ı buradaki getBadgePrice() ile aynı tek
// noktadan hesaplar.
export const BADGE_PRICES = {
  verified: 99.90,
  gold: 139.90,
};
const SELF_DISCOUNT_TRY = 60;

export function getBadgePrice(badgeType, targetType) {
  const officePrice = BADGE_PRICES[badgeType];
  if (officePrice === undefined) return undefined;
  if (targetType !== 'self') return officePrice;
  // bkz. yukarıdaki yorum — kayan nokta artığını (ör. 79.90 - 60 = 19.900000000000006) önler.
  return Math.round((officePrice - SELF_DISCOUNT_TRY) * 100) / 100;
}

const BADGE_RENTAL_MS = 30 * 24 * 60 * 60 * 1000; // rozetler aylık kiralanır

export async function handleBadgesRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "badges", maybe "mine"]

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'POST') return createBadgeRequest(request, env, user);
  if (segments.length === 3 && segments[2] === 'mine' && request.method === 'GET') return listMyBadges(env, user);
  return errorJson('Bulunamadı', 404);
}

// Bir kişi, aynı hedef (target_type+target_key) için aynı anda yalnızca 1 rozet tutabilir:
// hâlihazırda süresi dolmamış aktif bir rozeti o hedef için varsa yeni talep reddedilir; bekleyen
// (henüz onaylanmamış) bir talebi o hedef için varsa yeni seçimiyle değiştirilir. Farklı hedefler
// (kendisi + her ayrı marka) birbirinden bağımsızdır — kendisi için rozet alması bir markaya
// otomatik yansımaz, bkz. handlePublicBadges.
export function normalizeTarget(body) {
  const targetType = body.targetType === 'office' ? 'office' : 'self';
  const targetKey = targetType === 'office' ? (body.targetKey || '').trim() : null;
  if (targetType === 'office' && !targetKey) return null;
  return { targetType, targetKey };
}

// 'office' hedefli bir rozet, satın alan kullanıcının o markayı zaten onaylı şekilde
// sahiplendiğini doğrular — aksi halde handlePublicBadges'te zaten hiçbir yere görünmeyecek
// (ölü) bir satın alma yapılmış olurdu, bkz. src/routes/payments.js#startCheckout aynı kontrolü kullanır.
export async function verifyOfficeTargetOwnership(env, userId, target) {
  if (target.targetType !== 'office') return true;
  const row = await env.DB.prepare(
    `SELECT id FROM profile_claims WHERE user_id = ? AND profile_type = 'office' AND profile_key = ? AND status = 'approved'`
  ).bind(userId, target.targetKey).first();
  return !!row;
}

async function createBadgeRequest(request, env, user) {
  // gerçek bulgu: bu havale/EFT yolunda hiç hız sınırı yoktu — aynı özelliğin kart ödemesi
  // karşılığı (payments.js#startCheckout) hem kullanıcı hem IP bazlı limit uyguluyor, buradaki
  // DELETE+INSERT pending döngüsü (bkz. aşağısı) sınırsız tekrarlanabiliyordu. AYNI oranlar.
  if (!(await checkRateLimit(env, 'badge-request', user.id, 8, 60 * 60 * 1000))) {
    return errorJson('Çok fazla talep gönderdin. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }
  if (!(await checkRateLimit(env, 'badge-request-ip', clientIp(request), 20, 60 * 60 * 1000))) {
    return errorJson('Çok fazla talep gönderdin. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const badgeType = body.badgeType;
  const target = normalizeTarget(body);
  if (!target) return errorJson('Geçersiz hedef.');
  const price = getBadgePrice(badgeType, target.targetType);
  if (price === undefined) return errorJson('Geçersiz rozet türü.');
  if (!(await verifyOfficeTargetOwnership(env, user.id, target))) {
    return errorJson('Bu firmayı önce onaylı şekilde sahiplenmen gerekiyor.');
  }

  const now = Date.now();
  const active = await env.DB.prepare(
    `SELECT id, badge_type FROM badge_requests WHERE user_id = ? AND target_type = ? AND target_key IS ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`
  ).bind(user.id, target.targetType, target.targetKey, now).first();
  // bkz. src/routes/payments.js#startCheckout — aynı yükseltme/düşürme kuralı.
  if (active && (BADGE_RANK[badgeType] || 0) <= (BADGE_RANK[active.badge_type] || 0)) {
    return errorJson('Bu hedef için zaten aktif bir rozetin var. Aynı ya da daha düşük bir kademeye geçemezsin — bunun için mevcut rozetinin süresi dolmalı. Daha yüksek bir kademeye hemen yükseltebilirsin.');
  }

  await env.DB.prepare(
    `DELETE FROM badge_requests WHERE user_id = ? AND target_type = ? AND target_key IS ? AND status = 'pending'`
  ).bind(user.id, target.targetType, target.targetKey).run();

  const id = newId();
  await env.DB.prepare(
    "INSERT INTO badge_requests (id, user_id, badge_type, target_type, target_key, status, price_try, created_at, updated_at, payment_provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'havale')"
  ).bind(id, user.id, badgeType, target.targetType, target.targetKey, 'pending', price, now, now).run();

  return json({ id, status: 'pending' }, 201);
}

async function listMyBadges(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT id, badge_type, target_type, target_key, status, price_try, expires_at, created_at FROM badge_requests WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();
  return json({ items: results });
}

// GET /api/public/badges — auth gerektirmez. 'self' hedefli rozetler yalnızca o kişinin onaylı
// ARCHITECT profil talebine bağlanır; 'office' hedefli rozetler yalnızca target_key'in birebir
// eşleştiği, o kişinin onaylı OFFICE profil talebine bağlanır — bir kişinin kendisi için aldığı
// rozet artık bir markaya sızmaz (ve tersi), bkz. kullanıcı talebi. Kişisel rozetlerin
// yorum/gönderi yanında gösterimi ayrı bir mekanizma (bkz. src/routes/comments.js, public.js),
// bu uç yalnızca mimar/marka PROFİL sayfalarını besler. 'destekci' kasıtlı olarak dışarıda
// bırakılır — o kademe herhangi bir hak ya da görünür rozet vermez, yalnızca destek amaçlıdır.
// gecikme geçmişi (2026-08-16): bu uç bir ara publicCache.js#CACHEABLE_PATHS'teydi (caches.default
// edge önbelleği + invalidatePublicCache() ile temizleniyordu) — ama o önbellek PoP-başınadır,
// admin farklı bir PoP'tan hemen sonra kontrol ederse en fazla s-maxage kadar eski rozeti görmeye
// devam edebiliyordu (kullanıcı isteği: "hangi rozeti verirsem vereyim HEMEN her rozet alanında
// gözükmesi gerekiyor" bunu kabul etmiyor). Artık publicCache.js#BADGE_NO_CACHE_HEADERS ile
// bilerek edge/tarayıcı önbelleğinin DIŞINDA tutuluyor (cachedPublicJson içinde pathname'e göre
// zorlanıyor) — sorgu iki küçük indeksli JOIN'den ibaret olduğundan önbelleksiz her istekte
// çalıştırılabilecek kadar hafif, stampede koruması yine withSingleFlight ile sağlanıyor.
export async function handlePublicBadges(request, env, url) {
  return cachedPublicJson(request, env, url.pathname, () => computeBadgesPayload(env));
}

async function computeBadgesPayload(env) {
  const now = Date.now();
  const [{ results }, { results: adminResults }] = await Promise.all([
    env.DB.prepare(
      `SELECT c.profile_type, c.profile_key, b.badge_type
       FROM profile_claims c
       JOIN badge_requests b ON b.user_id = c.user_id AND b.status = 'active' AND (b.expires_at IS NULL OR b.expires_at > ?) AND b.badge_type != 'destekci'
         AND ((b.target_type = 'self' AND c.profile_type = 'architect') OR (b.target_type = 'office' AND c.profile_type = 'office' AND b.target_key = c.profile_key))
       WHERE c.status = 'approved'`
    ).bind(now).all(),
    // Admin'in sahiplenme/satın alma olmadan doğrudan verdiği rozetler (bkz. schema.sql#admin_badges) —
    // yukarıdaki satın alınan rozetlerle AYNI çıktı şekline birleştirilir, statik/sahipsiz bir
    // profile bile uygulanabilir (kullanıcı isteği: admin mimar/marka profiline rozet ekleyebilsin).
    env.DB.prepare(`SELECT profile_type, profile_key, badge_type FROM admin_badges`).all(),
  ]);

  // Bir profilin AYNI ANDA birden fazla rozeti asla gösterilmez (kullanıcı isteği: "hiçbir zaman
  // bir kullanıcıya 2 rozet verilemesin"). Önce satın alınan rozetlerden profil başına TEK
  // (en yüksek kademeli) rozeti seçiyoruz — teoride aynı profile bağlı birden fazla onaylı
  // profile_claims farklı kullanıcılardan farklı aktif rozetler getirebilir, o durumda bile tek
  // kazanan olmalı.
  const purchased = { architect: {}, office: {} };
  for (const row of results) {
    const bucket = purchased[row.profile_type];
    if (!bucket) continue;
    const current = bucket[row.profile_key];
    if (!current || (BADGE_RANK[row.badge_type] || 0) > (BADGE_RANK[current] || 0)) {
      bucket[row.profile_key] = row.badge_type;
    }
  }

  const out = { architect: {}, office: {} };
  for (const type of ['architect', 'office']) {
    for (const key of Object.keys(purchased[type])) out[type][key] = [purchased[type][key]];
  }
  // Admin'in sahiplenme/satın alma olmadan doğrudan verdiği rozet (bkz. schema.sql#admin_badges)
  // satın alınan rozetin YERİNİ alır, YANINA eklenmez — admin bir profile rozet ver/değiştir/
  // kaldır dediğinde bu, o profilde görünen TEK rozeti belirler (kullanıcı isteği: "admin rozeti
  // değiştiğinde her yerden rozet değişsin"; "İz Bırakan" artık ayrı bir özel durum değil, bu
  // genel override kuralının bir örneği — vefat etmiş bir mimar hem aktif ödemeli bir üyelik
  // rozetine sahip OLABİLİR hem de admin onu İz Bırakan işaretleyebilir, override kuralı zaten
  // yalnızca İz Bırakan'ın görünmesini sağlar).
  for (const row of adminResults) {
    const bucket = out[row.profile_type];
    if (!bucket) continue;
    bucket[row.profile_key] = [row.badge_type];
  }
  return out;
}
