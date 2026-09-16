import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { BADGE_RANK, getActiveSelfBadge, getPersonalAdminBadge, higherRankBadge } from '../lib/badgeAccess.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';
import { foldTr } from '../lib/textMatch.js';

// Fiyatlar TL/ay cinsinden (aylık abonelik); ödeme yöntemi havale/EFT (bkz. satin-al.html) —
// kredi/banka kartı (iyzico, bkz. src/routes/payments.js) henüz UI'da aktif değil. Havale
// talepleri burada 'pending' oluşturulur, admin havaleyi banka ekstresinden doğrulayıp panelden
// elle onaylar (bkz. src/routes/admin.js#handleBadgesAdmin). İki kademe satın alınabilir: verified
// (Doğrulanmış Üye), gold (Altın Üye) — bkz. badge-shared.js#BADGE_LABELS ile aynı anahtarlar.
// 'destekci' (Destekçi) ve 'platinum' (Elmas Üye) kullanıcı isteğiyle 2026-08-29'da satın alınabilir
// olmaktan çıkarıldı (bkz. BADGE_PRICES'ta artık yer almamaları — getBadgePrice bu tipler için
// undefined döner, createBadgeRequest bunu 'Geçersiz rozet türü.' olarak reddeder); eski durumdaki
// aktif kayıtlar aynı tarihte elle 'rejected' yapıldı (bkz. iade-et.html/admin.html — hâlâ o eski
// siparişleri ETİKETLEMEK için destekci/platinum'u BİLEREK içeriyorlar, ama artık hiçbiri satın
// alınamaz).
//
// BADGE_PRICES her kademe için "Kendim için" (self) ve "Bir firmam için" (office) fiyatlarını ayrı
// ayrı tutar (2026-08-29: kullanıcı isteğiyle sabit bir SELF_DISCOUNT_TRY yerine kademe başına
// bağımsız fiyatlara geçildi). Fiyat İSTEMCİDEN asla alınmaz/güvenilmez: hem havale
// (createBadgeRequest) hem iyzico (src/routes/payments.js#startCheckout) targetType'ı buradaki
// getBadgePrice() ile aynı tek noktadan hesaplar.
export const BADGE_PRICES = {
  verified: { self: 49, office: 129 },
  gold: { self: 99, office: 199 },
};

// Fiyat kademesi: firma profili için tier.office, KİŞİ profili için tier.self. Kolon adı 'self'
// olarak KALDI (fiyat tablosunun şekli değişmedi) ama anlamı artık "tek bir kişi profili" —
// hedef tipi 'self' 2026-09-16 yedinci turda kaldırıldı (bkz. normalizeTarget).
export function getBadgePrice(badgeType, targetType) {
  const tier = BADGE_PRICES[badgeType];
  if (!tier) return undefined;
  return targetType === 'office' ? tier.office : tier.self;
}

const BADGE_RENTAL_MS = 30 * 24 * 60 * 60 * 1000; // rozetler aylık kiralanır

