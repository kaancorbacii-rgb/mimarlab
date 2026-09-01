-- 0079 — Otomatik tamamlama (autocomplete) uçları için Türkçe-katlanmış, INDEXLENEBİLİR arama kolonları.
--
-- KÖK NEDEN (production audit, 2026-09-01, madde B). 5 canlı arama ucu —
-- /api/architects/search, /api/offices/search, /api/products/search, /api/projects/search,
-- /api/photographers/search — HER istekte ilgili tablonun TÜM satırlarını Worker'a çekip filtrelemeyi
-- JavaScript'te yapıyordu:
--     const { results } = await env.DB.prepare(`SELECT ... FROM offices WHERE ... ORDER BY name`).all();
--     results.filter(r => foldTr(r.name).includes(q)).slice(0, 20)
-- Bu, SQL'de LIKE kullanılamadığı için değil, TÜRKÇE yüzünden böyleydi: SQLite'ın lower()/LIKE'ı
-- Türkçe'nin İ/I/ı/i, Ş/ş, Ğ/ğ, Ü/ü, Ö/ö, Ç/ç eşleştirmesini bilmez, bu yüzden eşleştirme bilinçli
-- olarak JS'teki foldTr()'ye bırakılmıştı (bkz. o dosyalardaki "tablo küçük olduğundan" gerekçesi).
--
-- Bugün 715 firma / 916 mimar ile bu kabul edilebilir; 50.000-100.000 kayıtta her tuş vuruşu tam
-- tablo taraması + tüm satırların Worker'a taşınması demek.
--
-- ÇÖZÜM: foldTr()'nin BİREBİR SQL karşılığını hesaplayan bir VIRTUAL generated column + üzerinde
-- index. İfade, src/lib/textMatch.js#foldTr ile adım adım aynıdır:
--   1) trLower: İ->i, I->ı, Ş->ş, Ğ->ğ, Ü->ü, Ö->ö, Ç->ç  (SQLite lower()'ı bu harfleri BİLMEZ,
--      bu yüzden lower()'DAN ÖNCE elle çevrilir), ardından lower() ASCII A-Z'yi indirir
--   2) fold: ı->i, ş->s, ç->c, ğ->g, ü->u, ö->o
-- Yerelde gerçek veriyle doğrulandı: "Şerbetçi Mimarlık" -> "serbetci mimarlik",
-- "Studio İM Mimari Tasarım" -> "studio im mimari tasarim" (JS foldTr ile birebir aynı).
--
-- NEDEN VIRTUAL GENERATED COLUMN (uygulama kodunun yazdığı normal bir kolon değil): generated column
-- her okumada ifadeden HESAPLANIR — kaydın adı değiştiğinde otomatik güncellenir, hiçbir yazma yolunun
-- (canonicalSync.js, admin.js, toplu içe aktarma script'leri, elle SQL) bunu hatırlaması gerekmez.
-- Yani 0078'deki trigger tercihiyle AYNI gerekçe: "unutulabilir bir senkronizasyon adımı" hiç
-- oluşmuyor. VIRTUAL, satırlarda yer kaplamaz (STORED zaten ALTER TABLE ile eklenemez); index ise
-- hesaplanmış değeri saklar, bu yüzden aramada ifade yeniden çalıştırılmaz.
--
-- İNDEKSİN GERÇEKTEN NE ÇÖZDÜĞÜ (dürüst sınır): bir B-tree index yalnızca ÖNEK (prefix) aramasını
-- hızlandırabilir; `LIKE '%q%'` gibi baştan joker içeren bir substring araması hiçbir B-tree ile
-- indexlenemez. Bu yüzden uygulama tarafı (src/lib/searchFold.js) İKİ AŞAMALI çalışır:
--   1) Önek araması — `name_fold >= :q AND name_fold < :q || char(1114111)` — index'i KULLANIR
--      (yerelde doğrulandı: "SEARCH offices USING INDEX idx_offices_name_fold (name_fold>? AND
--      name_fold<?)"). Otomatik tamamlamada baskın durum budur ve tam tarama HİÇ olmaz.
--   2) Yeterli sonuç çıkmazsa substring geri düşüşü — `name_fold LIKE '%q%' ... LIMIT 20`. Bu hâlâ
--      tarar (kaçınılmaz), AMA filtre artık SQLite içinde: Worker'a tüm tablo yerine en fazla 20
--      satır taşınır. Yani en kötü durum bugünküne EŞİT, tipik durum çok daha ucuz.
-- Gerçek O(log n) substring araması için tek yol FTS5 ters index'idir; o, arama semantiğini
-- (substring -> token öneki) kullanıcıya görünür biçimde değiştireceğinden bu denetimin kapsamı
-- dışında bırakıldı ve rapora yol haritası maddesi olarak yazıldı.

