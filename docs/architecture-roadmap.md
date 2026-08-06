# MİMARLAB Mimari Yol Haritası

MVP'den 50.000–500.000 içerik ölçeğine geçiş için hazırlanan, mevcut kod tabanına (Cloudflare
Workers + D1 + statik veri dosyaları) dayanan fazlı refactoring planı. Faz 1 uygulanmıştır (bkz.
`src/routes/architect.js`, `office.js`, `project.js`, `product.js`). Faz 2 **daraltılmış kapsamla**
uygulanmıştır (bkz. §4) — ID-first şema + migration altyapısı + frontend componentizasyonu kuruldu.
Faz 3 de **büyük ölçüde uygulanmıştır** (bkz. §4, commit `ad998c2` "Faz 3: D1 read-path, facet
counts KV ve canonical sync" + bu turdaki anasayfa geçişi): canonical tablolar artık gerçek okuma
yolu — `architect.js`/`office.js`/`project.js`/`product.js` statik dosya/submission overlay yerine
doğrudan D1'den okuyor, submission onay/düzenlemeleri `src/lib/canonicalSync.js` ile CANLI olarak
canonical satırlara yazılıyor, `facet_counts` KV'de materyalize ediliyor, `legacy_content_hidden`
architects/offices/projects/products/materials için `deleted_at`/`hidden_at` kolonlarıyla
değiştirildi (yalnızca `news` — henüz kendi ID-first tablosu olmadığından — eski sistemde kaldı).
**Kalan kapsam:** `data.js`/`projeler-data.js` anasayfada (`index.html`) kaldırıldı, ama `src/lib/
seo.js` (SSR meta), `src/routes/submissions.js` (slug/isim çakışma kontrolü) ve birkaç istemci
sayfası (`arama.html`, `hesabim.html`, `*-ekle.html` formları) hâlâ bu statik dosyaları okuyor —
dosyaların TAMAMEN silinmesi ayrı, henüz planlanmamış bir adımdır. Polimorfik `claims`/`corrections`
ve `revisions` tabloları da henüz uygulanmamıştır (bkz. §4.4).

## 1. Refactoring Yol Haritası

### Faz 1 — Acil API/DB Düzeltmeleri (uygulandı)

| # | Adım | Neden |
|---|------|-------|
| 1.1 | `GET /api/architect/:key`, `/api/office/:key`, `/api/project/:slug`, `/api/product/:key` route'ları eklendi. Worker, `data.js`/`projeler-data.js`/`urunler-data.js`/`malzemeler-data.js`'i build-time ES module import olarak kullanır (esbuild zaten bu dosyaları CJS-interop ile paketliyor, bkz. `src/lib/seo.js`), submission + `profile-edits`/`project-edits` overlay'ini sunucu tarafında yapar, tek JSON döner. | `mimar-detay.html`/`ofis-detay.html` aynı merge mantığını farklı derinlikte (biri field-by-field, biri `Object.assign` tam overlay) tekrar tekrar yazıyordu — bu tutarsızlığın kendisi bug kaynağıydı. |
| 1.2 | Overlay derinliği tek fonksiyonda birleştirildi; her iki detay sayfası da aynı worker endpoint'ini çağırıyor. | Aynı bug iki yerde farklı şekilde vardı; tek kaynağa indirmek regresyonu önler. |
| 1.3 | `GET /api/projects/filters` eklendi — `proje.html`'deki `computeOptions()` mantığının (faceted/bağımlı sayaçlar) birebir sunucu karşılığı. | Sayaçlar her render'da tüm diziyi tarıyordu; veri büyüdükçe bu client-side hesap tarayıcıyı kilitler. |
| 1.4 | `escapeHtml`/`escapeAttr` tekilleştirmesi ve XSS escaping convention'ı ile tutarlılık korundu. | Küçük ama kopya kod riski. |

### Faz 2 — ID-First Veri Şeması, Migration + Çakışma Raporu, Componentizasyon (uygulandı, daraltılmış kapsam)

Kullanıcı isteğiyle kapsam şu şekilde daraltıldı: ayrı bir `photographers` varlığı/`projects.photographer_id`
FK'si BU TURDA yok — fotoğrafçı bilgisi mevcut haliyle serbest metin fallback (`photo_credit_text`/
`photo_credit_url`) olarak kalıyor. `profile_claims`/`profile_corrections` → polimorfik `claims`/
`corrections` geçişi ve `revisions` tablosu da bu turun kapsamı dışında bırakıldı (bkz. §4'teki
"Uygulanmayanlar" listesi). Gerçek uygulama detayları için §4'e bakınız.

