// save-widget.js (frontend) ile birebir aynı algoritma — mimar/marka temiz URL'lerinde (/kisi/:slug,
// /firma/:slug) isim eşleştirmesinin sunucu (redirect) ve istemci (profil sayfası lookup) tarafında
// aynı sonucu üretmesi gerekir; save-widget.js tarayıcıda modül olmadan çalıştığından orada bilerek
// birebir kopyalanmıştır. Sunucu tarafındaki DİĞER tüm kullanımlar (ör. submissionTypes.js) BURADAN
// import eder — denetim bulgusu: submissionTypes.js'te belgelenmemiş, sessizce sapabilecek üçüncü
// bir kopya bulunmuştu, buraya import'a çevrilerek tekilleştirildi (2026-08-13).
const TR_MAP = {
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
  // AKSANLI HARFLER (kullanıcı isteği, 2026-09-08): eskiden bu harfler haritada YOKTU ve
  // `.replace(/[^a-z0-9]+/g,'-')` onları ASCII olmadıkları için TİRE'ye çeviriyordu — yani
  // katlanmıyor, DÜŞÜYORLARDI. Canlı sonuç: "Celâleddin Çelik" -> /kisi/cel-leddin-celik,
  // "José Bruguera" -> /kisi/jos-bruguera, "èdoc architects" -> /firma/doc-architects.
  // Türkçe şapkalılar + Latin aksanları artık ASCII karşılığına katlanıyor.
  â: 'a', Â: 'a', á: 'a', Á: 'a', à: 'a', À: 'a', ä: 'a', Ä: 'a', ã: 'a', Ã: 'a', å: 'a', Å: 'a',
  é: 'e', É: 'e', è: 'e', È: 'e', ê: 'e', Ê: 'e', ë: 'e', Ë: 'e',
  î: 'i', Î: 'i', í: 'i', Í: 'i', ì: 'i', Ì: 'i', ï: 'i', Ï: 'i',
  ô: 'o', Ô: 'o', ó: 'o', Ó: 'o', ò: 'o', Ò: 'o', õ: 'o', Õ: 'o', ø: 'o', Ø: 'o',
  û: 'u', Û: 'u', ú: 'u', Ú: 'u', ù: 'u', Ù: 'u',
  ñ: 'n', Ñ: 'n', ý: 'y', Ý: 'y', š: 's', Š: 's', ž: 'z', Ž: 'z',
  ć: 'c', Ć: 'c', č: 'c', Č: 'c', ł: 'l', Ł: 'l', đ: 'd', Đ: 'd',
};

export function slugify(text) {
  return (text || '')
    .split('').map(ch => TR_MAP[ch] || ch).join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
