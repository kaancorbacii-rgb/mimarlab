import { newId } from './crypto.js';
import { parseSubmissionRow } from './submissionTypes.js';
import { purgeSsrDetailCache } from './ssrCache.js';
import { slugify } from './slugify.js';
import { recordSlugRedirect } from './slugRedirects.js';
import { createNotification } from './notify.js';

// src/routes/office.js#trLower ile BİREBİR aynı (bu dosyada da aynı sebeple yerel olarak tekrar
// tanımlanmış — bkz. o dosyadaki yorum) — Kurucular/Ekip kutusundaki bir isim, o firmaya onaylı bir
// profile_claims hesabıyla eşleştirilirken Türkçe İ/I/ı/i büyük-küçük harf katlamasının SQL LIKE'ın
// bilmediği kurallarla doğru yapılması gerekir.
function trLower(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}

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

// office.js#buildOfficePayload'daki AYNI kurucu/ekip ayrımı — bir profile_claims('office') satırı
// bu pozisyonlardaysa Kurucular'a, değilse Ekip'e sayılır.
const FOUNDER_POSITIONS = new Set(['Kurucu', 'Kurucu Ortak']);

// gerçek bulgu (kullanıcı isteği): Kurucular/Ekip kutusundan bir isim çıkarılıp kaydedildiğinde
// (ör. admin panelinden firma düzenle > Ekip), o kişinin buildOfficePayload'da (bkz. src/routes/
// office.js) hâlâ görünmeye devam etmesinin nedeni cascadeRemovedFounders'ın YALNIZCA architects.
// office_id bağlantısını temizlemesiydi — asıl "kurucu/ekip" görünürlüğü çoğu zaman bundan değil,
// kullanıcının kendi hesabına ait onaylı bir profile_claims('office', ...) satırından geliyor (bkz.
// office.js#buildOfficePayload teamClaimRows) ve o satıra hiç dokunulmuyordu.
//
// ESKİ/NAİF tasarım (isim listesinin ÖNCEKİ ve YENİ office_submissions.founders/team sütunlarını
// karşılaştırmak) burada KASITLI OLARAK kullanılmadı: bu sütunlar yalnızca elle yazılmış ham metindir
// — bir claim sahibinin adı firma-ekle.html'in kendisi tarafından kutuya yalnızca GÖRÜNTÜLEME anında
// (bkz. mergeTeamNames) eklenir, satıra hiç YAZILMAMIŞ olabilir. Bu durumda "eski sütun" o ismi hiç
// içermediğinden bir "çıkarma" tespit edilemez, kişi kutudan silinip kaydedilse bile claim'i asla
// reddedilmezdi. Bunun yerine bu firmaya ait TÜM onaylı profile_claims satırları doğrudan sorgulanır:
// kutunun bu bölüme karşılık gelen (Kurucu/Kurucu Ortak ya da diğerleri) her onaylı claim sahibi için,
// adı YENİ gönderilen listede yoksa reddedilmiş sayılır. Bu güvenli: firma-ekle.html#prefillForEdit/
// prefillForClaim ARTIK (bkz. kullanıcı isteği'ndeki Kurucular otomatik doldurma düzeltmesi) formu
// AÇARKEN tüm claim sahiplerinin adını zaten kutuya yazıyor, yani normal bir düzenlemede (kimseyi
// silmeden kaydetmek) bu isimler YENİ listede de olur — yalnızca editör GERÇEKTEN o ismi kutudan
// silip kaydederse "reddedilmiş" sayılır.
export async function cascadeRemovedProfileClaims(env, officeName, newNames, { founders = false } = {}) {
  const newSet = new Set((newNames || []).filter(Boolean).map(n => trLower(n.trim())));

  const { results } = await env.DB.prepare(
    `SELECT c.id, c.user_id, u.name, u.position FROM profile_claims c JOIN users u ON u.id = c.user_id
     WHERE c.profile_type = 'office' AND c.profile_key = ? AND c.status = 'approved'`
  ).bind(officeName).all();
  const relevant = (results || []).filter(r => founders === FOUNDER_POSITIONS.has(r.position));
  const toRevoke = relevant.filter(r => !newSet.has(trLower((r.name || '').trim())));
  if (!toRevoke.length) return;

  const now = Date.now();
  await env.DB.batch(toRevoke.map(r =>
    env.DB.prepare(`UPDATE profile_claims SET status = 'rejected', updated_at = ? WHERE id = ?`).bind(now, r.id)
  ));
  for (const r of toRevoke) {
    await createNotification(
      env, r.user_id, 'claim_rejected',
      'Firma profili talebin reddedildi',
      `"${officeName}" firmasının ${founders ? 'Kurucular' : 'Ekip'} listesinden çıkarıldığın için profil bağlantın kaldırıldı.`,
      'hesabim.html'
    );
  }
}

