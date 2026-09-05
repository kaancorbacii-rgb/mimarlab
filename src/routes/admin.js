import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser, publicUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { updateUserProfileFields } from './auth.js';
import { listSaved } from './saved.js';
import { myRatings } from './ratings.js';
import { myComments } from './comments.js';
import { SUBMISSION_TYPES, parseSubmissionRow, findInvalidUrlField, findInvalidProjectTaxonomyField, sanitizeImageHotspots } from '../lib/submissionTypes.js';
import { createNotification } from '../lib/notify.js';
import { handleLegacyAdmin, setLegacyHidden } from './legacyContent.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache, ssrPurgeTargetFor } from '../lib/ssrCache.js';
import { cascadeRemovedFounders, cascadeRemovedProfileClaims, renameOfficeEverywhere, renameArchitectEverywhere } from '../lib/officeFounderCascade.js';
import { cascadeDeleteArchitect, cascadeDeleteOffice, cascadeDeleteProject, cascadeDeleteProduct } from '../lib/cascadeDelete.js';
import { handleMigrationConflictsAdmin } from './migrationConflicts.js';
import { handleTop100AdminRoute } from './top100.js';
import { syncApprovedSubmissionToCanonical, markCanonicalDeletedForSubmission, hideCanonicalForUnapprovedSubmission, collectR2MediaKeys, deleteR2MediaKeys, cleanupReplacedR2Media, MEDIA_IMAGE_FIELDS_BY_TYPE } from '../lib/canonicalSync.js';
import { bumpFacetCounts } from '../lib/facetCounts.js';
import { BADGE_RANK } from '../lib/badgeAccess.js';
import { notifyNewsletterOfNewContent } from '../lib/newsletterNotify.js';
import { findR2Orphans, confirmStillOrphaned } from '../lib/r2Reconcile.js';
import { buildMeta } from '../lib/seo.js';
import { getSiteSettings, setSiteSetting, DEFAULT_SETTINGS } from '../lib/siteSettings.js';
import { SAFE_STORAGE_BYTES, SAFE_OPS_PER_MONTH } from '../lib/r2Quota.js';
import { SAFE_WRITES_PER_DAY } from '../lib/kvQuota.js';
import { rebuildIndex, indexStatus, INDEX_TYPES } from '../lib/visualIndexStore.js';
import { removeEntityImages } from '../lib/imageEmbedStore.js';

// canonical modelde karşılığı olan tipler (bkz. migrations/0022_id_first_entities.sql) — news
// bu modelin dışında, syncApprovedSubmissionToCanonical zaten bunlar için no-op ama burada da
// açıkça belirtmek çağıran yeri okunaklı kılıyor.
const CANONICAL_TYPES = new Set(['architects', 'offices', 'projects', 'products', 'materials']);
// facet_counts yalnızca bu ikisi için doldurulur (bkz. src/lib/facetCounts.js dosya başı kapsam notu).
// audit bulgusu: 'products'/'materials' burada hâlâ duruyordu ama facetCounts.js#bumpFacetCounts
// artık yalnızca 'projects' için çalışıyor (ürün/malzeme facet okuyucusu kaldırıldı, bkz. o dosyanın
// dosya başı yorumu) — ikisi de zaten no-op'tu, yalnızca kod okuyanı yanıltıyordu.
const FACET_TYPES = new Set(['projects']);

// bkz. src/routes/submissions.js#RENAME_CASCADE_BY_TYPE (aynı eşleme) — admin panelinden doğrudan
// isim değiştirmenin kapsandığı tipler.
const RENAME_CASCADE_BY_TYPE = { offices: renameOfficeEverywhere, architects: renameArchitectEverywhere };

// Bir <tip>_submissions satırı KALICI OLARAK silindiğinde (bkz. handleSubmissionsAdmin DELETE,
// src/routes/legacyContent.js#handleContentAction/handleProjectAction) ilgili cascade fonksiyonunu
// çağırır — bkz. src/lib/cascadeDelete.js (kullanıcı isteği: "bir mimar/ofis/proje/ürünü admin
// panelinden silersem tüm sistemden o bilgi silinsin").
async function runCascadeDelete(env, user, typeKey, row) {
  if (!row) return;
  if (typeKey === 'architects') return cascadeDeleteArchitect(env, row.name);
  if (typeKey === 'offices') return cascadeDeleteOffice(env, user, row.name);
  if (typeKey === 'projects') {
    // Görsel arama VARLIK EMBEDDING dizininden de çıkar (brief madde 13: "deleted project ...
    // embedding index'te kalmasını engelle") — cascadeDeleteProject'in kendi `key` sistemi
    // (engagement anahtarı) farklı olduğundan burada GERÇEK slug ile ayrıca çağrılır. Başarısız
    // olursa (KV geçici hatası) sessizce yutulur — asıl silme işlemini ENGELLEMEMELİ, en kötü
    // durumda o proje bir sonraki manuel temizliğe kadar dizinde "hayalet" kalır.
    const slug = row.claimed_slug || row.slug;
    removeEntityImages(env, 'project', slug).catch(err => console.error('removeEntityImages(project) başarısız', slug, err && err.message));
    return cascadeDeleteProject(env, slug);
  }
  if (typeKey === 'products' || typeKey === 'materials') {
    if (row.slug) removeEntityImages(env, 'product', row.slug).catch(err => console.error('removeEntityImages(product) başarısız', row.slug, err && err.message));
    const engagementType = typeKey === 'materials' ? 'material' : 'product';
    return cascadeDeleteProduct(env, engagementType, `m-${row.id}`);
  }
}

// gerçek bulgu (denetim raporu, 2026-08-16): düz {} obje literalinde TYPE_BY_PATH['__proto__']
// gibi bir sorgu Object.prototype'ı (truthy) döndürüp aşağıdaki `if (!typeKey)` kontrollerini
// atlatabiliyordu (istismar edilebilir bir veri sızıntısı değil — SUBMISSION_TYPES[typeKey]
// undefined kalıp genel try/catch 500'e çeviriyordu — ama ucuza kapatılabilir). Object.create(null)
// prototype zinciri hiç taşımaz, __proto__/constructor/toString gibi miras alınan anahtarlar için
// de undefined döner.
const TYPE_BY_PATH = Object.assign(Object.create(null), {
  offices: 'offices', projects: 'projects', products: 'products', materials: 'materials',
  architects: 'architects',
});

// Hesabim.html'in "Gönderdiğim İçerikler" bölümündeki TYPE_LABELS ile aynı — bildirim metninde
// de aynı Türkçe adlandırma kullanılsın diye burada tekrarlanır.
const SUBMISSION_TYPE_LABELS = { offices: 'Firma', projects: 'Proje', products: 'Ürün', materials: 'Malzeme', architects: 'Mimar' };

const CLAIM_TYPE_LABELS_SERVER = { architect: 'Mimar', office: 'Firma' };
const BADGE_TYPE_LABELS_SERVER = { destekci: 'Destekçi', verified: 'Doğrulanmış Üye', gold: 'Altın Üye', platinum: 'Elmas Üye' };

async function requireAdmin(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return { error: errorJson('Bu işlem için giriş yapmalısın.', 401) };
  if (user.role !== 'admin') return { error: errorJson('Bu işlem için yetkin yok.', 403) };
  return { user };
}

