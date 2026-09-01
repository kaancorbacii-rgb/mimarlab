// Rozet sahipliğine bağlı ek haklar (ürün yükleme limitleri, yorum silme yetkisi vb.)
// için paylaşılan yardımcılar. Hak veren rozet tipleri: verified (Doğrulanmış Üye), gold (Altın
// Üye) — bkz. badge-shared.js#BADGE_LABELS, src/routes/badges.js#BADGE_PRICES. 'destekci'
// (Destekçi) ve 'platinum' (Elmas Üye) kullanıcı isteğiyle 2026-08-29'da satın alınabilir olmaktan
// çıkarıldı (bkz. src/routes/badges.js#BADGE_PRICES'taki aynı not); BADGE_RANK'te artık yer
// almıyorlar — her yerde `(BADGE_RANK[type] || 0)` şeklinde okunduğundan eksik bir anahtar zaten
// rank 0 (hiçbir hak yok) muamelesi görür.

import { OFFICE_EDIT_POSITIONS } from './projectClaimAccess.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Bir kullanıcı artık aynı anda birden fazla aktif rozet tutabilir — biri kendisi (target_type
// 'self'), diğerleri sahip olduğu her marka için ayrı ayrı (target_type 'office') — bkz.
// src/routes/badges.js. Yükleme kotası/hakları hesap düzeyindedir (hangi hedef için alındığından
// bağımsız), bu yüzden burada kullanıcının TÜM aktif rozetleri arasından en yüksek kademeliyi döner.
export const BADGE_RANK = { gold: 2, verified: 1 };

export async function getActiveBadge(env, userId) {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT badge_type, expires_at, created_at, target_type, target_key FROM badge_requests
     WHERE user_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`
  ).bind(userId, now).all();
  if (!results.length) return null;
  return results.reduce((best, row) =>
    (BADGE_RANK[row.badge_type] || 0) > (BADGE_RANK[best.badge_type] || 0) ? row : best
  );
}

// Rozetin şu anki "ay"ının başlangıcı: expires_at varsa ondan 30 gün geriye gider (aktivasyon/
// yenilenme anı), yoksa (eski/legacy satırlar için) created_at'e düşer.
export function periodStart(badge) {
  if (badge.expires_at) return badge.expires_at - THIRTY_DAYS_MS;
  return badge.created_at;
}

// src/routes/comments.js#listComments ve ownerByline.js'teki satır-içi JOIN'in TEK KULLANICILIK
// hali — src/routes/badges.js#listMyBadges (kişinin kendi "Rozet Ayrıcalıklarından Faydalan"
// kutusu/mesaj yetkisi hesaplaması) gibi tek bir kullanıcı için sorgu gerektiren çağıranlarda kullanılır.
export async function getActiveSelfBadge(env, userId) {
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT badge_type FROM badge_requests WHERE user_id = ? AND target_type = 'self' AND status = 'active'
     AND badge_type != 'destekci' AND (expires_at IS NULL OR expires_at > ?)`
  ).bind(userId, now).first();
  return row ? row.badge_type : null;
}

// Bir kullanıcının yorum/gönderi gibi KİŞİSEL içeriklerinin yanında gösterilecek admin rozetini
// çözer — src/routes/badges.js#getProfileBadgesForUser'ın `self` alanının aksine yalnızca kullanıcının KENDİ
// mimar profiliyle sınırlı kalmaz, yönetici pozisyonuyla (Kurucu/Kurucu Ortak/Ortak/Ekip Lideri —
// OFFICE_EDIT_POSITIONS ile AYNI küme) sahiplendiği bir firmanın admin rozetini de kapsar.
//
// GERÇEK BULGU (kullanıcı isteği: "Kaan Çorbacı'nın yanında Altın Üye rozeti gözükmüyor, kökten
// çöz"): Kaan'ın Altın Üye rozeti kişisel mimar profiline değil, Kurucusu olduğu MİMARLAB firma
// profiline admin tarafından verilmişti (admin_badges profile_type='office') — src/routes/
// comments.js ve bu dosyanın (ownerByline.js) eski hali yalnızca satın alınan badge_requests'e
// bakıyordu, admin_badges'e HİÇ bakmıyordu; profil sayfasında (kisi.html — bkz. src/routes/
// badges.js#computeBadgesPayload'daki "kendisi için aldığı rozet bir markaya sızmaz" kuralı) doğru
// şekilde boş kalması GEREKEN bu ayrım, yorum/gönderi bylinelarında rozetin tamamen KAYBOLMASINA
// yol açıyordu. Yalnızca EN YÜKSEK kademeli rozet döner (BADGE_RANK); bilinmeyen/derece dışı tipler
// (ör. 'iz-birakan' — vefat etmiş mimarlara özel anma rozeti) sessizce 0 kademe sayılır, asla seçilmez.
export async function getPersonalAdminBadge(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT pc.profile_type, pc.office_position, ab.badge_type
     FROM profile_claims pc
     JOIN admin_badges ab ON ab.profile_type = pc.profile_type AND ab.profile_key = pc.profile_key
     WHERE pc.user_id = ? AND pc.status = 'approved'`
  ).bind(userId).all();
  let best = null;
  for (const row of results) {
    if (row.profile_type === 'office' && !OFFICE_EDIT_POSITIONS.has(row.office_position)) continue;
    if (!best || (BADGE_RANK[row.badge_type] || 0) > (BADGE_RANK[best] || 0)) best = row.badge_type;
  }
  return best;
}

// getPersonalAdminBadge'in ÇOKLU kullanıcı için toplu hali — src/routes/comments.js#listComments
// gibi bir listede N farklı yorumcu olabilen uçlarda N+1 sorgudan kaçınmak için (bkz. [[project_d1_
// usage_audit_2026_08_25]] — bu sınıf N+1 daha önce de bulunup düzeltilmişti). userId → badge_type
// (ya da rozet yoksa hiç anahtar yok) eşlemesi döner.
export async function getPersonalAdminBadgesForUsers(env, userIds) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT pc.user_id, pc.profile_type, pc.office_position, ab.badge_type
     FROM profile_claims pc
     JOIN admin_badges ab ON ab.profile_type = pc.profile_type AND ab.profile_key = pc.profile_key
     WHERE pc.user_id IN (${placeholders}) AND pc.status = 'approved'`
  ).bind(...ids).all();
  const map = new Map();
  for (const row of results) {
    if (row.profile_type === 'office' && !OFFICE_EDIT_POSITIONS.has(row.office_position)) continue;
    const current = map.get(row.user_id);
    if (!current || (BADGE_RANK[row.badge_type] || 0) > (BADGE_RANK[current] || 0)) map.set(row.user_id, row.badge_type);
  }
  return map;
}

// Satın alınan (purchased) ile admin rozeti arasından EN YÜKSEK kademeliyi seçer — src/routes/
// badges.js#computeBadgesPayload'daki "admin rozeti satın alınanın YERİNİ alır" kuralından farklı
// olarak burada iki AYRI KAYNAK (kişisel satın alma + firma admin rozeti) birleştirildiğinden basit
// bir "override" değil, rank karşılaştırmasıyla ikisinden büyüğü seçilir.
export function higherRankBadge(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return (BADGE_RANK[b] || 0) > (BADGE_RANK[a] || 0) ? b : a;
}
