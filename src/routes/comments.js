import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';

const TARGET_TYPES = new Set(['project', 'news', 'architect', 'office']);

export async function handleCommentsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "comments", maybe id]

  if (segments.length === 2) {
    if (request.method === 'GET') return listComments(env, url);
    if (request.method === 'POST') return createComment(request, env);
  }
  if (segments.length === 3 && request.method === 'DELETE') return deleteComment(request, env, segments[2]);
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

async function deleteComment(request, env, id) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  const comment = await env.DB.prepare(
    'SELECT id, target_type, target_id, user_id FROM comments WHERE id = ?'
  ).bind(id).first();
  if (!comment) return errorJson('Bulunamadı', 404);

  if (!(await canDeleteComment(env, user, comment))) {
    return errorJson('Bu yorumu silme yetkin yok.', 403);
  }

  await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

// Bir yorumu kim silebilir: yorumun sahibi; admin; kendi gönderdiği (onaylı/onaysız
// fark etmez) projeye gelen yorumlarda proje sahibi; ya da profile_claims'de o mimar/ofis
// profili için onaylı sahiplik iddiası olan kullanıcı.
async function canDeleteComment(env, user, comment) {
  if (comment.user_id === user.id) return true;
  if (user.role === 'admin') return true;

  if (comment.target_type === 'project') {
    const row = await env.DB.prepare(
      'SELECT id FROM project_submissions WHERE owner_user_id = ? AND slug = ?'
    ).bind(user.id, comment.target_id).first();
    return !!row;
  }

  if (comment.target_type === 'architect' || comment.target_type === 'office') {
    const row = await env.DB.prepare(
      "SELECT id FROM profile_claims WHERE user_id = ? AND profile_type = ? AND profile_key = ? AND status = 'approved'"
    ).bind(user.id, comment.target_type, comment.target_id).first();
    return !!row;
  }

  return false;
}
