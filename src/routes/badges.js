import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';

// Fiyatlar TL cinsinden; ödeme altyapısı bağlanana kadar talepler admin panelinden elle onaylanır.
export const BADGE_PRICES = {
  student: 9.90,
  architect: 49.90,
  brand: 99.90,
  gold: 199.90,
  platinum: 399.90,
};

export async function handleBadgesRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "badges", maybe "mine"]

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'POST') return createBadgeRequest(request, env, user);
  if (segments.length === 3 && segments[2] === 'mine' && request.method === 'GET') return listMyBadges(env, user);
  return errorJson('Bulunamadı', 404);
}

async function createBadgeRequest(request, env, user) {
  const body = await readJson(request);
  const badgeType = body.badgeType;
  const price = BADGE_PRICES[badgeType];
  if (price === undefined) return errorJson('Geçersiz rozet türü.');

  const id = newId();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO badge_requests (id, user_id, badge_type, status, price_try, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, badgeType, 'pending', price, now, now).run();

  return json({ id, status: 'pending' }, 201);
}

async function listMyBadges(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT id, badge_type, status, price_try, created_at FROM badge_requests WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();
  return json({ items: results });
}

// GET /api/public/badges — auth gerektirmez. Onaylı profile_claims ile aktif badge_requests'i
// birleştirip { architect: { "İsim": ["mimar","platinyum"] }, office: { ... } } döner; detay ve
// listeleme sayfaları isim yanına rozet göstermek için bunu data.js'teki statik badges alanıyla birleştirir.
export async function handlePublicBadges(env) {
  const { results } = await env.DB.prepare(
    `SELECT c.profile_type, c.profile_key, b.badge_type
     FROM profile_claims c
     JOIN badge_requests b ON b.user_id = c.user_id AND b.status = 'active'
     WHERE c.status = 'approved'`
  ).all();

  const out = { architect: {}, office: {} };
  for (const row of results) {
    const bucket = out[row.profile_type];
    if (!bucket) continue;
    if (!bucket[row.profile_key]) bucket[row.profile_key] = [];
    bucket[row.profile_key].push(row.badge_type);
  }
  return json(out);
}
