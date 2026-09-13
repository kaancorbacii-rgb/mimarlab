// SENİN İÇİN — GET /api/foryou (kullanıcı isteği, 2026-09-13 madde 2: "Ana sayfada carosellerden
// sonra 'Senin İçin' — kişiselleştirilmiş ana sayfa özelliğini ekleyebiliriz ama SADECE GİRİŞ YAPAN
// kullanıcılar için").
//
// ===============================================================================================
// NEDEN AYRI BİR UÇ, src/routes/follows.js#followFeed DEĞİL
// ===============================================================================================
// followFeed ("Aktivitelerim > Takip Ettiklerim") bilerek DAR: yalnızca takip ETTİKTEN SONRA
// yayınlanmış içeriği döner (bkz. o dosyadaki kullanıcı isteği: "takip etmeden önceki gönderilerin
// bu alana gelmesine gerek yok"). Bu kural bir aktivite akışı için doğru, ana sayfa için YANLIŞ
// olurdu: dün EAA'yı takip etmiş bir üye ana sayfada BOŞ bir "Senin İçin" görürdü. Buradaki uç
// arşivin tamamına bakar ve takip dışında kaydetme sinyalini de kullanır.
//
// ===============================================================================================
// SİNYALLER — hepsi ID JOIN'i, hiçbiri tahmin değil
// ===============================================================================================
//   A. Takip ettiğin kişi/firmaların projeleri          (follows -> project_designers)
//   B. Takip ettiğin firmaların/markaların ürünleri     (follows -> products.brand_office_id)
//   C. Kaydettiğin projelerin ofislerinden diğerleri    (saved_items -> project_designers)
//   D. Kaydettiğin ürünlerin markasından diğerleri      (saved_items -> products.brand_office_id)
//   E. Doldurucu: MİMARLAB'da yeni                      (sinyal yoksa da kutu boş kalmasın)
//
// JSON ALAN EŞLEŞTİRMESİ BİLEREK YOK: projects.type / projects.category JSON metin olarak tutuluyor
// ve json_each() geçersiz JSON'da HATA fırlatır (tablo-değerli fonksiyon, AND kısa devresi onu
// kurtarmaz). Tek bir bozuk satır ana sayfayı 500'e düşürürdü. Bu yüzden her raf yalnızca tamsayı
// FK'ler üzerinden kurulu — "aynı ofisten" sinyali "aynı tipte"den zaten daha güçlü ve
// kullanıcıya AÇIKLANABİLİR ("Kaydettiğin X projesinin ofisinden").
//
// ÖNBELLEK: yanıt kullanıcıya özeldir — private, no-store, Vary: Cookie (bkz. analytics.js'teki
// AYNI karar: "kullanıcılar arasında veri sızıntısı kesinlikle olmasın").
import { json, errorJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Cookie' };

// Ana sayfadaki kutunun taşıdığı kart sayısı. İstemci de aynı varsayılanı kullanır (bkz.
// index.html#FORYOU_LIMIT) — ayrışırlarsa sunucu fazladan satır üretir, zararsız ama israf.
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 24;
// Her raftan çekilen en fazla aday. Harmanlama (interleave) sonrası fazlası atılır; raf başına
// tavan koymak, tek bir rafın (ör. 200 projesi olan bir ofisi takip eden üye) kutunun tamamını
// doldurmasını engeller.
const PER_RAIL = 8;

export async function handleForYouRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404, PRIVATE_HEADERS);

  // GİRİŞ ŞARTI — kullanıcı isteğinin kendisi ("sadece giriş yapan kullanıcılar için"). İstemci
  // 401'i "giriş çağrısı kutusunu göster" diye okur (bkz. index.html#renderForYou), hata olarak
  // DEĞİL; bu yüzden 401 burada normal bir akış sonucudur.
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Giriş gerekli.', 401, PRIVATE_HEADERS);

  const limit = clampLimit(url.searchParams.get('limit'));

  // 1. TUR — sinyaller.
  const [followRows, savedRows] = await env.DB.batch([
    env.DB.prepare(
      `SELECT followed_type, followed_key, followed_title, followed_ref_id
       FROM follows WHERE user_id = ? AND followed_ref_id IS NOT NULL`
    ).bind(user.id),
    // Kaydedilenler İKİ işe yarar: (a) C/D raflarının kaynağı, (b) zaten kaydedilmiş bir içeriği
    // "sana önerdik" diye geri göstermemek için dışlama listesi.
    env.DB.prepare(
      `SELECT item_type, item_key FROM saved_items
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`
    ).bind(user.id),
  ]);

  const architectIds = uniq((followRows.results || [])
    .filter(f => f.followed_type === 'architect').map(f => f.followed_ref_id));
  const officeIds = uniq((followRows.results || [])
    .filter(f => f.followed_type === 'office').map(f => f.followed_ref_id));

  const saved = savedRows.results || [];
  const savedProjectSlugs = saved.filter(s => s.item_type === 'project').map(s => s.item_key);
  // 'material' de products tablosunda yaşar (products.kind), bu yüzden ürün dışlamasına dahil.
  const savedProductSlugs = saved.filter(s => s.item_type === 'product' || s.item_type === 'material').map(s => s.item_key);

  const hasSignal = architectIds.length || officeIds.length || savedProjectSlugs.length || savedProductSlugs.length;

  const J = arr => JSON.stringify(arr);

  // 2. TUR — beş raf, TEK batch. Sinyali olmayan raflar boş json_each('[]') ile doğal olarak hiç
  // satır döndürmez (bkz. analyticsAccess.js#ownedSlugs'taki aynı not), ayrı bir "if" dalı gerekmez.
  const [railFollowProjects, railFollowProducts, railSavedProjects, railSavedProducts, railFresh] =
    await env.DB.batch([
      // A — takip edilen kişi/firmaların projeleri.
      env.DB.prepare(
        `SELECT DISTINCT p.id, p.slug, p.title, p.images, p.location,
                COALESCE(o.name, a.name) AS by_name
         FROM projects p
         JOIN project_designers pd ON pd.project_id = p.id
         LEFT JOIN offices o ON o.id = pd.office_id
         LEFT JOIN architects a ON a.id = pd.architect_id
         WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL
           AND p.slug NOT IN (SELECT value FROM json_each(?3))
           AND (pd.architect_id IN (SELECT value FROM json_each(?1))
                OR pd.office_id IN (SELECT value FROM json_each(?2)))
         ORDER BY p.id DESC LIMIT ?4`
      ).bind(J(architectIds), J(officeIds), J(savedProjectSlugs), PER_RAIL),

      // B — takip edilen firmaların/markaların ürünleri. Ürün tarafında mimar sinyali yok:
      // products.designer serbest metindir ve follows.js'in kendi denetim notu (bkz. o dosyadaki
      // "LIKE yalnızca bir ÖN-filtre" bulgusu) bu eşleşmenin güvenilmez olduğunu zaten saptamış.
      env.DB.prepare(
        `SELECT pr.id, pr.slug, pr.title, pr.images, pr.kind, o.name AS brand
         FROM products pr
         JOIN offices o ON o.id = pr.brand_office_id
         WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL
           AND pr.slug NOT IN (SELECT value FROM json_each(?2))
           AND pr.brand_office_id IN (SELECT value FROM json_each(?1))
         ORDER BY pr.id DESC LIMIT ?3`
      ).bind(J(officeIds), J(savedProductSlugs), PER_RAIL),

      // C — kaydedilen projelerin tasarımcılarından DİĞER projeler.
      env.DB.prepare(
        `SELECT DISTINCT p.id, p.slug, p.title, p.images, p.location,
                COALESCE(o.name, a.name) AS by_name
         FROM projects p
         JOIN project_designers pd ON pd.project_id = p.id
         LEFT JOIN offices o ON o.id = pd.office_id
         LEFT JOIN architects a ON a.id = pd.architect_id
         WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL
           AND p.slug NOT IN (SELECT value FROM json_each(?1))
           AND (
             pd.office_id IN (
               SELECT pd2.office_id FROM projects p2
               JOIN project_designers pd2 ON pd2.project_id = p2.id
               WHERE p2.slug IN (SELECT value FROM json_each(?1)) AND pd2.office_id IS NOT NULL
             )
             OR pd.architect_id IN (
               SELECT pd2.architect_id FROM projects p2
               JOIN project_designers pd2 ON pd2.project_id = p2.id
               WHERE p2.slug IN (SELECT value FROM json_each(?1)) AND pd2.architect_id IS NOT NULL
             )
           )
         ORDER BY p.id DESC LIMIT ?2`
      ).bind(J(savedProjectSlugs), PER_RAIL),

      // D — kaydedilen ürünlerin markasından DİĞER ürünler.
      env.DB.prepare(
        `SELECT pr.id, pr.slug, pr.title, pr.images, pr.kind, o.name AS brand
         FROM products pr
         JOIN offices o ON o.id = pr.brand_office_id
         WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL
           AND pr.slug NOT IN (SELECT value FROM json_each(?1))
           AND pr.brand_office_id IN (
             SELECT pr2.brand_office_id FROM products pr2
             WHERE pr2.slug IN (SELECT value FROM json_each(?1)) AND pr2.brand_office_id IS NOT NULL
           )
         ORDER BY pr.id DESC LIMIT ?2`
      ).bind(J(savedProductSlugs), PER_RAIL),

      // E — doldurucu. HER ZAMAN çalışır: hiç sinyali olmayan yeni üyenin kutusu boş kalmasın,
      // sinyali olan üyede de raflar limiti dolduramazsa kuyruğu tamamlasın.
      env.DB.prepare(
        `SELECT DISTINCT p.id, p.slug, p.title, p.images, p.location,
                COALESCE(o.name, a.name) AS by_name
         FROM projects p
         LEFT JOIN project_designers pd ON pd.project_id = p.id
         LEFT JOIN offices o ON o.id = pd.office_id
         LEFT JOIN architects a ON a.id = pd.architect_id
         WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL
           AND p.slug NOT IN (SELECT value FROM json_each(?1))
         ORDER BY p.id DESC LIMIT ?2`
      ).bind(J(savedProjectSlugs), MAX_LIMIT),
    ]);

  const rails = [
    (railFollowProjects.results || []).map(r => projectCard(r, 'Takip ettiğin', r.by_name)),
    (railFollowProducts.results || []).map(r => productCard(r, 'Takip ettiğin', r.brand)),
    (railSavedProjects.results || []).map(r => projectCard(r, 'Kaydettiklerine benzer', r.by_name)),
    (railSavedProducts.results || []).map(r => productCard(r, 'Kaydettiklerine benzer', r.brand)),
  ];

  // HARMANLAMA: raflardan sırayla birer kart al (A1, B1, C1, D1, A2, B2, ...). Rafları arka arkaya
  // eklemek, ilk rafın tüm kutuyu doldurmasına ve diğer sinyallerin hiç görünmemesine yol açardı.
  const items = [];
  const seen = new Set();
  const push = card => {
    if (!card || seen.has(card.href) || items.length >= limit) return;
    seen.add(card.href);
    items.push(card);
  };
  for (let i = 0; i < PER_RAIL && items.length < limit; i++) {
    for (const rail of rails) push(rail[i]);
  }

  // Kişiselleştirme GERÇEKTEN oldu mu: yalnızca sinyal tabanlı raflardan en az bir kart girdiyse.
  // Doldurucu ile dolmuş bir kutuyu "senin için seçtik" diye sunmak dürüst olmazdı — istemci bu
  // bayrağı alt yazıyı değiştirmek için okur (bkz. index.html#renderForYou).
  const personalized = items.length > 0;

  for (const row of railFresh.results || []) {
    if (items.length >= limit) break;
    push(projectCard(row, 'MİMARLAB\'da yeni', row.by_name));
  }

  return json({ personalized, hasSignal: !!hasSignal, items }, 200, PRIVATE_HEADERS);
}

