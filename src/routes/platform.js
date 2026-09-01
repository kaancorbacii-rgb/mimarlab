import { errorJson } from '../lib/http.js';
import { cachedPublicJson } from '../lib/publicCache.js';
// office-kind.js — FİRMA/MARKA ayrımının TEK kaynağı (bkz. o dosyanın başındaki yorum). Marka
// sayısını burada ayrı bir SQL kuralıyla yeniden tanımlamak, marka.html'in gerçekten listelediği
// sayıdan sapan bir "21 marka" göstergesine yol açardı — aynı fonksiyonlar kullanılır.
import officeKindJs from '../../office-kind.js';
// Sayaçlar, liste sayfalarının KENDİ havuzlarından okunur (bkz. aşağıdaki "tek kaynak" notu).
import { fetchArchitectPool } from './architect.js';
import { fetchOfficePool } from './office.js';
import { fetchProductPool } from './product.js';

const { isBrandOffice, isPureBrandOffice } = officeKindJs;

// GET /api/public/platform — /neden-mimarlab sayfasının canlı platform verileri (bkz.
// neden-mimarlab.html). Sayfada gösterilen HİÇBİR sayı/örnek statik değildir; platform büyüdükçe
// bu uç kendiliğinden güncellenir.
//
// Neden TEK uç: sayfa aksi halde /api/projects + /api/offices?brands=1 + /api/products ... gibi
// birkaç ağır liste ucunu yalnızca `total` alanları için çağırmak zorunda kalırdı (her biri kendi
// havuzunu/faset sayaçlarını hesaplayan, kilobaytlarca kart verisi dönen uçlar). Buradaki sorgular
// yalnızca sayaç + birkaç satırlık vitrin verisi okur.
//
// Önbellek: '/api/public/platform' publicCache.js#CACHEABLE_PATHS'e eklendi — sorgu dizesi
// taşımadığından tek bir caches.default anahtarıdır ve her admin/üye içerik mutasyonunda
// invalidatePublicCache() ile diğer sabit yollarla BİRLİKTE temizlenir (yeni onaylanan bir proje
// sayacı anında yükseltir, ayrı bir invalidation çağrı noktası eklemeye gerek kalmaz).
export async function handlePlatformRoute(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);

  return cachedPublicJson(request, env, url.pathname, async () => {
    // TEK KAYNAK KURALI — sayaçlar liste uçlarının KENDİ (KV önbellekli) havuzlarından okunur,
    // ayrı bir COUNT(*) ile DEĞİL. İlk sürüm bağımsız COUNT'lar kullanıyordu ve canlıda üç sessiz
    // sapma üretti: Mimar 916/915 ('Bilinmiyor' placeholder'ı yalnızca liste havuzunda dışlanıyor),
    // Ürün 133/188 (urun.html ürün VE yapı malzemesini birlikte listeler), Marka 21/22 (ad
    // eşleşmesinde SQLite COLLATE NOCASE ile JS Türkçe küçültmesi farklı davranıyor). Sayfadaki bir
    // sayaca tıklayan kişi o sayıyı listede birebir görmeli — havuzlar zaten KV'de önbellekli ve
    // her içerik mutasyonunda temizlendiğinden bu, ek D1 maliyeti de getirmez.
    const [countsRow, architectPool, officePool, productPool, showcaseRows] = await Promise.all([
      env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM projects WHERE deleted_at IS NULL AND hidden_at IS NULL) AS projects,
           (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL AND kind = 'material') AS materials,
           (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL
              AND files IS NOT NULL AND files NOT IN ('', '[]')) AS productsWithFiles,
           (SELECT COUNT(*) FROM project_products) AS projectProductLinks`
      ).first(),
      fetchArchitectPool(env),
      fetchOfficePool(env),
      fetchProductPool(env),
      // Vitrin (bkz. neden-mimarlab.html#demo): gerçek, yayında olan, kapak görseli VE en az bir
      // künye bağlantısı (mimar ya da firma) bulunan en yeni 3 proje. Sabit bir slug listesi
      // GÖMÜLMEZ — o kayıt ileride gizlenir/silinirse sayfa kırık bir örnek gösterirdi.
      env.DB.prepare(
        `SELECT p.id, p.slug, p.title, p.location, p.project_date, p.images
         FROM projects p
         WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL
           AND p.images IS NOT NULL AND p.images NOT IN ('', '[]')
           AND EXISTS (SELECT 1 FROM project_designers pd WHERE pd.project_id = p.id)
         ORDER BY COALESCE(p.publish_date, p.created_at) DESC, p.id DESC
         LIMIT 3`
      ).all(),
    ]);

    // marka.html ve firma.html'in AYNI havuz üzerinde uyguladığı iki predicate (bkz.
    // src/routes/office.js#passes ve office-kind.js).
    const brands = officePool.filter(o => isBrandOffice(o.cats, o.productCount)).length;
    const offices = officePool.filter(o => !isPureBrandOffice(o.cats, o.productCount)).length;

    const showcaseIds = showcaseRows.results.map(r => r.id);
    const [designerRows, linkedProductRows] = showcaseIds.length
      ? await Promise.all([
        env.DB.prepare(
          `SELECT pd.project_id,
                  a.name AS architect_name, a.slug AS architect_slug,
                  o.name AS office_name,    o.slug AS office_slug
           FROM project_designers pd
           LEFT JOIN architects a ON a.id = pd.architect_id AND a.deleted_at IS NULL AND a.hidden_at IS NULL
           LEFT JOIN offices    o ON o.id = pd.office_id    AND o.deleted_at IS NULL AND o.hidden_at IS NULL
           WHERE pd.project_id IN (${showcaseIds.map(() => '?').join(', ')})`
        ).bind(...showcaseIds).all(),
        // Projeye bağlı ürünler (bkz. project_products, proje-ekle.html'deki "Projede Kullanılan
        // Ürünler" kutusu). Bugün canlıda bu tablo henüz boş — sorgu bilerek burada duruyor ki ilk
        // bağlantı kurulduğunda sayfadaki zincir KOD DEĞİŞMEDEN ürün/marka adımını da göstersin;
        // boşken sayfa o adımı "henüz bağlantı yok" olarak dürüstçe render eder.
        env.DB.prepare(
          `SELECT pp.project_id, pr.slug, pr.title, pr.brand_name_raw, pr.images
           FROM project_products pp
           JOIN products pr ON pr.id = pp.product_id AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL
           WHERE pp.project_id IN (${showcaseIds.map(() => '?').join(', ')})`
        ).bind(...showcaseIds).all(),
      ])
      : [{ results: [] }, { results: [] }];

    const showcase = showcaseRows.results.map(row => {
      const credits = designerRows.results.filter(d => d.project_id === row.id);
      // Aynı mimar/firma bir projeye birden fazla project_designers satırıyla bağlanmış olabilir
      // (ör. hem kurucu hem ayrı künye satırı) — slug'a göre tekilleştirilir.
      const uniqueBy = (rows, slugKey, nameKey) => {
        const seen = new Set();
        const out = [];
        for (const c of rows) {
          if (!c[slugKey] || seen.has(c[slugKey])) continue;
          seen.add(c[slugKey]);
          out.push({ name: c[nameKey], slug: c[slugKey] });
        }
        return out;
      };
      return {
        slug: row.slug,
        title: row.title,
        location: row.location || '',
        year: row.project_date || '',
        image: firstImage(row.images),
        architects: uniqueBy(credits, 'architect_slug', 'architect_name'),
        offices: uniqueBy(credits, 'office_slug', 'office_name'),
        products: linkedProductRows.results
          .filter(p => p.project_id === row.id)
          .map(p => ({ slug: p.slug, title: p.title, brand: p.brand_name_raw || '', image: firstImage(p.images) })),
      };
    });

    // Marka → Ürün → Teknik dosya zinciri (bkz. neden-mimarlab.html#urunler): teknik dosyası
    // GERÇEKTEN yüklü, yayındaki en güncel 3 ürün.
    const fileProductRows = await env.DB.prepare(
      `SELECT pr.slug, pr.title, pr.category, pr.images, pr.files, pr.brand_name_raw,
              o.slug AS brand_slug, o.name AS brand_name
       FROM products pr
       LEFT JOIN offices o ON o.id = pr.brand_office_id AND o.deleted_at IS NULL AND o.hidden_at IS NULL
       WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL
         AND pr.files IS NOT NULL AND pr.files NOT IN ('', '[]')
       ORDER BY pr.updated_at DESC, pr.id DESC
       LIMIT 3`
    ).all();

    const fileShowcase = fileProductRows.results.map(row => ({
      slug: row.slug,
      title: row.title,
      category: row.category || '',
      image: firstImage(row.images),
      brand: row.brand_name || row.brand_name_raw || '',
      brandSlug: row.brand_slug || null,
      formats: fileFormats(row.files),
    }));

    return {
      counts: {
        projects: countsRow?.projects || 0,
        architects: architectPool.length,
        offices,
        brands,
        // urun.html ürün VE yapı malzemesi kayıtlarını TEK listede gösterir — "Ürün" sayacı da o
        // listenin toplamıdır; `materials` yalnızca bilgi amaçlı bir alt kırılımdır.
        products: productPool.length,
        materials: countsRow?.materials || 0,
        productsWithFiles: countsRow?.productsWithFiles || 0,
        projectProductLinks: countsRow?.projectProductLinks || 0,
      },
      showcase,
      fileShowcase,
    };
  });
}

function firstImage(imagesJson) {
  try { const arr = imagesJson ? JSON.parse(imagesJson) : []; return arr[0] || null; } catch { return null; }
}

// files JSON: [{url, filename, format, size}] (bkz. urun-ekle.html#collectProductFiles). Sayfada
// yalnızca biçim rozetleri ("PDF", "DWG" ...) gösterildiğinden URL/boyut hiç dışarı verilmez.
function fileFormats(filesJson) {
  try {
    const arr = filesJson ? JSON.parse(filesJson) : [];
    const out = [];
    for (const f of Array.isArray(arr) ? arr : []) {
      const fmt = String(f?.format || '').trim().toUpperCase();
      if (fmt && !out.includes(fmt)) out.push(fmt);
    }
    return out.slice(0, 4);
  } catch { return []; }
}
