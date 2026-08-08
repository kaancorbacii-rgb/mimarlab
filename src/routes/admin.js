import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { SUBMISSION_TYPES, parseSubmissionRow, findInvalidUrlField } from '../lib/submissionTypes.js';
import { createNotification } from '../lib/notify.js';
import { handleLegacyAdmin, setLegacyHidden } from './legacyContent.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache, ssrPurgeTargetFor } from '../lib/ssrCache.js';
import { cascadeRemovedFounders, renameOfficeEverywhere, renameArchitectEverywhere } from '../lib/officeFounderCascade.js';
import { cascadeDeleteArchitect, cascadeDeleteOffice, cascadeDeleteProject, cascadeDeleteProduct, cascadeDeleteMisc } from '../lib/cascadeDelete.js';
import { handleMigrationConflictsAdmin } from './migrationConflicts.js';
import { syncApprovedSubmissionToCanonical, markCanonicalDeletedForSubmission, hideCanonicalForUnapprovedSubmission, collectR2MediaKeys, deleteR2MediaKeys, MEDIA_IMAGE_FIELDS_BY_TYPE } from '../lib/canonicalSync.js';
import { bumpFacetCounts } from '../lib/facetCounts.js';

// canonical modelde karşılığı olan tipler (bkz. migrations/0022_id_first_entities.sql) — news
// bu modelin dışında, syncApprovedSubmissionToCanonical zaten bunlar için no-op ama burada da
// açıkça belirtmek çağıran yeri okunaklı kılıyor.
const CANONICAL_TYPES = new Set(['architects', 'offices', 'projects', 'products', 'materials']);
// facet_counts yalnızca bu ikisi için doldurulur (bkz. src/lib/facetCounts.js dosya başı kapsam notu).
const FACET_TYPES = new Set(['projects', 'products', 'materials']);

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
  if (typeKey === 'projects') return cascadeDeleteProject(env, row.claimed_slug || row.slug);
  if (typeKey === 'products') return cascadeDeleteProduct(env, 'product', `m-${row.id}`);
  if (typeKey === 'materials') return cascadeDeleteProduct(env, 'material', `m-${row.id}`);
  if (typeKey === 'news') return cascadeDeleteMisc(env, 'news', row.id);
}

const TYPE_BY_PATH = {
  offices: 'offices', projects: 'projects', products: 'products', materials: 'materials',
  architects: 'architects', news: 'news',
};

