import { json, errorJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { cachedPublicJson, getCachedPool, getCachedFingerprint } from '../lib/publicCache.js';
import { entityFingerprint } from '../lib/entityStats.js';
import { foldedPrefixThenSubstring, escapeLike } from '../lib/searchFold.js';
import { getCachedFacetCounts } from '../lib/facetCounts.js';
import { fetchOwnerByline } from '../lib/ownerByline.js';
import { serializePublicEntity } from '../lib/serializePublicEntity.js';
import { BC_DATE_BUCKET } from '../lib/submissionTypes.js';
import { canUserEditProjectBySlug } from '../lib/projectClaimAccess.js';
// Proje "havuz" mantığı (fetchActiveProjectPool/buildFilterGroups + shapeProjectItem ve
// destekleyicileri) src/lib/projectPool.js'e taşındı (bkz. o dosyanın başındaki yorum) — bu route
// dosyası ile src/lib/facetCounts.js aynı fonksiyonları artık ORTAK, doğru katmandan (lib) import
// eder; davranış değişmedi, yalnızca konum (denetim bulgusu, 2026-08-14: lib routes'a bağımlıydı).
import {
  DESIGNER_SEP, DESIGNER_JOIN_SQL, OFFICE_NAMES_SQL,
  shapeProjectItem, isOfficeName, ratingBuckets,
  fetchActiveProjectPool, buildFilterGroups,
} from '../lib/projectPool.js';
import { fetchAdjacentEntity } from '../lib/adjacentEntity.js';
// bkz. src/routes/office.js'teki AYNI CJS-interop yorumu — canonical veri DEĞİL, salt statik bir
// sınıflandırma referansı. Burada yalnızca "Fotoğrafçı veya Kaynak" önerilerinde bir ofisin
// FİRMA mı MARKA mı diye etiketlenmesi için kullanılır (bkz. handlePhotographerSearchRoute).
import officeKindJs from '../../office-kind.js';

const { isBrandOffice } = officeKindJs;

// Faz 3 — statik projeler-data.js + project_submissions overlay yerine doğrudan canonical
// `projects`/`project_designers` tablolarından okur (bkz. src/routes/architect.js'teki AYNI
// "overlay merge-time'da zaten uygulandı" yorumu, docs/architecture-roadmap.md Faz3 madde 1).

// Proje modalının künyesindeki zengin mimar/firma "chip"leri (fotoğraf/logo + kendi profil linki)
// için — shapeProjectItem'daki düz `designer` isim dizisi liste/filtre uçlarıyla PAYLAŞILDIĞINDAN
// (bkz. fetchActiveProjectPool/handleProjectFiltersRoute, aynı isim eşleştirmesine dayanıyorlar)
// orada değiştirilmez; bu yalnızca tekil proje detayında ek bir sorguyla doldurulan ayrı bir alan.
async function fetchDesignerDetails(env, projectId) {
  const { results } = await env.DB.prepare(
    `SELECT pd.architect_id, pd.office_id,
            ar.name AS ar_name, ar.slug AS ar_slug, ar.photo_url AS ar_photo,
            ofc.name AS ofc_name, ofc.slug AS ofc_slug, ofc.logo_url AS ofc_logo
     FROM project_designers pd
     LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL AND ar.hidden_at IS NULL
     LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL AND ofc.hidden_at IS NULL
     WHERE pd.project_id = ?`
  ).bind(projectId).all();
  return results
    .map(r => r.architect_id
      ? (r.ar_name ? { name: r.ar_name, type: 'architect', slug: r.ar_slug, photo: r.ar_photo || null } : null)
      : (r.ofc_name ? { name: r.ofc_name, type: 'office', slug: r.ofc_slug, photo: r.ofc_logo || null } : null))
    .filter(Boolean);
}

// Künyedeki "Fotoğraf:" satırındaki isimlerden MİMARLAB'da gerçekten bir profili olanlar (kullanıcı
// isteği, 2026-09-01 madde 6) — fetchDesignerDetails'in fotoğrafçı karşılığı, kaynağı
// project_photographers (bkz. migrations/0080_project_photographers.sql). Eşleşmeyen isimler burada
// HİÇ dönmez; künye onları serbest metin olarak photoCredit.text'ten göstermeye devam eder (bkz.
// js/components/project-meta.js#renderMeta).
async function fetchPhotographerDetails(env, projectId) {
  const { results } = await env.DB.prepare(
    `SELECT ar.name, ar.slug, ar.photo_url FROM project_photographers pp
     JOIN architects ar ON ar.id = pp.architect_id AND ar.deleted_at IS NULL AND ar.hidden_at IS NULL
     WHERE pp.project_id = ?`
  ).bind(projectId).all();
  return results.map(r => ({ name: r.name, slug: r.slug, photo: r.photo_url || null }));
}

// proje-ekle.html'in Mimar/Firma alanlarına yazılan ama architects/offices'te eşleşen bir kaydı
// olmayan isimler resolveArchitectLink()/resolveOfficeLink() tarafından sessizce ATLANIYOR (bkz.
// src/lib/canonicalSync.js#syncProject — CHECK ((architect_id IS NOT NULL) != (office_id IS NOT
// NULL)) eşleşmeyen isim için project_designers'a hiçbir satır yazılmasına izin vermiyor, dolayısıyla
// künyede hiç görünmüyorlardı — bkz. kullanıcı isteği). Bu isimler hâlâ TEK yerde hayatta: onları
// oluşturan/son düzenleyen project_submissions.designer/office JSON dizileri (form'a yazıldığı
// haliyle, hiç mutasyona uğramaz). O satırı geriye doğru bulmak için canonicalSync'teki AYNI
// eşleştirmeyi (claimed_slug=slug YA DA legacy_key="submission:<id>") tersine kullanıyoruz; en son
// güncellenen satır esas alınır çünkü syncProject() her düzenlemede project_designers'ı BAŞTAN
// yazıyor (bkz. "DELETE FROM project_designers WHERE project_id = ?").
//
// office sütunu (bkz. migrations/0030_project_submission_office.sql) NULL ise bu satır o migration'dan
// ÖNCE kaydedilmiş demektir — Mimar/Firma kutuları o zaman TEK bir designer dizisinde birleştirilerek
// gönderiliyordu, bu yüzden isLegacy=true döner ve çağıran (handleProjectDetailRoute) eski
// isOfficeName() anahtar kelime tahminine düşmeye devam eder (kökten çözülemeyen, geriye dönük TEK
// durum — bkz. kullanıcı isteği: "Mevcut Veri Düzeltmesi", etkilenen satırlar ayrıca D1'de elle
// düzeltilir). office NOT NULL ise (satır bu düzeltmeden SONRA kaydedilmiş) isimler ARTIK KESİN
// kaynaklıdır — hiçbir tahmine gerek yok.
async function fetchRawDesignerNames(env, project) {
  const submissionId = (project.legacy_key || '').startsWith('submission:') ? project.legacy_key.slice('submission:'.length) : '';
  const row = await env.DB.prepare(
    `SELECT designer, office FROM project_submissions WHERE claimed_slug = ?1 OR id = ?2 ORDER BY updated_at DESC LIMIT 1`
  ).bind(project.slug, submissionId).first();
  if (!row) return { architects: [], offices: [], isLegacy: true };
  let architects = [];
  try { architects = row.designer ? JSON.parse(row.designer) || [] : []; } catch { architects = []; }
  if (row.office == null) return { architects, offices: [], isLegacy: true };
  let offices = [];
  try { offices = JSON.parse(row.office) || []; } catch { offices = []; }
  return { architects, offices, isLegacy: false };
}

// Önceki/Sonraki Proje — proje.html'deki grid'in o anki (filtrelenmiş/sıralanmış) sayfasını
// istemci hafızasında tutan eski `navList` yöntemi yerine (bkz. kullanıcı isteği: "kökten çözüm"),
// dairesel/sıralı gezinme artık HER İSTEKTE burada, id sırasına göre hesaplanır — proje doğrudan
// URL ile açıldığında ya da liste hiç yüklenmediğinde (F5, deep link) de butonlar eksiksiz çıkar.
// id küçüldükçe "sonraki" (daha eski), id büyüdükçe "önceki" (daha yeni) — uçlarda dairesel sarar.
// bkz. kullanıcı isteği: Önceki/Sonraki butonlarına önizleme görseli eklenmesi — images JSON
// dizisinin ilk elemanı, kart render'larındaki AYNI "kapak görseli" kuralıyla (bkz. yukarıdaki
// item.image = images[0]) alınır.
function firstImage(imagesJson) {
  try { const arr = imagesJson ? JSON.parse(imagesJson) : []; return arr[0] || null; } catch { return null; }
}

// buildStatus: önceki/sonraki gezinme kaynak projeyle AYNI kategoride kalır (bkz. kullanıcı
// isteği, migrations/0037_project_build_status.sql) — aksi halde "Sonraki" bir yapıdan bir
// konsept projeye (ya da tersi) sıçrayabilirdi.
async function fetchAdjacentProject(env, id, buildStatus) {
  const { prev, next } = await fetchAdjacentEntity(env, 'projects', id, {
    titleCol: 'title', imageCol: 'images', imageIsJsonArray: true,
    extraWhere: 'build_status = ?', extraBindValue: buildStatus,
  });
  return { prevProject: prev, nextProject: next };
}

// "Kullanılan Ürünler/Malzemeler" (bkz. js/components/project-products.js) — project_products
// join'inden o projeye bağlı ürün/malzemeleri okur, kind alanına göre iki gruba ayırır (bkz.
// migrations/0022_id_first_entities.sql). Bağlama proje-ekle.html'deki Firma/Ürün girişi
// onaylandığında src/lib/canonicalSync.js#resolveProjectProductLinks tarafından yapılır.
async function fetchProjectProducts(env, projectId) {
  // brands — "Kullanılan Markalar" (kullanıcı isteği, 2026-09-01 madde 5: proje popup'ındaki
  // "Kullanılan Ürünler" satırı iki sütuna bölünüp sağ tarafa markalar gelsin). Ürün zincirinin BİR
  // HALKA DEVAMI: proje → ürün → markası (offices). Marka eşleşmesi src/routes/office.js#
  // relatedBrandsRes ile BİREBİR AYNI kuraldır — önce brand_office_id, o boşsa marka ADI (toplu/
  // legacy eklenen ürünlerde brand_office_id boş kalır). used_count: markanın bu projede kullanılan
  // ürün sayısı; en çok kullanılan marka başa gelir.
  const [{ results }, { results: brandRows }] = await Promise.all([
    env.DB.prepare(
      `SELECT p.slug, p.title, p.brand_name_raw, p.category, p.kind, p.images
       FROM project_products pp JOIN products p ON p.id = pp.product_id
       WHERE pp.project_id = ? AND p.deleted_at IS NULL AND p.hidden_at IS NULL`
    ).bind(projectId).all(),
    env.DB.prepare(
      `SELECT b.slug, b.name, b.loc, b.logo_url, COUNT(DISTINCT pr.id) AS used_count
       FROM project_products pp
       JOIN products pr ON pr.id = pp.product_id AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL
       JOIN offices b ON b.deleted_at IS NULL AND b.hidden_at IS NULL
         AND (b.id = pr.brand_office_id OR (pr.brand_office_id IS NULL AND b.name = pr.brand_name_raw COLLATE NOCASE))
       WHERE pp.project_id = ?
       GROUP BY b.id
       ORDER BY used_count DESC, b.name COLLATE NOCASE`
    ).bind(projectId).all(),
  ]);
  const items = results.map(row => ({
    slug: row.slug, title: row.title, brand: row.brand_name_raw, category: row.category,
    kind: row.kind, image: firstImage(row.images),
  }));
  // Kartlar firma kartlarıyla AYNI şekle sahiptir (slug/name/loc/logo) — office-modal.js'teki
  // mevcut cardHtml/logoUrl yolu ile aynı işaretleme kullanılabilsin diye (bkz. office.js#relatedBrands).
  const brands = brandRows.map(b => ({ slug: b.slug, name: b.name, loc: b.loc, logo: b.logo_url, usedCount: b.used_count || 0 }));
  return { products: items.filter(i => i.kind !== 'material'), materials: items.filter(i => i.kind === 'material'), brands };
}

// Mimarı girilmemiş, sadece Mimarlık Firması tanımlı projeler (ör. Foster + Partners'ın Dolunay
// Villa'sı, bkz. kullanıcı isteği) için "Mimar:" alanı boş kalmasın diye firmanın office_founders
// kayıtlarını otomatik doldurur. Yalnızca kayıtlı (unregistered OLMAYAN, gerçek bir offices satırına
// bağlı) firmalar için çalışır — kaydı olmayan bir firma adı için kurucu sorgusu zaten sonuçsuz kalır.
// Faz 4A — N+1 düzeltmesi: officeNames listesi eskiden tek tek sorgulanıyordu (bir proje birden
// fazla ofis içerdiğinde D1'e ofis sayısı kadar ayrı round-trip); tek bir IN(...) sorgusuna
// indirgendi (bkz. kullanıcı isteği: Phase 4A N+1 temizliği).
async function fetchFoundersForOffices(env, officeNames) {
  if (!officeNames.length) return [];
  const placeholders = officeNames.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(
    `SELECT ar.name, ar.slug, ar.photo_url FROM office_founders f
     JOIN offices o ON o.id = f.office_id AND o.deleted_at IS NULL AND o.hidden_at IS NULL
     JOIN architects ar ON ar.id = f.architect_id AND ar.deleted_at IS NULL AND ar.hidden_at IS NULL
     WHERE o.name IN (${placeholders})`
  ).bind(...officeNames).all();
  return results.map(r => ({ name: r.name, type: 'architect', slug: r.slug, photo: r.photo_url }));
}

// GET /api/project/:slug/can-edit — oturum açmış kullanıcının bu projeyi düzenleyip arşivleyip/
// silebilip silemeyeceğini döner (bkz. js/components/project-actions.js#mountOwnerActions,
// proje-ekle.html#prefillForClaim) — künyedeki bir mimar/firmayı onaylı bir profile_claims ile
// sahiplenen kullanıcılar da admin gibi düzenleyebilir (bkz. src/lib/projectClaimAccess.js dosya
// başı yorumu, kullanıcı isteği). Oturum yoksa sessizce false döner, 401 fırlatmaz — çağıranlar bunu
// "Düzenle" butonunu göstermeyip göstermeme kararı için kullanıyor.
// GET /api/photographers/search?q=... — proje-ekle.html'deki Kaynak/Fotoğrafçı kutusunun
// autocomplete'i.
//
// KAYNAK ARTIK TEK: `architects` (yani siteye KİŞİ olarak yüklenmiş profiller) — kullanıcı isteği
// (2026-09-01: "Kaynak / Fotoğrafçı kutucuğunun altında sadece siteye kişi olarak yüklenen isimler
// öneri olarak çıksın"). Önceden buraya projects.photo_credit_text'ten türetilen SERBEST METİN de
// karışıyordu ve o metin çoğu satırda tek bir kişi değil, künyenin tamamıydı: "Cem Sorguç, Cemal
// Emden", "Four Seasons Hotel, Cemal Emden" gibi öneriler çıkıyordu (bkz. kullanıcı ekran görüntüsü)
// — seçildiğinde hiçbir profile bağlanmayan, üstelik künyeyi bozan değerler.
//
// Fotoğrafçı profilleri architects tablosunda, profession alanında "Fotoğrafçı" etiketiyle yaşar
// (bkz. migrations/0080_project_photographers.sql başlığı — kişi başına TEK profil, çoklu meslek),
// bu yüzden önce onlar sıralanır; kalan kişiler de önerilir çünkü künyedeki isim her zaman
// "Fotoğrafçı" olarak etiketlenmiş olmayabilir. Öneriden bir isim seçmek, kaydedildiğinde
// project_photographers kenarını da kurar (bkz. src/lib/canonicalSync.js#syncProject) ve o kişinin
// popup'ında "Fotoğrafladığı Projeler" bölümünü doldurur.
//
// GENİŞLETME (kullanıcı isteği, 2026-09-03 madde 1): "Fotoğrafçı veya Kaynak kutucuğunda bir şeyler
// yazılmaya başlandığında öneri olarak Kişi sayfasına yüklü olanlar, firmalar ve markalar çıksın."
// Kaynak çoğu zaman bir kişi DEĞİLDİR — künyedeki fotoğraf kaynağı bir mimarlık ofisi (kendi
// arşivinden görsel veren firma), bir fotoğraf stüdyosu ya da bir MARKA (ürün görselini kendi
// kataloğundan veren üretici) olabilir. Bu yüzden `offices` de aynı kutuya beslenir; satırın alt
// etiketinde firma mı marka mı olduğu görünür (office-kind.js#isBrandOffice — TEK sınıflandırma
// kaynağı). isBrandOffice'e productCount 0 verilir: sayım için ürün tablosuna ayrı bir JOIN atmak
// tuş vuruşu başına çalışan bu uç için gereksiz D1 yüküdür ve kendini 'Ürün' olarak etiketlememiş
// ama ürünü olan bir ofis (Autoban) yalnızca "Firma" etiketi alır — seçildiğinde künyeye yazılan
// DEĞER iki durumda da ofisin ADI olduğundan bu etiket farkının veriye hiçbir etkisi yoktur.
const CREDIT_SUGGEST_PER_SOURCE = 5;

export async function handlePhotographerSearchRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const q = foldTr((url.searchParams.get('q') || '').trim());
    // D1 audit (2026-08-25) P1-6 — bkz. product.js#handleProductSearchRoute'taki AYNI gerekçe.
    // Boş q (odaklanınca ilk fotoğrafçıları göster) BİLEREK muaf: yalnızca 1 karakterlik gürültülü
    // kısmi aramalar D1'e hiç gitmez.
    if (q && q.length < 2) return { items: [] };
    // name_fold: foldTr()'nin SQL karşılığı olan indexli generated column (bkz. migrations/0079) —
    // filtre Worker'a hiç satır taşımadan SQLite içinde uygulanır.
    const cond = q ? ` AND name_fold LIKE ? ESCAPE '\\'` : '';
    const params = q ? [`%${escapeLike(q)}%`] : [];
    // Ofis dalı q BOŞKEN çalıştırılmaz: boş kutuya odaklanma senaryosu "ilk fotoğrafçıları göster"
    // içindir, 745 ofisin alfabetik ilk beşini oraya koymak yalnızca gürültü olurdu.
    const [archRes, officeRes] = await Promise.all([
      env.DB.prepare(
        `SELECT name, profession FROM architects
         WHERE deleted_at IS NULL AND hidden_at IS NULL${cond}
         ORDER BY (profession LIKE '%Fotoğrafçı%') DESC, name COLLATE NOCASE
         LIMIT ${CREDIT_SUGGEST_PER_SOURCE}`
      ).bind(...params).all(),
      q ? env.DB.prepare(
        `SELECT name, loc, cats FROM offices
         WHERE deleted_at IS NULL AND hidden_at IS NULL${cond}
         ORDER BY name COLLATE NOCASE
         LIMIT ${CREDIT_SUGGEST_PER_SOURCE}`
      ).bind(...params).all() : Promise.resolve({ results: [] }),
    ]);
    // sub: kişinin ilk mesleği (architects.profession virgüllü ham Türkçe etiket listesidir, bkz.
    // migrations/0080 başlığı) — listede kimin fotoğrafçı olduğu tek bakışta görünür.
    const items = (archRes.results || []).map(r => ({
      label: r.name,
      sub: String(r.profession || '').split(',')[0].trim() || 'Kişi',
    }));
    const seen = new Set(items.map(it => foldTr(it.label)));
    for (const r of (officeRes.results || [])) {
      // Aynı ad hem kişi hem ofis olarak kayıtlıysa (fotoğraf stüdyoları tam olarak bu durumda —
      // bkz. office-kind.js'teki 'Fotoğrafçılık' hizmet alanı notu) satır iki kez listelenmez.
      const key = foldTr(r.name);
      if (seen.has(key)) continue;
      seen.add(key);
      const kindLabel = isBrandOffice(r.cats, 0) ? 'Marka' : 'Firma';
      items.push({ label: r.name, sub: [kindLabel, r.loc].filter(Boolean).join(' · ') });
    }
    return { items };
  });
}

