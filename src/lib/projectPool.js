// Faz 3 — proje "havuz" mantığı (fetchActiveProjectPool/buildFilterGroups + destekleyicileri):
// hem src/routes/project.js (public liste/filtre uçları, tekil proje detayı) hem
// src/lib/facetCounts.js (bir yazma işleminden sonra facet_counts'ı yeniden hesaplama) tarafından
// paylaşılır. Önceden facetCounts.js (lib) bu fonksiyonları routes/project.js'den import
// ediyordu — lib katmanının routes'a bağımlı olması ters bir katmanlama hatasıydı (denetim
// bulgusu, 2026-08-14); bu dosya paylaşılan mantığı doğru katmana (lib) taşır, routes/project.js
// de aynı fonksiyonları artık buradan import eder (davranış değişmedi, yalnızca konum).
import { parseCanonicalRow } from './canonicalRead.js';
// bkz. src/routes/architect.js'teki AYNI CJS-interop yorumu — il-ilce-data.js proje.html'deki
// parseLocationFull ile BİREBİR aynı il/ilçe çözümlemesini kullanmak için (~970 ilçelik veriyi
// burada tekrar tanımlamak yerine) aynı guard'lı module.exports bloğuyla import ediliyor.
import ilIlceJs from '../../il-ilce-data.js';

const { parseLocationFull } = ilIlceJs;

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

// opts.coverOnly — YALNIZCA liste/kart bağlamı için (bkz. fetchActiveProjectPool aşağısı):
// kartlar/İlgili Yapılar/Mimarın Diğer Yapıları her zaman yalnızca `images[0]`'ı render ediyor.
// Tekil proje detayı ve handleProjectFiltersRoute'un kendi ayrı havuzu bu fonksiyonu opts'suz
// çağırmaya devam ediyor — varsayılan (opts yok) davranış ESKİSİYLE BİREBİR AYNI (tam images dizisi).
export function shapeProjectItem(row, opts) {
  const p = parseCanonicalRow('projects', row);
  const coverOnly = opts && opts.coverOnly;
  return {
    slug: p.slug, title: p.title, category: p.category, type: p.type, discipline: p.discipline,
    location: p.location, locationDetail: p.location_detail, lat: p.lat ?? null, lng: p.lng ?? null,
    date: p.project_date, dateBucket: p.date_bucket,
    period: p.period, designer: designerNamesFrom(row.designer_names),
    officeNames: officeNamesFrom(row.office_names),
    photoCredit: { text: p.photo_credit_text || '', url: p.photo_credit_url || '' },
    description: p.description, images: coverOnly ? p.images.slice(0, 1) : p.images,
    buildStatus: p.build_status === 'concept' ? 'concept' : 'built',
    conceptCategory: p.concept_category || null,
    awards: p.awards || [],
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
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.slug, p.title, p.category, p.type, p.discipline, p.location, p.location_detail,
            p.project_date, p.date_bucket, p.period, p.description, p.images, p.photo_credit_text,
            p.photo_credit_url, p.build_status, p.concept_category, p.awards,
            GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names, ${OFFICE_NAMES_SQL}
     FROM projects p ${DESIGNER_JOIN_SQL}
     WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND p.build_status = ?
     GROUP BY p.id ORDER BY COALESCE(p.publish_date, p.created_at) DESC, p.id DESC`
  ).bind(status).all();
  return results.map(row => shapeProjectItem(row, { coverOnly: true }));
}

// proje.html sunucudan gelen filters.designer/designerOffice listelerini olduğu gibi render eder,
// kendi tarafında ayrım hesaplamaz — bu yüzden Mimar/Firma ayrımının TEK kaynağı burasıdır.
export function buildFilterGroups(ratingByProject) {
  return [
    { key: 'discipline', label: 'Tür', nested: false, field: p => p.discipline || [] },
    { key: 'category', label: 'Tip', nested: false, field: p => p.category || [] },
    // Yalnızca build_status='concept' projelerde dolu (bkz. migrations/0038_project_concept_category.sql)
    // — 'built' projelerde her zaman [] döner, bu yüzden proje.html tarafında (o sayfa bu grubu
    // kendi FILTER_GROUPS listesine hiç eklemiyor) hiçbir etkisi olmaz.
    { key: 'conceptCategory', label: 'Kategori', nested: false, field: p => p.conceptCategory ? [p.conceptCategory] : [] },
    { key: 'type', label: 'Grup', nested: false, field: p => p.type || [] },
    { key: 'location', label: 'Yer', nested: false, field: p => [parseLocationFull(p.location).city] },
    { key: 'district', label: 'İlçe', nested: true, parentKey: 'location', parentValue: 'İstanbul', field: p => {
        const info = parseLocationFull(p.location);
        return (info.district && info.city === 'İstanbul') ? [info.district] : [];
      } },
    { key: 'dateBucket', label: 'Yıl', nested: false, field: p => [p.dateBucket] },
    { key: 'designer', label: 'Mimar', nested: false, field: p => (p.designer || []).filter(d => !(p.officeNames || []).includes(d)) },
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
