// MİMARLAB — bir `offices` satırının HİZMET ALANLARININ ve ÜRÜN KATEGORİLERİNİN tek kaynağı.
//
// MARKA KAVRAMI KALDIRILDI (kullanıcı isteği, 2026-09-14 madde 4: "Marka ve marka ekle sayfasını
// canlıdan kaldır. Hali hazırdaki markalar artık firma olacak ... Tüm markalar firmalar arasında
// Üretim ve Satış hizmet alanı içerisinde olacak"). Sitede artık TEK bir varlık türü var: FİRMA.
// Ürün üreten/satan bir firma, kendini 'Üretim ve Satış' hizmet alanıyla işaretler ve ayrıca bir
// ya da birden çok ÜRÜN KATEGORİSİ seçer (PRODUCT_CATS). İkisi de aynı `cats` kolonunda saklanır.
//
// ÖNCEKİ MODEL (tarihsel, kod okunurken gerekiyor): bir ofis satırı hem firma hem marka olabiliyor,
// yalnızca marka olanlar firma listesinden çıkıp /marka/:slug altında yaşıyordu. O ayrımın karar
// noktası isPureBrandOffice'ti; şimdi sabit `false` döndürüyor (gerekçesi aşağıda, fonksiyonun
// başında) ve /marka* adresleri 301 ile /firma*'ya taşınıyor.
//
// project-taxonomy.js/catalog-taxonomy.js ile AYNI desen: tek dosya, hem tarayıcıda düz <script>
// olarak (firma-ekle.html'in Hizmet Alanı + Ürün Kategorisi kutucukları) hem Worker'da
// nodejs_compat CJS interop ile (src/routes/office.js, src/lib/submissionTypes.js) okunur — böylece
// "hangi değer geçerli" sorusunun istemci ve sunucu tarafında İKİ AYRI cevabı olamaz.

// firma-ekle.html'deki Hizmet Alanı seçenekleri.
// 'Fotoğrafçılık' (kullanıcı isteği, 2026-09-01 madde 1: "Firma ekle/düzenle sayfasında hizmet
// alanına fotoğrafçılık da ekle") — mimari fotoğraf stüdyoları (ZM Yasa gibi) kişi değil, kendi
// hizmet alanı olan birer FİRMA olarak kaydedilebilir.
// 'Üretim ve Satış' (kullanıcı isteği, 2026-09-14 madde 3: "hizmet alanı seç seçeneklerinde
// 4. sıraya Üretim ve Satış seçeneğini koy") — MARKA kavramının yerini alan hizmet alanı
// (madde 4). Bu alan seçildiğinde firma-ekle.html ayrıca bir "Ürün Kategorisi" kutusu açar
// (seçenekleri aşağıdaki PRODUCT_CATS) ve seçilenler AYNI `cats` kolonuna yazılır — ayrı bir
// kolon/şema gerekmez, submissionTypes.js zaten iki listenin BİRLEŞİMİNİ kabul ediyor.
const OFFICE_SERVICE_CATS = [
  'Mimarlık', 'İç Mimarlık', 'Peyzaj Mimarlığı', 'Üretim ve Satış', 'Kentsel Tasarım', 'Restorasyon',
  'Uygulama / İnşaat', 'Ürün Tasarımı', 'Fotoğrafçılık',
];

// ÜRÜN KATEGORİLERİ — catalog-taxonomy.js#CATALOG_MENU_COLUMNS'un 7 ürün GRUBU (firmanın ne
// ürettiği, ürün kataloğunun kendi taksonomisiyle aynı dil) + 'Yapı Malzemesi'.
// Eskiden marka-ekle.html'in "Ürün Kategorisi" kutusunu besliyordu; o sayfa kaldırıldı (kullanıcı
// isteği, 2026-09-14 madde 4) ve AYNI liste artık firma-ekle.html'de "Üretim ve Satış" hizmet alanı
// seçilince beliren kutuyu besliyor. İsim BRAND_CATS olarak KORUNDU: submissionTypes.js'in
// whitelist'i ve office-modal.js bu adla okuyor, yeniden adlandırmak davranışı değiştirmeyen ama
// altı dosyaya yayılan bir değişiklik olurdu. PRODUCT_CATS aynı diziye okunur bir takma addır.
const BRAND_CATS = [
  'Mobilya', 'Aydınlatma', 'Dekorasyon & Tamamlayıcılar', 'Mutfak & Banyo',
  'Zemin & Yüzey Kaplama', 'Cephe & Açıklıklar', 'Dış Mekan & Peyzaj', 'Yapı Malzemesi',
];
const PRODUCT_CATS = BRAND_CATS;

