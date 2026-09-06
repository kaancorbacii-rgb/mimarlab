// GÜNDEM KATEGORİ WHITELIST'İ (kullanıcı isteği, 2026-09-06 madde 11).
//
// TEK KAYNAK: hem AI'nin seçebileceği değerler, hem D1'e yazılabilecek değerler, hem /gundem
// sayfasındaki filtre çipleri buradan üretilir. AI whitelist dışında bir şey önerirse değer sessizce
// atılır ve kaynağın defaultCategory'sine düşülür — "AI ne derse yazılır" DEĞİL (bkz. kullanıcı
// isteği madde 26).
export const GUNDEM_CATEGORIES = [
  { key: 'haber', label: 'Haber' },
  { key: 'etkinlik', label: 'Etkinlik' },
  { key: 'gorus', label: 'Görüş' },
  { key: 'yarisma', label: 'Yarışma' },
  { key: 'kariyer', label: 'Kariyer' },
];

export const GUNDEM_CATEGORY_KEYS = GUNDEM_CATEGORIES.map(c => c.key);

export function isValidGundemCategory(value) {
  return typeof value === 'string' && GUNDEM_CATEGORY_KEYS.includes(value);
}

export function gundemCategoryLabel(key) {
  const found = GUNDEM_CATEGORIES.find(c => c.key === key);
  return found ? found.label : '';
}
