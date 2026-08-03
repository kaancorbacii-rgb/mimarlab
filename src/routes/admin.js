import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { SUBMISSION_TYPES, parseSubmissionRow, findInvalidUrlField } from '../lib/submissionTypes.js';
import { createNotification } from '../lib/notify.js';
import { handleLegacyAdmin, setLegacyHidden } from './legacyContent.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache, ssrPurgeTargetFor } from '../lib/ssrCache.js';
import { cascadeRemovedFounders, renameOfficeEverywhere, renameArchitectEverywhere } from '../lib/officeFounderCascade.js';
import { cascadeDeleteArchitect, cascadeDeleteOffice, cascadeDeleteProject, cascadeDeleteProduct, cascadeDeleteMisc } from '../lib/cascadeDelete.js';

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
  if (typeKey === 'jobs') return cascadeDeleteMisc(env, 'job', row.id);
}

const TYPE_BY_PATH = {
  offices: 'offices', projects: 'projects', products: 'products', materials: 'materials', jobs: 'jobs',
  architects: 'architects', news: 'news',
};

// Hesabim.html'in "Gönderdiğim İçerikler" bölümündeki TYPE_LABELS ile aynı — bildirim metninde
// de aynı Türkçe adlandırma kullanılsın diye burada tekrarlanır.
const SUBMISSION_TYPE_LABELS = {
  offices: 'Firma', projects: 'Proje', products: 'Ürün', materials: 'Malzeme', jobs: 'İş İlanı', architects: 'Mimar', news: 'Haber',
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

  const [claimsRow, correctionsRow, badgesRow, contactRow] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM profile_claims WHERE status = 'pending'`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM profile_corrections WHERE status = 'pending'`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM badge_requests WHERE status = 'pending'`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM contact_messages WHERE is_read = 0`).first(),
  ]);

  return json({
    pendingSubmissions,
    pendingClaims: (claimsRow?.n || 0) + (correctionsRow?.n || 0),
    pendingBadges: badgesRow?.n || 0,
    unreadContact: contactRow?.n || 0,
  });
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
        // İş ilanları 30 gün yayında kalır (bkz. src/routes/public.js#handlePublicRoute); her
        // (yeniden) onayda published_at şimdiki zamana sıfırlanır, yayın süresi baştan başlar.
        if (typeKey === 'jobs' && body.status === 'approved') {
          updates.push('published_at = ?');
          values.push(Date.now());
        }
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
      await env.DB.prepare(`DELETE FROM ${config.table} WHERE id = ?`).bind(id).run();
      await runCascadeDelete(env, user, typeKey, existing);
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

const ADMIN_GRANTABLE_BADGES = new Set(['verified', 'gold', 'platinum']);

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
