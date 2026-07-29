import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';

const PROFILE_TYPES = new Set(['architect', 'office']);

export async function handleClaimsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "claims", maybe "status"]

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'POST') return createClaim(request, env, user);
  if (segments.length === 3 && segments[2] === 'status' && request.method === 'GET') {
    return claimStatus(env, url, user);
  }
  return errorJson('Bulunamadı', 404);
}

async function createClaim(request, env, user) {
  const body = await readJson(request);
  const profileType = body.profileType;
  const profileKey = (body.profileKey || '').trim();
  if (!PROFILE_TYPES.has(profileType) || !profileKey) return errorJson('Geçersiz istek.');

  const existing = await env.DB.prepare(
    'SELECT id, status FROM profile_claims WHERE user_id = ? AND profile_type = ? AND profile_key = ?'
  ).bind(user.id, profileType, profileKey).first();

  if (existing) {
    if (existing.status === 'rejected') {
      await env.DB.prepare(
        "UPDATE profile_claims SET status = 'pending', updated_at = ? WHERE id = ?"
      ).bind(Date.now(), existing.id).run();
      return json({ status: 'pending' });
    }
    return json({ status: existing.status });
  }

  const id = newId();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, profileType, profileKey, 'pending', now, now).run();

  return json({ status: 'pending' }, 201);
}

async function claimStatus(env, url, user) {
  const profileType = url.searchParams.get('profileType');
  const profileKey = (url.searchParams.get('profileKey') || '').trim();
  if (!PROFILE_TYPES.has(profileType) || !profileKey) return errorJson('Geçersiz istek.');

  const row = await env.DB.prepare(
    'SELECT status FROM profile_claims WHERE user_id = ? AND profile_type = ? AND profile_key = ?'
  ).bind(user.id, profileType, profileKey).first();

  return json({ status: row ? row.status : 'none' });
}