// GET /api/projects/search?q=... — urun-ekle.html'deki YENİ "Kullanılan Projeler (opsiyonel)"
// kutusunun autocomplete'i (kullanıcı isteği, 2026-08-31: "Bu kutudan seçim, sitede halihazırda
// paylaşılan projeler arasından olsun"). src/routes/product.js#handleProductSearchRoute ile AYNI
// desen: adaylar dar bir sütun listesiyle çekilip foldTr ile JS tarafında filtrelenir, 2 karakterin
// altındaki sorgular D1'e hiç gitmez (bkz. o dosyadaki D1 audit P1-6 gerekçesi).
// `slug` de döner — kutu, seçilen projeyi başlıkla değil SLUG ile saklar (bkz. urun-ekle.html#
// projectChips, src/lib/canonicalSync.js#resolveProductProjectLinks), böylece aynı adlı iki proje
// karışmaz ve proje sonradan yeniden adlandırılsa bile bağ doğru kayda gider.
export async function handleProjectSearchRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const q = foldTr((url.searchParams.get('q') || '').trim());
    if (!q || q.length < 2) return { items: [] };
    // production audit (2026-09-01, madde B) — bkz. migrations/0079 + src/lib/searchFold.js:
    // eşleştirme indexli title_fold kolonu üzerinde SQLite içinde yapılıyor. Bu uç, dördü içinde
    // en çok kazanan: projects tablosu hem en büyük hem de en geniş satırlara sahip (images/
    // description JSON'ları), önceden hepsi her tuş vuruşunda Worker'a taşınıyordu.
    const rows = await foldedPrefixThenSubstring({
      runQuery: (sql, params) => env.DB.prepare(sql).bind(...params).all().then(r => r.results),
      sqlFor: (cond, limit) => `SELECT slug, title, location, project_date FROM projects
        WHERE deleted_at IS NULL AND hidden_at IS NULL ${cond} ORDER BY title LIMIT ${limit}`,
      foldColumn: 'title_fold',
      q, limit: 20, keyOf: r => r.slug,
    });
    const items = rows
      .map(r => ({ label: r.title, sub: [r.location, r.project_date].filter(Boolean).join(' · '), slug: r.slug }));
    return { items };
  });
}

