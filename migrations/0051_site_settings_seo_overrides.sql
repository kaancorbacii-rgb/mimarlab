-- Admin panel geliştirmesi (bkz. kullanıcı isteği: SEO/site ayarları/performans kontrolü) — iki
-- yeni tablo. site_settings: bakım modu/duyuru banner'ı/öne çıkan projeler/robots.txt gibi tek
-- satırlık key-value ayarlar için genel amaçlı tablo (şu ana kadar hiç yoktu). seo_overrides:
-- proje/mimar/firma/ürün detay sayfalarında admin'in src/lib/seo.js'in türettiği varsayılan
-- title/description'ı sayfa bazında ezebilmesi için.
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS seo_overrides (
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  meta_title TEXT,
  meta_description TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (entity_type, entity_key)
);