export async function freshSlugFor(env, table, currentId, newName) {
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
  if (!oldName || !newName || oldName === newName) return null;
  // name=newName da denenir: bu fonksiyon syncApprovedSubmissionToCanonical'DAN SONRA çağrılır (bkz.
  // src/routes/submissions.js#updateOwnSubmission/admin.js#handleSubmissionsAdmin) — claimed bir
  // profilde syncOffice, canonical satırı claimed_profile_key (SABİT, orijinal statik ad) ile bulup
  // adını burada ÇAĞRILMADAN ÖNCE zaten yeni ada çevirmiş olabilir (özellikle legacy_static
  // OLMAYAN, sonradan sahiplenilmiş bir profilde legacy_key orijinal adı taşımaz — bkz. gerçek
  // bulgu, ikinci bir "hayalet" canonical satır oluşturuyordu). name=oldName clause'u legacy_static
  // (legacy_key HER ZAMAN orijinal ad, hiç değişmez) profillerde ve bu fonksiyon sync'TEN ÖNCE
  // çağrılan diğer yollarda (ör. admin.js'in eski sırası) hâlâ çalışsın diye korunur.
  const canonRow = await env.DB.prepare(
    `SELECT id, slug FROM offices WHERE deleted_at IS NULL AND (name = ? OR name = ? OR legacy_key = ?) LIMIT 1`
  ).bind(oldName, newName, oldName).first();
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
    // ürün/malzeme "Firma" kutusu (bkz. urun-ekle.html) canonical'a onaylanmadan önce burada
    // düz metin olarak durur — bir firma yeniden adlandırıldığında bekleyen/onaylı bu taslaklar
    // da eski adı sonsuza dek göstermeye devam etmesin diye (bkz. kullanıcı isteği: "Bir mimar,
    // firma, ürün veya proje isimleri değiştiğinde her yerden otomatik olarak güncellensin").
    env.DB.prepare(`UPDATE product_submissions SET brand = ? WHERE brand = ?`).bind(newName, oldName).run(),
    env.DB.prepare(`UPDATE material_submissions SET brand = ? WHERE brand = ?`).bind(newName, oldName).run(),
  ]);

  let finalSlug = null;
  if (canonRow) {
    finalSlug = await freshSlugFor(env, 'offices', canonRow.id, newName);
    if (finalSlug !== canonRow.slug) {
      await env.DB.prepare(`UPDATE offices SET name = ?, slug = ?, updated_at = datetime('now') WHERE id = ?`).bind(newName, finalSlug, canonRow.id).run();
      // bkz. migrations/0041_slug_redirects.sql — eski /firma/:slug hâlâ çalışsın (301 ile yeniye).
      await recordSlugRedirect(env, 'offices', canonRow.slug, finalSlug);
      // purgeSsrDetailCache zaten-slug bir değer alırsa slugify idempotent olduğundan sorun çıkarmaz —
      // isim yerine BİLİNEN gerçek eski/yeni slug'ı vermek, isimden yeniden türetmenin (bkz.
      // ssrPurgeTargetFor) daha önce bir çakışma soneki almış slug'larda yanlış anahtarı hedeflemesini önler.
      await purgeSsrDetailCache('office', canonRow.slug);
      await purgeSsrDetailCache('office', finalSlug);
    } else {
      await env.DB.prepare(`UPDATE offices SET name = ?, updated_at = datetime('now') WHERE id = ?`).bind(newName, canonRow.id).run();
    }
    // products.brand_name_raw — canonical ürün satırlarının marka görünen adı brand_office_id'den
    // CANLI join edilmez (bkz. src/routes/product.js#shapeProductItem, doğrudan brand_name_raw
    // okunur), o yüzden FK ile bağlı bu firmanın adı değiştiğinde ayrıca burada senkronlanmalı.
    await env.DB.prepare(`UPDATE products SET brand_name_raw = ?, updated_at = datetime('now') WHERE brand_office_id = ?`).bind(newName, canonRow.id).run();
  }

  // project_submissions.office bir JSON dizisi (metin olarak saklanır, bkz. migrations/
  // 0030_project_submission_office.sql) — SQL ile tek satırda güvenle değiştirilemeyeceğinden
  // satır satır okunup yazılır. gerçek bulgu (kullanıcı raporu): bu fonksiyon önceden yanlışlıkla
  // project_submissions.designer (Mimar alanı) sütununu güncelliyordu — designer ve office
  // migrations/0030'dan beri ayrı sütunlar (bkz. submissionTypes.js) ve bir firma yeniden
  // adlandırıldığında asıl ham veri office sütunundaydı, hiç dokunulmuyordu. Bu yüzden proje
  // popup'ındaki ham-isim fallback'i (bkz. src/routes/project.js#fetchRawDesignerNames) eski
  // firma adını sonsuza dek göstermeye devam ediyor, canonical (yeni ad) join'i de AYRI bir
  // "kayıtsız" kutu olarak eklendiğinden iki isim birden görünüyordu. Eşleşen satırlar toplanıp
  // TEK bir env.DB.batch() çağrısıyla yazılıyor (facetCounts.js'teki AYNI desen, D1 subrequest
  // limitini aşmamak için).
  const { results } = await env.DB.prepare(
    `SELECT id, office FROM project_submissions WHERE office LIKE ?`
  ).bind(`%${oldName}%`).all();
  const officeUpdates = [];
  for (const row of results) {
    try {
      const list = JSON.parse(row.office || '[]');
      if (!Array.isArray(list) || !list.includes(oldName)) continue;
      const updated = list.map(o => o === oldName ? newName : o);
      officeUpdates.push(env.DB.prepare(`UPDATE project_submissions SET office = ? WHERE id = ?`).bind(JSON.stringify(updated), row.id));
    } catch { /* bozuk JSON — dokunma */ }
  }
  if (officeUpdates.length) await env.DB.batch(officeUpdates);
  // src/routes/submissions.js/admin.js, düzenlemeden sonra istemciyi (olası yeni) profil sayfasına
  // yönlendirebilmek için nihai slug'a ihtiyaç duyar (bkz. kullanıcı isteği).
  return finalSlug;
}

