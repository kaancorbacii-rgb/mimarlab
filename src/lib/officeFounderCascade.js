import { newId } from './crypto.js';
import { parseSubmissionRow } from './submissionTypes.js';
import { purgeSsrDetailCache } from './ssrCache.js';
import { slugify } from './slugify.js';

const ARCHITECT_COPY_FIELDS = ['dob', 'school', 'dept', 'office', 'position', 'profession', 'awards', 'photo_url', 'about'];

// Bir mimarın "şu an canlıda görünen" hâli artık DOĞRUDAN canonical architects tablosundan okunur
// (bkz. src/routes/architect.js — Faz 3'ten önce burada statik data.js + architect_submissions
// overlay'i AYRICA hesaplanıyordu, artık gerek yok çünkü canonical satırın kendisi zaten güncel).
async function currentArchitectState(env, name) {
  const row = await env.DB.prepare(`SELECT * FROM architects WHERE deleted_at IS NULL AND (name = ? OR legacy_key = ?) LIMIT 1`).bind(name, name).first();
  if (!row) return null;
  const office = row.office_id ? await env.DB.prepare(`SELECT name FROM offices WHERE id = ?`).bind(row.office_id).first() : null;
  return { id: row.id, office: office ? office.name : null };
}

// Bir firmanın Kurucular listesinden çıkarılan TEK bir ismin, hâlâ o firmayı gösteren kendi office
// bağlantısını temizler. Gerçek "kurucu/ortak" görünürlüğü artık office_founders join tablosundan
// gelir (bkz. src/routes/office.js) — bu fonksiyon canonical architects.office_id'yi NULL'lar ve
// office_founders satırını siler; *_submissions tarafındaki gelecekteki bir düzenlemenin de aynı
// (boş) office'i göndermesi için architect_submissions'taki en son onaylı satırı da (varsa) günceller.
export async function clearArchitectOfficeIfMatches(env, user, architectName, officeName) {
  const current = await currentArchitectState(env, architectName);
  if (!current || current.office !== officeName) return; // zaten farklı/boş bir office'e sahip — dokunma
  await env.DB.prepare(`UPDATE architects SET office_id = NULL, updated_at = datetime('now') WHERE id = ?`).bind(current.id).run();
  await env.DB.prepare(`DELETE FROM office_founders WHERE architect_id = ?`).bind(current.id).run();

  const now = Date.now();
  const editRow = await env.DB.prepare(
    `SELECT * FROM architect_submissions WHERE claimed_profile_key = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT 1`
  ).bind(architectName).first();
  if (editRow) {
    await env.DB.prepare(`UPDATE architect_submissions SET office = NULL, updated_at = ? WHERE id = ?`).bind(now, editRow.id).run();
  } else {
    const fields = { dob: null, school: null, dept: null, office: null, position: null, profession: null, awards: [], photo_url: null, about: null };
    const columns = ['id', 'owner_user_id', 'status', 'created_at', 'updated_at', 'claimed_profile_key', 'name', ...ARCHITECT_COPY_FIELDS];
    const values = ARCHITECT_COPY_FIELDS.map(f => (f === 'awards' ? JSON.stringify(fields.awards || []) : (fields[f] ?? null)));
    await env.DB.prepare(
      `INSERT INTO architect_submissions (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(newId(), user.id, 'approved', now, now, architectName, architectName, ...values).run();
  }
  await purgeSsrDetailCache('architect', architectName);
}

// offices submission update sırasında çağrılır (bkz. src/routes/submissions.js#updateOwnSubmission,
// src/routes/admin.js#handleSubmissionsAdmin) — eski ve yeni Kurucular listesini karşılaştırıp
// ÇIKARILAN her ismi cascade'ler. Eklenen/değişmeyen isimler için hiçbir şey yapılmaz — bir mimarın
// kendi office alanını Kurucular listesine EKLEMEK bu fonksiyonun işi değil (yalnızca çıkarma yönü).
export async function cascadeRemovedFounders(env, user, officeName, oldFounders, newFounders) {
  const oldSet = new Set((oldFounders || []).filter(Boolean));
  const newSet = new Set((newFounders || []).filter(Boolean));
  const removed = [...oldSet].filter(name => !newSet.has(name));
  for (const name of removed) {
    await clearArchitectOfficeIfMatches(env, user, name, officeName);
  }
}

async function freshSlugFor(env, table, currentId, newName) {
  const base = slugify(newName) || `kayit-${currentId}`;
  let slug = base, n = 2;
  while (true) {
    const clash = await env.DB.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`).bind(slug, currentId).first();
    if (!clash) return slug;
    slug = `${base}-${n}`; n++;
  }
}