export async function handleProjectCanEditRoute(request, env, rawSlug) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const user = await getSessionUser(request, env);
  if (!user) return json({ canEdit: false });
  const slug = decodeURIComponent(rawSlug || '');
  return json({ canEdit: await canUserEditProjectBySlug(env, user, slug) });
}

// Görsel üzerindeki ürün işaretçileri (bkz. migrations/0076_project_image_hotspots.sql) — D1'de
// yalnızca {x, y, slug, title} saklanır; önizleme kartının gösterdiği marka ve küçük görsel HER
// istekte products tablosundan TAZE okunur (tek bir IN(...) sorgusu, işaretçi başına değil). Böylece
// bir ürünün adı/markası/kapak görseli değiştiğinde onu işaretleyen tüm projeler kendiliğinden
// güncel kalır — denormalize edilseydi bayat başlık ve (R2 yolu değişince) kırık küçük görsellerle
// kalırdık. Ürün silinmişse işaretçi tamamen atılır: tıklanınca 404'e götüren bir daire, hiç
// olmayandan kötüdür.
async function enrichImageHotspots(env, hotspotsByUrl) {
  const urls = Object.keys(hotspotsByUrl || {});
  if (!urls.length) return {};
  const slugs = [...new Set(urls.flatMap(u => (hotspotsByUrl[u] || []).map(h => h.slug)).filter(Boolean))];
  if (!slugs.length) return {};
  // D1'in değişken sayısı sınırı (bkz. "Top 100 dynamic redesign" bulgusu — IN(...) parametre
  // limiti) sanitizeImageHotspots'un üst sınırları sayesinde (60 görsel x 30 işaretçi tekilleştirilmiş)
  // pratikte aşılamaz; yine de tek sorguda 300 slug ile sınırlanır.
  const capped = slugs.slice(0, 300);
  const placeholders = capped.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(
    `SELECT slug, title, brand_name_raw, images FROM products
     WHERE slug IN (${placeholders}) AND deleted_at IS NULL AND hidden_at IS NULL`
  ).bind(...capped).all();
  const bySlug = new Map(results.map(r => [r.slug, {
    slug: r.slug, title: r.title, brand: r.brand_name_raw || '', image: firstImage(r.images),
  }]));
  const out = {};
  for (const url of urls) {
    const list = (hotspotsByUrl[url] || []).map(h => {
      const product = bySlug.get(h.slug);
      return product ? { x: h.x, y: h.y, ...product } : null;
    }).filter(Boolean);
    if (list.length) out[url] = list;
  }
  return out;
}

