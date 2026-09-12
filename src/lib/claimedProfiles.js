import { foldTr } from './textMatch.js';
import professionShared from '../../profession-shared.js';

// "Bu kayıt bir üyeye atanmış mı?" — kişi/firma/marka/proje/ürün pop-up'larındaki kaynak
// ibaresinin TEK kaynağı: atanmamışsa "Kamuya açık kaynaklardan derlenmiştir, doğrulanmamıştır."
// + "Yanlışlık olduğunu düşünüyorsan info@mimarlab.com adresinden bize ulaş!"; atanmışsa ibare
// TAMAMEN kaldırılır (kullanıcı isteği, 2026-09-10 madde 8 — önceden yalnızca ikinci cümle
// kalıyordu, bkz. js/components/modal-shell.js#setSourceDisclaimer).
//
// NEDEN (kullanıcı isteği, 2026-09-08 madde 5): o uyarı, sitedeki kayıtların çoğunun kamuya açık
// kaynaklardan derlenmiş, kimsenin doğrulamadığı içerik olmasından geliyor. Bir profil bir üyeye
// atandığı (onaylı profile_claims) andan itibaren bu doğru DEĞİLDİR — künyeyi artık profilin
// sahibi yönetiyor. Uyarı yalnızca o profilin kendi pop-up'ından değil, o profile ait proje ve
// ürün pop-up'larından da kalkar.
//
// Eşleştirme profile_claims.profile_key (= profilin ADI) üzerinden yapılır — bu tablo bu depoda
// her yerde çıplak isimle anahtarlanıyor (bkz. proje notu: "Duplicate name key limitation"),
// profile_type ayrımı burada KASITLI olarak yapılmaz: aynı adı taşıyan bir kişi ve bir firma
// zaten aynı gerçek varlıktır (kurumsal hesaplar), ikisinden birinin sahiplenilmiş olması bu
// uyarıyı kaldırmak için yeterlidir.
//
// TEK SORGU: çağıranlar (project/product) künyedeki TÜM isimleri tek bir IN(...) listesiyle sorar.
// Düz IN(...) kullanılır, `A OR B` zinciri DEĞİL — bkz. proje notu: SQLite ifade-ağacı derinlik
// sınırı 100 (100+ terimli OR zincirleri D1 tarafından her zaman reddedilir).
export async function anyProfileClaimed(env, names) {
  const unique = [...new Set((names || []).map(n => (n || '').trim()).filter(Boolean))];
  if (!unique.length) return false;
  // Künye çok uzun olsa bile tek ifadede kalsın diye üst sınır — 100'den fazla künye adı taşıyan
  // bir kayıt bu depoda yok, sınır yalnızca bozuk/uç veriye karşı bir emniyet supabıdır.
  const keys = unique.slice(0, 100);
  const row = await env.DB.prepare(
    `SELECT 1 FROM profile_claims
      WHERE status = 'approved' AND profile_key IN (${keys.map(() => '?').join(', ')}) LIMIT 1`
  ).bind(...keys).first();
  return !!row;
}

// KİŞİ PROFİLİ İÇİN GENİŞLETİLMİŞ KURAL (kullanıcı isteği, 2026-09-10 onuncu tur madde 1: "Bir
// firmaya ve kişiye kullanıcı atayınca o firmanın KURUCULARININ popup'larında da 'Bu profil sana
// mı ait?' butonu ve 'Kamuya açık kaynaklardan derlenmiştir...' yazısı silinsin — hâlâ bazı
// profillerde duruyor"; canlı örnek: VEN Mimarlık'a yönetici atanmış, firma popup'ında kutu yok,
// ama kurucusu Gül Güven'in popup'ında ikisi de duruyordu).
//
// Kişi şu iki durumdan birinde "sahiplenilmiş" sayılır:
//   (a) kendi adına onaylı bir profile_claims satırı var (anyProfileClaimed — eski kural), ya da
//   (b) KURUCUSU/ORTAĞI olduğu bir firma/markanın onaylı bir sahibi/yetkilisi var. Kurucu bağı,
//       firma popup'ının "Kurucular / Ortaklar" listesini besleyen AYNI iki kaynaktan okunur:
//       office_founders join tablosu ve architects.office_id (bkz. src/routes/architect.js#
//       buildArchitectPayload — kişi popup'ındaki "Kurucu · VEN Mimarlık" satırı da bunlardan gelir).
//
// NEDEN: o uyarı "kimsenin doğrulamadığı içerik" demektir. Firmanın künyesini artık onaylı bir
// yetkili yönetiyorsa ve o yetkili kişiyi Kurucular kutusunda tutuyorsa, kurucunun profili de
// doğrulanmış bir kaynaktan geliyor demektir; "sana mı ait?" daveti de anlamsızdır — profil
// zaten firmanın yetkilisi tarafından (bkz. canEditArchitectViaOfficeMembership) yönetilebilir.
//
// İki tüketicisi var ve İKİSİ DE bu fonksiyondan geçmeli (aksi halde ibare ile kutu birbirinden
// ayrışır): /api/architect/:key'in `claimed` bayrağı (kaynak ibaresi) ve /api/public/claim-status
// (davet kutusu, bkz. js/components/claim-correction-box.js#loadClaimCard).
//
// TEK SORGU, ÜST SINIR YOK: bir kişinin kurucusu olduğu firma sayısı küçüktür (join, IN listesi
// değil). profile_type BİLEREK 'office' ile sınırlı — (a) dalı zaten tipsiz soruluyor.
export async function isArchitectProfileClaimed(env, keys) {
  if (await anyProfileClaimed(env, keys)) return true;
  const unique = [...new Set((keys || []).map(n => (n || '').trim()).filter(Boolean))].slice(0, 4);
  if (!unique.length) return false;
  const ph = unique.map(() => '?').join(', ');
  const row = await env.DB.prepare(
    `SELECT 1 FROM architects a
       JOIN offices o ON o.deleted_at IS NULL
        AND (o.id = a.office_id OR o.id IN (SELECT f.office_id FROM office_founders f WHERE f.architect_id = a.id))
       JOIN profile_claims c ON c.status = 'approved' AND c.profile_type = 'office'
        AND (c.profile_key = o.name OR (o.legacy_key IS NOT NULL AND c.profile_key = o.legacy_key))
      WHERE a.deleted_at IS NULL AND (a.name IN (${ph}) OR a.legacy_key IN (${ph}))
      LIMIT 1`
  ).bind(...unique, ...unique).first();
  if (row) return true;
  return isSelfPublishedArchitect(env, unique);
}