// Bir firmanın adı değiştiğinde (bkz. src/routes/submissions.js#updateOwnSubmission, src/routes/
// admin.js#handleSubmissionsAdmin — yalnızca admin claimed_profile_key'den FARKLI bir isim
// gönderebilir), bu ismi anahtar olarak kullanan TÜM diğer D1 satırlarını yeni isme taşır — aksi
// halde kaydedilmiş öğeler/rozetler/sahiplenmeler/yorumlar/puanlar/gizlenmiş kayıtlar eski ada
// bağlı kalıp sessizce "kaybolurdu" (bkz. kullanıcı isteği: "Admin hesabına tüm firma isimlerini
// değişebilme yetkisi ver"). saved_items/profile_claims/ratings/legacy_content_hidden UNIQUE
// kısıtı taşıdığından UPDATE OR IGNORE kullanılır. Faz 3: canonical offices.name/slug de burada
// güncellenir (bkz. src/routes/office.js — canonical artık okuma yolunun asıl kaynağı, `slug`
// tazeyken clean URL'ler yeniden derlenme/tam-tarama fallback'ine ihtiyaç duymadan hemen çalışır).
export async function renameOfficeEverywhere(env, oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  const canonRow = await env.DB.prepare(`SELECT id FROM offices WHERE deleted_at IS NULL AND (name = ? OR legacy_key = ?) LIMIT 1`).bind(oldName, oldName).first();
  await Promise.all([
    env.DB.prepare(`UPDATE OR IGNORE saved_items SET item_key = ? WHERE item_type = 'office' AND item_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE OR IGNORE profile_claims SET profile_key = ? WHERE profile_type = 'office' AND profile_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE profile_corrections SET profile_key = ? WHERE profile_type = 'office' AND profile_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE badge_requests SET target_key = ? WHERE target_type = 'office' AND target_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE OR IGNORE ratings SET target_id = ? WHERE target_type = 'office' AND target_id = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE comments SET target_id = ? WHERE target_type = 'office' AND target_id = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE OR IGNORE legacy_content_hidden SET content_key = ? WHERE content_type = 'offices' AND content_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE architect_submissions SET office = ? WHERE office = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE OR IGNORE admin_badges SET profile_key = ? WHERE profile_type = 'office' AND profile_key = ?`).bind(newName, oldName).run(),
  ]);

  if (canonRow) {
    const newSlug = await freshSlugFor(env, 'offices', canonRow.id, newName);
    await env.DB.prepare(`UPDATE offices SET name = ?, slug = ?, updated_at = datetime('now') WHERE id = ?`).bind(newName, newSlug, canonRow.id).run();
  }

  // project_submissions.designer bir JSON dizisi (metin olarak saklanır) — SQL ile tek satırda
  // güvenle değiştirilemeyeceğinden satır satır okunup yazılır.
  const { results } = await env.DB.prepare(
    `SELECT id, designer FROM project_submissions WHERE designer LIKE ?`
  ).bind(`%${oldName}%`).all();
  for (const row of results) {
    try {
      const list = JSON.parse(row.designer || '[]');
      if (!Array.isArray(list) || !list.includes(oldName)) continue;
      const updated = list.map(d => d === oldName ? newName : d);
      await env.DB.prepare(`UPDATE project_submissions SET designer = ? WHERE id = ?`).bind(JSON.stringify(updated), row.id).run();
    } catch { /* bozuk JSON — dokunma */ }
  }
}