// ÖDEME SEÇENEKLERİ — TEK KAYNAK (kullanıcı isteği, 2026-09-15 onuncu tur madde 2: "Rozet al
// sayfasında da ödemeye ilerlensin ama onda da şimdilik ödemeler kapalı olsun").
//
// Rozet Al ekranı artık bir ödeme adımına ilerliyor (bkz. js/components/info-modal.js#
// mountRozetAl). O adımın hangi yöntemi AÇIK göstereceğini SAYFA KARAR VERMEZ — burası söyler,
// yani satış açıldığında tek değişen yer yine sunucu olur. Biçim, danışmanlık akışının AYNI
// sözleşmesidir (src/routes/consultations.js#paymentOptions): her yöntem `enabled` + `note`.
//
// IBAN/havale kutusu BİLEREK YOK (kullanıcı isteği, 2026-09-08: "IBAN bilgilerini siteden sil") —
// havale satış yeniden açıldığında da geri GETİRİLMEMELİ, akış kart (payments.js) üzerinden kurulur.
//
// SATIŞI AÇMAK TEK SATIRLIK BİR BAYRAK DEĞİŞİKLİĞİ DEĞİLDİR: BADGE_SALES_OPEN=true yapmak sunucu
// kapılarını (createBadgeRequest, payments.js#startCheckout) açar, ama Rozet Al ekranındaki ödeme
// adımı bugün yalnızca yöntemleri GÖSTERİR — kart formu (ad/soyad/T.C./telefon/adres/şehir, bkz.
// payments.js#startCheckout doğrulamaları) ve POST /api/payments/checkout çağrısı o adımda henüz
// YOK, bu yüzden "Ödemeye Geç" düğmesi orada kural olarak pasiftir. Açarken ikisini birlikte kur.
export function badgePaymentOptions() {
  return {
    salesOpen: BADGE_SALES_OPEN,
    methods: [
      { method: 'havale', enabled: false, note: 'Henüz aktif değil.' },
      { method: 'iyzico', enabled: BADGE_SALES_OPEN, note: BADGE_SALES_OPEN ? '' : 'Henüz aktif değil.' },
    ],
  };
}

export async function handleBadgesRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "badges", maybe "mine"]

  // Oturum kapısından ÖNCE: Rozet Al ekranı giriş YAPILMADAN da görüntülenebilir (kullanıcı isteği,
  // 2026-09-05) ve ödeme adımını da o hâliyle gösterir. Yanıtta kullanıcıya ait hiçbir bilgi yok.
  if (segments.length === 3 && segments[2] === 'options' && request.method === 'GET') {
    return json(badgePaymentOptions());
  }

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'POST') return createBadgeRequest(request, env, user);
  if (segments.length === 3 && segments[2] === 'mine' && request.method === 'GET') return listMyBadges(env, user);
  // ROZET ALINABİLİR HEDEFLER (kullanıcı isteği, 2026-09-16 yedinci tur madde 7) — Rozet Al
  // ekranının hedef listelerinin TEK kaynağı. Liste, satın alma kapısının TA KENDİSİNDEN
  // (userManagedOfficeNames / userManagedArchitectNames) türetilir: ekran kendi kuralını
  // hesaplamaz, yoksa "listede görünen ama sunucunun reddettiği" bir hedef ortaya çıkardı
  // (danismanlik.html#ALLOWED_HOST_SLUGS ile AYNI gerekçe).
  if (segments.length === 3 && segments[2] === 'targets' && request.method === 'GET') return listBadgeTargets(env, user);
  if (segments.length === 3 && request.method === 'DELETE') return deleteRejectedBadgeRequest(env, user, segments[2]);
  return errorJson('Bulunamadı', 404);
}

// Bir kişi, aynı hedef (target_type+target_key) için aynı anda yalnızca 1 rozet tutabilir:
// hâlihazırda süresi dolmamış aktif bir rozeti o hedef için varsa yeni talep reddedilir; bekleyen
// (henüz onaylanmamış) bir talebi o hedef için varsa yeni seçimiyle değiştirilir. Farklı hedefler
// (kendisi + her ayrı marka) birbirinden bağımsızdır — kendisi için rozet alması bir markaya
// otomatik yansımaz, bkz. handlePublicBadges.
// HEDEF ARTIK HER ZAMAN BİR PROFİLDİR (kullanıcı isteği, 2026-09-16 yedinci tur madde 7: "Bir
// kullanıcı rozeti sadece kişi profilleri ya da firma profilleri için alabilsin, kullanıcı
// hesapları için rozet alınamasın").
// 'self' KALDIRILDI: o hedef HESABA (users satırına) rozet veriyordu ve profilde ancak dolaylı
// olarak (kullanıcının onaylı architect claim'i üzerinden, bkz. computeBadgesPayload) görünüyordu.
// Yerine 'architect' geldi ve KİŞİ KÜNYESİNİN ADIYLA anahtarlanır — 'office' ile birebir aynı
// desen. Bu, "Hesap üyeliği ile kişi profili AYRIDIR" kuralının rozet tarafındaki karşılığıdır.
// ESKİ 'self' SATIRLARI SİLİNMEDİ ve okunmaya devam eder (bkz. computeBadgesPayload) — yalnızca
// YENİ talep açılamaz.
export function normalizeTarget(body) {
  const targetType = body.targetType === 'office' ? 'office' : (body.targetType === 'architect' ? 'architect' : null);
  if (!targetType) return null;
  const targetKey = (body.targetKey || '').trim();
  if (!targetKey) return null;
  return { targetType, targetKey };
}