// (c) ÜYENİN KENDİ YAYINLADIĞI KİŞİ PROFİLİ (kullanıcı isteği, 2026-09-10: "MİMARLAB Robotu
// profilindeki 'Bu profil sana mı ait?' butonunu ve 'Kamuya açık kaynaklardan derlenmiştir…'
// yazısını kaldır").
//
// GERÇEK BULGU: sahipliğin İKİ yolu var (bkz. proje notu "Profil sahipliğinin İKİ yolu") ama bu
// dosya bugüne kadar YALNIZCA profile_claims yolunu tanıyordu. Bir üye kendi kişi profilini
// kisi-ekle.html'den ya da Hesabım > Profili Düzenle'den kendisi yayınladığında ortada SAHİPLENME
// TALEBİ YOKTUR — kayıt zaten onundur (architect_submissions.owner_user_id) ve canonical satır
// legacy_key = 'submission:<gönderi id>' markörünü taşır. Böyle bir profil "kamuya açık
// kaynaklardan derlenmiş, doğrulanmamış" bir kayıt DEĞİLDİR; ne kaynak ibaresi ne de "sana mı
// ait?" daveti anlamlıdır. (MİMARLAB Robotu bu duruma canlı örnek: architects#993,
// legacy_key = 'submission:d0a63a6d-…', sahibi kendi hesabı.)
//
// AD EŞLEŞMESİ ŞART: kisi-ekle.html'in ASIL kullanımı BAŞKA birini eklemektir — bir meslektaşı
// adına açılan kayıt üçüncü şahıs derlemesidir ve ibare orada KALMALIDIR. Bu yüzden gönderiyi
// açan hesabın adı profilin adıyla eşleşmelidir; src/routes/submissions.js#isOwnArchitectRecord
// ve #isSelfDirectoryListing'in kullandığı AYNI "bu kayıt kullanıcının kendisi mi?" kuralı.
// SQL tarafında users'ta name_fold kolonu yok (architects'te var, bkz. migrations/0079), bu yüzden
// karşılaştırma COLLATE NOCASE ile yapılır — ad zaten hesaptan kopyalandığından bu yeterlidir.
async function isSelfPublishedArchitect(env, unique) {
  const ph = unique.map(() => '?').join(', ');
  const row = await env.DB.prepare(
    `SELECT 1 FROM architects a
       JOIN architect_submissions s ON ('submission:' || s.id) = a.legacy_key AND s.status = 'approved'
       JOIN users u ON u.id = s.owner_user_id
      WHERE a.deleted_at IS NULL AND (a.name IN (${ph}) OR a.legacy_key IN (${ph}))
        AND u.name IS NOT NULL AND a.name = u.name COLLATE NOCASE
      LIMIT 1`
  ).bind(...unique, ...unique).first();
  return !!row;
}


// Bir kişi kaydının "Firma veya Marka" alanına yazılan her ad için, sahibi adına BEKLEYEN bir
// profile_claims('office') talebi açar (kullanıcı isteği, 2026-09-08 madde 1).
//
// NEDEN SUNUCUDA: Hesabım > Profili Düzenle formu bu talebi ZATEN istemciden gönderiyordu (bkz.
// js/components/auth-modal.js#submitFirmaClaimIfChanged), ama kisi-ekle.html'in "Firma" kutusu
// GÖNDERMİYORDU — oradan kaydeden kullanıcı için ortada hiçbir onay kaydı olmuyor, kişi yalnızca
// firma profilinde (o zamanlar koşulsuz kurulan office_founders bağı üzerinden) beliriyordu. Talep
// artık HER İKİ formdan da doğar, çünkü kaydı yazan tek uç burası.
//
// Sessiz ve idempotent: canonical bir offices satırına karşılık gelmeyen adlar atlanır (POST
// /api/claims'in AYNI "Böyle bir profil bulunamadı" kuralı), zaten bir satırı olan (pending/
// approved/rejected) ad'a dokunulmaz — reddedilmiş bir talebi her kaydetmede yeniden açmak,
// admin'in verdiği kararı sessizce geri almak olurdu.
export async function ensurePendingOfficeClaims(env, user, officeNames, newId) {
  if (!user || user.role === 'admin') return;
  const names = [...new Set((officeNames || []).map(n => (n || '').trim()).filter(Boolean))].slice(0, 20);
  if (!names.length) return;
  const now = Date.now();
  for (const name of names) {
    // Satıra YAZILACAK anahtar, kullanıcının yazdığı metin değil canonical `name`'dir (kullanıcı
    // isteği, 2026-09-10): eşleşme COLLATE NOCASE ve legacy_key üzerinden de kurulduğundan, ham
    // metni yazmak "udesign mimarlik"/legacy anahtar gibi biçimlerde profili adıyla sorgulayan
    // hiçbir yerin göremediği bir sahiplik satırı bırakırdı. Bkz. canonicalRead.js#resolveCanonicalName.
    const canonical = await env.DB.prepare(
      `SELECT name FROM offices WHERE deleted_at IS NULL AND (name = ? COLLATE NOCASE OR legacy_key = ?) LIMIT 1`
    ).bind(name, name).first();
    if (!canonical) continue;
    const profileKey = canonical.name;
    const existing = await env.DB.prepare(
      `SELECT id FROM profile_claims WHERE user_id = ? AND profile_type = 'office' AND profile_key = ?`
    ).bind(user.id, profileKey).first();
    if (existing) continue;
    await env.DB.prepare(
      `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, note, created_at, updated_at)
       VALUES (?, ?, 'office', ?, 'pending', ?, ?, ?)`
    ).bind(newId(), user.id, profileKey, 'Kişi profilindeki "Firma veya Marka" alanından oluşturuldu.', now, now).run();
  }
}


