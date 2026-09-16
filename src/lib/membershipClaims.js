// ============================================================================================
// KİŞİ ↔ FİRMA ÜYELİK TALEPLERİ — PLANLAMA + OLUŞTURMA (kullanıcı isteği, 2026-09-16 yedinci tur)
//
// madde 5 (firma-ekle/düzenle): "eğer ekleyeceği kişi zaten başka bir firmada gözüküyorsa, o
//   firmanın yöneticisine ve admine bildirim gitsin ve yönetici ya da admin o bildirimi onaylarsa
//   kişi firmaya da dahil olsun ... Firma profili yayınlansın ama onay gelene kadar kişi kısmı boş
//   kalsın."
// madde 6 (kisi-ekle/düzenle): "eğer ekleyeceği firmanın zaten bir yöneticisi varsa, o firmanın
//   yöneticisine ve admine bildirim gitsin ... Kişi profili yayınlansın ama onay gelene kadar firma
//   kısmı boş kalsın."
//
// KAPI NEREDE: GÖNDERİ YAZIMINDA (src/routes/submissions.js#createSubmission/updateOwnSubmission),
// canonicalSync'te DEĞİL. Gerekçe, "boş kalsın" şartının ta kendisi: firma pop-up'ının Kurucular/
// Ekip listeleri İKİ kaynaktan beslenir — yapısal bağ (office_founders) VE gönderi satırındaki
// SERBEST METİN adlar (bkz. src/routes/office.js#fetchRawFounderNames/fetchRawTeamNames). Yalnızca
// bağı engellemek yetmezdi: ad, gönderi metninden okunup pop-up'ta yine görünürdü. Adı gönderiye
// hiç YAZMAYARAK iki yol birden kapanır ve onayda ad TEK yerden geri yazılır.
//
// ADMIN MUAFTIR: admin bu kuyruğun onaylayıcısıdır (hotspotTags/photoClaims'teki AYNI kural).
// SAHİP MUAFTIR: madde 6'da firmanın yöneticisi kendi firmasına kişi/kendini ekliyorsa onaylayacak
// kişi zaten kendisidir; madde 5'te diğer firmayı da yönetiyorsa aynı gerekçe geçerli.
// ============================================================================================
import { newId } from './crypto.js';
import { createNotification } from './notify.js';
import { foldTr } from './textMatch.js';
import { fetchOfficeManagers } from './claimedProfiles.js';
import { OFFICE_EDIT_POSITIONS } from './projectClaimAccess.js';

export const MEMBERSHIP_PENDING = 'pending';

async function adminUserIds(env) {
  const { results } = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  return (results || []).map(r => r.id);
}

// Bir firmanın yöneticisi olan hesap id'leri. Tanım TEK kaynaktan okunur
// (claimedProfiles.js#fetchOfficeManagers + projectClaimAccess.js#OFFICE_EDIT_POSITIONS), yani
// "Hesabım > Yetkili Kullanıcılar" listesindeki kümeyle birebir aynıdır.
export async function officeManagerIds(env, officeName) {
  const managers = await fetchOfficeManagers(env, officeName, OFFICE_EDIT_POSITIONS);
  return new Set((managers || []).map(m => m && m.userId).filter(Boolean));
}

// Karar kümesi = bildirim kümesi (bkz. photoClaims.js tasarım notu 2): ayrışırlarsa bildirimi alan
// kişi düğmeye bastığında 403 alırdı.
async function decisionUserIds(env, deciderOfficeName) {
  return new Set([...(await officeManagerIds(env, deciderOfficeName)), ...(await adminUserIds(env))]);
}

export async function canDecideMembership(env, user, claim) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return (await decisionUserIds(env, claim.decider_office_name)).has(user.id);
}

