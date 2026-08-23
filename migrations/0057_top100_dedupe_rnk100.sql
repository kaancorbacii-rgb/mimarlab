-- P3 hardening (2026-08-23) — top100_entries.rnk=100'de production'da 7 kayıt birikmişti (id
-- 100-106), 1-99 aralığında da 6 boş sıra vardı (58, 60, 62, 87, 93, 97).
--
-- KÖK NEDEN: admin.html'deki "En İyi 100" admin panelinin hızlı-ekle formunda "Sıra No" alanı
-- sabit `value="100"` idi ve hiç dinamik güncellenmiyordu; admin her yeni satır eklerken bu alanı
-- elle değiştirmeyi unuttuğunda ekleme sessizce rnk=100'e düşüyordu (sunucu tarafında da rnk
-- üzerinde bir uniqueness kontrolü yoktu). Kod tarafı bu migration'la BİRLİKTE düzeltildi:
--   - admin.html#loadTop100Admin(): "Sıra No" varsayılanı artık listenin gerçek son pozisyonundan
--     (items.length + 1) hesaplanıyor, sabit 100 değil.
--   - src/routes/top100.js POST /api/admin/top100: INSERT'ten önce rnk çakışması kontrolü eklendi
--     (409 döner), admin elle çakışan bir numara girse bile artık sessizce ikinci bir duplicate
--     oluşmaz.
--
-- VERİ DÜZELTMESİ (kullanıcı onaylı "mekanik doldur" yaklaşımı — orijinal/amaçlanan sıralama veriden
-- kurtarılamaz, semantik sırayı garanti etmez ama duplicate'i güvenle giderir): 7 kaydı created_at
-- artan sırayla sırala, en eski 6'sını boş sıralara (58,60,62,87,93,97) ata, en yeniyi (id 106,
-- "Taksim Atatürk Kitaplığı") rnk=100'de bırak. Admin daha sonra mevcut yukarı/aşağı taşı
-- butonlarıyla (POST /api/admin/top100/:id/move) ince ayar yapabilir.
--
-- Her UPDATE hem eski rnk=100 hem hedef id şartını taşır (idempotent — daha önce uygulanmışsa bu
-- dosyanın tekrar çalıştırılması hiçbir satırı etkilemez).

UPDATE top100_entries SET rnk = 58, updated_at = strftime('%s','now') * 1000 WHERE id = 100 AND rnk = 100;
UPDATE top100_entries SET rnk = 60, updated_at = strftime('%s','now') * 1000 WHERE id = 101 AND rnk = 100;
UPDATE top100_entries SET rnk = 62, updated_at = strftime('%s','now') * 1000 WHERE id = 102 AND rnk = 100;
UPDATE top100_entries SET rnk = 87, updated_at = strftime('%s','now') * 1000 WHERE id = 103 AND rnk = 100;
UPDATE top100_entries SET rnk = 93, updated_at = strftime('%s','now') * 1000 WHERE id = 104 AND rnk = 100;
UPDATE top100_entries SET rnk = 97, updated_at = strftime('%s','now') * 1000 WHERE id = 105 AND rnk = 100;
-- id 106 ("Taksim Atatürk Kitaplığı") rnk=100'de kalır, hiçbir işlem gerekmez.
