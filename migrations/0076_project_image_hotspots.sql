-- Görsel üzerindeki ürün işaretçileri ("hotspot") — kullanıcı isteği, 2026-08-31: proje-ekle/
-- düzenle sayfasında yüklenen bir görsele tıklayıp büyütünce, görselin üzerindeki bir noktaya
-- tıklayarak oraya bir ürün bağlanabiliyor; proje popup'ındaki galeride (hem şeritte hem
-- büyütülmüş lightbox'ta) o noktalar canlı bir daire çerçeve olarak görünüyor ve tıklanınca/
-- dokununca ürün önizlemesi açılıyor.
--
-- Veri biçimi (her iki tabloda da AYNI): görsel URL'sine göre anahtarlanmış bir JSON nesnesi —
--   { "<görsel url>": [ { "x": 0-100, "y": 0-100, "slug": "urun-slug", "title": "Ürün Adı" } ] }
-- x/y, görselin KENDİ kutusuna göre yüzde konum (sol-üst köşe 0,0) — böylece işaretçiler her
-- ekran boyutunda doğru yerde kalır. Dizi/indeks yerine URL ile anahtarlanır çünkü proje-ekle
-- sayfasında görsellerin sırası serbestçe değiştirilebiliyor (bkz. o dosyadaki mediaItems
-- sürükle-bırak sıralaması) — indeks tabanlı bir eşleme her sıralama değişiminde bozulurdu.
--
-- Ürün başlığı (title) İSTEMCİDE gösterim için değil, YALNIZCA ürün kaydı silinirse geriye kalan
-- bir fallback olarak saklanır: canlı gösterimde marka/görsel/başlık her istekte products
-- tablosundan tazelenir (bkz. src/routes/project.js#enrichImageHotspots).
ALTER TABLE projects ADD COLUMN image_hotspots TEXT;
ALTER TABLE project_submissions ADD COLUMN imageHotspots TEXT;
