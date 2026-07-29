import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { SUBMISSION_TYPES, parseSubmissionRow } from '../lib/submissionTypes.js';

const TYPE_BY_PATH = {
  offices: 'offices', projects: 'projects', products: 'products', jobs: 'jobs',
  architects: 'architects', news: 'news',
};

async function requireAdmin(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return { error: errorJson('Bu işlem için giriş yapmalısın.', 401) };
  if (user.role !== 'admin') return { error: errorJson('Bu işlem için yetkin yok.', 403) };
  return { user };
}

export async function handleAdminRoute(request, env, url) {
  const { user, error } = await requireAdmin(request, env);
  if (error) return error;

  const segments = url.pathname.split('/').filter(Boolean); // ["api", "admin", ...]
  const sub = segments[2];

  if (sub === 'users' && request.method === 'GET') return listUsers(env);
  if (sub === 'submissions') return handleSubmissionsAdmin(request, env, url, segments);
  if (sub === 'news') return handleNewsAdmin(request, env, segments);
  if (sub === 'claims') return handleClaimsAdmin(request, env, url, segments);
  if (sub === 'badges') return handleBadgesAdmin(request, env, url, segments);
  return errorJson('Bulunamadı', 404);
}

async function listUsers(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, email, name, dob, school, dept, role, created_at FROM users ORDER BY created_at DESC'
  ).all();
  return json({ items: results });
}

// /api/admin/submissions?type=offices&status=pending
// /api/admin/submissions/:type/:id  (PATCH: alanları ve/veya status günceller, DELETE: siler)
async function handleSubmissionsAdmin(request, env, url, segments) {
  if (segments.length === 3 && request.method === 'GET') {
    const typeKey = TYPE_BY_PATH[url.searchParams.get('type')];
    if (!typeKey) return errorJson('Geçersiz tip.');
    const status = url.searchParams.get('status');
    const config = SUBMISSION_TYPES[typeKey];
    const query = status
      ? env.DB.prepare(`SELECT * FROM ${config.table} WHERE status = ? ORDER BY created_at DESC`).bind(status)
      : env.DB.prepare(`SELECT * FROM ${config.table} ORDER BY created_at DESC`);
    const { results } = await query.all();
    return json({ items: results.map(r => parseSubmissionRow(typeKey, r)) });
  }

  if (segments.length === 5) {
    const typeKey = TYPE_BY_PATH[segments[3]];
    const id = segments[4];
    if (!typeKey) return errorJson('Geçersiz tip.');
    const config = SUBMISSION_TYPES[typeKey];

    if (request.method === 'PATCH') {
      const body = await readJson(request);
      const updates = [];
      const values = [];
      if (body.status && ['pending', 'approved', 'rejected'].includes(body.status)) {
        updates.push('status = ?');
        values.push(body.status);
      }
      for (const field of config.fields) {
        if (!(field in body)) continue;
        let value = body[field];
        if (config.arrayFields.includes(field)) value = JSON.stringify(Array.isArray(value) ? value : []);
        updates.push(`${field} = ?`);
        values.push(value);
      }
      if (!updates.length) return errorJson('Güncellenecek bir şey yok.');
      updates.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);
      await env.DB.prepare(`UPDATE ${config.table} SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
      return json({ ok: true });
    }

    if (request.method === 'DELETE') {
      await env.DB.prepare(`DELETE FROM ${config.table} WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    }
  }
  return errorJson('Bulunamadı', 404);
}

// Haber: onay akışı yok, admin doğrudan yönetir.
async function handleNewsAdmin(request, env, segments) {
  if (segments.length === 3) {
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM news ORDER BY created_at DESC').all();
      return json({ items: results });
    }
    if (request.method === 'POST') {
      const body = await readJson(request);
      if (!body.title) return errorJson('Başlık gerekli.');
      const id = newId();
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO news (id, title, category, source, description, image_url, published, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, body.title, body.category || null, body.source || null, body.description || null,
        body.image_url || null, body.published === false ? 0 : 1, now, now).run();
      return json({ id }, 201);
    }
  }
  if (segments.length === 4) {
    const id = segments[3];
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      const fields = ['title', 'category', 'source', 'description', 'image_url'];
      const updates = [];
      const values = [];
      for (const f of fields) {
        if (f in body) { updates.push(`${f} = ?`); values.push(body[f]); }
      }
      if ('published' in body) { updates.push('published = ?'); values.push(body.published ? 1 : 0); }
      if (!updates.length) return errorJson('Güncellenecek bir şey yok.');
      updates.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);
      await env.DB.prepare(`UPDATE news SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM news WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }
  return errorJson('Bulunamadı', 404);
}

// /api/admin/claims?status=pending
// /api/admin/claims/:id  (PATCH: status günceller — approved/rejected)
async function handleClaimsAdmin(request, env, url, segments) {
  if (segments.length === 3 && request.method === 'GET') {
    const status = url.searchParams.get('status');
    const query = status
      ? env.DB.prepare(
          `SELECT c.*, u.name AS user_name, u.email AS user_email FROM profile_claims c
           JOIN users u ON u.id = c.user_id WHERE c.status = ? ORDER BY c.created_at DESC`
        ).bind(status)
      : env.DB.prepare(
          `SELECT c.*, u.name AS user_name, u.email AS user_email FROM profile_claims c
           JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC`
        );
    const { results } = await query.all();
    return json({ items: results });
  }

  if (segments.length === 4 && request.method === 'PATCH') {
    const id = segments[3];
    const body = await readJson(request);
    if (!['approved', 'rejected'].includes(body.status)) return errorJson('Geçersiz durum.');
    await env.DB.prepare(
      'UPDATE profile_claims SET status = ?, updated_at = ? WHERE id = ?'
    ).bind(body.status, Date.now(), id).run();
    return json({ ok: true });
  }
  return errorJson('Bulunamadı', 404);
}

// /api/admin/badges?status=pending
// /api/admin/badges/:id  (PATCH: status günceller — active/rejected)
async function handleBadgesAdmin(request, env, url, segments) {
  if (segments.length === 3 && request.method === 'GET') {
    const status = url.searchParams.get('status');
    const query = status
      ? env.DB.prepare(
          `SELECT b.*, u.name AS user_name, u.email AS user_email FROM badge_requests b
           JOIN users u ON u.id = b.user_id WHERE b.status = ? ORDER BY b.created_at DESC`
        ).bind(status)
      : env.DB.prepare(
          `SELECT b.*, u.name AS user_name, u.email AS user_email FROM badge_requests b
           JOIN users u ON u.id = b.user_id ORDER BY b.created_at DESC`
        );
    const { results } = await query.all();
    return json({ items: results });
  }

  if (segments.length === 4 && request.method === 'PATCH') {
    const id = segments[3];
    const body = await readJson(request);
    if (!['active', 'rejected'].includes(body.status)) return errorJson('Geçersiz durum.');
    await env.DB.prepare(
      'UPDATE badge_requests SET status = ?, updated_at = ? WHERE id = ?'
    ).bind(body.status, Date.now(), id).run();
    return json({ ok: true });
  }
  return errorJson('Bulunamadı', 404);
}