// GET /api/project/:slug — Faz 4: proje.html'deki proje modalı bu uca bağlandı (eski yorum artık
// geçersiz), canonical D1'den doğrudan okur.
export async function handleProjectDetailRoute(request, env, url, rawSlug) {
  // P3-1 hardening tamamlaması (production audit, 2026-09-03): 4 ÇOĞUL liste ucu 2026'da
  // HEAD'i GET ile aynı route'a düşürmüştü (bkz. src/index.js#routeApi'deki o not) ama TEKİL
  // detay uçları GET-only kalmıştı — canlıda doğrulandı: HEAD /api/projects 200 dönerken
  // HEAD /api/project/:slug 404 dönüyordu. Aynı uç GET'te 200, HEAD'te 404 demek, standart
  // HTTP semantiğini bozar ve uptime/monitoring araçlarını yanıltır. Gövde Cloudflare
  // runtime'ı tarafından zaten atılır (liste uçlarında kanıtlı: HEAD -> 200, size=0).
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);
  const slug = decodeURIComponent(rawSlug || '');
  if (!slug) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, async () => {
    const row = await env.DB.prepare(
      `SELECT p.*, GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names, ${OFFICE_NAMES_SQL}
       FROM projects p ${DESIGNER_JOIN_SQL}
       WHERE p.slug = ? AND p.deleted_at IS NULL GROUP BY p.id`
    ).bind(slug).first();
    if (!row) return { item: null, hidden: false };
    if (row.hidden_at) return { item: null, hidden: true };
    const item = shapeProjectItem(row);
    const [designerDetails, rawNames, owner, photographerDetails] = await Promise.all([
      fetchDesignerDetails(env, row.id),
      fetchRawDesignerNames(env, row),
      fetchOwnerByline(env, row.claimed_by_user_id),
      fetchPhotographerDetails(env, row.id),
    ]);
    if (owner) Object.assign(item, owner);
    item.photographerDetails = photographerDetails;
    // Zaten eşleşmiş (profilli) isimlerin ÜZERİNE yazmayan, formda yazılan ama hiçbir profile
    // bağlanamamış isimler için künyede baş harfli, tıklanamaz bir "rozet" fallback'i (bkz. yukarıdaki
    // fetchRawDesignerNames yorumu ve kullanıcı isteği). rawNames.isLegacy=false (bkz. migrations/
    // 0030_project_submission_office.sql) ise Mimar/Firma ayrımı ARTIK TAHMİN edilmez — isim hangi
    // kutudan geldiyse (rawNames.architects/rawNames.offices) doğrudan o başlığa yazılır. Yalnızca
    // bu düzeltmeden ÖNCE kaydedilmiş (isLegacy=true, designer/office birleşik) satırlarda eski
    // isOfficeName() anahtar kelime tahminine düşülür — geriye dönük bozmama amaçlı, TEK istisna.
    const knownNames = new Set(designerDetails.map(d => d.name));
    if (rawNames.isLegacy) {
      for (const name of [...rawNames.architects, ...rawNames.offices]) {
        if (!name || knownNames.has(name)) continue;
        knownNames.add(name);
        designerDetails.push({ name, type: isOfficeName(name) ? 'office' : 'architect', slug: null, photo: null, unregistered: true });
      }
    } else {
      for (const name of rawNames.architects) {
        if (!name || knownNames.has(name)) continue;
        knownNames.add(name);
        designerDetails.push({ name, type: 'architect', slug: null, photo: null, unregistered: true });
      }
      for (const name of rawNames.offices) {
        if (!name || knownNames.has(name)) continue;
        knownNames.add(name);
        designerDetails.push({ name, type: 'office', slug: null, photo: null, unregistered: true });
      }
    }
    // Mimar alanı hiç doldurulmamışsa (bkz. yukarıdaki fetchFoundersForOffices yorumu) tanımlı
    // firma(lar)ın kurucu/ortak mimarlarını otomatik "Mimar:" chip'i olarak ekle — Mimar alanı boş kalmasın.
    // YALNIZCA rawNames.isLegacy=true iken (hiç modern gönderi satırı yok ya da 0030 migration'dan
    // ÖNCEki birleşik format) — bu durumda Mimar kutusunun gerçekten hiç doldurulmadığından emin
    // olamayız. isLegacy=false ise (proje-ekle.html'in modern, ayrı Mimar/Firma kutularından geçmiş
    // bir kayıt) architects[] boşsa bu KASITLI bir seçimdir (kullanıcı Mimar kutusunu elle boşalttı
    // olabilir, bkz. gerçek bulgu: Edirne II. Beyazıt Külliyesi — Mimar Sinan silinip kaydedildiğinde
    // bu fallback onu HER görüntülemede sessizce geri ekliyordu) — buraya asla düşülmez, künye
    // project_designers'ta gerçekten ne varsa onu gösterir.
    if (!designerDetails.some(d => d.type === 'architect') && rawNames.isLegacy) {
      const officeNames = designerDetails.filter(d => d.type === 'office' && !d.unregistered).map(d => d.name);
      const autoFounders = await fetchFoundersForOffices(env, officeNames);
      for (const founder of autoFounders) {
        if (knownNames.has(founder.name)) continue;
        knownNames.add(founder.name);
        designerDetails.push(founder);
      }
    }
    item.designerDetails = designerDetails;
    const adjacent = await fetchAdjacentProject(env, row.id, row.build_status === 'concept' ? 'concept' : 'built');
    item.prevProject = adjacent.prevProject;
    item.nextProject = adjacent.nextProject;
    const catalog = await fetchProjectProducts(env, row.id);
    item.products = catalog.products;
    item.materials = catalog.materials;
    item.brands = catalog.brands;
    // item.imageHotspots yalnızca dolu olduğunda var (bkz. shapeProjectItem) — boşsa enrich hiç
    // çalıştırılmaz, o projeler için ekstra bir products sorgusu da doğmaz.
    if (item.imageHotspots) item.imageHotspots = await enrichImageHotspots(env, item.imageHotspots);
    return { item, hidden: false };
  });
}

// fetchActiveProjectPool'un KV önbellekli sarmalayıcısı — architects/offices/products'ın
// getCachedPool desenindeki AYNI mantık (bkz. publicCache.js#getCachedPool dosya başı yorumu). YALNIZCA
// handleProjectListRoute/handleProjectFiltersRoute (public okuma yolları) burayı kullanır;
// facetCounts.js#recomputeProjectFacets bilerek HAM fetchActiveProjectPool'u doğrudan çağırmaya devam
// eder (bir yazma işleminden hemen sonra çalıştığından KV'deki olası bayat pool'u okursa facet_counts
// tablosuna YANLIŞ/eski sayaç yazardı — audit bulgusu, bkz. kullanıcı isteği "kritik maddeleri düzelt").
// Anahtar buildStatus'e göre ayrılır ('projects:built'/'projects:concept') çünkü ikisi tamamen ayrı
// havuzlardır; publicCache.js#invalidatePublicCache her ikisini de her admin/onay yazımında temizler.
export async function fetchActiveProjectPoolCached(env, buildStatus) {
  const status = buildStatus === 'concept' ? 'concept' : 'built';
  return getCachedPool(env, `projects:${status}`, () => fetchActiveProjectPool(env, status));
}

function trLower(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}

