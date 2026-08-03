import { json, errorJson } from '../lib/http.js';
import { SUBMISSION_TYPES, parseSubmissionRow } from '../lib/submissionTypes.js';
import { ITEM_TYPES } from './saved.js';
import { handlePublicHidden, handlePublicSearchSuggest } from './legacyContent.js';
import { cachedPublicJson } from '../lib/publicCache.js';

const TYPE_BY_PATH = {
  offices: 'offices', projects: 'projects', products: 'products', materials: 'materials', jobs: 'jobs',
  architects: 'architects',
};

// Onaylanmış (status='approved') satırları, statik data.js/projeler-data.js/urunler-data.js
// dizilerindeki mevcut şekle olabildiğince uyacak biçimde dönüştürür — böylece istemci
// tarafında tek satırlık bir fetch+push ile mevcut render() koduna karışabilirler.
function toPublicShape(type, row) {
  const parsed = parseSubmissionRow(type, row);
  // "X tarafından" satırı (bkz. *-detay.html, urun/malzeme/is-ilani modalları) için — yalnızca
  // owner join'i yapılmış sorgulardan gelen satırlarda dolu (bkz. handlePublicRoute), diğer
  // çağıranlarda (ör. handlePublicProfileContent) sessizce undefined kalır, byline gösterilmez.
  const owner = row.owner_name ? { ownerName: row.owner_name, ownerPhoto: row.owner_photo, ownerBadge: row.owner_badge } : {};
  if (type === 'offices') {
    return {
      name: parsed.name, loc: parsed.loc, cats: parsed.cats, yil: parsed.yil,
      website: parsed.website, about: parsed.about, logo: parsed.logo_url,
      awards: parsed.awards, source: 'member', submissionId: parsed.id, ...owner,
    };
  }
  if (type === 'projects') {
    return {
      slug: parsed.slug, title: parsed.title, category: parsed.category, type: parsed.type,
      discipline: parsed.discipline,
      location: parsed.location, locationDetail: parsed.locationDetail, date: parsed.date,
      dateBucket: parsed.dateBucket, period: parsed.period, designer: parsed.designer,
      photoCredit: { text: parsed.photoCreditText || '', url: parsed.photoCreditUrl || '' },
      description: parsed.description, mostVisited: null, recommendations: [],
      images: parsed.images, brands: parsed.brands, source: 'member', submissionId: parsed.id,
      createdAt: parsed.created_at, ...owner,
    };
  }
  if (type === 'products' || type === 'materials') {
    return {
      title: parsed.title, brand: parsed.brand, architect: parsed.architect, website: parsed.website, category: parsed.category,
      description: parsed.description, images: parsed.images, specs: parsed.specs,
      image: parsed.images && parsed.images[0] ? parsed.images[0] : null,
      source: 'member', submissionId: parsed.id, ...owner,
    };
  }
  if (type === 'architects') {
    return {
      name: parsed.name, dob: parsed.dob, school: parsed.school, dept: parsed.dept, office: parsed.office,
      role: parsed.position, status: parsed.position, awards: parsed.awards, photo: parsed.photo_url,
      about: parsed.about, source: 'member', submissionId: parsed.id, ...owner,
    };
  }
  // jobs
  return {
    title: parsed.title, office: parsed.office, loc: parsed.loc, level: parsed.level,
    role: parsed.role, tags: parsed.tags, domain: parsed.domain, description: parsed.description,
    apply: parsed.apply, image: parsed.image_url, source: 'member', submissionId: parsed.id,
    publishedAt: parsed.published_at || parsed.created_at, ...owner,
  };
}

const JOB_LISTING_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

// architects/offices'te claimed_profile_key, projects'te claimed_slug dolu satırlar yeni bir kayıt
// değil, mevcut statik bir kayda (architects[]/offices[].name ya da projeler[].slug) yapılan bir
// düzenleme talebidir (bkz. handlePublicProfileEdits/handlePublicProjectEdits) — bu yüzden bu genel
// "yeni kayıt" listesine dahil edilmezler, aksi halde aynı kayıt iki kez (biri statik biri "yeni
// üye kaydı" olarak) görünürdü. projects'in claimed_slug'ı yalnızca admin tarafından set edilebilir
// (bkz. src/routes/submissions.js#verifyClaimedSlug) — projelerin mimar/ofis'teki gibi bir sıradan
// üye "sahiplenme" akışı yok.
const CLAIMED_COLUMN_BY_TYPE = { architects: 'claimed_profile_key', offices: 'claimed_profile_key', projects: 'claimed_slug' };

