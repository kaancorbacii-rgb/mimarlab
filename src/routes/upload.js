import { json, errorJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { reserveR2Usage, finalizeR2Reservation, releaseR2Reservation, r2QuotaErrorResponse } from '../lib/r2Quota.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { optimizeUploadedImage } from '../lib/imageOptimize.js';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB — varsayılan (haber/iş ilanı görselleri)
const CONTEXT_MAX_BYTES = {
  project: 2 * 1024 * 1024, // proje-ekle.html galeri görselleri
  product: 2 * 1024 * 1024, // urun-ekle.html galeri görselleri
  architect: 2 * 1024 * 1024, // kisi-ekle.html profil fotoğrafı
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

// "Dosyalar (BIM, CAD, 3D, Katalog)" eki — bkz. kullanıcı isteği. Bu liste src/lib/submissionTypes.js#
// PRODUCT_FILE_EXTENSIONS ve js/components/product-modal.js#FILE_TYPE_META İLE AYNI (üçü de bağımsız
// kopya — bu kod tabanının kuralı, biri değişirse diğer ikisi de güncellenmeli).
const FILE_UPLOAD_EXTENSIONS = new Set([
  'rfa', 'rvt', 'ifc', 'ifczip', // BIM
  'dwg', 'dxf', // CAD
  'skp', '3dm', 'obj', 'fbx', '3ds', 'stl', 'step', 'stp', 'iges', 'igs', // 3D
  'pdf', // Katalog
]);
const MAX_FILE_UPLOAD_BYTES = 10 * 1024 * 1024; // dosya başına 10 MB (bkz. kullanıcı isteği)

// gerçek MIME raporlaması bu (çoğu tarayıcı/işletim sistemi tarafından TANINMAYAN) format ailesi için
// son derece tutarsızdır — bir .skp/.rvt/.dwg dosyası neredeyse HER ZAMAN boş ya da
// application/octet-stream olarak gelir, OS'a göre bazen de tamamen farklı (ör. "application/acad",
// "model/stl") bir değer taşır. Bu yüzden MIME kontrolü bir POZİTİF whitelist değil, bilinen TEHLİKELİ
// ailelerin (görsel/video/ses/zip/çalıştırılabilir) AÇIKÇA reddedilmesi şeklinde tersine kurulur — bkz.
// kullanıcı isteği: "PNG/JPG/JPEG/WebP/GIF, MP4/MOV/AVI/WebM, MP3/WAV, ZIP, EXE/MSI/DMG ... reddet".
// ifczip KASITLI OLARAK zip reddinden MUAF (bir ZIP konteyneridir, bkz. aşağıdaki sniffFileSignature).
function isBannedMimeType(mime, ext) {
  if (!mime) return false;
  const m = mime.toLowerCase();
  if (m.startsWith('image/') || m.startsWith('video/') || m.startsWith('audio/')) return true;
  if (/^application\/(x-)?(zip|zip-compressed)$/.test(m) && ext !== 'ifczip') return true;
  if (/^application\/(x-)?(rar-compressed|vnd\.rar)$/.test(m)) return true;
  if (/^application\/(x-msdownload|x-msi|x-ms-installer|x-apple-diskimage|vnd\.microsoft\.portable-executable)$/.test(m)) return true;
  return false;
}

// Yalnızca izin verilmeyen/tehlikeli formatların (görsel/video/ses/exe, uzantı ne olursa olsun) GERÇEK
// baytlarını tanır — bir kullanıcının zararlı bir dosyayı yeniden adlandırıp izin verilen bir uzantıyla
// (ör. "virus.exe" → "virus.rvt") yüklemeye çalıştığı en pratik saldırı sınıfına karşı. ZIP imzası
// yalnızca ext !== 'ifczip' iken tehlikeli sayılır (ifczip meşru bir ZIP konteyneridir).
function looksLikeDisguisedDangerousFile(ext, bytes) {
  if (bytes.length >= 2 && bytes[0] === 0x4D && bytes[1] === 0x5A) return true; // MZ — Windows PE (.exe/.dll/.msi yükleyicileri)
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return true; // JPEG
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return true; // PNG
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true; // GIF
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true; // RIFF (WEBP/AVI/WAV)
  if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return true; // "ftyp" — MP4/MOV/WebM ailesi
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true; // ID3 (MP3)
  if (ext !== 'ifczip' && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) return true; // ZIP (yalnızca ifczip için beklenir)
  return false;
}

// "mümkünse" (bkz. kullanıcı isteği) — bu 17 formattan yalnızca güvenilir/sabit bir dosya imzasına
// sahip olanlar için POZİTİF doğrulama yapılır (true/false); geri kalanı (obj/fbx/3dm/stl/skp/iges/
// igs/dxf — bunların ya hiç sabit imzası yok ya da ASCII/metin tabanlı, güvenilir biçimde ayırt
// edilemiyor) null döner, yalnızca uzantı+MIME+looksLikeDisguisedDangerousFile ile korunur.
function sniffFileSignature(ext, bytes) {
  if (ext === 'pdf') return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2D; // "%PDF-"
  if (ext === 'dwg') return bytes.length >= 4 && bytes[0] === 0x41 && bytes[1] === 0x43 && bytes[2] === 0x31 && bytes[3] === 0x30; // "AC10..." (AutoCAD sürüm imzası)
  if (ext === 'rfa' || ext === 'rvt') {
    // OLE Compound File Binary — Revit dosyaları bu konteynerde saklanır. NOT: eski .doc/.xls/.msi de
    // AYNI dış imzayı taşır; iç kök depolama sınıf kimliğine kadar inmeden ayırt edilemez — bu yüzden
    // yalnızca "OLE konteyneri mi" doğrulanır, MSI'nin kendisi zaten yukarıdaki isBannedMimeType'ta
    // ayrıca reddedilir.
    return bytes.length >= 8 && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0 && bytes[4] === 0xA1 && bytes[5] === 0xB1 && bytes[6] === 0x1A && bytes[7] === 0xE1;
  }
  if (ext === 'ifczip') return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07); // ZIP
  if (ext === 'ifc' || ext === 'step' || ext === 'stp') {
    // Fiziksel dosya biçimi (ISO-10303-21) — IFC bunun üzerine kuruludur, STEP'in kendisi de aynı.
    const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^﻿/, '').trimStart();
    return head.toUpperCase().startsWith('ISO-10303-21');
  }
  if (ext === '3ds') return bytes.length >= 2 && bytes[0] === 0x4D && bytes[1] === 0x4D; // ana chunk kimliği (0x4D4D)
  return null;
}

