#!/usr/bin/env node
// ŞİŞECAM MİMARİ CAM KATALOĞU — İÇE AKTARIM KAYDI (2026-09-10, kullanıcı isteği)
//
// NE YAPTI: sisecam.com Düz Cam Ürün Kataloğu'ndaki 64 mimari cam ürünü, 13 KANONİK ürüne
// konsolide edilip D1'e yazıldı; 57 ürün görseli R2'ye (import/products/<slug>/<n>.webp) yüklendi.
//
// NEDEN KONSOLİDASYON: 64 ürünün büyük kısmı aynı kaplama teknolojisinin renk/performans
// türevleri (Ecosol T 31 Füme ile Ecosol T 31 Bronz ayrı "ürün" değil, aynı ürünün iki versiyonu).
// Katalogda 64 ayrı kart yerine 13 ürün + popup içi versiyon seçici gösterilir — repoda ZATEN VAR
// olan varyant mimarisi kullanıldı (products.variants JSON, bkz. migrations/0086_product_variants.sql
// ve js/components/product-modal.js#renderVariantSwitcher). Seçenek eksenleri (Model/Renk/Kaplama)
// tek değerliyse product-modal onları kendiliğinden eler, yani tekil ürünlerde seçici hiç çıkmaz.
//
// VERİ KAYNAĞI: sayfalar Cloudflare bot korumasının arkasında; metin, tarayıcı oturumu içinden
// çekildi (bkz. memory: project_sisecam_import_blocked_2026_09_10). GÖRSELLER hiçbir otomatik
// yoldan indirilemedi — kullanıcı elle indirip `sisecam-urunler/` klasörüne koydu. Bu yüzden
// aşağıdaki PRODUCTS tablosundaki `image` alanı, o klasördeki KLASÖR ADIYLA eşleşen orijinal
// dosya adıdır (klasör adı: "<orijinal ad> (GxY)", içinde "imgi_1_<ad>.webp").
//
// GÖRSELİ OLMAYAN 7 VERSİYON (kullanıcının indirdiği sette yoktu): Ecosol T 50, Deco Boyalı,
// Deco Ultra Clear Beyaz, Clear, Extra Clear, Ultra Clear, Renkli Düzcam. Versiyonun kendi
// görseli yoksa popup ANA ÜRÜNÜN galerisine düşer (bkz. product-modal.js#renderDetailBody), yani
// yalnızca "Şişecam Düzcam Serisi" (4 versiyonun DÖRDÜ de görselsiz) marka renkli placeholder
// kartla görünür — bkz. catalog-taxonomy.js#catalogCardMediaHtml.
//
// YAYIN DURUMU: ürünler kataloğun geri kalanıyla AYNI durumda (hidden_at + preview_at = önizleme).
// İSTİSNA: "Şişecam Ecosol Serisi" ürünü ve Şişecam marka profili (offices id 726) TAM YAYINDA —
// IzQ İnovasyon Merkezi'ndeki hotspot ve "Kullanılan Ürünler/Markalar" etiketlemesi ancak böyle
// GÖRÜNÜR: src/routes/project.js#fetchProjectProducts ve enrichImageHotspots, ürünü/markayı
// `hidden_at IS NULL` şartıyla arar (önizlemedeki bir ürünün hotspot'u hiç çizilmez).
//
// SAYFA DAĞILIMI: 13 ürün, ürün kataloğunun 32 sayfasına yayıldı (display_order, mevcut satırların
// sıralama değerlerinden "çıpa" alınarak; eşitlikte id DESC yeni satırı öne alır — hiçbir mevcut
// ürünün display_order'ına DOKUNULMADI). Gerçekleşen yerleşim aşağıdaki PAGE_PLAN'da.
//
// BU DOSYA ÇALIŞTIRILMAK İÇİN DEĞİL, KAYIT İÇİNDİR: yazma işlemleri `wrangler d1 execute --file`
// ile tek seferlik yapıldı. Aynı veriyi yeniden üretmek gerekirse buradaki tablolar yeterlidir.