// KULLANICININ ONAYLI SAHİPLENDİĞİ FİRMA ADLARI — rozet hedefi kapısının tek temeli.
export async function userManagedOfficeNames(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT profile_key FROM profile_claims WHERE user_id = ? AND profile_type = 'office' AND status = 'approved'`
  ).bind(userId).all();
  return (results || []).map(r => r.profile_key).filter(Boolean);
}

// Yönetilen firmalardaki KİŞİLER (kullanıcı isteği, 2026-09-16 yedinci tur madde 7: "Kullanıcı
// sadece sitede yönetici olduğu firmaya ve bu firmadaki kişilere rozet alabilsin").
// Kaynak office_founders — firmanın TEK YAPISAL kişi bağı (bkz. src/routes/office.js#
// buildOfficePeople: Kurucular/Ortaklar VE Ekip listelerinin ikisi de bu tablodan türer, yalnızca
// göreve göre ayrılır) + architects.office_id (kişinin "birincil firma" alanı). Künyenin
// Kurucular/Ekip kutusuna SERBEST METİN olarak yazılmış, canonical bir kişi kaydı OLMAYAN adlar
// bilerek kapsam dışı: rozet ADLA anahtarlı bir profile verilir, karşılığı olmayan bir ada verilen
// rozet hiçbir yerde görünmezdi (ölü satın alma).
export async function userManagedArchitectNames(env, userId) {
  const officeNames = await userManagedOfficeNames(env, userId);
  if (!officeNames.length) return [];
  const placeholders = officeNames.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT ar.name FROM architects ar
       JOIN offices o ON o.deleted_at IS NULL AND o.name IN (${placeholders})
     WHERE ar.deleted_at IS NULL
       AND (EXISTS (SELECT 1 FROM office_founders f WHERE f.office_id = o.id AND f.architect_id = ar.id)
            OR ar.office_id = o.id)`
  ).bind(...officeNames).all();
  return (results || []).map(r => r.name).filter(Boolean);
}

// Rozet hedefi kapısı — satın alma (createBadgeRequest) ve kart ödemesi (payments.js#startCheckout)
// AYNI fonksiyonu çağırır, yani iki yol ayrışamaz.
//   'office'    — kullanıcının o firmayı onaylı şekilde sahiplenmesi gerekir (2026-09-01'den beri
//                 geçerli kural, DEĞİŞMEDİ).
//   'architect' — kişi, kullanıcının yönettiği firmalardan birinin kişisi olmalı (madde 7).
// Eşleşme foldTr ile: rozet anahtarı canonical addır, kullanıcının gönderdiği yazım (büyük/küçük
// harf, Türkçe karakter) farklı olabilir — sitenin her yerindeki "aynı ad" tanımı budur.
export async function verifyBadgeTargetOwnership(env, userId, target) {
  const names = target.targetType === 'office'
    ? await userManagedOfficeNames(env, userId)
    : await userManagedArchitectNames(env, userId);
  const key = foldTr(target.targetKey || '');
  return names.some(n => foldTr(n) === key);
}

