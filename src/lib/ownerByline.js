import { getPersonalAdminBadge, higherRankBadge } from './badgeAccess.js';

// "X tarafından" byline verisi — proje/ürün detay uçlarının (src/routes/project.js,
// src/routes/product.js) paylaştığı ortak sorgu. src/routes/public.js#listPublicNews'teki AYNI
// users+badge_requests join deseni (haber-detay.html'de canlı çalışan tek örnek). projects/products
// satırlarındaki claimed_by_user_id yalnızca canonicalSync.js#syncProject/syncProduct'ta gönderi
// sahibinden (row.owner_user_id) BİR KEZ, satır oluşturulurken yazılır — başka hiçbir akış bunu
// sonradan değiştirmez, dolayısıyla her zaman "bu kaydı gönderen kişi" anlamına gelir (legacy_static/
// admin kökenli kayıtlarda NULL kalır, byline o kayıtlarda hiç gösterilmez).
export async function fetchOwnerByline(env, userId) {
  if (!userId) return null;
  const row = await env.DB.prepare(
    `SELECT u.name AS owner_name, u.photo_url AS owner_photo, b.badge_type AS owner_badge, a.slug AS owner_architect_slug
     FROM users u
     LEFT JOIN badge_requests b ON b.user_id = u.id AND b.target_type = 'self' AND b.status = 'active'
       AND b.badge_type != 'destekci' AND (b.expires_at IS NULL OR b.expires_at > ?)
     LEFT JOIN profile_claims c ON c.user_id = u.id AND c.profile_type = 'architect' AND c.status = 'approved'
     LEFT JOIN architects a ON a.name = c.profile_key
     WHERE u.id = ?`
  ).bind(Date.now(), userId).first();
  if (!row || !row.owner_name) return null;
  // bkz. badgeAccess.js#getPersonalAdminBadge yorumu — yukarıdaki sorgu yalnızca satın alınan
  // (badge_requests) rozeti taşır, admin'in verdiği rozetleri (ör. Kurucusu olunan bir firmanın
  // admin rozeti) kapsamaz; ikisinin arasından yüksek kademeli olan seçilir.
  const adminBadge = await getPersonalAdminBadge(env, userId);
  return {
    ownerName: row.owner_name,
    ownerPhoto: row.owner_photo || null,
    ownerBadge: higherRankBadge(row.owner_badge, adminBadge),
    ownerArchitectSlug: row.owner_architect_slug || null,
  };
}
