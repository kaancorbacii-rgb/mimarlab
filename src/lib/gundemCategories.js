// GÜNDEM KATEGORİ WHITELIST'İ (kullanıcı isteği, 2026-09-06 madde 11).
//
// TEK KAYNAK: hem AI'nin seçebileceği değerler, hem D1'e yazılabilecek değerler, hem /gundem
// sayfasındaki filtre çipleri buradan üretilir. AI whitelist dışında bir şey önerirse değer sessizce
// atılır ve kaynağın defaultCategory'sine düşülür — "AI ne derse yazılır" DEĞİL (bkz. kullanıcı
// isteği madde 26).
// chip:false — kategori GEÇERLİ olmaya devam eder (AI seçebilir, D1'e yazılır, kartta etiketi
// görünür) ama /gundem sayfasında FİLTRE ÇİPİ ÜRETMEZ (kullanıcı isteği 2026-09-07: "Görüş ve
// Kariyer butonlarını kaldır").
//
// NEDEN LİSTEDEN SİLİNMEDİ: bu dizi aynı zamanda whitelist'tir. 'gorus' silinseydi
// isValidGundemCategory('gorus') false olur, D1'de ZATEN 'gorus' olan kayıtların kart etiketi
// boşalır (bkz. gundemCategoryLabel ve js/pages/gundem.js#53) ve AI'nin doğru sınıflandırdığı
// içerik kaynağın defaultCategory'sine düşerdi. Çip listesi ile whitelist AYRI şeylerdir; burada
// yalnızca sunum tarafı kapatılır.
export const GUNDEM_CATEGORIES = [
  { key: 'haber', label: 'Haber' },
  { key: 'etkinlik', label: 'Etkinlik' },
  { key: 'gorus', label: 'Görüş', chip: false },
  { key: 'yarisma', label: 'Yarışma' },
  { key: 'kariyer', label: 'Kariyer', chip: false },
  // İş / Staj İlanı (kullanıcı isteği, 2026-09-12: "Gündem sayfasında Yarışma butonuyla İçerik
  // ekle butonunun arasına İş ve Staj İlanları butonu ekle. Firma ve marka popuplarında yayınlanan
  // ilanlar burada da yayınlansın"). Kaynaklar: firma/marka popup'ındaki "İlan Yayınla" (src/routes/
  // officeJobs.js — ilanı burada da yayınlanmış bir satır olarak yazar) ve İçerik Ekle'deki aynı
  // adlı seçenek (admin onayından geçer). Dizideki sıra = çip sırası: Yarışma'dan hemen sonra,
  // "İçerik Ekle"nin hemen önünde.
  // ETİKET 'İş ve Staj İlanları' -> 'İş / Staj İlanı' (kullanıcı isteği, 2026-09-12): uzun etiket
  // 375px'lik ekranda çip satırını taşırıyordu (ölçüldü: çip bloğu 433px, toolbar 347px). Kısaltma
  // TEK BAŞINA yetmez, gundem.html'deki .gundem-chips{flex-shrink:0} kuralı da mobilde gevşetildi —
  // aksi halde blok yine max-content genişlikte kalır ve sarmazdı.
  // formLabel KALDIRILDI: çip etiketi ile form etiketi artık AYNI (gundemSsr.js#GUNDEM_USER_CATEGORIES
  // hâlâ `c.formLabel || c.label` okur, ileride yine ayrışabilirler).
  { key: 'ilan', label: 'İş / Staj İlanı', ai: false },
];

export const GUNDEM_CATEGORY_KEYS = GUNDEM_CATEGORIES.map(c => c.key);
export const GUNDEM_AI_CATEGORY_KEYS = GUNDEM_CATEGORIES.filter(c => c.ai !== false).map(c => c.key);

export function isValidGundemCategory(value) {
  return typeof value === 'string' && GUNDEM_CATEGORY_KEYS.includes(value);
}

export function gundemCategoryLabel(key) {
  const found = GUNDEM_CATEGORIES.find(c => c.key === key);
  return found ? found.label : '';
}