export async function handleAdminRoute(request, env, url) {
  const { user, error } = await requireAdmin(request, env);
  if (error) return error;

  const segments = url.pathname.split('/').filter(Boolean); // ["api", "admin", ...]
  const sub = segments[2];

  // denetim bulgusu: bu dosyadaki 600+ satırlık hiçbir alt-dispatch kendi try/catch'ine sahip
  // değildi, tamamen src/index.js'teki genel catch-all'a güveniyordu — bu, çökmeyi önlese de HANGİ
  // admin alt-rotasının (submissions/claims/badges/...) hataya düştüğünü Workers Logs'ta ayırt
  // edilemez kılıyordu (hepsi aynı jenerik "Sunucu hatası oluştu." kaydı olarak görünüyordu). Her
  // handler'ı ayrı ayrı sarmalamak yerine (12+ nokta, gereksiz risk) TEK bir noktadan `sub` etiketiyle
  // yapılandırılmış loglama eklenir — istemciye dönen yanıt DEĞİŞMEZ, yalnızca teşhis kolaylaşır.
  try {
    if (sub === 'users') return await handleUsersAdmin(request, env, url, segments);
    if (sub === 'legacy') return await handleLegacyAdmin(request, env, url, segments, user);
    if (sub === 'submissions') return await handleSubmissionsAdmin(request, env, url, segments, user);
    if (sub === 'claims') return await handleClaimsAdmin(request, env, url, segments);
    if (sub === 'profile-options') return await handleProfileOptionsAdmin(env, url);
    if (sub === 'corrections') return await handleCorrectionsAdmin(request, env, url, segments);
    if (sub === 'badges') return await handleBadgesAdmin(request, env, url, segments);
    if (sub === 'profile-badge') return await handleProfileBadgeAdmin(request, env, url);
    if (sub === 'contact') return await handleContactAdmin(request, env, segments);
    if (sub === 'comments') return await handleCommentsAdmin(request, env, url, segments);
    if (sub === 'migration-conflicts') return await handleMigrationConflictsAdmin(request, env, url, segments, user);
    if (sub === 'r2-orphans') return await handleR2OrphansAdmin(request, env);
    if (sub === 'seo') return await handleSeoAdmin(request, env, url, segments);
    if (sub === 'settings') return await handleSiteSettingsAdmin(request, env);
    if (sub === 'performance') return await handlePerformanceAdmin(request, env, segments);
    if (sub === 'top100') return await handleTop100AdminRoute(request, env, url, segments);
    if (sub === 'visual-index') return await handleVisualIndexAdmin(request, env, url);
    if (sub === 'summary' && request.method === 'GET') return await handleAdminSummary(env);
    return errorJson('Bulunamadı', 404);
  } catch (err) {
    console.error(JSON.stringify({ event: 'admin_route_failed', sub, method: request.method, reason: (err && err.message) || String(err) }));
    return errorJson('Sunucu hatası oluştu.', 500);
  }
}

// GET /api/admin/r2-orphans — bkz. src/lib/r2Reconcile.js dosya başı tasarım notu: yalnızca hiçbir
// D1 satırından referans edilmeyen `u/` önekli R2 nesnelerini RAPORLAR, hiçbir şeyi kendiliğinden
// silmez (R2 free tier guard ilkesiyle tutarlı — kullanıcı asla beklenmedik bir R2 işlemi istemiyor).
// DELETE /api/admin/r2-orphans — body: { keys: string[] } — admin'in GET'ten görüp SEÇTİĞİ anahtarları
// siler; silmeden önce referans durumu yeniden kontrol edilir (bkz. confirmStillOrphaned).
async function handleR2OrphansAdmin(request, env) {
  if (request.method === 'GET') return json(await findR2Orphans(env));
  if (request.method === 'DELETE') {
    const body = await readJson(request);
    const keys = Array.isArray(body.keys) ? body.keys.filter(k => typeof k === 'string' && k.startsWith('u/')) : [];
    if (!keys.length) return errorJson('Silinecek anahtar listesi (keys) gerekli.');
    const stillOrphaned = await confirmStillOrphaned(env, keys);
    if (stillOrphaned.length) await deleteR2MediaKeys(env, stillOrphaned);
    return json({ deleted: stillOrphaned, skipped: keys.filter(k => !stillOrphaned.includes(k)) });
  }
  return errorJson('Bulunamadı', 404);
}

// type -> canonical tablo/kolon eşlemesi. entity_type olarak src/lib/seo.js#buildMeta'nın kabul
// ettiği TEKİL değerler kullanılır (architect/office/project/product) — seo_overrides.entity_type
// bununla BİREBİR eşleşmeli (bkz. o dosyadaki applySeoOverride), aksi halde admin panelde kaydedilen
// bir override canlı sayfada hiç okunmaz.
const SEO_TYPE_CONFIG = {
  architect: { table: 'architects', nameCol: 'name' },
  office: { table: 'offices', nameCol: 'name' },
  project: { table: 'projects', nameCol: 'title' },
  product: { table: 'products', nameCol: 'title' },
};

// GET /api/admin/seo?type=project&q=...  — proje/mimar/firma/ürün arasında isim/başlık araması,
// her sonuç için o anda bir override var mı bilgisi (liste görünümü hafif kalsın diye türetilmiş
// title/description BURADA hesaplanmaz — bkz. GET /api/admin/seo/:type/:key).
// GET /api/admin/seo/:type/:key  — türetilmiş (buildMeta) + varsa kayıtlı override değerleri.
// PUT /api/admin/seo/:type/:key  — body {meta_title, meta_description}; boş string override'ı SİLER.
async function handleSeoAdmin(request, env, url, segments) {
  if (segments.length === 3 && request.method === 'GET') {
    const type = url.searchParams.get('type');
    const config = SEO_TYPE_CONFIG[type];
    if (!config) return errorJson('Geçersiz tip.');
    const q = (url.searchParams.get('q') || '').trim();
    const rows = q
      ? await env.DB.prepare(`SELECT slug, ${config.nameCol} AS name FROM ${config.table} WHERE deleted_at IS NULL AND hidden_at IS NULL AND ${config.nameCol} LIKE ? ORDER BY ${config.nameCol} LIMIT 30`).bind(`%${q}%`).all()
      : await env.DB.prepare(`SELECT slug, ${config.nameCol} AS name FROM ${config.table} WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY updated_at DESC LIMIT 30`).all();
    const { results: overrideRows } = await env.DB.prepare(`SELECT entity_key FROM seo_overrides WHERE entity_type = ?`).bind(type).all();
    const overridden = new Set(overrideRows.map(r => r.entity_key));
    return json({ items: rows.results.map(r => ({ key: r.slug, name: r.name, hasOverride: overridden.has(r.slug) })) });
  }
  if (segments.length === 5) {
    const type = segments[3];
    const key = segments[4];
    if (!SEO_TYPE_CONFIG[type]) return errorJson('Geçersiz tip.');
    if (request.method === 'GET') {
      // .catch(() => null): buildMeta artık D1 hatasında fırlatıyor (bkz. src/lib/seo.js#
      // MetaLookupError) — bu admin ucunda önceki davranış (hata = "bulunamadı") korunur, tek
      // sonucu admin panelde bir 404 mesajı olduğundan SEO açısından bir etkisi yok.
      const derived = await buildMeta(type, key, env).catch(() => null);
      if (!derived) return errorJson('Bulunamadı', 404);
      const override = await env.DB.prepare(`SELECT meta_title, meta_description FROM seo_overrides WHERE entity_type = ? AND entity_key = ?`).bind(type, key).first();
      return json({ derived: { title: derived.title, description: derived.description }, override: override || null });
    }
    if (request.method === 'PUT') {
      const body = await readJson(request);
      const metaTitle = (body.meta_title || '').trim();
      const metaDescription = (body.meta_description || '').trim();
      if (!metaTitle && !metaDescription) {
        await env.DB.prepare(`DELETE FROM seo_overrides WHERE entity_type = ? AND entity_key = ?`).bind(type, key).run();
      } else {
        await env.DB.prepare(
          `INSERT INTO seo_overrides (entity_type, entity_key, meta_title, meta_description, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(entity_type, entity_key) DO UPDATE SET meta_title = excluded.meta_title, meta_description = excluded.meta_description, updated_at = excluded.updated_at`
        ).bind(type, key, metaTitle || null, metaDescription || null, Date.now()).run();
      }
      await purgeSsrDetailCache(type, key, env);
      return json({ ok: true });
    }
  }
  return errorJson('Bulunamadı', 404);
}

// GET /api/admin/settings — tüm site ayarları (bkz. src/lib/siteSettings.js).
// PATCH /api/admin/settings — body'deki bilinen key'leri tek tek yazar (whitelist — bilinmeyen bir
// key sessizce yok sayılır, setSiteSetting zaten böyle bir key için hata fırlatır).
async function handleSiteSettingsAdmin(request, env) {
  if (request.method === 'GET') return json(await getSiteSettings(env));
  if (request.method === 'PATCH') {
    const body = await readJson(request);
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key in body) await setSiteSetting(env, key, body[key]);
    }
    return json(await getSiteSettings(env));
  }
  return errorJson('Bulunamadı', 404);
}

