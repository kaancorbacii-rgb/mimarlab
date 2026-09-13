// SENİN İÇİN — GET /api/foryou (kullanıcı isteği, 2026-09-13: "Ana sayfada carosellerden sonra
// 'Senin İçin' … ama SADECE GİRİŞ YAPAN kullanıcılar için").
//
// ===============================================================================================
// ALGORİTMA (kullanıcı isteği, 2026-09-13 ikinci tur)
// ===============================================================================================
// "Kullanıcıların TAKİP ETTİKLERİ, KAYDETTİKLERİ, BEĞENDİKLERİ, PAYLAŞTIKLARI, YORUM YAPTIKLARI
//  içeriklere BENZER ama BUNLARIN AYNISI OLMAYAN içerikler."
//
// Beş sinyalin tamamı okunur ve iki ayrı işe yarar:
//   (a) TOHUM — "bu kullanıcı kimlerle/nelerle ilgileniyor?" sorusunun cevabı,
//   (b) DIŞLAMA — etkileşim kurulmuş İÇERİĞİN KENDİSİ sonuçtan çıkarılır. Bu, isteğin "bunların
//       aynısı olmayan" kısmıdır ve tek bir yerde değil, HER rafta uygulanır (bkz. notInteracted()).
//
//   Sinyal              Tablo            Tohum olarak                    Dışlama olarak
//   ─────────────────── ──────────────── ─────────────────────────────── ────────────────────────
//   Takip ettikleri     follows          mimar/firma id (ref_id)         —
//   Kaydettikleri       saved_items      proje/ürün + mimar/firma        o proje/ürün
//   Beğendikleri        ratings          proje/ürün + mimar/firma        o proje/ürün
//   Paylaştıkları       shared_items     proje/ürün + mimar/firma        o proje/ürün
//   Yorum yaptıkları    comments         proje + mimar/firma             o proje
//
// Beş raf üretilir ve HARMANLANIR (bkz. aşağıdaki interleave); rafları arka arkaya eklemek ilk
// rafın kutunun tamamını doldurmasına ve diğer sinyallerin hiç görünmemesine yol açardı:
//   A. Tohum profillerin (takip + diğer etkileşimler) projeleri
//   B. Tohum firmaların/markaların ürünleri
//   C. Etkileşim kurulan projelerin tasarımcılarından DİĞER projeler
//   D. Etkileşim kurulan ürünlerin markasından DİĞER ürünler
//   E. Doldurucu: MİMARLAB'da yeni (hiç sinyali olmayan üyede kutu boş kalmasın)
//
// DOĞAL ANAHTAR EŞLEŞTİRMESİ: ratings/comments/shared_items/saved_items hedefi bir SLUG değil,
// "doğal anahtar" ile tutar — mimar/firmada ham ad, slug ya da legacy_key olabilir; projede slug
// ya da legacy_key (bkz. src/lib/canonicalSync.js#findCanonicalRowByNaturalKey). Bu yüzden her
// eşleştirme o fonksiyonun baktığı KOLONLARIN AYNISINA bakar. Yalnızca `slug`e bakmak, kaydetme
// widget'larının slugify(name) yazdığı satırları sessizce ıskalardı (o dosyadaki 2026-08-28
// gerçek bulgusunun aynısı).
//
// JSON ALAN EŞLEŞTİRMESİ BİLEREK YOK: projects.type/category JSON metin olarak tutuluyor ve
// json_each() geçersiz JSON'da HATA fırlatır (tablo-değerli fonksiyon; AND kısa devresi kurtarmaz).
// Tek bir bozuk satır ana sayfayı 500'e düşürürdü. Her raf yalnızca tamsayı FK'ler üzerinden kurulu
// — "aynı ofisten" sinyali "aynı tipte"den zaten daha güçlü ve kullanıcıya AÇIKLANABİLİR.
//
// ÖNBELLEK: yanıt kullanıcıya özeldir — private, no-store, Vary: Cookie (bkz. analytics.js'teki
// AYNI karar: "kullanıcılar arasında veri sızıntısı kesinlikle olmasın").
import { json, errorJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
// Kart karuselindeki görsel sayısı ve ürün kaydetme anahtarı proje/ürün liste kartlarıyla ORTAK
// tek kaynaktan gelir — ikinci bir kopya sessizce ayrışır (bkz. o dosyalardaki gerekçeler).
import { CARD_CAROUSEL_IMAGES } from '../lib/projectPool.js';
import { ratingKeyFor } from './product.js';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Cookie' };

// Ana sayfadaki kutunun taşıdığı kart sayısı. İstemci de aynı varsayılanı kullanır (bkz.
// index.html#FORYOU_LIMIT).
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 24;
// Her raftan çekilen en fazla aday. Raf başına tavan, tek bir rafın (ör. 200 projesi olan bir ofisi
// takip eden üye) kutunun tamamını doldurmasını engeller.
const PER_RAIL = 8;
// Sinyal tablolarından okunan en fazla satır. Çok aktif bir üyenin binlerce satırını JSON bind
// parametresine çevirmek hem sorguyu hem belleği şişirirdi; en yeni N etkileşim zaten güncel
// ilgiyi temsil eder.
const SIGNAL_LIMIT = 200;

// Sinyal tablolarındaki tür adları tek tip değil: saved/shared 'material'ı ayrı bir tür olarak
// yazar, ratings da öyle; ama ikisi de products tablosunda yaşar (products.kind).
const PROJECT_TYPES = new Set(['project']);
const PRODUCT_TYPES = new Set(['product', 'material']);
const PROFILE_TYPES = new Set(['architect', 'office']);

export async function handleForYouRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404, PRIVATE_HEADERS);

  // GİRİŞ ŞARTI — kullanıcı isteğinin kendisi ("sadece giriş yapan kullanıcılar için"). İstemci
  // 401'i "giriş çağrısı kutusunu göster" diye okur (bkz. index.html#renderForYouCta), hata olarak
  // DEĞİL; bu yüzden 401 burada normal bir akış sonucudur.
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Giriş gerekli.', 401, PRIVATE_HEADERS);

  const limit = clampLimit(url.searchParams.get('limit'));
  const J = arr => JSON.stringify(arr);

  // -------------------------------------------------------------------------------------------
  // 1. TUR — beş sinyal, tek batch.
  // -------------------------------------------------------------------------------------------
  const [followRows, savedRows, ratingRows, shareRows, commentRows] = await env.DB.batch([
    env.DB.prepare(
      `SELECT followed_type, followed_key, followed_ref_id
       FROM follows WHERE user_id = ? AND followed_ref_id IS NOT NULL`
    ).bind(user.id),
    env.DB.prepare(
      `SELECT item_type AS t, item_key AS k FROM saved_items
       WHERE user_id = ? ORDER BY created_at DESC LIMIT ${SIGNAL_LIMIT}`
    ).bind(user.id),
    env.DB.prepare(
      `SELECT target_type AS t, target_id AS k FROM ratings
       WHERE user_id = ? ORDER BY updated_at DESC LIMIT ${SIGNAL_LIMIT}`
    ).bind(user.id),
    env.DB.prepare(
      `SELECT item_type AS t, item_key AS k FROM shared_items
       WHERE user_id = ? ORDER BY created_at DESC LIMIT ${SIGNAL_LIMIT}`
    ).bind(user.id),
    env.DB.prepare(
      `SELECT target_type AS t, target_id AS k FROM comments
       WHERE user_id = ? ORDER BY created_at DESC LIMIT ${SIGNAL_LIMIT}`
    ).bind(user.id),
  ]);

  // Dört sinyalin satır şekli AYNI ({t, k}) olduğu için tek bir döngüde toplanabiliyor.
  const projectKeys = new Set();
  const productKeys = new Set();
  const profileKeys = new Set();
  for (const rows of [savedRows, ratingRows, shareRows, commentRows]) {
    for (const r of rows.results || []) {
      const t = r.t, k = r.k;
      if (!k) continue;
      if (PROJECT_TYPES.has(t)) projectKeys.add(k);
      else if (PRODUCT_TYPES.has(t)) productKeys.add(k);
      else if (PROFILE_TYPES.has(t)) profileKeys.add(k);
    }
  }
  // Takip edilenler tohuma hem id'siyle (kesin) hem anahtarıyla katılır.
  const followedArchitectIds = new Set();
  const followedOfficeIds = new Set();
  for (const f of followRows.results || []) {
    if (f.followed_key) profileKeys.add(f.followed_key);
    if (f.followed_type === 'architect') followedArchitectIds.add(f.followed_ref_id);
    else if (f.followed_type === 'office') followedOfficeIds.add(f.followed_ref_id);
  }

  const profileKeyList = [...profileKeys];
  const projectKeyList = [...projectKeys];
  const productKeyList = [...productKeys];

  // -------------------------------------------------------------------------------------------
  // 2. TUR — profil anahtarlarını canonical id'lere çöz.
  // -------------------------------------------------------------------------------------------
  // findCanonicalRowByNaturalKey'in mimar/firma için baktığı ÜÇ kolonun aynısı (name/slug/
  // legacy_key). Anahtar listesi boşsa json_each('[]') hiçbir satır döndürmez, yani ayrı bir "if"
  // dalı gerekmez.
  const [architectIdRows, officeIdRows] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id FROM architects WHERE deleted_at IS NULL AND hidden_at IS NULL
         AND (name IN (SELECT value FROM json_each(?1))
           OR slug IN (SELECT value FROM json_each(?1))
           OR legacy_key IN (SELECT value FROM json_each(?1)))`
    ).bind(J(profileKeyList)),
    env.DB.prepare(
      `SELECT id FROM offices WHERE deleted_at IS NULL AND hidden_at IS NULL
         AND (name IN (SELECT value FROM json_each(?1))
           OR slug IN (SELECT value FROM json_each(?1))
           OR legacy_key IN (SELECT value FROM json_each(?1)))`
    ).bind(J(profileKeyList)),
  ]);

  const seedArchitectIds = [...new Set([
    ...followedArchitectIds,
    ...(architectIdRows.results || []).map(r => r.id),
  ])].filter(v => v !== null && v !== undefined);
  const seedOfficeIds = [...new Set([
    ...followedOfficeIds,
    ...(officeIdRows.results || []).map(r => r.id),
  ])].filter(v => v !== null && v !== undefined);

  const hasSignal = !!(seedArchitectIds.length || seedOfficeIds.length
    || projectKeyList.length || productKeyList.length);

  // "Bunların aynısı olmayan" kuralının SQL karşılığı. Doğal anahtar slug ya da legacy_key
  // olabildiğinden İKİSİ de dışlanır; legacy_key NULL olan satırlar NOT IN ile sessizce elenmesin
  // diye ayrıca IS NULL kontrolü var (SQL'de NULL NOT IN (...) sonucu UNKNOWN'dır, yani satır düşer).
  const notInteractedProject = (alias, bind) =>
    `${alias}.slug NOT IN (SELECT value FROM json_each(${bind}))
     AND (${alias}.legacy_key IS NULL OR ${alias}.legacy_key NOT IN (SELECT value FROM json_each(${bind})))`;
  const notInteractedProduct = notInteractedProject; // aynı iki kolon, aynı kural

  // -------------------------------------------------------------------------------------------
  // 3. TUR — beş raf, tek batch.
  // -------------------------------------------------------------------------------------------
  const [railSeedProjects, railSeedProducts, railSimilarProjects, railSimilarProducts, railFresh] =
    await env.DB.batch([
      // A — tohum profillerin projeleri. seed_id/seed_type, kartın gerekçesini "Takip ettiğin X" mi
      //     yoksa "İlgilendiğin X" mi yazacağımızı belirler (bkz. aşağıdaki followedKey seti).
      env.DB.prepare(
        `SELECT p.id, p.slug, p.title, p.images, p.location,
                COALESCE(o.name, a.name) AS by_name,
                COALESCE(pd.office_id, pd.architect_id) AS seed_id,
                CASE WHEN pd.office_id IS NOT NULL THEN 'office' ELSE 'architect' END AS seed_type
         FROM projects p
         JOIN project_designers pd ON pd.project_id = p.id
         LEFT JOIN offices o ON o.id = pd.office_id
         LEFT JOIN architects a ON a.id = pd.architect_id
         WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL
           AND ${notInteractedProject('p', '?3')}
           AND (pd.architect_id IN (SELECT value FROM json_each(?1))
                OR pd.office_id IN (SELECT value FROM json_each(?2)))
         ORDER BY p.id DESC LIMIT ?4`
      ).bind(J(seedArchitectIds), J(seedOfficeIds), J(projectKeyList), PER_RAIL),

      // B — tohum firmaların/markaların ürünleri. Ürün tarafında mimar sinyali yok:
      //     products.designer serbest metindir ve src/routes/follows.js'in kendi denetim notu
      //     (o dosyadaki "LIKE yalnızca bir ÖN-filtre" bulgusu) bu eşleşmenin güvenilmez olduğunu
      //     zaten saptamış.
      env.DB.prepare(
        `SELECT pr.id, pr.slug, pr.title, pr.images, pr.kind, o.name AS brand,
                pr.brand_name_raw, pr.legacy_key,
                pr.brand_office_id AS seed_id
         FROM products pr
         JOIN offices o ON o.id = pr.brand_office_id
         WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL
           AND ${notInteractedProduct('pr', '?2')}
           AND pr.brand_office_id IN (SELECT value FROM json_each(?1))
         ORDER BY pr.id DESC LIMIT ?3`
      ).bind(J(seedOfficeIds), J(productKeyList), PER_RAIL),

      // C — etkileşim kurulan projelerin tasarımcılarından DİĞER projeler.
      env.DB.prepare(
        `SELECT DISTINCT p.id, p.slug, p.title, p.images, p.location,
                COALESCE(o.name, a.name) AS by_name
         FROM projects p
         JOIN project_designers pd ON pd.project_id = p.id
         LEFT JOIN offices o ON o.id = pd.office_id
         LEFT JOIN architects a ON a.id = pd.architect_id
         WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL
           AND ${notInteractedProject('p', '?1')}
           AND (
             pd.office_id IN (
               SELECT pd2.office_id FROM projects p2
               JOIN project_designers pd2 ON pd2.project_id = p2.id
               WHERE (p2.slug IN (SELECT value FROM json_each(?1))
                      OR p2.legacy_key IN (SELECT value FROM json_each(?1)))
                 AND pd2.office_id IS NOT NULL
             )
             OR pd.architect_id IN (
               SELECT pd2.architect_id FROM projects p2
               JOIN project_designers pd2 ON pd2.project_id = p2.id
               WHERE (p2.slug IN (SELECT value FROM json_each(?1))
                      OR p2.legacy_key IN (SELECT value FROM json_each(?1)))
                 AND pd2.architect_id IS NOT NULL
             )
           )
         ORDER BY p.id DESC LIMIT ?2`
      ).bind(J(projectKeyList), PER_RAIL),

      // D — etkileşim kurulan ürünlerin markasından DİĞER ürünler.
      env.DB.prepare(
        `SELECT pr.id, pr.slug, pr.title, pr.images, pr.kind, o.name AS brand,
                pr.brand_name_raw, pr.legacy_key
         FROM products pr
         JOIN offices o ON o.id = pr.brand_office_id
         WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL
           AND ${notInteractedProduct('pr', '?1')}
           AND pr.brand_office_id IN (
             SELECT pr2.brand_office_id FROM products pr2
             WHERE (pr2.slug IN (SELECT value FROM json_each(?1))
                    OR pr2.legacy_key IN (SELECT value FROM json_each(?1)))
               AND pr2.brand_office_id IS NOT NULL
           )
         ORDER BY pr.id DESC LIMIT ?2`
      ).bind(J(productKeyList), PER_RAIL),

      // E — doldurucu. HER ZAMAN çalışır: hiç sinyali olmayan yeni üyenin kutusu boş kalmasın,
      //     sinyali olan üyede de raflar limiti dolduramazsa kuyruğu tamamlasın.
      env.DB.prepare(
        `SELECT DISTINCT p.id, p.slug, p.title, p.images, p.location,
                COALESCE(o.name, a.name) AS by_name
         FROM projects p
         LEFT JOIN project_designers pd ON pd.project_id = p.id
         LEFT JOIN offices o ON o.id = pd.office_id
         LEFT JOIN architects a ON a.id = pd.architect_id
         WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL
           AND ${notInteractedProject('p', '?1')}
         ORDER BY p.id DESC LIMIT ?2`
      ).bind(J(projectKeyList), MAX_LIMIT),
    ]);

  // Takip edilen tohumlar ile "sadece etkileşim kurulmuş" tohumları ayırt etmek için — gerekçe
  // metni bu ikisi için farklı yazılır (takip açık bir niyet beyanıdır, bir puan/paylaşım değil).
  const followedKey = new Set([
    ...[...followedArchitectIds].map(id => `architect:${id}`),
    ...[...followedOfficeIds].map(id => `office:${id}`),
  ]);
  const seedReason = (seedType, seedId, name) => {
    if (!name) return followedKey.has(`${seedType}:${seedId}`) ? 'Takip ettiklerinden' : 'İlgilendiklerinden';
    return followedKey.has(`${seedType}:${seedId}`) ? `Takip ettiğin ${name}` : `İlgilendiğin ${name}`;
  };

  const rails = [
    (railSeedProjects.results || []).map(r =>
      projectCard(r, seedReason(r.seed_type, r.seed_id, r.by_name))),
    (railSeedProducts.results || []).map(r =>
      productCard(r, seedReason('office', r.seed_id, r.brand))),
    (railSimilarProjects.results || []).map(r =>
      projectCard(r, r.by_name ? `Benzer: ${r.by_name}` : 'Benzer içerik')),
    (railSimilarProducts.results || []).map(r =>
      productCard(r, r.brand ? `Benzer: ${r.brand}` : 'Benzer içerik')),
  ];

  const items = [];
  const seen = new Set();
  const push = card => {
    if (!card || seen.has(card.href) || items.length >= limit) return;
    seen.add(card.href);
    items.push(card);
  };
  // HARMANLAMA: raflardan sırayla birer kart (A1, B1, C1, D1, A2, ...).
  for (let i = 0; i < PER_RAIL && items.length < limit; i++) {
    for (const rail of rails) push(rail[i]);
  }

  // Kişiselleştirme GERÇEKTEN oldu mu: yalnızca sinyal tabanlı raflardan en az bir kart girdiyse.
  // Doldurucu ile dolmuş bir kutuyu "senin için derledik" diye sunmak dürüst olmazdı — istemci bu
  // bayrağı alt yazıyı değiştirmek için okur (bkz. index.html#loadForYou).
  const personalized = items.length > 0;

  for (const row of railFresh.results || []) {
    if (items.length >= limit) break;
    push(projectCard(row, 'MİMARLAB\'da yeni'));
  }

  return json({ personalized, hasSignal, items }, 200, PRIVATE_HEADERS);
}

function clampLimit(raw) {
  const n = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// images sütunu JSON metin; bozuk satırlar SESSİZCE görselsiz kart üretir (follows.js#followFeed
// ile AYNI tolerans) — tek bir bozuk JSON ana sayfayı düşürmemeli.
//
// Kart karuseli için ilk CARD_CAROUSEL_IMAGES görsel (kullanıcı isteği, 2026-09-13 madde 2:
// "Senin için bölümünde de gönderilerde ... ilk üç görseli önizlemede görebileceğimiz ileri geri
// butonları olsun"). Sayı proje/ürün liste kartlarıyla ORTAK tek sabitten gelir — üç yerde ayrı
// yazılsaydı biri güncellenmeyip sessizce ayrışırdı.
function cardImages(rawJson) {
  try {
    const arr = JSON.parse(rawJson || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.filter(u => typeof u === 'string' && u).slice(0, CARD_CAROUSEL_IMAGES);
  } catch { return []; }
}

function projectCard(row, reason) {
  const subtitle = [row.by_name, row.location].filter(Boolean).join(' · ');
  const images = cardImages(row.images);
  return {
    kind: 'project',
    title: row.title,
    subtitle: subtitle || null,
    image: images[0] || null,
    // images: kart karuseli; saveType/saveKey: Kaydet butonu (save-widget.js#wireSaveButtons
    // bu iki alanı data-type/data-key olarak bekler). Proje kartının kaydetme anahtarı SLUG'dır
    // — js/pages/proje.js#renderCards ile birebir aynı (data-key="${p.slug}", tip 'project').
    images,
    saveType: 'project',
    saveKey: row.slug,
    href: `/proje/${encodeURIComponent(row.slug)}`,
    reason,
  };
}

// Ürünün kaydetme anahtarı: src/routes/product.js#fetchProductPool'un ürettiği `ratingKey` ile
// BİREBİR AYNI olmalı — urun.html'deki kart da onu data-key olarak basıyor. Bu yüzden hem
// submission işaretçisi (legacy_key) hem de MARKA ADI oradaki ile aynı kolondan (brand_name_raw)
// okunur; kartta gösterilen `brand` ise ofis tablosundan gelen addır ve bu ikisi ayrışabilir.
function productSaveKey(row) {
  const isSubmissionMarker = typeof row.legacy_key === 'string' && row.legacy_key.startsWith('submission:');
  const submissionId = isSubmissionMarker ? row.legacy_key.slice('submission:'.length) : null;
  return ratingKeyFor(row.title, row.brand_name_raw, submissionId);
}

function productCard(row, reason) {
  const images = cardImages(row.images);
  const kind = row.kind === 'material' ? 'material' : 'product';
  return {
    kind,
    title: row.title,
    subtitle: row.brand || null,
    image: images[0] || null,
    images,
    // ÜRÜN kartının kaydetme anahtarı SLUG DEĞİL, urun.html'in kullandığı `ratingKey`'dir; o da
    // slugify(title) üzerinden üretilir (bkz. src/routes/product.js#fetchProductPool ve
    // save-widget.js#slugify). Burada slug yazsaydık, aynı ürün ürün sayfasında "kaydedildi"
    // görünürken ana sayfada boş görünürdü — iki ayrı anahtara yazılmış olurdu.
    saveType: kind,
    saveKey: productSaveKey(row),
    // Malzemeler de ürün yolundan servis edilir (products.kind ayrımı yalnızca listelemede) —
    // bkz. src/index.js'teki '/malzeme' -> '/urun' yönlendirmesi.
    href: `/urun/${encodeURIComponent(row.slug)}`,
    reason,
  };
}
