import { json, errorJson } from '../lib/http.js';
import { SUBMISSION_TYPES, parseSubmissionRow } from '../lib/submissionTypes.js';

const TYPE_BY_PATH = {
  offices: 'offices', projects: 'projects', products: 'products', jobs: 'jobs',
  architects: 'architects',
};

// Onaylanmış (status='approved') satırları, statik data.js/projeler-data.js/urunler-data.js
// dizilerindeki mevcut şekle olabildiğince uyacak biçimde dönüştürür — böylece istemci
// tarafında tek satırlık bir fetch+push ile mevcut render() koduna karışabilirler.
function toPublicShape(type, row) {
  const parsed = parseSubmissionRow(type, row);
  if (type === 'offices') {
    return {
      name: parsed.name, loc: parsed.loc, cats: parsed.cats, yil: parsed.yil,
      website: parsed.website, about: parsed.about, logo: parsed.logo_url,
      awards: parsed.awards, source: 'member', submissionId: parsed.id,
    };
  }
  if (type === 'projects') {
    return {
      slug: parsed.slug, title: parsed.title, category: parsed.category, type: parsed.type,
      location: parsed.location, locationDetail: parsed.locationDetail, date: parsed.date,
      dateBucket: parsed.dateBucket, period: parsed.period, designer: parsed.designer,
      photoCredit: { text: parsed.photoCreditText || '', url: parsed.photoCreditUrl || '' },
      description: parsed.description, mostVisited: null, recommendations: [],
      images: parsed.images, brands: parsed.brands, source: 'member', submissionId: parsed.id,
    };
  }
  if (type === 'products') {
    return {
      title: parsed.title, brand: parsed.brand, website: parsed.website, category: parsed.category,
      description: parsed.description, images: parsed.images,
      image: parsed.images && parsed.images[0] ? parsed.images[0] : null,
      source: 'member', submissionId: parsed.id,
    };
  }
  if (type === 'architects') {
    return {
      name: parsed.name, dob: parsed.dob, school: parsed.school, dept: parsed.dept, office: parsed.office,
      role: parsed.position, status: parsed.position, awards: parsed.awards, photo: parsed.photo_url,
      source: 'member', submissionId: parsed.id,
    };
  }
  // jobs
  return {
    title: parsed.title, office: parsed.office, loc: parsed.loc, level: parsed.level,
    role: parsed.role, tags: parsed.tags, domain: parsed.domain, description: parsed.description,
    apply: parsed.apply, image: parsed.image_url, source: 'member', submissionId: parsed.id,
    publishedAt: parsed.published_at || parsed.created_at,
  };
}

const JOB_LISTING_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

// architects/offices'te claimed_profile_key dolu satırlar yeni bir kayıt değil, mevcut statik bir
// profile yapılan bir düzenleme talebidir (bkz. handlePublicProfileEdits) — bu yüzden bu genel
// "yeni kayıt" listesine dahil edilmezler, aksi halde aynı isim iki kez (biri statik biri "yeni
// üye kaydı" olarak) görünürdü.
const CLAIMABLE_TYPES = new Set(['architects', 'offices']);

