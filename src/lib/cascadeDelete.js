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
  // Paylaştıklarım (bkz. migrations/0074_shared_items.sql) — saved_items İLE AYNI gerekçe: silinen
  // içeriğe ait satırlar kalırsa Aktivitelerim artık var olmayan bir hedefi listelemeye devam eder.
  await env.DB.prepare(`DELETE FROM shared_items WHERE item_type = ? AND item_key = ?`).bind(type, key).run();
  // follows yalnızca 'architect'/'office' için satır barındırır (bkz. schema.sql) — bu fonksiyon
  // proje/ürün silmede de çağrıldığından (type='project'/'product') o çağrılarda zaten eşleşen
  // satır olmayacağı için no-op, saved_items İLE AYNI paylaşılan-fonksiyon deseni.
  await env.DB.prepare(`DELETE FROM follows WHERE followed_type = ? AND followed_key = ?`).bind(type, key).run();
}

// Bir <tip>_submissions JSON dizi kolonundan (designer/brands/founders) belirli bir ismi çıkarıp
// geri yazar — LIKE yerine tüm satırları çekip JS'te filtreler (isimde SQL LIKE özel karakterleri
// (%, _) olsa bile yanlış eşleşme riski olmasın diye; tablo boyutları bu siteye göre küçük).
// gerçek bulgu (denetim raporu, 2026-08-16): önceki sürüm eşleşen HER satır için AYRI, SIRALI bir
// UPDATE .run() çağırıyordu — src/lib/officeFounderCascade.js#renameOfficeEverywhere'deki AYNI sınıf
// sorun (tanınmış bir mimar/ofis onlarca satırda geçiyorsa Workers'ın subrequest limitine
// yaklaşabilir/silme yarıda kalabilir). Artık eşleşen satırlar toplanıp TEK bir env.DB.batch()
// çağrısıyla yazılıyor (rename fonksiyonlarındaki AYNI desen).
async function pullNameFromArrayColumn(env, table, column, name) {
  const { results } = await env.DB.prepare(`SELECT id, ${column} FROM ${table} WHERE ${column} IS NOT NULL`).all();
  const updates = [];
  for (const row of results) {
    let arr;
    try { arr = JSON.parse(row[column]); } catch { continue; }
    if (!Array.isArray(arr) || !arr.includes(name)) continue;
    updates.push(env.DB.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).bind(JSON.stringify(arr.filter(v => v !== name)), row.id));
  }
  if (updates.length) await env.DB.batch(updates);
}

// product_submissions/material_submissions.architect serbest metin, virgülle ayrılmış isim listesi
// tutar (JSON dizi DEĞİL — bkz. migrations/0020_product_architect.sql yorumu) — bu yüzden
// pullNameFromArrayColumn'daki JSON.parse deseni burada kullanılamaz. src/lib/officeFounderCascade.js
// #renameArchitectEverywhere'in AYNI split(',')/trim deseniyle ismi çıkarıp geri yazar. Aynı
// gerekçeyle (yukarısı) eşleşen satırlar TEK bir env.DB.batch() çağrısıyla yazılır.
async function pullNameFromCsvColumn(env, table, name) {
  const { results } = await env.DB.prepare(`SELECT id, architect FROM ${table} WHERE architect LIKE ?`).bind(`%${name}%`).all();
  const updates = [];
  for (const row of results) {
    const names = (row.architect || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!names.includes(name)) continue;
    const updated = names.filter(n => n !== name).join(', ');
    updates.push(env.DB.prepare(`UPDATE ${table} SET architect = ? WHERE id = ?`).bind(updated, row.id));
  }
  if (updates.length) await env.DB.batch(updates);
}

