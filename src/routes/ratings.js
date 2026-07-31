import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';

const TARGET_TYPES = new Set(['project', 'product', 'material', 'architect', 'office']);

export async function handleRatingsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "ratings", "bulk"?]

  if (segments.length === 3 && segments[2] === 'bulk' && request.method === 'GET') {
    return bulkRatings(env, url);
  }
  if (segments.length === 2 && request.method === 'GET') return getRating(request, env, url);
  if (segments.length === 2 && request.method === 'POST') return upsertRating(request, env);
  return errorJson('Bulunamadı', 404);
}

async function summarize(env, targetType, targetId) {
  const row = await env.DB.prepare(
    'SELECT AVG(stars) AS average, COUNT(*) AS count FROM ratings WHERE target_type = ? AND target_id = ?'
  ).bind(targetType, targetId).first();
  return { average: row && row.count ? row.average : 0, count: row ? row.count : 0 };
}

async function getRating(request, env, url) {
  const targetType = url.searchParams.get('targetType');
  const targetId = url.searchParams.get('targetId');
  if (!TARGET_TYPES.has(targetType) || !targetId) return errorJson('Geçersiz istek.');

  const { average, count } = await summarize(env, targetType, targetId);

  let mine = null;
  const user = await getSessionUser(request, env);
  if (user) {
    const row = await env.DB.prepare(
      'SELECT stars FROM ratings WHERE target_type = ? AND target_id = ? AND user_id = ?'
    ).bind(targetType, targetId, user.id).first();
    mine = row ? row.stars : null;
  }

  return json({ average, count, mine });
}

async function upsertRating(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Puan vermek için giriş yapmalısın.', 401);

  const body = await readJson(request);
  const targetType = body.targetType;
  const targetId = (body.targetId || '').trim();
  const stars = parseInt(body.stars, 10);

  if (!TARGET_TYPES.has(targetType) || !targetId) return errorJson('Geçersiz istek.');
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return errorJson('Puan 1 ile 5 arasında olmalı.');

  const existing = await env.DB.prepare(
    'SELECT id FROM ratings WHERE user_id = ? AND target_type = ? AND target_id = ?'
  ).bind(user.id, targetType, targetId).first();

  const now = Date.now();
  if (existing) {
    await env.DB.prepare('UPDATE ratings SET stars = ?, updated_at = ? WHERE id = ?')
      .bind(stars, now, existing.id).run();
  } else {
    await env.DB.prepare(
      'INSERT INTO ratings (id, target_type, target_id, user_id, stars, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(newId(), targetType, targetId, user.id, stars, now, now).run();
  }

  const { average, count } = await summarize(env, targetType, targetId);
  return json({ average, count, mine: stars });
}

async function bulkRatings(env, url) {
  const targetType = url.searchParams.get('targetType');
  if (!TARGET_TYPES.has(targetType)) return errorJson('Geçersiz istek.');

  const { results } = await env.DB.prepare(
    'SELECT target_id, AVG(stars) AS average, COUNT(*) AS count FROM ratings WHERE target_type = ? GROUP BY target_id'
  ).bind(targetType).all();

  return json({ items: results });
}