// GET /api/admin/performance — R2/KV kota kullanımı (bkz. r2Quota.js/kvQuota.js) + içerik tablosu
// satır sayıları, admin panelde tek bakışta "canlı site ne kadar büyük/kotaya ne kadar yakın"
// görünürlüğü için. POST /api/admin/performance/purge-cache — publicCache.js/FACET_CACHE'i temizler
// (bkz. çağrı noktasındaki PoP-local uyarı notu, admin.html'de AYNEN gösterilir).
async function handlePerformanceAdmin(request, env, segments) {
  if (segments.length === 3 && request.method === 'GET') {
    const [r2Row, kvRow, projects, architects, offices, products, comments, ratings] = await Promise.all([
      env.DB.prepare(`SELECT total_bytes, ops_count, ops_month FROM r2_usage WHERE id = 'singleton'`).first(),
      env.DB.prepare(`SELECT writes_count, writes_day FROM kv_usage WHERE id = 'singleton'`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS c FROM projects WHERE deleted_at IS NULL`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS c FROM architects WHERE deleted_at IS NULL`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS c FROM offices WHERE deleted_at IS NULL`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS c FROM products WHERE deleted_at IS NULL`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS c FROM comments`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS c FROM ratings`).first(),
    ]);
    return json({
      r2: { totalBytes: r2Row?.total_bytes || 0, opsCount: r2Row?.ops_count || 0, safeStorageBytes: SAFE_STORAGE_BYTES, safeOpsPerMonth: SAFE_OPS_PER_MONTH },
      kv: { writesCount: kvRow?.writes_count || 0, writesDay: kvRow?.writes_day || '', safeWritesPerDay: SAFE_WRITES_PER_DAY },
      counts: { projects: projects.c, architects: architects.c, offices: offices.c, products: products.c, comments: comments.c, ratings: ratings.c },
    });
  }
  if (segments.length === 4 && segments[3] === 'purge-cache' && request.method === 'POST') {
    await invalidatePublicCache(env);
    if (env.FACET_CACHE) await env.FACET_CACHE.delete('site_settings_v1');
    try { await caches.default.delete(new Request('https://mimarlab.com/sitemap.xml')); } catch {}
    return json({ ok: true, note: "Bu işlem yalnızca isteği işleyen edge PoP'unu temizler, global anında temizlik garantisi yoktur." });
  }
  return errorJson('Bulunamadı', 404);
}

// GET  /api/admin/visual-index          — görsel arama varlık dizininin durumu (AI çağrısı YOK).
// POST /api/admin/visual-index?type=project&max=400 — ARTIMLI yeniden kurulum, elle tetikleme.
//
// Normal işleyişte buna gerek YOKTUR: dizini 6 saatte bir cron tazeler (bkz. src/index.js#scheduled)
// ve ilk kurulum scripts/build-visual-index.mjs ile yapılır. Bu uç iki durum için var: (a) dizinin
// gerçekten kurulu olduğunu canlıda doğrulamak, (b) toplu bir import sonrası cron turunu beklemeden
// dizini elle tazelemek. Yetki, dosyanın tamamı gibi handleAdminRoute'un requireAdmin kapısındadır.
async function handleVisualIndexAdmin(request, env, url) {
  if (request.method === 'GET') {
    const types = Object.keys(INDEX_TYPES);
    const status = await Promise.all(types.map(t => indexStatus(env, t)));
    return json({ items: status });
  }
  if (request.method === 'POST') {
    const type = url.searchParams.get('type') || 'project';
    if (!INDEX_TYPES[type]) return errorJson('Geçersiz dizin türü.');
    // Üst sınır kelepçelenir: tek bir istekte binlerce embedding üretmek hem Worker CPU süresini
    // hem de AI maliyetini kontrolsüz bırakırdı. Kalan iş `pending` olarak döner, çağıran döngüye
    // girip bitirebilir (scripts/build-visual-index.mjs bunu yapar).
    const max = Math.max(1, Math.min(400, Number(url.searchParams.get('max')) || 200));
    const res = await rebuildIndex(env, type, { maxEmbeds: max });
    return json(res);
  }
  return errorJson('Bulunamadı', 404);
}

// GET /api/admin/summary — admin.html'deki sekme başlıklarında kırmızı nokta göstermek için
// her sekmenin "bekleyen/dikkat gerektiren" satır sayısını tek bir istekte döner.
async function handleAdminSummary(env) {
  const submissionCounts = await Promise.all(
    Object.values(SUBMISSION_TYPES).map(config =>
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${config.table} WHERE status = 'pending'`).first()
    )
  );
  const pendingSubmissions = submissionCounts.reduce((sum, row) => sum + (row?.n || 0), 0);

  const [claimsRow, correctionsRow, badgesRow, contactRow, migrationRow, commentsRow] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM profile_claims WHERE status = 'pending'`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM profile_corrections WHERE status = 'pending'`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM badge_requests WHERE status = 'pending'`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM contact_messages WHERE is_read = 0`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM migration_name_conflicts WHERE status = 'pending'`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM comments WHERE status = 'pending'`).first(),
  ]);

  return json({
    pendingSubmissions,
    pendingClaims: (claimsRow?.n || 0) + (correctionsRow?.n || 0),
    pendingBadges: badgesRow?.n || 0,
    unreadContact: contactRow?.n || 0,
    pendingMigrationConflicts: migrationRow?.n || 0,
    unseenComments: commentsRow?.n || 0,
  });
}

// /api/admin/comments  (GET: ?status=pending|approved|'' ile filtrelenmiş son yorumları listeler)
// /api/admin/comments/:id  (PATCH: status ve/veya admin_seen günceller, DELETE: siler/reddeder)
// Projelere/haberlere gelen her yeni yorum burada görünür (bkz. kullanıcı isteği: "yorum admin
// paneline düşsün") — status (migrations/0029_comment_moderation.sql) yorumun kamuya açık listede
// görünüp görünmediğini belirler ("Onayla" = status='approved'; "Sil/Reddet" = doğrudan silme,
// profile_corrections'daki 'dismissed' gibi ayrı bir statü tutmaya gerek yok çünkü reddedilen bir
// yorumun kalıcı bir kaydı tutulmasını gerektiren bir akış yok). admin_seen (migrations/
// 0027_comment_admin_seen.sql) BUNDAN bağımsız, "Yeni" rozetini kontrol eden ayrı bir alan.
// architect/office hedefli yorumlar da target_id üzerinden aynı listede görünür, ancak künye
// başlığı yalnızca project için zenginleştirilir çünkü şu an yorum arayüzü yalnızca proje
// sayfalarında etkin (bkz. "Detail page template gaps" belleği). 'news' LEFT JOIN'i 2026-09-05'te
// kaldırıldı: haber özelliği yayından çekilmişti, `news` tablosu düşürüldü (migrations/0090) ve
// admin.html zaten `news_title` alanını HİÇ kullanmıyordu (COMMENT_TARGET_LABELS ile etiketliyor).
async function handleCommentsAdmin(request, env, url, segments) {
  if (segments.length === 3 && request.method === 'GET') {
    const status = url.searchParams.get('status');
    const query = status
      ? env.DB.prepare(
          `SELECT c.id, c.target_type, c.target_id, c.body, c.created_at, c.admin_seen, c.status,
                  u.name AS user_name, u.email AS user_email,
                  p.title AS project_title, p.slug AS project_slug
           FROM comments c
           JOIN users u ON u.id = c.user_id
           LEFT JOIN projects p ON c.target_type = 'project' AND p.slug = c.target_id
           WHERE c.status = ?
           ORDER BY c.created_at DESC
           LIMIT 200`
        ).bind(status)
      : env.DB.prepare(
          `SELECT c.id, c.target_type, c.target_id, c.body, c.created_at, c.admin_seen, c.status,
                  u.name AS user_name, u.email AS user_email,
                  p.title AS project_title, p.slug AS project_slug
           FROM comments c
           JOIN users u ON u.id = c.user_id
           LEFT JOIN projects p ON c.target_type = 'project' AND p.slug = c.target_id
           ORDER BY c.created_at DESC
           LIMIT 200`
        );
    const { results } = await query.all();
    const items = results.map(r => ({
      id: r.id, targetType: r.target_type, targetId: r.target_id, body: r.body,
      created_at: r.created_at, admin_seen: r.admin_seen, status: r.status,
      user_name: r.user_name, user_email: r.user_email,
      targetLabel: r.project_title || r.target_id, // r.news_title kaldırıldı (bkz. yukarıdaki 2026-09-05 notu)
      targetHref: r.project_slug ? `/proje/${encodeURIComponent(r.project_slug)}` : null,
    }));
    return json({ items });
  }
  if (segments.length === 4) {
    const id = segments[3];
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      const updates = [];
      const values = [];
      if (body.status && ['pending', 'approved'].includes(body.status)) {
        updates.push('status = ?');
        values.push(body.status);
      }
      if ('admin_seen' in body) {
        updates.push('admin_seen = ?');
        values.push(body.admin_seen ? 1 : 0);
      }
      if (!updates.length) return errorJson('Güncellenecek bir şey yok.');
      values.push(id);
      await env.DB.prepare(`UPDATE comments SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }
  return errorJson('Bulunamadı', 404);
}

// /api/admin/contact  (GET: listeler)
// /api/admin/contact/:id  (PATCH: is_read günceller, DELETE: siler)
async function handleContactAdmin(request, env, segments) {
  if (segments.length === 3 && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 1000').all();
    return json({ items: results });
  }
  if (segments.length === 4) {
    const id = segments[3];
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      await env.DB.prepare('UPDATE contact_messages SET is_read = ? WHERE id = ?').bind(body.is_read ? 1 : 0, id).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM contact_messages WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }
  return errorJson('Bulunamadı', 404);
}

async function listUsers(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, email, name, dob, school, dept, role, created_at FROM users ORDER BY created_at DESC LIMIT 2000'
  ).all();
  return json({ items: results });
}