// Bir mimar SİLİNDİĞİNDE (bkz. src/routes/legacyContent.js#handleContentAction, src/routes/admin.js
// DELETE) — kendi profil talepleri/düzeltme önerileri, aldığı yorum/puan/kaydetme kayıtları silinir;
// adı hâlâ başka bir firmanın Kurucular listesinde, bir projenin mimar/tasarımcı listesinde ya da bir
// ürün/malzeme başvurusunun tasarımcı alanında geçiyorsa oradan da çıkarılır (bkz. kullanıcı isteği:
// "tüm sistemden o bilgi silinsin" — rename cascade'i (officeFounderCascade.js#renameArchitectEverywhere)
// bu iki tabloyu zaten güncelliyordu, delete cascade'i güncellemiyordu: gerçek bulgu). Statik
// (projeler-data.js/data.js) kayıtlardaki isim referansları çalışma zamanında düzenlenemez — bu,
// projenin bilinen bir kısıtı (bkz. "Duplicate name key limitation" belleği).
export async function cascadeDeleteArchitect(env, name) {
  await env.DB.prepare(`DELETE FROM profile_claims WHERE profile_type = 'architect' AND profile_key = ?`).bind(name).run();
  await env.DB.prepare(`DELETE FROM profile_corrections WHERE profile_type = 'architect' AND profile_key = ?`).bind(name).run();
  await env.DB.prepare(`DELETE FROM admin_badges WHERE profile_type = 'architect' AND profile_key = ?`).bind(name).run();
  await deleteEngagement(env, 'architect', slugify(name));
  await pullNameFromArrayColumn(env, 'office_submissions', 'founders', name);
  await pullNameFromArrayColumn(env, 'project_submissions', 'designer', name);
  await pullNameFromCsvColumn(env, 'product_submissions', name);
  await pullNameFromCsvColumn(env, 'material_submissions', name);
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

// Bir proje SİLİNDİĞİNDE — aldığı yorum/puan/kaydetme kayıtları silinir. (top100_entries.slug
// burada temizlenmez — bkz. src/lib/canonicalSync.js#renameProjectSlugEverywhere yorumu;
// computeTop100 zaten eşleşmeyen slug'ı "bağlantısız" olarak ele alıp eski statik isme düşer.)
// Düello temizliği KALDIRILDI (2026-09-05, ölü tablo temizliği): Düello özelliği yayından
// kaldırılmıştı (src/routes/duel.js ve duello.html artık YOK) ama project_duel_stats/duel_matches/
// duel_sessions tabloları D1'de duruyordu ve BURASI onlara hâlâ yazıyordu. Tablolar
// migrations/0090_drop_dead_feature_tables.sql ile düşürüldüğünden bu üç ifade "no such table"
// fırlatır ve admin'in HER proje silme işlemini kırardı — bu yüzden tablo DROP'undan ÖNCE
// kaldırılmaları zorunluydu.
export async function cascadeDeleteProject(env, slug) {
  await deleteEngagement(env, 'project', slug);
}

// Bir ürün/malzeme SİLİNDİĞİNDE — aldığı puan/kaydetme kayıtları silinir (comments bu tipleri hiç
// desteklemiyor, bkz. src/routes/comments.js#TARGET_TYPES).
export async function cascadeDeleteProduct(env, engagementType, key) {
  await deleteEngagement(env, engagementType, key);
}

// Kullanıcı "Hesabımı Sil" dediğinde (KVKK/GDPR silme talebi, bkz. src/routes/auth.js#deleteAccount)
// — kendi kişisel/etkileşim verileri (oturumlar, kaydettikleri, yorumları, puanları, bildirimleri,
// profil talepleri/düzeltmeleri/rozet talepleri, şifre sıfırlama token'ları) ve users satırı silinir.
// Onaylı gönderileri (project_submissions/office_submissions/architect_submissions vb. — canlı
// projeler/profiller, başka kullanıcıların yorum/puanlarının bağlı olduğu içerik) KASITLI OLARAK
// silinmez; owner_user_id yetim kalır (bkz. kullanıcı isteği: yalnızca "sessions, saved_items,
// notifications vb." bağlı kişisel veriler silinsin, canlı site içeriği değil).
// audit bulgusu (denetim raporu, 2026-08-21): bu adımlar önceden ayrı ayrı sıralı .run() çağrılarıyla
// yazılıyordu — biri (ör. `DELETE FROM users`) ortada hata verirse önceki adımlar zaten kalıcı olarak
// commit edilmiş oluyor, hesap YARIM silinmiş durumda kalabiliyordu (kişisel veriler gitmiş ama users
// satırı hâlâ duruyor, ya da tam tersi). `users` satırının en SONDA silinmesi (notifications/
// profile_corrections'ın kendi FK'siyle users(id)'ye referans vermesi nedeniyle) ZORUNLU sıra — bu sıra
// batch içinde de KORUNUR, D1 batch'i tek bir transaction olarak sıralı yürütür. Tüm adımlar artık TEK
// bir env.DB.batch() çağrısıyla atomik: ya hepsi ya hiçbiri.
export async function cascadeDeleteAccount(env, userId) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM saved_items WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM shared_items WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM follows WHERE user_id = ?`).bind(userId),
    // Koleksiyonum (bkz. migrations/0073_collections.sql) — saved_items/follows İLE AYNI gerekçe:
    // tamamen bu kullanıcıya ait kişisel pano verisi. collection_items, collections'a ON DELETE
    // CASCADE ile bağlı olsa da D1'de foreign_keys pragma'sına güvenilmediğinden (bkz. bu dosyadaki
    // diğer adımların da hepsinin AÇIKÇA silinmesi) çocuk satırlar önce, açıkça silinir.
    env.DB.prepare(`DELETE FROM collection_items WHERE collection_id IN (SELECT id FROM collections WHERE user_id = ?)`).bind(userId),
    // board_shares iki yönden bu kullanıcıya değebilir: (a) sildiği panolara başkalarını davet etmiş
    // olabilir (collection_id üzerinden), (b) kendisi başka birinin panosuna davetli olabilir
    // (user_id üzerinden) — ikisi de collections satırından ÖNCE, açıkça silinir.
    env.DB.prepare(`DELETE FROM board_shares WHERE collection_id IN (SELECT id FROM collections WHERE user_id = ?)`).bind(userId),
    // board_strokes (Çizim Aracı, bkz. migrations/0095_board_a4_canvas_and_strokes.sql) — AYNI
    // gerekçe: sildiği panoların çizimleri (collection_id) + başka birinin panosuna çizdiği izler
    // (created_by_user_id) ikisi de collections'tan ÖNCE temizlenir.
    env.DB.prepare(`DELETE FROM board_strokes WHERE collection_id IN (SELECT id FROM collections WHERE user_id = ?)`).bind(userId),
    env.DB.prepare(`DELETE FROM board_strokes WHERE created_by_user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM board_shares WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM collections WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM notifications WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM comments WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM ratings WHERE user_id = ?`).bind(userId),
    // (Düello satırları KALDIRILDI — 2026-09-05 ölü tablo temizliği, bkz. cascadeDeleteProject'teki
    // aynı gerekçe. BURADA ayrıca kritikti: bu adımlar TEK bir env.DB.batch() içinde, yani tek bir
    // transaction'da yürüyor — düşürülmüş bir tabloya yapılan tek bir ifade TÜM hesap silme
    // işlemini atomik olarak başarısız kılardı ve "Hesabımı Sil" (KVKK/GDPR silme hakkı) kalıcı
    // olarak çalışmaz hâle gelirdi.)
    env.DB.prepare(`DELETE FROM profile_claims WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM profile_corrections WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM badge_requests WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM password_resets WHERE user_id = ?`).bind(userId),
    // gerçek bulgu (denetim raporu, 2026-08-16): architects/offices/projects/products.claimed_by_user_id
    // (bkz. migrations/0022_id_first_entities.sql) hesap silinirken temizlenmiyordu — profil artık var
    // olmayan bir user_id'ye kalıcı "sahiplenilmiş" görünüp yeniden claim edilemez hale geliyordu.
    // Yukarıdaki dosya-başı yorumdaki AYNI ilke burada da geçerli: canlı içeriğin KENDİSİ (profil/proje)
    // silinmez, yalnızca bu kullanıcıyla kişisel bağı (sahiplik/talep durumu) temizlenir — profil claim
    // edilmemiş duruma döner.
    env.DB.prepare(`UPDATE architects SET claimed_by_user_id = NULL WHERE claimed_by_user_id = ?`).bind(userId),
    env.DB.prepare(`UPDATE offices SET claimed_by_user_id = NULL WHERE claimed_by_user_id = ?`).bind(userId),
    env.DB.prepare(`UPDATE projects SET claimed_by_user_id = NULL WHERE claimed_by_user_id = ?`).bind(userId),
    env.DB.prepare(`UPDATE products SET claimed_by_user_id = NULL WHERE claimed_by_user_id = ?`).bind(userId),
    // migration_name_conflicts.resolved_by_user_id (bkz. migrations/0022_id_first_entities.sql) yalnızca
    // admin panelinde "kim çözdü" bilgisini gösterir, canlı içerik değildir — dangling referans admin
    // panelinde boş/kırık kullanıcı bilgisi göstermesin diye NULL'lanır.
    env.DB.prepare(`UPDATE migration_name_conflicts SET resolved_by_user_id = NULL WHERE resolved_by_user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId),
  ]);
}