// renameOfficeEverywhere'in mimar karşılığı (bkz. src/routes/submissions.js#updateOwnSubmission,
// src/routes/admin.js — yalnızca admin claimed_profile_key'den FARKLI bir isim gönderebilir). Bir
// mimarın adı değiştiğinde, bu ismi anahtar olarak kullanan TÜM diğer D1 satırlarını yeni isme
// taşır. Faz 3: canonical architects.name/slug de burada güncellenir (bkz. yukarıdaki
// renameOfficeEverywhere'deki AYNI gerekçe).
export async function renameArchitectEverywhere(env, oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  const canonRow = await env.DB.prepare(`SELECT id FROM architects WHERE deleted_at IS NULL AND (name = ? OR legacy_key = ?) LIMIT 1`).bind(oldName, oldName).first();
  await Promise.all([
    env.DB.prepare(`UPDATE OR IGNORE saved_items SET item_key = ? WHERE item_type = 'architect' AND item_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE OR IGNORE profile_claims SET profile_key = ? WHERE profile_type = 'architect' AND profile_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE profile_corrections SET profile_key = ? WHERE profile_type = 'architect' AND profile_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE badge_requests SET target_key = ? WHERE target_type = 'architect' AND target_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE OR IGNORE ratings SET target_id = ? WHERE target_type = 'architect' AND target_id = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE comments SET target_id = ? WHERE target_type = 'architect' AND target_id = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE OR IGNORE legacy_content_hidden SET content_key = ? WHERE content_type = 'architects' AND content_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE OR IGNORE admin_badges SET profile_key = ? WHERE profile_type = 'architect' AND profile_key = ?`).bind(newName, oldName).run(),
  ]);

  if (canonRow) {
    const newSlug = await freshSlugFor(env, 'architects', canonRow.id, newName);
    await env.DB.prepare(`UPDATE architects SET name = ?, slug = ?, updated_at = datetime('now') WHERE id = ?`).bind(newName, newSlug, canonRow.id).run();
  }

  const { results: projectRows } = await env.DB.prepare(
    `SELECT id, designer FROM project_submissions WHERE designer LIKE ?`
  ).bind(`%${oldName}%`).all();
  for (const row of projectRows) {
    try {
      const list = JSON.parse(row.designer || '[]');
      if (!Array.isArray(list) || !list.includes(oldName)) continue;
      const updated = list.map(d => d === oldName ? newName : d);
      await env.DB.prepare(`UPDATE project_submissions SET designer = ? WHERE id = ?`).bind(JSON.stringify(updated), row.id).run();
    } catch { /* bozuk JSON — dokunma */ }
  }

  const { results: officeRows } = await env.DB.prepare(
    `SELECT id, founders FROM office_submissions WHERE founders LIKE ?`
  ).bind(`%${oldName}%`).all();
  for (const row of officeRows) {
    try {
      const list = JSON.parse(row.founders || '[]');
      if (!Array.isArray(list) || !list.includes(oldName)) continue;
      const updated = list.map(f => f === oldName ? newName : f);
      await env.DB.prepare(`UPDATE office_submissions SET founders = ? WHERE id = ?`).bind(JSON.stringify(updated), row.id).run();
    } catch { /* bozuk JSON — dokunma */ }
  }

  for (const table of ['product_submissions', 'material_submissions']) {
    const { results: rows } = await env.DB.prepare(
      `SELECT id, architect FROM ${table} WHERE architect LIKE ?`
    ).bind(`%${oldName}%`).all();
    for (const row of rows) {
      const names = (row.architect || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!names.includes(oldName)) continue;
      const updated = names.map(n => n === oldName ? newName : n).join(', ');
      await env.DB.prepare(`UPDATE ${table} SET architect = ? WHERE id = ?`).bind(updated, row.id).run();
    }
  }
}