// /api/admin/users                          (GET: listUsers, bkz. yukarısı)
// /api/admin/users/:id                       (GET: profil detayı, PATCH: profili düzenle)
// /api/admin/users/:id/submissions?type=X    (GET)
// /api/admin/users/:id/saved                 (GET)
// /api/admin/users/:id/rated                 (GET)
// /api/admin/users/:id/comments              (GET)
// /api/admin/users/:id/claims                (GET)
//
// Admin Paneli > Üyeler listesindeki bir üyeye tıklayınca o kişinin Hesabım sayfasındaki TÜM
// bilgileri (bkz. kullanıcı isteği: "kullanıcıların hesabım sayfasını görme ve düzenleme yetkisine
// sahip olsun") admin.html içinde bir panelde gösterilsin diye eklendi. Profil bilgileri (ad/doğum
// tarihi/üniversite/meslek/pozisyon/hakkında) PATCH ile düzenlenebilir (auth.js#
// updateUserProfileFields ile AYNI doğrulama — kullanıcının kendi PATCH /api/profile'ıyla birebir
// aynı kod yolu). Diğer kutular (Mimar/Firma Profilim, Paylaştığım İçerikler, Kaydettiklerim,
// Beğendiklerim, Yorumlarım) salt-okunur listelenir — içerik düzenlemesi zaten *-ekle.html?edit=
// sayfaları üzerinden mümkün (submissions.js#getOwnSubmission/updateOwnSubmission admin için
// sahiplik kontrolünü zaten atlıyor, bkz. o dosyadaki yorum). Şifre/hesap silme gibi güvenlik
// hassasiyeti yüksek işlemler burada BİLEREK yok — admin bir üyenin şifresini görmemeli/
// değiştirmemeli, hesabını da sessizce silmemeli.
async function handleUsersAdmin(request, env, url, segments) {
  if (segments.length === 3 && request.method === 'GET') return await listUsers(env);

  const targetId = segments[3];
  if (!targetId) return errorJson('Bulunamadı', 404);

  if (segments.length === 4 && request.method === 'GET') return await getUserAdmin(env, targetId);
  if (segments.length === 4 && request.method === 'PATCH') return await updateUserAdmin(request, env, targetId);

  if (segments.length === 5 && request.method === 'GET') {
    const resource = segments[4];
    if (resource === 'submissions') return await listUserSubmissionsAdmin(env, targetId, url);
    if (resource === 'saved') return await listSaved(env, { id: targetId });
    if (resource === 'rated') return await myRatings(env, { id: targetId });
    if (resource === 'comments') return await myComments(env, { id: targetId });
    if (resource === 'claims') return await listUserClaimsAdmin(env, targetId);
  }
  return errorJson('Bulunamadı', 404);
}

async function getUserAdmin(env, targetId) {
  const row = await env.DB.prepare(
    'SELECT id, email, name, dob, school, dept, photo_url, profession, position, awards, about, social_links, role, created_at FROM users WHERE id = ?'
  ).bind(targetId).first();
  if (!row) return errorJson('Kullanıcı bulunamadı.', 404);
  return json({ user: publicUser(row) });
}

async function updateUserAdmin(request, env, targetId) {
  const exists = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(targetId).first();
  if (!exists) return errorJson('Kullanıcı bulunamadı.', 404);
  const body = await readJson(request);
  const result = await updateUserProfileFields(env, targetId, body);
  if (result.error) return errorJson(result.error);
  return json({ user: result.user });
}

