-- Kişi dizininde görünme tercihi (kullanıcı isteği, 2026-09-01 madde 4: "kişi ekle/düzenle
-- sayfasında gönder-kaydet butonunun üzerinde tek satırda 'Kişi sayfasında diğer profesyonellerle
-- birlikte görünmek istiyor musunuz?' diye sor").
--
-- NEDEN hidden_at DEĞİL: hidden_at bir MODERASYON durumudur (admin arşivlemesi, bkz.
-- src/routes/legacyContent.js#handleContentAction) ve profili sitenin HER yerinden gizler —
-- popup, arama, autocomplete dahil. Buradaki tercih bambaşka bir şey: kişi /kisi dizin
-- LİSTESİNDE görünmek istemiyor ama profili yaşamaya devam ediyor ve (aynı maddenin ikinci
-- cümlesi gereği) proje/ürün/firma/marka künyelerine mimar/tasarımcı/fotoğrafçı olarak
-- eklenebilmeye devam ediyor. İki kavramı tek kolona bindirmek, "listede olmasın" diyen bir
-- kişiyi künyelerden de sessizce düşürürdü.
--
-- DEFAULT 1: mevcut ~900 satırın hepsi bugün dizinde görünüyor, davranış değişmemeli. Soru
-- yalnızca bundan sonraki gönderi/düzenlemelerde açıkça yanıtlanır.
ALTER TABLE architects ADD COLUMN directory_listed INTEGER NOT NULL DEFAULT 1;

-- Gönderi tarafında NULL = "bu form bu soruyu hiç göndermedi" (ör. admin panelinden gelen eski
-- taslaklar) — syncArchitect NULL'ı "dokunma" olarak yorumlar, canonical satırdaki mevcut değer
-- korunur (bkz. src/lib/canonicalSync.js#syncArchitect).
ALTER TABLE architect_submissions ADD COLUMN directory_listed INTEGER;
