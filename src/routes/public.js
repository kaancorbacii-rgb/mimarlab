import { errorJson } from '../lib/http.js';
import { parseSubmissionRow } from '../lib/submissionTypes.js';
import { ITEM_TYPES } from './saved.js';
import { handlePublicHidden, handlePublicSearchSuggest, handlePublicSearchFull } from './legacyContent.js';
import { cachedPublicJson } from '../lib/publicCache.js';

export async function handlePublicRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "public", "offices"]
  if (segments[2] === 'hidden') return handlePublicHidden(request, env);
  if (segments[2] === 'search-suggest') return handlePublicSearchSuggest(request, env, url);
  if (segments[2] === 'search') return handlePublicSearchFull(request, env, url);
  if (segments[2] === 'profile-edits') return handlePublicProfileEdits(request, env);
  if (segments[2] === 'project-edits') return handlePublicProjectEdits(request, env);
  if (segments[2] === 'claim-status') return handlePublicClaimStatus(request, env, url);
  if (segments[2] === 'save-count') return handlePublicSaveCount(request, env, url);
  return errorJson('Bulunamadı', 404);
}

// GET /api/public/claim-status?profileType=architect|office&profileKey=<isim> — auth gerektirmez.
// Bir profilin, ONU GÖRÜNTÜLEYEN kişiden BAĞIMSIZ olarak, herhangi bir kullanıcı tarafından zaten
// onaylı şekilde sahiplenilip sahiplenilmediğini döner. /api/claims/status (auth gerekli) bunun
// aksine yalnızca O ANDA GİRİŞ YAPMIŞ kullanıcının KENDİ talebinin durumunu döner — bu yüzden bir
// profil BAŞKA bir hesap tarafından zaten onaylanmış olsa bile, farklı bir kullanıcı (ya da hiç
// giriş yapmamış bir ziyaretçi) o profile baktığında hâlâ "Bu profil sana mı ait?" daveti görürdü.
// mimar-detay.html/ofis-detay.html bu genel kontrolü önce yapar; profil zaten sahiplenilmişse
// kutucuğu kimden bakılırsa bakılsın tamamen gizler.
async function handlePublicClaimStatus(request, env, url) {
  const profileType = url.searchParams.get('profileType');
  const profileKey = (url.searchParams.get('profileKey') || '').trim();
  if (!['architect', 'office'].includes(profileType) || !profileKey) return errorJson('Geçersiz istek.');
  return cachedPublicJson(request, env, url.pathname, async () => {
    const row = await env.DB.prepare(
      `SELECT id FROM profile_claims WHERE profile_type = ? AND profile_key = ? AND status = 'approved' LIMIT 1`
    ).bind(profileType, profileKey).first();
    return { claimed: !!row };
  });
}

// GET /api/public/save-count?type=project|product|material|news|job&key=<slug> — auth gerektirmez.
// Detay sayfalarında Kaydet butonunun yanında "N kez kaydedildi" göstermek için (bkz. proje-detay.html),
// kullanıcı bazlı /api/saved'ın aksine tüm kullanıcılar genelinde toplam sayıyı döner.
async function handlePublicSaveCount(request, env, url) {
  const itemType = url.searchParams.get('type');
  const itemKey = (url.searchParams.get('key') || '').trim();
  if (!ITEM_TYPES.has(itemType) || !itemKey) return errorJson('Geçersiz istek.');
  return cachedPublicJson(request, env, url.pathname, async () => {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM saved_items WHERE item_type = ? AND item_key = ?'
    ).bind(itemType, itemKey).first();
    return { count: row?.count || 0 };
  });
}

// GET /api/public/profile-edits — auth gerektirmez. Onaylı, claimed_profile_key'li architect/office
// gönderilerini { architect: { "İsim": {dob,school,...} }, office: { "İsim": {...} } } şeklinde
// döner; mimar-detay.html/ofis-detay.html bunu statik data.js kaydının üzerine bindirir.
async function handlePublicProfileEdits(request, env) {
  return cachedPublicJson(request, env, '/api/public/profile-edits', async () => {
    const [archRes, officeRes] = await Promise.all([
      env.DB.prepare(`SELECT * FROM architect_submissions WHERE status = 'approved' AND claimed_profile_key IS NOT NULL`).all(),
      env.DB.prepare(`SELECT * FROM office_submissions WHERE status = 'approved' AND claimed_profile_key IS NOT NULL`).all(),
    ]);

    const out = { architect: {}, office: {} };
    for (const row of archRes.results) {
      const parsed = parseSubmissionRow('architects', row);
      out.architect[row.claimed_profile_key] = {
        // bkz. aşağıdaki office overlay'indeki AYNI yorum — yalnızca admin, statik bir mimarın
        // GÖRÜNEN adını claimed_profile_key'den farklı gönderebilir (bkz. src/routes/
        // submissions.js#updateOwnSubmission, kullanıcı isteği: "Admin hesabına ... Mimar
        // düzenle sayfasından Mimar ismi değiştirebilme yetkisi ver").
        name: parsed.name,
        dob: parsed.dob, school: parsed.school, dept: parsed.dept, office: parsed.office,
        role: parsed.position, profession: parsed.profession, photo: parsed.photo_url, about: parsed.about,
      };
    }
    for (const row of officeRes.results) {
      const parsed = parseSubmissionRow('offices', row);
      out.office[row.claimed_profile_key] = {
        // Yalnızca admin, statik bir firmanın GÖRÜNEN adını claimed_profile_key'den farklı
        // gönderebilir (bkz. src/routes/submissions.js#updateOwnSubmission) — name burada name !==
        // claimed_profile_key ise gerçek bir yeniden adlandırmadır, aksi halde statik adla aynıdır
        // (data.js#renameOfficeEverywhere no-op geçer).
        name: parsed.name,
        loc: parsed.loc, cats: parsed.cats, yil: parsed.yil, website: parsed.website,
        about: parsed.about, logo: parsed.logo_url,
      };
    }
    return out;
  });
}

// GET /api/public/project-edits — auth gerektirmez. Onaylı, claimed_slug'lı proje gönderilerini
// { "<slug>": {title, category, ...} } şeklinde döner; proje-detay.html bunu statik projeler[]
// kaydının üzerine bindirir (bkz. mimar-detay.html/ofis-detay.html'deki aynı desen). claimed_slug
// yalnızca admin tarafından oluşturulabildiğinden (bkz. verifyClaimedSlug) burada ek bir yetki
// kontrolüne gerek yok — herkese açık okuma, mimar/ofis düzenlemeleriyle aynı mantık.
async function handlePublicProjectEdits(request, env) {
  return cachedPublicJson(request, env, '/api/public/project-edits', async () => {
    const { results } = await env.DB.prepare(
      `SELECT * FROM project_submissions WHERE status = 'approved' AND claimed_slug IS NOT NULL`
    ).all();

    const out = {};
    for (const row of results) {
      const parsed = parseSubmissionRow('projects', row);
      out[row.claimed_slug] = {
        title: parsed.title, category: parsed.category, type: parsed.type, discipline: parsed.discipline,
        location: parsed.location, locationDetail: parsed.locationDetail,
        date: parsed.date, dateBucket: parsed.dateBucket, designer: parsed.designer,
        photoCredit: { text: parsed.photoCreditText || '', url: parsed.photoCreditUrl || '' },
        description: parsed.description, images: parsed.images, brands: parsed.brands,
      };
    }
    return out;
  });
}