async function listUserSubmissionsAdmin(env, targetId, url) {
  const typeKey = TYPE_BY_PATH[url.searchParams.get('type')];
  if (!typeKey) return errorJson('Geçersiz tip.');
  const config = SUBMISSION_TYPES[typeKey];
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${config.table} WHERE owner_user_id = ? ORDER BY created_at DESC`
  ).bind(targetId).all();
  return json({ items: results.map(r => parseSubmissionRow(typeKey, r)) });
}

// submissionId: bu claim'e karşılık gelen architect_submissions/office_submissions satırının id'si
// (bkz. kullanıcı isteği: admin, Üyeler > kullanıcı detayındaki Mimar/Firma Profili'ni de
// düzenleyebilsin) — ud-claims-list'te "Paylaştığım İçerikler" ile AYNI Düzenle linkini
// (*-ekle.html?edit=<submissionId>&stype=) kurabilmek için lazım, profile_claims kendisi bir
// submission id taşımıyor. `id` — DELETE /api/admin/claims/:id ile atamayı kaldırmak (bkz. kullanıcı
// isteği: mimar/firma atama) için client'a geri döner.
async function listUserClaimsAdmin(env, targetId) {
  const { results } = await env.DB.prepare(
    'SELECT id, profile_type, profile_key, status FROM profile_claims WHERE user_id = ? ORDER BY updated_at DESC'
  ).bind(targetId).all();
  const items = await Promise.all(results.map(async (c) => {
    const table = c.profile_type === 'architect' ? 'architect_submissions' : c.profile_type === 'office' ? 'office_submissions' : null;
    let submissionId = null;
    if (table) {
      const row = await env.DB.prepare(
        `SELECT id FROM ${table} WHERE owner_user_id = ? AND claimed_profile_key = ? ORDER BY updated_at DESC LIMIT 1`
      ).bind(targetId, c.profile_key).first();
      submissionId = row ? row.id : null;
    }
    return { ...c, submissionId };
  }));
  return json({ items });
}

// /api/admin/submissions?type=offices&status=pending
// /api/admin/submissions/:type/:id  (PATCH: alanları ve/veya status günceller, DELETE: siler)
async function handleSubmissionsAdmin(request, env, url, segments, user) {
  if (segments.length === 3 && request.method === 'GET') {
    const typeKey = TYPE_BY_PATH[url.searchParams.get('type')];
    if (!typeKey) return errorJson('Geçersiz tip.');
    const status = url.searchParams.get('status');
    const config = SUBMISSION_TYPES[typeKey];
    // LEFT JOIN: eski/statik kayıtlarda owner_user_id NULL olabilir (gerçek bir kullanıcı
    // göndermedi) — admin panelinde "kim gönderdi" bilgisi (bkz. kullanıcı isteği) bu durumda
    // boş kalır, satır yine de listelenir. profile_claims yönetim ekranındaki AYNI u.name/u.email
    // deseni (bkz. yukarıdaki handleClaimsAdmin).
    const query = status
      ? env.DB.prepare(`SELECT s.*, u.name AS submitter_name, u.email AS submitter_email FROM ${config.table} s LEFT JOIN users u ON u.id = s.owner_user_id WHERE s.status = ? ORDER BY s.created_at DESC LIMIT 2000`).bind(status)
      : env.DB.prepare(`SELECT s.*, u.name AS submitter_name, u.email AS submitter_email FROM ${config.table} s LEFT JOIN users u ON u.id = s.owner_user_id ORDER BY s.created_at DESC LIMIT 2000`);
    const { results } = await query.all();
    return json({ items: results.map(r => parseSubmissionRow(typeKey, r)) });
  }

  if (segments.length === 5) {
    const typeKey = TYPE_BY_PATH[segments[3]];
    const id = segments[4];
    if (!typeKey) return errorJson('Geçersiz tip.');
    const config = SUBMISSION_TYPES[typeKey];

    if (request.method === 'PATCH') {
      const body = await readJson(request);
      const existing = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
      if (!existing) return errorJson('Bulunamadı', 404);
      const invalidUrlField = findInvalidUrlField(typeKey, body);
      if (invalidUrlField) return errorJson(`"${invalidUrlField}" alanı geçerli bir bağlantı değil.`);
      const invalidTaxonomyField = findInvalidProjectTaxonomyField(typeKey, body);
      if (invalidTaxonomyField) return errorJson(`"${invalidTaxonomyField}" alanı yalnızca izin verilen seçeneklerden oluşabilir.`);

      const updates = [];
      const values = [];
      if (body.status && ['pending', 'approved', 'rejected'].includes(body.status)) {
        updates.push('status = ?');
        values.push(body.status);
      }
      for (const field of config.fields) {
        if (!(field in body)) continue;
        let value = body[field];
        if (config.arrayFields.includes(field)) value = JSON.stringify(Array.isArray(value) ? value : []);
        // objectFields (bkz. src/lib/submissionTypes.js — şu an yalnızca projects.imageHotspots):
        // arrayFields ile AYNI gerekçe, JSON metne çevrilmeden bind edilirse D1 tip hatası verirdi.
        // Bu uç, proje-ekle.html'in "admin başkasının gönderisini düzenliyor" yolunda kullanılıyor
        // (bkz. o dosyadaki isAdminEditingOther) — o yoldan kaydedilen işaretçiler aksi halde hiç
        // yazılamazdı.
        else if ((config.objectFields || []).includes(field)) {
          const clean = field === 'imageHotspots' ? sanitizeImageHotspots(value)
            : ((value && typeof value === 'object' && !Array.isArray(value)) ? value : {});
          value = Object.keys(clean).length ? JSON.stringify(clean) : null;
        }
        updates.push(`${field} = ?`);
        values.push(value);
      }
      if (!updates.length) return errorJson('Güncellenecek bir şey yok.');
      updates.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);
      await env.DB.prepare(`UPDATE ${config.table} SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

      // Galeriden çıkarılan/üzerine yeni yükleme ile değiştirilen görsellerin eski R2 nesnelerini
      // temizle (bkz. src/lib/canonicalSync.js#cleanupReplacedR2Media, src/routes/submissions.js#
      // updateOwnSubmission'daki AYNI çağrı) — PATCH kısmi olabildiğinden (yalnızca body'de geçen
      // alanlar güncellenir), karşılaştırma için existing üzerine yalnızca body'de geçen alanları
      // uygulayan bir "sonraki durum" satırı kurulur.
      if (CANONICAL_TYPES.has(typeKey)) {
        const mergedRow = { ...existing };
        for (const field of config.fields) {
          if (!(field in body)) continue;
          mergedRow[field] = config.arrayFields.includes(field) ? JSON.stringify(Array.isArray(body[field]) ? body[field] : []) : body[field];
        }
        await cleanupReplacedR2Media(env, typeKey, existing, mergedRow);
      }

      // Kurucular listesinden çıkarılan bir isim varsa, o kişinin kendi office alanını temizle
      // (bkz. src/lib/officeFounderCascade.js — src/routes/submissions.js#updateOwnSubmission'daki
      // aynı çağrı, admin'in doğrudan düzenlediği durum için).
      if (typeKey === 'offices' && 'founders' in body) {
        const oldFounders = parseSubmissionRow('offices', existing).founders;
        const newFounders = Array.isArray(body.founders) ? body.founders : [];
        await cascadeRemovedFounders(env, user, existing.name, oldFounders, newFounders);
        await cascadeRemovedProfileClaims(env, existing.name, newFounders, { founders: true });
      }
      // Ekip kutusundan çıkarılan bir isim, o firmaya onaylı bir profile_claims sahibiyse (bkz.
      // src/lib/officeFounderCascade.js#cascadeRemovedProfileClaims dosya başı yorumu) claim'i de
      // reddedilmiş işaretlenir — admin panelinden Ekip'ten çıkarıp kaydetmek görünürde başarılı
      // olsa da kişi hâlâ firma pop-up'ından/Hesabım'dan silinmiyordu (gerçek bulgu, bkz. kullanıcı
      // isteği).
      if (typeKey === 'offices' && 'team' in body) {
        const newTeam = Array.isArray(body.team) ? body.team : [];
        await cascadeRemovedProfileClaims(env, existing.name, newTeam, { founders: false });
      }

      // Onaylı içerik ya şimdi onaylandı ya da onaylıyken bir alanı/durumu değişti (her iki
      // durumda da public'e yansıyan bir şey değişmiş olabilir) — bkz. src/lib/publicCache.js. BU
      // BLOK, aşağıdaki adminRenameCascade'DEN ÖNCE çalışmalı — bkz. src/routes/submissions.js#
      // updateOwnSubmission'daki AYNI sıralama yorumu/gerekçesi (syncArchitect/syncOffice claimed
      // profilleri claimed_profile_key/SABİT ad ile bulur; cascade önce çalışırsa canonical adı
      // değiştirip senkronun kendi hedefini bulamamasına, ikinci bir "hayalet" kayıt oluşmasına yol açar).
      if (existing.status === 'approved' || body.status === 'approved') {
        // Okuma yolları artık *_submissions'ı DEĞİL, canonical tabloları okuyor (bkz.
        // src/routes/architect.js/office.js/project.js/product.js, Faz 3) — bu yüzden bu satırın
        // canonical karşılığı da AYNI anda güncellenmeli, aksi halde onay ekranda "başarılı" görünür
        // ama site hiçbir şey göstermez (bkz. src/lib/canonicalSync.js dosya başı yorumu).
        if (CANONICAL_TYPES.has(typeKey)) {
          const freshRow = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
          const finalStatus = freshRow.status;
          if (finalStatus === 'approved') {
            const syncedRow = await syncApprovedSubmissionToCanonical(env, typeKey, parseSubmissionRow(typeKey, freshRow));
            // Bülten bildirimi (bkz. src/lib/newsletterNotify.js) — YALNIZCA bu onayla İLK KEZ
            // 'approved'a geçen ve claimed_slug/claimed_profile_key'siz (yani mevcut statik bir
            // kaydın üzerine bindirilen bir düzenleme DEĞİL, gerçekten yeni bir kayıt olan) satırlar
            // için. existing.status !== 'approved' koşulu olmadan onaylı bir kaydın her PATCH'inde
            // (ör. admin bir yazım hatasını düzeltirken) tekrar mail giderdi.
            if (existing.status !== 'approved') {
              const claimedColumn = typeKey === 'projects' ? 'claimed_slug' : (typeKey === 'architects' || typeKey === 'offices') ? 'claimed_profile_key' : null;
              const isClaimEdit = claimedColumn && freshRow[claimedColumn];
              if (!isClaimEdit) await notifyNewsletterOfNewContent(env, typeKey, syncedRow || parseSubmissionRow(typeKey, freshRow));
            }
          } else if (existing.status === 'approved') {
            // onaylıyken reddedildi/pending'e alındı — bkz. src/lib/canonicalSync.js#hideCanonicalForUnapprovedSubmission.
            await hideCanonicalForUnapprovedSubmission(env, typeKey, freshRow);
          }
          if (FACET_TYPES.has(typeKey)) await bumpFacetCounts(env, typeKey);
        }
        await invalidatePublicCache(env);
        // Var olan (güncelleme ÖNCESİ) kaydın kimliğini hedefler — bkz. src/lib/ssrCache.js.
        const target = ssrPurgeTargetFor(typeKey, existing);
        if (target) await purgeSsrDetailCache(target.type, target.key, env);
      }

      // Admin panelinden doğrudan firma/mimar adı değiştirildiyse (bkz. src/routes/submissions.js#
      // updateOwnSubmission'daki AYNI cascade, "Düzenle" formu için) diğer TÜM D1 satırlarını da
      // yeni ada taşı (bkz. src/lib/officeFounderCascade.js#renameOfficeEverywhere/renameArchitectEverywhere) —
      // yukarıdaki senkrondan SONRA çalışır (bkz. o bloğun başındaki yorum).
      const adminRenameCascade = RENAME_CASCADE_BY_TYPE[typeKey];
      if (adminRenameCascade && body.name && body.name !== existing.name && (existing.status === 'approved' || body.status === 'approved')) {
        await adminRenameCascade(env, existing.name, body.name);
        // Cascade isim/slug'ı DB'de değiştirdikten SONRA public liste/pool önbelleğini TEKRAR temizle —
        // yukarıdaki ilk invalidatePublicCache() cascade'den ÖNCE çalıştığından, ikisi arasındaki kısa
        // aralıkta gelen paralel bir istek cache'i ESKİ adla yeniden doldurabilirdi (audit bulgusu,
        // SANKAI kapak görseli bug'ıyla aynı sınıf — bkz. src/lib/publicCache.js dosya başı notu).
        await invalidatePublicCache(env);
      }

      // Bu satır önceden arşivlenmiş bir statik kaydın taslağıysa (bkz. src/routes/legacyContent.js
      // #handleContentAction/handleProjectAction), admin onu burada (Admin Arşiv sekmesindeki özel
      // "Yayınla" DIŞINDA, ör. "Bekleyen Gönderiler" onay akışından) onaylarsa statik kayıt
      // legacy_content_hidden'da gizli KALIRDI — bkz. src/routes/submissions.js#unhideIfClaimedApproved
      // ile aynı düzeltme, gerçek bulgu: GAD Architecture arşivden normal formla düzenlenince
      // sitede tamamen kayboluyordu.
      if (body.status === 'approved') {
        const claimedColumn = typeKey === 'projects' ? 'claimed_slug' : (typeKey === 'architects' || typeKey === 'offices') ? 'claimed_profile_key' : null;
        const claimedValue = claimedColumn && (body[claimedColumn] ?? existing[claimedColumn]);
        if (claimedValue) await setLegacyHidden(env, user, typeKey, claimedValue, false);
      }

      // Durum fiilen değiştiyse (onaylandı/reddedildi) gönderi sahibine bildirim düşer.
      if (body.status && body.status !== existing.status && (body.status === 'approved' || body.status === 'rejected')) {
        const label = SUBMISSION_TYPE_LABELS[typeKey] || typeKey;
        const name = existing.name || existing.title || '';
        if (body.status === 'approved') {
          await createNotification(
            env, existing.owner_user_id, 'submission_approved',
            `${label} gönderin onaylandı`,
            name ? `"${name}" yayına alındı.` : null,
            'hesabim.html'
          );
        } else {
          await createNotification(
            env, existing.owner_user_id, 'submission_rejected',
            `${label} gönderin reddedildi`,
            name ? `"${name}" için gönderdiğin içerik reddedildi.` : null,
            'hesabim.html'
          );
        }
      }
      return json({ ok: true });
    }

    if (request.method === 'DELETE') {
      const existing = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
      const target = existing ? ssrPurgeTargetFor(typeKey, existing) : null;
      // Taslak satırın kendi R2 görselleri — onaylanmış olsun olmasın, satır kalıcı silindiğinde
      // bunlar hiçbir yerden erişilemez hale gelir (bkz. src/lib/canonicalSync.js dosya başı notu).
      if (existing) await deleteR2MediaKeys(env, collectR2MediaKeys(existing, MEDIA_IMAGE_FIELDS_BY_TYPE[typeKey] || {}));
      await env.DB.prepare(`DELETE FROM ${config.table} WHERE id = ?`).bind(id).run();
      await runCascadeDelete(env, user, typeKey, existing);
      // Bu senkron mekanizmasının (bkz. src/lib/canonicalSync.js) bağımsız bir gönderi için
      // ÖNCEDEN oluşturmuş olabileceği canonical satırı da hard-delete eder — claimed'lı kayıtlarda
      // (statik köken) bu no-op'tur, o kaydın kendi yaşam döngüsü legacyContent.js'e ait.
      if (existing && CANONICAL_TYPES.has(typeKey)) await markCanonicalDeletedForSubmission(env, typeKey, existing, user.id);
      if (existing && existing.status === 'approved' && FACET_TYPES.has(typeKey)) await bumpFacetCounts(env, typeKey);
      await invalidatePublicCache(env);
      if (target) await purgeSsrDetailCache(target.type, target.key, env);
      return json({ ok: true });
    }
  }
  return errorJson('Bulunamadı', 404);
}

