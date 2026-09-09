// PROJE TELİF HAKKI YÖNETİMİ — /api/project-rights/:slug (kullanıcı isteği, 2026-09-09 madde 10-12).
//
// GET  -> projenin hak tablosu (proje düzeyi onay + görsel bazında durum) + denetim geçmişi
// POST -> tek bir hak aksiyonu: approve | revoke | dispute | takedown | remove | restore
//
// YETKİ SUNUCUDA BELİRLENİR, İSTEMCİDEKİ ONAY KUTUSUNA GÜVENİLMEZ (madde 10). İki seviye var:
//   * approve / revoke  -> projeyi düzenlemeye yetkili herkes (sahip / künyedeki sahiplenilmiş
//                          mimar-firma / firma yetkilisi) ya da admin. Kaynağı canUserEditProjectBySlug'dır
//                          — sitedeki "bu projeyi düzenleyebilir misin" sorusunun ZATEN tek cevabı
//                          (bkz. src/lib/projectClaimAccess.js), yeni bir yetki kavramı icat edilmedi.
//   * dispute / takedown / remove / restore -> YALNIZCA admin. Bunlar bir ÜÇÜNCÜ ŞAHSIN (hak sahibi)
//                          talebiyle yürür; içeriği yükleyen kişinin kendi hakkındaki bir ihtilafı
//                          kapatabilmesi, mekanizmanın kendisini anlamsız kılardı.
//
// FİZİKSEL SİLME YOK (madde 11): 'removed' bir DURUMDUR. Baytlar R2'de/statik varlıkta kalır ama
// hiçbir yoldan servis edilmez (bkz. src/routes/media.js) ve yükten tamamen düşer. Haksız bir
// takedown geri alınabilir ('restore'), denetim kaydı ne olduğunu anlatır.

import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { canUserEditProjectBySlug } from '../lib/projectClaimAccess.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache } from '../lib/ssrCache.js';
import { purgeGlobalUrls } from '../lib/globalPurge.js';
import {
  RIGHTS_DECLARATION_VERSION, bumpRightsEpoch, fetchProjectMediaRights, recordRightsAudit,
  requestIp, setMediaRightsStatus, syncProjectMediaRights,
} from '../lib/mediaRights.js';

const ADMIN_ONLY_ACTIONS = new Set(['dispute', 'takedown', 'remove', 'restore']);
const EDITOR_ACTIONS = new Set(['approve', 'revoke']);

// Aksiyon -> hedef görsel durumu. 'takedown' ile 'remove' AYNI duruma gider ama denetim kaydında
// ayrı görünür: takedown bir hak sahibi bildirimi, remove ise idari bir kaldırmadır.
const STATUS_BY_ACTION = {
  approve: 'approved',
  revoke: 'unknown',
  dispute: 'disputed',
  takedown: 'removed',
  remove: 'removed',
  restore: 'unknown',
};

export async function handleProjectRightsRoute(request, env, url) {
  const slug = decodeURIComponent(url.pathname.slice('/api/project-rights/'.length) || '');
  if (!slug) return errorJson('Geçersiz istek.');

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Giriş yapmalısın.', 401);

  const project = await env.DB.prepare(
    `SELECT id, slug, title, is_copyright_approved, rights_bucket FROM projects
      WHERE slug = ? AND deleted_at IS NULL`
  ).bind(slug).first();
  if (!project) return errorJson('Bulunamadı', 404);

  const isAdmin = user.role === 'admin';
  const canEdit = isAdmin || await canUserEditProjectBySlug(env, user, slug);
  if (!canEdit) return errorJson('Bu işlem için yetkin yok.', 403);

  if (request.method === 'GET') return getRights(env, project);
  if (request.method === 'POST') return postRights(request, env, user, project, isAdmin);
  return errorJson('Bulunamadı', 404);
}

