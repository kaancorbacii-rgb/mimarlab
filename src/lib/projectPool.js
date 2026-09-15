// Faz 3 — proje "havuz" mantığı (fetchActiveProjectPool/buildFilterGroups + destekleyicileri):
// hem src/routes/project.js (public liste/filtre uçları, tekil proje detayı) hem
// src/lib/facetCounts.js (bir yazma işleminden sonra facet_counts'ı yeniden hesaplama) tarafından
// paylaşılır. Önceden facetCounts.js (lib) bu fonksiyonları routes/project.js'den import
// ediyordu — lib katmanının routes'a bağımlı olması ters bir katmanlama hatasıydı (denetim
// bulgusu, 2026-08-14); bu dosya paylaşılan mantığı doğru katmana (lib) taşır, routes/project.js
// de aynı fonksiyonları artık buradan import eder (davranış değişmedi, yalnızca konum).
import { parseCanonicalRow } from './canonicalRead.js';
import { dropAggregatorSourceUrl } from './aggregatorSources.js';
// Künyedeki ham adları canonical adlarla tekilleştirirken (bkz. mergeCreditNames) sitenin her
// yerinde kullanılan AYNI TR-duyarlı casefold — "nevzat sayın" ile "Nevzat Sayın" tek seçenek olsun.
import { foldTr } from './textMatch.js';
// bkz. src/routes/architect.js'teki AYNI CJS-interop yorumu — il-ilce-data.js proje.html'deki
// parseLocationFull ile BİREBİR aynı il/ilçe çözümlemesini kullanmak için (~970 ilçelik veriyi
// burada tekrar tanımlamak yerine) aynı guard'lı module.exports bloğuyla import ediliyor.
import ilIlceJs from '../../il-ilce-data.js';
import { PROJECT_DISCIPLINE_SET, PROJECT_CATEGORY_SET, PROJECT_GROUP_SET } from './submissionTypes.js';

const { parseLocationFull, projectPlaceOf } = ilIlceJs;

export const DESIGNER_SEP = '';

// bir projenin tasarımcı adları dizisini (mimar VEYA ofis adı, project_designers join'inden) tek
// bir GROUP_CONCAT sütununa toplayan ortak sorgu parçası — hem tekil proje hem filtre listesi
// sorgusu bunu kullanır.
// DÜZELTME (bkz. gerçek bulgu: ana sayfa carousel'inde Kapicciiiinoo projesinin altyazısında künyede
// hiç eklenmemiş "GEO_ID" firması görünüyordu) — eskiden burada bir `ar_ofc` join'i vardı ve
// OFFICE_NAMES_SQL bir mimarın KENDİ profilinde kayıtlı BAĞLI OLDUĞU ofisi (architects.office_id,
// projeyle hiç ilgisi olmayan, mimarın güncel/kişisel bir alanı) otomatik künyeye ekliyordu. Bu,
// proje ekle/düzenle sayfasında o firma HİÇ seçilmemiş olsa bile firmanın gösterilmesine yol
// açıyordu (mimar başka bir firmaya da ortaksa özellikle). Kural: proje ekle/düzenle'de ekli
// OLMAYAN hiçbir bilgi hiçbir yerde görünmemeli — bu yüzden ofis adı SADECE pd.office_id ile
// doğrudan künyeye eklenmiş satırlardan (ofc) gelir, mimarın kişisel ofis bağlantısından asla.
export const DESIGNER_JOIN_SQL = `
  LEFT JOIN project_designers pd ON pd.project_id = p.id
  LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL AND ar.hidden_at IS NULL
  LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL AND ofc.hidden_at IS NULL
`;
// office_names GROUP_CONCAT sütunu — designer_names'ten AYRI tutulur çünkü designer_names künyede
// görünen HAM tasarımcı isimlerini (mimar veya ofis) taşımaya devam etmeli; office_names yalnızca
// künyeye DOĞRUDAN ofis olarak eklenmiş isimleri taşır (bkz. yukarıdaki DÜZELTME notu) — src/lib/
// seo.js#findProjectRow zaten baştan beri bu şekilde (ar_ofc'siz) yazılmıştı.
export const OFFICE_NAMES_SQL = `GROUP_CONCAT(ofc.name, '${DESIGNER_SEP}') AS office_names`;

