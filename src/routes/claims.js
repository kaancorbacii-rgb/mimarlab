import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';
import { resolveCanonicalName } from '../lib/canonicalRead.js';
import { foldTr } from '../lib/textMatch.js';
import { fetchOfficeFounderLinks, fetchOwnArchitectRows, canEditArchitectViaOfficeMembership, canEditOfficeViaFounderLink, fetchOfficeManagers, fetchOwnOfficeRoles, OFFICE_MANAGER_REVOKED, OFFICE_MANAGER_DISMISSED } from '../lib/claimedProfiles.js';
import { OFFICE_EDIT_POSITIONS, MANAGER_POSITION } from '../lib/projectClaimAccess.js';
import { purgeSsrDetailCache } from '../lib/ssrCache.js';
import { invalidatePublicCache } from '../lib/publicCache.js';

const PROFILE_TYPES = new Set(['architect', 'office']);
// profile_claims.profile_key'in eşleşmesi GEREKEN canonical tablo (bkz. src/routes/admin.js#
// PROFILE_OPTION_TABLE ve src/routes/submissions.js#CANONICAL_TABLE_BY_TYPE ile AYNI eşleme).
const CLAIM_CANONICAL_TABLE = { architect: 'architects', office: 'offices' };
// /api/corrections (bkz. handleCorrectionsRoute) sahiplenme değil salt bilgi-bildirimi olduğundan
// project/product de kabul eder — proje/ürün modallarındaki "Bilgi Kaynağı & Geri Bildirim" kutusu
// (bkz. kullanıcı isteği) BU uç noktayı kullanır. /api/claims (sahiplenme) mimar/firma ile sınırlı kalır.
const CORRECTION_PROFILE_TYPES = new Set(['architect', 'office', 'project', 'product']);

export async function handleClaimsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "claims", maybe "status"]

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'POST') return createClaim(request, env, user);
  if (segments.length === 3 && segments[2] === 'status' && request.method === 'GET') {
    return claimStatus(env, url, user);
  }
  if (segments.length === 3 && segments[2] === 'mine' && request.method === 'GET') {
    return myClaims(env, user);
  }
  if (segments.length === 3 && segments[2] === 'office-link' && request.method === 'DELETE') {
    return dismissOfficeLink(env, url, user);
  }
  if (segments.length === 3 && segments[2] === 'office-managers') {
    if (request.method === 'GET') return officeManagers(env, url, user);
    // Yetki VER / yetki KALDIR (kullanıcı isteği, 2026-09-12: "Yetkili Kullanıcılar" satırındaki
    // + ve X). İkisi de aynı kapıdan geçer: isteği yapan da o firmanın yetkilisi olmalı.
    if (request.method === 'POST') return grantOfficeManager(request, env, user);
    if (request.method === 'DELETE') return revokeOfficeManager(env, url, user);
  }
  return errorJson('Bulunamadı', 404);
}