1. Canonical tablolar (`architects`, `offices`, `projects`, `products`, `awards` + join tabloları
   `office_founders`, `project_designers`, `product_architects`, `project_products`, `project_awards`)
   eklendi (bkz. `migrations/0022_id_first_entities.sql`) — mevcut hiçbir tabloyu değiştirmeden,
   yalnızca ekleyerek.
2. **Duplicate-name-key limitation burada çözülüyor**: `scripts/migrate-to-id-first.js` statik
   dizilerdeki + join alanlarındaki (`project.designer`, `architects[].office`, `product.brand`)
   isimleri canonical tablolara aktarırken aynı isimde birden fazla mimar/ofis bulduğunda ya da bir
   isim böyle bir çakışma grubuna denk geldiğinde OTOMATİK seçim yapmaz — `migration_name_conflicts`
   tablosuna bir satır yazar, o kaydı/bağlantıyı taşımadan atlar.
3. `migration_name_conflicts` admin panelinden okunup "İncelendi" işaretlenebilir (bkz.
   `src/routes/migrationConflicts.js`, `admin.html` "Migrasyon Çakışmaları" sekmesi) — gerçek
   disambiguation (yeniden adlandırma/birleştirme) admin'in mevcut düzenleme araçlarıyla elle yapılır,
   bu ekran yalnızca raporu gösterir ve inceleme durumunu izler.
4. Frontend componentizasyonu: `mimar-detay.html` ile `ofis-detay.html`'deki birebir aynı
   claim/correction kutusu → ortak `js/components/claim-correction-box.js`; `proje-detay.html` ile
   `urun-detay.html`'deki birebir aynı galeri/lightbox → ortak `js/components/gallery.js`.

### Faz 3 — Okuma Yolunu Taşıma + Graph Derinliği + Canlı Facet Sayaçları + `data.js` Sonlandırma (büyük ölçüde uygulandı)