export async function handlePublicRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "public", "offices"]
  if (segments[2] === 'news') return listPublicNews(request, env);
  if (segments[2] === 'hidden') return handlePublicHidden(request, env);
  if (segments[2] === 'search-suggest') return handlePublicSearchSuggest(request, env, url);
  if (segments[2] === 'profile-edits') return handlePublicProfileEdits(request, env);
  if (segments[2] === 'project-edits') return handlePublicProjectEdits(request, env);
  if (segments[2] === 'profile-content') return handlePublicProfileContent(request, env, url);
  if (segments[2] === 'claim-status') return handlePublicClaimStatus(request, env, url);
  if (segments[2] === 'save-count') return handlePublicSaveCount(request, env, url);

  const typeKey = TYPE_BY_PATH[segments[2]];
  if (!typeKey || request.method !== 'GET') return errorJson('Bulunamadı', 404);

  return cachedPublicJson(request, env, url.pathname, async () => {
    const config = SUBMISSION_TYPES[typeKey];
    const claimedColumn = CLAIMED_COLUMN_BY_TYPE[typeKey];
    let whereClause = claimedColumn
      ? `WHERE s.status = 'approved' AND s.${claimedColumn} IS NULL`
      : `WHERE s.status = 'approved'`;
    // Gönderiyi yayınlayan hesabın adı/fotoğrafı ("X tarafından" satırı, bkz. *-detay.html) ve
    // yalnızca KENDİSİ için aldığı (target_type='self') aktif rozeti — marka rozeti burada asla
    // sızmaz, bkz. src/routes/badges.js#handlePublicBadges'teki aynı ayrım.
    const params = [Date.now()];
    // İş ilanları 30 gün yayında kalır: published_at'i olmayan (eski/legacy) satırlar için kısıtlama
    // uygulanmaz, olanlar süresi dolunca herkese açık listeden düşer (bkz. migrations/0004_job_expiry.sql).
    if (typeKey === 'jobs') {
      whereClause += ` AND (s.published_at IS NULL OR s.published_at > ?)`;
      params.push(Date.now() - JOB_LISTING_DURATION_MS);
    }
    const { results } = await env.DB.prepare(
      `SELECT s.*, u.name AS owner_name, u.photo_url AS owner_photo, b.badge_type AS owner_badge
       FROM ${config.table} s
       JOIN users u ON u.id = s.owner_user_id
       LEFT JOIN badge_requests b ON b.user_id = s.owner_user_id AND b.target_type = 'self' AND b.status = 'active'
         AND b.badge_type != 'destekci' AND (b.expires_at IS NULL OR b.expires_at > ?)
       ${whereClause} ORDER BY s.created_at DESC`
    ).bind(...params).all();
    return { items: results.map(r => toPublicShape(typeKey, r)) };
  });
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

const PROFILE_CONTENT_TYPES = new Set(['architect', 'office']);

