import { json, errorJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { reserveR2Usage, finalizeR2Reservation, releaseR2Reservation, r2QuotaErrorResponse } from '../lib/r2Quota.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { optimizeUploadedImage } from '../lib/imageOptimize.js';

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

// gerçek bulgu (denetim raporu): eskiden yalnızca istemcinin gönderdiği (kolayca sahtelenebilen)
// Content-Type başlığına güveniliyordu — bir dosyanın GERÇEK baytları hiç kontrol edilmiyordu. Bu
// tam olarak miras/*.webp'nin yıllar önce yanlış etiketlenmesine (bkz. proje geçmişi) yol açan
// sınıftaki bir açık: keyfi bir dosya, izin verilen bir Content-Type ile R2'ye ve
// imageOptimize.js'e kadar sorunsuz ilerleyebilirdi. Yalnızca ilk 12 bayt (en uzun imza olan
// WEBP'nin RIFF....WEBP deseni için yeterli) her formatın dosya imzasıyla (magic bytes)
// karşılaştırılır.
function sniffImageMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) return 'image/png';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

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

  // file.slice() orijinal dosya akışını TÜKETMEZ (bkz. aşağıdaki optimizeUploadedImage'in AYNI
  // file nesnesi üzerinde file.stream() çağırması) — yalnızca ilk 12 baytı ayrı bir görünüm olarak okur.
  const headerBytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (sniffImageMime(headerBytes) !== file.type) {
    return errorJson('Dosya içeriği belirtilen görsel formatıyla uyuşmuyor.');
  }

  // file.size ÜST SINIR olarak rezerve edilir (bkz. r2Quota.js#reserveR2Usage) — atomik olduğundan
  // eşzamanlı iki yükleme artık ikisi de kotanın altındayken "geçemez" (önceki TOCTOU'nun düzeltmesi).
  const quota = await reserveR2Usage(env, file.size);
  if (!quota.ok) return r2QuotaErrorResponse(quota.reason);

  // gerçek bulgu: R2'ye eskiden dosya olduğu gibi yazılıyordu — depolama kotasını orijinal
  // (genelde birkaç MB'lık telefon fotoğrafı) boyutlarla dolduruyordu. optimizeUploadedImage
  // (bkz. src/lib/imageOptimize.js) best-effort'tur: başarısız olursa (GIF, binding yapılandırılmamış,
  // kota aşımı, geçersiz görsel) null döner ve orijinal dosya olduğu gibi yazılmaya devam eder —
  // yükleme akışı hiçbir durumda kullanıcıya hata göstermez ya da başarısız olmaz.
  const optimized = await optimizeUploadedImage(env, file, file.type);
  const bytes = optimized ? optimized.arrayBuffer : await file.arrayBuffer();
  const contentType = optimized ? optimized.contentType : file.type;
  const finalExt = optimized ? optimized.ext : ext;

  const key = `u/${user.id}/${crypto.randomUUID()}.${finalExt}`;
  try {
    await env.UPLOADS.put(key, bytes, {
      httpMetadata: { contentType },
    });
  } catch (err) {
    // Yazım başarısız oldu — hiç gerçekleşmemiş bir yükleme kotayı kalıcı olarak tüketmesin diye
    // rezervasyon tamamen geri alınır.
    await releaseR2Reservation(env, file.size);
    throw err;
  }
  // Rezerve edilen üst sınır (file.size), gerçekte yazılan boyuta (optimize edildiyse daha küçük)
  // düzeltilir.
  await finalizeR2Reservation(env, file.size, bytes.byteLength);

  return json({ url: `/media/${key}` }, 201);
}

export async function handleMediaRoute(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);

  // denetim bulgusu: bozuk `%`-encoding içeren bir path (ör. tek başına "%") decodeURIComponent'ten
  // URIError fırlatır — bu, index.js'teki genel catch-all'a düşüp temiz bir 404 yerine jenerik
  // "Sunucu hatası oluştu." 500'e çevriliyordu. Gerçek kullanıcı verisi asla malformed encoding
  // üretmez ama kenar durumu doğru status koduna (404) getirmek için burada yakalanır.
  let key;
  try { key = decodeURIComponent(url.pathname.slice('/media/'.length)); } catch { return errorJson('Bulunamadı', 404); }
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