const { professionSlugOf } = professionShared;

// users.position doğrulaması — src/routes/auth.js#POSITIONS ile AYNI küme (kisi-ekle.html#
// POZISYON_OPTIONS'tan türer). Kişi kaydında elle yazılmış/listede olmayan bir pozisyon hesaba
// KOPYALANMAZ, aksi halde Hesabım'daki <select> hiçbir seçeneğe denk düşmeyen bir değerle açılır.
const ACCOUNT_POSITIONS = new Set(['Kurucu', 'Kurucu Ortak', 'Ortak', 'Ekip Lideri', 'Ekip Üyesi', 'Akademisyen', 'Serbest Çalışan', 'Öğrenci', 'Emekli', 'İşsiz']);

function jsonArrayOrNull(raw) {
  if (raw == null) return null;
  try { const v = JSON.parse(raw); return Array.isArray(v) && v.length ? JSON.stringify(v) : null; } catch { return null; }
}

// Bir KİŞİ profili bir hesaba atandığında/onaylandığında, o profilin künyesini hesabın kendi
// profiline (users satırı) taşır (kullanıcı isteği, 2026-09-08 madde 3: "hem Hesabım'daki profil
// bilgileri otomatik dolsun hem admin panelindeki Üyeler ekranında dolu görünsün").
//
// GERÇEK BULGU: bu taşıma zaten VARDI ama iki ayrı yerde ve ikisi de bu duruma uğramıyordu:
//   * src/routes/submissions.js#syncOwnArchitectToAccount — yalnızca kullanıcı KENDİ kişi kaydını
//     kaydettiğinde çalışır; admin bir profili atadığında hiçbir gönderi kaydedilmez.
//   * js/components/auth-modal.js#syncClaimedArchitectData — istemcide, YALNIZCA kullanıcı Hesabım
//     sayfasını açtığında. Admin panelindeki Üyeler ekranı users satırını okuduğundan, kullanıcı
//     hesabına hiç girmediyse admin orada BOŞ alanlar görüyordu (bkz. "Celaleddin Çelik" örneği).
// Atama anında sunucuda çalışınca iki yüzey de aynı anda dolar.
//
// YALNIZCA BOŞ ALANLAR doldurulur: kullanıcının kendi elle girdiği bir değerin üzerine yazmak,
// atamayı sessiz bir veri kaybına çevirirdi (auth-modal.js#syncClaimedArchitectData'daki AYNI kural).
// users.name'e HİÇ dokunulmaz — hesabın adı kullanıcının kendi kimliğidir, kişi kaydının yazımı
// (ör. "Celâleddin" ↔ "Celaleddin") onu ezmemeli.
export async function fillUserFromArchitectProfile(env, userId, architectName) {
  if (!userId || !architectName) return false;
  const [user, arch] = await Promise.all([
    env.DB.prepare('SELECT id, dob, school, dept, photo_url, profession, position, awards, about, social_links FROM users WHERE id = ?').bind(userId).first(),
    env.DB.prepare(
      `SELECT dob, school, dept, photo_url, profession, position, awards, about, social_links
         FROM architects WHERE deleted_at IS NULL AND (name = ? OR legacy_key = ?) LIMIT 1`
    ).bind(architectName, architectName).first(),
  ]);
  if (!user || !arch) return false;

  const updates = [];
  const values = [];
  const setIfEmpty = (col, value) => {
    if (value == null || value === '') return;
    const current = user[col];
    if (current !== null && current !== undefined && current !== '' && current !== '[]') return;
    updates.push(`${col} = ?`); values.push(value);
  };
  for (const col of ['dob', 'school', 'dept', 'photo_url', 'about']) setIfEmpty(col, arch[col]);
  setIfEmpty('position', ACCOUNT_POSITIONS.has(arch.position || '') ? arch.position : null);
  // architects.profession HAM Türkçe etiket ("Mimar, Fotoğrafçı"), users.profession SLUG
  // ("mimar,fotografci") — bkz. profession-shared.js / submissions.js#syncOwnArchitectToAccount.
  const slugs = String(arch.profession || '').split(',').map(x => professionSlugOf(x)).filter(Boolean);
  setIfEmpty('profession', slugs.length ? [...new Set(slugs)].join(',') : null);
  for (const col of ['awards', 'social_links']) setIfEmpty(col, jsonArrayOrNull(arch[col]));

  if (!updates.length) return false;
  values.push(userId);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  return true;
}


