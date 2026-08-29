-- P1 güvenlik düzeltmesi (2026-08-29): submissions.js#verifyClaimedProfileKey,
-- projectClaimAccess.js#canUserEditProjectBySlug ve duel.js#getOwnProjectIds, bir kullanıcının
-- onaylı bir firma (office) profile_claims'i üzerinden düzenleme yetkisi olup olmadığına, o
-- kullanıcının KENDİ PATCH /api/profile ile serbestçe değiştirebildiği users.position alanına
-- bakarak karar veriyordu. Onaylı bir firma claim'i olan (örn. admin'in "Ekip Üyesi" olarak
-- onayladığı) bir kullanıcı, sonradan kendi position'ını "Kurucu" yaparak bu üç kontrol
-- noktasından da firma/proje düzenleme yetkisi kazanabiliyordu — yetki yükseltme (privilege
-- escalation) açığı.
--
-- Çözüm: admin'in bir firma claim'ini ONAYLADIĞI ANDAKİ (admin panelinde zaten görünen,
-- src/routes/admin.js#handleClaimsAdmin'deki u.position AS user_position ile) pozisyon değeri bu
-- yeni sütuna DONDURULUR (snapshot). Yetki kontrolleri artık canlı users.position yerine bu
-- dondurulmuş değere bakar — kullanıcı profilindeki position'ı sonradan değiştirse de onaylanmış
-- yetkisi bundan ETKİLENMEZ, yeni bir yetki de KAZANAMAZ. Admin bir claim'i tekrar onaylarsa
-- (PATCH .../claims/:id {status:'approved'}, zaten var olan bir uç) snapshot o andaki güncel
-- position ile YENİLENİR — ayrı bir "pozisyon güncelle" arayüzüne gerek kalmadan mevcut
-- onay/red akışı bu amaçla yeniden kullanılabilir.
--
-- Geriye dönük uyumlu, yıkıcı değil: yeni sütun NULL'a izin verir, hiçbir satır silinmez/değişmez
-- dışında aşağıdaki tek seferlik backfill. Backfill, HALİHAZIRDA onaylı office claim'leri için
-- bugünkü canlı position değerini olduğu gibi snapshot'a kopyalar — bu, migration anında hiçbir
-- mevcut kullanıcının etkin yetkisini DEĞİŞTİRMEZ (aynı canlı değer donduruluyor), yalnızca
-- BUNDAN SONRAKİ self-service position değişikliklerinin yetkiyi artık etkilemesini engeller.
ALTER TABLE profile_claims ADD COLUMN office_position TEXT;

UPDATE profile_claims
SET office_position = (SELECT u.position FROM users u WHERE u.id = profile_claims.user_id)
WHERE profile_type = 'office' AND status = 'approved';
