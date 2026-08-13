import { parseCookies, sessionCookieName } from './http.js';
import { randomToken, sha256Hex } from './crypto.js';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 gün

export async function createSession(env, userId) {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(tokenHash, userId, now, now + SESSION_TTL_SECONDS * 1000).run();
  return { token, maxAge: SESSION_TTL_SECONDS };
}

export async function destroySession(env, token) {
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function getSessionUser(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[sessionCookieName(request)];
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.dob, u.school, u.dept, u.photo_url, u.profession, u.position, u.role, u.created_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(tokenHash, Date.now()).first();
  return row || null;
}

export function publicUser(user) {
  if (!user) return null;
  const { id, email, name, dob, school, dept, photo_url, profession, position, role, created_at } = user;
  return { id, email, name, dob, school, dept, photoUrl: photo_url, profession, position, role, createdAt: created_at };
}
