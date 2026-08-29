import { json, errorJson } from '../lib/http.js';
import { parseSubmissionRow } from '../lib/submissionTypes.js';
import { ITEM_TYPES } from './saved.js';
import { FOLLOW_TYPES } from './follows.js';
import { handlePublicHidden, handlePublicSearchSuggest, handlePublicSearchFull } from './legacyContent.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { getSiteSettings } from '../lib/siteSettings.js';

// Onaylanmış (status='approved') satırları, statik urunler-data.js/malzemeler-data.js
// dizilerindeki mevcut şekle olabildiğince uyacak biçimde dönüştürür — böylece istemci
// tarafında tek satırlık bir fetch+push ile mevcut render() koduna karışabilirler.
function toPublicShape(type, row) {
  const parsed = parseSubmissionRow(type, row);
  // "X tarafından" satırı (bkz. urun.html/malzeme modalları) için — yalnızca owner join'i yapılmış
  // sorgulardan gelen satırlarda dolu, diğer çağıranlarda sessizce undefined kalır, byline gösterilmez.
  const owner = row.owner_name ? { ownerName: row.owner_name, ownerPhoto: row.owner_photo, ownerBadge: row.owner_badge } : {};
  return {
    title: parsed.title, brand: parsed.brand, architect: parsed.architect, website: parsed.website, category: parsed.category,
    description: parsed.description, images: parsed.images, specs: parsed.specs,
    image: parsed.images && parsed.images[0] ? parsed.images[0] : null,
    slug: row.slug || null,
    source: 'member', submissionId: parsed.id, ...owner,
  };
}

export async function handlePublicRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "public", "offices"]
  if (segments[2] === 'hidden') return handlePublicHidden(request, env);
  if (segments[2] === 'search-suggest') return handlePublicSearchSuggest(request, env, url);
  if (segments[2] === 'search') return handlePublicSearchFull(request, env, url);
  if (segments[2] === 'check-name') return handlePublicCheckName(request, env, url);
  if (segments[2] === 'profile-edits') return handlePublicProfileEdits(request, env);
  if (segments[2] === 'project-edits') return handlePublicProjectEdits(request, env);
  if (segments[2] === 'profile-content') return handlePublicProfileContent(request, env, url);
  if (segments[2] === 'claim-status') return handlePublicClaimStatus(request, env, url);
  if (segments[2] === 'save-count') return handlePublicSaveCount(request, env, url);
  if (segments[2] === 'follow-count') return handlePublicFollowCount(request, env, url);
  if (segments[2] === 'site-settings') return handlePublicSiteSettings(request, env, url);
  return errorJson('Bulunamadı', 404);
}