// Kullanıcının onaylı sahiplendiği HER profilde (kendisi + firmaları) O AN GÖRÜNEN rozet.
// "Rozet Al"/"İade Et" ekranlarının "halihazırda olan rozeti algılamıyor" kök nedeni buydu
// (kullanıcı isteği, 2026-09-01 madde 3): o ekranlar rozeti İKİ ayrı yerden, birbirinden habersiz
// arıyordu — kullanıcının KENDİ badge_requests satırları (myBadges) ve admin_badges (adminBadges).
// Bu ikisi bir profildeki rozeti tanımlamaya YETMİYOR:
//   • firmanın rozetini başka bir ortak (aynı firmayı onaylı sahiplenmiş BAŞKA bir user_id) satın
//     almış olabilir — o satır bu kullanıcının myBadges'inde YOK ama rozet firma profilinde görünür;
//   • aynı profile bağlı birden fazla aktif satın alma varsa profilde yalnızca EN YÜKSEK kademe
//     görünür, admin_badges varsa hepsinin YERİNİ alır.
// Bu yüzden karar tek bir yerde, profilde gerçekten ne göründüğünü hesaplayan computeBadgesPayload
// üzerinden verilir — böylece "profilde görünen rozet" ile "satın alma ekranının engellediği rozet"
// aynı kaynaktan gelir, ikisi bir daha ayrışamaz.
export async function getProfileBadgesForUser(env, userId) {
  const out = { self: null, selfKey: null, offices: {} };
  const { results: claims } = await env.DB.prepare(
    `SELECT profile_type, profile_key FROM profile_claims WHERE user_id = ? AND status = 'approved' AND profile_type IN ('architect', 'office')`
  ).bind(userId).all();
  if (!claims.length) return out;
  const payload = await computeBadgesPayload(env);
  for (const c of claims) {
    const bucket = payload[c.profile_type];
    const badge = bucket && bucket[c.profile_key] ? bucket[c.profile_key][0] : null;
    if (!badge) continue;
    if (c.profile_type === 'office') { out.offices[c.profile_key] = badge; continue; }
    // Birden fazla onaylı mimar profili teoride mümkün — en yüksek kademeli olan kazanır (BADGE_RANK
    // dışı/özel bir admin rozeti Infinity'e düşer, bkz. getBlockingRank'teki AYNI gerekçe).
    if (!out.self || (BADGE_RANK[badge] ?? Infinity) > (BADGE_RANK[out.self] ?? Infinity)) {
      out.self = badge;
      out.selfKey = c.profile_key;
    }
  }
  return out;
}

// Aktif badge_requests kaydı + profilde görünen rozeti (bkz. getProfileBadgesForUser) TEK bir
// kademeye indirger — createBadgeRequest ve payments.js#startCheckout aynı satırı çağırıp sonucu
// BADGE_RANK ile karşılaştırır. Bilinmeyen/eski bir tip (ör. 'platinum', 'destekci', 'iz-birakan' —
// artık BADGE_RANK'te yok) kasıtlı olarak Infinity'e düşer: admin özel bir rozet atadıysa
// self-servis satın alma bunun üzerine hiçbir kademeyle geçemez.
export async function getBlockingRank(env, userId, target) {
  const now = Date.now();
  const active = await env.DB.prepare(
    `SELECT badge_type FROM badge_requests WHERE user_id = ? AND target_type = ? AND target_key IS ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`
  ).bind(userId, target.targetType, target.targetKey, now).first();
  // Hedef PROFİLDE o an görünen rozet (2026-09-16 yedinci tur madde 7): hedef artık her zaman bir
  // profil olduğundan karar doğrudan profil rozeti haritasından okunur. Eski hâl 'self' hedefi için
  // getProfileBadgesForUser().self'e bakıyordu — yani KULLANICININ kendi künyesindeki rozete; artık
  // hedef başka bir kişi (yönettiği firmanın bir üyesi) olabildiğinden o kaynak yanlış profili
  // okurdu. computeBadgesPayload, satın alınan + admin_badges'i zaten birleştiren TEK kaynaktır.
  const payload = await computeBadgesPayload(env);
  const bucket = target.targetType === 'office' ? payload.office : payload.architect;
  const list = bucket && bucket[target.targetKey];
  const profileBadgeType = (list && list.length) ? list[0] : null;
  const activeRank = active ? (BADGE_RANK[active.badge_type] || 0) : 0;
  const profileRank = profileBadgeType ? (BADGE_RANK[profileBadgeType] ?? Infinity) : 0;
  return Math.max(activeRank, profileRank);
}