// trLower zaten BÜYÜK->küçük Türkçe eşlemesini doğru yapıyor ama bu yüzden ASCII "I" (ör. ALL-CAPS
// "SANKAI" gibi Türkçe olmayan/İngilizce yazılmış başlıklarda) küçük harfe 'ı' (noktasız) olarak
// döner — kullanıcı normal klavyeyle "sankai" yazdığında (zaten küçük 'i', trLower'dan etkilenmez)
// eşleşme kaçırılıyordu (gerçek bulgu: /api/projects?search=sankai 0 sonuç, ?search=SANKAI 1 sonuç
// dönüyordu). foldTr (bkz. src/routes/legacyContent.js/arama.html'deki AYNI desen, orada zaten bu
// sorunu çözüyordu) trLower'ın üstüne Türkçe harfleri ASCII benzerlerine de indirger (ı/i, ş/s, ç/c,
// ğ/g, ü/u, ö/o) — sorgu VE hedef metin AYNI foldTr'den geçirildiğinden hangi yazımla arandığından
// bağımsız tutarlı eşleşir.
function foldTr(s) {
  return trLower(s).replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
}

// project_date SERBEST METİN bir alan (admin panelinden elle girilir) — "1506-1513", "MÖ 360",
// "19. Yüzyıl", "MÖ 479 / MS 324", "4-5. yüzyıl / 1458", "16. yy / 2026" gibi çok çeşitli
// formatlarda olabilir (bkz. gerçek D1 verisi). Eski date_asc/date_desc karşılaştırıcısı sadece
// `parseInt(date, 10)` kullanıyordu — bu "19. Yüzyıl" gibi bir string'i "19" (MS 19 yılı) olarak
// okuyup MS 300'lü yıllardan bile ÖNCE sıralıyordu (gerçek bulgu: kullanıcı "En Eski" sıralamasında
// 19. yüzyıl projelerinin 4./5. yüzyıl projelerinden önce çıktığını bildirdi). parseProjectDateYear
// projenin en ERKEN (en eski) noktasını temsil eden tek bir sayısal yıl döndürür:
//   - "/" ile ayrılmış her parça (çoğunlukla "yapım / restorasyon" ya da "MÖ.../MS..." aralığı)
//     ayrı ayrı değerlendirilir, en küçük (en eski) sonuç kullanılır — restorasyon/ikinci parça
//     her zaman yapım tarihinden sonra olduğundan bu, verinin parça sırasından bağımsız çalışır.
//   - Bir parça "MÖ" içeriyorsa (foldTr üzerinden Türkçe harf bağımsız aranır) yıl(lar) NEGATİF
//     kabul edilir; parça içinde birden çok sayı varsa (ör. "MÖ 5500-3500") BÜYÜK olan seçilir,
//     çünkü MÖ'de büyük sayı = daha eski (MÖ 5500, MÖ 3500'den öncedir).
//   - Parça "yüzyıl"/"yy" içeriyorsa (ör. "4-5. yüzyıl", "19. yy") yüzyıl NUMARALARINDAN en erken
//     olanı (MÖ ise en BÜYÜK, MS ise en KÜÇÜK) o yüzyılın başlangıç yılına çevrilir (MS: (N-1)*100+1,
//     MÖ: -(N*100)) — böylece "4. yüzyıl" (MS 301) ile "330" gibi düz bir yıl doğru sırada karşılaştırılır.
//   - Aksi halde parçadaki sayılardan en küçüğü (MÖ ise en büyüğü, negatifleştirilerek) düz yıl
//     olarak kullanılır (mevcut "408-450" -> 408, "1506-1513" -> 1506 davranışı korunur).
//   - Hiçbir sayı bulunamazsa null döner (bilinmeyen tarih) — çağıran taraf bunu her iki yönde de
//     (en eski/en yeni) listenin SONUNA koyar, eskiden olduğu gibi rastgele "0" değeriyle diğer
//     tarihlerin arasına karışmaz.
//   - Gerçek bulgu: "MS 4. / 10. Yüzyıl" gibi bir "yüzyıl" sözcüğü SADECE ikinci parçaya ait tek
//     bir aralık, "/" ile bölününce ilk parça ("MS 4.") yüzyıl işaretini kaybediyor ve "4" düz yıl
//     sanılıyordu. 1-2 haneli, tek başına "N." (ops. "MS " önekiyle) şeklindeki bir parça, string'in
//     GENELİNDE yüzyıl sözcüğü geçiyorsa yine yüzyıl kabul edilir (isCenturyFragment) — 3+ haneli
//     sayılar (gerçek yıllar) bu sezgiye asla girmez, yanlış eşleşme riski yok.
// export: src/routes/ai.js (MİMARLAB AI, Faz 1) yıl aralığı filtrelemesi için AYNI ayrıştırıcıyı
// kullanır — proje.html'in tarih sıralamasıyla TUTARLI kalması için burada ikinci bir kopya
// açılmadı (bkz. dosya başı foldTr/trLower yorumu, aynı prensip).
export function parseProjectDateYear(dateStr) {
  if (!dateStr) return null;
  const hasCenturyWordAnywhere = /yuzyil|\byy\b/.test(foldTr(dateStr));
  let best = null;
  for (const rawSegment of String(dateStr).split('/')) {
    const folded = foldTr(rawSegment);
    const isBC = /\bmo\b/.test(folded);
    const isCenturyFragment = hasCenturyWordAnywhere && /^\s*(ms\s*)?\d{1,2}\.\s*$/.test(folded);
    const isCentury = isCenturyFragment || /yuzyil|\byy\b/.test(folded);
    const nums = (rawSegment.match(/\d+/g) || []).map(n => parseInt(n, 10));
    if (!nums.length) continue;
    let year;
    if (isCentury) {
      const century = isBC ? Math.max(...nums) : Math.min(...nums);
      year = isBC ? -(century * 100) : (century - 1) * 100 + 1;
    } else {
      const magnitude = isBC ? Math.max(...nums) : Math.min(...nums);
      year = isBC ? -magnitude : magnitude;
    }
    if (best === null || year < best) best = year;
  }
  return best;
}

function dateBucketSortKey(s) {
  // Milattan Önce her zaman en eski kategori — en küçük anahtarla listenin (en yeniden en eskiye
  // sıralanan) EN SONUNA düşer, herhangi bir yüzyıl/on yıl bucket'ından daha eski kabul edilir.
  if (s === BC_DATE_BUCKET) return -Infinity;
  let m = /^(\d+)\.\s*Yüzyıl$/.exec(s);
  if (m) return (parseInt(m[1], 10) - 1) * 100;
  m = /^(\d{4})'l/.exec(s);
  if (m) return parseInt(m[1], 10);
  m = /^(\d{4})-\d{2}$/.exec(s);
  if (m) return parseInt(m[1], 10);
  return 0;
}

// GET /api/projects/filters — proje.html#computeOptions'ın TAM karşılığı: her filtre grubunun
// sayacı, O GRUP HARİÇ diğer TÜM aktif filtrelerle eşleşen projeler üzerinden hesaplanır
// (faceted/bağımlı sayaç). Bu "diğer aktif filtrelerle bağımlı" hesap, facet_counts tablosunun (bkz.
// src/lib/facetCounts.js, Faz3 madde 5) düz global sayaç şekliyle KARŞILANAMAZ — o tablo yalnızca
// hiçbir filtre seçili değilken (ilk sayfa yüklemesindeki "Mimari (461)" durumu) hızlı bir KV
// önbelleği sağlar (bkz. handleProjectFiltersRoute'un facet_counts fast-path'i, aynı dosyada
// tanımlı); herhangi bir filtre aktifken bu tam tarama (artık canonical tablo üzerinden) çalışmaya
// devam eder — mevcut canlı davranışla birebir aynı.
// production audit (2026-09-01, P2): bu ucun gövdesinin ~%40'ı SAF TEKRAR idi. Her facet
// `{counts: {ad: sayı, ...}, options: [ad, ...]}` şeklinde dönüyordu — yani 459 tasarımcı adının
// TAMAMI hem counts'un anahtarları hem de options'ın elemanları olarak, İKİ KEZ serialize ediliyordu
// (yalnızca designer + designerOffice = 40,5 KB'lık yanıtın ~17 KB'ı). counts artık options ile
// AYNI SIRADA bir sayı dizisi: adlar bir kez yazılır, sayılar indexle eşleşir.
// İstemci (js/pages/proje.js#buildSidebar) her iki biçimi de okuyabilir — deploy anında edge'de
// duran eski gövdelerle (s-maxage=15) yeni JS'in karşılaşma ihtimaline karşı.
function facetPayload(counts, options) {
  return { options, counts: options.map(o => counts[o]) };
}

