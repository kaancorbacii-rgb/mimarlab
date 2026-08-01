import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { BADGE_RANK } from '../lib/badgeAccess.js';

// Fiyatlar TL/ay cinsinden (aylık abonelik); ödeme altyapısı bağlanana kadar talepler admin
// panelinden elle onaylanır. Dört kademe: destekci (Destekçi — herhangi bir hak/rozet vermez,
// yalnızca destek amaçlı), verified (Doğrulanmış Üye), gold (Altın Üye), platinum (Elmas Üye)
// — bkz. data.js#BADGE_LABELS ile aynı anahtarlar (destekci kasıtlı olarak orada yok, bkz.
// handlePublicBadges).
export const BADGE_PRICES = {
  destekci: 19.90,
  verified: 39.90,
  gold: 79.90,
  platinum: 139.90,
};

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
  const body = await readJson(request);
  const badgeType = body.badgeType;
  const price = BADGE_PRICES[badgeType];
  if (price === undefined) return errorJson('Geçersiz rozet türü.');
  const target = normalizeTarget(body);
  if (!target) return errorJson('Geçersiz hedef.');
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
    'INSERT INTO badge_requests (id, user_id, badge_type, target_type, target_key, status, price_try, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
export async function handlePublicBadges(env) {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT c.profile_type, c.profile_key, b.badge_type
     FROM profile_claims c
     JOIN badge_requests b ON b.user_id = c.user_id AND b.status = 'active' AND (b.expires_at IS NULL OR b.expires_at > ?) AND b.badge_type != 'destekci'
       AND ((b.target_type = 'self' AND c.profile_type = 'architect') OR (b.target_type = 'office' AND c.profile_type = 'office' AND b.target_key = c.profile_key))
     WHERE c.status = 'approved'`
  ).bind(now).all();

  const out = { architect: {}, office: {} };
  for (const row of results) {
    const bucket = out[row.profile_type];
    if (!bucket) continue;
    if (!bucket[row.profile_key]) bucket[row.profile_key] = [];
    bucket[row.profile_key].push(row.badge_type);
  }
  return json(out);
}