// Rozet satışı KAPALI (kullanıcı isteği, 2026-09-08: "şimdilik ödeme almıyoruz"). UI'daki havale/
// EFT kutusu ve "Ödemeyi Yaptım" butonu kaldırıldı; bu bayrak, eski JS'i önbellekten çalıştıran
// ya da ucu doğrudan çağıran bir istemcinin yine de 'pending' talep açmasını engeller. Satış
// yeniden açıldığında true yapılmalı — ama havale değil, kart akışı (payments.js) kurulmalı.
export const BADGE_SALES_OPEN = false;

// Her hedefin O AN GÖRÜNEN rozeti de döner: "zaten bu rozetin var" panelinin kaynağı da bu uç
// olur, böylece ekranın engellediği rozet ile sunucunun (getBlockingRank) engellediği rozet AYNI
// veriden gelir. Eskiden o panel kişi hedefleri için hiçbir kaynağa sahip değildi
// (/api/badges/mine#profileBadges yalnızca KULLANICININ KENDİ sahiplendiği profilleri taşır,
// yönettiği firmadaki BAŞKA kişileri taşımaz).
async function listBadgeTargets(env, user) {
  const [officeNames, architectNames, payload] = await Promise.all([
    userManagedOfficeNames(env, user.id),
    userManagedArchitectNames(env, user.id),
    computeBadgesPayload(env),
  ]);
  const shape = (names, bucket) => names.map(key => {
    const list = bucket && bucket[key];
    return { key, badge: (list && list.length) ? list[0] : null };
  });
  return json({
    offices: shape(officeNames, payload.office),
    architects: shape(architectNames, payload.architect),
  });
}

