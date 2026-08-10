// bkz. migrations/0041_slug_redirects.sql — bir varlık yeniden adlandırılıp slug'ı değiştiğinde
// (proje başlığı, mimar/firma adı), eski URL'nin 301 ile yeniyi göstermesi için eşleme burada tutulur.

// Zincirlenmeyi (A->B->C) önler: B, C'ye yeniden adlandırılırken önceden B'yi hedefleyen HER kayıt
// (ör. A->B) doğrudan C'yi hedefleyecek şekilde güncellenir — aksi halde /A önce /B'ye, oradan
// AYRI bir isteğe yönlendirilirdi.
export async function recordSlugRedirect(env, entityType, oldSlug, newSlug) {
  if (!oldSlug || !newSlug || oldSlug === newSlug) return;
  await env.DB.prepare(
    `UPDATE slug_redirects SET new_slug = ?, created_at = datetime('now') WHERE entity_type = ? AND new_slug = ?`
  ).bind(newSlug, entityType, oldSlug).run();
  // newSlug daha önce başka bir kaydın old_slug'ıysa (nadir — aynı slug'ın tekrar kullanılması), o
  // bayat girdi kaldırılır ki artık var olan yeni kaydı gölgelemesin.
  await env.DB.prepare(`DELETE FROM slug_redirects WHERE entity_type = ? AND old_slug = ?`).bind(entityType, newSlug).run();
  await env.DB.prepare(
    `INSERT INTO slug_redirects (entity_type, old_slug, new_slug) VALUES (?, ?, ?)
     ON CONFLICT(entity_type, old_slug) DO UPDATE SET new_slug = excluded.new_slug, created_at = datetime('now')`
  ).bind(entityType, oldSlug, newSlug).run();
}

export async function resolveSlugRedirect(env, entityType, oldSlug) {
  if (!oldSlug) return null;
  const row = await env.DB.prepare(
    `SELECT new_slug FROM slug_redirects WHERE entity_type = ? AND old_slug = ?`
  ).bind(entityType, oldSlug).first();
  return row ? row.new_slug : null;
}
