# MİMARLAB Mimari Yol Haritası

MVP'den 50.000–500.000 içerik ölçeğine geçiş için hazırlanan, mevcut kod tabanına (Cloudflare
Workers + D1 + statik veri dosyaları) dayanan fazlı refactoring planı. Faz 1 uygulanmıştır (bkz.
`src/routes/architect.js`, `office.js`, `project.js`, `product.js`); Faz 2/3 henüz uygulanmamıştır.

## 1. Refactoring Yol Haritası

### Faz 1 — Acil API/DB Düzeltmeleri (uygulandı)

| # | Adım | Neden |
|---|------|-------|
| 1.1 | `GET /api/architect/:key`, `/api/office/:key`, `/api/project/:slug`, `/api/product/:key` route'ları eklendi. Worker, `data.js`/`projeler-data.js`/`urunler-data.js`/`malzemeler-data.js`'i build-time ES module import olarak kullanır (esbuild zaten bu dosyaları CJS-interop ile paketliyor, bkz. `src/lib/seo.js`), submission + `profile-edits`/`project-edits` overlay'ini sunucu tarafında yapar, tek JSON döner. | `mimar-detay.html`/`ofis-detay.html` aynı merge mantığını farklı derinlikte (biri field-by-field, biri `Object.assign` tam overlay) tekrar tekrar yazıyordu — bu tutarsızlığın kendisi bug kaynağıydı. |
| 1.2 | Overlay derinliği tek fonksiyonda birleştirildi; her iki detay sayfası da aynı worker endpoint'ini çağırıyor. | Aynı bug iki yerde farklı şekilde vardı; tek kaynağa indirmek regresyonu önler. |
| 1.3 | `GET /api/projects/filters` eklendi — `proje.html`'deki `computeOptions()` mantığının (faceted/bağımlı sayaçlar) birebir sunucu karşılığı. | Sayaçlar her render'da tüm diziyi tarıyordu; veri büyüdükçe bu client-side hesap tarayıcıyı kilitler. |
| 1.4 | `escapeHtml`/`escapeAttr` tekilleştirmesi ve XSS escaping convention'ı ile tutarlılık korundu. | Küçük ama kopya kod riski. |

### Faz 2 — ID-First Veri Modeli, Polimorfik Claim/Correction, Revisions, Componentizasyon (planlandı, uygulanmadı)

1. Canonical tablolar (`architects`, `offices`, `projects`, `products`, `photographers`) oluştur, statik dizileri + `*_submissions` tablolarını tek seferlik bir migration script'i ile bu tablolara aktar, her kayda `id` ata.
2. **Duplicate-name-key limitation burada çözülüyor**: migration script aynı isimde birden fazla mimar/ofis bulduğunda otomatik eşleştirmez, admin panelinden manuel disambiguation gerektiren bir çakışma raporu üretir.
3. `project.designer`/`office.founders`/`product.architect` gibi JSON-of-names alanlarını `project_designers`, `office_founders`, `product_architects` join tablolarına çevir; geçiş süresince paralel yaz/tekli oku.
4. `profile_claims`/`profile_corrections`'ı polimorfik `claims`/`corrections` tablolarıyla değiştir (zaten `comments`/`ratings`/`legacy_content_hidden`'daki generic `target_type`+`target_id` desenini genişletiyor).
5. `revisions` tablosu — ilk aşamada admin edit + correction-approval akışlarında yazılır.
6. Frontend componentizasyonu: `mimar-detay.html:975-1053` ile `ofis-detay.html:784-908`'deki birebir aynı claim/correction kutusu → ortak `js/components/claim-correction-box.js`; `proje-detay.html:796-849` ile `urun-detay.html:645-698`'deki birebir aynı galeri/lightbox → ortak `js/components/gallery.js`.

### Faz 3 — Graph Derinliği + Canlı Facet Sayaçları + `data.js` Sonlandırma (planlandı, uygulanmadı)

