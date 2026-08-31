import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { findCanonicalRowByNaturalKey } from '../lib/canonicalSync.js';
import { checkRateLimit } from '../lib/rateLimit.js';
// bkz. src/routes/office.js'teki AYNI CJS-interop içe aktarma deseni — firma/marka ayrımının tek kaynağı.
import officeKindJs from '../../office-kind.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';

const { isBrandOffice, isPureBrandOffice } = officeKindJs;

// src/routes/saved.js İLE AYNI yapı — bkz. kullanıcı isteği: Archello (archello.com/brand/ofist)
// benzeri "Takip Et" özelliği. Yalnızca mimar/firma takip edilebilir (bkz. schema.sql#follows).
export const FOLLOW_TYPES = new Set(['architect', 'office']);
const CANONICAL_TYPE_BY_FOLLOW = { architect: 'architects', office: 'offices' };

export async function handleFollowRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "follows", ...]

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'GET') return listFollows(env, user);
  if (segments.length === 2 && request.method === 'POST') return createFollow(request, env, user);
  if (segments.length === 3 && segments[2] === 'feed' && request.method === 'GET') return followFeed(env, user);
  if (segments.length === 4 && request.method === 'DELETE') return deleteFollow(env, user, segments[2], segments[3]);
  return errorJson('Bulunamadı', 404);
}

async function listFollows(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT followed_type, followed_key, followed_title, followed_ref_id FROM follows WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();

  // follows tablosunda görsel alanı YOK (bkz. schema.sql#follows) — Takip Ettiklerim satırlarının
  // önizlemesi için followed_ref_id üzerinden architects.photo_url / offices.logo_url'e JOIN edilir.
  const architectIds = [...new Set(results.filter(f => f.followed_type === 'architect' && f.followed_ref_id).map(f => f.followed_ref_id))];
  const officeIds = [...new Set(results.filter(f => f.followed_type === 'office' && f.followed_ref_id).map(f => f.followed_ref_id))];
  const imageByRef = new Map();
  if (architectIds.length) {
    const { results: rows } = await env.DB.prepare(
      `SELECT id, photo_url FROM architects WHERE id IN (${architectIds.map(() => '?').join(',')})`
    ).bind(...architectIds).all();
    for (const r of rows) imageByRef.set(`architect:${r.id}`, r.photo_url);
  }
  // is_brand — Koleksiyonum > Takip Ettiklerim'in "Marka" sekmesi için (kullanıcı isteği,
  // 2026-09-01 madde 2: "Takip ettiklerim kutusuna marka butonu da ekle ve artık marka
  // profillerinde takip et butonuna tıklayınca markalar bu kısımda gözüksün"). Marka takibi AYRI
  // bir follows tipi DEĞİL — marka da bir offices satırıdır (bkz. office-kind.js dosya başı) ve
  // marka profili firma modalının kendisiyle açılır, dolayısıyla Takip Et butonu type='office'
  // gönderir. Firma/marka ayrımının TEK kaynağı office-kind.js olduğundan karar burada, sunucuda
  // verilir. product_count: isBrandOffice'in üçüncü yolu (kendini 'Ürün' olarak etiketlememiş ama
  // katalogda ürünü olan Autoban gibi firmalar) — src/routes/office.js#handleOfficeListRoute ile
  // AYNI ölçüt, aynı sayfada iki farklı cevap çıkmasın diye.
  // İKİ ayrı soru, tam olarak office-kind.js'in modellediği gibi:
  //   is_brand      → MARKA sekmesinde görünür mü? (marka.html'de listelenenlerin aynısı)
  //   is_pure_brand → yalnızca marka mı? (firma.html'den çıkarılanlar) — satırın ETİKETİNİ belirler
  // Autoban gibi hem mimarlık yapan hem ürün tasarlayan bir ofis İKİ sekmede de görünür ama etiketi
  // "Firma" kalır; VitrA gibi saf bir üretici yalnızca Marka sekmesinde ve "Marka" etiketiyle çıkar.
  const brandByRefId = new Map();
  const pureBrandByRefId = new Map();
  if (officeIds.length) {
    const placeholders = officeIds.map(() => '?').join(',');
    const [{ results: rows }, { results: countRows }] = await Promise.all([
      env.DB.prepare(`SELECT id, logo_url, cats FROM offices WHERE id IN (${placeholders})`).bind(...officeIds).all(),
      env.DB.prepare(
        `SELECT brand_office_id AS id, COUNT(*) AS n FROM products
         WHERE deleted_at IS NULL AND hidden_at IS NULL AND brand_office_id IN (${placeholders})
         GROUP BY brand_office_id`
      ).bind(...officeIds).all(),
    ]);
    const productCountByRefId = new Map(countRows.map(r => [r.id, r.n]));
    for (const r of rows) {
      imageByRef.set(`office:${r.id}`, r.logo_url);
      // parseCanonicalRow ŞART, elle bir JSON.parse denemesi DEĞİL (yerel testte yakalandı):
      // offices.cats üç biçimde de saklanmış olabilir — JSON dizi ('["Ürün"]'), JSON-QUOTED düz
      // metin ('"Mimarlık · İç Mimarlık · Ürün"', canlıda Autoban böyle) ya da NULL. Sadece '['
      // ile başlayanı parse etmek ikinci biçimi ham bırakıyor, dış tırnaklar kategorilere yapışıyor
      // ('Ürün"') ve isBrandOffice hiçbirini tanımıyordu. parseCanonicalRow bu üç biçimin TEK
      // normalizasyon noktasıdır (bkz. src/lib/canonicalRead.js#JSON_FIELDS.offices).
      const cats = parseCanonicalRow('offices', r).cats;
      const productCount = productCountByRefId.get(r.id) || 0;
      brandByRefId.set(r.id, isBrandOffice(cats, productCount));
      pureBrandByRefId.set(r.id, isPureBrandOffice(cats, productCount));
    }
  }

  const items = results.map(f => ({
    followed_type: f.followed_type,
    followed_key: f.followed_key,
    followed_title: f.followed_title,
    followed_image: f.followed_ref_id ? (imageByRef.get(`${f.followed_type}:${f.followed_ref_id}`) || null) : null,
    is_brand: f.followed_type === 'office' && !!brandByRefId.get(f.followed_ref_id),
    is_pure_brand: f.followed_type === 'office' && !!pureBrandByRefId.get(f.followed_ref_id),
  }));
  return json({ items });
}