// performance audit (2026-09-01, P2) — mimar/firma pop-up'larının proje ızgaralarını besleyen
// sorgular `SELECT p.*` / `SELECT DISTINCT p.*` kullanıyordu; bu, hiç okunmayan `description`
// (proje başına ortalama ~2,3 KB) dahil TÜM kolonları D1'den Worker'a taşıyordu — 36-39 projelik
// bir profilde tek pop-up için ~90 KB gereksiz D1→Worker aktarımı. Bu ızgaraların GERÇEKTEN
// okuduğu alanlar yalnızca şunlar (bkz. src/routes/architect.js#shapeProjectsNewestFirst ve
// src/routes/office.js#relatedProjects — ikisi de aynı 7 alanı çıkarır). `id` DAHİL edilir ki
// `SELECT DISTINCT` semantiği eski `p.*` hâliyle BİREBİR aynı kalsın (id birincil anahtardır,
// dolayısıyla DISTINCT hiçbir satırı birleştirmez — eski davranış korunur).
// `p.type` (künyedeki "Grup" alanı) 2026-09-04'te eklendi — kişi/firma pop-up'larındaki "Projeler"
// başlığının yanındaki grup filtresi (bkz. js/components/project-group-filter.js) bu kartların
// KENDİ üzerinden çalışır, ayrı bir istek açmaz.
export const PROJECT_CARD_COLUMNS = 'p.id, p.slug, p.title, p.category, p.type, p.images, p.lat, p.lng, p.project_date, p.location';

export function designerNamesFrom(concat) {
  return concat ? concat.split(DESIGNER_SEP).filter(Boolean) : [];
}

// office_names GROUP_CONCAT'i NULL'ları (SQLite GROUP_CONCAT NULL değerleri zaten atlar) ve
// tekrarları (ör. bir ofis + o ofisin bir mimarı aynı projede iki ayrı project_designers satırıysa)
// içerebilir — SQLite GROUP_CONCAT(DISTINCT ..., özel ayraç) birlikte desteklemediğinden
// tekilleştirme burada JS tarafında yapılır.
export function officeNamesFrom(concat) {
  if (!concat) return [];
  const seen = new Set();
  const out = [];
  for (const name of concat.split(DESIGNER_SEP)) {
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

// projects.designer_names_raw / office_names_raw ham metnini güvenle çözer — künyeye YAZILDIĞI
// HÂLİYLE ad listesi (bkz. migrations/0120_project_designer_names_raw.sql). Kolon NULL ise (gönderi
// satırı olmayan legacy_static kayıtlar) boş dizi döner ve davranış eskisiyle aynı kalır.
function parseNameArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(n => String(n || '').trim()).filter(Boolean) : [];
  } catch { return []; }
}

