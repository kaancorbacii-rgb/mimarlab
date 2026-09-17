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
// sırası"nı soruyor, editoryal "1. sırada görünme" sırasını değil. Bir projenin KENDİ görselleri
// arasındaki sıra ise proje-ekle'deki sürükle-bırak sırasıdır (images[] dizisinin sırası).
//
// Her görsel şunları taşır (2026-09-17 ikinci tur, madde 4/5/6):
//   credit     — künyedeki MİMARLIK FİRMASI adı, firma yoksa MİMAR adı (kartın altındaki etiket).
//                Kaynak project_designers kenarı (canonical bağ); bağ yoksa künyeye yazıldığı
//                hâliyle ham adlar (office_names_raw / designer_names_raw — bkz. migrations/0120).
//                "Projeyi paylaşan" (claimed_by_user_id/fetchOwnerByline) ARTIK YOK.
//   photographer — görsel başına fotoğrafçı (image_credits[url]), yoksa projenin künyesi
//                (photo_credit_text) — gallery.js#paintCredit ile BİREBİR aynı düşüş kuralı, yani
//                lightbox'taki "© Ad" etiketi proje pop-up'ındakiyle aynı şeyi söyler.
import { getCachedPool } from './publicCache.js';

function parseJsonSafe(text, fallback) {
  if (!text) return fallback;
  try { const v = JSON.parse(text); return v == null ? fallback : v; } catch { return fallback; }
}

async function fetchPhotoPoolRaw(env) {
  // BLURLU (önizleme) PROJELER BURADA GÖSTERİLMEZ (kullanıcı isteği, 2026-09-17 ikinci tur madde
  // 10: "Blurlu görselleri burada gösterme, eğer blurları kalkarsa gösterirsin") — projectPool.js'in
  // "(hidden_at IS NULL OR preview_at IS NOT NULL)" kuralından BİLEREK ayrılır: yalnızca tam
  // yayındaki projeler. Blur kalkınca (hidden_at NULL'a döner) invalidatePublicCache havuzu
  // tazeler ve görseller kendiliğinden belirir.
  const [{ results: projects }, { results: designerRows }] = await Promise.all([
    env.DB.prepare(
      `SELECT id, slug, title, location, images, image_spaces, image_credits, photo_credit_text,
              designer_names_raw, office_names_raw
       FROM projects
       WHERE deleted_at IS NULL AND hidden_at IS NULL
       ORDER BY created_at DESC, id DESC`
    ).all(),
    // Künye bağları TEK taramada: proje başına ilk firma + ilk mimar. Gizli/silinmiş profiller
    // dışarıda (projectPool.js#DESIGNER_JOIN_SQL ile AYNI görünürlük kuralı).
    env.DB.prepare(
      `SELECT pd.project_id, ofc.name AS office_name, ar.name AS architect_name
       FROM project_designers pd
       LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL AND ofc.hidden_at IS NULL
       LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL AND ar.hidden_at IS NULL
       ORDER BY pd.rowid ASC`
    ).all(),
  ]);

  const officeByProject = new Map();
  const architectByProject = new Map();
  for (const r of designerRows || []) {
    if (r.office_name && !officeByProject.has(r.project_id)) officeByProject.set(r.project_id, r.office_name);
    if (r.architect_name && !architectByProject.has(r.project_id)) architectByProject.set(r.project_id, r.architect_name);
  }
  const firstOf = (jsonText) => {
    const arr = parseJsonSafe(jsonText, []);
    return Array.isArray(arr) ? (arr.find(v => typeof v === 'string' && v.trim()) || '').trim() : '';
  };

  const out = [];
  for (const row of projects || []) {
    const images = parseJsonSafe(row.images, []);
    if (!Array.isArray(images) || !images.length) continue;
    const spacesByUrl = parseJsonSafe(row.image_spaces, {});
    const creditsByUrl = parseJsonSafe(row.image_credits, {});
    const office = officeByProject.get(row.id) || firstOf(row.office_names_raw);
    const architect = architectByProject.get(row.id) || firstOf(row.designer_names_raw);
    const credit = office || architect || null;
    const creditType = office ? 'office' : (architect ? 'architect' : null);
    const projectCredit = (row.photo_credit_text || '').trim() || null;
    for (const url of images) {
      if (!url || typeof url !== 'string') continue;
      const tags = Array.isArray(spacesByUrl[url]) ? spacesByUrl[url].filter(s => typeof s === 'string') : [];
      const perImage = typeof creditsByUrl[url] === 'string' ? creditsByUrl[url].trim() : '';
      out.push({
        url,
        projectSlug: row.slug,
        projectTitle: row.title,
        projectLocation: row.location || null,
        credit,
        creditType,
        photographer: perImage || projectCredit,
        spaces: tags,
      });
    }
  }
  return out;
}

export async function fetchPhotoPool(env) {
  return getCachedPool(env, 'photos', () => fetchPhotoPoolRaw(env));
}