// POST /api/uploads/file — urun-ekle.html "Dosya Yükle (BIM, CAD, 3D, Katalog)" kutusu (bkz. kullanıcı
// isteği). handleUploadRoute'un (yukarıda) görsel-özel MIME whitelist'i + optimizeUploadedImage'i bu
// format ailesine uygulanamayacağından (bkz. isBannedMimeType'ın dosya başı yorumu) ayrı bir uç —
// aynı auth/rate-limit/R2 kota iskeletini paylaşır.
export async function handleFileUploadRoute(request, env) {
  if (request.method !== 'POST') return errorJson('Bulunamadı', 404);

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (!(await checkRateLimit(env, 'upload_file', user.id, 20, 10 * 60 * 1000))) {
    return errorJson('Çok fazla dosya yüklemeye çalıştın, birkaç dakika sonra tekrar dene.', 429, { 'Retry-After': '600' });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return errorJson('Geçersiz yükleme isteği.');
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') return errorJson('Dosya bulunamadı.');

  const originalName = String(file.name || '').slice(0, 200);
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(originalName);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  if (!FILE_UPLOAD_EXTENSIONS.has(ext)) {
    return errorJson('Bu dosya formatı desteklenmiyor. İzin verilen formatlar: rfa, rvt, ifc, ifczip, dwg, dxf, skp, 3dm, obj, fbx, 3ds, stl, step, stp, iges, igs, pdf.');
  }
  if (isBannedMimeType(file.type, ext)) {
    return errorJson('Bu dosya türüne izin verilmiyor.');
  }
  if (file.size > MAX_FILE_UPLOAD_BYTES) {
    return errorJson(`Dosya en fazla ${Math.round(MAX_FILE_UPLOAD_BYTES / (1024 * 1024))} MB olabilir.`);
  }

  // ISO-10303-21 metin imzası (ifc/step/stp) birkaç bayttan uzun olabileceğinden (BOM + boşluk payı)
  // sniffImageMime'daki 12 bayt yerine 32 bayt okunur (bkz. yukarıdaki sniffFileSignature).
  const headerBytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (looksLikeDisguisedDangerousFile(ext, headerBytes)) {
    return errorJson('Dosya içeriği izin verilen formatlardan biriyle uyuşmuyor.');
  }
  const signatureResult = sniffFileSignature(ext, headerBytes);
  if (signatureResult === false) {
    return errorJson('Dosya içeriği belirtilen formatla uyuşmuyor.');
  }

  const quota = await reserveR2Usage(env, file.size);
  if (!quota.ok) return r2QuotaErrorResponse(quota.reason);

  const bytes = await file.arrayBuffer();
  const key = `f/${user.id}/${crypto.randomUUID()}.${ext}`;
  try {
    // Content-Type kasıtlı olarak istemcinin bildirdiği (güvenilmez) file.type DEĞİL, sabit
    // application/octet-stream — bu, tarayıcının /media/ üzerinden geri servis edilen dosyayı
    // doğrudan sekmede AÇMAYA çalışmak yerine HER ZAMAN indirmesini sağlar (bkz. js/components/
    // product-modal.js#renderFilesSection'daki `download` özniteliği ile aynı savunma amacı).
    await env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: 'application/octet-stream' } });
  } catch (err) {
    await releaseR2Reservation(env, file.size);
    throw err;
  }
  await finalizeR2Reservation(env, file.size, bytes.byteLength);

  return json({ url: `/media/${key}`, filename: originalName || `dosya.${ext}`, format: ext, size: bytes.byteLength }, 201);
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
