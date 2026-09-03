import { json, errorJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { reserveR2Usage, finalizeR2Reservation, releaseR2Reservation, r2QuotaErrorResponse } from '../lib/r2Quota.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { ingestClientDerivatives, recordPendingWidths } from '../lib/derivativeIngest.js';

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
// sınıftaki bir açık: keyfi bir dosya, izin verilen bir Content-Type ile R2'ye kadar sorunsuz
// ilerleyebilirdi. Yalnızca ilk 12 bayt (en uzun imza olan WEBP'nin RIFF....WEBP deseni için
// yeterli) her formatın dosya imzasıyla (magic bytes) karşılaştırılır.
function sniffImageMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) return 'image/png';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

export async function handleUploadRoute(request, env, ctx) {
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

  // file.slice() orijinal dosya akışını TÜKETMEZ — yalnızca ilk 12 baytı ayrı bir görünüm olarak
  // okur, aşağıdaki file.arrayBuffer() yine tam dosyayı verir.
  const headerBytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (sniffImageMime(headerBytes) !== file.type) {
    return errorJson('Dosya içeriği belirtilen görsel formatıyla uyuşmuyor.');
  }

  // file.size ÜST SINIR olarak rezerve edilir (bkz. r2Quota.js#reserveR2Usage) — atomik olduğundan
  // eşzamanlı iki yükleme artık ikisi de kotanın altındayken "geçemez" (önceki TOCTOU'nun düzeltmesi).
  const quota = await reserveR2Usage(env, file.size);
  if (!quota.ok) return r2QuotaErrorResponse(quota.reason);

  // Görsel ZATEN İSTEMCİDE küçültülüp WebP'ye çevrilmiş olarak gelir (bkz. image-upload.js#
  // prepareImage). Sunucuda yeniden boyutlandırma YAPILAMAZ ve YAPILMAZ: Workers runtime'ında
  // (workerd) canvas/kodek yoktur ve ücretli Cloudflare Image Transformations (env.IMAGES /
  // /cdn-cgi/image) bu projede kalıcı olarak kapalıdır (kullanıcı kararı — bkz. wrangler.jsonc).
  // Baytlar olduğu gibi, yalnızca yukarıdaki magic-byte doğrulamasından geçerek yazılır.
  const bytes = await file.arrayBuffer();
  const key = `u/${user.id}/${crypto.randomUUID()}.${ext}`;
  try {
    await env.UPLOADS.put(key, bytes, {
      httpMetadata: { contentType: file.type },
    });
  } catch (err) {
    // Yazım başarısız oldu — hiç gerçekleşmemiş bir yükleme kotayı kalıcı olarak tüketmesin diye
    // rezervasyon tamamen geri alınır.
    await releaseR2Reservation(env, file.size);
    throw err;
  }
  await finalizeR2Reservation(env, file.size, bytes.byteLength);

  // Responsive türevler (w400/w800/w1600 WebP). İstemcinin ürettikleri doğrulanıp KALICI olarak
  // R2'ye yazılır; üretilemeyenler bekleyen-iş kuyruğuna düşer ve scripts/generate-image-
  // derivatives.py ile toplu tamamlanır (bkz. src/lib/derivativeIngest.js dosya başı).
  //
  // Yanıt BEKLETİLMEZ: türev yazımı ctx.waitUntil ile yanıt döndükten sonra tamamlanır — kullanıcı
  // bir galeride 20 görsel yüklerken her birine 3 ek R2 yazımının gecikmesini ödemek istemeyiz.
  // ctx yoksa (bu fonksiyonu ctx'siz çağıran bir yol) beklenir; iki durumda da sonuç aynıdır.
  const derivatives = (async () => {
    const { pending } = await ingestClientDerivatives(env, form, key, bytes.byteLength);
    await recordPendingWidths(env, key, pending);
  })().catch(() => { /* türev üretimi opsiyoneldir, yükleme yanıtını asla etkilemez */ });
  if (ctx) ctx.waitUntil(derivatives); else await derivatives;

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
// isteği). handleUploadRoute'un (yukarıda) görsel-özel MIME whitelist'i ve türev boru hattı bu
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

// performance audit (2026-09-01, P1) — /media/* Cloudflare edge'inde HİÇ önbelleklenmiyordu.
// Ölçüm: aynı görsele (https://mimarlab.com/media/projects/y-evi-bodrum-1.webp) art arda 3 istek,
// üçünde de `cf-cache-status` header'ı HİÇ YOK ve TTFB 0,39-0,44sn — yani her görüntülemede Worker
// çalışıyor ve R2'den tam nesne okunuyor. Karşılaştırma: statik varlıklar (/mimarlar-thumb/*.webp)
// `cf-cache-status: HIT` dönüyor. Sebep: Cloudflare, bir Worker'ın ÜRETTİĞİ yanıtı Cache-Control
// header'ına bakarak KENDİLİĞİNDEN edge'e yazmaz — bunun için Cache API (caches.default) açıkça
// kullanılmalı (SSR sayfaları ve /api/* uçları bu dosyanın dışında zaten bu deseni kullanıyor,
// bkz. src/index.js#cachePut, src/lib/publicCache.js#cachedPublicJson). Sitedeki her proje/ürün/
// profil görseli bu yoldan geçtiğinden bu, her sayfa görüntülemesinde onlarca gereksiz R2 Class B
// okumasına ve görsel başına ~0,4sn'lik bir TTFB'ye mal oluyordu.
//
// Anahtarlar DEĞİŞMEZ (immutable): yüklemeler `u/<user>/<uuid>.<ext>` / `f/<user>/<uuid>.<ext>`
// biçiminde UUID'lidir (bkz. yukarısı) — bir anahtarın içeriği hiçbir zaman ÜZERİNE yazılmaz, bu
// yüzden zaten beyan edilen `max-age=31536000, immutable` sözleşmesi edge için de güvenlidir.
// Yine de bir nesne SİLİNEBİLDİĞİNDEN (bkz. src/lib/canonicalSync.js#UPLOADS.delete) paylaşımlı
// (edge) kopyaya AYRICA `s-maxage=2592000` (30 gün) veriliyor: tarayıcı bir yıllık immutable
// kopyayı korur (mevcut davranış AYNEN), edge kopyası ise en geç bir ay içinde kendiliğinden
// düşer. 404'ler BİLEREK önbelleğe yazılmaz — henüz yüklenmemiş/az önce yüklenmiş bir nesnenin
// "yok" yanıtı edge'de kalıcı olmasın.
const MEDIA_EDGE_MAX_AGE_SECONDS = 2592000;

// Görsel performans optimizasyonu (2026-09-01) — R2'de önceden üretilmiş responsive türevler
// (bkz. image-cdn.js#derivativeUrl, scripts/generate-image-derivatives.js). Türev anahtarları:
//   _derived/w<genişlik>/r2/<r2-anahtarı>     kaynak bir R2 nesnesi
//   _derived/w<genişlik>/s/<statik-yol>       kaynak bir Cloudflare statik varlığı
// Ücretli Cloudflare Images Transform YERİNE kullanılır (2026-08-22'de maliyet nedeniyle kapatıldı).
const DERIVED_KEY_RE = /^_derived\/w(\d+)\/(r2|s)\/(.+)$/;

// GÜVENLİK/HİJYEN DÜZELTMESİ (production audit, 2026-09-03) — "s" (statik varlık) kaynağı,
// çözülmüş yolu doğrudan env.ASSETS.fetch'e veriyordu. URL nesnesi nokta segmentlerini
// normalize ettiğinden bu, `/media/` altında KEYFİ bir statik varlığa erişim demekti; canlıda
// doğrulandı: GET /media/_derived/w400/s/..%2F..%2Fadmin.html -> 200 ve admin.html'in TAM HTML'i
// /media/ yolu altından servis ediliyordu. Ayrıcalık yükseltmesi DEĞİL (o varlıklar zaten kendi
// yollarından herkese açık) ama iki gerçek zararı var: (1) her statik dosya için sınırsız sayıda
// alternatif URL üretilebiliyor — tarama bütçesi israfı ve duplicate content; (2) HTML sayfalar
// asla ait olmadıkları bir yol/Cache-Control sözleşmesi altında servis ediliyor.
//
// Kısıt, meşru trafiği HİÇ etkilemeyecek kadar dar seçildi: "s" türevleri YALNIZCA görseller için
// üretilir (bkz. image-cdn.js#derivativeUrl ve src/lib/imageDerivative.js#derivedImageUrl — ikisi
// de bu yolu sadece görsel alanlarından kurar, DERIVATIVE_SKIP_RE ile svg/gif zaten elenir). Bu
// yüzden NORMALIZE EDİLMİŞ hedef yolun bir görsel uzantısıyla bitmesi şart koşulur — çözülmüş yol
// bir görsele işaret etmiyorsa (yani traversal bizi HTML/JS/başka bir şeye götürdüyse) 404 dönülür.
// Kontrol ham string üzerinde ".." aramaz, URL'in KENDİ normalizasyonundan SONRAKİ sonuca bakar —
// böylece çift kodlama (%252e%252e) gibi varyantlar da aynı kapıya çarpar.
const DERIVED_STATIC_IMAGE_RE = /\.(jpe?g|png|webp|avif|gif|svg)$/i;

// KRİTİK GÜVENLİK AĞI: bir türev henüz üretilmemişse (migration devam ediyor, yeni yüklenmiş bir
// görsel, ya da türev üretimi başarısız olmuş) 404 DÖNMEZ — ORİJİNAL servis edilir. Bu sayede
// image-cdn.js tek bir türev bile yokken canlıya alınabilir ve hiçbir görsel asla kırılmaz;
// türevler üretildikçe iyileşme kendiliğinden devreye girer.
//
// Geri düşülen yanıt edge'de KISA (1 saat) tutulur: türev anahtarı DEĞİŞMEDEN içerik "yok"tan
// "var"a geçebilen TEK durum budur, 30 günlük normal TTL burada yeni üretilen türevin bir ay
// boyunca görünmemesine yol açardı. Türevin KENDİSİ bulunduğunda normal immutable TTL uygulanır
// (türev anahtarları da tıpkı orijinaller gibi içerik-değişmezdir: aynı anahtara farklı içerik
// yazılmaz, yeniden üretim birebir aynı çıktıyı verir).
const DERIVED_FALLBACK_EDGE_MAX_AGE_SECONDS = 3600;

export async function handleMediaRoute(request, env, url, ctx) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);

  // Cache anahtarı HER ZAMAN GET'tir — HEAD isteği (uptime/monitoring araçları) GET'in önbelleğini
  // paylaşır ama kendisi gövdesiz döner (aşağıdaki request.method kontrolü korunur).
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  let cache = null;
  try { cache = caches.default; } catch { /* caches API bazı ortamlarda (yerel wrangler dev) yok */ }
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return request.method === 'HEAD' ? new Response(null, { status: hit.status, headers: hit.headers }) : hit;
    } catch { /* okuma başarısızsa aşağıdaki R2 yoluna düş — davranış eski hâliyle birebir aynı */ }
  }

  // denetim bulgusu: bozuk `%`-encoding içeren bir path (ör. tek başına "%") decodeURIComponent'ten
  // URIError fırlatır — bu, index.js'teki genel catch-all'a düşüp temiz bir 404 yerine jenerik
  // "Sunucu hatası oluştu." 500'e çevriliyordu. Gerçek kullanıcı verisi asla malformed encoding
  // üretmez ama kenar durumu doğru status koduna (404) getirmek için burada yakalanır.
  let key;
  try { key = decodeURIComponent(url.pathname.slice('/media/'.length)); } catch { return errorJson('Bulunamadı', 404); }
  if (!key) return errorJson('Bulunamadı', 404);

  let object = await env.UPLOADS.get(key);
  // Türev bulunamayıp orijinale geri düşüldüyse yanıt HEM edge'de HEM TARAYICIDA kısa ömürlü
  // olmalı: aksi halde ziyaretçinin tarayıcısı, türev URL'sinin altında ORİJİNALİ bir yıl boyunca
  // "immutable" olarak saklar ve türev sonradan üretilse bile o ziyaretçi iyileştirmeyi HİÇ görmez.
  let isFallback = false;

  if (!object) {
    const derived = DERIVED_KEY_RE.exec(key);
    if (derived) {
      const [, widthStr, source, originalPath] = derived;
      isFallback = true;
      if (source === 'r2') {
        // İSTEK ANINDA TÜREV ÜRETİLMEZ — ne ücretli bir dönüşümle (env.IMAGES / /cdn-cgi/image; bu
        // projede kalıcı olarak kapalı, bkz. wrangler.jsonc) ne başka bir yolla: Workers
        // runtime'ında canvas/kodek yoktur. Türevler yükleme anında istemcide üretilir (bkz.
        // image-upload.js) ya da eksik kalanlar bekleyen-iş kuyruğundan toplu tamamlanır (bkz.
        // src/lib/derivativeIngest.js). Buraya düşen istek, aşağıdaki güvenlik ağıyla ORİJİNALİ
        // alır — hiçbir görsel kırılmaz, yalnızca o an daha büyük bir dosya iner.
        object = await env.UPLOADS.get(originalPath);
      } else {
        // Statik varlık kaynağı — Cloudflare Assets'ten okunur. env.ASSETS.fetch mutlak bir URL
        // ister; istekle AYNI origin kullanılır. Yanıt yeniden sarmalanmaz, kendi başına (kendi
        // Content-Type'ı ve statik varlık cache header'larıyla) döner — yalnızca s-maxage'ı
        // yukarıdaki kısa değere çekilir ki türev üretilince edge bir saat içinde onu görsün.
        const assetUrl = new URL(url);
        assetUrl.pathname = `/${originalPath}`;
        assetUrl.search = '';
        // bkz. DERIVED_STATIC_IMAGE_RE — pathname ataması nokta segmentlerini ZATEN çözdüğü için
        // bu kontrol traversal SONRASI gerçek hedefi görür.
        if (!DERIVED_STATIC_IMAGE_RE.test(assetUrl.pathname)) return errorJson('Bulunamadı', 404);
        const assetRes = await env.ASSETS.fetch(new Request(assetUrl, { method: 'GET' }));
        if (!assetRes.ok) return errorJson('Bulunamadı', 404);
        const assetHeaders = new Headers(assetRes.headers);
        assetHeaders.set('Cache-Control', `public, max-age=${DERIVED_FALLBACK_EDGE_MAX_AGE_SECONDS}, s-maxage=${DERIVED_FALLBACK_EDGE_MAX_AGE_SECONDS}`);
        assetHeaders.set('X-Content-Type-Options', 'nosniff');
        if (request.method === 'HEAD') return new Response(null, { status: 200, headers: assetHeaders });
        const assetResponse = new Response(assetRes.body, { status: 200, headers: assetHeaders });
        if (cache) {
          const put = cache.put(cacheKey, assetResponse.clone()).catch(() => {});
          if (ctx) ctx.waitUntil(put);
        }
        return assetResponse;
      }
    }
    if (!object) return errorJson('Bulunamadı', 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', isFallback
    ? `public, max-age=${DERIVED_FALLBACK_EDGE_MAX_AGE_SECONDS}, s-maxage=${DERIVED_FALLBACK_EDGE_MAX_AGE_SECONDS}`
    : `public, max-age=31536000, s-maxage=${MEDIA_EDGE_MAX_AGE_SECONDS}, immutable`);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('ETag', object.httpEtag);
  // Content-Length: edge'e yazılan yanıtın boyutu bilinsin diye (R2 nesnesinin kendi metadata'sı).
  if (typeof object.size === 'number') headers.set('Content-Length', String(object.size));

  // HEAD: gövde hiç okunmaz, bu yüzden önbelleğe de YAZILMAZ (bir gövde akışını clone'layıp yalnızca
  // bir dalını tüketmek gereksiz tampon büyümesine yol açar; HEAD zaten yalnızca monitoring için).
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });

  const response = new Response(object.body, { headers });
  if (cache) {
    const toCache = response.clone();
    // ctx varsa edge'e yazma isteğin dönüşünü BEKLETMEZ (waitUntil); yoksa (ör. bu fonksiyonu
    // ctx'siz çağıran bir yol) yazma yine denenir ama beklenmez — yanıt her hâlükârda normal döner.
    const put = cache.put(cacheKey, toCache).catch(() => {});
    if (ctx) ctx.waitUntil(put);
  }
  return response;
}