// 64 kaynak ürün: [slug, başlık, teknik ad, [Işık Geç., U Değeri, Solar Faktör, Gölgeleme Kats., Temperlenebilir], görsel dosya adı]
export const PRODUCTS = [
 [
  "sisecam-duosol-t-50",
  "Şişecam Duosol T 50",
  "Şişecam Temperlenebilir Solar Low-E Cam Nötral 50/27",
  [
   "60>x≥50",
   ">1",
   "30>x≥20",
   "40>x≥30",
   "Evet"
  ],
  "Temperlenebilir_Solar_Low-e_Notral_5027.webp"
 ],
 [
  "flotal",
  "Flotal",
  "Flotal",
  [
   "-",
   "-",
   "-",
   "-",
   "Hayır"
  ],
  "Flotal-E.webp"
 ],
 [
  "flotal-future",
  "Flotal Future",
  "Flotal Future",
  [
   "-",
   "-",
   "-",
   "-",
   "Hayır"
  ],
  "flotal-future.jpg"
 ],
 [
  "flotal-ultra-clear",
  "Flotal Ultra Clear",
  "Flotal Ultra Clear",
  [
   "N/A",
   "N/A",
   "N/A",
   "N/A",
   "Hayır"
  ],
  "Flotal-Ultra-Clear-01 (Custom).jpg"
 ],
 [
  "sisecam-cerceve-cami",
  "Şişecam Çerçeve Camı",
  "Şişecam Çerçeve Camı",
  [
   "N/A",
   "N/A",
   "N/A",
   "N/A",
   "Hayır"
  ],
  "Cerceveli-Cam.webp"
 ],
 [
  "sisecam-charger-by-ml-system",
  "Şişecam Charger by ML System",
  "Şişecam Charger by ML System",
  [
   "-",
   "-",
   "-",
   "-",
   "Evet"
  ],
  "sisecam_charger.webp"
 ],
 [
  "sisecam-clear",
  "Şişecam Clear",
  "Şişecam Renksiz Düz Cam",
  [
   "N/A",
   "N/A",
   "N/A",
   "N/A",
   "Evet"
  ],
  "Renksiz-Duz-Cam.webp"
 ],
 [
  "sisecam-climax",
  "Şişecam Climax",
  "Şişecam Low-E Cam",
  [
   "≥60",
   ">1",
   "≥40",
   "≥40",
   "Hayır"
  ],
  "Low-E-Cam.webp"
 ],
 [
  "sisecam-climax-80",
  "Şişecam Climax 80",
  "Şişecam Climax Nötral 80/64",
  [
   "≥60",
   ">1",
   "≥40",
   "≥40",
   "Hayır"
  ],
  "Climax_Notral 8064-2.webp"
 ],
 [
  "sisecam-climax-one",
  "Şişecam Climax One",
  "Şişecam Climax",
  [
   "≥60",
   "≤1",
   "≥40",
   "≥40",
   "Hayır"
  ],
  "Climax.webp"
 ],
 [
  "sisecam-climax-select",
  "Şişecam Climax Select",
  "Şişecam Solar Low-E Cam",
  [
   "≥60",
   ">1",
   "≥40",
   "≥40",
   "Hayır"
  ],
  "solar-low-E-Cam.webp"
 ],
 [
  "sisecam-climax-select-35-one",
  "Şişecam Climax Select 35 One",
  "Şişecam Climax Select 35 One",
  [
   "≥60",
   "≤1",
   "40>x≥30",
   "≥40",
   "Hayır"
  ],
  "ClimaxSelect35One.webp"
 ],
 [
  "sisecam-climax-select-one",
  "Şişecam Climax Select One",
  "Şişecam Solar Low-E Cam Nötral",
  [
   "≥60",
   ">1",
   "≥40",
   "≥40",
   "Hayır"
  ],
  "Solar-low-e-notral.webp"
 ],
 [
  "sisecam-climax-t-36-fume",
  "Şişecam Climax T 36 Füme",
  "Şişecam Temperlenebilir Low-E Cam Füme 36/34",
  [
   "<40",
   ">1",
   "40>x≥30",
   "40>x≥30",
   "Evet"
  ],
  "Temperlenebilir_Solar_Lowe_3634.webp"
 ],
 [
  "sisecam-climax-t-41-bronz",
  "Şişecam Climax T 41 Bronz",
  "Şişecam Temperlenebilir Low-E Cam Bronz 41/35",
  [
   "50>x≥40",
   ">1",
   "40>x≥30",
   "40>x≥30",
   "Evet"
  ],
  "Temperlenebilir_Low-e_Bronz_3125.webp"
 ],
 [
  "sisecam-climax-t-71",
  "Şişecam Climax T 71",
  "Şişecam Temperlenebilir Low-E Cam Nötral 71/53",
  [
   "≥60",
   ">1",
   "≥40",
   "≥40",
   "Evet"
  ],
  "Temperlenebilir_Low-Notral_7153.webp"
 ],
 [
  "sisecam-climax-t-80",
  "Şişecam Climax T 80",
  "Şişecam Temperlenebilir Low-E Cam Nötral 80/64",
  [
   "≥60",
   ">1",
   "≥40",
   "≥40",
   "Evet"
  ],
  "Temperlenebilir_Low-e_Notral_8064.webp"
 ],
 [
  "sisecam-deco-boyali",
  "Şişecam Deco Boyalı",
  "Şişecam Boyalı Cam",
  [
   "-",
   "-",
   "-",
   "-",
   "Hayır"
  ],
  "Boyali-Cam.webp"
 ],
 [
  "sisecam-deco",
  "Şişecam Deco Buzlu",
  "Şişecam Buzlu Cam",
  [
   "-",
   "-",
   "-",
   "-",
   "Evet"
  ],
  "Sisecam-Buzlu-Cam.jpg"
 ],
 [
  "sisecam-deco-ayna",
  "Şişecam Deco Buzlu Ayna",
  "Şişecam Aynalı Buzlu Cam",
  [
   "N/A",
   "N/A",
   "N/A",
   "N/A",
   "Hayır"
  ],
  "Aynali-buzlu-cam.webp"
 ],
 [
  "sisecam-deco-ultra-clear-beyaz",
  "Şişecam Deco Ultra Clear Beyaz",
  "Şişecam Ultra Clear Boyalı Cam Bembeyaz/RAL 9003",
  [
   "N/A",
   "N/A",
   "N/A",
   "N/A",
   "Hayır"
  ],
  "Ultra_Clear_Boyalì_Bembeyaz_RAL_9003.webp"
 ],
 [
  "sisecam-duosol-50-one",
  "Şişecam Duosol 50 One",
  "Şişecam Solar Low-E Cam Nötral 50/25",
  [
   "60>x≥50",
   "≤1",
   "30>x≥20",
   "<30",
   "Hayır"
  ],
  "Solar_Low_e_Notral_5025.webp"
 ],
 [
  "sisecam-duosol-70",
  "Şişecam Duosol 70",
  "Şişecam Solar Low-E Cam Nötral 70/40",
  [
   "≥60",
   ">1",
   "≥40",
   "≥40",
   "Hayır"
  ],
  "Solar_Low-e Notral_7040.webp"
 ],
 [
  "sisecam-duosol-70-one",
  "Şişecam Duosol 70 One",
  "Şişecam Solar Low-E Cam Nötral 70/37",
  [
   "≥60",
   "≤1",
   "40>x≥30",
   "≥40",
   "Hayır"
  ],
  "Temperlenebilir_Solar_Low-e Notral_7037.webp"
 ],
 [
  "sisecam-duosol-t-40-one",
  "Şişecam Duosol T 40 One",
  "Şişecam Temperlenebilir Solar Low-E Cam Nötral 40/22",
  [
   "50>x≥40",
   ">1",
   "30>x≥20",
   "<30",
   "Evet"
  ],
  "Temperlenebilir_Solar_Lowe_Notral_4022.webp"
 ],
 [
  "sisecam-duosol-t-50-one",
  "Şişecam Duosol T 50 One",
  "Şişecam Temperlenebilir Solar Low-E Cam Nötral 50/25",
  [
   "60>x≥50",
   "≤1",
   "30>x≥20",
   "<30",
   "Evet"
  ],
  "0033_cukurova-havaliman.jpg"
 ],
 [
  "sisecam-duosol-t-51",
  "Şişecam Duosol T 51",
  "Şişecam Temperlenebilir Solar Low-E Cam Nötral 51/28",
  [
   "60>x≥50",
   ">1",
   "30>x≥20",
   "40>x≥30",
   "Evet"
  ],
  "0022_havelsan-technology-campus.jpg"
 ],
 [
  "sisecam-duosol-t-58",
  "Şişecam Duosol T 58",
  "Şişecam Temperlenebilir Solar Low-E Cam Nötral 58/32",
  [
   "60>x≥50",
   ">1",
   "40>x≥30",
   "40>x≥30",
   "Evet"
  ],
  "0002_vakifbank.jpg"
 ],
 [
  "sisecam-duosol-t-70",
  "Şişecam Duosol T 70",
  "Şişecam Temperlenebilir Solar Low-E Cam Nötral 70/40",
  [
   "≥60",
   ">1",
   "≥40",
   "≥40",
   "Evet"
  ],
  "0009_riva-dusler-vadisi.jpg"
 ],
 [
  "sisecam-duosol-t-70-one",
  "Şişecam Duosol T 70 One",
  "Şişecam Temperlenebilir Solar Low-E Cam Nötral 70/37",
  [
   "≥60",
   "≤1",
   "40>x≥30",
   "≥40",
   "Evet"
  ],
  "0037_baskent-emlak-konutlar.jpg"
 ],
 [
  "sisecam-ecosol-50",
  "Şişecam Ecosol 50",
  "Şişecam Solar Low-E Cam Nötral 50/33",
  [
   "60>x≥50",
   ">1",
   "40>x≥30",
   "40>x≥30",
   "Hayır"
  ],
  "Solar_Lowe_Notral_5033.webp"
 ],
 [
  "sisecam-ecosol-62",
  "Şişecam Ecosol 62",
  "Şişecam Solar Low-E Cam Nötral 62/44",
  [
   "≥60",
   ">1",
   "≥40",
   "≥40",
   "Hayır"
  ],
  "Solar_Lowe_Notral_6244.webp"
 ],
 [
  "sisecam-ecosol-t-21-fume",
  "Şişecam Ecosol T 21 Füme",
  "Şişecam Temperlenebilir Solar Low-E Cam Füme 21/18",
  [
   "<40",
   ">1",
   "<20",
   "<30",
   "Evet"
  ],
  "Temperlenebilir_Solar_Low-e_Fum_2118.webp"
 ],
 [
  "sisecam-ecosol-t-24-bronz",
  "Şişecam Ecosol T 24 Bronz",
  "Şişecam Temperlenebilir Solar Low-E Cam Bronz 24/18",
  [
   "<40",
   ">1",
   "<20",
   "<30",
   "Evet"
  ],
  "Temperlenebilir_Solar_Lowe_Bronz_2418.webp"
 ],
 [
  "sisecam-ecosol-t-28-fume",
  "Şişecam Ecosol T 28 Füme",
  "Şişecam Temperlenebilir Solar Low-E Cam Füme 28/26",
  [
   "<40",
   ">1",
   "30>x≥20",
   "<30",
   "Evet"
  ],
  "Temperlenebilir_Solar_Low-e_Fume_2826.webp"
 ],
 [
  "sisecam-ecosol-t-31-bronz",
  "Şişecam Ecosol T 31 Bronz",
  "Şişecam Temperlenebilir Solar Low-E Cam Bronz 31/25",
  [
   "<40",
   ">1",
   "30>x≥20",
   "<30",
   "Evet"
  ],
  "0042_ametist-ankara.jpg"
 ],
 [
  "sisecam-ecosol-t-31-fume",
  "Şişecam Ecosol T 31 Füme",
  "Şişecam Temperlenebilir Solar Low-E Cam Füme 31/28",
  [
   "<40",
   ">1",
   "30>x≥20",
   "40>x≥30",
   "Evet"
  ],
  "Temperlenebilir_Solar_Low-e_Fume_3128.webp"
 ],
 [
  "sisecam-ecosol-t-35-bronz",
  "Şişecam Ecosol T 35 Bronz",
  "Şişecam Temperlenebilir Solar Low-E Cam Bronz 35/29",
  [
   "<40",
   ">1",
   "30>x≥20",
   "40>x≥30",
   "Evet"
  ],
  "Temperlenebilir_Solar_Low-e_Bronz_3529.webp"
 ],
 [
  "sisecam-ecosol-t-35-derin-gumus",
  "Şişecam Ecosol T 35 Derin Gümüş",
  "Şişecam Temperlenebilir Solar Low-E Cam Derin Gümüş",
  [
   "<40",
   ">1",
   "30>x≥20",
   "<30",
   "Evet"
  ],
  "SISE-26-00006_gorsel_uyarlamalari_1100x1208-DEEP SILVER.webp"
 ],
 [
  "sisecam-ecosol-t-40-derin-amber",
  "Şişecam Ecosol T 40 Derin Amber",
  "Şişecam Temperlenebilir Solar Low-E Cam Derin Amber",
  [
   "50>x≥40",
   ">1",
   "30>x≥20",
   "40>x≥30",
   "Evet"
  ],
  "SISE-26-00006_gorsel_uyarlamalari_1100x1208-01.webp"
 ],
 [
  "sisecam-ecosol-t-40-derin-mavi",
  "Şişecam Ecosol T 40 Derin Mavi",
  "Şişecam Temperlenebilir Solar Low-E Cam Derin Mavi 40/28",
  [
   "50>x≥40",
   ">1",
   "30>x≥20",
   "40>x≥30",
   "Evet"
  ],
  "0034_bumerang-kartal.jpg"
 ],
 [
  "sisecam-ecosol-t-40-derin-yesil",
  "Şişecam Ecosol T 40 Derin Yeşil",
  "Şişecam Temperlenebilir Solar Low-E Cam Yeşil 40/28",
  [
   "50>x≥40",
   ">1",
   "30>x≥20",
   "40>x≥30",
   "Evet"
  ],
  "Temperlenebilir_Solar_Low_E_4028_Yesil.webp"
 ],
 [
  "sisecam-ecosol-t-43",
  "Şişecam Ecosol T 43",
  "Şişecam Temperlenebilir Solar Low-E Cam Nötral 43/28",
  [
   "50>x≥40",
   ">1",
   "30>x≥20",
   "40>x≥30",
   "Evet"
  ],
  "Temperlenebilir_Solar_Low-e_Notral_4328.webp"
 ],
 [
  "sisecam-ecosol-t-50",
  "Şişecam Ecosol T 50",
  "Şişecam Temperlenebilir Solar Low-E Cam Nötral 50/33",
  [
   "60>x≥50",
   ">1",
   "40>x≥30",
   "40>x≥30",
   "Evet"
  ],
  "Temprlenebilir_Solar_Low-e_Notral_5033.webp"
 ],
 [
  "sisecam-ecosol-t-62",
  "Şişecam Ecosol T 62",
  "Şişecam Temperlenebilir Solar Low-E Cam Nötral 62/44",
  [
   "≥60",
   ">1",
   "≥40",
   "≥40",
   "Evet"
  ],
  "0018_kumport.jpg"
 ],
 [
  "sisecam-extra-clear",
  "Şişecam Extra Clear",
  "Şişecam Extra Clear",
  [
   "-",
   "-",
   "-",
   "-",
   "Evet"
  ],
  "ExtraClear.webp"
 ],
 [
  "sisecam-prosol-t-60-one",
  "Şişecam Prosol T 60 One",
  "Şişecam Prosol T 60 One",
  [
   "≥60",
   "≤1",
   "30>x≥20",
   "40>x≥30",
   "Evet"
  ],
  "ProsolT60One.webp"
 ],
 [
  "sisecam-renkli-duzcam",
  "Şişecam Renkli Düzcam",
  "Şişecam Renkli Düz Cam",
  [
   "N/A",
   "N/A",
   "N/A",
   "N/A",
   "Evet"
  ],
  "Renkli-Duzcam.webp"
 ],
 [
  "sisecam-safeprotec",
  "Şişecam SafeProtec",
  "Şişecam Lamine Cam",
  [
   "N/A",
   "N/A",
   "N/A",
   "N/A",
   "Hayır"
  ],
  "Sisecam-Lamine-Cam-01.webp"
 ],
 [
  "sisecam-safeprotec-ultra",
  "Şişecam SafeProtec Ultra Clear",
  "Şişecam Ultra Clear Lamine Cam",
  [
   "N/A",
   "N/A",
   "N/A",
   "N/A",
   "Hayır"
  ],
  "Ultra_Clear_Lamine.webp"
 ],
 [
  "sisecam-solarmax",
  "Şişecam SolarMax",
  "Şişecam Güneş Paneli Camları",
  [
   "-",
   "-",
   "-",
   "-",
   "Evet"
  ],
  "Gunes-Paneli.webp"
 ],
 [
  "sisecam-solarmax-gunes-kolektor-camlari",
  "Şişecam Solarmax Güneş Kolektör Camları",
  "Şişecam SolarMax",
  [
   "N/A",
   "N/A",
   "N/A",
   "N/A",
   "Hayır"
  ],
  "Gunes-Kolektor.webp"
 ],
 [
  "sisecam-solarmax-mirror",
  "Şişecam SolarMax Mirror",
  "Şişecam SolarMax Mirror",
  [
   "N/A",
   "N/A",
   "N/A",
   "N/A",
   "Evet"
  ],
  "solar-ayna.jpg"
 ],
 [
  "sisecam-soundprotec",
  "Şişecam SoundProtec",
  "Şişecam Akustik Lamine Cam",
  [
   "-",
   "-",
   "-",
   "-",
   "Evet"
  ],
  "Sisecam-Akustik-Lamine-Cam-01 (Custom).jpg"
 ],
 [
  "sisecam-tentesol-bronz",
  "Şişecam Tentesol Bronz",
  "Şişecam Tentesol Bronz",
  [
   "<40",
   ">1",
   "30>x≥20",
   "<30",
   "Evet"
  ],
  "Tentesol_Bronz.webp"
 ],
 [
  "sisecam-tentesol-fume",
  "Şişecam Tentesol Füme",
  "Şişecam Tentesol Füme",
  [
   "<40",
   ">1",
   "30>x≥20",
   "<30",
   "Evet"
  ],
  "Tentesol_Fume.webp"
 ],
 [
  "sisecam-tentesol-gumus",
  "Şişecam Tentesol Gümüş",
  "Şişecam Tentesol Gümüş",
  [
   "<40",
   ">1",
   "40>x≥30",
   "40>x≥30",
   "Evet"
  ],
  "Tentesol_Gumus.webp"
 ],
 [
  "sisecam-tentesol-mavi",
  "Şişecam Tentesol Mavi",
  "Şişecam Tentesol Mavi",
  [
   "<40",
   "",
   "<20",
   "<30",
   "Evet"
  ],
  "Tentesol_Mavi.webp"
 ],
 [
  "sisecam-tentesol-titanyum-fume",
  "Şişecam Tentesol Titanyum Füme",
  "Şişecam Tentesol Titanyum Füme",
  [
   "<40",
   ">1",
   "30>x≥20",
   "40>x≥30",
   "Evet"
  ],
  "Tentesol_Titanyum_Fume.webp"
 ],
 [
  "sisecam-tentesol-titanyum-gumus",
  "Şişecam Tentesol Titanyum Gümüş",
  "Şişecam Tentesol Titanyum Gümüş",
  [
   "60>x≥50",
   ">1",
   "≥40",
   "≥40",
   "Evet"
  ],
  "Tentesol_Titanyum_Gumus.webp"
 ],
 [
  "sisecam-tentesol-titanyum-mavi",
  "Şişecam Tentesol Titanyum Mavi",
  "Şişecam Tentesol Titanyum Mavi",
  [
   "<40",
   ">1",
   "30>x≥20",
   "40>x≥30",
   "Evet"
  ],
  "Tentesol-Titanyum-Mavi.webp"
 ],
 [
  "sisecam-tentesol-titanyum-yesil",
  "Şişecam Tentesol Titanyum Yeşil",
  "Şişecam Tentesol Titanyum Yeşil",
  [
   "50>x≥40",
   ">1",
   "30>x≥20",
   "40>x≥30",
   "Evet"
  ],
  "Tentesol_Titanyum_Yesil.webp"
 ],
 [
  "sisecam-tentesol-yesil",
  "Şişecam Tentesol Yeşil",
  "Şişecam Tentesol Yeşil",
  [
   "<40",
   ">1",
   "30>x≥20",
   "<30",
   "Evet"
  ],
  "0023_green-tower.jpg"
 ],
 [
  "sisecam-ultra-clear",
  "Şişecam Ultra Clear",
  "Şişecam Ultra Clear Düz Cam",
  [
   "N/A",
   "N/A",
   "N/A",
   "N/A",
   "Evet"
  ],
  "Ultra_Clear_Duzcam.webp"
 ]
];

