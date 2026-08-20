// Türkçe büyük/küçük harf + aksan-bağımsız metin eşleştirme — src/routes/legacyContent.js,
// public.js, project.js, architect.js, office.js, product.js içinde altı ayrı yerde birebir aynı
// şekilde tanımlıydı (bkz. denetim bulgusu, MİMARLAB AI çalışması). Var olan altı kopya bilerek
// DOKUNULMADAN bırakıldı (çalışan kod, gereksiz risk); bu dosya yalnızca YENİ kod (src/routes/ai.js)
// için tek bir paylaşılan kaynak sağlar, bir sonraki kopyalanmayı önler.
export function trLower(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}

export function foldTr(s) {
  return trLower(s).replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
}
