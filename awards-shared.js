// MİMARLAB — mimar-ekle.html (mimar ekle/düzenle), js/components/auth-modal.js (Hesabım >
// profili düzenle) ve proje-ekle.html (proje ekle/düzenle) arasında PAYLAŞILAN tek ödül listesi
// kaynağı (bkz. kullanıcı isteği: "ikisi de birbirine bağlı dinamik kısım olsunlar, yani ben
// siteye bir ödül daha eklemek istediğimde ikisine de eklensin"). Önceden mimar-ekle.html ve
// auth-modal.js'te BİREBİR AYNI olması gereken iki ayrı ODUL_OPTIONS kopyası elle senkronize
// ediliyordu — artık üç yer de bu dosyadaki TEK diziye bakıyor, buraya bir satır eklemek/çıkarmak
// üçünde de anında yansır. Diğer paylaşılan veri dosyalarıyla (catalog-taxonomy.js, il-ilce-data.js)
// aynı desen: sade bir global `const`, `<script>` ile defer OLMADAN (bu üç dosyanın kendi satır içi
// scriptlerinden ÖNCE, senkron olarak) yüklenir.
const ODUL_OPTIONS = ['Pritzker Mimarlık Ödülü', 'Ulusal Mimarlık Ödülleri', 'TürkSMD Mimarlık Ödülleri', 'TürkSMD Mimarlık Ödülü', 'Ağa Han Mimarlık Ödülü', 'EU Mies Award', 'World Architecture Festival Ödülleri', 'International Architecture Awards'];
