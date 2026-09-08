import professionShared from '../../profession-shared.js';

// "Bu kayıt bir üyeye atanmış mı?" — kişi/firma/marka/proje/ürün pop-up'larındaki
// "Kamuya açık kaynaklardan derlenmiştir, doğrulanmamıştır." uyarısının TEK kaynağı.
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
    const canonical = await env.DB.prepare(
      `SELECT id FROM offices WHERE deleted_at IS NULL AND (name = ? COLLATE NOCASE OR legacy_key = ?) LIMIT 1`
    ).bind(name, name).first();
    if (!canonical) continue;
    const existing = await env.DB.prepare(
      `SELECT id FROM profile_claims WHERE user_id = ? AND profile_type = 'office' AND profile_key = ?`
    ).bind(user.id, name).first();
    if (existing) continue;
    await env.DB.prepare(
      `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, note, created_at, updated_at)
       VALUES (?, ?, 'office', ?, 'pending', ?, ?, ?)`
    ).bind(newId(), user.id, name, 'Kişi profilindeki "Firma veya Marka" alanından oluşturuldu.', now, now).run();
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