-- DOĞRULAMA TUZAĞI (bu migration'ı kontrol ederken): `pragma_table_info(<tablo>)` GENERATED
-- kolonları LİSTELEMEZ — bu kolonlar "hidden" sayılır. Bu yüzden migration başarıyla uygulanmış
-- olsa bile `SELECT ... FROM pragma_table_info('offices') WHERE name='name_fold'` SIFIR döner ve
-- insan "uygulanmamış" sanıp yeniden çalıştırmaya kalkar (o zaman da "duplicate column name" alır).
-- Doğru kontrol: `pragma_table_xinfo(<tablo>)` (x'li sürüm generated kolonları da içerir).
--
-- Bu migration ALTER TABLE içerdiğinden İDEMPOTENT DEĞİLDİR (SQLite'ta "ADD COLUMN IF NOT EXISTS"
-- yoktur) — ikinci kez çalıştırılırsa "duplicate column name" ile durur. Index'ler IF NOT EXISTS'li.

-- architects.name_fold
ALTER TABLE architects ADD COLUMN name_fold TEXT GENERATED ALWAYS AS (
  replace(replace(replace(replace(replace(replace(
    lower(replace(replace(replace(replace(replace(replace(replace(name,'İ','i'),'I','ı'),'Ş','ş'),'Ğ','ğ'),'Ü','ü'),'Ö','ö'),'Ç','ç')),
  'ı','i'),'ş','s'),'ç','c'),'ğ','g'),'ü','u'),'ö','o')
) VIRTUAL;
CREATE INDEX IF NOT EXISTS idx_architects_name_fold ON architects(name_fold);

-- offices.name_fold
ALTER TABLE offices ADD COLUMN name_fold TEXT GENERATED ALWAYS AS (
  replace(replace(replace(replace(replace(replace(
    lower(replace(replace(replace(replace(replace(replace(replace(name,'İ','i'),'I','ı'),'Ş','ş'),'Ğ','ğ'),'Ü','ü'),'Ö','ö'),'Ç','ç')),
  'ı','i'),'ş','s'),'ç','c'),'ğ','g'),'ü','u'),'ö','o')
) VIRTUAL;
CREATE INDEX IF NOT EXISTS idx_offices_name_fold ON offices(name_fold);

-- products.title_fold
ALTER TABLE products ADD COLUMN title_fold TEXT GENERATED ALWAYS AS (
  replace(replace(replace(replace(replace(replace(
    lower(replace(replace(replace(replace(replace(replace(replace(title,'İ','i'),'I','ı'),'Ş','ş'),'Ğ','ğ'),'Ü','ü'),'Ö','ö'),'Ç','ç')),
  'ı','i'),'ş','s'),'ç','c'),'ğ','g'),'ü','u'),'ö','o')
) VIRTUAL;
CREATE INDEX IF NOT EXISTS idx_products_title_fold ON products(title_fold);

-- products.brand_fold — /api/products/search'ün ?brand= filtresi (marka adına göre TAM eşleşme,
-- substring değil) da aynı foldTr karşılaştırmasını JS'te yapıyordu. offices tarafındaki eşdeğeri
-- yukarıdaki offices.name_fold'dur (ürünün markası canonical bir offices satırıysa oradan gelir).
ALTER TABLE products ADD COLUMN brand_fold TEXT GENERATED ALWAYS AS (
  replace(replace(replace(replace(replace(replace(
    lower(replace(replace(replace(replace(replace(replace(replace(brand_name_raw,'İ','i'),'I','ı'),'Ş','ş'),'Ğ','ğ'),'Ü','ü'),'Ö','ö'),'Ç','ç')),
  'ı','i'),'ş','s'),'ç','c'),'ğ','g'),'ü','u'),'ö','o')
) VIRTUAL;
CREATE INDEX IF NOT EXISTS idx_products_brand_fold ON products(brand_fold);

-- projects.title_fold — /api/projects/search (urun-ekle.html "Kullanılan Projeler" kutusu)
ALTER TABLE projects ADD COLUMN title_fold TEXT GENERATED ALWAYS AS (
  replace(replace(replace(replace(replace(replace(
    lower(replace(replace(replace(replace(replace(replace(replace(title,'İ','i'),'I','ı'),'Ş','ş'),'Ğ','ğ'),'Ü','ü'),'Ö','ö'),'Ç','ç')),
  'ı','i'),'ş','s'),'ç','c'),'ğ','g'),'ü','u'),'ö','o')
) VIRTUAL;
CREATE INDEX IF NOT EXISTS idx_projects_title_fold ON projects(title_fold);

-- projects.photo_credit_fold — /api/photographers/search. Bu uç GROUP BY ile tekilleştirdiğinden
-- (fotoğrafçı için ayrı bir tablo yok, bkz. o fonksiyonun yorumu) index tek başına agregasyonu
-- ortadan kaldırmaz; asıl kazanç, filtrenin GROUP BY'DAN ÖNCE SQL'de uygulanabilmesidir.
ALTER TABLE projects ADD COLUMN photo_credit_fold TEXT GENERATED ALWAYS AS (
  replace(replace(replace(replace(replace(replace(
    lower(replace(replace(replace(replace(replace(replace(replace(photo_credit_text,'İ','i'),'I','ı'),'Ş','ş'),'Ğ','ğ'),'Ü','ü'),'Ö','ö'),'Ç','ç')),
  'ı','i'),'ş','s'),'ç','c'),'ğ','g'),'ü','u'),'ö','o')
) VIRTUAL;
CREATE INDEX IF NOT EXISTS idx_projects_photo_credit_fold ON projects(photo_credit_fold);
