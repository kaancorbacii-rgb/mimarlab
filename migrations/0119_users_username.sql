-- 0119 — users.username (KULLANICI ADI)
--
-- Kullanıcı isteği (2026-09-14): "Ad Soyad'dan sonra 'Kullanıcı Adı' kutucuğu koy", "giriş yap
-- kısmında E-posta yazılan yere kullanıcı adı da yazılıp şifre yazılarak giriş yapılabilsin",
-- "bugüne kadar siteye üye olan kullanıcılara ad ve soyadlarını kullanarak bir kullanıcı adı
-- tanımla, örneğin Kaan Çorbacı için @kaancorbaci".
--
-- Bu dosya ÜÇ şey yapar:
--   1. users.username kolonunu ekler (NULL kalabilir — eski satırlar 3. adımda doldurulur),
--   2. TEKİL indeks kurar (iki hesap aynı kullanıcı adını taşıyamaz; NULL'lar indeksi kilitlemez),
--   3. mevcut TÜM hesaplara ad soyadlarından bir kullanıcı adı üretir.
--
-- KATLAMA: SQLite'ın lower()'ı yalnızca ASCII'yi küçültür, bu yüzden Türkçe harfler ÖNCE elle ASCII
-- karşılıklarına çevrilir. Eşleme src/lib/username.js#FOLD_MAP ile BİREBİR aynıdır — ayrışırsa geri
-- dolumdan gelen adlar ile yeni kayıtların ürettiği adlar farklı olur.
--
-- ÇAKIŞMA: aynı slug'a düşen hesaplar (ör. "Ali Veli" ve "Alı-Veli") kayıt sırasına göre sıralanır,
-- ilki çıplak slug'ı alır, sonrakiler ".2", ".3" ekiyle ayrılır (nokta geçerli bir karakterdir,
-- bkz. src/lib/username.js).
--
-- GÜVENLİK AĞI: slug boş kalırsa (adı yalnızca ASCII olmayan işaretlerden oluşan hesap), 3 karakterden
-- kısaysa ya da [a-z0-9] dışında bir karakter kalırsa hesap 'uye<rastgele>' alır — böylece HİÇBİR
-- hesap username'siz kalmaz ve kimse geçersiz biçimli bir kullanıcı adıyla mahsur kalmaz.
--
-- TEKRAR ÇALIŞTIRMA: ALTER TABLE ADD COLUMN idempotent DEĞİLDİR ("duplicate column name" hatası
-- kolonun zaten var olduğunu söyler, veri kaybı değildir). 3. adımdaki UPDATE'ler ise
-- "username IS NULL" koşuluyla korunur, yani dolu kullanıcı adlarını ASLA yeniden yazmaz.

ALTER TABLE users ADD COLUMN username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

DROP TABLE IF EXISTS _username_backfill;

CREATE TABLE _username_backfill (id TEXT PRIMARY KEY, slug TEXT NOT NULL, rn INTEGER NOT NULL);

INSERT INTO _username_backfill (id, slug, rn)
SELECT id, slug, ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at ASC, id ASC)
FROM (
  SELECT
    id,
    created_at,
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      lower(
        replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(replace(replace(replace(
          COALESCE(name, ''),
        'İ','i'),'I','i'),'ı','i'),'Ş','s'),'ş','s'),'Ğ','g'),'ğ','g'),'Ü','u'),'ü','u'),
        'Ö','o'),'ö','o'),'Ç','c'),'ç','c'),'Â','a'),'â','a'),'Î','i'),'î','i'),'Û','u'),'û','u')
      ),
    ' ',''),'-',''),'.',''),'_',''),'''',''),'’',''),'`',''),',',''),'(',''),')',''),'/',''),'"','') AS slug
  FROM users
);

-- Slug'ı sağlam olan hesaplar: çıplak slug (ilk sahibine) ya da ".N" ekli slug.
UPDATE users SET username = (
  SELECT CASE WHEN b.rn = 1 THEN b.slug ELSE b.slug || '.' || b.rn END
    FROM _username_backfill b WHERE b.id = users.id
)
WHERE username IS NULL
  AND EXISTS (
    SELECT 1 FROM _username_backfill b
     WHERE b.id = users.id
       AND length(b.slug) >= 3
       AND b.slug NOT GLOB '*[^a-z0-9]*'
  );

-- Güvenlik ağı: yukarıdaki kapıdan geçemeyen hesaplar.
UPDATE users SET username = 'uye' || lower(hex(randomblob(4))) WHERE username IS NULL;

DROP TABLE _username_backfill;
