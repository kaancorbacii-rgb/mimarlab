// Proje künyesinden çıkarılan firma/kişi için 1 GÜNLÜK düzenleme yetkisi penceresi
// (kullanıcı isteği, 2026-09-10 madde 2). Kök neden, tablo tasarımı ve iki ayrı hatanın anlatımı
// migrations/0109_project_edit_grace.sql'in başındadır — burada tekrarlanmaz.
//
// KURALIN TAMAMI (tek cümle): bir kullanıcının bir projeyi düzenleme yetkisi künyeden geliyorsa ve
// künyedeki o bağ KOPARSA, yetki hemen değil `GRACE_MS` sonra biter; bağ geri kurulursa damga silinir.
//
// ÇAĞRI NOKTALARI:
//   * src/lib/canonicalSync.js#syncProject — künye her yeniden yazıldığında damgayı yazar/siler
//     (TEK yazma noktası: proje künyesini değiştiren her yol — üye düzenlemesi, admin paneli,
//     ?claim= akışı, AI akışı — oradan geçer).
//   * src/lib/projectClaimAccess.js#canUserEditProjectBySlug — pencere açıkken yetki verir.
//   * src/routes/submissions.js#canAccessSubmissionRow — pencere kapandığında owner_user_id
//     dalını da kapatır.

export const PROJECT_EDIT_GRACE_MS = 24 * 60 * 60 * 1000;

// Bir künye adının (firma ya da kişi) SAHİPLERİ — onaylı profile_claims satırlarındaki user_id'ler.
// Pozisyon kısıtı BİLEREK uygulanmaz: burada "kim yetki KAYBEDİYOR" değil, "kim bu adla ilişkiliydi"
// sorusu sorulur; asıl yetki kararı yine projectClaimAccess.js'te (OFFICE_EDIT_POSITIONS ile) verilir.
// Fazladan yazılan bir damga zararsızdır — o kullanıcının zaten yetkisi yoksa hiçbir şeyi değiştirmez.
async function claimantsOf(env, profileType, names) {
  const keys = [...new Set((names || []).map(n => (n || '').trim()).filter(Boolean))].slice(0, 100);
  if (!keys.length) return [];
  // Düz IN(...) — `A OR B` zinciri DEĞİL (bkz. proje notu: SQLite ifade-ağacı derinlik sınırı 100).
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT user_id, profile_key FROM profile_claims
      WHERE status = 'approved' AND profile_type = ? AND profile_key IN (${keys.map(() => '?').join(', ')})`
  ).bind(profileType, ...keys).all();
  return results || [];
}

// Künye yeniden yazıldıktan SONRA çağrılır.
//   removed  — künyeden ÇIKARILAN adlar { architects: [...], offices: [...] }
//   current  — künyede KALAN adlar (aynı şekil)
// Çıkarılan bir adın sahibi, künyede kalan BAŞKA bir ada da sahipse damga yazılmaz — yetkisi zaten
// canlı künyeden geliyor, bir şey kaybetmedi.
export async function recordProjectEditGrace(env, projectId, removed, current) {
  if (!projectId) return;
  const [removedArch, removedOffice, currentArch, currentOffice] = await Promise.all([
    claimantsOf(env, 'architect', removed.architects),
    claimantsOf(env, 'office', removed.offices),
    claimantsOf(env, 'architect', current.architects),
    claimantsOf(env, 'office', current.offices),
  ]);
  const stillLinked = new Set([...currentArch, ...currentOffice].map(r => r.user_id));
  const losing = new Map(); // user_id -> çıkarılan anahtar (denetim için)
  for (const r of [...removedArch, ...removedOffice]) {
    if (stillLinked.has(r.user_id)) continue;
    if (!losing.has(r.user_id)) losing.set(r.user_id, r.profile_key);
  }
  if (!losing.size) return;
  const now = Date.now();
  const revokeAt = now + PROJECT_EDIT_GRACE_MS;
  // INSERT OR IGNORE — mevcut bir damga UZATILMAZ. Aksi halde kullanıcı, künyeye ekleyip tekrar
  // çıkararak pencereyi süresiz yenileyebilirdi. (Ekleme damgayı zaten SİLER, bkz. aşağısı; yani
  // gerçekten geri koyan biri temiz bir sayfayla yeni bir pencere alır — çakışma yalnızca aynı
  // pencere içinde ikinci kez çıkarma durumunda oluşur ve orada sürenin uzamaması doğru davranıştır.)
  const statements = [...losing.entries()].map(([userId, key]) => env.DB.prepare(
    `INSERT OR IGNORE INTO project_edit_grace (project_id, user_id, revoke_at, removed_key, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(projectId, userId, revokeAt, key, now));
  await env.DB.batch(statements);
}

// Künyeye GERİ eklenen adların sahiplerinin damgası silinir — yetki yeniden canlı künyeden gelir.
export async function clearProjectEditGrace(env, projectId, current) {
  if (!projectId) return;
  const [arch, office] = await Promise.all([
    claimantsOf(env, 'architect', current.architects),
    claimantsOf(env, 'office', current.offices),
  ]);
  const userIds = [...new Set([...arch, ...office].map(r => r.user_id))].slice(0, 100);
  if (!userIds.length) return;
  await env.DB.prepare(
    `DELETE FROM project_edit_grace WHERE project_id = ? AND user_id IN (${userIds.map(() => '?').join(', ')})`
  ).bind(projectId, ...userIds).run();
}

// "Bu kullanıcı bu projeyi hâlâ düzenleyebilir mi?" sorusuna damganın verdiği cevap:
//   'grace'   — künyeden çıkarıldı ama 24 saat dolmadı → yetki SÜRER
//   'revoked' — 24 saat doldu → yetki KALKTI (owner_user_id dalı dahil)
//   null      — bu proje için damga yok, karar tamamen diğer kurallara ait
export async function projectEditGraceState(env, projectId, userId) {
  if (!projectId || !userId) return null;
  const row = await env.DB.prepare(
    `SELECT revoke_at FROM project_edit_grace WHERE project_id = ? AND user_id = ?`
  ).bind(projectId, userId).first();
  if (!row) return null;
  return row.revoke_at > Date.now() ? 'grace' : 'revoked';
}
