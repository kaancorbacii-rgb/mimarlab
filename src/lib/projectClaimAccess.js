// Bir mimar/firma profilini onaylı bir profile_claims ile sahiplenen (bkz. kullanıcı isteği: "Admin
// bir mimar ya da firmayı bir kullanıcı üzerine atasın, kullanıcı o profildeki projelerde de
// değişiklik yapabilsin") kullanıcının, o profile project_designers üzerinden (architect_id/office_id
// ile) bağlı projeleri de düzenleyip arşivleyip/silebilmesini belirler. src/routes/submissions.js#
// verifyClaimedSlug (proje-ekle.html?claim= akışı) ve src/routes/legacyContent.js#
// handleSelfProjectDelete/handleSelfProjectModerate (proje popup'ındaki Sil/Arşivle) tarafından
// kullanılır — üçü de AYNI yetki kuralını uygulamalı.
//
// Firma için düzenleme hakkı submissions.js#OFFICE_EDIT_POSITIONS ile BİREBİR aynı pozisyon kısıtına
// tabi (Kurucu/Kurucu Ortak/Ortak/Ekip Lideri) — bir Ekip Üyesi firmanın kendi profilini
// düzenleyemediğinden, firmaya ait projeleri de düzenleyemez. Mimar için pozisyon kısıtı yok (bkz.
// submissions.js#verifyClaimedProfileKey'deki AYNI ayrım).
export const OFFICE_EDIT_POSITIONS = new Set(['Kurucu', 'Kurucu Ortak', 'Ortak', 'Ekip Lideri']);

export async function canUserEditProjectBySlug(env, user, slug) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const project = await env.DB.prepare(
    `SELECT id FROM projects WHERE deleted_at IS NULL AND (slug = ? OR legacy_key = ?) LIMIT 1`
  ).bind(slug, slug).first();
  if (!project) return false;

  const { results } = await env.DB.prepare(
    `SELECT ar.name AS ar_name, ofc.name AS ofc_name
     FROM project_designers pd
     LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL
     LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
     WHERE pd.project_id = ?`
  ).bind(project.id).all();

  const architectNames = [...new Set(results.map(r => r.ar_name).filter(Boolean))];
  const officeNames = [...new Set(results.map(r => r.ofc_name).filter(Boolean))];
  if (!architectNames.length && !officeNames.length) return false;

  for (const name of architectNames) {
    const claim = await env.DB.prepare(
      `SELECT id FROM profile_claims WHERE user_id = ? AND profile_type = 'architect' AND profile_key = ? AND status = 'approved'`
    ).bind(user.id, name).first();
    if (claim) return true;
  }
  // P1 güvenlik düzeltmesi (bkz. migrations/0068, submissions.js#verifyClaimedProfileKey'deki AYNI
  // gerekçe): önceden burada TÜM officeNames, kullanıcının CANLI user.position'ına göre baştan
  // filtreleniyordu — bu, kullanıcının kendi profilinden position'ını "Kurucu" yaparak (ilgisiz bir
  // firmanın bile) projelerini düzenleme yetkisi kazanmasına izin veriyordu. Artık her firma adı
  // için o SPESİFİK claim'in admin onayı anında dondurulmuş office_position'ına bakılır.
  for (const name of officeNames) {
    const claim = await env.DB.prepare(
      `SELECT id, office_position FROM profile_claims WHERE user_id = ? AND profile_type = 'office' AND profile_key = ? AND status = 'approved'`
    ).bind(user.id, name).first();
    if (claim && OFFICE_EDIT_POSITIONS.has(claim.office_position)) return true;
  }
  return false;
}

// canUserEditProjectBySlug'ın ÜRÜN karşılığı (kullanıcı isteği, 2026-09-05: "Ürün ekle ile ürün
// düzenle birbiriyle entegre değil mi? Proje ekle ve proje düzenle de kurduğumuz entegre sistemin
// ürün ekle/düzenle için de aynı olması gerekiyor.") — bir ürünü/malzemeyi düzenleme hakkı, o ürünün
// MARKASINI (offices satırı) onaylı bir profile_claims ile sahiplenmeye bağlıdır. Firma için AYNI
// OFFICE_EDIT_POSITIONS kısıtı geçerli (bkz. yukarıdaki AYNI gerekçe) — bir Ekip Üyesi firmanın
// profilini düzenleyemediğinden, markanın ürün kataloğunu da düzenleyemez. src/routes/submissions.js#
// verifyProductClaimedSlug (urun-ekle.html?claim= akışı) ve src/routes/product.js#
// handleProductCanEditRoute tarafından kullanılır.
export async function canUserEditProductBySlug(env, user, slug) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const product = await env.DB.prepare(
    `SELECT id, brand_office_id, brand_name_raw FROM products WHERE deleted_at IS NULL AND (slug = ? OR legacy_key = ?) LIMIT 1`
  ).bind(slug, slug).first();
  if (!product) return false;

  // Marka adı — canonUserEditProjectBySlug'daki project_designers JOIN'inin karşılığı: ürünlerde
  // marka doğrudan brand_office_id/brand_name_raw'da durur, ayrı bir join gerekmez (bkz. src/routes/
  // office.js#buildOfficePayload'daki AYNI brand_office_id || brand_name_raw eşleşme kuralı).
  let officeName = null;
  if (product.brand_office_id) {
    const office = await env.DB.prepare(`SELECT name FROM offices WHERE id = ? AND deleted_at IS NULL`).bind(product.brand_office_id).first();
    officeName = office ? office.name : null;
  } else if (product.brand_name_raw) {
    officeName = product.brand_name_raw;
  }
  if (!officeName) return false;

  const claim = await env.DB.prepare(
    `SELECT id, office_position FROM profile_claims WHERE user_id = ? AND profile_type = 'office' AND profile_key = ? AND status = 'approved'`
  ).bind(user.id, officeName).first();
  return !!(claim && OFFICE_EDIT_POSITIONS.has(claim.office_position));
}
