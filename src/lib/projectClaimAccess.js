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
  const officeNames = OFFICE_EDIT_POSITIONS.has(user.position)
    ? [...new Set(results.map(r => r.ofc_name).filter(Boolean))]
    : [];
  if (!architectNames.length && !officeNames.length) return false;

  for (const name of architectNames) {
    const claim = await env.DB.prepare(
      `SELECT id FROM profile_claims WHERE user_id = ? AND profile_type = 'architect' AND profile_key = ? AND status = 'approved'`
    ).bind(user.id, name).first();
    if (claim) return true;
  }
  for (const name of officeNames) {
    const claim = await env.DB.prepare(
      `SELECT id FROM profile_claims WHERE user_id = ? AND profile_type = 'office' AND profile_key = ? AND status = 'approved'`
    ).bind(user.id, name).first();
    if (claim) return true;
  }
  return false;
}
