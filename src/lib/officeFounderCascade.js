import { newId } from './crypto.js';
import { parseSubmissionRow } from './submissionTypes.js';
import { purgeSsrDetailCache } from './ssrCache.js';
import dataJs from '../../data.js';

const { architects: staticArchitects } = dataJs;

const ARCHITECT_COPY_FIELDS = ['dob', 'school', 'dept', 'office', 'position', 'profession', 'awards', 'photo_url', 'about'];

// Bir mimarın "şu an canlıda görünen" office'ini (statik architects[].office + varsa onaylı
// architect_submissions bindirmesi — bkz. src/routes/legacyContent.js#CONTENT_ACTION_TYPES.architects
// ile aynı desen) ve varsa hâlihazırdaki satırını döner. Ne statik kayıt ne de daha önce bir
// düzenleme/gönderi varsa null döner (adı bilinmeyen bir isim — Kurucular kutusuna yanlışlıkla
// yazılmış olabilir, sessizce yok sayılır).
async function currentArchitectState(env, name) {
  const base = staticArchitects.find(a => a.name === name);
  const editRow = await env.DB.prepare(
    `SELECT * FROM architect_submissions WHERE claimed_profile_key = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT 1`
  ).bind(name).first();
  if (editRow) {
    const parsed = parseSubmissionRow('architects', editRow);
    return { row: editRow, office: parsed.office, fields: parsed };
  }
  if (base) {
    return {
      row: null,
      office: base.office || null,
      fields: {
        dob: base.dob || null, school: base.school || null, dept: base.dept || null,
        office: base.office || null, position: base.role || null, profession: base.profession || null,
        awards: base.awards || [], photo_url: base.photo || base.photo_url || null, about: base.about || null,
      },
    };
  }
  // Statik bir kayıt değil — sıradan (statik bir profili sahiplenmeyen) bir architect_submissions
  // satırı olabilir (bkz. schema.sql#architect_submissions claimed_profile_key açıklaması).
  const plainRow = await env.DB.prepare(
    `SELECT * FROM architect_submissions WHERE name = ? AND claimed_profile_key IS NULL AND status = 'approved' ORDER BY updated_at DESC LIMIT 1`
  ).bind(name).first();
  if (!plainRow) return null;
  const parsed = parseSubmissionRow('architects', plainRow);
  return { row: plainRow, office: parsed.office, fields: parsed };
}

// Bir firmanın Kurucular listesinden çıkarılan TEK bir ismin, hâlâ o firmayı gösteren kendi office
// alanını temizler. Gerçek "kurucu/ortak" görünürlüğü (bkz. ofis-detay.html#renderFoundersGrid,
// mimar-detay.html "diğer ortaklar") office_submissions.founders değil, HER mimarın KENDİ office
// alanı tarafından belirlendiğinden — bu olmadan kişi, Kurucular'dan çıkarılsa bile firma sayfasında
// ve diğer ortakların profilinde görünmeye devam ederdi (bkz. kullanıcı isteği/gerçek bulgu: bir
// firma düzenleye ortak silindiğinde hem firmanın hem de diğer ortakların profilinde adı kalıyordu).
export async function clearArchitectOfficeIfMatches(env, user, architectName, officeName) {
  const current = await currentArchitectState(env, architectName);
  if (!current || current.office !== officeName) return; // zaten farklı/boş bir office'e sahip — dokunma
  const now = Date.now();
  if (current.row) {
    await env.DB.prepare(`UPDATE architect_submissions SET office = NULL, updated_at = ? WHERE id = ?`).bind(now, current.row.id).run();
  } else {
    // Statik bir mimar için ilk kez oluşturulan bindirme satırı — diğer statik alanları koruyup
    // yalnızca office'i temizler (bkz. handleContentAction'daki AYNI "statikten taslak oluştur" deseni).
    const fields = { ...current.fields, office: null };
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

// Bir firmanın adı değiştiğinde (bkz. src/routes/submissions.js#updateOwnSubmission, src/routes/
// admin.js#handleSubmissionsAdmin — yalnızca admin claimed_profile_key'den FARKLI bir isim
// gönderebilir), bu ismi anahtar olarak kullanan TÜM diğer D1 satırlarını yeni isme taşır — aksi
// halde kaydedilmiş öğeler/rozetler/sahiplenmeler/yorumlar/puanlar/gizlenmiş kayıtlar eski ada
// bağlı kalıp sessizce "kaybolurdu" (bkz. kullanıcı isteği: "Admin hesabına tüm firma isimlerini
// değişebilme yetkisi ver"). saved_items/profile_claims/ratings/legacy_content_hidden UNIQUE
// kısıtı taşıdığından UPDATE OR IGNORE kullanılır (ör. bir kullanıcı hem eski hem yeni adı zaten
// kaydetmişse çakışan satır sessizce atlanır, hata fırlatmaz). Statik data.js/projeler-data.js
// kaynak dosyalarındaki isim referansları (designer[] dizileri) bu fonksiyonun kapsamı DIŞINDADIR
// — worker çalışma zamanında statik dosyaları düzenleyemez; bunlar yerine data.js#
// renameOfficeEverywhere her sayfa yüklendiğinde offices[].name'i (ve projects[]/architects[]
// içindeki referansları) çalışma zamanında bindirir (bkz. handlePublicProfileEdits'in office
// overlay'ine eklenen `name` alanı).
export async function renameOfficeEverywhere(env, oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  await Promise.all([
    env.DB.prepare(`UPDATE OR IGNORE saved_items SET item_key = ? WHERE item_type = 'office' AND item_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE OR IGNORE profile_claims SET profile_key = ? WHERE profile_type = 'office' AND profile_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE profile_corrections SET profile_key = ? WHERE profile_type = 'office' AND profile_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE badge_requests SET target_key = ? WHERE target_type = 'office' AND target_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE OR IGNORE ratings SET target_id = ? WHERE target_type = 'office' AND target_id = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE comments SET target_id = ? WHERE target_type = 'office' AND target_id = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE OR IGNORE legacy_content_hidden SET content_key = ? WHERE content_type = 'offices' AND content_key = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE architect_submissions SET office = ? WHERE office = ?`).bind(newName, oldName).run(),
    // Admin'in doğrudan verdiği rozet de (bkz. schema.sql#admin_badges) yeni isme taşınır, aksi
    // halde firma yeniden adlandırıldığında rozeti sessizce kaybolurdu.
    env.DB.prepare(`UPDATE OR IGNORE admin_badges SET profile_key = ? WHERE profile_type = 'office' AND profile_key = ?`).bind(newName, oldName).run(),
  ]);

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
