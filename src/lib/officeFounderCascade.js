import { newId } from './crypto.js';
import { parseSubmissionRow } from './submissionTypes.js';
import { purgeSsrDetailCache } from './ssrCache.js';
import { slugify } from './slugify.js';
import { recordSlugRedirect } from './slugRedirects.js';
import { createNotification } from './notify.js';
import { MANAGER_POSITION } from './projectClaimAccess.js';
// trLower/foldTr artık src/lib/textMatch.js'ten gelir — bu dosyadaki birebir aynı yerel kopya
// 2026-09-10'da kaldırıldı: Unicode NFC adımı (ayrışık yazılmış "doçem"in hiçbir şey bulamaması,
// bkz. o dosyanın başındaki kök neden) altı ayrı kopyaya birden eklenemezdi.
import { foldTr } from './textMatch.js';

// src/routes/office.js#trLower ile BİREBİR aynı (bu dosyada da aynı sebeple yerel olarak tekrar
// tanımlanmış — bkz. o dosyadaki yorum) — Kurucular/Ekip kutusundaki bir isim, o firmaya onaylı bir
// profile_claims hesabıyla eşleştirilirken Türkçe İ/I/ı/i büyük-küçük harf katlamasının SQL LIKE'ın
// bilmediği kurallarla doğru yapılması gerekir.

// trLower + aksan katlaması — src/lib/textMatch.js#foldTr ile BİREBİR aynı (bkz. src/routes/
// office.js#foldTr'deki aynı yerel kopya/gerekçe).

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
  await purgeSsrDetailCache('architect', architectName, env);
}

// Bir kişiyi YALNIZCA verilen firmadan koparır (kullanıcı isteği, 2026-09-11: "blurlu bir firmadan
// bazı kurucuların ismini sildim ama hâlâ firma popup'ında gözüküyorlar ... kişi popup'larında da
// dinamik ve eş zamanlı olarak bu firma bilgisi kalkmalı"). Kişi↔firma bağı ÜÇ yerde durur ve kişi
// popup'ı (src/routes/architect.js#buildArchitectPayload) üçünü de okur:
//   1) office_founders satırı (firma popup'ının Kurucular/Ortaklar'ı + kişinin Firma/Marka listesi),
//   2) architects.office_id (kişinin birincil firması),
//   3) kişinin en son taslağındaki `office` metni (architect.js#fetchRawOfficeNames — AYNI sorgu).
// clearArchitectOfficeIfMatches'ın aksine kişinin BAŞKA firmalarla olan bağlarına dokunmaz (o, kişinin
// TÜM office_founders satırlarını siliyordu) ve birincil firması başka bir firmaysa da çalışır.
// keepMembership: kişi Kurucular'dan çıkarılıp Ekip'e taşındıysa yalnızca (1) silinir — hâlâ firmada.
export async function detachArchitectFromOffice(env, architect, office, { keepMembership = false } = {}) {
  await env.DB.prepare(`DELETE FROM office_founders WHERE office_id = ? AND architect_id = ?`).bind(office.id, architect.id).run();
  if (!keepMembership) {
    await env.DB.prepare(
      `UPDATE architects SET office_id = NULL, updated_at = datetime('now') WHERE id = ? AND office_id = ?`
    ).bind(architect.id, office.id).run();
    const legacyKey = architect.legacy_key || '';
    const submissionId = legacyKey.startsWith('submission:') ? legacyKey.slice('submission:'.length) : '';
    const sub = await env.DB.prepare(
      `SELECT id, office FROM architect_submissions WHERE claimed_profile_key = ?1 OR claimed_profile_key = ?2 OR id = ?3 ORDER BY updated_at DESC LIMIT 1`
    ).bind(architect.name, legacyKey, submissionId).first();
    if (sub && sub.office) {
      const target = foldTr(office.name);
      const kept = String(sub.office).split(',').map(s => s.trim()).filter(s => s && foldTr(s) !== target);
      const next = kept.length ? kept.join(', ') : null;
      if (next !== sub.office) {
        // updated_at'e DOKUNULMAZ: fetchRawOfficeNames "en son satır"ı updated_at'e göre seçer; bu
        // satır zaten seçilen satır, sırasını değiştirmek başka bir taslağı öne geçirebilirdi.
        await env.DB.prepare(`UPDATE architect_submissions SET office = ? WHERE id = ?`).bind(next, sub.id).run();
      }
    }
  }
  await purgeSsrDetailCache('architect', architect.name, env);
}