// renameOfficeEverywhere'in mimar karşılığı (bkz. src/routes/submissions.js#updateOwnSubmission,
// src/routes/admin.js — yalnızca admin claimed_profile_key'den FARKLI bir isim gönderebilir). Bir
// mimarın adı değiştiğinde, bu ismi anahtar olarak kullanan TÜM diğer D1 satırlarını yeni isme
// taşır. Faz 3: canonical architects.name/slug de burada güncellenir (bkz. yukarıdaki
// renameOfficeEverywhere'deki AYNI gerekçe).
export async function renameArchitectEverywhere(env, oldName, newName) {
  if (!oldName || !newName || oldName === newName) return null;
  // name=newName da denenir — bkz. renameOfficeEverywhere'deki AYNI gerekçe (bu fonksiyon
  // syncApprovedSubmissionToCanonical'dan SONRA çağrılır, syncArchitect claimed bir profilde
  // canonical adı burada ÇAĞRILMADAN ÖNCE zaten yeni ada çevirmiş olabilir).
  const canonRow = await env.DB.prepare(
    `SELECT id, slug FROM architects WHERE deleted_at IS NULL AND (name = ? OR name = ? OR legacy_key = ?) LIMIT 1`
  ).bind(oldName, newName, oldName).first();
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

  let finalSlug = null;
  if (canonRow) {
    finalSlug = await freshSlugFor(env, 'architects', canonRow.id, newName);
    if (finalSlug !== canonRow.slug) {
      await env.DB.prepare(`UPDATE architects SET name = ?, slug = ?, updated_at = datetime('now') WHERE id = ?`).bind(newName, finalSlug, canonRow.id).run();
      // bkz. migrations/0041_slug_redirects.sql — eski /mimar/:slug hâlâ çalışsın (301 ile yeniye).
      await recordSlugRedirect(env, 'architects', canonRow.slug, finalSlug);
      await purgeSsrDetailCache('architect', canonRow.slug);
      await purgeSsrDetailCache('architect', finalSlug);
    } else {
      await env.DB.prepare(`UPDATE architects SET name = ?, updated_at = datetime('now') WHERE id = ?`).bind(newName, canonRow.id).run();
    }
  }

  // gerçek bulgu (denetim raporu): aşağıdaki üç döngü önceden eşleşen HER satır için AYRI, SIRALI
  // bir UPDATE .run() çağırıyordu — tanınmış bir mimar onlarca proje/ofis/ürün başvurusunda
  // geçiyorsa, tek bir yeniden adlandırma sınırsız sayıda sıralı D1 subrequest'i tetikliyordu (free
  // tier'da 50/istek limitine yaklaşabilir). Artık üç tablodan toplanan TÜM güncellemeler TEK bir
  // env.DB.batch() çağrısıyla yazılıyor.
  const updates = [];

  const { results: projectRows } = await env.DB.prepare(
    `SELECT id, designer FROM project_submissions WHERE designer LIKE ?`
  ).bind(`%${oldName}%`).all();
  for (const row of projectRows) {
    try {
      const list = JSON.parse(row.designer || '[]');
      if (!Array.isArray(list) || !list.includes(oldName)) continue;
      const updated = list.map(d => d === oldName ? newName : d);
      updates.push(env.DB.prepare(`UPDATE project_submissions SET designer = ? WHERE id = ?`).bind(JSON.stringify(updated), row.id));
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
      updates.push(env.DB.prepare(`UPDATE office_submissions SET founders = ? WHERE id = ?`).bind(JSON.stringify(updated), row.id));
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
      updates.push(env.DB.prepare(`UPDATE ${table} SET architect = ? WHERE id = ?`).bind(updated, row.id));
    }
  }
  if (updates.length) await env.DB.batch(updates);
  return finalSlug;
}
