// MİMARLAB — uye-ol.html (Üye Ol), kisi-ekle.html (kişi ekle/düzenle) ve
// js/components/auth-modal.js (Hesabım > Profili Düzenle) arasında PAYLAŞILAN tek meslek listesi
// kaynağı (kullanıcı isteği, 2026-09-02: "Üye ol, kişi ekle ve profilini düzenle sayfaları
// birbirine entegreli ve dinamik şekilde çalışmalı").
//
// ÖNCEKİ DURUM — aynı liste ÜÇ yerde ayrı ayrı yazılıydı:
//   1) uye-ol.html'de elle yazılmış 10 <label><input type="checkbox"> satırı,
//   2) kisi-ekle.html#MESLEK_OPTIONS (ham Türkçe etiketler),
//   3) js/components/auth-modal.js#PROFESSION_LABELS (slug -> etiket eşlemesi).
// Üçü de birbiriyle elle senkron tutulmak zorundaydı; bir meslek eklemek üç dosyaya dokunmayı
// gerektiriyordu ve biri unutulduğunda hata SESSİZ oluyordu (kullanıcı üye olurken seçebildiği bir
// mesleği profilini düzenlerken göremiyordu). awards-shared.js ile BİREBİR aynı desen.
//
// İKİ GÖSTERİM, TEK KAYNAK:
//   * users.profession  -> SLUG ("mimar")        — üye kaydı/hesap tarafı
//   * architects.profession -> ETİKET ("Mimar")  — mimar profili tarafı, virgülle çoklu
// Bu ayrım veritabanında zaten böyleydi ve DEĞİŞTİRİLMEDİ (bir veri taşıması gerektirirdi);
// aşağıdaki iki yardımcı, iki gösterim arasında tek noktadan çeviri yapar.

const PROFESSION_ITEMS = [
  { slug: 'mimar',           label: 'Mimar' },
  { slug: 'ic_mimar',        label: 'İç Mimar' },
  { slug: 'peyzaj_mimari',   label: 'Peyzaj Mimarı' },
  { slug: 'sehir_plancisi',  label: 'Şehir Plancısı' },
  { slug: 'restorator',      label: 'Restoratör' },
  { slug: 'tasarimci',       label: 'Tasarımcı' },
  { slug: 'muhendis',        label: 'Mühendis' },
  { slug: 'fotografci',      label: 'Fotoğrafçı' },
  { slug: 'ogrenci',         label: 'Öğrenci' },
  { slug: 'diger',           label: 'Diğer' },
];

// Geriye dönük uyumluluk: mevcut üç dosyanın halihazırda kullandığı iki biçim de buradan türetilir,
// böylece o dosyalardaki çağrı yerlerini yeniden yazmaya gerek kalmaz.
const MESLEK_OPTIONS = PROFESSION_ITEMS.map(p => p.label);
const PROFESSION_LABELS = PROFESSION_ITEMS.reduce((acc, p) => { acc[p.slug] = p.label; return acc; }, {});

// Etiket -> slug (kisi-ekle "Mimar, Fotoğrafçı" yazarken, hesap tarafı ["mimar","fotografci"] ister).
function professionSlugOf(label) {
  const found = PROFESSION_ITEMS.find(p => p.label === String(label || '').trim());
  return found ? found.slug : null;
}
function professionLabelOf(slug) {
  return PROFESSION_LABELS[String(slug || '').trim()] || null;
}

if (typeof module !== 'undefined') {
  module.exports = { PROFESSION_ITEMS, MESLEK_OPTIONS, PROFESSION_LABELS, professionSlugOf, professionLabelOf };
}