// GET /api/admin/profile-options?type=architect|office&q=... — Üyeler > kullanıcı detayındaki
// Mimar/Firma Profili atama açılır menüsünü doldurur (bkz. kullanıcı isteği: "admin panelinden tüm
// mimar ve firmaları görebileceğim şekilde açılır bir menü yap"). profile_claims.profile_key HER
// ZAMAN architects[]/offices[].name ile eşleştiğinden (bkz. schema.sql yorumu) burada da slug değil
// name döner — SEO_TYPE_CONFIG'in (yukarıda) aynı tablo eşlemesini kullanır ama farklı bir anahtar
// (name) döndürdüğü için o endpoint'i tekrar kullanmak yerine küçük, amaca özel bir uç eklendi.
const PROFILE_OPTION_TABLE = { architect: 'architects', office: 'offices' };
async function handleProfileOptionsAdmin(env, url) {
  const table = PROFILE_OPTION_TABLE[url.searchParams.get('type')];
  if (!table) return errorJson('Geçersiz tip.');
  const q = (url.searchParams.get('q') || '').trim();
  const rows = q
    ? await env.DB.prepare(`SELECT name FROM ${table} WHERE deleted_at IS NULL AND name LIKE ? ORDER BY name LIMIT 50`).bind(`%${q}%`).all()
    : await env.DB.prepare(`SELECT name FROM ${table} WHERE deleted_at IS NULL ORDER BY name LIMIT 50`).all();
  return json({ items: rows.results.map(r => r.name) });
}

// /api/admin/claims?status=pending
// /api/admin/claims/:id  (PATCH: status günceller — approved/rejected, DELETE: atamayı kaldırır)
// /api/admin/claims  (POST: admin bir mimar/firma profilini bir kullanıcıya DOĞRUDAN atar — bkz.
// kullanıcı isteği: "Adminin bir mimar ya da firmayı bir kullanıcı üzerine atama yetkisi olsun",
// aşağıdaki normal onay akışının (sahiplenme talebi + admin onayı) kısayolu, sonuç AYNI approved
// profile_claims satırı)
//
// office_position — bir firma/marka talebini onaylarken admin'in AÇIKÇA seçebildiği (ve varsayılan
// olarak kullanıcının o anki position'ından gelen) dondurulmuş pozisyon. gerçek bulgu (denetim,
// 2026-09-04, canlı veri: "MEEZ Mimarlık" talebi): kullanıcı kendi profilinde hiç Pozisyon
// seçmemişse office_position NULL olarak donuyor ve onay HİÇBİR düzenleme yetkisi vermiyordu —
// ne kullanıcıya ne admin'e bir uyarı çıkmadan. Admin panelinde artık bir pozisyon seçici + uyarı
// var (bkz. admin.html#loadOwnershipClaims), bu uç de o seçimi kabul eder.
const OFFICE_POSITIONS_ADMIN = new Set([
  'Kurucu', 'Kurucu Ortak', 'Ortak', 'Ekip Lideri', 'Ekip Üyesi',
  'Akademisyen', 'Serbest Çalışan', 'Öğrenci', 'Emekli', 'İşsiz',
]);
function normalizeOfficePosition(value) {
  const v = (value || '').trim();
  return OFFICE_POSITIONS_ADMIN.has(v) ? v : null;
}

