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
];

export const GUNDEM_CATEGORY_KEYS = GUNDEM_CATEGORIES.map(c => c.key);

export function isValidGundemCategory(value) {
  return typeof value === 'string' && GUNDEM_CATEGORY_KEYS.includes(value);
}

export function gundemCategoryLabel(key) {
  const found = GUNDEM_CATEGORIES.find(c => c.key === key);
  return found ? found.label : '';
}