// offices submission kaydında çağrılır (bkz. src/routes/submissions.js#createSubmission/
// updateOwnSubmission, src/routes/admin.js#handleSubmissionsAdmin) — Kurucular kutusundan ÇIKARILAN
// her kişiyi firmadan koparır.
//
// GERÇEK BULGU (kullanıcı isteği, 2026-09-11 — Aboutblank): eskiden "eski liste" taslağın serbest
// metin `founders` sütunuydu. Oysa firma popup'ındaki kurucular çoğu zaman o metinden DEĞİL,
// yapısal office_founders bağlarından geliyor (Aboutblank'ın 5 kurucusu böyleydi, taslak metninde
// hiç yazılı değildi) — kutudan silinen isim "çıkarılmış" hiç sayılmıyor, bağ kalıyor, kişi hem
// firma hem kendi popup'ında görünmeye devam ediyordu. Artık adaylar firmanın KANONİK kurucu
// bağlarıdır (+ birincil firması bu firma olanlar) — ama YALNIZCA `oldFounders`'ta (formun
// kutuda KULLANICIYA GÖSTERDİĞİ liste; istemci bunu `foundersShown` olarak gönderir, bkz.
// firma-ekle.html/marka-ekle.html) adı geçenler. Güvenlik gerekçesi: firma-ekle'nin ?edit= yolu
// kutuyu taslak metninden doldurur; kutuda HİÇ görünmemiş bir kurucuyu "silinmiş" saymak, kimsenin
// silmediği bir bağı koparırdı. Kullanıcının görüp silmediği hiçbir bağa dokunulmaz.
// newTeam: kaydedilen Ekip listesi (bilinmiyorsa null) — Ekip'e taşınan kişi firmada kalır.
export async function cascadeRemovedFounders(env, user, officeName, oldFounders, newFounders, { newTeam = null } = {}) {
  const fold = (n) => foldTr(String(n || '').trim());
  const newSet = new Set((newFounders || []).filter(Boolean).map(fold));
  const teamSet = Array.isArray(newTeam) ? new Set(newTeam.filter(Boolean).map(fold)) : null;
  const office = await env.DB.prepare(`SELECT id, name FROM offices WHERE deleted_at IS NULL AND name = ? LIMIT 1`).bind(officeName).first();
  if (!office) {
    // Canonical karşılığı olmayan (henüz senkronlanmamış) firma — eski davranış.
    const oldSet = new Set((oldFounders || []).filter(Boolean));
    for (const name of [...oldSet].filter(name => !newSet.has(fold(name)))) {
      await clearArchitectOfficeIfMatches(env, user, name, officeName);
    }
    return;
  }
  const oldFolded = new Set((oldFounders || []).filter(Boolean).map(fold));
  if (!oldFolded.size) return;
  const { results: linkedAll } = await env.DB.prepare(
    `SELECT a.id, a.name, a.legacy_key, a.office_id FROM office_founders f JOIN architects a ON a.id = f.architect_id
      WHERE f.office_id = ? AND a.deleted_at IS NULL`
  ).bind(office.id).all();
  const linked = (linkedAll || []).filter(r => oldFolded.has(fold(r.name)));
  const linkedIds = new Set((linkedAll || []).map(r => r.id));
  const { results: primaryAll } = await env.DB.prepare(
    `SELECT id, name, legacy_key, office_id FROM architects WHERE deleted_at IS NULL AND office_id = ?`
  ).bind(office.id).all();
  const primaryOnly = (primaryAll || []).filter(r => !linkedIds.has(r.id) && oldFolded.has(fold(r.name)));
  for (const a of [...linked, ...primaryOnly]) {
    const key = fold(a.name);
    if (newSet.has(key)) continue;
    await detachArchitectFromOffice(env, a, office, { keepMembership: !!(teamSet && teamSet.has(key)) });
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
  // foldTr: office.js#buildOfficePayload'ın Kurucular/Ekip tekilleştirmesiyle AYNI katlama (bkz.
  // oradaki "Arman Akdoğan" / "Arman Akdogan" bulgusu) — kutudaki isim aksanlı, hesabın adı aksansız
  // yazılmışsa trLower'a göre eşleşmiyor ve kimseyi silmemiş olan bir kaydetme, o kişinin claim'ini
  // sessizce iptal ediyordu.
  const newSet = new Set((newNames || []).filter(Boolean).map(n => foldTr(n.trim())));

  // Görev kaynağı: office.js#buildOfficePayload'daki AYNI COALESCE — hangi bölüme (Kurucular/Ekip)
  // düştüğü admin'in dondurduğu c.office_position'dan belirlenmeli, aksi halde popup bir kişiyi
  // Kurucular'da gösterirken bu cascade onu Ekip sayıp yanlış listeden "çıkarılmış" kabul ederdi.
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.user_id, u.name, COALESCE(NULLIF(c.office_position, ''), u.position) AS position
       FROM profile_claims c JOIN users u ON u.id = c.user_id
     WHERE c.profile_type = 'office' AND c.profile_key = ? AND c.status = 'approved'`
  ).bind(officeName).all();
  // MANAGER_POSITION ('Yönetici', firmanın kendi kurumsal hesabı) Kurucular'da da Ekip'te de HİÇ
  // listelenmediğinden (bkz. office.js#buildOfficePayload) kutuda adı da bulunmaz — kapsam dışı
  // bırakılmazsa her kaydetme onu "listeden çıkarılmış" sayıp yetkisini iptal ederdi.
  const relevant = (results || []).filter(r => r.position !== MANAGER_POSITION && founders === FOUNDER_POSITIONS.has(r.position));
  const toRevoke = relevant.filter(r => !newSet.has(foldTr((r.name || '').trim())));
  if (!toRevoke.length) return;

  const now = Date.now();
  await env.DB.batch(toRevoke.map(r =>
    env.DB.prepare(`UPDATE profile_claims SET status = 'rejected', updated_at = ? WHERE id = ?`).bind(now, r.id)
  ));
  // Firma detay ucu/SSR HTML'i claim satırlarından türeyen Kurucular/Ekip listelerini (ve 2026-09-08'den
  // beri `claimed` bayrağını) taşıdığından, iptal edilen claim'ler hemen yansımalı — invalidatePublicCache
  // tekil detay uçlarına DOKUNMAZ (bkz. proje notu: "Detay ucu cache'i: purgeSsrDetailCache şart").
  await purgeSsrDetailCache('office', officeName, env);
  for (const r of toRevoke) {
    await createNotification(
      env, r.user_id, 'claim_rejected',
      'Firma profili talebin reddedildi',
      `"${officeName}" firmasının ${founders ? 'Kurucular' : 'Ekip'} listesinden çıkarıldığın için profil bağlantın kaldırıldı.`,
      'hesabim.html'
    );
  }
}

// ---------------------------------------------------------------------------------------------
// TERS YÖN: KİŞİ PROFİLİNDEN BİR FİRMA/MARKA ÇIKARILINCA, FİRMANIN KÜNYESİNDEN DE ÇIKAR
// (kullanıcı isteği, 2026-09-10: "Bir kullanıcı kendi kişi profilinden bir firmayı ya da markayı
// silerse, o firmanın ya da markanın profilinden de bu kişi ismi otomatik olarak silinsin.")
//
// cascadeRemovedFounders'ın AYNADAKİ görüntüsü: o, firmanın Kurucular kutusundan çıkarılan ismin
// kişi tarafındaki bağını temizler; bu ise kişinin "Firma veya Marka" alanından çıkarılan firmanın
// künyesinden kişiyi siler.
//
// FİRMA POPUP'INDAKİ İSİM DÖRT KAYNAKTAN GELEBİLİR (bkz. src/routes/office.js#buildOfficePayload),
// bu yüzden ÜÇÜNE birden dokunulur — dördüncüsü zaten başka yerde hallediliyor:
//   1) office_founders (yapısal bağ) — canonicalSync.js#syncOfficeFounderLink kişi kaydedilirken
//      YENİ listede olmayan bağları zaten siliyor, burada TEKRAR edilmez.
//   2) office_submissions.founders / .team serbest metin kutuları — BURADA temizlenir.
//   3) onaylı profile_claims('office') satırı — BURADA reddedilir (cascadeRemovedProfileClaims'in
//      tek-kişilik karşılığı; kullanıcı firmayla bağını kendisi kopardığı için bildirim GÖNDERİLMEZ:
//      reddedilen bir talep değil, kullanıcının kendi kararıdır).
//   4) architects.office_id — syncArchitect zaten yeni listeye göre yazıyor.
//
// KAPSAM SINIRI — YALNIZCA KİŞİNİN KENDİSİ: bu cascade yalnızca düzenlenen kişi kaydı GERÇEKTEN
// düzenleyen kullanıcının kendi profiliyse çalışır (isOwn), çünkü kullanıcı isteği "bir kullanıcı
// KENDİ kişi profilinden" diyor. Aksi halde kisi-ekle.html'in asıl kullanımı (bir meslektaşını
// eklemek/düzeltmek) sırasında birinin Firma alanını boşaltmak, o firmanın künyesini üçüncü bir
// kişinin elinden değiştirirdi.
export async function cascadeRemovedOfficesFromArchitect(env, architectName, oldOfficeField, newOfficeField, { claimUserId = null } = {}) {
  const split = (value) => [...new Set(String(value || '').split(',').map(s => s.trim()).filter(Boolean))];
  const newFolded = new Set(split(newOfficeField).map(foldTr));
  const removed = split(oldOfficeField).filter(name => !newFolded.has(foldTr(name)));
  if (!removed.length) return;

  const wanted = foldTr(architectName);
  for (const officeName of removed) {
    const office = await env.DB.prepare(
      `SELECT id, name, legacy_key FROM offices WHERE deleted_at IS NULL AND (name = ? COLLATE NOCASE OR legacy_key = ?) LIMIT 1`
    ).bind(officeName, officeName).first();
    if (!office) continue;

    // (2) serbest metin Kurucular/Ekip kutuları. Firmanın taslağı, office.js#fetchRawFounderNames
    // ile BİREBİR aynı sorgudan bulunur — orası popup'ta hangi satırın okunduğunu belirleyen tek
    // kaynak, farklı bir satırı düzenlersek popup'ta isim durmaya devam ederdi.
    const submissionId = (office.legacy_key || '').startsWith('submission:') ? office.legacy_key.slice('submission:'.length) : '';
    const draft = await env.DB.prepare(
      `SELECT id, founders, team FROM office_submissions
        WHERE claimed_profile_key = ?1 OR claimed_profile_key = ?2 OR id = ?3 ORDER BY updated_at DESC LIMIT 1`
    ).bind(office.name, office.legacy_key || '', submissionId).first();
    if (draft) {
      const filterOut = (raw) => {
        let list;
        try { list = JSON.parse(raw || '[]'); } catch { return null; }
        if (!Array.isArray(list)) return null;
        const kept = list.filter(n => typeof n !== 'string' || foldTr(n) !== wanted);
        return kept.length === list.length ? null : JSON.stringify(kept);
      };
      const nextFounders = filterOut(draft.founders);
      const nextTeam = filterOut(draft.team);
      if (nextFounders !== null || nextTeam !== null) {
        const sets = [], binds = [];
        if (nextFounders !== null) { sets.push('founders = ?'); binds.push(nextFounders); }
        if (nextTeam !== null) { sets.push('team = ?'); binds.push(nextTeam); }
        sets.push('updated_at = ?'); binds.push(Date.now());
        await env.DB.prepare(`UPDATE office_submissions SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, draft.id).run();
      }
    }

    // (3) kullanıcının o firmaya onaylı/bekleyen talebi. profile_key firmanın GÜNCEL adını taşır
    // (bkz. renameOfficeEverywhere), bu yüzden office.name ile eşleştirilir. Bekleyen talep de
    // düşürülür: kullanıcı firmayı alanından sildiyse o talebin onaylanmasını beklemiyordur —
    // aksi halde admin, kullanıcının vazgeçtiği bir bağı onaylardı.
    if (claimUserId) {
      await env.DB.prepare(
        `UPDATE profile_claims SET status = 'rejected', updated_at = ?
          WHERE user_id = ? AND profile_type = 'office' AND profile_key = ? AND status IN ('approved', 'pending')`
      ).bind(Date.now(), claimUserId, office.name).run();
    }

    // Firma detay ucu/SSR HTML'i bu listeleri taşır — bkz. cascadeRemovedProfileClaims'teki AYNI not.
    await purgeSsrDetailCache('office', office.name, env);
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
    env.DB.prepare(`UPDATE shared_items SET item_key = ? WHERE item_type = 'office' AND item_key = ?`).bind(newName, oldName).run(),
    // follows.followed_ref_id id-tabanlı olduğundan rename'den etkilenmez, yalnızca UI/buton
    // state'inin dayandığı followed_key (slugify(name) — save-widget.js#wireSaveButtons'taki
    // dataset.key ile AYNI konvansiyon, ham isim DEĞİL) ve görünen ad güncellenir.
    env.DB.prepare(`UPDATE OR IGNORE follows SET followed_key = ?, followed_title = ? WHERE followed_type = 'office' AND followed_key = ?`).bind(slugify(newName), newName, slugify(oldName)).run(),
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
      await purgeSsrDetailCache('office', canonRow.slug, env);
      await purgeSsrDetailCache('office', finalSlug, env);
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
    env.DB.prepare(`UPDATE shared_items SET item_key = ? WHERE item_type = 'architect' AND item_key = ?`).bind(newName, oldName).run(),
    // bkz. renameOfficeEverywhere'deki AYNI follows satırı/gerekçe.
    env.DB.prepare(`UPDATE OR IGNORE follows SET followed_key = ?, followed_title = ? WHERE followed_type = 'architect' AND followed_key = ?`).bind(slugify(newName), newName, slugify(oldName)).run(),
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
      // bkz. migrations/0041_slug_redirects.sql — eski /kisi/:slug hâlâ çalışsın (301 ile yeniye).
      await recordSlugRedirect(env, 'architects', canonRow.slug, finalSlug);
      await purgeSsrDetailCache('architect', canonRow.slug, env);
      await purgeSsrDetailCache('architect', finalSlug, env);
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