export async function handleProjectFiltersRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);

  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const buildStatus = url.searchParams.get('buildStatus') === 'concept' ? 'concept' : 'built';
    // Hızlı yol: buildStatus DIŞINDA HİÇBİR filtre/arama aktif değilse (proje.html'in ilk sayfa
    // yüklemesindeki durum), facet_counts + KV'den (bkz. src/lib/facetCounts.js) anlık oku — tam
    // tarama gerekmez. Bu KV önbelleği yalnızca 'built' projeler için hesaplanmıştır (bkz.
    // migrations/0037_project_build_status.sql — canlıdaki TÜM mevcut projeler bu kategoride); bu
    // yüzden buildStatus='concept' isteği bu yolu ASLA kullanmaz, her zaman aşağıdaki tam taramaya
    // düşer (proje.html'in konsept havuzu küçük olduğundan performans sorunu değildir). Yalnızca o
    // tablonun kapsadığı grupları (rating/district hariç, bkz. facetCounts.js dosya başı kapsam
    // notu) doldurur; istemci taraf zaten bu iki grup için kendi anlık hesabını korur, TAM sayaç
    // seti yalnızca herhangi bir filtre aktifken (aşağıdaki tam tarama yoluyla) hesaplanır.
    const otherParams = [...url.searchParams.keys()].filter(k => k !== 'buildStatus');
    if (otherParams.length === 0 && buildStatus === 'built') {
      const cached = await getCachedFacetCounts(env, 'projects');
      if (Object.keys(cached).length) {
        const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM projects WHERE deleted_at IS NULL AND hidden_at IS NULL AND build_status = 'built'`).first();
        const out = {};
        for (const [key, counts] of Object.entries(cached)) {
          const options = Object.keys(counts).sort((a, b) => (key === 'dateBucket' ? dateBucketSortKey(b) - dateBucketSortKey(a) : counts[b] - counts[a] || a.localeCompare(b)));
          out[key] = facetPayload(counts, options);
        }
        return { filters: out, total: totalRow?.n || 0 };
      }
    }

    // Bu blok ÖNCEDEN kendi ayrı `p.*` JOIN sorgusunu çalıştırıyordu — handleProjectListRoute'daki
    // fetchActiveProjectPool ile İÇERİK OLARAK aynı satırları (yalnızca images tam/kısaltılmış farkıyla,
    // bu grup buildFilterGroups'un hiç okumadığı bir alan) ayrı ayrı tarıyordu; bir filtreli sayfa
    // görünümü bu yüzden İKİ tam tabloya scan'e mal oluyordu (audit bulgusu). Artık AYNI KV önbellekli
    // havuzu (fetchActiveProjectPoolCached) paylaşıyor.
    const [pool, ratingRows] = await Promise.all([
      fetchActiveProjectPoolCached(env, buildStatus),
      env.DB.prepare(`SELECT target_id, AVG(stars) AS average FROM ratings WHERE target_type = 'project' GROUP BY target_id`).all(),
    ]);

    const ratingByProject = new Map(ratingRows.results.map(r => [r.target_id, { average: r.average }]));

    const FILTER_GROUPS = buildFilterGroups(ratingByProject);
    const activeFilters = {};
    FILTER_GROUPS.forEach(g => { activeFilters[g.key] = new Set(url.searchParams.getAll(g.key)); });
    const searchQuery = foldTr((url.searchParams.get('search') || '').trim());

    function matchesLocalSearch(p) {
      if (!searchQuery) return true;
      const fields = [p.title, p.location, p.locationDetail, ...(p.designer || [])];
      return fields.some(v => v && foldTr(String(v)).includes(searchQuery));
    }
    function passesFilters(p, exceptKey) {
      if (!matchesLocalSearch(p)) return false;
      return FILTER_GROUPS.every(g => {
        if (g.key === exceptKey) return true;
        const sel = activeFilters[g.key];
        if (sel.size === 0) return true;
        const vals = g.field(p);
        return vals.some(v => sel.has(v));
      });
    }

    const out = {};
    for (const g of FILTER_GROUPS) {
      const passing = pool.filter(p => passesFilters(p, g.key));
      const counts = {};
      passing.forEach(p => { g.field(p).forEach(v => { if (v) counts[v] = (counts[v] || 0) + 1; }); });
      const options = Object.keys(counts).sort((a, b) => {
        if (g.key === 'dateBucket') return dateBucketSortKey(b) - dateBucketSortKey(a);
        return counts[b] - counts[a] || a.localeCompare(b);
      });
      out[g.key] = facetPayload(counts, options);
    }
    return { filters: out, total: pool.filter(p => passesFilters(p, null)).length };
  });
}

// handleProjectListRoute'daki sort switch'inin BİREBİR eşlemesi (bkz. o dosyadaki case listesi) —
// yalnızca bu beş değer pool'un D1'den gelen id DESC sırasını GERÇEKTEN değiştirir (Türkçe
// localeCompare, tarih parseInt'i, rating join'i ya da (random) bir shuffle gerektirir); '' dahil
// BAŞKA HER değer switch'in default dalına düşüp no-op kalır (bkz. "sort boşsa ek sıralama gerekmez"
// yorumu). random: js/components/project-related.js#RelatedProjects/CityProjects'in aday toplama
// sorguları için (bkz. kullanıcı isteği: "hep siteye yeni yüklenen projeler çıkıyor, eskiden
// yüklenmiş projeler de önerilsin") — sort verilmeyen (id DESC = en yeni önce) ya da rating_desc
// (puanı olmayanlar id DESC sırasında kalır) sorgular LIMIT'e çarptığında havuz sistematik olarak
// en yeni projelere kayıyordu; random ise filtered'ı LIMIT'ten ÖNCE karıştırarak eski/yeni
// projelere eşit şans tanır.
const SORT_REQUIRES_JS_FILTER = new Set(['name_asc', 'date_desc', 'date_asc', 'rating_desc', 'random']);

// D1 hızlı-yolun (fetchProjectListPageFromD1) devreye girip giremeyeceğini belirler — buildFilterGroups'un
// KENDİ anahtar listesinden türetilir (bkz. kullanıcı isteği: ayrı bir sabit listeyle elle
// senkronize tutmak yerine, yeni bir filtre grubu eklendiğinde burası KENDİLİĞİNDEN güncel kalır).
// `url.searchParams.has(key)` — passesFilters'taki `new Set(getAll(key)).size > 0` ile BİREBİR aynı
// koşul (bir parametre en az bir kez, boş değerle bile verilmişse "aktif" sayılır).
function hasActiveProjectListFilters(url) {
  const filterKeys = buildFilterGroups(new Map()).map(g => g.key);
  if (filterKeys.some(k => url.searchParams.has(k))) return true;
  return !!(url.searchParams.get('search') || '').trim();
}

// fetchActiveProjectPool'daki (yukarıda) AYNI açık sütun listesi + JOIN/GROUP BY + ORDER BY
// (bkz. o dosyadaki publish_date/created_at yorumu) — tek fark LIMIT/OFFSET eklenmesi.
//
// performance audit (2026-09-01, P1) — LIMIT/OFFSET önceden DIŞ sorguda duruyordu. SQLite bu
// durumda önce TÜM aktif projeleri (1667) project_designers/architects/offices ile join'leyip
// GROUP BY yapmak, sonra hepsini bir temp B-tree'de sıralamak ZORUNDA kalıyordu; 24 satır dönmek
// için canlıda ÖLÇÜLEN maliyet: rows_read=10.394, 30,5 ms — ve `idx_projects_build_status_order`
// (tam olarak bu sıralama için var olan kısmi index) hiç kullanılamıyordu (EXPLAIN QUERY PLAN:
// "SEARCH p USING INDEX idx_projects_build_status" + "USE TEMP B-TREE FOR ORDER BY").
// LIMIT/OFFSET'i bir alt sorguya taşımak, sayfayı ÖNCE (yalnızca projects tablosundan, doğru
// index'le) seçip join'i yalnızca o 24 satır için çalıştırır: rows_read=131, 3,6 ms (-%98,7).
// ORDER BY dışta AYNEN tekrarlanır — join sonrası satır sırası garanti değildir.
// Sonuç eşitliği canlı D1'de doğrulandı: offset 0 / 48 / 960 için eski ve yeni sorgunun döndürdüğü
// (id, slug, designer_names, office_names) satırları BİREBİR aynı.
async function fetchProjectPageRows(env, buildStatus, limit, offset) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.slug, p.title, p.category, p.type, p.discipline, p.location, p.location_detail,
            p.project_date, p.date_bucket, p.period, p.description, p.images, p.photo_credit_text,
            p.photo_credit_url, p.build_status, p.concept_category, p.awards, p.lat, p.lng,
            GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names, ${OFFICE_NAMES_SQL}
     FROM (SELECT * FROM projects
           WHERE deleted_at IS NULL AND hidden_at IS NULL AND build_status = ?
           ORDER BY COALESCE(publish_date, created_at) DESC, id DESC
           LIMIT ? OFFSET ?) p ${DESIGNER_JOIN_SQL}
     GROUP BY p.id ORDER BY COALESCE(p.publish_date, p.created_at) DESC, p.id DESC`
  ).bind(buildStatus, limit, offset).all();
  return results;
}

