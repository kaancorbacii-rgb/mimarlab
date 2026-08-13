// save-widget.js (frontend) ile birebir aynı algoritma — mimar/marka temiz URL'lerinde (/mimar/:slug,
// /firma/:slug) isim eşleştirmesinin sunucu (redirect) ve istemci (profil sayfası lookup) tarafında
// aynı sonucu üretmesi gerekir; save-widget.js tarayıcıda modül olmadan çalıştığından orada bilerek
// birebir kopyalanmıştır. Sunucu tarafındaki DİĞER tüm kullanımlar (ör. submissionTypes.js) BURADAN
// import eder — denetim bulgusu: submissionTypes.js'te belgelenmemiş, sessizce sapabilecek üçüncü
// bir kopya bulunmuştu, buraya import'a çevrilerek tekilleştirildi (2026-08-13).
const TR_MAP = { ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' };

export function slugify(text) {
  return (text || '')
    .split('').map(ch => TR_MAP[ch] || ch).join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