async function createFollow(request, env, user) {
  // saved.js#createSaved İLE AYNI cömert üst sınır gerekçesi (ucuz/sık kullanılan bir eylem).
  if (!(await checkRateLimit(env, 'follow', user.id, 100, 60 * 60 * 1000))) {
    return errorJson('Çok fazla takip işlemi yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const followedType = body.type;
  const followedKey = (body.key || '').trim();
  if (!FOLLOW_TYPES.has(followedType) || !followedKey) return errorJson('Geçersiz istek.');

  const existing = await env.DB.prepare(
    'SELECT id FROM follows WHERE user_id = ? AND followed_type = ? AND followed_key = ?'
  ).bind(user.id, followedType, followedKey).first();
  if (existing) return json({ ok: true, alreadyFollowing: true });

  // followed_ref_id — follow anında bir kez çözülür (bkz. schema.sql#follows yorumu), feed sorgusu
  // her istekte isim taramasına gerek kalmadan doğrudan bununla JOIN/IN yapabilsin diye.
  const canonicalType = CANONICAL_TYPE_BY_FOLLOW[followedType];
  const canonRow = await findCanonicalRowByNaturalKey(env, canonicalType, followedKey);

  const id = newId();
  await env.DB.prepare(
    `INSERT INTO follows (id, user_id, followed_type, followed_key, followed_title, followed_ref_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, user.id, followedType, followedKey,
    (body.title || '').slice(0, 300) || null,
    canonRow ? canonRow.id : null,
    Date.now()
  ).run();

  return json({ ok: true }, 201);
}

async function deleteFollow(env, user, followedType, followedKey) {
  if (!FOLLOW_TYPES.has(followedType)) return errorJson('Geçersiz istek.');
  await env.DB.prepare(
    'DELETE FROM follows WHERE user_id = ? AND followed_type = ? AND followed_key = ?'
  ).bind(user.id, followedType, decodeURIComponent(followedKey)).run();
  return json({ ok: true });
}

// ms epoch -> SQLite datetime('now') ile AYNI "YYYY-MM-DD HH:MM:SS" biçimi — projects/products.
// created_at bu biçimde TEXT olarak tutulur (bkz. schema.sql), lexicographic karşılaştırma
// kronolojik sıralamayla birebir örtüşür.
function toSqliteDatetime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

// Aktivitelerim > "Takip Ettiklerim" — takip edilen HER mimar/firma için, o profili takip etmeye
// başladığı ANDAN SONRA yayınlanmış proje/ürünleri döner (bkz. kullanıcı isteği: "takip etmeden
// önceki gönderilerin bu alana gelmesine gerek yok"). saved.js#listSaved İLE AYNI desen: backend
// filtre/sayfalama YAPMAZ, ham liste döner — istemci Kaydettiklerim/Beğendiklerim ile AYNI şekilde
// sekme+PAGE_SIZE_DASH sayfalamasını kendi tarafında uygular (bkz. js/components/auth-modal.js).
async function followFeed(env, user) {
  const { results: follows } = await env.DB.prepare(
    'SELECT followed_type, followed_key, followed_title, followed_ref_id, created_at FROM follows WHERE user_id = ? AND followed_ref_id IS NOT NULL'
  ).bind(user.id).all();
  if (!follows.length) return json({ items: [] });

  const architectFollows = follows.filter(f => f.followed_type === 'architect');
  const officeFollows = follows.filter(f => f.followed_type === 'office');

  const items = [];

  if (architectFollows.length || officeFollows.length) {
    const clauses = [];
    const binds = [];
    for (const f of architectFollows) {
      clauses.push('(pd.architect_id = ? AND p.created_at > ?)');
      binds.push(f.followed_ref_id, toSqliteDatetime(f.created_at));
    }
    for (const f of officeFollows) {
      clauses.push('(pd.office_id = ? AND p.created_at > ?)');
      binds.push(f.followed_ref_id, toSqliteDatetime(f.created_at));
    }
    // DISTINCT — bir proje birden fazla tasarımcı satırına (project_designers) sahip olabilir;
    // kullanıcı bunlardan birden fazlasını takip ediyorsa (ör. hem mimarı hem ofisi) JOIN aynı
    // projeyi birden çok kez döndürebilir, yalnızca p.* seçildiği için DISTINCT bunları eler.
    const { results: projectRows } = await env.DB.prepare(
      `SELECT DISTINCT p.id, p.slug, p.title, p.images, p.created_at
       FROM projects p JOIN project_designers pd ON pd.project_id = p.id
       WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND (${clauses.join(' OR ')})
       ORDER BY p.created_at DESC LIMIT 200`
    ).bind(...binds).all();
    for (const row of projectRows) {
      let images = [];
      try { images = JSON.parse(row.images || '[]'); } catch { /* bozuk JSON — atla */ }
      items.push({
        type: 'project',
        title: row.title,
        image: images[0] || null,
        href: `/proje/${encodeURIComponent(row.slug)}`,
        created_at: row.created_at,
      });
    }
  }

  if (officeFollows.length || architectFollows.length) {
    // gerçek bulgu (kendi denetim): SQL cümlesinde her takip için "designer LIKE '%ad%' AND
    // created_at > <O takibin tarihi>" şeklinde tarihi LIKE'a bağlamak yanlış olurdu — LIKE yalnızca
    // bir ÖN-filtre olduğundan (architect.js:383 İLE AYNI gerekçe), bir satır BAŞKA bir takibin
    // (ör. adı yanlışlıkla alt-dize eşleşen farklı bir mimar) tarih eşiğinden SQL'i geçip, asıl eşleşen
    // (TAM ad karşılaştırmasıyla bulunan) takibin KENDİ tarihi hiç kontrol edilmeden içeri sızabilirdi.
    // Bu yüzden SQL yalnızca ucuz/geniş bir ön-filtre uygular (tarihsiz), "takipten SONRA mı"
    // kontrolü ise TAM eşleşme bulunduktan SONRA, ilgili takibin KENDİ created_at'ine karşı JS'te yapılır.
    const clauses = [];
    const binds = [];
    if (officeFollows.length) {
      clauses.push(`brand_office_id IN (${officeFollows.map(() => '?').join(',')})`);
      binds.push(...officeFollows.map(f => f.followed_ref_id));
    }
    for (const f of architectFollows) {
      clauses.push('designer LIKE ? COLLATE NOCASE');
      binds.push(`%${f.followed_title || ''}%`);
    }
    const { results: productRows } = await env.DB.prepare(
      `SELECT id, slug, title, images, designer, brand_office_id, created_at FROM products
       WHERE deleted_at IS NULL AND hidden_at IS NULL AND (${clauses.join(' OR ')})
       ORDER BY created_at DESC LIMIT 200`
    ).bind(...binds).all();
    const architectFollowedAtByName = new Map(architectFollows.map(f => [(f.followed_title || '').toLowerCase(), f.created_at]));
    const officeFollowedAtByRefId = new Map(officeFollows.map(f => [f.followed_ref_id, f.created_at]));
    for (const row of productRows) {
      const rowCreatedAtMs = Date.parse(row.created_at.replace(' ', 'T') + 'Z');
      const designerNames = (row.designer || '').split(',').map(s => s.trim().toLowerCase());
      const matchesArchitect = designerNames.some(n => {
        const followedAt = architectFollowedAtByName.get(n);
        return followedAt !== undefined && rowCreatedAtMs > followedAt;
      });
      const officeFollowedAt = officeFollowedAtByRefId.get(row.brand_office_id);
      const matchesOffice = officeFollowedAt !== undefined && rowCreatedAtMs > officeFollowedAt;
      if (!matchesArchitect && !matchesOffice) continue;
      let images = [];
      try { images = JSON.parse(row.images || '[]'); } catch { /* bozuk JSON — atla */ }
      items.push({
        type: 'product',
        title: row.title,
        image: images[0] || null,
        href: `/urun/${encodeURIComponent(row.slug)}`,
        created_at: row.created_at,
      });
    }
  }

  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return json({ items });
}