// performance audit (2026-09-01, P1) — `description` (proje metninin TAMAMI, ortalama ~2,3 KB)
// /api/projects yanıtının %80'ini oluşturuyordu (ölçüm: ?limit=24 -> 69 KB'ın 56 KB'ı, ?limit=96 ->
// 264 KB). Kart render eden HİÇBİR tüketici bu alanı okumuyor — tek tek doğrulandı: js/pages/proje.js
// (kart şablonu), index.html (ana sayfa karuseli), js/components/project-related.js (İlgili Yapılar /
// Mimarın Diğer Yapıları, ?limit=96 ile SAYFA SAYFA tüm havuzu geziyor), admin.html#top100 ekleme
// autocomplete'i. Proje AÇIKLAMASINI gerçekten gösteren tek yer proje pop-up'ı, o da AYRI bir uçtan
// (`/api/project/:slug`, handleProjectDetailRoute) besleniyor ve DEĞİŞMEDİ.
// shapeProjectItem'ın KENDİSİ bilerek değiştirilmedi: havuzu (fetchActiveProjectPoolCached) MİMARLAB
// AI de tüketiyor ve serbest metin anahtar kelime eşleşmesi için description'a ihtiyaç duyuyor
// (bkz. src/routes/ai.js#matchesFilters) — budama yalnızca bu ucun YANIT şekline uygulanır.
// NOT: bu bir YANIT ŞEKLİ değişikliğidir — src/lib/publicCache.js#API_PAYLOAD_VERSION bu yüzden
// artırıldı (aksi halde dönen ziyaretçiler eski ETag'le 304 alıp eski gövdede takılırdı).
function stripListOnlyFields(p) {
  const { description, ...rest } = p;
  return rest;
}

// handleProjectListRoute'daki ratingBySlug oluşturma döngüsüyle BİREBİR AYNI eşleştirme mantığı
// (bkz. o dosyadaki "target_id proje slug'ı değil id'si olabilir" notu — burada da AYNI belirsiz
// target_id değeri, sayfadaki projelerin slug'larıyla IN(...) eşleştirilir, davranış korunur) —
// tek fark tüm `ratings` tablosu yerine yalnızca bu sayfadaki slug'larla sınırlı bir sorgu.
async function fetchRatingsForSlugs(env, slugs) {
  const ratingBySlug = new Map();
  if (!slugs.length) return ratingBySlug;
  const placeholders = slugs.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(
    `SELECT target_id, AVG(stars) AS average, COUNT(*) AS count FROM ratings
     WHERE target_type = 'project' AND target_id IN (${placeholders}) GROUP BY target_id`
  ).bind(...slugs).all();
  results.forEach(r => ratingBySlug.set(r.target_id, { average: r.average, count: r.count }));
  return ratingBySlug;
}

