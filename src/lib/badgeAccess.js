// Rozet sahipliğine bağlı ek haklar (ürün/iş ilanı yükleme limitleri, yorum silme yetkisi vb.)
// için paylaşılan yardımcılar. Hak veren rozet tipleri: verified (Doğrulanmış Üye), gold (Altın
// Üye), platinum (Elmas Üye) — bkz. data.js#BADGE_LABELS, src/routes/badges.js#BADGE_PRICES.
// 'destekci' (Destekçi) kasıtlı olarak burada yok: hiçbir hak/limit vermez (bkz. src/routes/
// comments.js#canDeleteComment'teki ayrı istisna).

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Kullanıcının süresi dolmamış aktif rozetini döner (yoksa null). Birden fazla aktif rozet
// normalde olmaz (bkz. src/routes/admin.js#handleBadgesAdmin, tek rozet kuralını uygular) ama
// güvenlik için en yenisini alır.
export async function getActiveBadge(env, userId) {
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT badge_type, expires_at, created_at FROM badge_requests
     WHERE user_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY created_at DESC LIMIT 1`
  ).bind(userId, now).first();
  return row || null;
}

// Rozetin şu anki "ay"ının başlangıcı: expires_at varsa ondan 30 gün geriye gider (aktivasyon/
// yenilenme anı), yoksa (eski/legacy satırlar için) created_at'e düşer.
export function periodStart(badge) {
  if (badge.expires_at) return badge.expires_at - THIRTY_DAYS_MS;
  return badge.created_at;
}

// Aylık ürün yükleme limitleri (bkz. src/routes/submissions.js).
export const PRODUCT_MONTHLY_LIMITS = { verified: 3, gold: 10, platinum: 50 };

// Aylık iş ilanı yayınlama limitleri; Doğrulanmış Üye bu hakka sahip değildir (bkz. is-ilani-ver.html).
export const JOB_MONTHLY_LIMITS = { gold: 1, platinum: 2 };
