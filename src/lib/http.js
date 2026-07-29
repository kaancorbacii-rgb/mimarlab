export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorJson(message, status = 400) {
  return json({ error: message }, status);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function isHttps(request) {
  return new URL(request.url).protocol === 'https:';
}

export const SESSION_COOKIE = 'mimarlab_session';

export function sessionCookieHeader(token, request, maxAgeSeconds) {
  const secure = isHttps(request) ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookieHeader(request) {
  const secure = isHttps(request) ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`;
}