1. ✅ **Uygulandı** (commit `ad998c2`) — Faz 2'de eklenen canonical tablolar gerçek okuma yolu:
   `src/routes/architect.js`/`office.js`/`project.js`/`product.js` artık statik dosya + submission
   overlay okumuyor, doğrudan `architects`/`offices`/`projects`/`products`'tan okuyor (bkz. §4.1).
   Onaylı `*_submissions` satırlarının canonical tablolara aktarımı da öngörüldüğü gibi İKİ parçalı
   çözüldü: `scripts/merge-submissions-to-id-first.js` geçmiş onaylı gönderileri tek seferlik taşıdı,
   `src/lib/canonicalSync.js` ise onay/düzenleme anında CANLI olarak canonical satırı günceller —
   böylece okuma yolu tamamen canonical tablolara taşındıktan sonra da submission akışı kesintisiz çalışır.
   *(Not: `photographers` varlığı/`projects.photographer_id` — kullanıcı isteğiyle plandan tamamen
   çıkarıldı, bkz. Faz 2 notu; fotoğrafçı bilgisi kalıcı olarak `photo_credit_text` fallback'i olarak kalacak.)*
2. ❌ **Uygulanmadı** — `profile_claims`/`profile_corrections`'ı polimorfik `claims`/`corrections`
   tablolarıyla değiştirme; `revisions` tablosu. Bkz. §4.4.
3. ✅ **Uygulandı** (commit `ad998c2`) — `facet_counts` tablosu D1'de tutuluyor, `env.FACET_CACHE`
   KV'de materyalize ediliyor (bkz. `src/lib/facetCounts.js`). Kapsam yalnızca `projects`/`products`
   ile sınırlı — `architects`/`offices`'in facet modeli düz `list_type/facet_key/facet_value`
   şemasına oturmadığından bilinçli olarak dışarıda bırakıldı.
4. 🔶 **Kısmen uygulandı** — `data.js`/`projeler-data.js` `index.html` (anasayfa) üzerinden
   kaldırıldı (bkz. §4.5, kullanıcı isteği): carousel artık `/api/projects?limit=N` + yeni
   `officeNames` alanını kullanıyor. `urunler-data.js`/`malzemeler-data.js` bu kapsamın dışında.
   **Hâlâ statik dosyaları okuyan yerler:** `src/lib/seo.js` (SSR meta/JSON-LD üretimi — D1 ile
   birlikte fallback olarak), `src/routes/submissions.js` (yeni gönderi slug/isim çakışma kontrolü),
   ve `arama.html`/`hesabim.html`/`mimar-ekle.html`/`firma-ekle.html`/`proje-ekle.html`/
   `urun-ekle.html`/`uye-ol.html` (çoğu zaten `/api/*/search` canlı uçlarına geçmiş ama statik
   diziye `typeof x !== 'undefined'` fallback'iyle hâlâ bağlı). Dosyaları TAMAMEN kaldırmak bu
   tüketicilerin ayrı ayrı taşınmasını gerektirir — planlanmadı.
5. ✅ **Uygulandı** (commit `ad998c2`) — `legacy_content_hidden`, architects/offices/projects/
   products/materials için canonical tablolardaki `deleted_at`/`hidden_at` kolonlarıyla değiştirildi
   (bkz. `migrations/0023_canonical_hidden_at.sql`). **İstisna:** `news` kendi ID-first tablosuna
   hiç taşınmadığı için (statik `haberler-data.js`'in canonical karşılığı yok) `legacy_content_hidden`
   yalnızca `content_type='news'` için kullanılmaya devam ediyor (bkz.
   `migrations/0025_drop_legacy_content_hidden.sql`'daki gerekçe notu — tablo bilinçli olarak DÜŞÜRÜLMEDİ).

---

## 2. D1 Şeması

### 2a. Faz 2 — ID-First Canonical Tablolar (uygulandı, bkz. `migrations/0022_id_first_entities.sql`)

Aşağıdaki şema `migrations/0022_id_first_entities.sql` ile BİREBİR aynıdır (kaynak of truth migration
dosyasıdır, bu blok yalnızca dokümantasyon amaçlıdır). Kullanıcı isteğiyle ayrı bir `photographers`
varlığı/`projects.photographer_id` FK'si YOK — fotoğrafçı bilgisi `photo_credit_text`/
`photo_credit_url` serbest metin fallback'i olarak kalıyor.

```sql
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
  claimed_by_user_id TEXT REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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
  source TEXT NOT NULL DEFAULT 'legacy_static' CHECK (source IN ('legacy_static','submission','admin')),
  legacy_key TEXT,
  claimed_by_user_id TEXT REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- offices.founders JSON-of-names yerine; canlı hesaplama mantığı zaten architects[].office ===
-- offices[].name eşleşmesiydi (bkz. ofis-detay.html#renderFoundersGrid).
CREATE TABLE office_founders (
  office_id INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  architect_id INTEGER NOT NULL REFERENCES architects(id) ON DELETE CASCADE,
  PRIMARY KEY (office_id, architect_id)
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
  photo_credit_text TEXT,             -- fotoğrafçı entity'si YOK (kapsam daraltma) — serbest metin fallback
  photo_credit_url TEXT,
  source_url TEXT,
  ai_generated INTEGER DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'legacy_static' CHECK (source IN ('legacy_static','submission','admin')),
  legacy_key TEXT,
  claimed_by_user_id TEXT REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- projects.designer JSON-of-names yerine — bir isim ya bir mimara ya bir ofise eşleşir.
CREATE TABLE project_designers (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  architect_id INTEGER REFERENCES architects(id) ON DELETE CASCADE,
  office_id INTEGER REFERENCES offices(id) ON DELETE CASCADE,
  CHECK ((architect_id IS NOT NULL) != (office_id IS NOT NULL))
);

-- product_submissions + material_submissions birleşimi (kind ile ayrılır).
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('product','material')),
  title TEXT NOT NULL,
  brand_office_id INTEGER REFERENCES offices(id),
  brand_name_raw TEXT,                -- eşleşmeyen marka adları için fallback (bkz. migration_name_conflicts)
  website TEXT,
  category TEXT,
  description TEXT,
  images TEXT,                        -- JSON
  specs TEXT,                         -- JSON [{label,value}]
  source_url TEXT,
  ai_generated INTEGER DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'legacy_static' CHECK (source IN ('legacy_static','submission','admin')),
  legacy_key TEXT,
  claimed_by_user_id TEXT REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE product_architects (      -- product_submissions.architect (serbest metin) yerine
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  architect_id INTEGER NOT NULL REFERENCES architects(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, architect_id)
);

CREATE TABLE project_products (        -- "Kullanılan Ürünler/Malzemeler" graph kenarı (dolumu Faz 3)
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

-- Admin panelinde kontrol edilebilecek eşleştirme raporu (bkz. §4, src/routes/migrationConflicts.js)
-- — migrate-to-id-first.js otomatik eşleştiremediği HER durumu (aynı isimde birden fazla mimar/ofis,
-- ya da bir proje/ürünün bir çakışma grubundaki bir isme referans vermesi) burada satır olarak
-- bırakır, hiçbirini tahminle otomatik çözmez.
CREATE TABLE migration_name_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,          -- 'architect' | 'office' | 'project_designer' | 'office_founder' | 'product_brand' | 'product_architect'
  conflict_key TEXT NOT NULL,
  context TEXT,
  candidates TEXT NOT NULL,           -- JSON dizi
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','ignored')),
  resolved_target_id INTEGER,
  resolved_by_user_id TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2b. Faz 3 — Planlanan Ek Şema (henüz uygulanmadı)

```sql
-- ============================================================
-- POLİMORFİK CLAIM / CORRECTION — profile_claims/profile_corrections yerine
-- (comments/ratings/legacy_content_hidden'daki mevcut target_type deseninin genişletilmiş hali)
-- ============================================================

CREATE TABLE claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('architect','office','project','product')),
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
  target_type TEXT NOT NULL CHECK (target_type IN ('architect','office','project','product')),
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

**Not:** `legacy_content_hidden`, `badge_requests`, `admin_badges` tabloları migration penceresi boyunca `legacy_key` üzerinden aynen çalışmaya devam eder — bunları da `target_id`'ye geçirmek ayrı, düşük öncelikli bir adım.

---

## 3. Faz 1 Uygulaması — Gerçek Kod

Faz 1 planlanan pseudocode'un aksine, kod tabanında zaten `import dataJs from '../../data.js'` CJS-interop deseni mevcuttu (bkz. `src/lib/seo.js`, `src/routes/legacyContent.js`) — SEO meta enjeksiyonu için `buildArchitectMeta`/`buildOfficeMeta`/`buildProjectMeta`/`buildProductMeta` zaten statik veri + onaylı submission overlay'ini sunucu tarafında birleştiriyordu. Faz 1, bu aynı deseni SEO meta'sının ötesine, **tüm sayfa verisini** döndüren gerçek API uçlarına genişletti:

- `src/routes/architect.js` — `GET /api/architect/:key` (isim ya da slug kabul eder): statik `architects[]` kaydı ya da yalnızca DB'de var olan bir mimar → onaylı `architect_submissions` overlay'i (field-by-field) → bağlı ofis (kendi overlay'iyle) → meslektaşlar (ofis overlay'i uygulanmış) → ilgili projeler (statik + üye gönderisi, `project-edits` overlay'i uygulanmış, admin-hidden filtrelenmiş) → `hidden` bayrağı. `mimar-detay.html` artık tek bir `fetch` ile bu uca bağlanıyor.
- `src/routes/office.js` — `GET /api/office/:key`: aynı desen, ofisler için. Kurucular/ortaklar (`founders`) hâlâ canlı `architects[].office === o.name` eşleşmesiyle hesaplanır (statik `office.founders` alanı zaten kullanılmıyordu, bkz. `ofis-detay.html#renderFoundersGrid`), yalnızca artık sunucu tarafında.
- `src/routes/project.js` — `GET /api/project/:slug` (tekil proje, ileride `proje-detay.html`'in tüketmesi için hazır — bu turda `proje-detay.html` değiştirilmedi) ve `GET /api/projects/filters` (proje.html'in `computeOptions()`'ı ile birebir aynı faceted/bağımlı sayaç mantığı, sunucuda).
- `src/routes/product.js` — `GET /api/product/:key` (tekil ürün/malzeme, ileride `urun-detay.html`'in tüketmesi için hazır — bu turda `urun-detay.html` değiştirilmedi).

`proje.html`'deki asıl filtreleme/sayfalama/render mantığı istemci tarafında bırakıldı. Sayaç sayıları (`(461)` gibi parantez içindeki rakamlar) İKİ aşamalı çalışır: sidebar her filtre değişiminde ÖNCE mevcut client-side `computeOptions()` ile anında (sıfır ağ gecikmesi) çizilir, ardından `reconcileFilterCountsFromServer()` `/api/projects/filters`'ı çağırıp gelen sayıları birkaç yüz milisaniyede sessizce üzerine yazar (bkz. `proje.html#reconcileFilterCountsFromServer`, `src/routes/project.js#handleProjectFiltersRoute`). Gerekçe: bu sayfa mevcut veri ölçeğinde zaten anlık çalışıyor; sayaçları TAMAMEN sunucuya taşıyıp her checkbox tıklamasını bir round-trip'e bağlamak (client hesabını tamamen kaldırmak) bu ölçekte gerçek bir performans kazancı sağlamadan görünür bir gecikme/flicker riski getirirdi. Bu "önce anında client, sonra sessiz sunucu düzeltmesi" deseni, endpoint'i gerçek trafikte çalışır ve doğrulanmış tutarken mevcut UX'i hiç bozmuyor — Faz 3'teki `facet_counts` + KV materyalizasyonu, veri 50k-500k'ya ulaştığında client hesabının tamamen kaldırılıp yalnızca sunucu kaynaklı hâle getirileceği nokta.

---

## 4. Faz 2 Uygulaması — Gerçek Kod

### 4.1 ID-first şema + migration script

- `migrations/0022_id_first_entities.sql` — §2a'daki tabloların tamamını ekler; mevcut hiçbir
  tabloyu değiştirmez/silmez, tamamen additive. Yerel dev DB'ye (`--persist-to
  /Users/kaancorbaci/.mimarlab-dev-state`) uygulanıp doğrulandı.
- `scripts/migrate-to-id-first.js` — plain `node` ile çalışan (proje kökünde `package.json` yok,
  bu yüzden CJS `require()` kullanır), statik `data.js`/`projeler-data.js`/`urunler-data.js`/
  `malzemeler-data.js`'i okuyup canonical tablolara `INSERT` üreten tek seferlik script. **Hiçbir
  veritabanına doğrudan yazmaz** — `scripts/output/id-first-seed.sql` dosyasını üretir, operatör
  bunu inceleyip kendi isteğiyle `wrangler d1 execute --file=...` ile uygular. Aynı isimde birden
  fazla mimar/ofis (bkz. "Duplicate name key limitation") ya da bir proje/ürünün böyle bir çakışma
  grubundaki bir isme referans vermesi durumunda o kaydı/bağlantıyı OTOMATİK seçip taşımaz,
  `migration_name_conflicts`'e bir satır yazıp atlar. Eşleşme hiç bulunamayan isimler (ör.
  `designer: ["Bilinmiyor"]`) ise çakışma SAYILMAZ — bugünkü canlı sitede de bağlantısız kalıyorlar,
  bu yüzden sessizce atlanır.
- Gerçek veri üzerinde doğrulandı: 814 mimardan 797'si taşındı (8 isim çakışma grubu, 17 kayıt,
  `migration_name_conflicts`'e yazıldı), 670 firmanın tamamı (isim çakışması yok), 773
  `office_founders` bağlantısı, 572 proje, 419 `project_designers` bağlantısı, 9 ürün/malzeme.
  Üretilen SQL yerel dev DB'ye uygulanıp satır sayıları doğrulandı.
- **Bu turda işlenmeyen**: onaylı `*_submissions` satırlarının (`claimed_profile_key`/`claimed_slug`
  ile statik kayıt üzerine overlay ya da bağımsız yeni kayıt olarak) canonical tablolara aktarımı —
  script yalnızca statik "taban" veriyi taşıyor (bkz. script sonundaki TODO). Bu, D1'den okuma
  gerektirdiğinden script'in bugünkü "yalnızca statik dosya oku" modelinden farklı bir ikinci geçiş;
  Faz 3'ün okuma-yolu-taşıma adımıyla birlikte ele alınacak.

### 4.2 Migrasyon çakışma raporu (admin)

- `src/routes/migrationConflicts.js` — `GET /api/admin/migration-conflicts` (`?status=`/`?entityType=`
  filtreli) ve `PATCH /api/admin/migration-conflicts/:id` (`{status: 'pending'|'resolved'|'ignored'}`).
  **Adayları otomatik birleştirmez/seçmez** — yalnızca raporu okur ve admin'in "inceledim"
  işaretlemesini kaydeder; gerçek disambiguation (yeniden adlandırma/birleştirme) admin'in mevcut
  mimar/ofis düzenleme araçlarıyla elle yapılır (kullanıcı isteği: "güvenli bir eşleştirme raporu/akışı").
- `admin.html` — yeni "Migrasyon Çakışmaları" sekmesi, diğer sekmelerle (Mesajlar, Rozet Talepleri
  vb.) birebir aynı desen: durum alt-sekmeleri (Beklemede/İncelendi/Yoksayıldı), her çakışma için
  aday listesi + "İncelendi Olarak İşaretle" butonu. `handleAdminSummary` (`src/routes/admin.js`)
  `pendingMigrationConflicts` sayısını döner, sekme başlığında diğer sekmelerdeki gibi kırmızı nokta
  gösterir.
- Uçtan uca doğrulandı: yerel dev'de admin oturumu ile `GET`/`PATCH` çağrıları ve `/api/admin/summary`
  sayacı test edildi (8 bekleyen çakışma doğru döndü, bir kaydı `resolved` yapıp geri `pending`'e
  alma çalıştı).

### 4.3 Frontend componentizasyonu

- `js/components/claim-correction-box.js` — `mimar-detay.html`/`ofis-detay.html`'deki birebir aynı
  "Bu profil sana mı ait?" (claim) + "Bilgi kaynağı" (correction) kutuları ile bunlara bağlı
  Düzenle/Arşivle/Sil butonunu tek bir `createClaimCorrectionBox(config)` fabrikasına indirir. Sayfaya
  özel olan tek şey (metin etiketleri, profil anahtarı, ofis yeniden adlandırmasında `_claimKey` vs.
  güncel isim ayrımı, `/api/admin/legacy/content-action` hedefi) `config` üzerinden geçirilir; diğer
  paylaşılan script'lerle (`save-widget.js`, `rating-widget.js`) aynı desende düz `<script src>` ile
  dahil edilir, global `currentUser`/`escapeAttr` üzerinden çalışır.
- `js/components/gallery.js` — `proje-detay.html`/`urun-detay.html`'deki birebir aynı galeri
  şeridi + lightbox (ok/klavye gezinme, sayaç, elle kaydırmada en yakın görsele kilitlenme) mantığını
  `initDetailGallery({images, title, placeholderHtml})` fonksiyonuna indirir; placeholder'ın TAM
  HTML'i (ürün sayfasında favicon'lu, proje sayfasında sade baş harfli) çağıran sayfadan geçirilir.
- Her iki modül de yerel dev'de tarayıcıda doğrulandı: mimar/ofis detay sayfalarında claim/correction
  kutuları doğru render oldu (konsol hatası yok), proje detay sayfasında 21 görsellik galeri +
  lightbox ok/sayaç davranışı, ürün detay sayfasında tekil-görsel (`<=1`) placeholder davranışı test edildi.

### 4.4 Bu turda uygulanmayanlar → Faz 3'te tamamlandı (bkz. §5)

*(Bu bölüm eskiden Faz 2 sonrası bekleyen işleri listeliyordu — canonical okuma yolu, submission
ikinci geçişi ve `product_architects`/`project_products` doldurma dahil hepsi Faz 3'te
tamamlandı, bkz. §5.1/§5.3. Yalnızca `profile_claims`/`profile_corrections` → polimorfik
`claims`/`corrections` ve `revisions` tablosu hâlâ bekliyor, bkz. §5.4.)*

## 5. Faz 3 Uygulaması — Gerçek Kod

### 5.1 D1 okuma yolu + canlı submission senkronizasyonu

- Commit `ad998c2` — `src/routes/architect.js`/`office.js`/`project.js`/`product.js` artık statik
  `data.js`/`projeler-data.js`/`urunler-data.js`/`malzemeler-data.js` + submission overlay okumuyor;
  doğrudan `architects`/`offices`/`projects`/`products` (+ `office_founders`/`project_designers`/
  `product_architects`/`project_products` join tabloları) üzerinden `src/lib/canonicalRead.js#
  parseCanonicalRow` ile okuyor.
- `scripts/merge-submissions-to-id-first.js` — Faz 2'nin script'inin (yalnızca statik "taban" veriyi
  taşıyordu) ikinci geçişi: geçmişte onaylanmış `*_submissions` satırlarını tek seferlik canonical
  tablolara taşıdı.
- `src/lib/canonicalSync.js` — bu ikisinin CANLI karşılığı: bir gönderi onaylandığında/onaylıyken
  düzenlendiğinde (bkz. `src/routes/admin.js#handleSubmissionsAdmin`, `src/routes/submissions.js#
  createSubmission/updateOwnSubmission`) canonical satır AYNI anda güncellenir — okuma yolu tamamen
  canonical tablolara taşındığı için bu senkronizasyon olmadan onay ekranı "başarılı" derdi ama
  siteye hiçbir şey yansımazdı. `product_architects`/`project_products` graph kenarları da (Faz 2'de
  şema eklenmiş ama doldurulmamıştı) artık bu modül üzerinden canlı dolduruluyor.

### 5.2 Facet sayaçları — D1 + KV

- `migrations/0024_facet_counts.sql` + `src/lib/facetCounts.js` — `facet_counts` D1'de kalıcı
  tutulur, `env.FACET_CACHE` KV'de önbelleklenir (Workers Cache API'nin aksine KV global replikasyon
  sağlar). Kapsam bilinçli olarak yalnızca `projects`/`products` ile sınırlı (bkz. dosya başı yorumu)
  — `architects`/`offices`'in facet modeli bu düz `list_type/facet_key/facet_value` şemasına
  oturmuyor.

### 5.3 `legacy_content_hidden` → canonical `deleted_at`/`hidden_at`

- `migrations/0023_canonical_hidden_at.sql` — architects/offices/projects/products/materials kendi
  `deleted_at`/`hidden_at` kolonlarını kazandı.
- `migrations/0025_drop_legacy_content_hidden.sql` — **planlanan tam kaldırma UYGULANMADI**: uygulama
  sırasında `news`'in (statik `haberler-data.js`) hiçbir zaman ID-first migration'a dahil edilmediği
  ortaya çıktı, bu yüzden `legacy_content_hidden` tablosu KALDI ama yalnızca `content_type='news'`
  için kullanılmaya devam ediyor. `news`'in kendi canonical tabloya geçişi ayrı, planlanmamış bir adım.

### 5.4 Bu turda uygulanmayanlar (hâlâ bekliyor)

- `profile_claims`/`profile_corrections` → polimorfik `claims`/`corrections` (bkz. §2b).
- `revisions` tablosu (bkz. §2b).
- `news`'in kendi ID-first canonical tablosuna taşınması (bkz. §5.3).
- `data.js`/`projeler-data.js`'in TÜM tüketicilerden kaldırılması — yalnızca `index.html` (bkz.
  §5.5) taşındı; `src/lib/seo.js`, `src/routes/submissions.js`, `arama.html`, `hesabim.html`,
  `mimar-ekle.html`, `firma-ekle.html`, `proje-ekle.html`, `urun-ekle.html`, `uye-ol.html` hâlâ
  statik dosyaları okuyor — dosyaları fiziksel olarak silmek bu tüketicilerin ayrı ayrı taşınmasını
  gerektirir.

### 5.5 Anasayfa (`index.html`) D1 geçişi (kullanıcı isteği)

- **API sözleşmesi genişletmesi (additive, geriye dönük uyumlu):** `src/routes/project.js` — mevcut
  `designer` alanı DEĞİŞTİRİLMEDEN, `DESIGNER_JOIN_SQL`'e `architects.office_id → offices` LEFT
  JOIN'i eklendi, üç sorguya (`handleProjectDetailRoute`, `fetchActiveProjectPool`,
  `handleProjectFiltersRoute`) `office_names` GROUP_CONCAT sütunu ve `shapeProjectItem()`'a
  `officeNames: string[]` alanı eklendi (SQLite `GROUP_CONCAT(DISTINCT ..., ayraç)` bir arada
  desteklenmediğinden tekilleştirme JS tarafında yapılıyor). `GET /api/projects` zaten var olan,
  proje.html'in de kullandığı uçtur — yeni bir endpoint AÇILMADI.
- **`index.html` carousel migrasyonu:** eskiden istemci tarafında statik `projeler-data.js`'in 571
  kayıtlık anlık görüntüsünü üye gönderileriyle serpiştiren (`latestPublishedProjectOrder`/
  `RECENT_WINDOW_MS`) algoritma kaldırıldı — `/api/projects?limit=24` zaten `id DESC` sıralı,
  statik+submission birleşik, gizli/silinmiş satırları filtrelenmiş TEK bir havuz döndürdüğü için
  gerek kalmadı. Görselsiz kayıtlara (ör. test/taslak satırlar) karşı tampon olarak 24 kayıt çekilip
  görseli olan ilk 6'sı gösteriliyor (eski `projectsWithImages.slice(0,6)` davranışının karşılığı).
  Slayt altyazısındaki ofis adı artık `p.officeNames`'ten geliyor (data.js `offices[]`/`architects[]`
  üzerinde istemci tarafında yapılan eski eşleştirmenin sunucu tarafı karşılığı).
  `data.js`/`projeler-data.js` `<script>` etiketleri `index.html`'den kaldırıldı — dosyaların
  kendisi silinmedi (bkz. §5.4'teki diğer tüketiciler).
- **Hata/fallback:** `/api/projects` başarısız olursa (ağ hatası/5xx) mini-carousel'lerdeki
  (`createMiniSlider#renderError`) AYNI `.slider-fallback` deseni ana carousel'e de uygulandı
  (`renderSliderError()`) — artık statik yedek katalog olmadığından bu, boş bir slider yerine geçen
  tek güvenlik ağı.
- Yerel `wrangler dev`'de doğrulandı: 0 konsol hatası, `/api/projects` yanıtında `officeNames`
  eksiksiz, carousel 6 öğe + doğru sırayla (görselsiz en yeni test satırı doğru filtrelendi),
  fallback path'i (`renderSliderError` doğrudan çağrılarak) DOM'da doğru render edildiği doğrulandı.
