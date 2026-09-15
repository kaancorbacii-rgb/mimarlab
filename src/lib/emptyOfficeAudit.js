// "İÇERİĞİ HİÇ OLMAYAN BLURLU FİRMA" TANIMININ TEK KAYNAĞI (kullanıcı isteği, 2026-09-15 on ikinci
// tur: "Sitede hiç kurucusu, kurucu ortağı, ortağı, projesi, çektiği fotoğraflar bölümü veya ürünü
// olmayan blurlu firmaları arşive al").
//
// BU MODÜL KURAL KOPYALAMAZ — VERİYİ DE KENDİ TOPLAMAZ. "Firmanın künyesinde ne var" sorusunun
// cevabı, firma pop-up'ını çizen CANLI koddan (src/routes/office.js#buildOfficePayload) ve arşiv
// cascade'inin KENDİ toplayıcısından (src/lib/officeArchiveCascade.js#collectOfficeArchiveTargets)
// gelir; buraya hazır sonuç olarak GEÇİRİLİR. Kendi sorgularını yazsaydı, pop-up bir bölümü
// değiştirdiği gün betik "boş" demeye devam eder ve sitede içeriği görünen bir firmayı arşivlerdi.
//
// NEDEN PAYLOAD DIŞARIDAN GELİYOR: bu depoda src/lib -> src/routes yönünde HİÇ import yok
// (bağımlılık tek yönlü: routes -> lib, ölçüldü). Kural burada SAF bir fonksiyon olarak durur,
// veriyi çağıran (betik / test) toplar.
import { foldTr } from './textMatch.js';