// POST /api/corrections — "Bilgi kaynağı" kutucuğundaki "Düzeltme Öner" formu. profile_claims'ten
// ayrı ve daha gevşek: sahiplenme iddiası değildir, aynı kullanıcı aynı profil için birden fazla
// öneri gönderebilir (unique kısıtı yok). Admin panelinde "Profil Talepleri" sekmesinde okunur.
export async function handleCorrectionsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "corrections"]
  if (segments.length !== 2 || request.method !== 'POST') return errorJson('Bulunamadı', 404);

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  // gerçek bulgu: bu uçta hiç hız sınırı yoktu — dosya başı yorumunda da belirtildiği gibi
  // profile_corrections'ın unique kısıtı yok (aynı kullanıcı aynı profil için sınırsız öneri
  // gönderebilir), admin kuyruğunu doldurma riskine karşı kullanıcı bazlı bir üst sınır.
  if (!(await checkRateLimit(env, 'correction', user.id, 20, 60 * 60 * 1000))) {
    return errorJson('Çok fazla öneri gönderdin. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }
  // audit bulgusu: kullanıcı bazlı limit tek başına, birden çok hesap açıp aynı IP'den kuyruğu
  // doldurmayı engellemiyordu — bkz. src/routes/badges.js#handleBadgeRequestRoute'daki AYNI
  // ikili (kullanıcı + IP) desen. Eşik kullanıcı bazlı limitten yüksek tutulur (bir ofis/kurumda
  // aynı IP'yi paylaşan birden çok meşru kullanıcı olabilir), yalnızca gerçek çoklu-hesap istismarını
  // hedefler.
  if (!(await checkRateLimit(env, 'correction-ip', clientIp(request), 60, 60 * 60 * 1000))) {
    return errorJson('Çok fazla öneri gönderildi. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const profileType = body.profileType;
  const profileKey = (body.profileKey || '').trim();
  const note = (body.note || '').trim().slice(0, 1000);
  if (!CORRECTION_PROFILE_TYPES.has(profileType) || !profileKey) return errorJson('Geçersiz istek.');
  if (!note) return errorJson('Lütfen bir not yaz.');

  const id = newId();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO profile_corrections (id, user_id, profile_type, profile_key, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, profileType, profileKey, note, 'pending', now, now).run();

  return json({ status: 'pending' }, 201);
}

// GET /api/claims/mine — hesabim.html'in "Mimar/Marka Profilim" bölümü için kullanıcının
// kendi profil taleplerini (her durumdan) döner.
async function myClaims(env, user) {
  // office_position — onay ANINDA dondurulmuş pozisyon (bkz. migrations/0068, src/routes/
  // submissions.js#verifyClaimedProfileKey). gerçek bulgu (denetim, 2026-09-04): istemci tarafındaki
  // TÜM "Düzenle" kapıları (js/components/claim-correction-box.js#renderProfileEditButton,
  // js/components/auth-modal.js#renderFirmEditBtn) bunun yerine kullanıcının CANLI position'ına
  // bakıyordu — sunucu ise dondurulmuş değere. İkisi kullanıcı kendi pozisyonunu değiştirdiği anda
  // ayrışıyor ve iki yönde de yanlış sonuç veriyordu: (a) Kurucu olarak onaylanıp sonra pozisyonunu
  // değiştiren gerçek sahip, sunucu hâlâ izin verdiği hâlde butonu hiçbir yerde göremiyor (kendi
  // firmasından kilitleniyor); (b) yetkisiz bir pozisyonla onaylanmış biri pozisyonunu "Kurucu"
  // yapınca butonu görüyor, formu dolduruyor ve kaydederken 403 yiyor. Doğru değer sunucudan gelmeli.
  // status='removed' — kullanıcı bu firmayı Hesabım kutusundan KENDİSİ kaldırdı (bkz.
  // dismissOfficeLink). Satır yetkinin iptal kaydı olarak DURUR ama kutuda bir daha görünmez.
  const { results } = await env.DB.prepare(
    `SELECT profile_type, profile_key, status, office_position AS officePosition FROM profile_claims
      WHERE user_id = ? AND status != ? ORDER BY updated_at DESC`
  ).bind(user.id, OFFICE_MANAGER_DISMISSED).all();
  // slug: hesabim.html/auth-modal.js'in "Düzenle" linkini profile_key (bare isim, boşluk/TR karakter
  // içerebilir — bkz. kullanıcı isteği 2026-08-17: "?claim= şeklinde bozuk bir URL çıkıyor") yerine
  // temiz bir slug'la kurabilmesi için — yalnızca onaylı taleplerde anlamlı (canonical satır ancak
  // o zaman kesin var), bulunamazsa (ör. henüz senkronlanmamış) sessizce null kalır ve çağıran taraf
  // profile_key'e düşer.
  // image: İçeriklerim > "Mimar/Firma Profilim" kutusunda profil görseli göstermek için (bkz.
  // kullanıcı isteği) — slug ile AYNI şekilde yalnızca onaylı taleplerde anlamlı.
  const items = await Promise.all(results.map(async r => {
    if (r.status !== 'approved' || (r.profile_type !== 'architect' && r.profile_type !== 'office')) return r;
    const table = r.profile_type === 'architect' ? 'architects' : 'offices';
    const imageCol = r.profile_type === 'architect' ? 'photo_url' : 'logo_url';
    const row = await env.DB.prepare(`SELECT slug, ${imageCol} AS image FROM ${table} WHERE name = ? AND deleted_at IS NULL`).bind(r.profile_key).first();
    return { ...r, slug: row ? row.slug : null, image: row ? row.image : null };
  }));
  // officeLinks — kullanıcının KİŞİ profilinin office_founders üzerinden bağlı olduğu firmalar
  // (kullanıcı isteği, 2026-09-08: firma kullanıcıyı Kurucular kutusuna eklediğinde Hesabım'daki
  // "Firma / Marka Bilgileri" kutusunda da görünsün). Bkz. src/lib/claimedProfiles.js#
  // fetchOfficeFounderLinks — kişi kaydını bulmanın İKİ yolunu da (onaylı talep + ad eşleşmesi)
  // kapsar, bu yüzden istemcinin eskiden yaptığı "yalnızca onaylı talebi olanda çalışan" türetme
  // ortadan kalkar.
  const officeLinks = await fetchOfficeFounderLinks(env, user, OFFICE_EDIT_POSITIONS);
  // KÜNYEDEKİ GÖREV (kullanıcı bildirimi, 2026-09-12) — Hesabım'daki "Görevin" satırı artık
  // dondurulmuş claim görevini değil, pop-up'ların gösterdiği GÜNCEL künye görevini okur; üç ekran
  // tek alandan (architects.position) besleniyor ve birlikte değişiyor. Bkz. fetchOwnOfficeRoles.
  const officeRoles = await fetchOwnOfficeRoles(env, user);
  const roleFor = (key) => officeRoles.get(foldTr(key)) || null;
  // Kullanıcının kendi kaldırdığı (removed) firmalar kurucu bağı üzerinden geri sızmamalı.
  const dismissed = new Set(
    (await env.DB.prepare(
      `SELECT profile_key FROM profile_claims WHERE user_id = ? AND profile_type = 'office' AND status = ?`
    ).bind(user.id, OFFICE_MANAGER_DISMISSED).all()).results?.map(r => foldTr(r.profile_key)) || []
  );
  // architectProfile — hesabın KİŞİ profili (kullanıcı isteği, 2026-09-08 madde 3: Hesabım'daki
  // "Ad Soyad" satırı, firma satırı gibi, o profilin pop-up'ına gitsin). officeLinks ile AYNI
  // yardımcıdan gelir, yani sahipliğin İKİ yolunu da kapsar: onaylı talep ÖNCE, yoksa hesabın
  // adıyla eşleşen kendi kaydı (bkz. fetchOwnArchitectRows).
  const own = await fetchOwnArchitectRows(env, user);
  const ownArchitect = own.claimed[0] || own.selfNamed[0] || null;
  return json({
    items: items
      .filter(r => !(r.profile_type === 'office' && dismissed.has(foldTr(r.profile_key))))
      .map(r => (r.profile_type === 'office' ? { ...r, officeRole: roleFor(r.profile_key) } : r)),
    officeLinks: officeLinks
      .filter(l => !dismissed.has(foldTr(l.name)))
      .map(l => ({ ...l, officeRole: roleFor(l.name) || l.role || null })),
    architectProfile: ownArchitect ? { name: ownArchitect.name, slug: ownArchitect.slug } : null,
  });
}

// GET /api/claims/office-managers?key=<firma adı> — Hesabım > "Firma / Marka Bilgileri"
// kutusundaki "Yetkili Kullanıcılar" satırı (kullanıcı isteği, 2026-09-12): bu firmanın
// içeriklerini yönetmekle görevlendirilmiş DİĞER hesapların ad soyadları.
//
// KAPI: isteyenin kendisi de aynı firmanın yetkilisi olmalı — yetkili değilse (ör. Ekip Üyesi ya
// da hiç ilgisi olmayan bir hesap) 403 döner ve istemci satırı hiç çizmez. Yetki kararı
// SUNUCUNUN kendi kapılarıyla birebir aynı iki yoldan okunur (onaylı talep + dondurulmuş görev,
// ya da kurucu bağı) — yani "listeyi görebilenler" ile "künyeyi kaydedebilenler" aynı kümedir.
// Yanıt yalnızca ad soyad ve görev taşır; e-posta/kullanıcı id'si DÖNMEZ.
// İsteği yapan bu firmanın yetkilisi mi (ÜÇ ucun da ortak kapısı: listele / yetki ver / kaldır).
// Kendi talebin: onay ANINDA dondurulmuş görev (canlı position DEĞİL — bkz. myClaims'teki
// uzun gerekçe: ikisi ayrıştığında kullanıcı ya kilitlenir ya da yetkisi varmış gibi görünür).
async function canManageOfficeManagers(env, user, key) {
  if (user.role === 'admin') return true;
  const mine = await env.DB.prepare(
    `SELECT office_position AS position FROM profile_claims
      WHERE user_id = ? AND profile_type = 'office' AND status = 'approved' AND profile_key = ?`
  ).bind(user.id, key).first();
  if (mine && OFFICE_EDIT_POSITIONS.has(mine.position)) return true;
  return canEditOfficeViaFounderLink(env, user, key, OFFICE_EDIT_POSITIONS);
}

async function officeManagers(env, url, user) {
  const key = (url.searchParams.get('key') || '').trim();
  if (!key) return errorJson('Geçersiz istek.');
  if (!(await canManageOfficeManagers(env, user, key))) return errorJson('Bu firmanın yetkili kullanıcılarını göremezsin.', 403);
  const managers = await fetchOfficeManagers(env, key, OFFICE_EDIT_POSITIONS);
  // "DİĞER hesaplar" — isteği yapan kişi listede kendini görmez (kendi görevi zaten hemen
  // üstteki "Görevin" satırında yazıyor).
  return json({ items: managers.filter(m => m.userId !== user.id).map(m => ({ name: m.name, position: m.position, source: m.source })) });
}

// Yetki verildiğinde/kaldırıldığında, o firmanın TEKİL detay ucu + SSR HTML'i ve liste
// önbellekleri tazelenmeli — src/routes/admin.js#purgeClaimProfileCaches ile AYNI gerekçe:
// `claimed` bayrağı (kaynak ibaresi) ve rozet JOIN'leri doğrudan profile_claims'e bakar, detay ucu
// ise caches.default'ta 5 dakikalık s-maxage ile durur ve fingerprint taşımaz. Kurucuların kişi
// detayları BURADA purge EDİLMEZ (admin yolunun aksine): bu uç künyeye hiç dokunmadığından
// kurucu kartlarının içeriği değişmez.
async function invalidateClaimCaches(env, profileType, profileKey) {
  try {
    await purgeSsrDetailCache(profileType, profileKey, env);
    await invalidatePublicCache(env);
  } catch { /* önbellek temizliği yetkilendirme sonucunu ETKİLEMEZ: hata yutulur */ }
}

// DELETE /api/claims/office-link?key=<firma> — "Kaldır" düğmesi (kullanıcı isteği, 2026-09-12):
// yetkisi kaldırılmış bir kullanıcı, firmayı Hesabım > "Firma / Marka Bilgileri" kutusundan
// tamamen kaldırır.
//
// SATIR SİLİNMEZ, status='removed' olur. Silmek YANLIŞ olurdu: kurucu bağıyla yetkili olup yetkisi
// X ile alınmış bir kullanıcıda iptal kaydı O SATIRDIR (bkz. OFFICE_MANAGER_REVOKED) — satırı
// silmek yetkiyi sessizce GERİ VERİRDİ. 'removed' hem "yetkisi yok" hem "kutuda gösterme" demektir.
//
// KAPI: yalnızca ONAYLI OLMAYAN (yetkisiz) bir kayıt kaldırılabilir. Hâlâ yetkili bir kullanıcı
// firmayı gizleyemez — gizlediği hâlde düzenlemeye devam edebildiği, kendisinin de göremediği bir
// durum oluşurdu; önce yetkinin kaldırılması gerekir.
async function dismissOfficeLink(env, url, user) {
  const key = (url.searchParams.get('key') || '').trim();
  if (!key) return errorJson('Geçersiz istek.');
  const officeName = (await resolveCanonicalName(env, 'offices', key)) || key;
  const existing = await env.DB.prepare(
    `SELECT id, status FROM profile_claims WHERE user_id = ? AND profile_type = 'office' AND (profile_key = ?2 OR profile_key = ?3)`
  ).bind(user.id, officeName, key).first();
  if (existing && existing.status === 'approved') {
    return errorJson('Bu firmada hâlâ yetkilisin; önce yetkinin kaldırılması gerekiyor.', 409);
  }
  const now = Date.now();
  if (existing) {
    await env.DB.prepare('UPDATE profile_claims SET status = ?, updated_at = ? WHERE id = ?').bind(OFFICE_MANAGER_DISMISSED, now, existing.id).run();
  } else {
    // Kaydı olmayan (yalnızca kurucu bağıyla görünen) firma da kutudan kaldırılabilsin diye
    // 'removed' satırı açılır — bu aynı zamanda yetkiyi de kapatır (bkz. isOfficeManagerRevoked).
    await env.DB.prepare(
      `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, note, created_at, updated_at, office_position)
       VALUES (?, ?, 'office', ?, ?, ?, ?, ?, NULL)`
    ).bind(newId(), user.id, officeName, OFFICE_MANAGER_DISMISSED, 'Hesabım > kullanıcı kutudan kaldırdı', now, now).run();
  }
  return json({ ok: true });
}

// POST /api/claims/office-managers {key, email} — "+" düğmesi: e-postasıyla bir ÜYEYE bu firmanın
// içeriklerini yönetme yetkisi verir.
//
// Yetki kaydı, admin atamasının kullandığı AYNI satırdır (profile_claims, status='approved',
// office_position='Yönetici') — yeni bir yetki kavramı/tablosu yok, dolayısıyla düzenleme
// kapılarının hepsi (proje/ürün/künye/ilan) bu satırı olduğu gibi okur. Görev HER ZAMAN 'Yönetici':
// atama artık bir ÜNVAN değil, yalnızca yetkidir (kullanıcı isteği, 2026-09-12) — künyedeki
// Kurucular/Ekip listeleri buradan beslenmez (bkz. src/routes/office.js#buildOfficePeople).
async function grantOfficeManager(request, env, user) {
  const body = await readJson(request);
  const key = (body.key || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  if (!key || !email) return errorJson('Geçersiz istek.');
  if (!(await canManageOfficeManagers(env, user, key))) return errorJson('Bu firmaya yetkili kullanıcı ekleyemezsin.', 403);
  // Kayıtlı ÜYE zorunlu (kullanıcı kararı, 2026-09-12): davet/bekleyen kayıt tutulmaz, net bir
  // hata verilir — kişi önce üye olmalı.
  const target = await env.DB.prepare('SELECT id, name FROM users WHERE lower(email) = ?').bind(email).first();
  if (!target) return errorJson('Bu e-posta ile kayıtlı bir üye yok. Kişi önce MİMARLAB üyesi olmalı.', 404);
  // Firma gerçekten var mı + anahtar KANONİK ADA çevrilir (bkz. admin.js'deki AYNI gerekçe:
  // sahiplenmeyi adıyla sorgulayan her yerin beklediği biçim canonical `name`).
  const officeName = await resolveCanonicalName(env, 'offices', key);
  if (!officeName) return errorJson('Böyle bir firma bulunamadı.', 404);
  const now = Date.now();
  const existing = await env.DB.prepare(
    `SELECT id FROM profile_claims WHERE user_id = ? AND profile_type = 'office' AND profile_key = ?`
  ).bind(target.id, officeName).first();
  if (existing) {
    // Daha önce iptal edilmiş (status='revoked') ya da bekleyen bir satır varsa yetki geri verilir.
    await env.DB.prepare(
      `UPDATE profile_claims SET status = 'approved', office_position = ?, updated_at = ? WHERE id = ?`
    ).bind(MANAGER_POSITION, now, existing.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, note, created_at, updated_at, office_position)
       VALUES (?, ?, 'office', ?, 'approved', ?, ?, ?, ?)`
    ).bind(newId(), target.id, officeName, 'Hesabım > Yetkili Kullanıcılar', now, now, MANAGER_POSITION).run();
  }
  await invalidateClaimCaches(env, 'office', officeName);
  return json({ item: { name: target.name, position: MANAGER_POSITION, source: 'claim' } }, 201);
}

// DELETE /api/claims/office-managers?key=<firma>&name=<ad soyad> — "X" düğmesi: yetkiyi kaldırır.
//
// KÜNYEYE DOKUNMAZ (kullanıcı kararı, 2026-09-12: "bu X işareti kişileri bu popuplardan silmez").
// Bu yüzden office_founders/Kurucular-Ekip kutuları hiç değişmez; iptal profile_claims satırında
// status='revoked' olarak yaşar (bkz. src/lib/claimedProfiles.js#OFFICE_MANAGER_REVOKED) ve admin
// tarafından verilmiş bir yetkiyi de kapsar.
async function revokeOfficeManager(env, url, user) {
  const key = (url.searchParams.get('key') || '').trim();
  const name = (url.searchParams.get('name') || '').trim();
  if (!key || !name) return errorJson('Geçersiz istek.');
  if (!(await canManageOfficeManagers(env, user, key))) return errorJson('Bu firmanın yetkilerini değiştiremezsin.', 403);
  const officeName = await resolveCanonicalName(env, 'offices', key);
  if (!officeName) return errorJson('Böyle bir firma bulunamadı.', 404);
  // Üye adları benzersizdir (bkz. src/routes/auth.js kayıt kuralı) — yine de birden fazla satır
  // dönerse YANLIŞ kişinin yetkisini kaldırmaktansa işlemi reddetmek doğrudur.
  const { results } = await env.DB.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE').bind(name).all();
  if (!results || !results.length) return errorJson('Böyle bir üye bulunamadı.', 404);
  if (results.length > 1) return errorJson('Aynı ada sahip birden fazla üye var; bu satırdan kaldırılamaz.', 409);
  const targetId = results[0].id;
  if (targetId === user.id) return errorJson('Kendi yetkini buradan kaldıramazsın.', 400);
  const now = Date.now();
  const existing = await env.DB.prepare(
    `SELECT id FROM profile_claims WHERE user_id = ? AND profile_type = 'office' AND profile_key = ?`
  ).bind(targetId, officeName).first();
  if (existing) {
    await env.DB.prepare('UPDATE profile_claims SET status = ?, updated_at = ? WHERE id = ?').bind(OFFICE_MANAGER_REVOKED, now, existing.id).run();
  } else {
    // Kurucu bağıyla yetkili olan kullanıcı: ortada iptal edilecek bir satır yok, iptal KAYDI açılır.
    await env.DB.prepare(
      `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, note, created_at, updated_at, office_position)
       VALUES (?, ?, 'office', ?, ?, ?, ?, ?, ?)`
    ).bind(newId(), targetId, officeName, OFFICE_MANAGER_REVOKED, 'Hesabım > Yetkili Kullanıcılar (yetki kaldırıldı)', now, now, null).run();
  }
  await invalidateClaimCaches(env, 'office', officeName);
  return json({ ok: true });
}

async function createClaim(request, env, user) {
  // gerçek bulgu: bu uçta hiç hız sınırı yoktu — AYNI hedef için mükerrer satır oluşturulamasa da
  // (bkz. aşağıdaki 'existing' kontrolü) tek bir hesap FARKLI onlarca profil için ardı ardına talep
  // açıp admin "Profil Talepleri" kuyruğunu doldurabilirdi.
  if (!(await checkRateLimit(env, 'claim', user.id, 20, 60 * 60 * 1000))) {
    return errorJson('Çok fazla talep gönderdin. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }
  // bkz. handleCorrectionsRoute'daki AYNI ikili (kullanıcı + IP) desen/gerekçe.
  if (!(await checkRateLimit(env, 'claim-ip', clientIp(request), 60, 60 * 60 * 1000))) {
    return errorJson('Çok fazla talep gönderildi. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const profileType = body.profileType;
  const requestedKey = (body.profileKey || '').trim();
  const note = (body.note || '').trim().slice(0, 1000) || null;
  if (!PROFILE_TYPES.has(profileType) || !requestedKey) return errorJson('Geçersiz istek.');

  // gerçek bulgu (denetim, 2026-09-04): bu uç profileKey'in GERÇEKTEN bir canonical mimar/firma
  // satırına karşılık gelip gelmediğini hiç kontrol etmiyordu — POST /api/admin/claims'in (admin'in
  // doğrudan atama yolu) AYNI kontrolü ("Böyle bir profil bulunamadı.") zaten yaptığının aksine.
  // Uydurma bir profileKey ile (curl/bayat bir "Düzenle" linki) açılan talep admin kuyruğuna
  // düşüyor, onaylanırsa da hiçbir profile bağlı OLMAYAN kalıcı bir approved satır bırakıyordu:
  // düzenleme yetkisi vermez (verifyClaimedProfileKey canonical satırı bulamaz), Hesabım'da
  // slug/görsel'siz hayalet bir satır olarak görünür. Yerel veritabanında bu yolla oluşmuş
  // "Nonexistent Test Architect 1/2/3" satırları vardı.
  //
  // VE ANAHTAR KANONİK ADA ÇEVRİLİR (kullanıcı isteği, 2026-09-10). Eskiden yalnızca "var mı"
  // sorulup çağıranın gönderdiği anahtar AYNEN yazılıyordu; oysa bu kontrol name|slug|legacy_key'in
  // üçünü birden kabul ediyor, yani slug gönderen bir çağıran (bkz. js/components/preview-cards.js)
  // slug anahtarlı bir satır bırakıyordu. Profili adıyla sorgulayan her yer (popup'taki "Bu profil
  // sana mı ait?" kutusu, Düzenle butonu, rozet JOIN'leri) o satırı GÖREMİYOR, onaylı sahiplik
  // görünmez kalıyordu. Bkz. src/lib/canonicalRead.js#resolveCanonicalName.
  const profileKey = await resolveCanonicalName(env, CLAIM_CANONICAL_TABLE[profileType], requestedKey);
  if (!profileKey) {
    return errorJson('Böyle bir profil bulunamadı. Sayfayı yenileyip tekrar dene.', 404);
  }

  const existing = await env.DB.prepare(
    'SELECT id, status FROM profile_claims WHERE user_id = ? AND profile_type = ? AND profile_key = ?'
  ).bind(user.id, profileType, profileKey).first();

  if (existing) {
    if (existing.status === 'rejected') {
      await env.DB.prepare(
        "UPDATE profile_claims SET status = 'pending', note = ?, updated_at = ? WHERE id = ?"
      ).bind(note, Date.now(), existing.id).run();
      return json({ status: 'pending' });
    }
    return json({ status: existing.status });
  }

  const id = newId();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, profileType, profileKey, 'pending', note, now, now).run();

  return json({ status: 'pending' }, 201);
}

async function claimStatus(env, url, user) {
  const profileType = url.searchParams.get('profileType');
  const profileKey = (url.searchParams.get('profileKey') || '').trim();
  if (!PROFILE_TYPES.has(profileType) || !profileKey) return errorJson('Geçersiz istek.');

  const row = await env.DB.prepare(
    'SELECT status, office_position FROM profile_claims WHERE user_id = ? AND profile_type = ? AND profile_key = ?'
  ).bind(user.id, profileType, profileKey).first();

  // delegatedEdit — kullanıcı bu KİŞİ profilini kendi adına bir talebi olmadan, bir firmanın/markanın
  // yetkilisi olduğu için düzenleyebiliyor mu (kullanıcı isteği, 2026-09-08: firma ortaklarının
  // profillerini de düzenleyebilme). Sunucudaki ASIL kapı ile (src/routes/submissions.js#
  // verifyClaimedProfileKey) AYNI yardımcıdan gelir — istemci kuralı YENİDEN HESAPLAMAZ, aksi halde
  // ikisi ayrışıp "boş yere doldurulan form, sonra 403" durumu doğardı (bkz. denetim 2026-09-04).
  const delegatedEdit = (profileType === 'architect' && (!row || row.status !== 'approved'))
    ? await canEditArchitectViaOfficeMembership(env, user, profileKey, OFFICE_EDIT_POSITIONS)
    : false;

  // officePosition — bkz. dosya sonundaki AYNI gerekçe/myClaims: istemcinin "Düzenle" butonunu
  // sunucuyla AYNI değere (onay anında dondurulmuş pozisyon) göre gösterebilmesi için.
  return json({ status: row ? row.status : 'none', officePosition: row ? (row.office_position || null) : null, delegatedEdit });
}
