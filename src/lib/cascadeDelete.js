import { slugify } from './slugify.js';
import { clearArchitectOfficeIfMatches } from './officeFounderCascade.js';

// comments/ratings/saved_items tabloları target_type/item_type + target_id/item_key ile anahtarlanır
// (bkz. schema.sql) — bir tür o tabloyu hiç desteklemese bile (ör. comments'te 'product' yok, bkz.
// src/routes/comments.js#TARGET_TYPES) eşleşen satır olmayacağından bu silme sessizce no-op olur.
async function deleteEngagement(env, type, key) {
  if (!key) return;
  await env.DB.prepare(`DELETE FROM comments WHERE target_type = ? AND target_id = ?`).bind(type, key).run();
  await env.DB.prepare(`DELETE FROM ratings WHERE target_type = ? AND target_id = ?`).bind(type, key).run();
  await env.DB.prepare(`DELETE FROM saved_items WHERE item_type = ? AND item_key = ?`).bind(type, key).run();
}

// Bir <tip>_submissions JSON dizi kolonundan (designer/brands/founders) belirli bir ismi çıkarıp
// geri yazar — LIKE yerine tüm satırları çekip JS'te filtreler (isimde SQL LIKE özel karakterleri
// (%, _) olsa bile yanlış eşleşme riski olmasın diye; tablo boyutları bu siteye göre küçük).
async function pullNameFromArrayColumn(env, table, column, name) {
  const { results } = await env.DB.prepare(`SELECT id, ${column} FROM ${table} WHERE ${column} IS NOT NULL`).all();
  for (const row of results) {
    let arr;
    try { arr = JSON.parse(row[column]); } catch { continue; }
    if (!Array.isArray(arr) || !arr.includes(name)) continue;
    await env.DB.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).bind(JSON.stringify(arr.filter(v => v !== name)), row.id).run();
  }
}

// Bir mimar SİLİNDİĞİNDE (bkz. src/routes/legacyContent.js#handleContentAction, src/routes/admin.js
// DELETE) — kendi profil talepleri/düzeltme önerileri, aldığı yorum/puan/kaydetme kayıtları silinir;
// adı hâlâ başka bir firmanın Kurucular listesinde ya da bir projenin mimar/tasarımcı listesinde
// geçiyorsa oradan da çıkarılır (bkz. kullanıcı isteği: "tüm sistemden o bilgi silinsin"). Statik
// (projeler-data.js/data.js) kayıtlardaki isim referansları çalışma zamanında düzenlenemez — bu,
// projenin bilinen bir kısıtı (bkz. "Duplicate name key limitation" belleği).
export async function cascadeDeleteArchitect(env, name) {
  await env.DB.prepare(`DELETE FROM profile_claims WHERE profile_type = 'architect' AND profile_key = ?`).bind(name).run();
  await env.DB.prepare(`DELETE FROM profile_corrections WHERE profile_type = 'architect' AND profile_key = ?`).bind(name).run();
  await env.DB.prepare(`DELETE FROM admin_badges WHERE profile_type = 'architect' AND profile_key = ?`).bind(name).run();
  await deleteEngagement(env, 'architect', slugify(name));
  await pullNameFromArrayColumn(env, 'office_submissions', 'founders', name);
  await pullNameFromArrayColumn(env, 'project_submissions', 'designer', name);
}