// ---------------------------------------------------------------------------------------------
// KİŞİ PROFİLİ ÜZERİNDEN FİRMA BAĞLARI (office_founders)
//
// Bir kullanıcının bir firmayla ilişkisinin ÜÇÜNCÜ yolu: firmanın kendisi, kişiyi "Kurucular /
// Ortaklar" kutusuna yazmıştır. Bu bağ ne profile_claims'te ne de kişinin kendi `office` alanında
// görünür — yalnızca office_founders join tablosunda durur (bkz. src/lib/canonicalSync.js#
// syncOfficeFoundersFromNames). Hesabım'daki "Firma / Marka Bilgileri" kutusu bu yüzden firma
// pop-up'ıyla çelişiyordu: kişi firmanın Kurucular listesinde görünüyor ama kendi hesabında o
// firmayı hiç göremiyordu.
//
// NEDEN SUNUCUDA (kullanıcı isteği, 2026-09-08: "kökten çöz"): istemci bunu bir süre
// /api/architect/:key yanıtının `offices` alanından türetiyordu, ama o istek YALNIZCA onaylı bir
// mimar TALEBİ olan kullanıcı için atılıyordu. Kendi kaydını kendi açmış (talebi olmayan) bir
// kullanıcıda — canlı örnek: "MİMARLAB Robotu", iki firmada kayıtlı olmasına rağmen kutuda tek
// firma görüyordu — hiç çalışmıyordu. Kullanıcının kişi kaydını bulmanın İKİ yolu var (bkz. proje
// notu: "Profil sahipliğinin İKİ yolu") ve ikisi de burada tek noktada uygulanır.

// Kullanıcının kişi (architects) satır id'leri.
//   claimed  — admin onaylı profile_claims('architect') üzerinden bağlı satırlar
//   selfNamed— kullanıcının KENDİ adıyla eşleşen satır (name_fold, migrations/0079'un generated
//              kolonu; foldTr'nin SQL karşılığı — JS tarafıyla birebir aynı katlama)
// İkisi AYRI döner: görünürlük her ikisini de kabul eder, DÜZENLEME YETKİSİ yalnızca `claimed`
// yolundan verilir (ad eşleşmesi admin onayı DEĞİLDİR).
export async function fetchOwnArchitectRows(env, user) {
  if (!user) return { claimed: [], selfNamed: [] };
  const [claimedRes, selfRes] = await Promise.all([
    env.DB.prepare(
      `SELECT a.id, a.name, a.slug, a.position FROM profile_claims c
         JOIN architects a ON (a.name = c.profile_key OR a.legacy_key = c.profile_key) AND a.deleted_at IS NULL
        WHERE c.user_id = ? AND c.profile_type = 'architect' AND c.status = 'approved'`
    ).bind(user.id).all(),
    user.name
      ? env.DB.prepare(`SELECT id, name, slug, position FROM architects WHERE deleted_at IS NULL AND name_fold = ?`).bind(foldTr(user.name)).all()
      : Promise.resolve({ results: [] }),
  ]);
  const claimed = claimedRes.results || [];
  const claimedIds = new Set(claimed.map(r => r.id));
  return { claimed, selfNamed: (selfRes.results || []).filter(r => !claimedIds.has(r.id)) };
}

// GET /api/claims/mine'ın `officeLinks` alanı: kişi profilinin office_founders üzerinden bağlı
// olduğu firmalar. canEdit — bu bağın firma künyesini düzenleme yetkisi verip vermediği; sunucudaki
// gerçek kural (bkz. canEditOfficeViaFounderLink) ile BİREBİR aynı hesap, istemci butonu buna göre
// çizer ve "boş yere doldurulan form, sonra 403" durumu oluşmaz.
export async function fetchOfficeFounderLinks(env, user, officeEditPositions) {
  const { claimed, selfNamed } = await fetchOwnArchitectRows(env, user);
  const all = [...claimed, ...selfNamed];
  if (!all.length) return [];
  const claimedIds = new Set(claimed.map(r => r.id));
  const ids = all.map(r => r.id);
  const { results } = await env.DB.prepare(
    `SELECT f.architect_id, o.name, o.slug FROM office_founders f
       JOIN offices o ON o.id = f.office_id AND o.deleted_at IS NULL AND o.hidden_at IS NULL
      WHERE f.architect_id IN (${ids.map(() => '?').join(', ')})
      ORDER BY o.name COLLATE NOCASE ASC`
  ).bind(...ids).all();
  const posById = new Map(all.map(r => [r.id, r.position || null]));
  // Yetkisi elle kaldırılmış firmalar (bkz. canEditOfficeViaFounderLink'teki AYNI gerekçe) — firma
  // kutuda GÖRÜNMEYE devam eder (kurucu bağı duruyor), yalnızca canEdit düşer, yani "Profili
  // Düzenle" butonu çıkmaz. Tek sorgu: kullanıcının tüm iptal kayıtları.
  const revoked = await revokedOfficeKeysForUser(env, user.id);
  const out = [];
  const seen = new Set();
  for (const r of results || []) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    const position = posById.get(r.architect_id) || null;
    out.push({
      name: r.name, slug: r.slug, role: position,
      canEdit: claimedIds.has(r.architect_id) && officeEditPositions.has(position || '')
        && !revoked.has(foldTr(r.name)),
    });
  }
  return out;
}

