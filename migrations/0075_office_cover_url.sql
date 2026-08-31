-- Marka kapak görseli (kullanıcı isteği, 2026-08-31 madde 6): "Marka ekle/düzenle sayfasında Kapak
-- Görseli Ekle kısmı olsun ... marka logosunun arkasında kapak görseli olsun" (markalar sayfası
-- kartları) + "Marka popupında da bu kapak görseli ... olsun" (firma/marka popup'ının üst bandı).
--
-- Kolon offices/office_submissions'a eklenir, markaya ÖZEL ayrı bir tabloya değil: bir marka zaten
-- bir `offices` satırıdır (bkz. office-kind.js — firma/marka ayrımı cats/ürün sayısından türetilir,
-- ayrı tablo yoktur). Formu yalnızca marka-ekle.html gösterir (firma-ekle.html'e eklenmedi, istekte
-- yok), ama okuma tarafı ayrım yapmaz: cover_url dolu olan HER ofis popup'ında bant görünür.
ALTER TABLE offices ADD COLUMN cover_url TEXT;
ALTER TABLE office_submissions ADD COLUMN cover_url TEXT;