// Bir firma SİLİNDİĞİNDE — kendi profil talepleri/düzeltme önerileri/marka rozeti talepleri, aldığı
// yorum/puan/kaydetme kayıtları silinir; adı projelerin mimar/tasarımcı ya da marka listesinden
// çıkarılır; VE bu firmada (hâlâ) çalışıyor görünen HER mimarın (statik + DB) kendi office alanı
// temizlenir — aksi halde silinen firma, mimarların profilinde ve "diğer ortaklar" listelerinde
// hayalet bir bağlantı olarak kalmaya devam ederdi (bkz. src/lib/officeFounderCascade.js'teki AYNI
// mekanizma — burada tek bir çıkarılan kurucu yerine ofisteki HERKES için çalıştırılır).
export async function cascadeDeleteOffice(env, user, name) {
  await env.DB.prepare(`DELETE FROM profile_claims WHERE profile_type = 'office' AND profile_key = ?`).bind(name).run();
  await env.DB.prepare(`DELETE FROM profile_corrections WHERE profile_type = 'office' AND profile_key = ?`).bind(name).run();
  await env.DB.prepare(`DELETE FROM badge_requests WHERE target_type = 'office' AND target_key = ?`).bind(name).run();
  await env.DB.prepare(`DELETE FROM admin_badges WHERE profile_type = 'office' AND profile_key = ?`).bind(name).run();
  await deleteEngagement(env, 'office', slugify(name));
  await pullNameFromArrayColumn(env, 'project_submissions', 'designer', name);
  await pullNameFromArrayColumn(env, 'project_submissions', 'brands', name);

  // Faz 3: affiliated mimarlar artık canonical office_founders join'inden (bkz. src/routes/office.js)
  // okunur — statik data.js taraması + ayrı architect_submissions sorgusu yerine, canonical
  // architects.office_id zaten HER iki kökenden (statik + üye) gelen mimarı tek sorguda kapsar.
  const canonOffice = await env.DB.prepare(`SELECT id FROM offices WHERE name = ? OR legacy_key = ? LIMIT 1`).bind(name, name).first();
  const affiliated = new Set();
  if (canonOffice) {
    const { results } = await env.DB.prepare(`SELECT name FROM architects WHERE office_id = ? AND deleted_at IS NULL`).bind(canonOffice.id).all();
    for (const row of results) affiliated.add(row.name);
  }
  const { results: pendingRows } = await env.DB.prepare(
    `SELECT DISTINCT name FROM architect_submissions WHERE office = ? AND status = 'approved'`
  ).bind(name).all();
  for (const row of pendingRows) affiliated.add(row.name);
  for (const architectName of affiliated) {
    await clearArchitectOfficeIfMatches(env, user, architectName, name);
  }
}

// Bir proje SİLİNDİĞİNDE — aldığı yorum/puan/kaydetme kayıtları silinir. Başka hiçbir tablo bir
// projeye slug ile referans vermez (bkz. schema.sql).
export async function cascadeDeleteProject(env, slug) {
  await deleteEngagement(env, 'project', slug);
}

// Kullanıcı "Hesabımı Sil" dediğinde (KVKK/GDPR silme talebi, bkz. src/routes/auth.js#deleteAccount)
// — kendi kişisel/etkileşim verileri (oturumlar, kaydettikleri, yorumları, puanları, bildirimleri,
// profil talepleri/düzeltmeleri/rozet talepleri, şifre sıfırlama token'ları) ve users satırı silinir.
// Onaylı gönderileri (project_submissions/office_submissions/architect_submissions vb. — canlı
// projeler/profiller, başka kullanıcıların yorum/puanlarının bağlı olduğu içerik) KASITLI OLARAK
// silinmez; owner_user_id yetim kalır (bkz. kullanıcı isteği: yalnızca "sessions, saved_items,
// notifications vb." bağlı kişisel veriler silinsin, canlı site içeriği değil).
export async function cascadeDeleteAccount(env, userId) {
  await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
  await env.DB.prepare(`DELETE FROM saved_items WHERE user_id = ?`).bind(userId).run();
  await env.DB.prepare(`DELETE FROM notifications WHERE user_id = ?`).bind(userId).run();
  await env.DB.prepare(`DELETE FROM comments WHERE user_id = ?`).bind(userId).run();
  await env.DB.prepare(`DELETE FROM ratings WHERE user_id = ?`).bind(userId).run();
  await env.DB.prepare(`DELETE FROM profile_claims WHERE user_id = ?`).bind(userId).run();
  await env.DB.prepare(`DELETE FROM profile_corrections WHERE user_id = ?`).bind(userId).run();
  await env.DB.prepare(`DELETE FROM badge_requests WHERE user_id = ?`).bind(userId).run();
  await env.DB.prepare(`DELETE FROM password_resets WHERE user_id = ?`).bind(userId).run();
  await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();
}
