// URL-varyant temizleme: aynı görselin farklı boyut/thumbnail varyantlarını (ör. "-300x200",
// "-scaled", "_thumb", "-1024w") TEK bir aday altında birleştirir — AI (src/routes/ai.js) aynı
// görseli birden çok kez görüp image_indices'te yanlışlıkla ayrı ayrı seçmesin, kullanıcı da
// önizlemede aynı fotoğrafı birden çok kez görmesin diye (bkz. kullanıcı isteği: "duplicate
// görseller temizlensin"). Kesin bir çözüm DEĞİLDİR (yalnızca yaygın adlandırma kalıplarını
// tanır) — gerçek bayt-içerik karşılaştırması (bkz. src/routes/ai.js#handleCopyImages'teki SHA-256
// hash kontrolü) yalnızca indirme SONRASI mümkün; bu, indirmeden ÖNCEKİ ucuz ilk eleme aşaması.
const SIZE_SUFFIX_PATTERN = /-(\d{2,5}x\d{2,5}|scaled|thumb|thumbnail|small|medium|large|\d{2,5}w)(?=\.[a-z]{3,4}(?:$|\?))/i;

function stemOf(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(SIZE_SUFFIX_PATTERN, '');
    return `${u.origin}${path}`.toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

// Aynı "stem"e sahip adaylar arasında İLK GÖRÜLENİ korur — htmlExtract.js zaten srcset/picture
// source'tan en yüksek çözünürlüklü adayı ÖNCE ekliyor (bkz. bestFromSrcset), bu yüzden bir stem
// için görülen ilk URL zaten en iyi adaydır.
export function dedupeImageUrls(urls) {
  const seenStems = new Set();
  const out = [];
  for (const url of urls) {
    const stem = stemOf(url);
    if (seenStems.has(stem)) continue;
    seenStems.add(stem);
    out.push(url);
  }
  return out;
}