async function getRights(env, project) {
  const [media, auditRes] = await Promise.all([
    fetchProjectMediaRights(env, project.id),
    env.DB.prepare(
      `SELECT id, content_id, content_type, action, reason, requested_by, processed_by,
              previous_status, new_status, declaration_version, created_at, processed_at
         FROM media_rights_audit
        WHERE (content_type = 'project' AND content_id = ?)
           OR (content_type = 'media' AND content_id IN (SELECT id FROM media_rights WHERE entity_type = 'project' AND entity_id = ?))
        ORDER BY created_at DESC LIMIT 100`
    ).bind(String(project.id), project.id).all(),
  ]);
  return json({
    slug: project.slug,
    title: project.title,
    copyrightApproved: Number(project.is_copyright_approved) === 1,
    rightsBucket: Number(project.rights_bucket),
    declarationVersion: RIGHTS_DECLARATION_VERSION,
    // Yetkili düzenleyici ORİJİNAL yolu görür — bu bir sızıntı değil: bu ekranı yalnızca projeyi
    // zaten düzenleyebilen (görselleri değiştirebilen, silebilen) kişiler açabiliyor.
    media: media.map(m => ({
      id: m.id, url: m.media_url, path: m.media_path, sortOrder: m.sort_order,
      status: m.rights_status, publicOriginalAllowed: Number(m.public_original_allowed) === 1,
      photographer: m.photographer, copyrightHolder: m.copyright_holder, sourceUrl: m.source_url,
      contentOrigin: m.content_origin, verifiedAt: m.rights_verified_at,
    })),
    audit: auditRes.results || [],
  });
}

async function postRights(request, env, user, project, isAdmin) {
  const body = await readJson(request);
  const action = String(body && body.action || '');
  if (!STATUS_BY_ACTION[action]) return errorJson('Geçersiz işlem.');
  if (ADMIN_ONLY_ACTIONS.has(action) && !isAdmin) return errorJson('Bu işlem için yetkin yok.', 403);
  if (!ADMIN_ONLY_ACTIONS.has(action) && !EDITOR_ACTIONS.has(action)) return errorJson('Geçersiz işlem.');

  // approve: telif beyanı ZORUNLU (madde 10 — "Onay server-side doğrulansın, frontend'deki
  // checkbox'a güvenme"). İstemcinin kutuyu işaretlediğini bildirmesi şarttır ve beyan denetim
  // kaydına yazılır; aksi halde onay, hiçbir kaydı olmayan sessiz bir bayrak değişikliği olurdu.
  if (action === 'approve' && !(body.declaration === true || body.declaration === 'true')) {
    return errorJson('Onay için telif/yayın hakkı beyanını işaretlemelisin.');
  }

  // Var olan hak satırlarını tazele: galeri, hak kaydı yapılmadan önce düzenlenmiş olabilir
  // (ör. 0106 öncesi kaydedilmiş bir proje) — böyle bir projede aksiyon hiçbir satır bulamaz ve
  // sessizce hiçbir şey yapmazdı.
  await syncProjectMediaRights(env, project.id, {});
  const media = await fetchProjectMediaRights(env, project.id);

  // mediaIds verilmişse yalnızca o görseller, verilmemişse projenin TAMAMI hedeflenir. Kapsam
  // önemli (madde 10): "yalnızca gerçekten kapsam dahilindeki görseller public_original_allowed=1
  // yapılmalı" — arayüz tek tek seçim yapabilsin diye alan opsiyonel bırakıldı.
  const requested = Array.isArray(body.mediaIds) ? new Set(body.mediaIds.map(String)) : null;
  const targets = requested ? media.filter(m => requested.has(m.id)) : media;

  const nextStatus = STATUS_BY_ACTION[action];
  const changedPaths = [];
  for (const row of targets) {
    // 'removed' bir görseli approve/revoke ile geri getirmek YANLIŞ olurdu — takedown'ı ancak
    // admin 'restore' ile geri alır.
    if (row.rights_status === 'removed' && action !== 'restore') continue;
    await setMediaRightsStatus(env, row.id, {
      status: nextStatus,
      publicOriginalAllowed: action === 'approve' ? body.publicOriginalAllowed !== false : false,
      action,
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 1000) : null,
      requestedBy: typeof body.requestedBy === 'string' ? body.requestedBy.slice(0, 200) : user.id,
      declarationVersion: action === 'approve' ? RIGHTS_DECLARATION_VERSION : null,
      photographer: typeof body.photographer === 'string' ? body.photographer.slice(0, 200) : null,
      copyrightHolder: typeof body.copyrightHolder === 'string' ? body.copyrightHolder.slice(0, 200) : null,
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl.slice(0, 500) : null,
    }, user);
    if (row.media_path) changedPaths.push(row.media_path);
  }

  // Proje düzeyi onay: yalnızca TÜM galeri hedeflendiğinde değişir. Tek bir görselin onaylanması
  // projenin tamamını "onaylı" yapmamalı; tersine, tek bir görselin ihtilaflı olması da projenin
  // onayını düşürmemeli (diğer görseller hâlâ meşru olabilir).
  const wholeProject = !requested;
  const previousApproved = Number(project.is_copyright_approved) === 1;
  let nextApproved = previousApproved;
  if (wholeProject && action === 'approve') nextApproved = true;
  if (wholeProject && (action === 'revoke' || action === 'takedown' || action === 'remove')) nextApproved = false;
  if (nextApproved !== previousApproved) {
    await env.DB.prepare(`UPDATE projects SET is_copyright_approved = ? WHERE id = ?`)
      .bind(nextApproved ? 1 : 0, project.id).run();
    await recordRightsAudit(env, {
      contentId: project.id, contentType: 'project', action,
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 1000) : null,
      requestedBy: typeof body.requestedBy === 'string' ? body.requestedBy.slice(0, 200) : user.id,
      processedBy: user.id,
      previousStatus: previousApproved ? 'approved' : 'unapproved',
      newStatus: nextApproved ? 'approved' : 'unapproved',
      declarationVersion: action === 'approve' ? RIGHTS_DECLARATION_VERSION : null,
      ip: requestIp(request),
    });
  }

  await invalidateRightsCaches(env, project.slug, changedPaths);

  const refreshed = await env.DB.prepare(
    `SELECT is_copyright_approved, rights_bucket FROM projects WHERE id = ?`
  ).bind(project.id).first();
  return json({
    ok: true, action, affected: targets.length,
    copyrightApproved: Number(refreshed?.is_copyright_approved) === 1,
    rightsBucket: Number(refreshed?.rights_bucket),
  });
}