// Kişinin BU FİRMA DIŞINDA göründüğü firmalar (madde 5'in koşulu). İki kaynak da okunur, çünkü
// pop-up ikisini de gösterir: yapısal bağ (office_founders) ve kişinin "birincil firma" alanı
// (architects.office_id). Arşivdeki/gizli firmalar da sayılır — bir firmanın yöneticisi, firma o an
// yayında olmasa bile kendi ekibinden birinin başka bir firmaya eklenmesine karar verebilmeli.
async function otherOfficeNamesOfArchitect(env, architectId, exceptOfficeId) {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT o.name AS name FROM offices o
      WHERE o.deleted_at IS NULL AND o.id != ?2
        AND (EXISTS (SELECT 1 FROM office_founders f WHERE f.office_id = o.id AND f.architect_id = ?1)
             OR EXISTS (SELECT 1 FROM architects a WHERE a.id = ?1 AND a.office_id = o.id))`
  ).bind(architectId, exceptOfficeId).all();
  return (results || []).map(r => r.name).filter(Boolean);
}

// BAĞ ZATEN VAR MI? (kritik kapı istisnası)
// Kullanıcı isteği "eklemek istediği zaman" diyor — YENİ bir bağ kurmaktan söz ediyor. Var olan
// bir üyeliği de geri çekmek GERÇEK BİR GERİLEME olurdu: bir firmanın mevcut üyesi kendi kişi
// künyesini (ör. yalnızca açıklamasını) düzenlediğinde firma adı künyeden SESSİZCE düşer ve
// yeniden onay beklerdi. 2026-09-08'deki firma-tarafı kapısı da aynı gerekçeyle var olan
// bağlantıları korumuştu (bkz. canonicalSync.js#syncOfficeFounderLink'in pendingIds notu).
// İki kaynak da sayılır, çünkü pop-up ikisini de gösterir: yapısal bağ + birincil firma.
async function membershipExists(env, officeId, architectId) {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM office_founders WHERE office_id = ?1 AND architect_id = ?2)
        OR EXISTS (SELECT 1 FROM architects WHERE id = ?2 AND office_id = ?1)`
  ).bind(officeId, architectId).first();
  return !!row;
}

async function findCanonicalByName(env, table, name) {
  const key = (name || '').trim();
  if (!key) return null;
  const row = await env.DB.prepare(
    `SELECT id, name FROM ${table} WHERE deleted_at IS NULL AND name = ? LIMIT 1`
  ).bind(key).first();
  if (row) return row;
  // Yazım farkı (büyük/küçük harf, Türkçe karakter) — sitenin her yerindeki "aynı ad" tanımı.
  const { results } = await env.DB.prepare(
    `SELECT id, name FROM ${table} WHERE deleted_at IS NULL AND name_fold = ? LIMIT 1`
  ).bind(foldTr(key)).all();
  return (results && results[0]) || null;
}

// ---------------------------------------------------------------------------------------------
// madde 5 — FİRMA künyesine yazılan kişi adları. Dönen `withheld` adları gönderiye YAZILMAZ.
// ---------------------------------------------------------------------------------------------
export async function planOfficePeopleWithhold(env, user, officeName, slots) {
  const empty = { withheld: [] };
  if (!user || user.role === 'admin') return empty;
  const office = await findCanonicalByName(env, 'offices', officeName);
  // Firma sitede HENÜZ YOK (ilk gönderi): kişi o firmada "zaten görünüyor" olamaz, çünkü bağ
  // kurulacak firma daha oluşmadı. Bu turda kapı yalnızca VAR OLAN bir firmaya ekleme yapılırken
  // çalışır; yeni firmanın ilk künyesi admin moderasyonundan geçer (status='pending').
  if (!office) return empty;
  const withheld = [];
  for (const [slot, names] of Object.entries(slots || {})) {
    for (const name of (names || [])) {
      const architect = await findCanonicalByName(env, 'architects', name);
      if (!architect) continue; // sitede kaydı olmayan serbest metin ad — bağ da kurulamaz, kapı dışı
      if (await membershipExists(env, office.id, architect.id)) continue; // zaten bu firmanın üyesi
      const others = await otherOfficeNamesOfArchitect(env, architect.id, office.id);
      if (!others.length) continue; // "zaten başka bir firmada gözüküyorsa" — görünmüyorsa kapı yok
      // Kullanıcı o DİĞER firmayı da yönetiyorsa onaylayacak kişi zaten kendisidir; talep
      // açmak anlamsız olurdu. Karar, kullanıcının YÖNETMEDİĞİ ilk firmaya bırakılır.
      let blockingOffice = null;
      for (const other of others) {
        if (!(await officeManagerIds(env, other)).has(user.id)) { blockingOffice = other; break; }
      }
      if (!blockingOffice) continue;
      withheld.push({
        slot, name, architectId: architect.id, architectName: architect.name,
        officeId: office.id, officeName: office.name, deciderOfficeName: blockingOffice,
      });
    }
  }
  return { withheld };
}