// handleProjectListRoute'un hiçbir filtre/arama aktif olmadığındaki (bkz. hasActiveProjectListFilters)
// D1-seviyeli hızlı yolu. `total`/`totalPages`/`page` hesaplaması handleProjectListRoute'daki JS
// yoluyla BİREBİR AYNI formülü kullanır (bkz. aşağıdaki Math.min(page,totalPages) kırpması) — TEK
// fark COUNT(*) ve sayfa satırlarının D1'den zaten süzülmüş gelmesi.
async function fetchProjectListPageFromD1(env, buildStatus, page, limit) {
  const where = `deleted_at IS NULL AND hidden_at IS NULL AND build_status = ?`;
  const rawOffset = (page - 1) * limit;
  // COUNT(*) ve sayfa sorgusu PARALEL çalışır — page normal önyüz kullanımında (bilinen totalPages
  // içinde) hemen hemen HER ZAMAN aralık içinde olduğundan (frontend asla kendi hesapladığı
  // totalPages'in dışında bir sayfa istemez), rawOffset ile alınan sayfa genelde zaten doğrudur.
  // page aralık dışıysa (ör. elle URL değiştirme) aşağıda TEK bir ek sorguyla (nadiren tetiklenir)
  // eski JS yolundaki Math.min(page,totalPages) kırpmasıyla BİREBİR aynı sonuca düzeltilir.
  const [countRow, rawRows] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM projects WHERE ${where}`).bind(buildStatus).first(),
    fetchProjectPageRows(env, buildStatus, limit, rawOffset),
  ]);
  const total = countRow?.n || 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const clampedPage = Math.min(page, totalPages);
  const rows = clampedPage === page ? rawRows : await fetchProjectPageRows(env, buildStatus, limit, (clampedPage - 1) * limit);

  const items = rows.map(row => shapeProjectItem(row, { coverOnly: true }));
  const ratingBySlug = await fetchRatingsForSlugs(env, items.map(p => p.slug));
  const withRatings = items.map(p => {
    const r = ratingBySlug.get(p.slug);
    return { ...stripListOnlyFields(p), rating: r ? r.average : null, ratingCount: r ? r.count : 0 };
  });
  return { items: serializePublicEntity(withRatings), total, page: clampedPage, totalPages };
}

// GET /api/projects — proje.html#render()'ın sayfalanmış sunucu karşılığı. `/api/projects/filters`
// (yukarıda) sidebar sayaçlarını döndürmeye devam eder; bu uç YALNIZCA mevcut sayfanın kartlarını
// döner (bkz. kullanıcı isteği: "Bütün sayfaların verisini tek seferde DOM'a yükleme"). Filtre
// eşleştirme mantığı handleProjectFiltersRoute'daki İLE BİREBİR AYNI (kasıtlı yerel kopya — iki
// handler farklı closure'lar taşıdığından paylaşılan bir fonksiyona çıkarmak bu dosyanın mevcut
// desenini bozardı, bkz. trLower'ın da her route dosyasında yerel tanımlı olması).
export async function handleProjectListRoute(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);

  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const limit = Math.min(96, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 24));
    const sort = url.searchParams.get('sort') || '';
    const buildStatus = url.searchParams.get('buildStatus') === 'concept' ? 'concept' : 'built';
    // proje.html Harita görünümü (bkz. kullanıcı isteği: "Projeler sayfasındaki haritada tüm
    // projelerin gözükmesi gerekiyor... filtreler haritaya da işlemeli") — sayfalanmış kart listesiyle
    // AYNI filtre/arama mantığından geçer ama page/limit'i YOK SAYAR, aktif filtrelerle eşleşen TÜM
    // projeleri (koordinatlı olsun olmasın, marker'sız olanları syncMapMarkers zaten atlıyor) ince bir
    // (slug/title/lat/lng/kapak görseli) şekilde döner — kart listesinin taşıdığı description/designer/
    // awards vb. haritanın hiç ihtiyaç duymadığı alanları göndermez.
    const wantAll = url.searchParams.get('all') === '1';

    // Faz 5 — D1 seviyesinde sayfalama (bkz. kullanıcı isteği: "Database-Level Filtering &
    // Pagination"). Hiçbir filtre/arama parametresi aktif değilken VE sort, pool'un zaten geldiği
    // id DESC sırasını bozmayan bir değerdeyken (bkz. SORT_REQUIRES_JS_FILTER — switch'teki dört özel
    // case DIŞINDAKİ HER değer, '' ve 'newest' dahil, aşağıdaki "sort boşsa ek sıralama gerekmez"
    // yorumuyla AYNI şekilde no-op'tur) proje.html'in İLK YÜKLEME görünümü tam olarak
    // budur — bu durumda tüm havuzu (fetchActiveProjectPool, LIMIT'siz) Worker belleğine çekmek
    // yerine D1'e doğrudan LIMIT/OFFSET verilir (bkz. fetchProjectListPageFromD1 aşağısı).
    // Herhangi bir filtre/arama alanı aktifse bu yola HİÇ girilmez — facet'lerin ("bu grup HARİÇ
    // diğer aktif filtrelerle eşleşen" bağımlı sayımı) ve serbest metin aramasının (Türkçe foldTr,
    // il/ilçe çözümleme, isOfficeName sezgisi) hiçbiri SQL'de güvenle yeniden üretilemez (bkz.
    // kullanıcı isteği: "riskli biçimde yeniden yazma" YASAĞI) — o durumda aşağıdaki eski tam-havuz
    // yolu AYNEN korunur.
    if (!wantAll && !hasActiveProjectListFilters(url) && !SORT_REQUIRES_JS_FILTER.has(sort)) {
      return fetchProjectListPageFromD1(env, buildStatus, page, limit);
    }

    const [pool, ratingRows] = await Promise.all([
      fetchActiveProjectPoolCached(env, buildStatus),
      env.DB.prepare(`SELECT target_id, AVG(stars) AS average, COUNT(*) AS count FROM ratings WHERE target_type = 'project' GROUP BY target_id`).all(),
    ]);
    const ratingBySlug = new Map();
    // ratings.target_id proje slug'ı değil id'si olabilir — proje.html#ratingOf ile aynı slug
    // anahtarlı sözlük bekleniyor; bu yüzden pool üzerinden slug eşlemesi kurulur (slug tekil).
    // NOT: target_id burada projects.id DEĞİL, mevcut ratings şeması proje tarafında slug tutuyorsa
    // (bkz. handleProjectFiltersRoute'daki AYNI target_id kullanımı, orada da doğrudan slug/id
    // karışık ele alınmıyor) — burada handleProjectFiltersRoute ile TUTARLI kalmak için aynı
    // target_id anahtarını kullanıyoruz, yalnızca dizi yerine Map'e çeviriyoruz.
    ratingRows.results.forEach(r => ratingBySlug.set(r.target_id, { average: r.average, count: r.count }));

    const FILTER_GROUPS = buildFilterGroups(new Map(ratingRows.results.map(r => [r.target_id, { average: r.average }])));
    const activeFilters = {};
    FILTER_GROUPS.forEach(g => { activeFilters[g.key] = new Set(url.searchParams.getAll(g.key)); });
    const searchQuery = foldTr((url.searchParams.get('search') || '').trim());

    function matchesLocalSearch(p) {
      if (!searchQuery) return true;
      const fields = [p.title, p.location, p.locationDetail, ...(p.designer || [])];
      return fields.some(v => v && foldTr(String(v)).includes(searchQuery));
    }
    function passesFilters(p) {
      if (!matchesLocalSearch(p)) return false;
      return FILTER_GROUPS.every(g => {
        const sel = activeFilters[g.key];
        if (sel.size === 0) return true;
        const vals = g.field(p);
        return vals.some(v => sel.has(v));
      });
    }

    let filtered = pool.filter(p => passesFilters(p));

    // proje.html#render()'daki sort switch'in BİREBİR aynısı — sort boşsa fetchActiveProjectPool
    // zaten ORDER BY COALESCE(publish_date, created_at) DESC döndürdüğünden ek bir sıralama gerekmez.
    if (sort === 'random') {
      // Fisher-Yates — LIMIT/slice'tan (aşağısı) ÖNCE, yani havuz D1'de değil burada, Worker
      // belleğindeki filtrelenmiş diziyle karıştırılıyor (bkz. yukarısı: D1'de ORDER BY RANDOM()
      // BİLEREK kullanılmıyor). Amaç sıralama kalitesi değil, hangi öğelerin LIMIT'e gireceğini
      // eski/yeni ayrımı yapmadan eşit şansla belirlemek (bkz. SORT_REQUIRES_JS_FILTER yorumu).
      filtered = [...filtered];
      for (let i = filtered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
      }
    } else if (sort) {
      filtered = [...filtered].sort((a, b) => {
        switch (sort) {
          case 'name_asc': return a.title.localeCompare(b.title, 'tr');
          case 'date_desc': {
            const ya = parseProjectDateYear(a.date), yb = parseProjectDateYear(b.date);
            if (ya == null && yb == null) return 0;
            if (ya == null) return 1;
            if (yb == null) return -1;
            return yb - ya;
          }
          case 'date_asc': {
            const ya = parseProjectDateYear(a.date), yb = parseProjectDateYear(b.date);
            if (ya == null && yb == null) return 0;
            if (ya == null) return 1;
            if (yb == null) return -1;
            return ya - yb;
          }
          case 'rating_desc': {
            const ra = ratingBySlug.get(a.slug) || { count: 0 }, rb = ratingBySlug.get(b.slug) || { count: 0 };
            if (!ra.count && !rb.count) return 0;
            if (!ra.count) return 1;
            if (!rb.count) return -1;
            return rb.average - ra.average;
          }
          default: return 0;
        }
      });
    }

    if (wantAll) {
      const mapItems = filtered.map(p => ({
        slug: p.slug, title: p.title, lat: p.lat, lng: p.lng,
        images: p.images ? p.images.slice(0, 1) : [],
      }));
      return { items: serializePublicEntity(mapItems), total: mapItems.length, page: 1, totalPages: 1 };
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (Math.min(page, totalPages) - 1) * limit;
    // rating/ratingCount: js/components/project-related.js#RelatedProjects'in puan bazlı skorlama
    // algoritmasındaki "yüksek puanlama" bileşeni için — ratingBySlug zaten yukarıda hesaplanmış,
    // burada sadece sayfalanmış dilime iğneleniyor, ek bir sorgu gerekmiyor.
    const items = filtered.slice(start, start + limit).map(p => {
      const r = ratingBySlug.get(p.slug);
      return { ...stripListOnlyFields(p), rating: r ? r.average : null, ratingCount: r ? r.count : 0 };
    });
    return { items: serializePublicEntity(items), total, page: Math.min(page, totalPages), totalPages };
  }, () => projectListFingerprint(env));
}

// Faz 4B — Conditional Requests: bkz. src/routes/architect.js#architectListFingerprint'teki AYNI
// desen. BİLİNEN SINIRLAMA: yalnızca `projects` tablosunu izler — bir tasarımcının (mimar/ofis)
// profili güncellendiğinde proje kartındaki "Mimar" adı ya da bir projeye yeni puan verildiğinde
// değişebilecek `rating`/`ratingCount` bu parmak izine YANSIMAZ (bkz. src/lib/publicCache.js#
// cachedPublicJson üzerindeki AYNI not) — s-maxage (5dk) bu durumlar için güvenlik ağıdır.
// D1 audit (2026-08-25) P0-3 — bu sorgu önceden ÇIPLAK çalışıyordu (her /api/projects isteğinde,
// cache HIT'te bile — bkz. cachedPublicJson#computeFreshEtag). getCachedFingerprint kısa TTL'li
// (60sn) bir KV önbelleği araya koyar, mutasyonlarda invalidatePublicCache() tarafından temizlenir
// (bkz. publicCache.js) — sorgunun kendisi/doğruluğu DEĞİŞMEDİ, yalnızca ne sıklıkla çalıştığı.
// production audit (2026-09-01, madde A): buradaki ÇIPLAK `SELECT COUNT(*), MAX(updated_at) ...`
// artık src/lib/entityStats.js#entityFingerprint üzerinden okunuyor — değer yazma yolunda (SQLite
// trigger'ları, bkz. migrations/0078_entity_stats.sql) bakımı yapılan entity_stats tablosundan TEK
// satırlık bir PRIMARY KEY aramasıyla geliyor, yani kayıt sayısından bağımsız. entityFingerprint,
// entity_stats yoksa ESKİ tam-tarama sorgusuna kendisi düşer (davranış aynı kalır). Dış katman
// (getCachedFingerprint'in 60sn'lik KV önbelleği + invalidatePublicCache temizliği) DEĞİŞMEDİ.
function projectListFingerprint(env) {
  return getCachedFingerprint(env, 'projects', () => entityFingerprint(env, 'projects'));
}