// 13 kanonik ürün: aile başlığı, versiyon seçici eksenleri, tanıtım metni, üyeler [kaynak slug, eksen1 değeri, eksen2 değeri]
export const FAMILIES = {
 "climax": {
  "title": "Şişecam Climax Serisi",
  "axes": [
   "Model",
   "Renk"
  ],
  "intro": "Şişecam'ın Low-E (düşük yayınımlı) kaplamalı ısı kontrolü cam ailesi. Tek yüzeye uygulanan ince metal/metal oksit kaplama, kışın iç ortamdaki ısının dışarı kaçmasını azaltırken yüksek ışık geçirgenliğiyle doğal gün ışığından ödün vermez. Seride hem standart hem temperlenebilir (T) modeller, nötral/füme/bronz renk seçenekleri ve U değeri 1,0 W/m²K'ya inen \"One\" versiyonları yer alır.",
  "members": [
   [
    "sisecam-climax",
    "Standart",
    "Nötral"
   ],
   [
    "sisecam-climax-80",
    "80",
    "Nötral"
   ],
   [
    "sisecam-climax-one",
    "One",
    "Nötral"
   ],
   [
    "sisecam-climax-select",
    "Select",
    "Nötral"
   ],
   [
    "sisecam-climax-select-35-one",
    "Select 35 One",
    "Nötral"
   ],
   [
    "sisecam-climax-select-one",
    "Select One",
    "Nötral"
   ],
   [
    "sisecam-climax-t-36-fume",
    "T 36",
    "Füme"
   ],
   [
    "sisecam-climax-t-41-bronz",
    "T 41",
    "Bronz"
   ],
   [
    "sisecam-climax-t-71",
    "T 71",
    "Nötral"
   ],
   [
    "sisecam-climax-t-80",
    "T 80",
    "Nötral"
   ]
  ]
 },
 "duosol": {
  "title": "Şişecam Duosol Serisi",
  "axes": [
   "Model",
   "Renk"
  ],
  "intro": "Tek bir kaplamayla güneş kontrolü ve ısı yalıtımını birlikte sağlayan Solar Low-E cam ailesi. Yüksek ışık geçirgenliğini düşük güneş enerjisi geçirgenliğiyle birleştirdiğinden ofis, otel, hastane ve karma kullanımlı projelerde hem soğutma hem ısıtma yüklerini azaltır. \"T\" modelleri temperlenebilir, \"One\" modelleri U=1,0 W/m²K seviyesinde ısı yalıtımı sunar.",
  "members": [
   [
    "sisecam-duosol-t-50",
    "T 50",
    "Nötral"
   ],
   [
    "sisecam-duosol-50-one",
    "50 One",
    "Nötral"
   ],
   [
    "sisecam-duosol-70",
    "70",
    "Nötral"
   ],
   [
    "sisecam-duosol-70-one",
    "70 One",
    "Nötral"
   ],
   [
    "sisecam-duosol-t-40-one",
    "T 40 One",
    "Nötral"
   ],
   [
    "sisecam-duosol-t-50-one",
    "T 50 One",
    "Nötral"
   ],
   [
    "sisecam-duosol-t-51",
    "T 51",
    "Nötral"
   ],
   [
    "sisecam-duosol-t-58",
    "T 58",
    "Nötral"
   ],
   [
    "sisecam-duosol-t-70",
    "T 70",
    "Nötral"
   ],
   [
    "sisecam-duosol-t-70-one",
    "T 70 One",
    "Nötral"
   ]
  ]
 },
 "ecosol": {
  "title": "Şişecam Ecosol Serisi",
  "axes": [
   "Model",
   "Renk"
  ],
  "intro": "Güneş kontrolü ve ısı yalıtımını bir arada sunan, serinin en geniş renk yelpazesine sahip Solar Low-E cam ailesi. Nötral tonların yanında füme, bronz, derin gümüş, derin amber, derin mavi ve derin yeşil kaplamalarla cephede mimari bir renk kararı verilmesine imkân tanır. \"T\" ile başlayan modeller temperlenebilir olduğundan emniyet camı gerektiren cephe ve çatı uygulamalarına uygundur.",
  "members": [
   [
    "sisecam-ecosol-50",
    "50",
    "Nötral"
   ],
   [
    "sisecam-ecosol-62",
    "62",
    "Nötral"
   ],
   [
    "sisecam-ecosol-t-21-fume",
    "T 21",
    "Füme"
   ],
   [
    "sisecam-ecosol-t-24-bronz",
    "T 24",
    "Bronz"
   ],
   [
    "sisecam-ecosol-t-28-fume",
    "T 28",
    "Füme"
   ],
   [
    "sisecam-ecosol-t-31-bronz",
    "T 31",
    "Bronz"
   ],
   [
    "sisecam-ecosol-t-31-fume",
    "T 31",
    "Füme"
   ],
   [
    "sisecam-ecosol-t-35-bronz",
    "T 35",
    "Bronz"
   ],
   [
    "sisecam-ecosol-t-35-derin-gumus",
    "T 35",
    "Derin Gümüş"
   ],
   [
    "sisecam-ecosol-t-40-derin-amber",
    "T 40",
    "Derin Amber"
   ],
   [
    "sisecam-ecosol-t-40-derin-mavi",
    "T 40",
    "Derin Mavi"
   ],
   [
    "sisecam-ecosol-t-40-derin-yesil",
    "T 40",
    "Derin Yeşil"
   ],
   [
    "sisecam-ecosol-t-43",
    "T 43",
    "Nötral"
   ],
   [
    "sisecam-ecosol-t-50",
    "T 50",
    "Nötral"
   ],
   [
    "sisecam-ecosol-t-62",
    "T 62",
    "Nötral"
   ]
  ]
 },
 "tentesol": {
  "title": "Şişecam Tentesol Serisi",
  "axes": [
   "Kaplama",
   "Renk"
  ],
  "intro": "Yansıtıcı güneş kontrol camı ailesi. Cam yüzeyine uygulanan metalik kaplama, güneş enerjisinin büyük bölümünü daha cepheye girmeden yansıtarak soğutma yükünü düşürür ve gündüz saatlerinde dışarıdan içeriye görüşü sınırlar. Titanyum kaplamalı versiyonlar daha yüksek dayanım ve farklı bir yüzey tonu sunar; tüm modeller temperlenebilir.",
  "members": [
   [
    "sisecam-tentesol-bronz",
    "Tentesol",
    "Bronz"
   ],
   [
    "sisecam-tentesol-fume",
    "Tentesol",
    "Füme"
   ],
   [
    "sisecam-tentesol-gumus",
    "Tentesol",
    "Gümüş"
   ],
   [
    "sisecam-tentesol-mavi",
    "Tentesol",
    "Mavi"
   ],
   [
    "sisecam-tentesol-yesil",
    "Tentesol",
    "Yeşil"
   ],
   [
    "sisecam-tentesol-titanyum-fume",
    "Tentesol Titanyum",
    "Füme"
   ],
   [
    "sisecam-tentesol-titanyum-gumus",
    "Tentesol Titanyum",
    "Gümüş"
   ],
   [
    "sisecam-tentesol-titanyum-mavi",
    "Tentesol Titanyum",
    "Mavi"
   ],
   [
    "sisecam-tentesol-titanyum-yesil",
    "Tentesol Titanyum",
    "Yeşil"
   ]
  ]
 },
 "flotal": {
  "title": "Şişecam Flotal Ayna Serisi",
  "axes": [
   "Model"
  ],
  "intro": "Bakır ve kurşun içermeyen, çevre dostu üretim süreciyle elde edilen ayna ailesi. Yüksek kalitede düz camın gümüş kaplanıp koruyucu boya katmanlarıyla kapatılmasıyla üretilir; yüksek atmosferik neme ve korozyona dayanıklıdır. Banyo, yatak odası, mutfak, mağaza ve sergi alanlarında mekâna derinlik ve aydınlık kazandırmak için kullanılır. Ultra Clear versiyonu düşük demirli camdan üretildiğinden renkleri daha doğal ve berrak yansıtır.",
  "members": [
   [
    "flotal",
    "Flotal",
    ""
   ],
   [
    "flotal-future",
    "Flotal Future",
    ""
   ],
   [
    "flotal-ultra-clear",
    "Flotal Ultra Clear",
    ""
   ]
  ]
 },
 "deco": {
  "title": "Şişecam Deco Dekoratif Cam Serisi",
  "axes": [
   "Model"
  ],
  "intro": "İç mekân tasarımına yönelik dekoratif cam ailesi. Boyalı versiyonlar düz cama parlak boya uygulanarak elde edilir ve duvar kaplaması, dolap kapağı ya da ara bölme camı olarak kullanılır; buzlu versiyonlar ışığı geçirirken görüntüyü kontrol eder, aynalı buzlu cam ise ikisini bir arada sunar. Kullanılan boyalar ağır metal içermez.",
  "members": [
   [
    "sisecam-deco-boyali",
    "Boyalı",
    ""
   ],
   [
    "sisecam-deco",
    "Buzlu",
    ""
   ],
   [
    "sisecam-deco-ayna",
    "Buzlu Ayna",
    ""
   ],
   [
    "sisecam-deco-ultra-clear-beyaz",
    "Ultra Clear Beyaz",
    ""
   ]
  ]
 },
 "duzcam": {
  "title": "Şişecam Düzcam Serisi",
  "axes": [
   "Model"
  ],
  "intro": "Tüm cam uygulamalarının temel ürünü olan float (düz) cam ailesi. Cam eriyiğinin erimiş kalay üzerinde yüzdürülmesiyle üretilir; iki yüzü hatasız ve birbirine paraleldir. Temperleme, lamine etme, kaplama, bombeleme ve aynalama gibi ikincil işlemlerle emniyet, ısı kontrolü, güneş kontrolü ve akustik camlara dönüştürülür. Extra Clear ve Ultra Clear versiyonları düşük demir içeriğiyle daha yüksek ışık geçirgenliği ve renk doğruluğu sağlar.",
  "members": [
   [
    "sisecam-clear",
    "Clear",
    "Renksiz"
   ],
   [
    "sisecam-extra-clear",
    "Extra Clear",
    "Renksiz"
   ],
   [
    "sisecam-ultra-clear",
    "Ultra Clear",
    "Renksiz"
   ],
   [
    "sisecam-renkli-duzcam",
    "Renkli",
    "Renkli"
   ]
  ]
 },
 "safeprotec": {
  "title": "Şişecam SafeProtec",
  "axes": [
   "Model"
  ],
  "intro": "İki veya daha fazla cam levhanın araya yerleştirilen PVB ara katmanla birleştirilmesiyle üretilen lamine emniyet camı. Kırılma hâlinde parçalar ara katmana yapışık kaldığından yaralanma riskini azaltır, düşmeye ve delinmeye karşı direnç sağlar. Ultra Clear versiyonu düşük demirli camdan üretilir ve daha yüksek ışık geçirgenliği sunar.",
  "members": [
   [
    "sisecam-safeprotec",
    "SafeProtec",
    ""
   ],
   [
    "sisecam-safeprotec-ultra",
    "SafeProtec Ultra Clear",
    ""
   ]
  ]
 },
 "solarmax": {
  "title": "Şişecam SolarMax",
  "axes": [
   "Model"
  ],
  "intro": "Güneş enerjisi sistemleri için üretilen düşük demirli cam ailesi. Yüksek güneş enerjisi geçirgenliğiyle fotovoltaik panellerin ve termal kolektörlerin verimini artırır; Mirror versiyonu yoğunlaştırılmış güneş enerjisi (CSP) santrallerinde yansıtıcı ayna olarak kullanılır.",
  "members": [
   [
    "sisecam-solarmax",
    "Güneş Paneli Camı",
    ""
   ],
   [
    "sisecam-solarmax-gunes-kolektor-camlari",
    "Güneş Kolektör Camı",
    ""
   ],
   [
    "sisecam-solarmax-mirror",
    "Mirror",
    ""
   ]
  ]
 },
 "cerceve": {
  "title": "Şişecam Çerçeve Camı",
  "axes": [],
  "intro": "Tablo, fotoğraf ve sertifika çerçeveleri için üretilen, Sandy desenli buzlu cam. Özel yüzey dokusu ışık yansımalarını ve parlamayı engelleyerek çerçevelenen görselin net ve berrak görünmesini sağlar. 2 mm kalınlıkta, renksiz veya düşük demirli olarak üretilir; maksimum performans için camın desenli yüzeyi dışa bakmalıdır.",
  "members": [
   [
    "sisecam-cerceve-cami",
    "",
    ""
   ]
  ]
 },
 "charger": {
  "title": "Şişecam Charger by ML System",
  "axes": [],
  "intro": "Bina cephelerine ve çatılarına entegre edilen fotovoltaik cam (BIPV). Yapı malzemesi ve enerji üreteci işlevini birlikte üstlenir: güneş ışığını elektriğe dönüştürerek binanın enerji maliyetini ve karbon salımını düşürürken, geleneksel güneş panellerinin aksine cephenin mimari bütünlüğünü bozmaz.",
  "members": [
   [
    "sisecam-charger-by-ml-system",
    "",
    ""
   ]
  ]
 },
 "prosol": {
  "title": "Şişecam Prosol T 60 One",
  "axes": [],
  "intro": "Temperlenebilir Solar Low-E kaplamalı cephe camı. Yüksek ışık geçirgenliğini (≥%60) güçlü güneş kontrolüyle birleştirir ve U=1,0 W/m²K seviyesinde ısı yalıtımı sağlar; temperlenebilme özelliği sayesinde emniyet gerektiren cephe ve çatı uygulamalarında kullanılabilir.",
  "members": [
   [
    "sisecam-prosol-t-60-one",
    "",
    ""
   ]
  ]
 },
 "soundprotec": {
  "title": "Şişecam SoundProtec",
  "axes": [],
  "intro": "Akustik lamine cam. Cam levhalar arasına yerleştirilen özel akustik PVB ara katman, ses dalgalarının sönümlenmesini sağlayarak trafik ve şehir gürültüsünün iç mekâna geçişini azaltır. Lamine yapısı aynı zamanda emniyet camı özelliği taşır; havalimanı, otel, hastane ve yoğun trafiğe bakan konut cephelerinde kullanılır.",
  "members": [
   [
    "sisecam-soundprotec",
    "",
    ""
   ]
  ]
 }
};

