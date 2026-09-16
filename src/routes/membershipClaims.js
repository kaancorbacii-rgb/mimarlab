import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache } from '../lib/ssrCache.js';
import { foldTr } from '../lib/textMatch.js';
import { canDecideMembership, MEMBERSHIP_PENDING } from '../lib/membershipClaims.js';

// ============================================================================================
// KİŞİ ↔ FİRMA ÜYELİĞİ — KARAR UCU (kullanıcı isteği, 2026-09-16 yedinci tur madde 5/6)
//
// Talepler BURADA AÇILMAZ: gönderi yazımında (src/routes/submissions.js) açılır, çünkü kapı da
// oradadır (bkz. src/lib/membershipClaims.js dosya başı). Bu dosya yalnızca kararı ve kararın
// UYGULANMASINI taşır — photoClaims.js#decideClaim ile BİREBİR aynı desen.
// ============================================================================================

// ONAYIN ÜÇ YAZMASI (photoClaims.js#applyPhotoClaim'deki AYNI gerekçe):
//   1. TASLAK — canonicalSync künyeyi gönderi satırından BAŞTAN yazdığı için, yalnızca canonical'a
//      yazmak bir sonraki kaydetmede SESSİZ VERİ KAYBI olurdu.
//   2. YAPISAL BAĞ (office_founders) — firma pop-up'ının Kurucular/Ekip listelerinin kaynağı.
//   3. Kişi tarafında "birincil firma" (architects.office_id) YALNIZCA BOŞSA — dolu bir değeri
//      ezmek, kişinin kendi seçtiği birincil firmayı sessizce değiştirirdi.
async function applyMembershipClaim(env, claim) {
  const office = await env.DB.prepare(
    'SELECT id, name FROM offices WHERE id = ? AND deleted_at IS NULL'
  ).bind(claim.office_id).first();
  const architect = await env.DB.prepare(
    'SELECT id, name, office_id FROM architects WHERE id = ? AND deleted_at IS NULL'
  ).bind(claim.architect_id).first();
  if (!office) return { ok: false, error: 'Firma artık yayında değil.' };
  if (!architect) return { ok: false, error: 'Kişi profili artık yayında değil.' };

  // (2) yapısal bağ — OR IGNORE, yani mükerrer onay fikirsizdir.
  await env.DB.prepare(
    'INSERT OR IGNORE INTO office_founders (office_id, architect_id) VALUES (?, ?)'
  ).bind(office.id, architect.id).run();

  // (3) birincil firma yalnızca boşsa
  if (claim.source === 'architect' && !architect.office_id) {
    await env.DB.prepare('UPDATE architects SET office_id = ? WHERE id = ?').bind(office.id, architect.id).run();
  }

  // (1) taslak
  if (claim.submission_id && claim.submission_type === 'offices' && (claim.slot === 'founders' || claim.slot === 'team')) {
    const row = await env.DB.prepare(
      `SELECT id, ${claim.slot} AS names FROM office_submissions WHERE id = ?`
    ).bind(claim.submission_id).first();
    if (row) {
      let list = [];
      try { list = JSON.parse(row.names || '[]') || []; } catch { list = []; }
      if (!list.some(n => foldTr(n) === foldTr(architect.name))) {
        list.push(architect.name);
        await env.DB.prepare(`UPDATE office_submissions SET ${claim.slot} = ? WHERE id = ?`)
          .bind(JSON.stringify(list), row.id).run();
      }
    }
  }
  if (claim.submission_id && claim.submission_type === 'architects') {
    const row = await env.DB.prepare('SELECT id, office FROM architect_submissions WHERE id = ?')
      .bind(claim.submission_id).first();
    if (row) {
      // architect_submissions.office virgüllü TEK bir metindir (bkz. canonicalSync#syncArchitect).
      const list = String(row.office || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!list.some(n => foldTr(n) === foldTr(office.name))) {
        list.push(office.name);
        await env.DB.prepare('UPDATE architect_submissions SET office = ? WHERE id = ?')
          .bind(list.join(', '), row.id).run();
      }
    }
  }

  // İKİ PROFİLİN DETAY ÖNBELLEĞİ DE purge edilir: bağ hem firma hem kişi pop-up'ını değiştirir ve
  // /api/office|architect/:key fingerprint TAŞIMAZ (bkz. ssrCache.js) — onay veren kişi aksi halde
  // "onayladım ama görünmüyor" derdi.
  await Promise.all([
    invalidatePublicCache(env),
    purgeSsrDetailCache('office', office.name, env),
    purgeSsrDetailCache('architect', architect.name, env),
  ]);
  return { ok: true };
}

export async function handleMembershipClaimsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "membership-claims", ...]
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 3 && segments[2] === 'pending' && request.method === 'GET') {
    return listPending(env, user);
  }
  if (segments.length === 3 && request.method === 'GET') return getClaim(env, user, segments[2]);
  if (segments.length === 4 && segments[3] === 'decide' && request.method === 'POST') {
    return decideClaim(request, env, user, segments[2]);
  }
  return errorJson('Bulunamadı', 404);
}

// Bekleyen talepler — admin panelindeki liste ve Hesabım bildirimlerinin yanındaki sayaç için.
async function listPending(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM profile_membership_claims WHERE status = '${MEMBERSHIP_PENDING}' ORDER BY created_at DESC LIMIT 200`
  ).all();
  const items = [];
  for (const row of (results || [])) {
    if (await canDecideMembership(env, user, row)) items.push(shape(row, true));
  }
  return json({ items });
}

function shape(row, canDecide) {
  return {
    id: row.id, officeName: row.office_name, architectName: row.architect_name,
    source: row.source, slot: row.slot, deciderOfficeName: row.decider_office_name,
    status: row.status, createdAt: row.created_at, canDecide: !!canDecide,
  };
}

async function getClaim(env, user, id) {
  const row = await env.DB.prepare('SELECT * FROM profile_membership_claims WHERE id = ?').bind(id).first();
  if (!row) return errorJson('Bulunamadı', 404);
  // Talebi AÇAN kişi de kaydı görebilir (bildirimi o da alır — "onayına sunuldu" satırı), ama
  // canDecide=false döner ve pop-up karar düğmelerini çizmez.
  const canDecide = await canDecideMembership(env, user, row);
  if (!canDecide && row.requested_by_user_id !== user.id) return errorJson('Bu talebi görme yetkin yok.', 403);
  return json({ item: shape(row, canDecide) });
}

async function decideClaim(request, env, user, id) {
  const row = await env.DB.prepare('SELECT * FROM profile_membership_claims WHERE id = ?').bind(id).first();
  if (!row) return errorJson('Bulunamadı', 404);
  if (row.status !== MEMBERSHIP_PENDING) return errorJson('Bu talep zaten karara bağlanmış.');
  if (!(await canDecideMembership(env, user, row))) return errorJson('Bu talebi onaylama yetkin yok.', 403);

  const body = await readJson(request);
  const approve = body.decision === 'approve';
  if (approve) {
    const applied = await applyMembershipClaim(env, row);
    if (!applied.ok) return errorJson(applied.error);
  }
  await env.DB.prepare(
    'UPDATE profile_membership_claims SET status = ?, decided_by_user_id = ?, decided_at = ? WHERE id = ?'
  ).bind(approve ? 'approved' : 'rejected', user.id, Date.now(), id).run();
  return json({ ok: true, status: approve ? 'approved' : 'rejected' });
}
