// archiveSync.js — "ARŞİV" durumunun canonical satırla TUTARLI kalmasının tek kaynağı.
//
// KULLANICI BULGUSU (2026-09-12): "Sitede hali hazırda yayınlanmış ve blursuz olan içerikler neden
// admin panelinde arşiv kısmında gözüküyorlar." Canlıda 62 satır tam olarak bu durumdaydı
// (28 proje, 20 kişi, 12 firma, 2 malzeme).
//
// KÖK NEDEN: bu depoda "arşiv" İKİ satırın birlikte okunmasıdır (bkz. src/routes/archive.js dosya
// başı) — `*_submissions.status = 'archived'` VE canonical satırın `hidden_at` ile canlıdan
// çekilmiş olması. Yayına alma yollarının bir kısmı (src/routes/admin.js#unpreviewByIds — atama/
// yayın cascade'lerinin ortak ucu) canonical satırın hidden_at/preview_at'ini temizliyor ama
// gönderi satırının status'una HİÇ dokunmuyordu. Sonuç: içerik canlıda yayında ve blursuz, ama
// gönderisi hâlâ 'archived' — admin panelinin Arşiv sekmesi ve kullanıcının Arşivim kutusu onu
// arşivlenmiş sanıyordu.
//
// İKİ KATMANLI ÇÖZÜM (ikisi de burada, kopyalanmasın diye):
//   1) markSubmissionsPublished() — canonical bir satır yayına alındığında ona bağlı 'archived'
//      gönderiler 'approved'a döner. Bundan sonraki yayınlarda iki taraf ayrışmaz.
//   2) notArchivedIfCanonicalLiveSql() — listeleme sorgularına eklenen KENDİ KENDİNİ ONARAN süzgeç:
//      canonical satırı YAYINDA (deleted_at NULL + hidden_at NULL) olan hiçbir satır arşiv
//      listesinde görünmez. Böylece (1)'in kaçırdığı/geçmişte kaçırmış olabileceği her yol için de
//      ekran doğru kalır — canonical satır "yayında mı" sorusunun TEK yetkili cevabıdır.
//
// ÖNİZLEME ("soluk") KAYITLARI ARŞİVDE KALIR, bilerek: onlarda hidden_at DOLUdur (bkz.
// migrations/0107_preview_state.sql) — yani henüz yayında değiller, blurlu gösteriliyorlar.
// Kullanıcının isteği açıkça "blursuz olan ve canlı sitede yayında olan" içeriklerdi.

// Gönderi tipi -> canonical tablo eşlemesi. `claimedColumn` gönderi satırındaki, `canonicalColumn`
// canonical satırdaki eşleşme anahtarıdır (bkz. schema.sql: projeler/ürünler slug, kişi/firma ÇIPLAK
// İSİM — "architects/offices keyed by bare name everywhere" proje notu).
export const CANONICAL_LINK_BY_SUBMISSION_TYPE = {
  projects: { canonicalTable: 'projects', canonicalColumn: 'slug', claimedColumn: 'claimed_slug' },
  architects: { canonicalTable: 'architects', canonicalColumn: 'name', claimedColumn: 'claimed_profile_key' },
  offices: { canonicalTable: 'offices', canonicalColumn: 'name', claimedColumn: 'claimed_profile_key' },
  products: { canonicalTable: 'products', canonicalColumn: 'slug', claimedColumn: 'claimed_slug' },
  // Malzemeler ayrı bir gönderi tablosunda yaşar ama AYNI canonical `products` tablosuna senkronlanır
  // (bkz. src/lib/canonicalSync.js#syncProduct).
  materials: { canonicalTable: 'products', canonicalColumn: 'slug', claimedColumn: 'claimed_slug' },
};

// Ters yön: bir canonical tablo yayına alındığında hangi gönderi tabloları güncellenmeli.
const SUBMISSION_LINKS_BY_CANONICAL_TABLE = {};
for (const [type, link] of Object.entries(CANONICAL_LINK_BY_SUBMISSION_TYPE)) {
  const table = `${type === 'materials' ? 'material' : type.replace(/s$/, '')}_submissions`;
  (SUBMISSION_LINKS_BY_CANONICAL_TABLE[link.canonicalTable] ||= []).push({ table, ...link });
}

// Listeleme sorgusuna eklenecek WHERE parçası (bkz. dosya başı, madde 2). `alias` gönderi tablosuna
// sorguda nasıl erişildiğidir (admin listesi `s` takma adını kullanır, src/routes/archive.js ise
// tabloyu takma adsız seçtiğinden tablo adını geçer). Hiç canonical karşılığı OLMAYAN satırlar
// (claimed sütunu NULL — yayına hiç çıkmamış bir taslağın arşivi) NOT EXISTS'ten geçer ve listede
// KALIR; doğru davranış.
//
// YALNIZCA claimed_* sütunu üzerinden eşleşilir, gönderinin kendi slug/name'i üzerinden DEĞİL:
// canlıda ölçüldü (2026-09-12), ikinci yoldan eşleşen tek bir ayrık satır bile yok, buna karşılık
// "adı canlı bir kayıtla aynı olan ama ondan bağımsız bir taslak" yanlışlıkla gizlenebilirdi.
export function notArchivedIfCanonicalLiveSql(typeKey, alias = 's') {
  const link = CANONICAL_LINK_BY_SUBMISSION_TYPE[typeKey];
  if (!link) return '';
  return ` AND NOT EXISTS (SELECT 1 FROM ${link.canonicalTable} _c
             WHERE _c.${link.canonicalColumn} = ${alias}.${link.claimedColumn}
               AND _c.deleted_at IS NULL AND _c.hidden_at IS NULL)`;
}

// Canonical satır(lar) yayına alındı -> ona bağlı 'archived' gönderiler 'approved'a döner
// (bkz. dosya başı, madde 1). ids: canonical satır id'leri.
//
// src/routes/admin.js#approveArchivedDraftsAndRecordRights ile ÇAKIŞMAZ: o, atama akışının kendi
// yolunda aynı işi yapar ve ayrıca telif beyanı kaydeder; bu ise unpreviewByIds'in — yani yayına
// alan TÜM cascade'lerin ortak ucunun — içinden çalışır. Zaten 'approved' olan bir satırı
// güncellemek no-op olduğundan ikisinin birlikte çalışması sorun değildir.
export async function markSubmissionsPublished(env, canonicalTable, ids) {
  const links = SUBMISSION_LINKS_BY_CANONICAL_TABLE[canonicalTable];
  if (!links || !ids || !ids.length) return;
  const ph = ids.map(() => '?').join(', ');
  const now = Date.now();
  for (const link of links) {
    await env.DB.prepare(
      `UPDATE ${link.table} SET status = 'approved', updated_at = ?
        WHERE status = 'archived'
          AND ${link.claimedColumn} IS NOT NULL
          AND ${link.claimedColumn} IN (SELECT ${link.canonicalColumn} FROM ${canonicalTable} WHERE id IN (${ph}))`
    ).bind(now, ...ids).run();
  }
}
