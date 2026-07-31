// Faz 2 iskeleti — Cloudflare Image Resizing (/cdn-cgi/image/...) zone panelinden
// (Speed > Optimization > Image Resizing, ya da Cloudflare Images) teyit edilene kadar
// devre dışı. Bu dosya hiçbir şablona bağlanmıyor; IMAGE_CDN_ENABLED true yapılıp
// görsel render noktalarında cdnImg()/cdnSrcset() çağrıldığında devreye girer, o ana kadar
// sıfır davranış değişikliği/risk.
const IMAGE_CDN_ENABLED = false;

// path: "mimarlar-thumb/foo.jpg" gibi köke göreli bir görsel yolu; width: hedef piksel genişliği.
function cdnImg(path, width) {
  if (!IMAGE_CDN_ENABLED || !path) return path;
  return `/cdn-cgi/image/width=${width},format=auto,fit=cover/${path}`;
}

// widths: [400, 800, 1200] gibi bir dizi — "url 400w, url 800w, url 1200w" üretir.
function cdnSrcset(path, widths) {
  if (!IMAGE_CDN_ENABLED || !path) return '';
  return widths.map(w => `${cdnImg(path, w)} ${w}w`).join(', ');
}