export async function handlePublicRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "public", "offices"]
  if (segments[2] === 'news') return listPublicNews(env);
  if (segments[2] === 'profile-edits') return handlePublicProfileEdits(env);
  if (segments[2] === 'profile-content') return handlePublicProfileContent(env, url);
  if (segments[2] === 'claim-status') return handlePublicClaimStatus(env, url);

  const typeKey = TYPE_BY_PATH[segments[2]];
  if (!typeKey || request.method !== 'GET') return errorJson('Bulunamadı', 404);

  const config = SUBMISSION_TYPES[typeKey];
  let whereClause = CLAIMABLE_TYPES.has(typeKey)
    ? `WHERE status = 'approved' AND claimed_profile_key IS NULL`
    : `WHERE status = 'approved'`;
  const params = [];
  // İş ilanları 30 gün yayında kalır: published_at'i olmayan (eski/legacy) satırlar için kısıtlama
  // uygulanmaz, olanlar süresi dolunca herkese açık listeden düşer (bkz. migrations/0004_job_expiry.sql).
  if (typeKey === 'jobs') {
    whereClause += ` AND (published_at IS NULL OR published_at > ?)`;
    params.push(Date.now() - JOB_LISTING_DURATION_MS);
  }
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${config.table} ${whereClause} ORDER BY created_at DESC`
  ).bind(...params).all();
  return json({ items: results.map(r => toPublicShape(typeKey, r)) });
}

// GET /api/public/claim-status?profileType=architect|office&profileKey=<isim> — auth gerektirmez.
// Bir profilin, ONU GÖRÜNTÜLEYEN kişiden BAĞIMSIZ olarak, herhangi bir kullanıcı tarafından zaten
// onaylı şekilde sahiplenilip sahiplenilmediğini döner. /api/claims/status (auth gerekli) bunun
// aksine yalnızca O ANDA GİRİŞ YAPMIŞ kullanıcının KENDİ talebinin durumunu döner — bu yüzden bir
// profil BAŞKA bir hesap tarafından zaten onaylanmış olsa bile, farklı bir kullanıcı (ya da hiç
// giriş yapmamış bir ziyaretçi) o profile baktığında hâlâ "Bu profil sana mı ait?" daveti görürdü.
// mimar-detay.html/ofis-detay.html bu genel kontrolü önce yapar; profil zaten sahiplenilmişse
// kutucuğu kimden bakılırsa bakılsın tamamen gizler.
async function handlePublicClaimStatus(env, url) {
  const profileType = url.searchParams.get('profileType');
  const profileKey = (url.searchParams.get('profileKey') || '').trim();
  if (!['architect', 'office'].includes(profileType) || !profileKey) return errorJson('Geçersiz istek.');
  const row = await env.DB.prepare(
    `SELECT id FROM profile_claims WHERE profile_type = ? AND profile_key = ? AND status = 'approved' LIMIT 1`
  ).bind(profileType, profileKey).first();
  return json({ claimed: !!row });
}

// GET /api/public/profile-edits — auth gerektirmez. Onaylı, claimed_profile_key'li architect/office
// gönderilerini { architect: { "İsim": {dob,school,...} }, office: { "İsim": {...} } } şeklinde
// döner; mimar-detay.html/ofis-detay.html bunu statik data.js kaydının üzerine bindirir.
async function handlePublicProfileEdits(env) {
  const [archRes, officeRes] = await Promise.all([
    env.DB.prepare(`SELECT * FROM architect_submissions WHERE status = 'approved' AND claimed_profile_key IS NOT NULL`).all(),
    env.DB.prepare(`SELECT * FROM office_submissions WHERE status = 'approved' AND claimed_profile_key IS NOT NULL`).all(),
  ]);

  const out = { architect: {}, office: {} };
  for (const row of archRes.results) {
    const parsed = parseSubmissionRow('architects', row);
    out.architect[row.claimed_profile_key] = {
      dob: parsed.dob, school: parsed.school, dept: parsed.dept, office: parsed.office,
      role: parsed.position, photo: parsed.photo_url,
    };
  }
  for (const row of officeRes.results) {
    const parsed = parseSubmissionRow('offices', row);
    out.office[row.claimed_profile_key] = {
      loc: parsed.loc, cats: parsed.cats, yil: parsed.yil, website: parsed.website,
      about: parsed.about, logo: parsed.logo_url,
    };
  }
  return json(out);
}

const PROFILE_CONTENT_TYPES = new Set(['architect', 'office']);

// GET /api/public/profile-content?profileType=architect|office&profileKey=<isim> — auth
// gerektirmez. Ürün/haber/iş ilanı gönderilerinde mimar/ofis adını tutan bir alan olmadığından
// (bkz. product_submissions.brand, news_submissions — ikisi de serbest metin, isme göre
// eşleştirilemez), bu profili sahiplenip onayı geçmiş kullanıcı(lar)ın (bkz. profile_claims)
// owner_user_id'si üzerinden eşleştirme yapılır: "kişinin/markanın siteye girdiği" içerik budur.
// mimar-detay.html/ofis-detay.html bunu Projeler'in altında Projeler'le aynı yatay kaydırmalı
// tasarımda gösterir (haber/iş ilanı yalnızca architect için döner).
async function handlePublicProfileContent(env, url) {
  const profileType = url.searchParams.get('profileType');
  const profileKey = (url.searchParams.get('profileKey') || '').trim();
  if (!PROFILE_CONTENT_TYPES.has(profileType) || !profileKey) return errorJson('Geçersiz istek.');

  const { results: claimRows } = await env.DB.prepare(
    `SELECT DISTINCT user_id FROM profile_claims WHERE status = 'approved' AND profile_type = ? AND profile_key = ?`
  ).bind(profileType, profileKey).all();
  const userIds = claimRows.map(r => r.user_id);
  if (!userIds.length) return json({ products: [], news: [], jobs: [] });

  const placeholders = userIds.map(() => '?').join(', ');
  const isArchitect = profileType === 'architect';

  const [productsRes, newsRes, jobsRes] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM product_submissions WHERE status = 'approved' AND owner_user_id IN (${placeholders}) ORDER BY created_at DESC`
    ).bind(...userIds).all(),
    isArchitect
      ? env.DB.prepare(
          `SELECT id, title, category, source, description, image_url FROM news_submissions WHERE status = 'approved' AND owner_user_id IN (${placeholders}) ORDER BY created_at DESC`
        ).bind(...userIds).all()
      : Promise.resolve({ results: [] }),
    isArchitect
      ? env.DB.prepare(
          `SELECT * FROM job_submissions WHERE status = 'approved' AND owner_user_id IN (${placeholders}) ORDER BY created_at DESC`
        ).bind(...userIds).all()
      : Promise.resolve({ results: [] }),
  ]);

  return json({
    products: productsRes.results.map(r => toPublicShape('products', r)),
    news: newsRes.results.map(r => ({
      id: r.id, title: r.title, category: r.category, source: r.source, description: r.description, image: r.image_url,
    })),
    jobs: jobsRes.results.map(r => toPublicShape('jobs', r)),
  });
}

async function listPublicNews(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, category, source, description, image_url, created_at FROM news WHERE published = 1
     UNION ALL
     SELECT id, title, category, source, description, image_url, created_at FROM news_submissions WHERE status = 'approved'
     ORDER BY created_at DESC`
  ).all();
  return json({
    items: results.map(n => ({
      title: n.title, category: n.category, source: n.source, description: n.description,
      image: n.image_url, id: n.id, createdAt: n.created_at,
    })),
  });
}
