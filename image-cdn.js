// Faz 2 — Cloudflare Image Resizing (/cdn-cgi/image/...) zone panelinden (Speed > Optimization >
// Image Resizing) etkinleştirildi ve canlıda doğrulandı (bkz. kullanıcı isteği: "Cloudflare'da
// Image Resizing'i etkinleştirdim" — 2026-08-10, gerçek bir R2 görseli ve statik bir logo
// `/cdn-cgi/image/width=...` ile test edilip `cf-resized: internal=ok` header'ıyla 200 döndüğü
// doğrulandı). cdnImg()/cdnSrcset() artık tüm render noktalarında (index.html, proje.html,
// mimar.html, firma.html, arama.html, js/components/*) gerçek resize URL'i üretiyor.
const IMAGE_CDN_ENABLED = true;

// path: "mimarlar-thumb/foo.jpg" (köke göreli, eğik çizgisiz) YA DA "/media/u/.../foo.webp" (R2
// yüklemesi, baştan eğik çizgili) olabilir — ikisi de canlıda gerçekten kullanılıyor (bkz.
// src/routes/upload.js#handleMediaRoute, proje/mimar/firma kayıtlarındaki fotoğraf alanları).
// Baştaki "/" burada temizlenmezse `/cdn-cgi/image/.../` sonrasına çift eğik çizgili bir yol
// eklenir (".../fit=cover//media/...") — gerçek bulgu: bu, Cloudflare Image Resizing'in orijine
// giden iç isteğini kırıyor ("ERROR 9404: Could not fetch the image ... 404"), canlıda doğrulandı
// (IMAGE_CDN_ENABLED etkinleştirildikten hemen sonra). Tek eğik çizgiye normalize etmek her iki
// yol biçimini de aynı, çalışan URL'e indirger.
function cdnImg(path, width) {
  if (!IMAGE_CDN_ENABLED || !path) return path;
  // gerçek bulgu: Cloudflare Image Resizing SVG rasterizasyonu tutarsız — bazı vektör dosyalarında
  // (ör. <filter> primitifleri kullananlarda) sessizce 415 Unsupported Media Type dönüyor, bazılarında
  // da yalnızca değişmeden geçiriyor. SVG zaten çözünürlükten bağımsız olduğundan resize'a hiç gerek
  // yok — path'i olduğu gibi döndürüp transform'u atlamak hem 415 riskini ortadan kaldırıyor hem de
  // orijinal vektör kalitesini koruyor.
  if (/\.svg(\?|$)/i.test(path)) return path;
  return `/cdn-cgi/image/width=${width},format=auto,fit=cover/${path.replace(/^\/+/, '')}`;
}

// widths: [400, 800, 1200] gibi bir dizi — "url 400w, url 800w, url 1200w" üretir.
function cdnSrcset(path, widths) {
  if (!IMAGE_CDN_ENABLED || !path) return '';
  return widths.map(w => `${cdnImg(path, w)} ${w}w`).join(', ');
}
