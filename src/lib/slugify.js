// save-widget.js (frontend) ile birebir aynı algoritma — mimar/marka temiz URL'lerinde (/mimar/:slug,
// /markalar/:slug) isim eşleştirmesinin sunucu (redirect) ve istemci (profil sayfası lookup) tarafında
// aynı sonucu üretmesi gerekir, bu yüzden iki ayrı dosyada bilerek birebir kopyalanmıştır.
const TR_MAP = { ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' };

export function slugify(text) {
  return (text || '')
    .split('').map(ch => TR_MAP[ch] || ch).join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