// -----------------------------------------------------------------------------------------------
// YETKİ İPTALİ (kullanıcı isteği, 2026-09-12: Hesabım > "Yetkili Kullanıcılar" satırındaki X).
//
// NEDEN YENİ TABLO YOK: iptal, profile_claims'in KENDİ satırında yaşar — status = 'revoked'.
//   * claim yoluyla yetkili olan biri için satır zaten vardır; 'approved' olmaktan çıkması tek
//     başına YETERLİDİR, çünkü yetkiyi okuyan her kapı (submissions.js#verifyClaimedProfileKey,
//     projectClaimAccess.js, badgeAccess.js, officeJobs.js ...) status='approved' arar.
//   * kurucu bağıyla yetkili olan biri için satır YOKTUR; X o kullanıcıya 'revoked' bir satır
//     açar ve kurucu bağını okuyan İKİ fonksiyon (canEditOfficeViaFounderLink,
//     fetchOfficeFounderLinks) bunu kontrol eder. Başka okuma noktası yoktur.
// Yeni bir tablo, deploy ile birlikte otomatik uygulanmayan bir migration gerektirirdi (bkz.
// CLAUDE.md: migration'lar elle çalıştırılır) — kod canlıya çıkıp tablo gelmediğinde yetki
// sorguları hata verirdi. Mevcut tablo ve UNIQUE(user_id, profile_type, profile_key) kısıtı
// hem bu riski hem "aynı kullanıcı için iki çelişkili kayıt" ihtimalini ortadan kaldırır.
// -----------------------------------------------------------------------------------------------
export const OFFICE_MANAGER_REVOKED = 'revoked';

// Firmanın adı VE legacy_key'i birlikte aranır: profile_claims bu depoda ikisiyle de anahtarlanmış
// olabilir (bkz. canEditOfficeViaFounderLink'teki AYNI OR deseni).
export async function isOfficeManagerRevoked(env, userId, officeName) {
  if (!userId || !officeName) return false;
  const row = await env.DB.prepare(
    `SELECT 1 FROM profile_claims c
      WHERE c.user_id = ? AND c.profile_type = 'office' AND c.status = ?
        AND (c.profile_key = ?3
             OR c.profile_key IN (SELECT o.name FROM offices o WHERE o.deleted_at IS NULL AND (o.name = ?3 OR o.legacy_key = ?3))
             OR c.profile_key IN (SELECT o.legacy_key FROM offices o WHERE o.deleted_at IS NULL AND o.legacy_key IS NOT NULL AND (o.name = ?3 OR o.legacy_key = ?3)))
      LIMIT 1`
  ).bind(userId, OFFICE_MANAGER_REVOKED, officeName).first();
  return !!row;
}

// Kullanıcının TÜM iptal kayıtları, Türkçe katlamalı anahtar kümesi olarak (fetchOfficeFounderLinks
// listeyi isimle eşleştirdiğinden ad başına ayrı sorgu atmamak için tek seferde okunur).
export async function revokedOfficeKeysForUser(env, userId) {
  const out = new Set();
  if (!userId) return out;
  const { results } = await env.DB.prepare(
    `SELECT profile_key FROM profile_claims WHERE user_id = ? AND profile_type = 'office' AND status = ?`
  ).bind(userId, OFFICE_MANAGER_REVOKED).all();
  for (const r of results || []) {
    if (!r.profile_key) continue;
    out.add(foldTr(r.profile_key));
    // legacy_key ile kaydedilmiş bir iptali canonical adla da eşleştirebilmek için karşılığı eklenir.
  }
  if (!out.size) return out;
  const { results: offices } = await env.DB.prepare(
    `SELECT name, legacy_key FROM offices WHERE deleted_at IS NULL AND legacy_key IS NOT NULL`
  ).all();
  for (const o of offices || []) {
    if (out.has(foldTr(o.legacy_key))) out.add(foldTr(o.name));
    if (out.has(foldTr(o.name)) && o.legacy_key) out.add(foldTr(o.legacy_key));
  }
  return out;
}

// Sunucu tarafı yetki kapısı — src/routes/submissions.js#verifyClaimedProfileKey buradan geçer.
//
// KURAL: kullanıcının ADMIN ONAYLI bir kişi profili var VE o kişi bu firmanın office_founders
// listesinde VE kişinin görevi (architects.position) düzenleme yetkisi veren pozisyonlardan biri.
// Yetkinin kaynağı iki yönlü bir onay zinciridir: (a) admin "bu profil bu kullanıcıya ait" dedi,
// (b) firmayı düzenleme yetkisi olan biri (admin ya da firmanın claim sahibi) o kişiyi Kurucular
// kutusuna yazdı. Ad eşleşmesi (selfNamed) BU KAPIDAN GEÇMEZ — o admin onayı değildir.
//
// BİLİNEN SINIR: office_founders satırı rol taşımaz (bkz. schema.sql — yalnızca office_id +
// architect_id) ve `architects.position` KİŞİYE ait tek bir alandır, firmaya özgü değil. Yani bir
// kişi A firmasında Kurucu, B firmasında sıradan bir üye olarak listelenmişse ikisinde de aynı
// görevle değerlendirilir. Firma pop-up'ı da kurucu kartlarının rolünü ZATEN bu alandan yazıyor
// (bkz. src/routes/office.js#buildOfficePayload), yani gösterim ile yetki tutarlı; daha ince bir
// ayrım office_founders'a rol kolonu eklemeden mümkün değil.
export async function canEditOfficeViaFounderLink(env, user, officeName, officeEditPositions) {
  if (!user || !officeName) return false;
  // YETKİSİ ELLE KALDIRILMIŞ MI (kullanıcı isteği, 2026-09-12: Hesabım'daki "Yetkili Kullanıcılar"
  // satırındaki X). İptal kaydı profile_claims'te status='revoked' satırıdır (bkz.
  // OFFICE_MANAGER_REVOKED) — claim YOLUYLA yetkili olanlarda o satırın kendisi 'approved'dan
  // çıktığı için tüm kapılar zaten kapanır; KURUCU BAĞI yolunda ise ortada iptal edilecek bir
  // satır olmadığından iptal kaydı burada okunmak ZORUNDA. X künyeye (office_founders) DOKUNMAZ:
  // kişi firma popup'ının Kurucular listesinde kalır, yalnızca düzenleme yetkisi biter.
  if (await isOfficeManagerRevoked(env, user.id, officeName)) return false;
  const { claimed } = await fetchOwnArchitectRows(env, user);
  const eligible = claimed.filter(r => officeEditPositions.has(r.position || ''));
  if (!eligible.length) return false;
  const ids = eligible.map(r => r.id);
  const row = await env.DB.prepare(
    `SELECT 1 FROM office_founders f JOIN offices o ON o.id = f.office_id AND o.deleted_at IS NULL
      WHERE f.architect_id IN (${ids.map(() => '?').join(', ')}) AND (o.name = ? OR o.legacy_key = ?) LIMIT 1`
  ).bind(...ids, officeName, officeName).first();
  return !!row;
}