// Eski marka kayıtlarının cats değeri (canlıda doğrulandı: 13 satır '"Ürün"', 7 satır '["Ürün"]').
// Geriye dönük TANINIR ama hiçbir formda SEÇİLEBİLİR DEĞİL: temizlik betiği
// (scripts/brands-to-offices.mjs) bu kayıtlara 'Üretim ve Satış' ekliyor, 'Ürün' ise okunabilirlik
// için yerinde bırakılıyor — eski bir satır bu değeri taşımaya devam ettiğinde de isBrandOffice
// onu üretici saymalı.
const LEGACY_BRAND_CAT = 'Ürün';

const OFFICE_SERVICE_CAT_SET = new Set(OFFICE_SERVICE_CATS);
const BRAND_CAT_SET = new Set([...BRAND_CATS, LEGACY_BRAND_CAT]);

// offices.cats üç biçimde saklanmış olabilir: düz " · " ayrımlı string ("Mimarlık · İç Mimarlık"),
// JSON dizi (["Ürün"]) ya da NULL (canlıda 57 satır). parseCanonicalRow JSON'u diziye çevirir ama
// string biçimine dokunmaz — bu yüzden üç durumu da TEK noktada normalize eden bir yardımcı gerekir
// (bkz. src/routes/office.js#handleOfficeListRoute'taki AYNI Array.isArray/typeof kontrolü).
function officeCatList(cats) {
  if (Array.isArray(cats)) return cats.map(c => String(c).trim()).filter(Boolean);
  if (typeof cats !== 'string') return [];
  return cats.split(' · ').map(c => c.trim()).filter(Boolean);
}

// Bu firma ÜRETİCİ mi (ürün kataloğunda yeri var mı)? Üç yoldan biri yeterli: (a) cats'inde bir
// ürün kategorisi var, (b) eski 'Ürün' işaretini taşıyor, (c) katalogda en az bir ürünü/malzemesi
// var (Autoban gibi kendini hiç etiketlememiş ama ürün tasarlayan firmalar bu yoldan girer).
// "Marka sayfasında listelenir mi" sorusunun yerini aldı — o sayfa yok; bugün ürün/firma bağları,
// arşiv cascade'i ve ürün sayfası bu soruyu soruyor.
function isBrandOffice(cats, productCount) {
  if (productCount > 0) return true;
  return officeCatList(cats).some(c => BRAND_CAT_SET.has(c));
}

// FİRMA sayfasından çıkarılmalı mı? ARTIK HİÇBİR KAYIT ÇIKMAZ (kullanıcı isteği, 2026-09-14
// madde 4: "Marka ve marka ekle sayfasını canlıdan kaldır. Hali hazırdaki markalar artık firma
// olacak ... Tüm markalar firmalar arasında Üretim ve Satış hizmet alanı içerisinde olacak").
//
// NEDEN FONKSİYON SİLİNMEDİ: bu ayrımı 25'ten fazla dosya soruyordu — liste filtreleri
// (src/index.js#hubOffices), kanonik URL öneki (src/lib/officeUrl.js: true ise /marka/:slug),
// arama, sitemap, analytics, takip, arşiv... Hepsini tek tek sökmek yerine ayrımın TEK karar
// noktası kapatıldı: `false` dönünce her çağıran kendiliğinden "bu bir firmadır" davranışına
// geçer — kayıt firma listesinde görünür, kanonik URL'i /firma/:slug olur ve /marka/:slug ile
// gelen eski bağlantılar zaten 301 ile oraya taşınır (bkz. src/index.js#PREFIX_RENAME_REDIRECTS).
//
// isBrandOffice KORUNDU ve hâlâ anlamlı: "bu firmanın kataloğunda ürün var mı / kendini üretici
// olarak etiketlemiş mi" sorusunun cevabı (ürün sayfası, ürün-firma bağları, arşiv cascade'i onu
// bu anlamda kullanıyor). Değişen yalnızca "bu kayıt SADECE marka mı" sorusu — artık böyle bir
// kategori yok.
function isPureBrandOffice(_cats, _productCount) {
  return false;
}

// Tarayıcıda `module` global'i tanımsız olduğu için bu blok yalnızca Worker'ın esbuild bundle'ında
// (nodejs_compat) çalışır — bkz. project-taxonomy.js/catalog-taxonomy.js'deki AYNI desen.
if (typeof module !== 'undefined') {
  module.exports = {
    OFFICE_SERVICE_CATS, BRAND_CATS, PRODUCT_CATS, LEGACY_BRAND_CAT,
    officeCatList, isBrandOffice, isPureBrandOffice,
  };
}
