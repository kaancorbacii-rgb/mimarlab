import { json, errorJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { checkR2Quota, recordR2Usage, r2QuotaErrorResponse } from '../lib/r2Quota.js';
import { checkRateLimit } from '../lib/rateLimit.js';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB — varsayılan (haber/iş ilanı görselleri)
const CONTEXT_MAX_BYTES = {
  project: 2 * 1024 * 1024, // proje-ekle.html galeri görselleri
  product: 2 * 1024 * 1024, // urun-ekle.html galeri görselleri
  architect: 2 * 1024 * 1024, // mimar-ekle.html profil fotoğrafı
  office: 2 * 1024 * 1024, // firma-ekle.html logo
};
const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function handleUploadRoute(request, env) {
  if (request.method !== 'POST') return errorJson('Bulunamadı', 404);

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  // Proje/ürün/mimar/firma galerileri için tek seferde çok sayıda görsel yüklenebildiğinden
  // (bkz. kullanıcı isteği: "çok fazla görsel yüklemesi olacak, önlem al") üst sınır cömert
  // tutulur — asıl amaç gerçek kullanımı engellemek değil, R2 kotasını (bkz. r2Quota.js) tüketen
  // otomatik/kötüye kullanım kaynaklı yükleme patlamalarına karşı ikinci bir savunma katmanı.
  if (!(await checkRateLimit(env, 'upload', user.id, 60, 10 * 60 * 1000))) {
    return errorJson('Çok fazla görsel yüklemeye çalıştın, birkaç dakika sonra tekrar dene.', 429, { 'Retry-After': '600' });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return errorJson('Geçersiz yükleme isteği.');
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') return errorJson('Dosya bulunamadı.');

  const ext = EXT_BY_MIME[file.type];
  if (!ext) return errorJson('Sadece JPEG, PNG, WEBP ya da GIF görsel yükleyebilirsin.');
  const maxBytes = CONTEXT_MAX_BYTES[form.get('context')] || MAX_UPLOAD_BYTES;
  if (file.size > maxBytes) {
    return errorJson(`Görsel en fazla ${Math.round(maxBytes / (1024 * 1024))} MB olabilir.`);
  }

  const quota = await checkR2Quota(env, file.size);
  if (!quota.ok) return r2QuotaErrorResponse(quota.reason);

  const key = `u/${user.id}/${crypto.randomUUID()}.${ext}`;
  await env.UPLOADS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  await recordR2Usage(env, file.size);

  return json({ url: `/media/${key}` }, 201);
}

export async function handleMediaRoute(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);

  const key = decodeURIComponent(url.pathname.slice('/media/'.length));
  if (!key) return errorJson('Bulunamadı', 404);

  const object = await env.UPLOADS.get(key);
  if (!object) return errorJson('Bulunamadı', 404);

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('ETag', object.httpEtag);

  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}
