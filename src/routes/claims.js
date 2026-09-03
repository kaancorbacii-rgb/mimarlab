import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';
import { canonicalRowExistsByKey } from '../lib/canonicalRead.js';

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
  const { results } = await env.DB.prepare(
    'SELECT profile_type, profile_key, status, office_position AS officePosition FROM profile_claims WHERE user_id = ? ORDER BY updated_at DESC'
  ).bind(user.id).all();
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
  return json({ items });
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
  const profileKey = (body.profileKey || '').trim();
  const note = (body.note || '').trim().slice(0, 1000) || null;
  if (!PROFILE_TYPES.has(profileType) || !profileKey) return errorJson('Geçersiz istek.');

  // gerçek bulgu (denetim, 2026-09-04): bu uç profileKey'in GERÇEKTEN bir canonical mimar/firma
  // satırına karşılık gelip gelmediğini hiç kontrol etmiyordu — POST /api/admin/claims'in (admin'in
  // doğrudan atama yolu) AYNI kontrolü ("Böyle bir profil bulunamadı.") zaten yaptığının aksine.
  // Uydurma bir profileKey ile (curl/bayat bir "Düzenle" linki) açılan talep admin kuyruğuna
  // düşüyor, onaylanırsa da hiçbir profile bağlı OLMAYAN kalıcı bir approved satır bırakıyordu:
  // düzenleme yetkisi vermez (verifyClaimedProfileKey canonical satırı bulamaz), Hesabım'da
  // slug/görsel'siz hayalet bir satır olarak görünür. Yerel veritabanında bu yolla oluşmuş
  // "Nonexistent Test Architect 1/2/3" satırları vardı.
  if (!(await canonicalRowExistsByKey(env, CLAIM_CANONICAL_TABLE[profileType], profileKey))) {
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

  // officePosition — bkz. dosya sonundaki AYNI gerekçe/myClaims: istemcinin "Düzenle" butonunu
  // sunucuyla AYNI değere (onay anında dondurulmuş pozisyon) göre gösterebilmesi için.
  return json({ status: row ? row.status : 'none', officePosition: row ? (row.office_position || null) : null });
}