// ---------------------------------------------------------------------------------------------
// FİRMA/MARKA YETKİLİSİNİN, FİRMA ORTAKLARININ KİŞİ PROFİLLERİNİ DÜZENLEMESİ
// (kullanıcı isteği, 2026-09-08: "Bir firmanın kurucusu, kurucu ortağı, ortağı veya ekip lideri de
// diğer firma ortaklarının profillerini düzenleme yetkisine sahip olsun ... Aynı kural marka
// profilleri ve marka kurucuları, ortakları vs. için de geçerli.")
//
// Marka için AYRI bir kod yolu YOK: marka bir `offices` satırıdır (bkz. office-kind.js), claim tipi
// de 'office' — aşağıdaki kural ikisini birden kapsar.
//
// YETKİNİN KAYNAĞI iki yönlü bir onay zinciri (canEditOfficeViaFounderLink ile AYNI mantık):
//   (a) kullanıcı firmayı düzenleyebiliyor — onaylı profile_claims('office') + admin'in DONDURDUĞU
//       office_position OFFICE_EDIT_POSITIONS içinde, ya da canEditOfficeViaFounderLink'in aynı
//       kapısı (onaylı KİŞİ talebi + firmanın Kurucular listesinde olmak + yetkili görev),
//   (b) hedef kişi o firmanın Kurucular/Ekip listesinde — yani firmayı düzenleyebilen biri (ya da
//       admin) o kişiyi oraya YAZMIŞ.
//
// SINIR — KENDİ SAHİBİ OLAN PROFİL DOKUNULMAZ: hedef kişi profilinin BAŞKA bir hesaba ait onaylı
// bir profile_claims('architect') satırı varsa bu kapı kapalıdır. Gerekçe: firmanın kendi Kurucular
// kutusu serbest metindir ve isim eşleşmesiyle office_founders'a bağlanır (bkz. canonicalSync.js#
// syncOfficeFoundersFromNames — kasıtlı olarak onay kapısının DIŞINDA), yani bu güvenlik ağı
// olmadan herhangi bir firma yetkilisi kutusuna tanınmış bir mimarın adını yazıp o kişinin KENDİ
// sahiplendiği profilini düzenleyebilirdi. Sahiplenilmiş profili yalnızca sahibi (ve admin) düzenler.
async function fetchUserEditableOfficeIds(env, user, officeEditPositions) {
  const ids = new Set();
  // (a1) doğrudan firma/marka sahipliği — DONDURULMUŞ office_position (canlı users.position ASLA,
  // bkz. migrations/0068 ve submissions.js#verifyClaimedProfileKey'deki AYNI P1 gerekçesi).
  const { results: claimRows } = await env.DB.prepare(
    `SELECT c.office_position AS position, o.id AS office_id
       FROM profile_claims c
       JOIN offices o ON (o.name = c.profile_key OR o.legacy_key = c.profile_key) AND o.deleted_at IS NULL
      WHERE c.user_id = ? AND c.profile_type = 'office' AND c.status = 'approved'`
  ).bind(user.id).all();
  for (const r of claimRows || []) {
    if (officeEditPositions.has(r.position || '')) ids.add(r.office_id);
  }
  // (a2) firmanın Kurucular listesindeki onaylı kişi profili üzerinden — canEditOfficeViaFounderLink
  // ile AYNI kural, yalnızca "tek firma" yerine tüm firmaları döndürür.
  const { claimed } = await fetchOwnArchitectRows(env, user);
  const eligible = claimed.filter(r => officeEditPositions.has(r.position || ''));
  if (eligible.length) {
    const archIds = eligible.map(r => r.id);
    const { results } = await env.DB.prepare(
      `SELECT f.office_id FROM office_founders f
         JOIN offices o ON o.id = f.office_id AND o.deleted_at IS NULL
        WHERE f.architect_id IN (${archIds.map(() => '?').join(', ')})`
    ).bind(...archIds).all();
    for (const r of results || []) ids.add(r.office_id);
  }
  // Düz IN(...) sınırı — bkz. proje notu: SQLite ifade-ağacı derinlik sınırı. Bir hesabın onlarca
  // firmayı birden yönetmesi beklenmez, üst sınır yalnızca uç veriye karşı emniyet supabı.
  return [...ids].slice(0, 50);
}

