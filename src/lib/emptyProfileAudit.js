// "İÇERİĞİ HİÇ OLMAYAN BLURLU PROFİL" TANIMININ TEK KAYNAĞI — FİRMA ve KİŞİ için AYNI modül.
//
// Kullanıcı isteği, 2026-09-15 on ikinci tur: "Sitede hiç kurucusu, kurucu ortağı, ortağı, projesi,
// çektiği fotoğraflar bölümü veya ürünü olmayan blurlu firmaları arşive al." + on üçüncü tur:
// "Aynı şekilde blurlu kişileri de kontrol et."
//
// İKİ TİP TEK DOSYADA: kural aynı ("pop-up'ında gösterilecek hiçbir şeyi yok"), yalnızca hangi
// bölümlerin sayıldığı değişir. İki ayrı modül, "sahiplenilmiş profile dokunma" gibi ORTAK
// kapıların birinde unutulacağı tek yer olurdu.
//
// BU MODÜL KURAL KOPYALAMAZ — VERİYİ DE KENDİ TOPLAMAZ. "Profilin künyesinde ne var" sorusunun
// cevabı, pop-up'ı çizen CANLI koddan (src/routes/office.js#buildOfficePayload /
// src/routes/architect.js#buildArchitectPayload) ve firma tarafında arşiv cascade'inin KENDİ
// toplayıcısından (src/lib/officeArchiveCascade.js#collectOfficeArchiveTargets) gelir; buraya hazır
// sonuç olarak GEÇİRİLİR. Kendi sorgularını yazsaydı, pop-up bir bölümü değiştirdiği gün betik
// "boş" demeye devam eder ve sitede içeriği görünen bir profili arşivlerdi.
//
// NEDEN PAYLOAD DIŞARIDAN GELİYOR: bu depoda src/lib -> src/routes yönünde HİÇ import yok
// (bağımlılık tek yönlü: routes -> lib, ölçüldü). Kural burada SAF bir fonksiyon olarak durur,
// veriyi çağıran (betik / test) toplar.
import { foldTr } from './textMatch.js';

// Desteklenen iki tip. `table` canonical tablo, `claimType` profile_claims.profile_type değeri.
export const PROFILE_KINDS = {
  offices: { table: 'offices', claimType: 'office', label: 'firma' },
  architects: { table: 'architects', claimType: 'architect', label: 'kişi' },
};