// ---------------------------------------------------------------------------------------------
// madde 6 — KİŞİ künyesine yazılan firma adları. Dönen `withheld` adları gönderiye YAZILMAZ.
// ---------------------------------------------------------------------------------------------
export async function planArchitectOfficesWithhold(env, user, architectName, officeNames) {
  const empty = { withheld: [] };
  if (!user || user.role === 'admin') return empty;
  const withheld = [];
  for (const name of (officeNames || [])) {
    const office = await findCanonicalByName(env, 'offices', name);
    if (!office) continue; // sitede kaydı olmayan firma adı — künyede metin olarak kalır, bağ üretmez
    const architect = await findCanonicalByName(env, 'architects', architectName);
    if (architect && await membershipExists(env, office.id, architect.id)) continue; // zaten üye
    const managers = await officeManagerIds(env, office.name);
    // "eğer ekleyeceği firmanın zaten bir yöneticisi varsa" — yöneticisi YOKSA davranış DEĞİŞMEZ
    // (bağ yine canonicalSync#splitAdminApprovedOffices kapısına tabidir, yani admin onayı ister).
    if (!managers.size) continue;
    if (managers.has(user.id)) continue; // kendi firmasına kendini/kişisini ekliyor
    withheld.push({
      name, officeId: office.id, officeName: office.name,
      deciderOfficeName: office.name, architectName: (architect && architect.name) || (architectName || '').trim(),
      architectId: architect ? architect.id : null,
    });
  }
  return { withheld };
}

// ---------------------------------------------------------------------------------------------
// Talep satırlarını açar + karar kümesine bildirim gönderir. Gönderi INSERT'inden SONRA çağrılır
// (submission_id gerekiyor). Hiçbir şey döndürmez — best-effort yan etki, gönderi yazımını
// asla düşürmez (createNotification'daki AYNI gerekçe).
// ---------------------------------------------------------------------------------------------
export async function createMembershipClaims(env, user, { source, submissionType, submissionId, items }) {
  for (const it of (items || [])) {
    const architectId = it.architectId || (await findCanonicalByName(env, 'architects', it.architectName) || {}).id;
    if (!architectId || !it.officeId) continue;
    const id = newId();
    try {
      await env.DB.prepare(
        `INSERT INTO profile_membership_claims
           (id, office_id, office_name, architect_id, architect_name, source, submission_type, submission_id, slot,
            decider_office_name, requested_by_user_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '${MEMBERSHIP_PENDING}', ?)`
      ).bind(id, it.officeId, it.officeName, architectId, it.architectName || it.name, source,
        submissionType, submissionId || null, it.slot || null, it.deciderOfficeName, user.id, Date.now()).run();
    } catch (err) {
      // Kısmi UNIQUE indeks: bu kullanıcının bu bağ için bekleyen talebi zaten var (ör. formu
      // yeniden kaydetti). Yeni bildirim gönderilmez.
      // DİĞER HER HATA DA YUTULUR (createNotification'daki AYNI gerekçe): bu, gönderi yazımı
      // BAŞARIYLA tamamlandıktan sonra çalışan bir yan etkidir ve onu 500'e düşürmemeli. Somut
      // senaryo: migration (0123) kod deploy'undan sonra uygulanırsa tablo henüz yoktur — o
      // pencerede kapı yine GÜVENLİ yönde davranır (ad künyeye YAZILMAZ), yalnızca talep satırı
      // açılmaz ve kullanıcı formu yeniden kaydederek talebi oluşturabilir.
      if (!String(err && err.message || '').includes('UNIQUE')) console.error('createMembershipClaims failed', err);
      continue;
    }
    const recipients = await decisionUserIds(env, it.deciderOfficeName);
    const who = user.name || 'Bir üye';
    const body = source === 'office'
      ? `${who}, “${it.architectName || it.name}” kişisini “${it.officeName}” firmasının künyesine eklemek istiyor. Bu kişi “${it.deciderOfficeName}” firmasında görünüyor. Onaylarsan kişi “${it.officeName}” künyesine de eklenir.`
      : `${who}, “${it.architectName}” kişi künyesine “${it.officeName}” firmasını eklemek istiyor. Onaylarsan bu kişi firmanın künyesinde de görünür.`;
    for (const uid of recipients) {
      await createNotification(env, uid, 'membership_claim', 'Firma üyeliği onay bekliyor', body, `membership-claim:${id}`);
    }
  }
}