export async function canEditArchitectViaOfficeMembership(env, user, architectKey, officeEditPositions) {
  if (!user || !architectKey) return false;
  const arch = await env.DB.prepare(
    `SELECT id, name FROM architects WHERE deleted_at IS NULL AND (name = ? OR legacy_key = ? OR slug = ?) LIMIT 1`
  ).bind(architectKey, architectKey, architectKey).first();
  if (!arch) return false;
  // Kendi sahibi olan profil dokunulmaz (bkz. yukarıdaki SINIR).
  const ownedByOther = await env.DB.prepare(
    `SELECT 1 FROM profile_claims
      WHERE profile_type = 'architect' AND profile_key = ? AND status = 'approved' AND user_id != ? LIMIT 1`
  ).bind(arch.name, user.id).first();
  if (ownedByOther) return false;

  const officeIds = await fetchUserEditableOfficeIds(env, user, officeEditPositions);
  if (!officeIds.length) return false;
  const placeholders = officeIds.map(() => '?').join(', ');

  // (b1) yapısal bağ — firma pop-up'ının "Kurucular / Ortaklar" listesi (office_founders).
  const link = await env.DB.prepare(
    `SELECT 1 FROM office_founders WHERE architect_id = ? AND office_id IN (${placeholders}) LIMIT 1`
  ).bind(arch.id, ...officeIds).first();
  if (link) return true;

  // (b2) serbest metin Kurucular/Ekip kutuları — firma-ekle.html'in iki listesi (bkz. src/routes/
  // office.js#fetchRawFounderNames/fetchRawTeamNames, pop-up'ta AYNI isimler render edilir).
  // office_founders'a bağlanmamış (ad eşleşmesi onay anında kurulamamış) bir isim de firmanın
  // künyesinde görünür; yetki gösterimle tutarlı kalmalı.
  const { results: offices } = await env.DB.prepare(
    `SELECT id, name, legacy_key FROM offices WHERE id IN (${placeholders})`
  ).bind(...officeIds).all();
  const wanted = foldTr(arch.name);
  for (const o of offices || []) {
    const submissionId = (o.legacy_key || '').startsWith('submission:') ? o.legacy_key.slice('submission:'.length) : '';
    const row = await env.DB.prepare(
      `SELECT founders, team FROM office_submissions
        WHERE claimed_profile_key = ?1 OR claimed_profile_key = ?2 OR id = ?3 ORDER BY updated_at DESC LIMIT 1`
    ).bind(o.name, o.legacy_key || '', submissionId).first();
    if (!row) continue;
    const names = [...parseNameList(row.founders), ...parseNameList(row.team)];
    if (names.some(n => foldTr(n) === wanted)) return true;
  }
  return false;
}

function parseNameList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : [];
  } catch { return []; }
}

// SAHİPLENİLMEMİŞ FOTOĞRAFÇILAR (kullanıcı isteği, 2026-09-10 on birinci tur madde 7: "profilini
// henüz sahiplenmeyen fotoğrafçı profil fotoğraflarını da blurla" — telif gerekçesi). Mesleği
// "Fotoğrafçı" içeren ve isArchitectProfileClaimed'in ÜÇ yolundan (kendi onaylı talebi / kurucusu
// olduğu sahiplenilmiş firma / kendi yayınladığı profil) hiçbirine girmeyen kişilerin slug'ları.
// /api/public/preview'a eklenir (bkz. src/routes/legacyContent.js#fetchPreviewMap) ve
// js/components/preview-cards.js DOM'daki /kisi/<slug> kartlarının görselini blurlar — kişi
// profilinin KENDİ fotoğrafı ise architect payload'ındaki `photoBlur` bayrağıyla (aynı kural,
// isArchitectProfileClaimed) blurlanır. Tek sorgu, tek liste: fotoğrafçı sayısı küçüktür.
export async function fetchUnclaimedPhotographerSlugs(env) {
  return (await fetchUnclaimedPhotographers(env)).map(r => r.slug).filter(Boolean);
}
// Aynı küme, slug + photo_url ile — src/lib/gatedMedia.js (sunucu tarafı blur) fotoğraf URL'sini
// gated görsel kümesine ekler; scripts/backfill-blur-derivatives.py AYNI SQL'i çalıştırır.
export async function fetchUnclaimedPhotographers(env) {
  const { results } = await env.DB.prepare(
    `SELECT a.slug, a.photo_url FROM architects a
      WHERE a.deleted_at IS NULL AND a.slug IS NOT NULL AND a.slug != ''
        AND a.profession LIKE '%Fotoğrafçı%'
        AND NOT EXISTS (SELECT 1 FROM profile_claims c WHERE c.status = 'approved'
                          AND (c.profile_key = a.name OR (a.legacy_key IS NOT NULL AND c.profile_key = a.legacy_key)))
        AND NOT EXISTS (SELECT 1 FROM offices o
                          JOIN profile_claims c ON c.status = 'approved' AND c.profile_type = 'office'
                           AND (c.profile_key = o.name OR (o.legacy_key IS NOT NULL AND c.profile_key = o.legacy_key))
                         WHERE o.deleted_at IS NULL
                           AND (o.id = a.office_id OR o.id IN (SELECT f.office_id FROM office_founders f WHERE f.architect_id = a.id)))
        AND NOT EXISTS (SELECT 1 FROM architect_submissions s JOIN users u ON u.id = s.owner_user_id
                         WHERE ('submission:' || s.id) = a.legacy_key AND s.status = 'approved'
                           AND u.name IS NOT NULL AND a.name = u.name COLLATE NOCASE)`
  ).all();
  return (results || []).map(r => ({ slug: r.slug, photo_url: r.photo_url || null }));
}