// Hesabim.html'in "Gönderdiğim İçerikler" bölümündeki TYPE_LABELS ile aynı — bildirim metninde
// de aynı Türkçe adlandırma kullanılsın diye burada tekrarlanır.
const SUBMISSION_TYPE_LABELS = {
  offices: 'Firma', projects: 'Proje', products: 'Ürün', materials: 'Malzeme', architects: 'Mimar', news: 'Haber',
};

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

  if (sub === 'users' && request.method === 'GET') return listUsers(env);
  if (sub === 'legacy') return handleLegacyAdmin(request, env, url, segments, user);
  if (sub === 'submissions') return handleSubmissionsAdmin(request, env, url, segments, user);
  if (sub === 'claims') return handleClaimsAdmin(request, env, url, segments);
  if (sub === 'corrections') return handleCorrectionsAdmin(request, env, url, segments);
  if (sub === 'badges') return handleBadgesAdmin(request, env, url, segments);
  if (sub === 'profile-badge') return handleProfileBadgeAdmin(request, env, url);
  if (sub === 'contact') return handleContactAdmin(request, env, segments);
  if (sub === 'comments') return handleCommentsAdmin(request, env, url, segments);
  if (sub === 'consultant-bookings') return handleConsultantBookingsAdmin(request, env, url, segments);
  if (sub === 'migration-conflicts') return handleMigrationConflictsAdmin(request, env, url, segments, user);
  if (sub === 'summary' && request.method === 'GET') return handleAdminSummary(env);
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

  const [claimsRow, correctionsRow, badgesRow, contactRow, migrationRow, commentsRow, consultingRow] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM profile_claims WHERE status = 'pending'`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM profile_corrections WHERE status = 'pending'`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM badge_requests WHERE status = 'pending'`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM contact_messages WHERE is_read = 0`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM migration_name_conflicts WHERE status = 'pending'`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM comments WHERE status = 'pending'`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM consultation_requests WHERE status = 'pending'`).first(),
  ]);

  return json({
    pendingSubmissions,
    pendingClaims: (claimsRow?.n || 0) + (correctionsRow?.n || 0),
    pendingBadges: badgesRow?.n || 0,
    unreadContact: contactRow?.n || 0,
    pendingMigrationConflicts: migrationRow?.n || 0,
    unseenComments: commentsRow?.n || 0,
    pendingConsultantBookings: consultingRow?.n || 0,
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
// başlığı yalnızca project/news için zenginleştirilir çünkü şu an yorum arayüzü yalnızca proje/haber
// sayfalarında etkin (bkz. "Detail page template gaps" belleği).
async function handleCommentsAdmin(request, env, url, segments) {
  if (segments.length === 3 && request.method === 'GET') {
    const status = url.searchParams.get('status');
    const query = status
      ? env.DB.prepare(
          `SELECT c.id, c.target_type, c.target_id, c.body, c.created_at, c.admin_seen, c.status,
                  u.name AS user_name, u.email AS user_email,
                  p.title AS project_title, p.slug AS project_slug,
                  n.title AS news_title
           FROM comments c
           JOIN users u ON u.id = c.user_id
           LEFT JOIN projects p ON c.target_type = 'project' AND p.slug = c.target_id
           LEFT JOIN news n ON c.target_type = 'news' AND n.id = c.target_id
           WHERE c.status = ?
           ORDER BY c.created_at DESC
           LIMIT 200`
        ).bind(status)
      : env.DB.prepare(
          `SELECT c.id, c.target_type, c.target_id, c.body, c.created_at, c.admin_seen, c.status,
                  u.name AS user_name, u.email AS user_email,
                  p.title AS project_title, p.slug AS project_slug,
                  n.title AS news_title
           FROM comments c
           JOIN users u ON u.id = c.user_id
           LEFT JOIN projects p ON c.target_type = 'project' AND p.slug = c.target_id
           LEFT JOIN news n ON c.target_type = 'news' AND n.id = c.target_id
           ORDER BY c.created_at DESC
           LIMIT 200`
        );
    const { results } = await query.all();
    const items = results.map(r => ({
      id: r.id, targetType: r.target_type, targetId: r.target_id, body: r.body,
      created_at: r.created_at, admin_seen: r.admin_seen, status: r.status,
      user_name: r.user_name, user_email: r.user_email,
      targetLabel: r.project_title || r.news_title || r.target_id,
      targetHref: r.project_slug ? `/projeler/${encodeURIComponent(r.project_slug)}` : null,
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
    const { results } = await env.DB.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC').all();
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
    'SELECT id, email, name, dob, school, dept, role, created_at FROM users ORDER BY created_at DESC'
  ).all();
  return json({ items: results });
}

// /api/admin/submissions?type=offices&status=pending
// /api/admin/submissions/:type/:id  (PATCH: alanları ve/veya status günceller, DELETE: siler)
async function handleSubmissionsAdmin(request, env, url, segments, user) {
  if (segments.length === 3 && request.method === 'GET') {
    const typeKey = TYPE_BY_PATH[url.searchParams.get('type')];
    if (!typeKey) return errorJson('Geçersiz tip.');
    const status = url.searchParams.get('status');
    const config = SUBMISSION_TYPES[typeKey];
    const query = status
      ? env.DB.prepare(`SELECT * FROM ${config.table} WHERE status = ? ORDER BY created_at DESC`).bind(status)
      : env.DB.prepare(`SELECT * FROM ${config.table} ORDER BY created_at DESC`);
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
        updates.push(`${field} = ?`);
        values.push(value);
      }
      if (!updates.length) return errorJson('Güncellenecek bir şey yok.');
      updates.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);
      await env.DB.prepare(`UPDATE ${config.table} SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

      // Kurucular listesinden çıkarılan bir isim varsa, o kişinin kendi office alanını temizle
      // (bkz. src/lib/officeFounderCascade.js — src/routes/submissions.js#updateOwnSubmission'daki
      // aynı çağrı, admin'in doğrudan düzenlediği durum için).
      if (typeKey === 'offices' && 'founders' in body) {
        const oldFounders = parseSubmissionRow('offices', existing).founders;
        await cascadeRemovedFounders(env, user, existing.name, oldFounders, Array.isArray(body.founders) ? body.founders : []);
      }

      // Admin panelinden doğrudan firma/mimar adı değiştirildiyse (bkz. src/routes/submissions.js#
      // updateOwnSubmission'daki AYNI cascade, "Düzenle" formu için) diğer TÜM D1 satırlarını da
      // yeni ada taşı (bkz. src/lib/officeFounderCascade.js#renameOfficeEverywhere/renameArchitectEverywhere).
      const adminRenameCascade = RENAME_CASCADE_BY_TYPE[typeKey];
      if (adminRenameCascade && body.name && body.name !== existing.name && (existing.status === 'approved' || body.status === 'approved')) {
        await adminRenameCascade(env, existing.name, body.name);
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
      // Onaylı içerik ya şimdi onaylandı ya da onaylıyken bir alanı/durumu değişti (her iki
      // durumda da public'e yansıyan bir şey değişmiş olabilir) — bkz. src/lib/publicCache.js.
      if (existing.status === 'approved' || body.status === 'approved') {
        // Okuma yolları artık *_submissions'ı DEĞİL, canonical tabloları okuyor (bkz.
        // src/routes/architect.js/office.js/project.js/product.js, Faz 3) — bu yüzden bu satırın
        // canonical karşılığı da AYNI anda güncellenmeli, aksi halde onay ekranda "başarılı" görünür
        // ama site hiçbir şey göstermez (bkz. src/lib/canonicalSync.js dosya başı yorumu).
        if (CANONICAL_TYPES.has(typeKey)) {
          const freshRow = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
          const finalStatus = freshRow.status;
          if (finalStatus === 'approved') {
            await syncApprovedSubmissionToCanonical(env, typeKey, parseSubmissionRow(typeKey, freshRow));
          } else if (existing.status === 'approved') {
            // onaylıyken reddedildi/pending'e alındı — bkz. src/lib/canonicalSync.js#hideCanonicalForUnapprovedSubmission.
            await hideCanonicalForUnapprovedSubmission(env, typeKey, freshRow);
          }
          if (FACET_TYPES.has(typeKey)) await bumpFacetCounts(env, typeKey);
        }
        await invalidatePublicCache();
        // Var olan (güncelleme ÖNCESİ) kaydın kimliğini hedefler — bkz. src/lib/ssrCache.js.
        const target = ssrPurgeTargetFor(typeKey, existing);
        if (target) await purgeSsrDetailCache(target.type, target.key);
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
      await invalidatePublicCache();
      if (target) await purgeSsrDetailCache(target.type, target.key);
      return json({ ok: true });
    }
  }
  return errorJson('Bulunamadı', 404);
}

