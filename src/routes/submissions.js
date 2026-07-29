import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { SUBMISSION_TYPES, normalizeSubmission, parseSubmissionRow, validateRequired } from '../lib/submissionTypes.js';

const TYPE_BY_PATH = {
  offices: 'offices', projects: 'projects', products: 'products', jobs: 'jobs',
  architects: 'architects', news: 'news',
};

export async function handleSubmissionRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "offices", ...]
  const typeKey = TYPE_BY_PATH[segments[1]];
  if (!typeKey) return errorJson('Bulunamadı', 404);

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'POST') return createSubmission(request, env, user, typeKey);
  if (segments.length === 3 && segments[2] === 'mine' && request.method === 'GET') return listMine(env, user, typeKey);
  if (segments.length === 3 && segments[2] !== 'mine' && request.method === 'GET') return getOwnSubmission(env, user, typeKey, segments[2]);
  if (segments.length === 3 && segments[2] !== 'mine' && request.method === 'PATCH') return updateOwnSubmission(request, env, user, typeKey, segments[2]);
  return errorJson('Bulunamadı', 404);
}

async function createSubmission(request, env, user, typeKey) {
  const body = await readJson(request);
  const missing = validateRequired(typeKey, body);
  if (missing.length) return errorJson(`Eksik alan(lar): ${missing.join(', ')}`);

  const config = SUBMISSION_TYPES[typeKey];
  const row = normalizeSubmission(typeKey, body);
  const id = newId();
  const now = Date.now();

  const columns = ['id', 'owner_user_id', 'status', 'created_at', 'updated_at', ...config.fields];
  const placeholders = columns.map(() => '?').join(', ');
  const values = [id, user.id, 'pending', now, now, ...config.fields.map(f => row[f])];

  await env.DB.prepare(
    `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`
  ).bind(...values).run();

  return json({ id, status: 'pending' }, 201);
}

async function listMine(env, user, typeKey) {
  const config = SUBMISSION_TYPES[typeKey];
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${config.table} WHERE owner_user_id = ? ORDER BY created_at DESC`
  ).bind(user.id).all();
  return json({ items: results.map(r => parseSubmissionRow(typeKey, r)) });
}

async function getOwnSubmission(env, user, typeKey, id) {
  const config = SUBMISSION_TYPES[typeKey];
  const row = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
  if (!row || row.owner_user_id !== user.id) return errorJson('Bulunamadı', 404);
  return json({ item: parseSubmissionRow(typeKey, row) });
}

async function updateOwnSubmission(request, env, user, typeKey, id) {
  const config = SUBMISSION_TYPES[typeKey];
  const existing = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
  if (!existing || existing.owner_user_id !== user.id) return errorJson('Bulunamadı', 404);

  const body = await readJson(request);
  const missing = validateRequired(typeKey, body);
  if (missing.length) return errorJson(`Eksik alan(lar): ${missing.join(', ')}`);

  const row = normalizeSubmission(typeKey, body);
  if (typeKey === 'projects') row.slug = existing.slug; // düzenlemede slug'ı (ve ona bağlı bağlantıları/yorumları) koru

  const now = Date.now();
  const updates = config.fields.map(f => `${f} = ?`);
  const values = config.fields.map(f => row[f]);
  updates.push('status = ?', 'updated_at = ?');
  values.push('pending', now, id);

  await env.DB.prepare(
    `UPDATE ${config.table} SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return json({ id, status: 'pending' });
}