// -----------------------------------------------------------------------------------------------
// BİR FİRMANIN/MARKANIN YETKİLİ KULLANICILARI (kullanıcı isteği, 2026-09-12: "Hesabım sayfasındaki
// Firma / Marka Bilgileri kutusunda Görevin satırının altına 'Yetkili Kullanıcılar' satırı aç ve
// bu kısımda admin tarafından firmanın içeriklerini yönetmesi için görevlendirilmiş (kurucu,
// kurucu ortak, ortak, yönetici, ekip lideri) diğer hesapların ad soyadları yazsın.")
//
// "Yetkili" TANIMI BURADA YENİDEN YAZILMAZ: düzenleme hakkının zaten var olan İKİ yolu okunur ve
// ikisi de o yolun kendi kuralına birebir uyar —
//   (a) ONAYLI firma talebi + dondurulmuş görev (bkz. submissions.js#verifyClaimedProfileKey:
//       profile_claims.office_position, OFFICE_EDIT_POSITIONS içinde olmalı),
//   (b) KURUCU BAĞI (bkz. canEditOfficeViaFounderLink): kullanıcının ONAYLI kişi profili firmanın
//       office_founders listesinde ve o kişi kaydının pozisyonu yetkili pozisyonlardan biri.
// Yani bu liste "kimler bu firmanın künyesini kaydedebilir" sorusunun cevabıdır; yeni bir yetki
// kavramı icat etmez ve sunucunun gerçek kapısıyla ayrışamaz.
//
// GİZLİLİK: yalnızca AD SOYAD döner (e-posta/kullanıcı id'si asla) ve ucu çağıran tarafın kendisi
// de aynı firmanın yetkilisi olmak zorundadır (bkz. src/routes/claims.js#officeManagers).
// -----------------------------------------------------------------------------------------------
export async function fetchOfficeManagers(env, officeName, officeEditPositions) {
  const key = (officeName || '').trim();
  if (!key) return [];
  const positions = [...officeEditPositions];
  const ph = positions.map(() => '?').join(', ');
  // Sabit, kullanıcı girdisi DEĞİL (bu dosyanın kendi export'u) — SQL'e gömülmesi güvenli.
  const OFFICE_MANAGER_REVOKED_SQL = OFFICE_MANAGER_REVOKED;
  // Firmanın adı ile legacy_key'i ayrı ayrı sorulur: profile_claims bu depoda ikisiyle de
  // anahtarlanmış olabilir (bkz. canEditOfficeViaFounderLink'teki AYNI OR).
  const [claimRes, founderRes] = await Promise.all([
    env.DB.prepare(
      `SELECT u.id AS userId, u.name AS name, c.office_position AS position
         FROM profile_claims c
         JOIN users u ON u.id = c.user_id
        WHERE c.profile_type = 'office' AND c.status = 'approved'
          AND (c.profile_key = ?1 OR c.profile_key = (SELECT o.legacy_key FROM offices o WHERE o.name = ?1 AND o.deleted_at IS NULL))
          AND c.office_position IN (${ph})`
    ).bind(key, ...positions).all(),
    env.DB.prepare(
      // NOT EXISTS — yetkisi ELLE KALDIRILMIŞ kurucu bağı listeye girmez (bkz.
      // isOfficeManagerRevoked: claim yolunda status='approved' süzgeci bunu zaten yapıyor,
      // kurucu bağında iptal kaydı ayrıca sorulmak zorunda).
      `SELECT u.id AS userId, u.name AS name, a.position AS position
         FROM office_founders f
         JOIN offices o ON o.id = f.office_id AND o.deleted_at IS NULL
         JOIN architects a ON a.id = f.architect_id AND a.deleted_at IS NULL
         JOIN profile_claims c ON c.profile_type = 'architect' AND c.status = 'approved'
          AND (c.profile_key = a.name OR (a.legacy_key IS NOT NULL AND c.profile_key = a.legacy_key))
         JOIN users u ON u.id = c.user_id
        WHERE (o.name = ?1 OR o.legacy_key = ?1)
          AND a.position IN (${ph})
          AND NOT EXISTS (SELECT 1 FROM profile_claims rc
                           WHERE rc.user_id = u.id AND rc.profile_type = 'office'
                             AND rc.status = '${OFFICE_MANAGER_REVOKED_SQL}'
                             AND (rc.profile_key = o.name OR (o.legacy_key IS NOT NULL AND rc.profile_key = o.legacy_key)))`
    ).bind(key, ...positions).all(),
  ]);
  const out = [];
  const seen = new Set();
  // Talep yolu ÖNCE eklenir: aynı kullanıcı iki yoldan da yetkiliyse görev olarak onay anında
  // dondurulmuş değer gösterilir (firmaya ÖZGÜ tek doğru değer — bkz. auth-modal.js#renderFirmPage
  // "Görevin" satırındaki AYNI öncelik).
  // source — istemci için: 'claim' admin ataması (ya da Hesabım'daki + ile verilen yetki),
  // 'founder' firmanın Kurucular listesindeki onaylı kişi profilinden gelen yetki. İkisinde de X
  // aynı şeyi yapar (yetkiyi kaldırır, künyeye dokunmaz) — alan yalnızca ipucu metni içindir.
  for (const [source, rows] of [['claim', claimRes.results || []], ['founder', founderRes.results || []]]) {
    for (const r of rows) {
      if (!r || !r.name || seen.has(r.userId)) continue;
      seen.add(r.userId);
      out.push({ userId: r.userId, name: r.name, position: r.position || null, source });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  return out;
}