// Eşleşen (project_designers'tan gelen canonical) adlarla künyeye yazılmış HAM adları birleştirir.
// Canonical yazım ÖNCE gelir ve kazanır: kullanıcı "nevzat sayın" yazmış, sitedeki kayıt "Nevzat
// Sayın" ise filtrede TEK seçenek olmalı ve o da kaydın kendi yazımı olmalı — tekilleştirme bu
// yüzden foldTr (src/lib/textMatch.js'teki AYNI TR-duyarlı katlama) üzerinden yapılır.
function mergeCreditNames(canonical, raw) {
  const out = [];
  const seen = new Set();
  for (const name of [...canonical, ...raw]) {
    const key = foldTr(String(name || '').trim());
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

// MİMAR KUTUSUNA YAZILMIŞ AMA GERÇEKTE FİRMA OLAN ADLAR (kullanıcı isteği, 2026-09-15 ikinci tur:
// "Proje sayfasındaki filtrelerde mimar kısmında SADECE mimar künyesindeki isimler, firma kısmında
// SADECE mimarlık firması künyesindeki isimler yer alacak. Şu an filtrelerde firma isimleri mimar
// kısmına karışmış gözüküyor").
//
// KÖK NEDEN. 2026-09-15 BİRİNCİ turda künyeye YAZILDIĞI HÂLİYLE adlar (designer_names_raw /
// office_names_raw) filtrelere dahil edildi; bu, o güne kadar filtrede HİÇ görünmeyen iki ad
// kümesini birden görünür yaptı ve ikisi de Mimar filtresine düşüyordu:
//   1. ESKİ (0030 öncesi) gönderiler — o zaman form TEK kutu gönderiyordu: Mimar ve Firma adları
//      `project_submissions.designer` içinde BİRLİKTE duruyor, `office` kolonu NULL (bkz.
//      migrations/0030_project_submission_office.sql, src/routes/project.js#fetchRawDesignerNames'in
//      isLegacy dalı ve 0120'nin geri dolumu — o dolum ps.designer'ı olduğu gibi kopyalar).
//      Proje pop-up'ı bu satırlarda ayrımı isOfficeName() sezgisiyle yapıyordu, filtre ise hepsini
//      "mimar" sayıyordu: aynı künye pop-up'ta "Firma", listede "Mimar" diyordu.
//   2. Firma adının Mimar kutusuna yazıldığı gönderiler — resolveArchitectLink YALNIZCA `architects`
//      tablosuna bakar (bkz. src/lib/canonicalSync.js), firma orada olmadığı için ad
//      project_designers'a hiç yazılamaz; ham listeye ise yazıldığı kutuyla, yani Mimar olarak düşer.
//
// KARAR SIRASI — sezgi EN SONDA ve yalnızca başka hiçbir kanıt yokken:
//   a. Ad project_designers'ta MİMAR olarak bağlıysa (ar.name) kesin mimardır, ASLA taşınmaz.
//   b. Sitede o adla bir `offices` kaydı varsa (officeNameFolds) kesin firmadır — arşivde/gizli
//      olanlar dahil (bkz. fetchOfficeNameFolds), çünkü arşivlenmiş bir firma da firmadır.
//   c. (a) ve (b) yoksa VE satır eski BİRLEŞİK kutudan geliyorsa (office_names_raw NULL)
//      isOfficeName() sezgisi. Pop-up künyesi o satırlarda zaten aynı sezgiyi kullanıyor, ikisi
//      ayrışmasın. MODERN gönderilerde sezgiye HİÇ başvurulmaz: kullanıcının adı hangi kutuya
//      yazdığı kesin bilgidir ve 2026-08-19 bulgusu ("+MURAT TABANLIOĞLU" anahtar kelimelerin
//      hiçbirine uymadığı için Mimar'a sızmıştı) sezginin tek başına yeterli OLMADIĞINI gösterdi.
//
// Dönen adlar `designer` listesinden ÇIKARILMAZ (o liste künyenin tamamıdır: arama alanlarını ve
// kart altyazılarını besler), yalnızca `officeNames`e EKLENİR — Mimar filtresi zaten "designer eksi
// officeNames" olarak hesaplanır (bkz. buildFilterGroups), böylece ad Mimar'dan düşer ve Firma
// filtresinde görünür.
function officeNamesInDesignerBox(row, canonicalNames, canonicalOfficeNames, rawDesignerNames, officeNameFolds) {
  if (!officeNameFolds || !rawDesignerNames.length) return [];
  const officeFold = new Set(canonicalOfficeNames.map(n => foldTr(n)));
  // (a) — designer_names = COALESCE(ar.name, ofc.name), office_names = yalnızca ofc.name;
  // aradaki fark project_designers'ta MİMAR olarak bağlı adlardır.
  const architectFold = new Set(canonicalNames.map(n => foldTr(n)).filter(k => !officeFold.has(k)));
  // Eski BİRLEŞİK kutu: office_names_raw NULL (modern gönderi her zaman '[]' bile olsa yazar, bkz.
  // src/lib/canonicalSync.js#syncProject).
  const legacyCombinedBox = row.office_names_raw == null;
  const out = [];
  for (const name of rawDesignerNames) {
    const key = foldTr(name);
    if (!key || architectFold.has(key)) continue;
    if (officeNameFolds.has(key) || (legacyCombinedBox && isOfficeName(name))) out.push(name);
  }
  return out;
}

// projects.image_hotspots ham metnini güvenle çözer — biçim bozuksa/dizi ise boş nesneye düşer
// (bkz. shapeProjectItem'daki kullanım ve migrations/0076_project_image_hotspots.sql).
function parseHotspots(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
}

// opts.coverOnly — YALNIZCA liste/kart bağlamı için (bkz. fetchActiveProjectPool aşağısı):
// kartlar/İlgili Yapılar/Mimarın Diğer Yapıları her zaman yalnızca `images[0]`'ı render ediyor.
// Tekil proje detayı ve handleProjectFiltersRoute'un kendi ayrı havuzu bu fonksiyonu opts'suz
// çağırmaya devam ediyor — varsayılan (opts yok) davranış ESKİSİYLE BİREBİR AYNI (tam images dizisi).
// Kart karuselinin taşıdığı en fazla görsel — bkz. shapeProjectItem#images (coverOnly).
// 6 -> 4 (kullanıcı isteği, 2026-09-12 madde 2: "Proje sayfasındaki proje önizlemelerinde ard arda
// 4 tane görsel görülebilsin 6 değil"). Kapak dahil sayılır: kartta ileri okuna basarak en fazla
// bu kadar görsel gezilir.
//
// 4 -> 3 (kullanıcı isteği, 2026-09-13 madde 3: "Proje ve ürün sayfasında da gönderi
// önizlemelerinde 3 görsel görebilelim"). Değer ARTIK ÜRÜN KARTLARINI DA bağlıyor: eskiden ürün
// tarafı kendi sınırını (6) ayrı yazıyordu ve iki sayı ayrışabiliyordu; artık ikisi de buradan
// okur (bkz. src/routes/product.js#fetchProductPool ve urun.html#render).
// js/pages/proje.js#renderCards istemci tarafında AYNI sayıyla ikinci bir kırpma yapar (eski bir
// edge gövdesi daha fazlasını taşısa bile kart bu sayıyı aşmasın).
export const CARD_CAROUSEL_IMAGES = 3;

export function shapeProjectItem(row, opts) {
  const p = parseCanonicalRow('projects', row);
  const coverOnly = opts && opts.coverOnly;
  // Künye adları — üç kaynak (bkz. officeNamesInDesignerBox yukarıda): project_designers'tan gelen
  // EŞLEŞEN adlar, künyeye yazıldığı hâliyle HAM adlar ve Mimar kutusuna yazılmış firma adları.
  const canonicalNames = designerNamesFrom(row.designer_names);
  const canonicalOfficeNames = officeNamesFrom(row.office_names);
  const rawDesignerNames = parseNameArray(row.designer_names_raw);
  const rawOfficeNames = parseNameArray(row.office_names_raw);
  // officeNameFolds YALNIZCA filtre havuzundan (fetchActiveProjectPool) geçirilir — Mimar/Firma
  // ayrımını okuyan tek yüzey orası. Tekil proje / sayfa sorguları bu opsiyonu geçirmez, onların
  // yanıt şekli (kart altyazısı, pop-up künyesi) DEĞİŞMEDEN kalır.
  const designerBoxOffices = officeNamesInDesignerBox(
    row, canonicalNames, canonicalOfficeNames, rawDesignerNames, opts && opts.officeNameFolds,
  );
  // Alan yalnızca GERÇEKTEN işaretçi varsa yüke eklenir — liste/havuz yolunda (yüzlerce kayıt, KV'de
  // önbelleklenen tek bir JSON) her karta boş bir nesne iliştirmenin hiçbir faydası yok.
  //
  // KULLANICI İSTEĞİ (2026-09-04): ana sayfa carousel'indeki proje görselinde de işaretçiler
  // görünsün ve tıklanabilsin. Carousel bu liste yolundan besleniyor ve YALNIZCA `images[0]`'ı
  // gösteriyor — bu yüzden coverOnly'de işaretçiler tamamen atılmaz ama SADECE kapak görselininki
  // taşınır. Yükü şişirmeyen tek doğru kapsam bu: bugün işaretçi taşıyan proje sayısı bir avuç,
  // taşımayan yüzlerce kayıt alanı hiç görmez (aşağıdaki Object.keys kontrolü).
  const allHotspots = parseHotspots(row.image_hotspots);
  let hotspots = allHotspots;
  if (coverOnly) {
    const cover = p.images[0];
    hotspots = (cover && allHotspots[cover]) ? { [cover]: allHotspots[cover] } : {};
  }
  return {
    slug: p.slug, title: p.title, category: p.category, type: p.type, discipline: p.discipline,
    location: p.location, locationDetail: p.location_detail, lat: p.lat ?? null, lng: p.lng ?? null,
    date: p.project_date, dateBucket: p.date_bucket,
    // designer / officeNames — EŞLEŞEN adlar (project_designers) + künyeye yazılmış HAM adlar
    // (kullanıcı isteği, 2026-09-15 madde 2). Mimar filtresi `designer` eksi `officeNames` olarak
    // hesaplandığından (bkz. buildFilterGroups) ham FİRMA adları her iki listeye de girer: böylece
    // Mimarlık Firması filtresinde görünür, Mimar filtresine sızmazlar. Mimar KUTUSUNA yazılmış
    // firma adları da aynı yoldan Firma tarafına geçer (bkz. officeNamesInDesignerBox, 2026-09-15
    // ikinci tur) — `designer` künyenin TAMAMI olmaya devam eder (arama/altyazı onu okur).
    period: p.period,
    designer: mergeCreditNames(canonicalNames, [...rawDesignerNames, ...rawOfficeNames]),
    officeNames: mergeCreditNames(canonicalOfficeNames, [...rawOfficeNames, ...designerBoxOffices]),
    // url: agregatör kapısı (kullanıcı isteği, 2026-09-14 — bkz. src/lib/aggregatorSources.js).
    // Kart/liste yükü bu bağlantıyı bugün <a> olarak basmıyor (bkz. js/components/project-gallery.js
    // — yalnızca .text okunuyor), ama kapı burada da durur: aynı yükü okuyan yeni bir çağıran
    // yarın bağlantıyı basarsa arkitera/archdaily adresi sessizce geri gelmemeli.
    photoCredit: { text: p.photo_credit_text || '', url: dropAggregatorSourceUrl(p.photo_credit_url || '') },
    // coverOnly: kart karuseli için İLK 6 görsel (kullanıcı isteği, 2026-09-10 on birinci tur madde
    // 5: "proje ve ürün önizlemelerinde fotoğraflar arasında ileri-geri yapabilelim"). Kart yalnızca
    // kapağı DOM'a basar, diğerleri oka basılınca tembel yüklenir (bkz. js/components/card-carousel.js);
    // liste JSON'una düşen maliyet yalnızca 5 ek URL/kart. İşaretçiler (hotspots) hâlâ yalnızca kapak.
    description: p.description, images: coverOnly ? p.images.slice(0, CARD_CAROUSEL_IMAGES) : p.images,
    // Görsel üzerindeki ürün işaretçileri (bkz. migrations/0076_project_image_hotspots.sql).
    // Detay yükünde TÜM görsellerinki, liste/kart yükünde (coverOnly) yalnızca KAPAK görselininki
    // taşınır (bkz. yukarıdaki hesap). parseCanonicalRow'un JSON_COLUMNS listesine EKLENMEZ: o
    // liste her alanı diziye çözer (hata durumunda []), bu alan ise bir nesne. Ham metin yukarıda
    // tek yerde ve güvenli biçimde çözülür.
    ...(Object.keys(hotspots).length ? { imageHotspots: hotspots } : {}),
    buildStatus: p.build_status === 'concept' ? 'concept' : 'built',
    conceptCategory: p.concept_category || null,
    awards: p.awards || [],
    // preview: ÖNİZLEME ("soluk") kartı — bkz. migrations/0107_preview_state.sql. Yalnızca gerçekten
    // önizlemedeyken eklenir: liste JSON'u yüzlerce kart taşıyor, her karta `false` yazmanın faydası yok.
    ...(row.preview_at ? { preview: true } : {}),
  };
}

// proje-ekle.html#OFFICE_NAME_OVERRIDES/OFFICE_KEYWORDS ile BİREBİR aynı liste — YALNIZCA künyeye
// yazılmış ama hiçbir architects/offices satırına bağlanamamış (unregistered) isimler için "tahmin"
// amaçlı kullanılır (bkz. src/routes/project.js#isLegacy dalı). buildFilterGroups'taki Mimar/Firma
// filtreleri ARTIK bu sezgiyi kullanmıyor — architect_id/office_id CHECK kısıtı sayesinde her
// project_designers satırının kökeni kesin bilindiğinden (bkz. p.officeNames, yalnızca ofc.name'den
// gelir), sezgisel isim eşleştirmesi kaldırıldı (bkz. "+MURAT TABANLIOĞLU" firma adının hiçbir
// anahtar kelimeye uymadığı için Mimar filtresine sızdığı bulgu, 2026-08-19).
export const OFFICE_NAME_OVERRIDES = new Set(["Autoban","Escapefromsofa","Per Se","Grimshaw","SOM","REX","ACPV Antonio Citterio & Patricia Viel","Salon Alper Derinboğaz",
  "AOMTD","Gensler","KPF","OMA","FXCollaborative","Chapman Taylor","Powerhouse Company","Carve",
  "GEOMIM","Ofist","Ofisvesaire","FREA","MuuM","Neowe","Nēowe","Superpool","PLUG",
  "SdARCH Trivelli & Associati","T-ingénierie","UN Architectural Services","ZAAS","ŞANALarc",
  "GEO_ID","ARK-Itecture","Acararch","Dolmus AG","caps.","the | work","indissoluble","Lazzoni",
]);
export const OFFICE_KEYWORDS = ["mimarlık","architecture","architects","architekten","studio","design","partner","group","proje","workshop","associates","concept","ortaklığı","mühendislik","danışmanlık","atölye","işliği","tasarım","grubu"];
export function isOfficeName(name) {
  if (OFFICE_NAME_OVERRIDES.has(name)) return true;
  return OFFICE_KEYWORDS.some(k => name.toLowerCase().includes(k));
}

// Sitedeki TÜM firma adlarının TR-duyarlı katlanmış kümesi (bkz. officeNamesInDesignerBox (b)
// maddesi). Gizli/arşivlenmiş kayıtlar da DAHİL (yalnızca silinenler dışarıda): arşivdeki bir firma
// da firmadır, adı Mimar filtresinde görünmemeli — 2026-09-14'te markaların büyük bölümü arşive
// alındı, onları dışarıda bırakmak tam da bu turda düzeltilen sızıntıyı geri getirirdi.
// TEK sorgu ve YALNIZCA filtre havuzu yolunda çalışır; havuz KV'de önbelleklendiğinden (bkz.
// src/lib/publicCache.js#getCachedPool) maliyeti istek başına değil, önbellek yenilenmesi başınadır.
export async function fetchOfficeNameFolds(env) {
  const { results } = await env.DB.prepare(`SELECT name FROM offices WHERE deleted_at IS NULL`).all();
  const out = new Set();
  for (const row of results) {
    const key = foldTr(String(row.name || '').trim());
    if (key) out.add(key);
  }
  return out;
}

// bkz. src/lib/facetCounts.js#recomputeProjectFacets — facet_counts'ın "hiçbir filtre aktif değil"
// anlık görüntüsünü üretmek için handleProjectFiltersRoute ile AYNI havuzu (aktif/gizli olmayan
// projeler + designer isim dizisi) paylaşır, tek sorgu mantığını burada tekilleştirir.
// buildStatus: 'built' (normal, inşa edilmiş eserler) | 'concept' (kullanılmıyor, eski
// yarışma/fikir/konsept projeleri, bkz. migrations/0037_project_build_status.sql).
// Parametre verilmezse eski/harici çağıranlarla (ör. index.html vitrin carousel'i) geriye dönük
// uyumluluk için 'built' varsayılır — canlıda halihazırda var olan TÜM projeler bu kategoridedir.
export async function fetchActiveProjectPool(env, buildStatus) {
  const status = buildStatus === 'concept' ? 'concept' : 'built';
  // ORDER BY COALESCE(p.publish_date, p.created_at) DESC — proje.html#render()'daki varsayılan
  // sıralamayla (sort seçilmemişse) birebir aynı; facet sayaçları (bu havuzun diğer tüketicisi,
  // handleProjectFiltersRoute/recomputeProjectFacets) sıradan bağımsız olduğundan etkilenmez.
  // publish_date yalnızca admin'in proje ekle/düzenle sayfasından ayarlayabildiği bir "yayınlanma
  // tarihi" (bkz. kullanıcı isteği, migrations/0061_project_publish_date.sql) — NULL'sa (admin hiç
  // dokunmadıysa) created_at'e (satırın eklenme anı) göre "son eklenen ilk" davranışı DEĞİŞMEDEN
  // korunur, dolu ise projenin listelerdeki yerini bu tarih belirler. p.id DESC ikinci sıralama
  // ölçütü olarak kalır (created_at aynı saniyede eşitse deterministik sıra için).
  // `p.*` yerine açık sütun listesi — bu havuzun TEK tüketicileri handleProjectListRoute (kart
  // listesi) ve recomputeProjectFacets (facet sayaçları) olduğundan, ikisinin de hiç okumadığı
  // source_url/ai_generated/source/legacy_key/claimed_by_user_id D1'den hiç çekilmiyor (created_at/
  // publish_date yalnızca ORDER BY'da kullanılıyor, SQLite bunun için SELECT listesinde olmalarını
  // gerektirmez; deleted_at/hidden_at yalnızca WHERE'de kullanılıyor, SELECT'e gerek yok). `images`
  // sütunu yine TAM metin olarak çekiliyor (SQL'de json_extract KULLANILMADI — bir satırın images
  // JSON'ı bozuksa bu tüm sorguyu 500'letebilirdi; mevcut JS tarafı parseCanonicalRow/try-catch
  // güvenliği korunuyor), yalnızca shapeProjectItem'a coverOnly:true geçirilerek İLK görsele
  // aşağıda JS'te indirgeniyor.
  // display_order (bkz. migrations/0087_project_display_order.sql) — proje.html#render()'daki
  // varsayılan sıralamayla (sort seçilmemişse) BİREBİR aynı olmalı, bkz. fetchProjectPageRows'daki
  // AYNI COALESCE(display_order,0) notu (src/routes/project.js).
  // relisted_at artık AYRI bir sıralama anahtarı DEĞİL, COALESCE zincirine dahil — bkz.
  // src/routes/project.js#fetchProjectPageRows'daki GERÇEK BULGU yorumu (2026-09-11, Withco
  // CoWorking Central 1. sıraya yerleşmiyordu).
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.slug, p.title, p.category, p.type, p.discipline, p.location, p.location_detail,
            p.project_date, p.date_bucket, p.period, p.description, p.images, p.photo_credit_text,
            p.photo_credit_url, p.build_status, p.concept_category, p.awards, p.lat, p.lng,
            p.image_hotspots, p.preview_at, p.relisted_at,
            -- künyeye yazıldığı hâliyle adlar (bkz. migrations/0120_project_designer_names_raw.sql)
            p.designer_names_raw, p.office_names_raw,
            GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names, ${OFFICE_NAMES_SQL}
     FROM projects p ${DESIGNER_JOIN_SQL}
     WHERE p.deleted_at IS NULL AND (p.hidden_at IS NULL OR p.preview_at IS NOT NULL) AND p.build_status = ?
     GROUP BY p.id ORDER BY (p.preview_at IS NOT NULL) ASC, COALESCE(p.display_order, 0) ASC, COALESCE(p.relisted_at, p.publish_date, p.created_at) DESC, p.id DESC`
  ).bind(status).all();
  // officeNameFolds — Mimar kutusuna yazılmış firma adlarını Firma tarafına taşımak için (bkz.
  // officeNamesInDesignerBox). Havuzun TEK tüketicileri liste/filtre yüzeyleri olduğundan sorgu
  // yalnızca burada açılır; sonuç (şekillendirilmiş havuz) zaten önbelleklenir.
  const officeNameFolds = await fetchOfficeNameFolds(env);
  return results.map(row => shapeProjectItem(row, { coverOnly: true, officeNameFolds }));
}

// proje.html sunucudan gelen filters.designer/designerOffice listelerini olduğu gibi render eder,
// kendi tarafında ayrım hesaplamaz — bu yüzden Mimar/Firma ayrımının TEK kaynağı burasıdır.
//
// Tür/Tip/Grup/Yer YALNIZCA izinli değerleri üretir (kullanıcı isteği, 2026-09-11: "81 il ve
// yurtdışındaki ülkeler haricinde ... proje ekle sayfasındakiler haricinde yeni bir filtre
// eklenmesine asla izin verme"). Gönderiler zaten submissionTypes.js#findInvalidProjectTaxonomyField
// kapısından geçiyor; bu süzgeç o kapıyı atlayan yazıcılara (içe aktarım betikleri, eski taslakların
// yeniden senkronu) karşı ikinci hat — bozuk bir değer filtre seçeneği olarak ASLA görünmez.
export function buildFilterGroups(ratingByProject) {
  return [
    { key: 'discipline', label: 'Tür', nested: false, field: p => (p.discipline || []).filter(v => PROJECT_DISCIPLINE_SET.has(v)) },
    { key: 'category', label: 'Tip', nested: false, field: p => (p.category || []).filter(v => PROJECT_CATEGORY_SET.has(v)) },
    // Yalnızca build_status='concept' projelerde dolu (bkz. migrations/0038_project_concept_category.sql)
    // — 'built' projelerde her zaman [] döner, bu yüzden proje.html tarafında (o sayfa bu grubu
    // kendi FILTER_GROUPS listesine hiç eklemiyor) hiçbir etkisi olmaz.
    { key: 'conceptCategory', label: 'Kategori', nested: false, field: p => p.conceptCategory ? [p.conceptCategory] : [] },
    { key: 'type', label: 'Grup', nested: false, field: p => (p.type || []).filter(v => PROJECT_GROUP_SET.has(v)) },
    { key: 'location', label: 'Yer', nested: false, field: p => { const place = projectPlaceOf(p.location); return place ? [place] : []; } },
    { key: 'district', label: 'İlçe', nested: true, parentKey: 'location', parentValue: 'İstanbul', field: p => {
        const info = parseLocationFull(p.location);
        return (info.district && info.city === 'İstanbul') ? [info.district] : [];
      } },
    { key: 'dateBucket', label: 'Yıl', nested: false, field: p => [p.dateBucket] },
    // Mimar = künyenin tamamı EKSİ firma adları. Karşılaştırma foldTr ile yapılır (düz `includes`
    // değil): iki liste aynı adı farklı yazımla taşıyabilir (biri canonical kayıttan, diğeri
    // künyeye elle yazılmış hâlinden gelir) ve tek harflik bir fark firmayı Mimar filtresine
    // sızdırırdı — bkz. mergeCreditNames'teki AYNI TR-duyarlı katlama.
    { key: 'designer', label: 'Mimar', nested: false, field: p => {
        const officeFold = new Set((p.officeNames || []).map(n => foldTr(n)));
        return (p.designer || []).filter(d => !officeFold.has(foldTr(d)));
      } },
    { key: 'designerOffice', label: 'Mimarlık Firması', nested: false, field: p => p.officeNames || [] },
    { key: 'award', label: 'Ödül', nested: false, field: p => p.awards || [] },
    { key: 'rating', label: 'Puan', nested: false, field: p => ratingBuckets((ratingByProject.get(p.slug) || { average: 0 }).average) },
  ];
}

export function ratingBuckets(average) {
  if (!average) return [];
  const buckets = [];
  for (let n = Math.floor(average); n >= 1; n--) buckets.push(`${n}+ Yıldız`);
  return buckets;
}
