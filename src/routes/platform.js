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
    const [countsRow, architectPool, officePool, productPool] = await Promise.all([
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
    ]);

    // marka.html ve firma.html'in AYNI havuz üzerinde uyguladığı iki predicate (bkz.
    // src/routes/office.js#passes ve office-kind.js).
    const brands = officePool.filter(o => isBrandOffice(o.cats, o.productCount)).length;
    const officeList = officePool.filter(o => !isPureBrandOffice(o.cats, o.productCount));
    const offices = officeList.length;

    // "Firmanızın dijital künyesi" bölümünün canlı önizlemesi için TEK bir firma slug'ı (kullanıcı
    // isteği, 2026-09-05 madde 2: "Hepsi dinamik ögeler olsun"). Sayfa bu slug'ı ELLE TAŞIYORDU
    // (`eaa-emre-arolat-architecture`) — o firma gizlenir/silinir ya da adı değişip slug'ı kayarsa
    // bölüm sessizce tamamen kaybolurdu (sayfanın kendi drop() dalı). Seçim: logosu olan, en çok
    // projesi bulunan firma; marka kayıtları (isPureBrandOffice) zaten dışarıda, çünkü bölümün
    // anlatısı tasarım firmaları için.
    const officeShowcase = officeList
      .filter(o => o.logo && o.projectCount >= 3)
      .sort((a, b) => b.projectCount - a.projectCount)[0] || null;

    // KALDIRILDI (2026-09-05): burada `showcase` vardı — en yeni 3 projeyi künyesi ve bağlı
    // ürünleriyle döndüren üç ek D1 sorgusu. Onu tüketen tek şey neden-mimarlab.html'in #demo
    // zinciriydi; o bölüm 2026-09-02 sadeleştirmesinde markup'tan çıkmış, betiği ise 2026-09-05'te
    // ölü kod olarak temizlendi (bkz. o dosyadaki not). Payload'da tutulması her önbellek
    // ıskasında karşılıksız üç sorgu demekti. Sayfa artık aynı anlatıyı aşağıdaki
    // hotspotShowcase ile (proje -> işaretli ürün -> marka) veriyor.

    // ---- İŞARETÇİLİ PROJE ÖRNEKLERİ (kullanıcı isteği, 2026-09-05 madde 2) ----
    // "Neden MİMARLAB? sayfasına hotspotla proje örnekleri koy. Projeler yenilendi, bu sayfadaki
    // gerekli bilgileri de yenile. Hepsi dinamik ögeler olsun."
    //
    // ÖNCEKİ DURUM (bu isteğin çözdüğü asıl sorun): sayfa işaretçi örneğini SABİT bir slug'dan
    // (`/api/project/oyakkent-ornek-daire`) çekiyordu ve üretici bölümünün görseli de elle yazılmış
    // bir R2 URL'siydi. O proje gizlenirse/silinirse ya da işaretçileri kaldırılırsa sayfanın iki
    // bölümü birden sessizce boşalır. Artık işaretçisi GERÇEKTEN olan projeler buradan, canlı
    // veriden gelir ve sayfa aralarından seçer.
    //
    // İşaretçiler D1'de yalnızca {x,y,slug,title} taşır; sayfadaki önizleme kartı marka ve ürün
    // görseli de gösterdiğinden bunlar (proje detay ucundaki enrichImageHotspots ile AYNI mantıkla)
    // TEK bir IN(...) sorgusuyla products'tan taze okunur. Silinmiş/gizlenmiş ürünün işaretçisi
    // tamamen düşer — tıklanınca 404'e götüren bir daire, hiç olmayandan kötüdür.
    const hotspotProjectRows = await env.DB.prepare(
      `SELECT p.slug, p.title, p.location, p.project_date, p.images, p.image_hotspots
       FROM projects p
       WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL
         AND p.image_hotspots IS NOT NULL AND p.image_hotspots NOT IN ('', '{}')
         AND p.images IS NOT NULL AND p.images NOT IN ('', '[]')
       ORDER BY p.updated_at DESC, p.id DESC
       LIMIT 12`
    ).all();
    const hotspotShowcase = await buildHotspotShowcase(env, hotspotProjectRows.results);

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
      hotspotShowcase,
      officeShowcaseSlug: officeShowcase ? officeShowcase.slug : null,
      fileShowcase,
    };
  });
}

// Ham `image_hotspots` satırlarını sayfanın doğrudan çizebileceği hâle getirir: proje başına TEK
// görsel (işaretçisi EN ÇOK olan kare — sunum için en zengin örnek) + o karenin ürünleri.
// Ürünler tek bir toplu sorguda okunur (proje başına sorgu AÇILMAZ).
async function buildHotspotShowcase(env, rows) {
  const parsed = [];
  for (const row of rows) {
    let hotspots = {};
    try { hotspots = JSON.parse(row.image_hotspots || '{}'); } catch { hotspots = {}; }
    if (!hotspots || typeof hotspots !== 'object' || Array.isArray(hotspots)) continue;
    let images = [];
    try { images = JSON.parse(row.images || '[]'); } catch { images = []; }
    // Yalnızca projenin GALERİSİNDE hâlâ duran görseller — proje sahibi bir kareyi kaldırdığında
    // ona ait işaretçiler D1'de kalabiliyor (anahtar URL, indeks değil), o kareyi göstermek 404
    // veren bir görsel demekti.
    let best = null;
    for (const [url, list] of Object.entries(hotspots)) {
      if (!Array.isArray(list) || !list.length) continue;
      if (Array.isArray(images) && images.length && !images.includes(url)) continue;
      if (!best || list.length > best.list.length) best = { url, list };
    }
    if (!best) continue;
    parsed.push({ row, url: best.url, list: best.list });
  }
  if (!parsed.length) return [];

  const slugs = [...new Set(parsed.flatMap(p => p.list.map(h => h && h.slug).filter(Boolean)))].slice(0, 300);
  const bySlug = new Map();
  if (slugs.length) {
    const { results } = await env.DB.prepare(
      `SELECT pr.slug, pr.title, pr.images, COALESCE(o.name, pr.brand_name_raw, '') AS brand
       FROM products pr
       LEFT JOIN offices o ON o.id = pr.brand_office_id AND o.deleted_at IS NULL AND o.hidden_at IS NULL
       WHERE pr.slug IN (${slugs.map(() => '?').join(', ')})
         AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL`
    ).bind(...slugs).all();
    for (const r of results) bySlug.set(r.slug, { slug: r.slug, title: r.title, brand: r.brand, image: firstImage(r.images) });
  }

  const out = [];
  for (const p of parsed) {
    const points = p.list
      .map(h => (h && bySlug.has(h.slug)) ? { x: h.x, y: h.y, ...bySlug.get(h.slug) } : null)
      .filter(Boolean);
    // Ürünlerinin tamamı silinmiş bir kareyi örnek diye göstermek, işaretçisiz bir fotoğraf
    // göstermek demek olurdu — anlatının tamamı işaretçilerin üzerine kurulu.
    if (!points.length) continue;
    out.push({
      slug: p.row.slug,
      title: p.row.title,
      location: p.row.location || '',
      year: p.row.project_date || '',
      image: p.url,
      points,
      brands: [...new Set(points.map(pt => pt.brand).filter(Boolean))],
    });
    if (out.length >= 6) break;
  }
  return out;
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