// /api/admin/claims?status=pending
// /api/admin/claims/:id  (PATCH: status günceller — approved/rejected)
async function handleClaimsAdmin(request, env, url, segments) {
  if (segments.length === 3 && request.method === 'GET') {
    const status = url.searchParams.get('status');
    const query = status
      ? env.DB.prepare(
          `SELECT c.*, u.name AS user_name, u.email AS user_email FROM profile_claims c
           JOIN users u ON u.id = c.user_id WHERE c.status = ? ORDER BY c.created_at DESC`
        ).bind(status)
      : env.DB.prepare(
          `SELECT c.*, u.name AS user_name, u.email AS user_email FROM profile_claims c
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
    await env.DB.prepare(
      'UPDATE profile_claims SET status = ?, updated_at = ? WHERE id = ?'
    ).bind(body.status, Date.now(), id).run();

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
    return json({ ok: true });
  }
  return errorJson('Bulunamadı', 404);
}

// GET /api/admin/consultant-bookings?status=... — admin panelinde "Danışmanlık Satın Alımları"
// sekmesi (bkz. kullanıcı isteği: "admin panelinde de bir sekme aç ve oraya tüm danışmanlık
// satın alım işlemleri düşsün") — handleBadgesAdmin ile AYNI desen, yalnızca READ-ONLY liste
// (onay/red akışı istenmedi, consultation_requests zaten kullanıcı "Ödemeyi Yaptım" dediği anda
// oluşuyor, bkz. src/routes/consultantBookings.js dosya başı yorumu).
async function handleConsultantBookingsAdmin(request, env, url, segments) {
  if (segments.length !== 3 || request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const status = url.searchParams.get('status');
  const query = status
    ? env.DB.prepare(
        `SELECT cr.*, u.name AS user_name, u.email AS user_email FROM consultation_requests cr
         JOIN users u ON u.id = cr.user_id WHERE cr.status = ? ORDER BY cr.created_at DESC`
      ).bind(status)
    : env.DB.prepare(
        `SELECT cr.*, u.name AS user_name, u.email AS user_email FROM consultation_requests cr
         JOIN users u ON u.id = cr.user_id ORDER BY cr.created_at DESC`
      );
  const { results } = await query.all();
  return json({ items: results });
}

// iz-birakan: "İz Bırakanlar" (bkz. kullanıcı isteği) — vefat etmiş mimarlar için siyah rozet,
// admin mimar-ekle.html'deki AYNI rozet seçicisinden (bkz. o dosyadaki #admin-badge-select) elle
// verir; src/routes/badges.js#handlePublicBadges bu rozeti taşıyan bir profilin diğer TÜM
// rozetlerini (satın alınmış olsa bile) gizler — mavi Doğrulanmış Üye rozetinin YERİNİ alır.
const ADMIN_GRANTABLE_BADGES = new Set(['verified', 'gold', 'platinum', 'iz-birakan']);

// GET/PUT /api/admin/profile-badge?profileType=architect|office&profileKey=<isim> — admin'in
// bir mimar/marka profiline satın alma/sahiplenme olmadan doğrudan verdiği rozet (bkz. schema.sql#
// admin_badges, kullanıcı isteği: "Admin mimar veya marka profilini düzenlerken istediği rozeti
// seçebilsin ve profile ekleyebilsin. Adminin yaptığı bu değişiklik hemen canlıya yansısın").
// src/routes/badges.js#handlePublicBadges bu tabloyu satın alınan rozetlerle aynı çıktıya
// birleştirir; o uç önbelleklenmediğinden (bkz. publicCache.js#CACHEABLE_PATHS) değişiklik bir
// sonraki sayfa yüklemesinde hemen görünür — ayrıca ekstra bir cache temizleme adımına gerek yok.
async function handleProfileBadgeAdmin(request, env, url) {
  const profileType = url.searchParams.get('profileType');
  const profileKey = (url.searchParams.get('profileKey') || '').trim();
  if (!['architect', 'office'].includes(profileType) || !profileKey) return errorJson('Geçersiz profil.');

  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      `SELECT badge_type FROM admin_badges WHERE profile_type = ? AND profile_key = ?`
    ).bind(profileType, profileKey).first();
    return json({ badgeType: row?.badge_type || null });
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
    return json({ ok: true });
  }

  return errorJson('Bulunamadı', 404);
}