// Katalogdaki gerçekleşen yerleşim (32 sayfa, 24 ürün/sayfa) — canlıda doğrulandı.
export const PAGE_PLAN = [
 {
  "slug": "sisecam-ecosol-serisi-sisecam",
  "title": "Şişecam Ecosol Serisi",
  "hedefSayfa": 1,
  "ord": 0,
  "gorsel": 14,
  "varyant": 15
 },
 {
  "slug": "sisecam-cerceve-cami-sisecam",
  "title": "Şişecam Çerçeve Camı",
  "hedefSayfa": 4,
  "ord": 68,
  "gorsel": 1,
  "varyant": 1
 },
 {
  "slug": "sisecam-deco-dekoratif-cam-serisi-sisecam",
  "title": "Şişecam Deco Dekoratif Cam Serisi",
  "hedefSayfa": 6,
  "ord": 138,
  "gorsel": 2,
  "varyant": 4
 },
 {
  "slug": "sisecam-charger-by-ml-system-sisecam",
  "title": "Şişecam Charger by ML System",
  "hedefSayfa": 8,
  "ord": 165,
  "gorsel": 1,
  "varyant": 1
 },
 {
  "slug": "sisecam-duosol-serisi-sisecam",
  "title": "Şişecam Duosol Serisi",
  "hedefSayfa": 10,
  "ord": 222,
  "gorsel": 10,
  "varyant": 10
 },
 {
  "slug": "sisecam-flotal-ayna-serisi-sisecam",
  "title": "Şişecam Flotal Ayna Serisi",
  "hedefSayfa": 14,
  "ord": 322,
  "gorsel": 3,
  "varyant": 3
 },
 {
  "slug": "sisecam-solarmax-sisecam",
  "title": "Şişecam SolarMax",
  "hedefSayfa": 16,
  "ord": 364,
  "gorsel": 3,
  "varyant": 3
 },
 {
  "slug": "sisecam-safeprotec-sisecam",
  "title": "Şişecam SafeProtec",
  "hedefSayfa": 18,
  "ord": 426,
  "gorsel": 2,
  "varyant": 2
 },
 {
  "slug": "sisecam-tentesol-serisi-sisecam",
  "title": "Şişecam Tentesol Serisi",
  "hedefSayfa": 22,
  "ord": 517,
  "gorsel": 9,
  "varyant": 9
 },
 {
  "slug": "sisecam-duzcam-serisi-sisecam",
  "title": "Şişecam Düzcam Serisi",
  "hedefSayfa": 24,
  "ord": 559,
  "gorsel": 0,
  "varyant": 4
 },
 {
  "slug": "sisecam-prosol-t-60-one-sisecam",
  "title": "Şişecam Prosol T 60 One",
  "hedefSayfa": 27,
  "ord": 621,
  "gorsel": 1,
  "varyant": 1
 },
 {
  "slug": "sisecam-climax-serisi-sisecam",
  "title": "Şişecam Climax Serisi",
  "hedefSayfa": 29,
  "ord": 683,
  "gorsel": 10,
  "varyant": 10
 },
 {
  "slug": "sisecam-soundprotec-sisecam",
  "title": "Şişecam SoundProtec",
  "hedefSayfa": 32,
  "ord": 746,
  "gorsel": 1,
  "varyant": 1
 }
];