// GET /api/public/site-settings — auth gerektirmez. Admin panelin Site Ayarları sekmesinden
// (bkz. src/routes/admin.js#handleSiteSettingsAdmin) yönetilen ayarların YALNIZCA public-safe alt
// kümesi — maintenance_mode/robots_txt buradan HİÇ dönülmez (ikisi de zaten sunucu tarafında ayrıca
// uygulanıyor, bkz. src/index.js#maybeServeMaintenancePage/handleRobotsTxt). auth-nav.js (duyuru
// banner'ı) ve index.html (öne çıkan proje sıralaması) tarafından okunur.
async function handlePublicSiteSettings(request, env, url) {
  return cachedPublicJson(request, env, url.pathname, async () => {
    const s = await getSiteSettings(env);
    return {
      announcementEnabled: s.announcement_enabled === '1',
      announcementText: s.announcement_text || '',
      announcementLink: s.announcement_link || '',
      featuredProjectSlugs: (s.featured_project_slugs || '').split(',').map(v => v.trim()).filter(Boolean),
    };
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

// GET /api/public/follow-count?type=architect|office&key=<isim-anahtarı> — auth gerektirmez.
// save-count İLE AYNI desen (yukarısı) — mimar/firma profilindeki Takip Et butonunun yanında toplam
// takipçi sayısını göstermek için (bkz. kullanıcı isteği: "Takip Et (12)").
async function handlePublicFollowCount(request, env, url) {
  const followedType = url.searchParams.get('type');
  const followedKey = (url.searchParams.get('key') || '').trim();
  if (!FOLLOW_TYPES.has(followedType) || !followedKey) return errorJson('Geçersiz istek.');
  return cachedPublicJson(request, env, url.pathname, async () => {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM follows WHERE followed_type = ? AND followed_key = ?'
    ).bind(followedType, followedKey).first();
    return { count: row?.count || 0 };
  });
}

// bkz. src/routes/legacyContent.js#foldTr (AYNI desen, dosyalar arası paylaşılan bir modüle
// çıkarılmadan kopyalanmış — o dosyanın başındaki yorumla aynı gerekçe).
function trLower(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}
function foldTr(s) {
  return trLower(s).replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
}

const CHECK_NAME_TYPES = new Set(['projects', 'architects', 'offices', 'products', 'materials']);

// bkz. src/routes/ratings.js#HREF_BASE_BY_TARGET (AYNI eşleme) — check-name eşleşen kaydın
// detay sayfasına "Projeye/Mimara/Firmaya/Ürüne git." linki için (bkz. kullanıcı isteği).
const CHECK_NAME_HREF_BASE = { projects: '/proje/', architects: '/mimar/', offices: '/firma/', products: '/urun/', materials: '/urun/' };

// GET /api/public/check-name?type=projects|architects|offices|products|materials&name=<metin>
// [&brand=<metin>][&exclude=<metin>][&excludeBrand=<metin>] — auth gerektirmez. proje-ekle.html/
// mimar-ekle.html/firma-ekle.html/urun-ekle.html'in Proje/Mimar/Firma/Ürün Adı kutusuna, o adla
// ZATEN yayınlanmış bir kayıt varsa yazarken canlı uyarı verebilmesi için (bkz. kullanıcı isteği:
// "daha önce siteye yüklenen projelerle aynı isimde proje yüklenemesin"). Karşılaştırma TR-duyarlı
// foldTr ile TAM eşleşme arar (fuzzyMatch'teki kelime-parçalamalı GİBİ DEĞİL — burada amaç "aynı isim",
// alt dize/eş anlamlı eşleşme değil). exclude(Brand), düzenleme sırasında kaydın KENDİ mevcut
// adını/markasını çakışma saymamak için (bkz. istemci tarafı: prefill'de yüklenen orijinal değer).
// products/materials'ta doğal anahtar marka+başlık İKİLİSİDİR (bkz. src/lib/canonicalSync.js#
// canonicalKeyFor — legacy_key = "marka|||başlık"), bu yüzden brand boşken hiç kontrol yapılmaz
// (aynı başlıklı farklı markaların ürünleri meşru — ör. iki markanın "Model A" koltuğu).
// href: eşleşen kaydın detay sayfası (bkz. kullanıcı isteği: "Projeye git./Ürüne git./Mimara git./
// Firmaya git." linki) — kayıt hidden_at'lıysa (admin arşivlemiş) null döner, çünkü detay sayfası
// zaten "bulunamadı" gösterir (bkz. src/routes/project.js#handleProjectDetailRoute: "if (row.hidden_at)
// return { item: null, hidden: true }") — kırık bir linke yönlendirmektense hiç link göstermemek.
async function handlePublicCheckName(request, env, url) {
  const type = url.searchParams.get('type');
  const rawName = (url.searchParams.get('name') || '').trim();
  if (!CHECK_NAME_TYPES.has(type) || !rawName) return json({ exists: false, href: null });
  // D1 audit (2026-08-25) P1-6 — TAM eşleşme arandığından (bkz. dosya başı yorumu) 2 karakterin
  // altında hiçbir gerçek proje/mimar/firma/ürün adına zaten eşleşemez — D1'e hiç gidilmez.
  if (rawName.length < 2) return json({ exists: false, href: null });
  const folded = foldTr(rawName);
  const excludeFolded = foldTr((url.searchParams.get('exclude') || '').trim());
  const hrefFor = (slug) => `${CHECK_NAME_HREF_BASE[type]}${encodeURIComponent(slug)}`;

  // D1 audit (2026-08-25) P1-6 — kök neden düzeltmesi: bu uç önceden yalnızca `url.pathname`'i
  // (sorgu dizesi OLMADAN) cache/single-flight anahtarı olarak geçiyordu — cacheable hale
  // getirmeden ÖNCE bile bu, aynı isolate'e düşen EŞZAMANLI farklı type/name/brand istekleri
  // withSingleFlight altında birbirinin sonucunu paylaşabileceğinden yanlış bir gizli hataydı
  // (gerçek bulgu, kod incelemesiyle yakalandı). Artık diğer arama uçlarıyla (bkz.
  // publicCache.js#CACHEABLE_SEARCH_PATHS) AYNI desen: `url.pathname + url.search`.
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    if (type === 'architects' || type === 'offices') {
      const table = type;
      const { results } = await env.DB.prepare(`SELECT name, slug, hidden_at FROM ${table} WHERE deleted_at IS NULL`).all();
      const match = results.find(r => {
        const f = foldTr(r.name || '');
        return f === folded && !(excludeFolded && f === excludeFolded);
      });
      if (!match) return { exists: false, href: null };
      return { exists: true, href: match.hidden_at ? null : hrefFor(match.slug) };
    }
    if (type === 'projects') {
      const { results } = await env.DB.prepare(`SELECT title, slug, hidden_at FROM projects WHERE deleted_at IS NULL`).all();
      const match = results.find(r => {
        const f = foldTr(r.title || '');
        return f === folded && !(excludeFolded && f === excludeFolded);
      });
      if (!match) return { exists: false, href: null };
      return { exists: true, href: match.hidden_at ? null : hrefFor(match.slug) };
    }
    // products/materials — brand boşsa (ör. mimar/firma marka kutusunu henüz doldurmadan başlığı
    // yazdı) tek başına başlığın anlamı yok, çakışma aranmaz.
    const rawBrand = (url.searchParams.get('brand') || '').trim();
    if (!rawBrand) return { exists: false, href: null };
    const foldedBrand = foldTr(rawBrand);
    const excludeBrandFolded = foldTr((url.searchParams.get('excludeBrand') || '').trim());
    const kind = type === 'products' ? 'product' : 'material';
    const { results } = await env.DB.prepare(`SELECT title, brand_name_raw, slug, hidden_at FROM products WHERE deleted_at IS NULL AND kind = ?`).bind(kind).all();
    const match = results.find(r => {
      const fTitle = foldTr(r.title || '');
      const fBrand = foldTr(r.brand_name_raw || '');
      const isSelf = excludeFolded && excludeBrandFolded && fTitle === excludeFolded && fBrand === excludeBrandFolded;
      return fTitle === folded && fBrand === foldedBrand && !isSelf;
    });
    if (!match) return { exists: false, href: null };
    return { exists: true, href: match.hidden_at ? null : hrefFor(match.slug) };
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

const PROFILE_CONTENT_TYPES = new Set(['architect', 'office']);

// GET /api/public/profile-content?profileType=architect|office&profileKey=<isim> — auth
// gerektirmez. Ürün/malzeme gönderilerinde mimar/ofis adını tutan bir alan olmadığından
// (bkz. product_submissions.brand — serbest metin, isme göre eşleştirilemez), bu profili
// sahiplenip onayı geçmiş kullanıcı(lar)ın (bkz. profile_claims) owner_user_id'si üzerinden
// eşleştirme yapılır: "kişinin/markanın siteye girdiği" içerik budur. mimar-detay.html/
// ofis-detay.html bunu Projeler'in altında Projeler'le aynı yatay kaydırmalı tasarımda gösterir.
async function handlePublicProfileContent(request, env, url) {
  const profileType = url.searchParams.get('profileType');
  const profileKey = (url.searchParams.get('profileKey') || '').trim();
  if (!PROFILE_CONTENT_TYPES.has(profileType) || !profileKey) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, async () => {
    const { results: claimRows } = await env.DB.prepare(
      `SELECT DISTINCT user_id FROM profile_claims WHERE status = 'approved' AND profile_type = ? AND profile_key = ?`
    ).bind(profileType, profileKey).all();
    const userIds = claimRows.map(r => r.user_id);
    if (!userIds.length) return { products: [], materials: [] };

    const placeholders = userIds.map(() => '?').join(', ');

    const [productsRes, materialsRes] = await Promise.all([
      env.DB.prepare(
        `SELECT ps.*, pr.slug AS slug FROM product_submissions ps
         JOIN products pr ON pr.legacy_key = 'submission:' || ps.id AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL
         WHERE ps.status = 'approved' AND ps.owner_user_id IN (${placeholders}) ORDER BY ps.created_at DESC`
      ).bind(...userIds).all(),
      env.DB.prepare(
        `SELECT ms.*, pr.slug AS slug FROM material_submissions ms
         JOIN products pr ON pr.legacy_key = 'submission:' || ms.id AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL
         WHERE ms.status = 'approved' AND ms.owner_user_id IN (${placeholders}) ORDER BY ms.created_at DESC`
      ).bind(...userIds).all(),
    ]);

    return {
      products: productsRes.results.map(r => toPublicShape('products', r)),
      materials: materialsRes.results.map(r => toPublicShape('materials', r)),
    };
  });
}
