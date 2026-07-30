import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';

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

// Bir kişi/marka aynı anda yalnızca 1 rozet tutabilir: hâlihazırda süresi dolmamış aktif bir
// rozeti varsa yeni talep reddedilir; bekleyen (henüz onaylanmamış) bir talebi varsa yeni
// seçimiyle değiştirilir (admin onaylamadan tercihini değiştirebilsin diye).
async function createBadgeRequest(request, env, user) {
  const body = await readJson(request);
  const badgeType = body.badgeType;
  const price = BADGE_PRICES[badgeType];
  if (price === undefined) return errorJson('Geçersiz rozet türü.');

  const now = Date.now();
  const active = await env.DB.prepare(
    `SELECT id FROM badge_requests WHERE user_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`
  ).bind(user.id, now).first();
  if (active) return errorJson('Zaten aktif bir rozetin var. Yeni bir rozet alabilmek için mevcut rozetinin süresi dolmalı.');

  await env.DB.prepare(`DELETE FROM badge_requests WHERE user_id = ? AND status = 'pending'`).bind(user.id).run();

  const id = newId();
  await env.DB.prepare(
    'INSERT INTO badge_requests (id, user_id, badge_type, status, price_try, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, badgeType, 'pending', price, now, now).run();

  return json({ id, status: 'pending' }, 201);
}

async function listMyBadges(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT id, badge_type, status, price_try, expires_at, created_at FROM badge_requests WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();
  return json({ items: results });
}

// GET /api/public/badges — auth gerektirmez. Onaylı profile_claims ile süresi dolmamış aktif
// badge_requests'i birleştirip { architect: { "İsim": ["mimar","platinyum"] }, office: { ... } }
// döner; detay ve listeleme sayfaları isim yanına rozet göstermek için bunu data.js'teki statik
// badges alanıyla birleştirir. 'destekci' kasıtlı olarak dışarıda bırakılır — o kademe herhangi
// bir hak ya da görünür rozet vermez, yalnızca destek amaçlıdır.
export async function handlePublicBadges(env) {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT c.profile_type, c.profile_key, b.badge_type
     FROM profile_claims c
     JOIN badge_requests b ON b.user_id = c.user_id AND b.status = 'active' AND (b.expires_at IS NULL OR b.expires_at > ?) AND b.badge_type != 'destekci'
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
