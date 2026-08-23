import { json, errorJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { cachedPublicJson, getCachedPool } from '../lib/publicCache.js';
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
  const { results } = await env.DB.prepare(
    `SELECT p.slug, p.title, p.brand_name_raw, p.category, p.kind, p.images
     FROM project_products pp JOIN products p ON p.id = pp.product_id
     WHERE pp.project_id = ? AND p.deleted_at IS NULL AND p.hidden_at IS NULL`
  ).bind(projectId).all();
  const items = results.map(row => ({
    slug: row.slug, title: row.title, brand: row.brand_name_raw, category: row.category,
    kind: row.kind, image: firstImage(row.images),
  }));
  return { products: items.filter(i => i.kind !== 'material'), materials: items.filter(i => i.kind === 'material') };
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
export async function handleProjectCanEditRoute(request, env, rawSlug) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const user = await getSessionUser(request, env);
  if (!user) return json({ canEdit: false });
  const slug = decodeURIComponent(rawSlug || '');
  return json({ canEdit: await canUserEditProjectBySlug(env, user, slug) });
}

// GET /api/project/:slug — Faz 4: proje.html'deki proje modalı bu uca bağlandı (eski yorum artık
// geçersiz), canonical D1'den doğrudan okur.
export async function handleProjectDetailRoute(request, env, url, rawSlug) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
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
    const [designerDetails, rawNames, owner] = await Promise.all([
      fetchDesignerDetails(env, row.id),
      fetchRawDesignerNames(env, row),
      fetchOwnerByline(env, row.claimed_by_user_id),
    ]);
    if (owner) Object.assign(item, owner);
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
          out[key] = { counts, options: Object.keys(counts).sort((a, b) => (key === 'dateBucket' ? dateBucketSortKey(b) - dateBucketSortKey(a) : counts[b] - counts[a] || a.localeCompare(b))) };
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
      out[g.key] = { counts, options };
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

// fetchActiveProjectPool'daki (yukarıda) AYNI açık sütun listesi + JOIN/GROUP BY — tek fark LIMIT/
// OFFSET eklenmesi. p.id ile ORDER BY zaten fetchActiveProjectPool'la BİREBİR aynı sırayı üretir.
async function fetchProjectPageRows(env, buildStatus, limit, offset) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.slug, p.title, p.category, p.type, p.discipline, p.location, p.location_detail,
            p.project_date, p.date_bucket, p.period, p.description, p.images, p.photo_credit_text,
            p.photo_credit_url, p.build_status, p.concept_category, p.awards,
            GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names, ${OFFICE_NAMES_SQL}
     FROM projects p ${DESIGNER_JOIN_SQL}
     WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND p.build_status = ?
     GROUP BY p.id ORDER BY p.id DESC LIMIT ? OFFSET ?`
  ).bind(buildStatus, limit, offset).all();
  return results;
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
    return { ...p, rating: r ? r.average : null, ratingCount: r ? r.count : 0 };
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
    if (!hasActiveProjectListFilters(url) && !SORT_REQUIRES_JS_FILTER.has(sort)) {
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
    // zaten ORDER BY p.id DESC döndürdüğünden (en son eklenen ilk) ek bir sıralama gerekmez.
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

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (Math.min(page, totalPages) - 1) * limit;
    // rating/ratingCount: js/components/project-related.js#RelatedProjects'in puan bazlı skorlama
    // algoritmasındaki "yüksek puanlama" bileşeni için — ratingBySlug zaten yukarıda hesaplanmış,
    // burada sadece sayfalanmış dilime iğneleniyor, ek bir sorgu gerekmiyor.
    const items = filtered.slice(start, start + limit).map(p => {
      const r = ratingBySlug.get(p.slug);
      return { ...p, rating: r ? r.average : null, ratingCount: r ? r.count : 0 };
    });
    return { items: serializePublicEntity(items), total, page: Math.min(page, totalPages), totalPages };
  }, () => projectListFingerprint(env));
}

// Faz 4B — Conditional Requests: bkz. src/routes/architect.js#architectListFingerprint'teki AYNI
// desen. BİLİNEN SINIRLAMA: yalnızca `projects` tablosunu izler — bir tasarımcının (mimar/ofis)
// profili güncellendiğinde proje kartındaki "Mimar" adı ya da bir projeye yeni puan verildiğinde
// değişebilecek `rating`/`ratingCount` bu parmak izine YANSIMAZ (bkz. src/lib/publicCache.js#
// cachedPublicJson üzerindeki AYNI not) — s-maxage (5dk) bu durumlar için güvenlik ağıdır.
function projectListFingerprint(env) {
  return env.DB.prepare(
    `SELECT COUNT(*) AS cnt, MAX(updated_at) AS latest FROM projects WHERE deleted_at IS NULL AND hidden_at IS NULL`
  ).first().then(row => `${row?.cnt ?? 0}:${row?.latest ?? ''}`);
}