1. `photographers` varlığını `projects.photographer_id` ile bağla; eşleşmeyen krediler (`photoCreditText`) fallback olarak kalır.
2. `facet_counts` tablosunu canlı tut — Cache API değil **KV** kullan (Workers Cache API purge'ü sadece yazan edge node'da çalışıyor, bkz. `src/lib/ssrCache.js`; sayaç gibi global-tutarlı veri için KV'nin global replikasyonu gerekli).
3. `data.js`/`projeler-data.js`/`urunler-data.js`/`malzemeler-data.js`'i kaynak olmaktan çıkar, D1'den üretilen bir build-time export haline getir.
4. `legacy_content_hidden`'ı canonical tablolardaki `deleted_at`/`hidden_at` kolonlarıyla değiştir.

---

## 2. Revize D1 Şeması (Faz 2/3 için, henüz uygulanmadı)

```sql
-- ============================================================
-- CANONICAL ENTITY TABLES (ID-first) — Faz 2
-- ============================================================

CREATE TABLE architects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  dob TEXT,
  school TEXT,
  dept TEXT,
  profession TEXT,
  position TEXT,
  awards TEXT,                        -- JSON
  about TEXT,
  photo_url TEXT,
  office_id INTEGER REFERENCES offices(id),
  role_at_office TEXT,
  source TEXT NOT NULL DEFAULT 'legacy_static' CHECK (source IN ('legacy_static','submission','admin')),
  legacy_key TEXT,                    -- eski bare-name key; migration izlenebilirliği + eski URL redirect'leri için
  claimed_by_user_id INTEGER REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_architects_legacy_key ON architects(legacy_key);
CREATE INDEX idx_architects_office ON architects(office_id);

CREATE TABLE offices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  loc TEXT,
  cats TEXT,                          -- JSON
  yil TEXT,
  website TEXT,
  about TEXT,
  logo_url TEXT,
  awards TEXT,                        -- JSON
  source TEXT NOT NULL DEFAULT 'legacy_static',
  legacy_key TEXT,
  claimed_by_user_id INTEGER REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_offices_legacy_key ON offices(legacy_key);

CREATE TABLE office_founders (         -- offices.founders JSON-of-names yerine
  office_id INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  architect_id INTEGER NOT NULL REFERENCES architects(id) ON DELETE CASCADE,
  PRIMARY KEY (office_id, architect_id)
);

CREATE TABLE photographers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  website TEXT,
  about TEXT,
  photo_url TEXT,
  linked_architect_id INTEGER REFERENCES architects(id),   -- aynı kişi hem mimar hem fotoğrafçıysa
  claimed_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  category TEXT,                      -- JSON
  type TEXT,                          -- JSON
  discipline TEXT,                    -- JSON
  location TEXT,
  location_detail TEXT,
  project_date TEXT,
  date_bucket TEXT,
  period TEXT,                        -- JSON
  description TEXT,
  images TEXT,                        -- JSON
  photographer_id INTEGER REFERENCES photographers(id),
  photo_credit_text TEXT,             -- eşleşmeyen legacy krediler için fallback (zorla entity yapma)
  photo_credit_url TEXT,
  source_url TEXT,
  ai_generated INTEGER DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'legacy_static',
  legacy_key TEXT,
  claimed_by_user_id INTEGER REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_projects_legacy_key ON projects(legacy_key);
CREATE INDEX idx_projects_photographer ON projects(photographer_id);

CREATE TABLE project_designers (       -- projects.designer JSON-of-names yerine
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  architect_id INTEGER REFERENCES architects(id) ON DELETE CASCADE,
  office_id INTEGER REFERENCES offices(id) ON DELETE CASCADE,
  role TEXT,                          -- 'lead' | 'contributor'
  CHECK ((architect_id IS NOT NULL) OR (office_id IS NOT NULL))
);
CREATE INDEX idx_project_designers_architect ON project_designers(architect_id);
CREATE INDEX idx_project_designers_office ON project_designers(office_id);

CREATE TABLE products (                -- product_submissions + material_submissions birleşimi
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('product','material')),
  title TEXT NOT NULL,
  brand_office_id INTEGER REFERENCES offices(id),
  brand_name_raw TEXT,                -- eşleşmeyen marka adları için fallback
  website TEXT,
  category TEXT,
  description TEXT,
  images TEXT,                        -- JSON
  specs TEXT,                         -- JSON [{label,value}]
  source_url TEXT,
  ai_generated INTEGER DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'legacy_static',
  legacy_key TEXT,
  claimed_by_user_id INTEGER REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE product_architects (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  architect_id INTEGER NOT NULL REFERENCES architects(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, architect_id)
);

CREATE TABLE project_products (        -- "Kullanılan Ürünler/Malzemeler" graph kenarı
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, product_id)
);

CREATE TABLE awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  organizer TEXT,
  year INTEGER
);
CREATE TABLE project_awards (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  award_id INTEGER NOT NULL REFERENCES awards(id) ON DELETE CASCADE,
  category TEXT,
  PRIMARY KEY (project_id, award_id)
);

-- ============================================================
-- POLİMORFİK CLAIM / CORRECTION — profile_claims/profile_corrections yerine
-- (comments/ratings/legacy_content_hidden'daki mevcut target_type deseninin genişletilmiş hali)
-- ============================================================

CREATE TABLE claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('architect','office','project','product','photographer')),
  target_id INTEGER NOT NULL,         -- SQLite cross-table FK kısıtı yok; app katmanında doğrula
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX idx_claims_target ON claims(target_type, target_id);

CREATE TABLE corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),        -- nullable: anonim ihbar
  target_type TEXT NOT NULL CHECK (target_type IN ('architect','office','project','product','photographer')),
  target_id INTEGER NOT NULL,
  field_name TEXT,                    -- 'name' | 'location' | 'date' | NULL = genel not
  current_value TEXT,                 -- gönderim anındaki değer (diff göstermek için)
  proposed_value TEXT,
  evidence_url TEXT,
  evidence_file_key TEXT,             -- R2 key, kullanıcı dosya yüklerse
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by_user_id INTEGER REFERENCES users(id)
);
CREATE INDEX idx_corrections_target ON corrections(target_type, target_id);

-- ============================================================
-- REVISIONS — Wikipedia tarzı rollback
-- ============================================================

CREATE TABLE revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  changed_by_user_id INTEGER REFERENCES users(id),   -- NULL = sistem/migration
  change_source TEXT NOT NULL DEFAULT 'user_edit'
    CHECK (change_source IN ('user_edit','admin_edit','correction_approval','migration','rollback')),
  diff TEXT NOT NULL,                 -- JSON: { "field": { "from": ..., "to": ... }, ... }
  full_snapshot TEXT,                 -- rollback doğruluğu için tam JSON snapshot
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','rolled_back')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_revisions_target ON revisions(target_type, target_id, created_at DESC);

-- ============================================================
-- FACET COUNTS — Faz 3, canlı filtre sayaçları (KV ile birlikte kullanılacak)
-- ============================================================

CREATE TABLE facet_counts (
  list_type TEXT NOT NULL,            -- 'architects' | 'offices' | 'projects' | 'products'
  facet_key TEXT NOT NULL,            -- 'category' | 'position' | 'award' | ...
  facet_value TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (list_type, facet_key, facet_value)
);
```

**Not:** `legacy_content_hidden`, `badge_requests`, `admin_badges` tabloları migration penceresi boyunca `legacy_key` üzerinden aynen çalışmaya devam eder — Faz 2'de bunları da `target_id`'ye geçirmek ayrı, düşük öncelikli bir adım.

---

## 3. Faz 1 Uygulaması — Gerçek Kod

Faz 1 planlanan pseudocode'un aksine, kod tabanında zaten `import dataJs from '../../data.js'` CJS-interop deseni mevcuttu (bkz. `src/lib/seo.js`, `src/routes/legacyContent.js`) — SEO meta enjeksiyonu için `buildArchitectMeta`/`buildOfficeMeta`/`buildProjectMeta`/`buildProductMeta` zaten statik veri + onaylı submission overlay'ini sunucu tarafında birleştiriyordu. Faz 1, bu aynı deseni SEO meta'sının ötesine, **tüm sayfa verisini** döndüren gerçek API uçlarına genişletti:

- `src/routes/architect.js` — `GET /api/architect/:key` (isim ya da slug kabul eder): statik `architects[]` kaydı ya da yalnızca DB'de var olan bir mimar → onaylı `architect_submissions` overlay'i (field-by-field) → bağlı ofis (kendi overlay'iyle) → meslektaşlar (ofis overlay'i uygulanmış) → ilgili projeler (statik + üye gönderisi, `project-edits` overlay'i uygulanmış, admin-hidden filtrelenmiş) → `hidden` bayrağı. `mimar-detay.html` artık tek bir `fetch` ile bu uca bağlanıyor.
- `src/routes/office.js` — `GET /api/office/:key`: aynı desen, ofisler için. Kurucular/ortaklar (`founders`) hâlâ canlı `architects[].office === o.name` eşleşmesiyle hesaplanır (statik `office.founders` alanı zaten kullanılmıyordu, bkz. `ofis-detay.html#renderFoundersGrid`), yalnızca artık sunucu tarafında.
- `src/routes/project.js` — `GET /api/project/:slug` (tekil proje, ileride `proje-detay.html`'in tüketmesi için hazır — bu turda `proje-detay.html` değiştirilmedi) ve `GET /api/projects/filters` (proje.html'in `computeOptions()`'ı ile birebir aynı faceted/bağımlı sayaç mantığı, sunucuda).
- `src/routes/product.js` — `GET /api/product/:key` (tekil ürün/malzeme, ileride `urun-detay.html`'in tüketmesi için hazır — bu turda `urun-detay.html` değiştirilmedi).

`proje.html`'deki asıl filtreleme/sayfalama/render mantığı istemci tarafında bırakıldı. Sayaç sayıları (`(461)` gibi parantez içindeki rakamlar) İKİ aşamalı çalışır: sidebar her filtre değişiminde ÖNCE mevcut client-side `computeOptions()` ile anında (sıfır ağ gecikmesi) çizilir, ardından `reconcileFilterCountsFromServer()` `/api/projects/filters`'ı çağırıp gelen sayıları birkaç yüz milisaniyede sessizce üzerine yazar (bkz. `proje.html#reconcileFilterCountsFromServer`, `src/routes/project.js#handleProjectFiltersRoute`). Gerekçe: bu sayfa mevcut veri ölçeğinde zaten anlık çalışıyor; sayaçları TAMAMEN sunucuya taşıyıp her checkbox tıklamasını bir round-trip'e bağlamak (client hesabını tamamen kaldırmak) bu ölçekte gerçek bir performans kazancı sağlamadan görünür bir gecikme/flicker riski getirirdi. Bu "önce anında client, sonra sessiz sunucu düzeltmesi" deseni, endpoint'i gerçek trafikte çalışır ve doğrulanmış tutarken mevcut UX'i hiç bozmuyor — Faz 3'teki `facet_counts` + KV materyalizasyonu, veri 50k-500k'ya ulaştığında client hesabının tamamen kaldırılıp yalnızca sunucu kaynaklı hâle getirileceği nokta.