// Blurlu ("soluk") profil = hidden_at DOLU + preview_at DOLU. Üç durumun tanımı için bkz.
// migrations/0107_preview_state.sql ve src/lib/officeArchiveCascade.js#isAlreadyArchived:
//   hidden_at NULL, preview_at NULL -> yayında
//   hidden_at DOLU, preview_at DOLU -> ÖNİZLEME: listelerde SOLUK/BLURLU kart olarak görünür
//   hidden_at DOLU, preview_at NULL -> tam arşiv: hiçbir yerde görünmez (bu betiğin HEDEF durumu)
export async function fetchPreviewProfiles(env, kind) {
  const { table } = PROFILE_KINDS[kind];
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${table}
      WHERE deleted_at IS NULL AND hidden_at IS NOT NULL AND preview_at IS NOT NULL
      ORDER BY name COLLATE NOCASE`
  ).all();
  return results || [];
}

// "ÇEKTİĞİ FOTOĞRAFLAR" — künyedeki "Fotoğraf:" satırında adı geçenlerin TERS YÖNÜ.
//
// FİRMA tarafında bu TEK yoldur: project_photographers YALNIZCA architect_id tutar (bkz.
// migrations/0080_project_photographers.sql — "fotoğrafçı bir KİŞİ profilidir" varsayımı), yani bir
// FİRMANIN fotoğrafçı bağı şemada HİÇ YOK; karşılığı okuma anında ADDAN çözülür (bkz.
// src/routes/project.js#fetchPhotographerOfficeDetails). KİŞİ tarafında yapısal bağ VAR ve pop-up'ın
// "Fotoğrafladığı Projeler" bölümünü zaten o besler — bu küme orada YEDEK kapıdır: künyeye adı
// yazılmış ama kenar tablosuna hiç bağlanmamış bir fotoğrafçı da korunur.
//
// AYNI İKİ KURAL kullanılır ki iki yön ayrışmasın: (1) virgülle ayırma, (2) foldTr ile katlama.
// Tek bir tarama tüm profillere yeter — profil başına sorgu açmak yüzlerce gereksiz D1 turu olurdu.
//
// KAPSAM: arşivlenmiş projeler de OKUNUR. Fotoğrafçı satırı olan bir projenin sonradan yayına
// alınması mümkündür; "bu profil hiç fotoğraf çekmemiş" demek için hiçbir künyede geçmemesi
// gerekir. Kapsamı geniş tutmak yalnızca DAHA AZ profili arşivler (güvenli yön).
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

// SAHİPLİK — "bu profil bir ÜYEYE ait mi?".
//
// NEDEN KAPI: profil boş görünse bile bir hesabın Hesabım sayfasındaki Firma/Kişi kutusunu besliyor
// olabilir (bkz. CLAUDE.md "Kaydı ekleyen, o kaydın yöneticisidir" ve "Hesap üyeliği ile kişi
// profili AYRIDIR"). Onu arşivlemek, üyenin profilini sitede ve kendi hesabında GÖRÜNMEZ yapar —
// "içeriği yok" demek "sahibi yok" demek değildir. Henüz proje eklememiş yeni bir üyenin kaydı tam
// olarak bu durumdadır.
//
// ÜÇ KAYNAK (tamamı tek taramada, profil başına sorgu YOK):
//   1. claimed_by_user_id — kaydı siteye ekleyen hesap (yetkinin kaynağı, bkz. claimedProfiles.js).
//   2. profile_claims — admin ataması. status 'approved' VE 'pending' birlikte sayılır: bekleyen bir
//      sahiplenme talebi de "bu profille ilgilenen biri var" demektir, arşiv onu sessizce düşürürdü.
//   3. consultants (YALNIZCA kişi) — danışman kadrosu. Durumuna bakılmaksızın: onaylı bir danışmanı
//      arşivlemek /danismanlik sayfasındaki kartı ve randevu kapısını kırar (bkz.
//      src/lib/consultants.js#fetchApprovedConsultant), bekleyen bir başvuru ise admin'in onay
//      kuyruğunda duran gerçek bir taleptir.
export async function fetchOwnership(env, kind) {
  const { table, claimType } = PROFILE_KINDS[kind];
  const [ownedRes, claimRes, consultantRes] = await Promise.all([
    env.DB.prepare(`SELECT id FROM ${table} WHERE deleted_at IS NULL AND claimed_by_user_id IS NOT NULL`).all(),
    env.DB.prepare(
      `SELECT profile_key AS k FROM profile_claims WHERE profile_type = ? AND status IN ('approved', 'pending')`
    ).bind(claimType).all(),
    kind === 'architects'
      ? env.DB.prepare(`SELECT architect_slug AS s FROM consultants`).all()
      : Promise.resolve({ results: [] }),
  ]);
  return {
    ownedIds: new Set((ownedRes.results || []).map(r => r.id)),
    claimedFolds: new Set((claimRes.results || []).map(r => foldTr(r.k || '')).filter(Boolean)),
    consultantSlugs: new Set((consultantRes.results || []).map(r => r.s).filter(Boolean)),
  };
}

// KİŞİNİN YAPISAL BAĞLARI — pop-up'ın GÖRMEDİĞİ kenarlar.
//
// NEDEN VAR: firma tarafında bu işi arşiv cascade'inin KENDİ toplayıcısı yapıyor
// (officeArchiveCascade.js#collectOfficeArchiveTargets) — bir kişiyi arşivlemek hiçbir şeyi
// beraberinde götürmediği için (bkz. legacyContent.js#archiveOfficeGraph'ın `type !== 'offices'`
// kapısı) kişi tarafında öyle bir toplayıcı YOK. Ama kenarlar var ve bazıları pop-up'a HİÇ
// yansımıyor; en somutu: `product_architects` satırı olan ama adı `products.designer` metninde
// GEÇMEYEN bir tasarımcı — "Tasarladığı Ürünler" bölümü o metinle süzüldüğünden (bkz.
// architect.js#relatedProducts) pop-up boş görünür, oysa kayıt gerçek bir tasarım bağı taşır.
// Aynısı TAM ARŞİVDEKİ bir firmaya `office_founders` ile bağlı kişi için de geçerli.
//
// DÖRT KENAR, TEK taramada (profil başına sorgu YOK). Görünürlük süzgeci BİLEREK YOK: soru
// "pop-up'ta çıkıyor mu" değil, "bu kişinin sitede bir bağı var mı".
export async function fetchArchitectLinkIds(env) {
  const [founders, designers, photographers, products] = await Promise.all([
    env.DB.prepare(`SELECT DISTINCT architect_id AS id FROM office_founders`).all(),
    env.DB.prepare(`SELECT DISTINCT architect_id AS id FROM project_designers WHERE architect_id IS NOT NULL`).all(),
    env.DB.prepare(`SELECT DISTINCT architect_id AS id FROM project_photographers`).all(),
    env.DB.prepare(`SELECT DISTINCT architect_id AS id FROM product_architects`).all(),
  ]);
  const ids = new Set();
  for (const res of [founders, designers, photographers, products]) {
    for (const r of res.results || []) if (r.id !== null && r.id !== undefined) ids.add(r.id);
  }
  return ids;
}

// FİRMA pop-up'ının içerik bölümleri (bkz. js/components/office-modal.js başlıkları).
//
// "Projelerde Kullanılan Ürünler", "Projelerde Kullanılan Firmalar", "Tercih Eden Firmalar/Mimarlar"
// ve "Şehirdeki Diğer Firmalar" BİLEREK sayılmaz: ilk dördü firmanın KENDİ projelerinden türer
// (projesi olmayan firmada tanımı gereği boştur), sonuncusu ise bir öneri şerididir — içerik değil.
function officeSections(payload) {
  return {
    founders: (payload.founders || []).length,
    team: (payload.team || []).length,
    projects: (payload.relatedProjects || []).length,
    products: (payload.relatedProducts || []).length + (payload.relatedMaterials || []).length,
  };
}

// KİŞİ pop-up'ının içerik bölümleri (bkz. js/components/architect-modal.js başlıkları).
//
// `offices` — "Firma" bölümü: kişinin birincil firması + kurucu/ortak olduğu firmalar + künyeye
// serbest metin yazılmış firma adları (payload onları `unregistered` olarak zaten katıyor). Bu,
// firma tarafındaki "Kurucular/Ortaklar" kapısının AYNADAKİ karşılığıdır — kullanıcının saydığı
// "kurucusu, kurucu ortağı, ortağı" kişi tarafında "bir firmada kurucu/ortak olmak"tır.
//
// "Ortaklar" / "Ekip Arkadaşları" SAYILMAZ: ikisi de kişinin firmasından türer (office ? ... : []),
// yani firma bağı yokken tanımı gereği boştur — firma tarafındaki "Projelerde Kullanılan Ürünler"
// ile aynı gerekçe. "Tercih Ettiği Firmalar", "Kullandığı Ürünler" ve "Markanın Projeleri" de
// kişinin KENDİ projelerinden türer; "MİMARLAB'daki Diğer Kişiler" bir öneri şerididir.
//
// `portfolio` SAYILIR (firma tarafında karşılığı yok): kişinin KENDİ yüklediği işlerdir (bkz.
// migrations/0105_architect_portfolio.sql) ve pop-up'ta ayrı bir bölüm olarak görünür.
function architectSections(payload) {
  const item = payload.item || {};
  return {
    offices: (payload.offices || []).length,
    projects: (payload.relatedProjects || []).length,
    photographed: (payload.photographedProjects || []).length,
    products: (payload.relatedProducts || []).length,
    portfolio: (item.portfolio || []).length,
  };
}

// KARARIN KENDİSİ — saf fonksiyon, hiçbir şey okumaz/yazmaz.
//
// `kind`      : 'offices' | 'architects'
// `row`       : parseCanonicalRow'dan geçmiş canonical satır (id, name, slug yeterli).
// `payload`   : ilgili buildXPayload çıktısı (pop-up'ın TA KENDİSİ).
// `extras`    : { cascade, photographerFolds, ownership }
//                 cascade — YALNIZCA firma: collectOfficeArchiveTargets çıktısı.
//                 linkIds — YALNIZCA kişi: fetchArchitectLinkIds çıktısı. İkisi AYNI soruyu sorar
//                 ("pop-up'ın görmediği bir bağ var mı"), yalnızca kaynakları farklıdır.
//
// BOŞ SAYILMAK İÇİN İLGİLİ TİPİN TÜM BÖLÜMLERİ + ORTAK ÜÇ KAPI boş olmalı:
//   * fotoğraf künyesi  — yukarıdaki ters eşleşme,
//   * sahiplik          — fetchOwnership'in üç kaynağı,
//   * cascade (firma)   — arşivleme bu profille BİRLİKTE başka bir kaydı da götürecek/koruyacak mı?
//                         Pop-up'ın görmediği YAPISAL bağlar burada yakalanır (örn. architects.
//                         office_id ile bağlı ama office_founders satırı olmayan bir kişi).
//                         `skipped` de sayılır: "ortak künye koruması" bir kaydın VAR olduğunun
//                         kanıtıdır.
export function auditProfileContent(kind, row, payload, { cascade = null, linkIds = null, photographerFolds, ownership }) {
  const sections = kind === 'offices' ? officeSections(payload) : architectSections(payload);
  const sectionTotal = Object.values(sections).reduce((a, b) => a + b, 0);

  const photographer = photographerFolds.has(foldTr(row.name || ''));
  const owned = ownership.ownedIds.has(row.id)
    || ownership.claimedFolds.has(foldTr(row.name || ''))
    || ownership.consultantSlugs.has(row.slug);
  // İKİ TİPİN "pop-up'ın görmediği bağ" kapısı: firmada cascade toplayıcısı, kişide kenar taraması.
  const cascadeCount = cascade
    ? (cascade.architects || []).length + (cascade.projects || []).length + (cascade.products || []).length
      + (cascade.skipped?.architects || []).length + (cascade.skipped?.projects || []).length + (cascade.skipped?.products || []).length
    : 0;
  const linked = !!linkIds && linkIds.has(row.id);

  return {
    kind,
    name: row.name,
    slug: row.slug,
    sections,
    photographer,
    owned,
    cascade: cascadeCount,
    linked,
    empty: sectionTotal === 0 && !photographer && !owned && cascadeCount === 0 && !linked,
  };
}

// Raporun "neden korundu" satırı — betik ve test AYNI cümleyi kullansın diye burada.
export function reasonsFor(audit) {
  const labels = {
    founders: 'kurucu/ortak', team: 'ekip', projects: 'proje', products: 'ürün',
    offices: 'firma', photographed: 'fotoğrafladığı proje', portfolio: 'portfolyo görseli',
  };
  const out = [];
  for (const [key, n] of Object.entries(audit.sections)) if (n) out.push(`${n} ${labels[key] || key}`);
  if (audit.photographer) out.push('fotoğraf künyesi');
  if (audit.owned) out.push('SAHİPLİ (üye kaydı / atama / danışman)');
  if (audit.cascade) out.push(`${audit.cascade} bağlı kayıt`);
  if (audit.linked) out.push('yapısal bağ (pop-up\'ta görünmeyen kenar)');
  return out.join(', ');
}
