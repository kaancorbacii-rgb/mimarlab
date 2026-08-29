// Rozet sahipliğine bağlı ek haklar (ürün yükleme limitleri, yorum silme yetkisi vb.)
// için paylaşılan yardımcılar. Hak veren rozet tipleri: verified (Doğrulanmış Üye), gold (Altın
// Üye) — bkz. badge-shared.js#BADGE_LABELS, src/routes/badges.js#BADGE_PRICES. 'destekci'
// (Destekçi) ve 'platinum' (Elmas Üye) kullanıcı isteğiyle 2026-08-29'da satın alınabilir olmaktan
// çıkarıldı (bkz. src/routes/badges.js#BADGE_PRICES'taki aynı not); BADGE_RANK'te artık yer
// almıyorlar — her yerde `(BADGE_RANK[type] || 0)` şeklinde okunduğundan eksik bir anahtar zaten
// rank 0 (hiçbir hak yok) muamelesi görür.

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