// GET /api/public/profile-content?profileType=architect|office&profileKey=<isim> — auth
// gerektirmez. Ürün/malzeme/haber gönderilerinde mimar/ofis adını tutan bir alan olmadığından
// (bkz. product_submissions.brand, news_submissions — ikisi de serbest metin, isme göre
// eşleştirilemez), bu profili sahiplenip onayı geçmiş kullanıcı(lar)ın (bkz. profile_claims)
// owner_user_id'si üzerinden eşleştirme yapılır: "kişinin/markanın siteye girdiği" içerik budur.
// mimar-detay.html/ofis-detay.html bunu Projeler'in altında Projeler'le aynı yatay kaydırmalı
// tasarımda gösterir. Ürün/malzeme/haber her iki profil tipinde de gösterilir (bkz. kullanıcı
// isteği: ofis profillerinde de "varsa" ürün/malzeme/haber başlıkları); iş ilanları yalnızca
// architect için döner — ofis profillerinin kendi statik İş İlanları bölümü zaten var (bkz.
// ofis-detay.html#jobListings), burada tekrarlanmasına gerek yok.
async function handlePublicProfileContent(request, env, url) {
  const profileType = url.searchParams.get('profileType');
  const profileKey = (url.searchParams.get('profileKey') || '').trim();
  if (!PROFILE_CONTENT_TYPES.has(profileType) || !profileKey) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, async () => {
    const { results: claimRows } = await env.DB.prepare(
      `SELECT DISTINCT user_id FROM profile_claims WHERE status = 'approved' AND profile_type = ? AND profile_key = ?`
    ).bind(profileType, profileKey).all();
    const userIds = claimRows.map(r => r.user_id);
    if (!userIds.length) return { products: [], materials: [], news: [], jobs: [] };

    const placeholders = userIds.map(() => '?').join(', ');
    const isArchitect = profileType === 'architect';

    const [productsRes, materialsRes, newsRes, jobsRes] = await Promise.all([
      env.DB.prepare(
        `SELECT * FROM product_submissions WHERE status = 'approved' AND owner_user_id IN (${placeholders}) ORDER BY created_at DESC`
      ).bind(...userIds).all(),
      env.DB.prepare(
        `SELECT * FROM material_submissions WHERE status = 'approved' AND owner_user_id IN (${placeholders}) ORDER BY created_at DESC`
      ).bind(...userIds).all(),
      env.DB.prepare(
        `SELECT id, title, category, source, description, image_url FROM news_submissions WHERE status = 'approved' AND owner_user_id IN (${placeholders}) ORDER BY created_at DESC`
      ).bind(...userIds).all(),
      isArchitect
        ? env.DB.prepare(
            `SELECT * FROM job_submissions WHERE status = 'approved' AND owner_user_id IN (${placeholders}) ORDER BY created_at DESC`
          ).bind(...userIds).all()
        : Promise.resolve({ results: [] }),
    ]);

    return {
      products: productsRes.results.map(r => toPublicShape('products', r)),
      materials: materialsRes.results.map(r => toPublicShape('materials', r)),
      news: newsRes.results.map(r => ({
        id: r.id, title: r.title, category: r.category, source: r.source, description: r.description, image: r.image_url,
      })),
      jobs: jobsRes.results.map(r => toPublicShape('jobs', r)),
    };
  });
}

async function listPublicNews(request, env) {
  return cachedPublicJson(request, env, '/api/public/news', async () => {
    const { results } = await env.DB.prepare(
      `SELECT id, title, category, source, description, image_url, created_at, 0 AS is_submission,
              NULL AS owner_name, NULL AS owner_photo, NULL AS owner_badge
       FROM news WHERE published = 1
       UNION ALL
       SELECT n.id, n.title, n.category, n.source, n.description, n.image_url, n.created_at, 1 AS is_submission,
              u.name AS owner_name, u.photo_url AS owner_photo, b.badge_type AS owner_badge
       FROM news_submissions n
       JOIN users u ON u.id = n.owner_user_id
       LEFT JOIN badge_requests b ON b.user_id = n.owner_user_id AND b.target_type = 'self' AND b.status = 'active'
         AND b.badge_type != 'destekci' AND (b.expires_at IS NULL OR b.expires_at > ?)
       WHERE n.status = 'approved'
       ORDER BY created_at DESC`
    ).bind(Date.now()).all();
    return {
      items: results.map(n => ({
        title: n.title, category: n.category, source: n.source, description: n.description,
        image: n.image_url, id: n.id, createdAt: n.created_at,
        // Yalnızca news_submissions kaynaklı satırlarda dolu: haber-detay.html "Gönderiyi Düzenle"
        // butonunu yalnızca gerçek bir gönderisi olan haberlerde göstermek için bunu kullanır — statik
        // news tablosu/haberler-data.js kayıtlarının düzenlenecek bir gönderi karşılığı yoktur.
        submissionId: n.is_submission ? n.id : undefined,
        ownerName: n.owner_name || undefined, ownerPhoto: n.owner_photo || undefined, ownerBadge: n.owner_badge || undefined,
      })),
    };
  });
}