async function createBadgeRequest(request, env, user) {
  if (!BADGE_SALES_OPEN) return errorJson('Rozet satışı şu an açık değil.', 403);
  // gerçek bulgu: bu havale/EFT yolunda hiç hız sınırı yoktu — aynı özelliğin kart ödemesi
  // karşılığı (payments.js#startCheckout) hem kullanıcı hem IP bazlı limit uyguluyor, buradaki
  // DELETE+INSERT pending döngüsü (bkz. aşağısı) sınırsız tekrarlanabiliyordu. AYNI oranlar.
  if (!(await checkRateLimit(env, 'badge-request', user.id, 8, 60 * 60 * 1000))) {
    return errorJson('Çok fazla talep gönderdin. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }
  if (!(await checkRateLimit(env, 'badge-request-ip', clientIp(request), 20, 60 * 60 * 1000))) {
    return errorJson('Çok fazla talep gönderdin. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const badgeType = body.badgeType;
  const target = normalizeTarget(body);
  if (!target) return errorJson('Geçersiz hedef.');
  const price = getBadgePrice(badgeType, target.targetType);
  if (price === undefined) return errorJson('Geçersiz rozet türü.');
  if (!(await verifyBadgeTargetOwnership(env, user.id, target))) {
    return errorJson(target.targetType === 'office'
      ? 'Bu firmayı önce onaylı şekilde sahiplenmen gerekiyor.'
      : 'Rozet yalnızca yönettiğin firmalardaki kişi profilleri için alınabilir.');
  }

  const now = Date.now();
  // bkz. src/routes/payments.js#startCheckout — aynı yükseltme/düşürme kuralı, artık admin_badges'i
  // de kapsıyor (bkz. getBlockingRank).
  const blockingRank = await getBlockingRank(env, user.id, target);
  if (blockingRank > 0 && (BADGE_RANK[badgeType] || 0) <= blockingRank) {
    return errorJson('Bu hedef için zaten aktif bir rozetin var. Aynı ya da daha düşük bir kademeye geçemezsin — bunun için mevcut rozetinin süresi dolmalı. Daha yüksek bir kademeye hemen yükseltebilirsin.');
  }

  await env.DB.prepare(
    `DELETE FROM badge_requests WHERE user_id = ? AND target_type = ? AND target_key IS ? AND status = 'pending'`
  ).bind(user.id, target.targetType, target.targetKey).run();

  const id = newId();
  await env.DB.prepare(
    "INSERT INTO badge_requests (id, user_id, badge_type, target_type, target_key, status, price_try, created_at, updated_at, payment_provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'havale')"
  ).bind(id, user.id, badgeType, target.targetType, target.targetKey, 'pending', price, now, now).run();

  return json({ id, status: 'pending' }, 201);
}

async function listMyBadges(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT id, badge_type, target_type, target_key, status, price_try, expires_at, created_at FROM badge_requests WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();
  const adminBadges = await getAdminBadgesForUser(env, user.id);
  // effectivePersonalBadge: bu kullanıcının, KENDİSİ olarak (bir yorumda/gönderi bylinesinde ya da
  // "Mesaj Gönder" yetkisinde — bkz. badge-shared.js#myEffectiveBadge) taşıdığı en yüksek kademeli
  // rozet. src/routes/comments.js/ownerByline.js'teki AYNI birleştirme kuralı: kendi satın aldığı
  // (self) rozet + Kurucu/Ortak vb. olduğu bir firmanın admin rozeti arasından en yükseği.
  const effectivePersonalBadge = higherRankBadge(await getActiveSelfBadge(env, user.id), await getPersonalAdminBadge(env, user.id));
  // profileBadges — Rozet Al/İade Et ekranlarının kullandığı TEK kaynak (bkz.
  // getProfileBadgesForUser): kullanıcının sahiplendiği profillerde O AN GÖRÜNEN rozet, kimin
  // satın aldığından bağımsız. adminBadges bunun bir ALT kümesidir ve yalnızca auth-modal.js'deki
  // "admin tarafından verildi" satırını ayırt edebilmek için ayrıca döndürülmeye devam eder.
  const profileBadges = await getProfileBadgesForUser(env, user.id);
  return json({ items: results, adminBadges, profileBadges, effectivePersonalBadge });
}

// Reddedilen bir talebi kalıcı olarak siler (kullanıcı isteği: "Rozet Ayrıcalıklarından
// Faydalan" kutusundaki REDDEDİLDİ satırların yanına silme X'i eklensin) — yalnızca kendi
// 'rejected' kayıtlarını silebilir, 'pending'/'active' kayıtlar bu uçtan asla silinemez.
async function deleteRejectedBadgeRequest(env, user, id) {
  const row = await env.DB.prepare(
    `SELECT id FROM badge_requests WHERE id = ? AND user_id = ? AND status = 'rejected'`
  ).bind(id, user.id).first();
  if (!row) return errorJson('Bulunamadı', 404);
  await env.DB.prepare(`DELETE FROM badge_requests WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

// Kullanıcının onaylı sahiplendiği TÜM profiller (kendisi + firmaları) üzerinden admin'in
// doğrudan verdiği rozetleri döner — /api/badges/mine bunu satın alma ekranlarının (satin-al.html,
// info-modal.js#mountRozetAl, auth-modal.js'deki Rozet kutusu) "zaten bu rozetin var" kontrolüne
// admin_badges'i de katabilmesi için taşır (bkz. getProfileBadgesForUser, aynı mantığın tek hedefli
// hali — sunucu tarafı satın alma kontrolünde kullanılıyor).
async function getAdminBadgesForUser(env, userId) {
  const { results: claims } = await env.DB.prepare(
    `SELECT profile_type, profile_key FROM profile_claims WHERE user_id = ? AND status = 'approved' AND profile_type IN ('architect', 'office')`
  ).bind(userId).all();
  const out = { self: null, offices: {} };
  const architectKeys = claims.filter(c => c.profile_type === 'architect').map(c => c.profile_key);
  const officeKeys = claims.filter(c => c.profile_type === 'office').map(c => c.profile_key);
  if (architectKeys.length) {
    const placeholders = architectKeys.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT badge_type FROM admin_badges WHERE profile_type = 'architect' AND profile_key IN (${placeholders})`
    ).bind(...architectKeys).all();
    if (results.length) out.self = results[0].badge_type;
  }
  if (officeKeys.length) {
    const placeholders = officeKeys.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT profile_key, badge_type FROM admin_badges WHERE profile_type = 'office' AND profile_key IN (${placeholders})`
    ).bind(...officeKeys).all();
    for (const row of results) out.offices[row.profile_key] = row.badge_type;
  }
  return out;
}

// GET /api/public/badges — auth gerektirmez. 'self' hedefli rozetler yalnızca o kişinin onaylı
// ARCHITECT profil talebine bağlanır; 'office' hedefli rozetler yalnızca target_key'in birebir
// eşleştiği, o kişinin onaylı OFFICE profil talebine bağlanır — bir kişinin kendisi için aldığı
// rozet artık bir markaya sızmaz (ve tersi), bkz. kullanıcı talebi. Kişisel rozetlerin
// yorum/gönderi yanında gösterimi ayrı bir mekanizma (bkz. src/routes/comments.js, public.js),
// bu uç yalnızca mimar/marka PROFİL sayfalarını besler. 'destekci' kasıtlı olarak dışarıda
// bırakılır — o kademe herhangi bir hak ya da görünür rozet vermez, yalnızca destek amaçlıdır.
// gecikme geçmişi (2026-08-16): bu uç bir ara publicCache.js#CACHEABLE_PATHS'teydi (caches.default
// edge önbelleği + invalidatePublicCache() ile temizleniyordu) — ama o önbellek PoP-başınadır,
// admin farklı bir PoP'tan hemen sonra kontrol ederse en fazla s-maxage kadar eski rozeti görmeye
// devam edebiliyordu (kullanıcı isteği: "hangi rozeti verirsem vereyim HEMEN her rozet alanında
// gözükmesi gerekiyor" bunu kabul etmiyor). Artık publicCache.js#BADGE_NO_CACHE_HEADERS ile
// bilerek edge/tarayıcı önbelleğinin DIŞINDA tutuluyor (cachedPublicJson içinde pathname'e göre
// zorlanıyor) — sorgu iki küçük indeksli JOIN'den ibaret olduğundan önbelleksiz her istekte
// çalıştırılabilecek kadar hafif, stampede koruması yine withSingleFlight ile sağlanıyor.
export async function handlePublicBadges(request, env, url) {
  return cachedPublicJson(request, env, url.pathname, () => computeBadgesPayload(env));
}

async function computeBadgesPayload(env) {
  const now = Date.now();
  const [{ results }, { results: directResults }, { results: adminResults }] = await Promise.all([
    env.DB.prepare(
      `SELECT c.profile_type, c.profile_key, b.badge_type
       FROM profile_claims c
       JOIN badge_requests b ON b.user_id = c.user_id AND b.status = 'active' AND (b.expires_at IS NULL OR b.expires_at > ?) AND b.badge_type != 'destekci'
         AND ((b.target_type = 'self' AND c.profile_type = 'architect') OR (b.target_type = 'office' AND c.profile_type = 'office' AND b.target_key = c.profile_key))
       WHERE c.status = 'approved'`
    ).bind(now).all(),
    // KİŞİ HEDEFLİ ROZETLER, SAHİPLENME JOIN'İ OLMADAN (kullanıcı isteği, 2026-09-16 yedinci tur
    // madde 7: "Kullanıcı sadece ... yönetici olduğu firmaya ve bu firmadaki kişilere rozet
    // alabilsin").
    // NEDEN AYRI SORGU: yukarıdaki JOIN, rozetin SATIN ALANIN onaylı sahiplendiği bir profile
    // ait olmasını şart koşar. Bu yeni akışta satın alan kişi TANIMI GEREĞİ hedefin sahibi
    // değildir (firma yöneticisi, firmasındaki BİR BAŞKASI için alır) — o JOIN hiç eşleşmez ve
    // rozet hiçbir yerde görünmeyen ölü bir satın almaya dönüşürdü.
    // Yetki kapısı satın alma anındadır (verifyBadgeTargetOwnership); burada anahtar doğrudan
    // hedefin ADIDIR — admin_badges ile AYNI desen. Kabul edilen ödünleşme: yönetici yetkisi
    // sonradan iptal edilse bile satın alınmış rozet süresi dolana kadar (expires_at) profilde
    // kalır. Alternatifi, herkese açık ve ÖNBELLEKSİZ olan bu uçta satır başına bir üyelik
    // sorgusu koşturmaktı. ESKİ 'self' satırları yukarıdaki sorguda AYNEN okunmaya devam eder
    // (davranış değişmedi) — 'office' de öyle.
    env.DB.prepare(
      `SELECT target_key AS profile_key, badge_type FROM badge_requests
        WHERE target_type = 'architect' AND status = 'active'
          AND (expires_at IS NULL OR expires_at > ?) AND badge_type != 'destekci'`
    ).bind(now).all(),
    // Admin'in sahiplenme/satın alma olmadan doğrudan verdiği rozetler (bkz. schema.sql#admin_badges) —
    // yukarıdaki satın alınan rozetlerle AYNI çıktı şekline birleştirilir, statik/sahipsiz bir
    // profile bile uygulanabilir (kullanıcı isteği: admin mimar/marka profiline rozet ekleyebilsin).
    env.DB.prepare(`SELECT profile_type, profile_key, badge_type FROM admin_badges`).all(),
  ]);

  // Bir profilin AYNI ANDA birden fazla rozeti asla gösterilmez (kullanıcı isteği: "hiçbir zaman
  // bir kullanıcıya 2 rozet verilemesin"). Önce satın alınan rozetlerden profil başına TEK
  // (en yüksek kademeli) rozeti seçiyoruz — teoride aynı profile bağlı birden fazla onaylı
  // profile_claims farklı kullanıcılardan farklı aktif rozetler getirebilir, o durumda bile tek
  // kazanan olmalı.
  const purchased = { architect: {}, office: {} };
  const addPurchased = (profileType, profileKey, badgeType) => {
    const bucket = purchased[profileType];
    if (!bucket || !profileKey) return;
    const current = bucket[profileKey];
    if (!current || (BADGE_RANK[badgeType] || 0) > (BADGE_RANK[current] || 0)) bucket[profileKey] = badgeType;
  };
  for (const row of results) addPurchased(row.profile_type, row.profile_key, row.badge_type);
  // Kişi hedefli satın almalar (bkz. directResults) AYNI "profil başına en yüksek kademe" kuralına
  // girer — iki kaynak tek kovada birleşir, yani bir profilde asla iki rozet görünmez.
  for (const row of directResults) addPurchased('architect', row.profile_key, row.badge_type);

  const out = { architect: {}, office: {} };
  for (const type of ['architect', 'office']) {
    for (const key of Object.keys(purchased[type])) out[type][key] = [purchased[type][key]];
  }
  // Admin'in sahiplenme/satın alma olmadan doğrudan verdiği rozet (bkz. schema.sql#admin_badges)
  // satın alınan rozetin YERİNİ alır, YANINA eklenmez — admin bir profile rozet ver/değiştir/
  // kaldır dediğinde bu, o profilde görünen TEK rozeti belirler (kullanıcı isteği: "admin rozeti
  // değiştiğinde her yerden rozet değişsin"; "İz Bırakan" artık ayrı bir özel durum değil, bu
  // genel override kuralının bir örneği — vefat etmiş bir mimar hem aktif ödemeli bir üyelik
  // rozetine sahip OLABİLİR hem de admin onu İz Bırakan işaretleyebilir, override kuralı zaten
  // yalnızca İz Bırakan'ın görünmesini sağlar).
  for (const row of adminResults) {
    const bucket = out[row.profile_type];
    if (!bucket) continue;
    bucket[row.profile_key] = [row.badge_type];
  }
  return out;
}