// Blurlu ("soluk") firma = hidden_at DOLU + preview_at DOLU. Üç durumun tanımı için bkz.
// migrations/0107_preview_state.sql ve src/lib/officeArchiveCascade.js#isAlreadyArchived:
//   hidden_at NULL, preview_at NULL -> yayında
//   hidden_at DOLU, preview_at DOLU -> ÖNİZLEME: listelerde SOLUK/BLURLU kart olarak görünür
//   hidden_at DOLU, preview_at NULL -> tam arşiv: hiçbir yerde görünmez (bu betiğin HEDEF durumu)
export async function fetchPreviewOffices(env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM offices
      WHERE deleted_at IS NULL AND hidden_at IS NOT NULL AND preview_at IS NOT NULL
      ORDER BY name COLLATE NOCASE`
  ).all();
  return results || [];
}

// "ÇEKTİĞİ FOTOĞRAFLAR" — FİRMA tarafının TERS YÖNÜ.
//
// project_photographers YALNIZCA architect_id tutar (bkz. migrations/0080_project_photographers.sql
// — "fotoğrafçı bir KİŞİ profilidir" varsayımı), yani bir FİRMANIN fotoğrafçı bağı şemada HİÇ YOK.
// Künyedeki "Fotoğraf:" satırı bir stüdyo adı taşıdığında karşılığı okuma anında ADDAN çözülür —
// bkz. src/routes/project.js#fetchPhotographerOfficeDetails. Orası "bu künyedeki adların firma
// karşılığı kim?" diye sorar; burada AYNI eşleşmenin tersine ihtiyaç var: "bu firmanın adı herhangi
// bir künyede fotoğrafçı olarak geçiyor mu?".
//
// AYNI İKİ KURAL kullanılır ki iki yön ayrışmasın: (1) virgülle ayırma, (2) foldTr ile katlama.
// Tek bir tarama tüm firmalara yeter — firma başına sorgu açmak yüzlerce gereksiz D1 turu olurdu.
//
// KAPSAM: arşivlenmiş (preview_at BOŞ) projeler de OKUNUR. Fotoğrafçı satırı olan bir projenin
// sonradan yayına alınması mümkündür; "bu firma hiç fotoğraf çekmemiş" demek için hiçbir künyede
// geçmemesi gerekir. Kapsamı geniş tutmak yalnızca DAHA AZ firmayı arşivler (güvenli yön).
export async function fetchPhotographerNameFolds(env) {
  const { results } = await env.DB.prepare(
    `SELECT photo_credit_text AS t FROM projects
      WHERE deleted_at IS NULL AND photo_credit_text IS NOT NULL AND TRIM(photo_credit_text) != ''`
  ).all();
  const folds = new Set();
  for (const row of results || []) {
    for (const part of String(row.t || '').split(',')) {
      const fold = foldTr(part.trim());
      if (fold) folds.add(fold);
    }
  }
  return folds;
}

// KARARIN KENDİSİ — saf fonksiyon, hiçbir şey okumaz/yazmaz.
//
// `payload`  : src/routes/office.js#buildOfficePayload çıktısı (pop-up'ın TA KENDİSİ).
// `cascade`  : src/lib/officeArchiveCascade.js#collectOfficeArchiveTargets çıktısı.
// `photographerFolds` : fetchPhotographerNameFolds(env) çıktısı.
//
// "BOŞ" SAYILMAK İÇİN ALTI KAPININ HEPSİ BOŞ OLMALI:
//   1) founders  — "Kurucular / Ortaklar" bölümü. Kullanıcının saydığı "kurucu, kurucu ortak,
//                  ortak" TAM OLARAK budur (bkz. office.js#buildOfficePeople'daki FOUNDER_POSITIONS).
//   2) team      — "Ekip" bölümü. Kullanıcı bunu SAYMADI; yine de kapı sayılıyor çünkü tek bir ekip
//                  üyesi bile pop-up'ta GÖRÜNEN bir içeriktir ve onu "hiç içeriği yok" diye arşive
//                  almak kullanıcının tarif ettiği boşluğa uymaz. Rapor bu firmaları AYRI sayar ki
//                  kullanıcı isterse ikinci turda kapsama alabilsin.
//   3) projects  — "Projeler" bölümü (relatedProjects).
//   4) products  — "Ürünler" bölümü: ürün + yapı malzemesi (relatedProducts + relatedMaterials).
//                  BUNLAR FİRMANIN KENDİ KATALOĞUDUR; "Projelerde Kullanılan Ürünler"
//                  (projectProducts) BİLEREK sayılmaz — o küme firmanın KENDİ projelerinden türer
//                  ve projesi olmayan bir firmada tanımı gereği zaten boştur.
//   5) photo     — künyelerde fotoğrafçı olarak geçen ad (yukarıdaki ters eşleşme).
//   6) cascade   — arşivleme bu firmayla BİRLİKTE başka bir kaydı da götürecek mi? Pop-up'ın
//                  görmediği YAPISAL bağlar burada yakalanır (örn. architects.office_id ile bağlı
//                  ama office_founders satırı olmayan bir kişi — cascade onu arşivler, pop-up onu
//                  hiç çizmez). `skipped` de sayılır: "ortak künye koruması" bir kaydın VAR
//                  olduğunun kanıtıdır.
export function auditOfficeContent(office, payload, cascade, photographerFolds) {
  const founders = (payload.founders || []).length;
  const team = (payload.team || []).length;
  const projects = (payload.relatedProjects || []).length;
  const products = (payload.relatedProducts || []).length + (payload.relatedMaterials || []).length;
  const photographer = photographerFolds.has(foldTr(office.name || ''));
  const cascadeCount = cascade
    ? (cascade.architects || []).length + (cascade.projects || []).length + (cascade.products || []).length
      + (cascade.skipped?.architects || []).length + (cascade.skipped?.projects || []).length + (cascade.skipped?.products || []).length
    : 0;
  return {
    name: office.name,
    slug: office.slug,
    founders, team, projects, products, photographer, cascade: cascadeCount,
    // Kullanıcının saydığı dört kalem — raporda "yalnızca Ekip'i olduğu için korundu" ayrımını
    // yapabilmek için ayrıca tutulur.
    emptyByUserRule: founders === 0 && projects === 0 && products === 0 && !photographer,
    empty: founders === 0 && team === 0 && projects === 0 && products === 0 && !photographer && cascadeCount === 0,
  };
}
