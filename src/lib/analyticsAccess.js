// Profil İstatistikleri (kullanıcı isteği, 2026-09-04) — yetki kapısı + "bu kullanıcının içeriği
// hangileri?" çözümlemesi. src/routes/analytics.js'in TEK yetki kaynağıdır; istemcideki
// auth-modal.js#badgeAccessFrom yalnızca UI'ı gizler, gerçek kapı burasıdır.
import { getActiveSelfBadge, getPersonalAdminBadge, higherRankBadge, BADGE_RANK } from './badgeAccess.js';

// Erişim kuralı: "rozetli kullanıcı" (kullanıcı isteği: "Özellik yalnızca rozetli kullanıcılarda
// görünsün ... Rozetsiz kullanıcılar API dahil hiçbir şekilde verilere erişemesin"). Kademe AYRIMI
// YOK — Doğrulanmış Üye de Altın Üye de erişir; istekteki "sadece Altın Üye altında bahset" cümlesi
// /rozet-al sayfasındaki TANITIM metniyle ilgilidir, erişimle değil (bkz. info-modal.js#BADGE_TIERS).
//
// Kaynak, PDF dışa aktarımının kapısıyla (auth-modal.js#badgeAccessFrom -> /api/badges/mine) AYNI
// üç yeri kapsar, böylece iki özellik aynı kullanıcı kümesine açılır:
//   1. kendisi için satın aldığı aktif rozet          (badge_requests target_type='self')
//   2. sahiplendiği bir firmanın admin rozeti          (admin_badges + onaylı profile_claims)
//   3. sahiplendiği bir firma/profil için satın aldığı rozet (badge_requests target_type='office')
export async function hasAnalyticsAccess(env, userId) {
  const personal = higherRankBadge(await getActiveSelfBadge(env, userId), await getPersonalAdminBadge(env, userId));
  if ((BADGE_RANK[personal] || 0) > 0) return true;
  // target_type='office' rozetleri getActiveSelfBadge'in dışında kalır (o yalnızca 'self' bakar) —
  // bir markası için Altın Üye almış ama kendisi için almamış üye de bu özelliğe erişebilmeli.
  const row = await env.DB.prepare(
    `SELECT badge_type FROM badge_requests
     WHERE user_id = ? AND status = 'active' AND badge_type != 'destekci'
       AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`
  ).bind(userId, Date.now()).first();
  return !!row && (BADGE_RANK[row.badge_type] || 0) > 0;
}

// Kullanıcının SAHİP OLDUĞU varlıkların slug listesi. analytics_daily konuya (slug) göre
// anahtarlandığından (bkz. migrations/0084) istatistik okuması bu kümeyi bilmek zorundadır.
//
// profile_claims.profile_key bir SLUG DEĞİL, çıplak İSİMDİR (bkz. proje hafızası: "architects/
// offices keyed by bare name everywhere") — bu yüzden isimler önce canonical satırlardan slug'a
// çevrilir. Aynı sorgu satır id'lerini de döndürür: projeler/ürünler o id'ler üzerinden bağlanır.
//
// SORGU SAYISI: sabit 4 (claims, profiller, projeler, ürünler) — sahiplenilen profil/proje sayısı ne
// olursa olsun N+1'e dönüşmez.
export async function resolveOwnedSubjects(env, userId) {
  const claims = await env.DB.prepare(
    `SELECT profile_type, profile_key FROM profile_claims WHERE user_id = ? AND status = 'approved'`
  ).bind(userId).all();

  const architectNames = [];
  const officeNames = [];
  for (const c of claims.results || []) {
    if (c.profile_type === 'architect') architectNames.push(c.profile_key);
    else if (c.profile_type === 'office') officeNames.push(c.profile_key);
  }

  const architects = await rowsByName(env, 'architects', architectNames);
  const offices = await rowsByName(env, 'offices', officeNames);
  const architectIds = architects.map(r => r.id);
  const officeIds = offices.map(r => r.id);

  // Projeler: (a) doğrudan bu hesaba bağlı (claimed_by_user_id) VEYA (b) künyesinde sahiplenilen
  // mimar/firma profili geçen projeler — kişi/firma pop-up'ındaki "Projeler" bölümüyle AYNI kenar
  // (project_designers), yani kullanıcının sitede "benim projem" olarak gördüğü kümeyle birebir.
  const projectSlugs = await ownedSlugs(env, 'projects', userId, architectIds, officeIds, `
    SELECT DISTINCT p.slug FROM projects p
    LEFT JOIN project_designers pd ON pd.project_id = p.id
    WHERE p.deleted_at IS NULL AND (
      p.claimed_by_user_id = ?1
      OR (pd.architect_id IN (SELECT value FROM json_each(?2)))
      OR (pd.office_id IN (SELECT value FROM json_each(?3)))
    )`);

  // Ürünler: (a) doğrudan bu hesaba bağlı VEYA (b) sahiplenilen firmanın markası altındaki ürünler
  // (brand_office_id, ya da toplu/legacy kayıtlarda marka ADI eşleşmesi — src/routes/office.js#
  // relatedProducts ile AYNI iki dallı kural).
  const officeNamesJson = JSON.stringify(offices.map(r => r.name));
  const productSlugs = await ownedSlugs(env, 'products', userId, architectIds, officeIds, `
    SELECT DISTINCT pr.slug FROM products pr
    WHERE pr.deleted_at IS NULL AND (
      pr.claimed_by_user_id = ?1
      OR pr.brand_office_id IN (SELECT value FROM json_each(?3))
      OR (pr.brand_office_id IS NULL AND pr.brand_name_raw IN (SELECT value FROM json_each(?4)))
    )`, officeNamesJson);

  return {
    architects: architects.map(r => ({ slug: r.slug, name: r.name })),
    offices: offices.map(r => ({ slug: r.slug, name: r.name })),
    projectSlugs,
    productSlugs,
    // Mesaj metrikleri profile_claims üzerinden çözülür (message_threads profile_type+profile_key
    // ile yazılır, slug ile değil) — bu yüzden HAM isimler de döner.
    architectNames,
    officeNames,
  };
}

async function rowsByName(env, table, names) {
  if (!names.length) return [];
  const placeholders = names.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, slug, name FROM ${table} WHERE deleted_at IS NULL AND name IN (${placeholders})`
  ).bind(...names).all();
  return results || [];
}

// json_each(?) — id listelerini tek bir bind parametresi olarak geçirmenin D1'deki yolu: aksi halde
// sahiplenilen profil sayısı kadar '?' üretilen dinamik bir SQL gerekirdi (prepared statement cache'i
// her farklı sayıda yeniden derlenir). Boş listede json_each('[]') hiçbir satır döndürmez, yani
// koşul doğal olarak devre dışı kalır.
async function ownedSlugs(env, _table, userId, architectIds, officeIds, sql, extraJson) {
  const binds = [userId, JSON.stringify(architectIds), JSON.stringify(officeIds)];
  if (extraJson !== undefined) binds.push(extraJson);
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return (results || []).map(r => r.slug).filter(Boolean);
}
