// FOTOĞRAF sayfasının (bkz. /fotograf, src/routes/photos.js, kullanıcı isteği 2026-09-17) ham veri
// havuzu — projectPool.js#fetchActiveProjectPool İLE AYNI KV-önbellekli "havuz" deseni
// (getCachedPool, publicCache.js#POOL_CACHE_KINDS'e 'photos' olarak eklendi): pahalı sorgu bir kez
// çalışır, sonuç 30 dakikaya kadar KV'de kalır, bir yazma olduğunda invalidatePublicCache() onu da
// temizler.
//
// "projelerin görsellerinin YÜKLEME SIRASINA göre en son yüklenenden ilk yüklenene doğru
// sıralanacağı" — bu SIRALAMA PROJE SEVİYESİNDEDİR (görsel seviyesinde değil): en son eklenen
// PROJENİN tüm görselleri önce gelir, sonra bir önceki proje... `created_at` projenin SİTEYE
// EKLENDİĞİ AN'dır (bkz. schema.sql#projects.created_at) — editoryal sıralamada kullanılan
// COALESCE(relisted_at, publish_date, created_at) BİLEREK KULLANILMAZ: bu sayfa "yükleme
// sırası"nı soruyor, editoryal "1. sırada görünme" sırasını değil (bkz. proje.html'in kendi
// sıralaması — o TAMAMEN farklı bir soru). Bir projenin KENDİ görselleri arasındaki sıra ise
// proje-ekle'deki sürükle-bırak sırasıdır (images[] dizisinin kendi sırası, aynen korunur).
//
// Diğer beş havuzun aksine (architects/offices/products/projects:built/projects:concept) bu havuz
// LİSTE/FİLTRE sayfası için değil — HAM, düzleştirilmiş bir görsel dizisidir; şekillendirme
// (shapeProjectItem benzeri bir dönüşüm) burada YAPILMAZ çünkü tüketicisi TEK (src/routes/
// photos.js) ve o da kendi ihtiyacına göre (sayfalama + mekan filtresi + sahip adı zenginleştirme)
// ayrıca işler.
import { getCachedPool } from './publicCache.js';

async function fetchPhotoPoolRaw(env) {
  // preview_at IS NOT NULL projeler de DAHİL (bkz. projectPool.js#fetchActiveProjectPool'daki AYNI
  // "(hidden_at IS NULL OR preview_at IS NOT NULL)" kuralı — sitedeki HER liste yüzeyiyle tutarlı:
  // önizlemedeki bir proje blurlu olarak açılabiliyor, görselleri de aynı gated-blur yoluyla
  // (src/lib/gatedMedia.js) sunuluyor; burada ayrıca dışlanmasının bir gerekçesi yok.
  const { results } = await env.DB.prepare(
    `SELECT slug, title, location, images, image_spaces, claimed_by_user_id, created_at
     FROM projects
     WHERE deleted_at IS NULL AND (hidden_at IS NULL OR preview_at IS NOT NULL)
     ORDER BY created_at DESC, id DESC`
  ).all();
  const out = [];
  for (const row of results) {
    let images = [];
    try { const parsed = row.images ? JSON.parse(row.images) : []; if (Array.isArray(parsed)) images = parsed; } catch { /* bozuk JSON — bu projenin görselleri atlanır */ }
    if (!images.length) continue;
    let spacesByUrl = {};
    try { const parsed = row.image_spaces ? JSON.parse(row.image_spaces) : {}; if (parsed && typeof parsed === 'object') spacesByUrl = parsed; } catch { /* bozuk JSON — etiketsiz say */ }
    for (const url of images) {
      if (!url || typeof url !== 'string') continue;
      const tags = Array.isArray(spacesByUrl[url]) ? spacesByUrl[url].filter(s => typeof s === 'string') : [];
      out.push({
        url,
        projectSlug: row.slug,
        projectTitle: row.title,
        projectLocation: row.location || null,
        ownerUserId: row.claimed_by_user_id || null,
        spaces: tags,
      });
    }
  }
  return out;
}

export async function fetchPhotoPool(env) {
  return getCachedPool(env, 'photos', () => fetchPhotoPoolRaw(env));
}
