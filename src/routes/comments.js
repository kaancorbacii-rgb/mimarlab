import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';

const TARGET_TYPES = new Set(['project', 'news']);

export async function handleCommentsRoute(request, env, url) {
  if (url.pathname !== '/api/comments') return errorJson('Bulunamadı', 404);

  if (request.method === 'GET') return listComments(env, url);
  if (request.method === 'POST') return createComment(request, env);
  return errorJson('Bulunamadı', 404);
}

async function listComments(env, url) {
  const targetType = url.searchParams.get('targetType');
  const targetId = url.searchParams.get('targetId');
  if (!TARGET_TYPES.has(targetType) || !targetId) return errorJson('Geçersiz istek.');

  const { results } = await env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, u.name AS user_name, u.id AS user_id
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.target_type = ? AND c.target_id = ?
     ORDER BY c.created_at ASC`
  ).bind(targetType, targetId).all();

  return json({ items: results });
}

async function createComment(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Yorum yapmak için giriş yapmalısın.', 401);

  const body = await readJson(request);
  const targetType = body.targetType;
  const targetId = (body.targetId || '').trim();
  const text = (body.body || '').trim();

  if (!TARGET_TYPES.has(targetType) || !targetId) return errorJson('Geçersiz istek.');
  if (!text) return errorJson('Yorum boş olamaz.');
  if (text.length > 2000) return errorJson('Yorum en fazla 2000 karakter olabilir.');

  const id = newId();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO comments (id, target_type, target_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, targetType, targetId, user.id, text, now).run();

  return json({ id, body: text, created_at: now, user_name: user.name, user_id: user.id }, 201);
}