async function handleClaimsAdmin(request, env, url, segments) {
  if (segments.length === 3 && request.method === 'POST') {
    const body = await readJson(request);
    const userId = (body.userId || '').trim();
    const profileType = body.profileType;
    const profileKey = (body.profileKey || '').trim();
    if (!userId || !['architect', 'office'].includes(profileType) || !profileKey) return errorJson('Geçersiz istek.');
    const userRow = await env.DB.prepare('SELECT id, position FROM users WHERE id = ?').bind(userId).first();
    if (!userRow) return errorJson('Kullanıcı bulunamadı.', 404);
    const table = PROFILE_OPTION_TABLE[profileType];
    const profileRow = await env.DB.prepare(`SELECT id FROM ${table} WHERE deleted_at IS NULL AND name = ?`).bind(profileKey).first();
    if (!profileRow) return errorJson('Böyle bir profil bulunamadı.', 404);
    const now = Date.now();
    // bkz. migrations/0068 — office_position, admin BU ANDA gördüğü/onayladığı position'ın
    // dondurulmuş kopyası; kullanıcının sonradan kendi profilinden değiştirdiği position bu
    // atamanın yetkisini artık ETKİLEMEZ (P1 güvenlik düzeltmesi).
    // body.officePosition — admin açıkça bir pozisyon gönderdiyse o kazanır (bkz. dosya üstündeki
    // OFFICE_POSITIONS_ADMIN gerekçesi), aksi halde kullanıcının o anki position'ı dondurulur.
    const officePosition = profileType === 'office'
      ? (normalizeOfficePosition(body.officePosition) || userRow.position || null)
      : null;
    const existing = await env.DB.prepare(
      'SELECT id FROM profile_claims WHERE user_id = ? AND profile_type = ? AND profile_key = ?'
    ).bind(userId, profileType, profileKey).first();
    if (existing) {
      await env.DB.prepare('UPDATE profile_claims SET status = ?, office_position = ?, updated_at = ? WHERE id = ?').bind('approved', officePosition, now, existing.id).run();
    } else {
      await env.DB.prepare(
        'INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, note, created_at, updated_at, office_position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(newId(), userId, profileType, profileKey, 'approved', null, now, now, officePosition).run();
    }
    // bkz. aşağıdaki PATCH onay dalındaki AYNI invalidation gerekçesi — /api/public/badges bu tabloya
    // doğrudan JOIN olduğundan.
    await invalidatePublicCache(env);
    const typeLabel = CLAIM_TYPE_LABELS_SERVER[profileType] || profileType;
    await createNotification(
      env, userId, 'claim_approved',
      `${typeLabel} profili hesabına bağlandı`,
      `"${profileKey}" profilini artık Hesabım sayfandan düzenleyebilirsin.`,
      'hesabim.html'
    );
    return json({ ok: true });
  }

  if (segments.length === 4 && request.method === 'DELETE') {
    const id = segments[3];
    const claim = await env.DB.prepare('SELECT user_id FROM profile_claims WHERE id = ?').bind(id).first();
    if (!claim) return errorJson('Bulunamadı', 404);
    await env.DB.prepare('DELETE FROM profile_claims WHERE id = ?').bind(id).run();
    await invalidatePublicCache(env);
    return json({ ok: true });
  }

  if (segments.length === 3 && request.method === 'GET') {
    const status = url.searchParams.get('status');
    // u.position — bkz. kullanıcı isteği: admin bir ofis talebinin "firma sahibi" mi yoksa (Kurucu/
    // Kurucu Ortak DIŞINDA bir pozisyonla) "ekip üyeliği" mi anlamına geleceğini onaylamadan önce
    // görebilsin (bkz. src/routes/office.js#buildOfficePayload Kurucu/Ekip ayrımıyla AYNI kaynak).
    const query = status
      ? env.DB.prepare(
          `SELECT c.*, u.name AS user_name, u.email AS user_email, u.position AS user_position FROM profile_claims c
           JOIN users u ON u.id = c.user_id WHERE c.status = ? ORDER BY c.created_at DESC`
        ).bind(status)
      : env.DB.prepare(
          `SELECT c.*, u.name AS user_name, u.email AS user_email, u.position AS user_position FROM profile_claims c
           JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC`
        );
    const { results } = await query.all();
    return json({ items: results });
  }

  if (segments.length === 4 && request.method === 'PATCH') {
    const id = segments[3];
    const body = await readJson(request);
    if (!['approved', 'rejected'].includes(body.status)) return errorJson('Geçersiz durum.');
    const claim = await env.DB.prepare(
      'SELECT user_id, profile_type, profile_key FROM profile_claims WHERE id = ?'
    ).bind(id).first();
    if (!claim) return errorJson('Bulunamadı', 404);
    // bkz. migrations/0068 + yukarıdaki POST dalındaki AYNI gerekçe: onaylanan bir office claim'i,
    // admin'in BU ANDA (GET /api/admin/claims yanıtındaki u.position AS user_position ile) gördüğü
    // position değerini dondurur — kullanıcının sonradan kendi profilinden değiştirdiği position bu
    // onayın yetkisini artık ETKİLEMEZ (P1 güvenlik düzeltmesi). Admin bir claim'i tekrar
    // onaylarsa (bu uç yeniden çağrılırsa) snapshot o andaki güncel position ile YENİLENİR.
    let officePositionUpdate = '';
    const bindArgs = [body.status, Date.now()];
    if (body.status === 'approved' && claim.profile_type === 'office') {
      const claimUser = await env.DB.prepare('SELECT position FROM users WHERE id = ?').bind(claim.user_id).first();
      officePositionUpdate = ', office_position = ?';
      // bkz. dosya üstündeki OFFICE_POSITIONS_ADMIN gerekçesi — admin panelindeki pozisyon seçici
      // bu alanı gönderir; gönderilmezse (eski istemci) davranış aynen korunur.
      bindArgs.push(normalizeOfficePosition(body.officePosition) || (claimUser ? (claimUser.position || null) : null));
    }
    bindArgs.push(id);
    await env.DB.prepare(
      `UPDATE profile_claims SET status = ?, updated_at = ?${officePositionUpdate} WHERE id = ?`
    ).bind(...bindArgs).run();
    // audit bulgusu: diğer 13 admin mutasyon noktasının aksine bu uç invalidatePublicCache()
    // çağırmıyordu — /api/public/badges (bkz. src/routes/badges.js#computeBadgesPayload) doğrudan
    // `profile_claims.status = 'approved'` filtresine JOIN olduğundan, bir talep onaylandığında/
    // reddedildiğinde o profilin rozet görünümü en fazla ANON_CACHE_HEADERS penceresi (15sn) kadar
    // eski kalabiliyordu.
    await invalidatePublicCache(env);

    const typeLabel = CLAIM_TYPE_LABELS_SERVER[claim.profile_type] || claim.profile_type;
    if (body.status === 'approved') {
      await createNotification(
        env, claim.user_id, 'claim_approved',
        `${typeLabel} profili talebin onaylandı`,
        `"${claim.profile_key}" profilini artık Hesabım sayfandan düzenleyebilirsin.`,
        'hesabim.html'
      );
    } else {
      await createNotification(
        env, claim.user_id, 'claim_rejected',
        `${typeLabel} profili talebin reddedildi`,
        `"${claim.profile_key}" için gönderdiğin sahiplenme talebi reddedildi.`,
        'hesabim.html'
      );
    }
    return json({ ok: true });
  }
  return errorJson('Bulunamadı', 404);
}

// /api/admin/corrections?status=pending
// /api/admin/corrections/:id  (PATCH: status günceller — resolved/dismissed)
async function handleCorrectionsAdmin(request, env, url, segments) {
  if (segments.length === 3 && request.method === 'GET') {
    const status = url.searchParams.get('status');
    const query = status
      ? env.DB.prepare(
          `SELECT c.*, u.name AS user_name, u.email AS user_email FROM profile_corrections c
           JOIN users u ON u.id = c.user_id WHERE c.status = ? ORDER BY c.created_at DESC`
        ).bind(status)
      : env.DB.prepare(
          `SELECT c.*, u.name AS user_name, u.email AS user_email FROM profile_corrections c
           JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC`
        );
    const { results } = await query.all();
    return json({ items: results });
  }

  if (segments.length === 4 && request.method === 'PATCH') {
    const id = segments[3];
    const body = await readJson(request);
    if (!['resolved', 'dismissed'].includes(body.status)) return errorJson('Geçersiz durum.');
    const result = await env.DB.prepare(
      'UPDATE profile_corrections SET status = ?, updated_at = ? WHERE id = ?'
    ).bind(body.status, Date.now(), id).run();
    if (!result.meta.changes) return errorJson('Bulunamadı', 404);
    // bkz. yukarıdaki handleClaimsAdmin'deki AYNI ekleme — tutarlılık için (diğer 13 admin mutasyon
    // noktasıyla aynı desen), bu uç bugüne kadar hiçbir public önbelleği hedeflemiyor olsa da.
    await invalidatePublicCache(env);
    return json({ ok: true });
  }
  return errorJson('Bulunamadı', 404);
}

const BADGE_RENTAL_MS = 30 * 24 * 60 * 60 * 1000; // rozetler aylık kiralanır

// /api/admin/badges?status=pending
// /api/admin/badges/:id  (PATCH: status günceller — active/rejected)
async function handleBadgesAdmin(request, env, url, segments) {
  if (segments.length === 3 && request.method === 'GET') {
    const status = url.searchParams.get('status');
    const query = status
      ? env.DB.prepare(
          `SELECT b.*, u.name AS user_name, u.email AS user_email FROM badge_requests b
           JOIN users u ON u.id = b.user_id WHERE b.status = ? ORDER BY b.created_at DESC`
        ).bind(status)
      : env.DB.prepare(
          `SELECT b.*, u.name AS user_name, u.email AS user_email FROM badge_requests b
           JOIN users u ON u.id = b.user_id ORDER BY b.created_at DESC`
        );
    const { results } = await query.all();
    return json({ items: results });
  }

  if (segments.length === 4 && request.method === 'PATCH') {
    const id = segments[3];
    const body = await readJson(request);
    if (!['active', 'rejected'].includes(body.status)) return errorJson('Geçersiz durum.');
    const now = Date.now();
    const row = await env.DB.prepare('SELECT user_id, badge_type, target_type, target_key FROM badge_requests WHERE id = ?').bind(id).first();
    if (!row) return errorJson('Bulunamadı', 404);
    if (body.status === 'active') {
      // Bir kullanıcı aynı HEDEF (target_type+target_key) için aynı anda yalnızca 1 rozet
      // tutabilir: bu onaylanınca aynı kullanıcının AYNI HEDEFE ait başka bekleyen/aktif rozet
      // taleplerini geçersiz kıl — farklı hedefler (kendisi + her marka) birbirini etkilemez.
      await env.DB.prepare(
        `UPDATE badge_requests SET status = 'rejected', updated_at = ? WHERE user_id = ? AND target_type = ? AND target_key IS ? AND id != ? AND status IN ('pending', 'active')`
      ).bind(now, row.user_id, row.target_type, row.target_key, id).run();
      await env.DB.prepare(
        `UPDATE badge_requests SET status = 'active', expires_at = ?, updated_at = ? WHERE id = ?`
      ).bind(now + BADGE_RENTAL_MS, now, id).run();
    } else {
      await env.DB.prepare(
        'UPDATE badge_requests SET status = ?, updated_at = ? WHERE id = ?'
      ).bind(body.status, now, id).run();
    }

    const badgeLabel = BADGE_TYPE_LABELS_SERVER[row.badge_type] || row.badge_type;
    if (body.status === 'active') {
      await createNotification(
        env, row.user_id, 'badge_approved',
        `${badgeLabel} rozet talebin onaylandı`,
        'Rozetin artık aktif — Hesabım sayfandan durumunu görebilirsin.',
        'hesabim.html'
      );
    } else {
      await createNotification(
        env, row.user_id, 'badge_rejected',
        `${badgeLabel} rozet talebin reddedildi`,
        null,
        'hesabim.html'
      );
    }
    // /api/public/badges artık edge/tarayıcı önbelleğinin TAMAMEN DIŞINDA (bkz. publicCache.js#
    // BADGE_NO_CACHE_HEADERS, kökten bulgu 2026-08-16 — PoP-başına invalidation'ın bıraktığı
    // gecikme penceresini kapatmak için), bu yüzden buradaki çağrı artık badge görünümü için
    // gerekli DEĞİL; diğer 13 admin mutasyon noktasıyla tutarlılık için (ör. ileride başka bir
    // uç buraya eklenirse) bir güvenlik ağı olarak bırakıldı.
    await invalidatePublicCache(env);
    return json({ ok: true });
  }
  return errorJson('Bulunamadı', 404);
}

// iz-birakan: "İz Bırakanlar" (bkz. kullanıcı isteği) — vefat etmiş mimarlar için siyah rozet,
// admin kisi-ekle.html'deki AYNI rozet seçicisinden (bkz. o dosyadaki #admin-badge-select) elle
// verir; src/routes/badges.js#handlePublicBadges bu rozeti taşıyan bir profilin diğer TÜM
// rozetlerini (satın alınmış olsa bile) gizler — mavi Doğrulanmış Üye rozetinin YERİNİ alır.
const ADMIN_GRANTABLE_BADGES = new Set(['verified', 'gold', 'iz-birakan']);

// GET/PUT /api/admin/profile-badge?profileType=architect|office&profileKey=<isim> — admin'in
// bir mimar/marka profiline satın alma/sahiplenme olmadan doğrudan verdiği rozet (bkz. schema.sql#
// admin_badges, kullanıcı isteği: "Admin mimar veya marka profilini düzenlerken istediği rozeti
// seçebilsin ve profile ekleyebilsin. Adminin yaptığı bu değişiklik hemen canlıya yansısın").
// src/routes/badges.js#handlePublicBadges bu tabloyu satın alınan rozetlerle aynı çıktıya
// birleştirir. gecikme geçmişi: bir ara /api/public/badges publicCache.js#CACHEABLE_PATHS'te
// edge-önbellekliydi ve PUT altındaki invalidatePublicCache() çağrısı bunu temizliyordu — ama
// caches.default PoP-başına olduğundan admin farklı bir PoP'tan kontrol ederse hâlâ en fazla
// s-maxage (15sn) kadar eski rozeti görebiliyordu ("hemen canlıya yansısın" isteğini karşılamıyordu).
// Kökten çözüm (2026-08-16): /api/public/badges artık publicCache.js#BADGE_NO_CACHE_HEADERS ile
// edge/tarayıcı önbelleğinin TAMAMEN DIŞINDA — her istek D1'den taze okur, PUT altındaki
// invalidatePublicCache() çağrısı artık badge görünümü için gerekli DEĞİL (diğer mutasyon
// noktalarıyla tutarlılık için güvenlik ağı olarak bırakıldı).
async function handleProfileBadgeAdmin(request, env, url) {
  const profileType = url.searchParams.get('profileType');
  const profileKey = (url.searchParams.get('profileKey') || '').trim();
  if (!['architect', 'office'].includes(profileType) || !profileKey) return errorJson('Geçersiz profil.');

  if (request.method === 'GET') {
    // Bu kutu artık yalnızca admin_badges'i değil, satın alınıp onaylanmış (aktif) rozeti de
    // yansıtır (bkz. kullanıcı isteği: "kutu dinamik olsun" — admin, bir kullanıcının satın
    // alarak kazandığı rozeti burada "Rozet yok" olarak görüp yanlışlıkla boş sanmasın).
    // src/routes/badges.js#computeBadgesPayload'daki AYNI profile_claims+badge_requests join'i,
    // tek bir profileType/profileKey'e daraltılmış hali. 'source' alanı istemciye bu değerin
    // admin override'tan mı yoksa bir satın almadan mı geldiğini bildirir — PUT davranışını
    // DEĞİŞTİRMEZ, yalnızca gösterim amaçlıdır.
    //
    // Öncelik AYNI computeBadgesPayload'daki gibi: admin_badges'te bir satır VARSA o TEK başına
    // kazanır (kademe farketmez, satın alınan rozet varsa bile GÖRÜNMEZ) — bir profilde asla 2
    // rozet birden gösterilmez (kullanıcı isteği). admin_badges'te satır YOKSA satın alınanlardan
    // en yüksek kademeli olan gösterilir.
    const now = Date.now();
    const [adminRow, { results: purchasedRows }] = await Promise.all([
      env.DB.prepare(`SELECT badge_type FROM admin_badges WHERE profile_type = ? AND profile_key = ?`)
        .bind(profileType, profileKey).first(),
      env.DB.prepare(
        `SELECT b.badge_type FROM profile_claims c
         JOIN badge_requests b ON b.user_id = c.user_id AND b.status = 'active' AND (b.expires_at IS NULL OR b.expires_at > ?) AND b.badge_type != 'destekci'
           AND ((b.target_type = 'self' AND c.profile_type = 'architect') OR (b.target_type = 'office' AND c.profile_type = 'office' AND b.target_key = c.profile_key))
         WHERE c.status = 'approved' AND c.profile_type = ? AND c.profile_key = ?`
      ).bind(now, profileType, profileKey).all(),
    ]);
    const adminBadge = adminRow?.badge_type || null;
    const purchasedBadge = purchasedRows.reduce((best, row) =>
      !best || (BADGE_RANK[row.badge_type] || 0) > (BADGE_RANK[best] || 0) ? row.badge_type : best, null);
    const badgeType = adminBadge || purchasedBadge || null;
    const source = !badgeType ? null : (adminBadge ? 'admin' : 'purchase');
    return json({ badgeType, source });
  }

  if (request.method === 'PUT') {
    const body = await readJson(request);
    const badgeType = body.badgeType || null;
    if (badgeType && !ADMIN_GRANTABLE_BADGES.has(badgeType)) return errorJson('Geçersiz rozet türü.');
    if (!badgeType) {
      await env.DB.prepare(`DELETE FROM admin_badges WHERE profile_type = ? AND profile_key = ?`).bind(profileType, profileKey).run();
    } else {
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO admin_badges (profile_type, profile_key, badge_type, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (profile_type, profile_key) DO UPDATE SET badge_type = excluded.badge_type, updated_at = excluded.updated_at`
      ).bind(profileType, profileKey, badgeType, now).run();
    }
    await invalidatePublicCache(env);
    return json({ ok: true });
  }

  return errorJson('Bulunamadı', 404);
}
