// image-cdn.js#derivativeUrl'ün SUNUCU TARAFI karşılığı — R2'de önceden üretilmiş responsive
// görsel türevlerinin URL'sini kurar (bkz. o dosyanın başındaki "neden ücretli Images Transform
// değil" gerekçesi ve src/routes/upload.js#DERIVED_KEY_RE güvenlik ağı).
//
// NEDEN AYRI BİR DOSYA: image-cdn.js tarayıcıya `<script src>` ile giden düz bir global-scope
// dosyadır (bu repoda hiç bundler yok, bkz. wrangler.jsonc — sıfır npm bağımlılığı); Worker
// tarafından `import` EDİLEMEZ. İki uygulama bu yüzden kaçınılmaz olarak ayrı — ama AYNI anahtar
// biçimini üretmek ZORUNDALAR: farklılaşırlarsa istemci/sunucu var olmayan bir türev ister ve
// (kırılmaz ama) her seferinde orijinale geri düşer, yani iyileştirme sessizce kaybolur.
// DERIVATIVE_WIDTHS — WORKER TARAFININ TEK KAYNAĞI (kullanıcı isteği, 2026-09-12: elle eşlenen
// kopyaları düzelt). src/lib/derivativeIngest.js ve src/lib/canonicalSync.js artık kendi
// kopyalarını taşımaz, buradan import eder.
//
// GERİ KALAN İKİ KOPYA KAÇINILMAZ ve elle eşlenmeye devam eder: image-cdn.js + image-upload.js
// tarayıcıya <script src> ile giden global-scope dosyalardır (bu repoda bundler YOK, Worker onları
// import EDEMEZ) ve scripts/generate-image-derivatives.py bambaşka bir dil. Eşleşmeyi artık insan
// hafızası değil bir KAPI garanti ediyor: scripts/preflight-check.sh dört kaynağı da okuyup
// karşılaştırır ve ayrışırlarsa deploy hiç başlamaz (bkz. oradaki "görsel türev merdiveni" adımı).
export const DERIVATIVE_WIDTHS = [400, 800, 1600];
const DERIVATIVE_SKIP_RE = /\.(svg|gif)(\?|$)/i;
const SITE_HOSTS = new Set(['mimarlab.com', 'www.mimarlab.com']);

// Kendi origin'imize ait mutlak URL'ler göreli yola indirgenir — projects.images/products.images
// canlıda KARIŞIK yazılmış (bkz. image-cdn.js#toLocalPath'teki aynı gerçek bulgu). Gerçekten başka
// bir host'a ait URL'ler null döner (dokunulmaz).
function toLocalPath(path) {
  if (typeof path !== 'string' || !path) return null;
  if (path.startsWith('data:') || path.startsWith('blob:')) return null;
  if (!/^(https?:)?\/\//i.test(path)) return path;
  try {
    const parsed = new URL(path.startsWith('//') ? `https:${path}` : path);
    if (!SITE_HOSTS.has(parsed.hostname)) return null;
    return parsed.pathname;
  } catch {
    return null;
  }
}

function derivativeWidthFor(width) {
  const w = Number(width) || 0;
  for (const step of DERIVATIVE_WIDTHS) if (w <= step) return step;
  return null;
}

// Türev yolu üretilemiyorsa (harici URL, SVG/GIF, merdivenin üstünde bir genişlik) ORİJİNAL yolu
// aynen döndürür — çağıran tarafın ayrıca bir kontrol yapmasına gerek yok.
export function derivedImageUrl(path, width) {
  const localPath = toLocalPath(path);
  if (!localPath) return path;
  if (DERIVATIVE_SKIP_RE.test(localPath)) return path;
  const step = derivativeWidthFor(width);
  if (!step) return path;
  const clean = localPath.replace(/^\/+/, '');
  if (clean.startsWith('media/')) return `/media/_derived/w${step}/r2/${clean.slice('media/'.length)}`;
  return `/media/_derived/w${step}/s/${clean}`;
}

// image-cdn.js#cdnSrcset'in SUNUCU TARAFI karşılığı (ana sayfa performans turu, 2026-09-08 — bkz.
// src/index.js#buildHomePreloadLinks). `<link rel="preload" as="image" imagesrcset>` ile tarayıcının
// LCP görselini HTML ayrıştırılırken indirmeye başlaması için, istemcinin <img srcset>'iyle BİREBİR
// AYNI aday listesi üretilmeli — aksi halde preload edilen URL <img>'in seçtiği adayla eşleşmez ve
// görsel iki kez iner ("preload not used" uyarısı). Bu yüzden algoritma image-cdn.js'tekiyle aynı:
// istenen genişlikler merdivene yuvarlanır, tekilleştirilir, tanımlayıcı olarak GERÇEK basamak yazılır.
export function derivedSrcset(path, widths) {
  if (!path || !Array.isArray(widths)) return '';
  const seen = new Set();
  const parts = [];
  for (const w of widths) {
    const step = derivativeWidthFor(w);
    if (!step || seen.has(step)) continue;
    const url = derivedImageUrl(path, step);
    if (url === path) continue;
    seen.add(step);
    parts.push(`${url} ${step}w`);
  }
  return parts.join(', ');
}
