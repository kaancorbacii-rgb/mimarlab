// Yükleme anında görsel optimizasyonu (bkz. src/routes/upload.js#handleUploadRoute) — R2'ye
// orijinal boyutta (genelde telefon kamerası, birkaç MB) yazmak yerine, Cloudflare Workers Images
// binding (env.IMAGES, bkz. wrangler.jsonc) ile makul bir üst sınıra küçültülüp WebP'ye dönüştürülür,
// sonuç R2'de kanonik hale gelir. gerçek bulgu: denetim raporu — upload.js dosyayı olduğu gibi
// yazıyordu; serve-time /cdn-cgi/image/ (bkz. image-cdn.js) teslim trafiğini optimize ediyordu ama
// depolamanın KENDİSİ optimize değildi, R2 kotasını (bkz. r2Quota.js) gereksiz yere şişiriyordu.
//
// 1600x1600 kutusu + fit:'scale-down' — Cloudflare'ın "asla büyütme" davranışı: görsel zaten bu
// kutudan küçükse boyut DEĞİŞMEZ (yalnızca WebP'ye yeniden kodlanır), büyükse en-boy oranı korunarak
// küçültülür. 1600px, sitenin kendi serve-time tüketicilerinin istediği en büyük genişlikten
// (1200px, bkz. index.html carousel'leri/js/components/gallery.js srcset dizileri) büyük bir pay
// bırakır.
//
// GIF bilerek atlanır — animasyon kaybı riski (bu binding'in `anim` davranışı burada doğrulanmadan
// animasyonlu bir profil/galeri görselini sessizce dondurmak istenmeyen bir regresyon olurdu).
//
// Maliyet notu: env.IMAGES çağrıları Cloudflare'in "unique transformations" sayacına dahildir
// (aylık 5.000 ücretsiz, sonrası $0,50/1000) — sitenin serve-time /cdn-cgi/image/ kullanımıyla AYNI
// sayaç olup olmadığı Cloudflare dokümantasyonunda kesin doğrulanamadı (bkz. kullanıcı isteği: bu
// belirsizlikle birlikte, best-effort + sessiz fallback ile ilerlenmesi kararlaştırıldı). Bu yüzden
// bu fonksiyon herhangi bir hatada (kota aşımı, geçersiz görsel, ağ sorunu, binding hiç
// yapılandırılmamışsa) SESSİZCE `null` döner — çağıran orijinal dosyayı değiştirmeden yükler,
// yükleme akışı ASLA engellenmez ya da kullanıcıya hata gösterilmez. Gerçek kullanım Cloudflare
// panelinden izlenmelidir.
const MAX_DIMENSION = 1600;
const OUTPUT_QUALITY = 85;
const OPTIMIZABLE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Başarılıysa { arrayBuffer, contentType: 'image/webp', ext: 'webp' } döner; optimize edilemezse
// (GIF, binding yapılandırılmamış, herhangi bir hata) null döner — çağıran bu durumda orijinal
// file.arrayBuffer()/file.type/eski uzantıyı kullanmaya devam etmeli.
export async function optimizeUploadedImage(env, file, mimeType) {
  if (!env.IMAGES || !OPTIMIZABLE_MIME_TYPES.has(mimeType)) return null;
  try {
    const result = await env.IMAGES.input(file.stream())
      .transform({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: OUTPUT_QUALITY });
    const arrayBuffer = await (result.response()).arrayBuffer();
    return { arrayBuffer, contentType: 'image/webp', ext: 'webp' };
  } catch (err) {
    console.error('optimizeUploadedImage failed, storing original', err);
    return null;
  }
}
