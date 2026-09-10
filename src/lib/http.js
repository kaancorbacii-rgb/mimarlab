import { deepNormalizeNfc } from './textMatch.js';
// Faz 4B — güvenli varsayılan: çağıran kendi Cache-Control'ünü (ör. src/lib/publicCache.js'teki
// public uç başlıkları) vermediği sürece HER yanıt private/no-store olur. Bu, admin/auth gerektiren
// onlarca uç noktayı (src/routes/admin.js, auth.js, submissions.js, comments.js vb.) tek tek
// işaretlemeye gerek kalmadan "kesinlikle önbelleklenmesin" garantisine kavuşturur — headers
// parametresi ...headers ile SONRA spread edildiğinden açıkça Cache-Control veren çağıranlar
// (cachedPublicJson) bunu sorunsuz geçersiz kılar.
const DEFAULT_HEADERS = { 'Cache-Control': 'private, no-store, must-revalidate' };

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...DEFAULT_HEADERS, ...headers },
  });
}

export function errorJson(message, status = 400, headers = {}) {
  return json({ error: message }, status, headers);
}

// TÜM JSON gövdeleri buradan geçer (repo çapında `request.json()`'ın tek sarmalayıcısı) — bu yüzden
// yazma tarafının Unicode normalizasyonu için tek doğru yer burasıdır. Ayrışık (NFD) yazılmış bir
// başlık/ad D1'e olduğu gibi yazılsaydı, o satırın name_fold/title_fold generated kolonu da ayrışık
// olur ve kayıt normal klavyeyle yazılan hiçbir sorguda BULUNAMAZDI (bkz. src/lib/textMatch.js
// başındaki kök neden). NFC kanonik BİRLEŞTİRMEdir: kayıpsızdır, hiçbir karakter atılmaz, kullanıcının
// yazdığı metin anlam olarak değişmez — yalnızca ekranda zaten aynı görünen iki gösterimden
// kanonik olanı seçilir. Birleşme işareti taşımayan dizelerde (ezici çoğunluk) tek bir regex
// taramasıyla erken çıkılır, megabaytlık base64 alanlar normalize() çağırmaz.
// SAYFA NUMARASI ÜST SINIRI (canlı bulgu, denetim 2026-09-10).
//
// `?page=999999999999999999` -> parseInt 1e18 döner; bu değer Number.MAX_SAFE_INTEGER'ın ÜSTÜNDE.
// Liste uçlarının bir kısmı sayfalamayı JS'te (KV havuzu üzerinde slice) yapıyor ve orada zararsız
// bir boş dizi çıkıyordu, ama D1'e OFFSET olarak BAĞLAYAN yollar (src/routes/project.js'in D1
// sayfalama hızlı yolu ve src/routes/gundem.js) sorguyu düşürüyordu: canlıda
// /api/projects?page=999999999999999999 ve /api/gundem?page=999999999999999999 -> 500.
//
// Sınır bilerek çok yüksek (100.000): gerçek trafikte en büyük liste ~75 sayfa, yani hiçbir meşru
// istek bu tavana değmez — tek yaptığı, güvenli tamsayı aralığının dışına çıkan girdileri
// (limit <= 96 ile OFFSET en fazla ~9,6 milyon) zararsız bir "boş sayfa" yanıtına çevirmek.
export const MAX_PAGE = 100000;

// Tüm liste uçlarının page parametresini AYNI şekilde okuması için (aksi halde her uç kendi
// parseInt'ini yazar ve biri sınırı unutur — bu hatanın kökeni tam olarak buydu).
export function pageParam(params, fallback = 1) {
  const raw = parseInt(params.get('page'), 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(MAX_PAGE, Math.max(1, raw));
}

// HER ZAMAN bir NESNE döner (canlı bulgu, denetim 2026-09-10). Gövde geçersiz JSON ise zaten {}
// dönüyordu, AMA geçerli-ama-nesne-olmayan bir gövde (`null`, `[]`, `3`, `"x"`) olduğu gibi
// geçiyordu ve çağıranların hepsi sonucu `body.alan` diye okuyor: `null` gövdesi TypeError'a,
// yani yakalanmış bir 500'e dönüşüyordu. Canlıda doğrulandı: `POST /api/auth/login` gövdesi `null`
// -> 500 (bu uç kimlik doğrulamadan ÖNCE gövdeyi okuyan, oturumsuz erişilebilen bir uçtur).
// 70 çağıranın hepsi sonucu alan-alan okuduğundan (hiçbiri diziyi doğrudan kullanmıyor; dizi
// bekleyenler `body.points`/`body.keys` gibi ALANLARA bakıyor) tek noktada garanti etmek doğru yer.
export async function readJson(request) {
  try {
    const parsed = deepNormalizeNfc(await request.json());
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
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

// gerçek bulgu (denetim raporu): __Host- öneki tarayıcının KENDİSİNİN zorunlu kıldığı ekstra bir
// garanti — bu önekle ayarlanan bir çerezi tarayıcı yalnızca Secure + Path=/ + Domain YOK ise kabul
// eder (bkz. RFC 6265bis), yani bir alt alan adı ya da düz HTTP üzerinden bu çerez ASLA
// ayarlanamaz/ele geçirilemez (defense-in-depth, oturum çalınması riskini azaltan ekstra bir katman
// — mevcut HttpOnly/SameSite=Lax/koşullu Secure zaten yeterliydi, bu yalnızca bir sıkılaştırma).
// __Host- SADECE Secure ile birlikte kullanılabilir (aksi halde tarayıcı çerezi TAMAMEN reddeder) —
// bu yüzden yerel `wrangler dev` (http://, bkz. isHttps) üzerinde hâlâ eski düz isim kullanılır,
// aksi halde yerel girişte session cookie hiç set edilmez, giriş sessizce çalışmaz olurdu. İsim
// isteğe göre değiştiğinden (SESSION_COOKIE artık sabit bir string DEĞİL) hem yazan hem OKUYAN
// tarafın AYNI request için sessionCookieName(request) çağırması gerekir — bkz. tüm çağıran noktalar.
export function sessionCookieName(request) {
  return isHttps(request) ? '__Host-mimarlab_session' : 'mimarlab_session';
}

export function sessionCookieHeader(token, request, maxAgeSeconds) {
  const secure = isHttps(request) ? '; Secure' : '';
  return `${sessionCookieName(request)}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookieHeader(request) {
  const secure = isHttps(request) ? '; Secure' : '';
  return `${sessionCookieName(request)}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`;
}