function clampLimit(raw) {
  const n = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function uniq(arr) { return [...new Set(arr.filter(v => v !== null && v !== undefined))]; }

// images sütunu JSON metin; bozuk satırlar SESSİZCE görselsiz kart üretir (follows.js#followFeed
// ile AYNI tolerans) — tek bir bozuk JSON ana sayfayı düşürmemeli.
function firstImage(rawJson) {
  try {
    const arr = JSON.parse(rawJson || '[]');
    return Array.isArray(arr) && arr.length ? arr[0] : null;
  } catch { return null; }
}

function projectCard(row, reasonPrefix, byName) {
  const subtitle = [byName, row.location].filter(Boolean).join(' · ');
  return {
    kind: 'project',
    title: row.title,
    subtitle: subtitle || null,
    image: firstImage(row.images),
    href: `/proje/${encodeURIComponent(row.slug)}`,
    reason: byName ? `${reasonPrefix} ${byName}` : reasonPrefix,
  };
}

function productCard(row, reasonPrefix, brand) {
  return {
    kind: row.kind === 'material' ? 'material' : 'product',
    title: row.title,
    subtitle: brand || null,
    image: firstImage(row.images),
    // Malzemeler de ürün yolundan servis edilir (products.kind ayrımı yalnızca listelemede) —
    // bkz. src/index.js'teki /urun ve /malzeme yönlendirmeleri.
    href: `/urun/${encodeURIComponent(row.slug)}`,
    reason: brand ? `${reasonPrefix} ${brand}` : reasonPrefix,
  };
}
