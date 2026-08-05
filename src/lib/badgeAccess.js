// Rozet sahipliğine bağlı ek haklar (ürün yükleme limitleri, yorum silme yetkisi vb.)
// için paylaşılan yardımcılar. Hak veren rozet tipleri: verified (Doğrulanmış Üye), gold (Altın
// Üye), platinum (Elmas Üye) — bkz. data.js#BADGE_LABELS, src/routes/badges.js#BADGE_PRICES.
// 'destekci' (Destekçi) kasıtlı olarak burada yok: hiçbir hak/limit vermez (bkz. src/routes/
// comments.js#canDeleteComment'teki ayrı istisna).

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Bir kullanıcı artık aynı anda birden fazla aktif rozet tutabilir — biri kendisi (target_type
// 'self'), diğerleri sahip olduğu her marka için ayrı ayrı (target_type 'office') — bkz.
// src/routes/badges.js. Yükleme kotası/hakları hesap düzeyindedir (hangi hedef için alındığından
// bağımsız), bu yüzden burada kullanıcının TÜM aktif rozetleri arasından en yüksek kademeliyi döner.
export const BADGE_RANK = { platinum: 3, gold: 2, verified: 1, destekci: 0 };

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

// Aylık ürün yükleme limitleri (bkz. src/routes/submissions.js).
export const PRODUCT_MONTHLY_LIMITS = { verified: 3, gold: 10, platinum: 50 };

// Aylık yapı malzemesi yükleme limitleri — ürünlerden ayrı bir kota havuzu (bkz. src/routes/submissions.js).
export const MATERIAL_MONTHLY_LIMITS = { verified: 3, gold: 10, platinum: 50 };