// TEK NOKTADAN GEÇERSİZ KILMA (kullanıcı isteği madde 6/15): bir hak durumu değiştiğinde yalnızca
// erişim seviyesi değil SIRALAMA da değişir (rights_bucket), yani liste/ana sayfa/carousel/detay
// önbelleklerinin HEPSİ tazelenmeli.
//   1. bumpRightsEpoch  — /media, /projects ve /api/media yanıtlarının edge anahtarlarını topluca
//                         yetim bırakır; "onayı kaldırdım ama görsel hâlâ açık" penceresini kapatır.
//   2. invalidatePublicCache — liste/detay JSON önbellekleri + KV havuzları (sıralama buradan gelir).
//   3. purgeSsrDetailCache   — projenin SSR HTML'i (OG/JSON-LD görselleri orada gömülü).
//   4. purgeGlobalUrls       — etkilenen ORİJİNAL dosya URL'lerini TÜM PoP'lardan siler; yalnızca
//                              CF_ZONE_ID+CF_PURGE_TOKEN tanımlıysa çalışır, yoksa sessizce atlanır
//                              (bkz. src/lib/globalPurge.js). Epoch zaten anahtarı değiştirdiği için
//                              bu ikinci bir emniyet katmanıdır.
async function invalidateRightsCaches(env, slug, changedPaths) {
  await bumpRightsEpoch(env);
  await invalidatePublicCache(env);
  await purgeSsrDetailCache('project', slug, env);
  const urls = [...new Set(changedPaths)].slice(0, 30).map(p => `https://mimarlab.com${p}`);
  if (urls.length) await purgeGlobalUrls(env, urls);
}
