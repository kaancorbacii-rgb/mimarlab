-- d1_migrations senkronizasyonu (tam sistem denetimi, 2026-09-05).
--
-- SORUN: scripts/sync-d1-migrations-2026-09-01.sql tabloyu 0079'a kadar hizalamıştı; o tarihten
-- sonra eklenen 0087/0088/0089 yine ELLE (`wrangler d1 execute --file`) uygulandı ama tabloya
-- kaydedilmedi. Sonuç: `wrangler d1 migrations list --remote` bu üçünü "uygulanacak" olarak
-- gösteriyor. Bu, 2026-09-01 notundaki AYNI tuzağın tekrarı: bir gün gerçekten yeni bir migration
-- uygulanmak istendiğinde `wrangler d1 migrations apply --remote` önce bu üçünü yeniden
-- çalıştırmaya kalkar, içlerindeki `ALTER TABLE ... ADD COLUMN` 'duplicate column name' ile hata
-- verir, koşu yarıda kalır ve asıl yeni migration hiç uygulanmaz.
--
-- DOĞRULAMA (bu satırlar yazılmadan ÖNCE, production D1'e karşı tek tek sorgulandı — bkz.
-- 2026-09-01 dosyasındaki AYNI yordam; bu adım atlanırsa uygulanmamış bir migration kalıcı
-- olarak atlanmış olurdu):
--   0087 -> pragma_table_info('projects').display_order            MEVCUT
--           sqlite_master: idx_projects_build_status_order          MEVCUT
--   0088 -> pragma_table_info('product_submissions').claimed_slug   MEVCUT
--           pragma_table_info('material_submissions').claimed_slug  MEVCUT
--           sqlite_master: idx_product_claimed_slug                 MEVCUT
--           sqlite_master: idx_material_claimed_slug                MEVCUT
--   0089 -> pragma_table_info('products').display_order             MEVCUT
--           sqlite_master: idx_products_list_order                  MEVCUT
--
-- NOT: `id` kolonu yalnızca bir sıra numarasıdır ve tablodaki mevcut numaralandırma dosya
-- adlarıyla zaten birebir örtüşmüyor (ör. id=81 -> 0083_...sql); Wrangler karşılaştırmayı
-- `name` üzerinden yapar, bu yüzden önemli olan dosya adının birebir doğru yazılmasıdır.

INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (87, '0087_project_display_order.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (88, '0088_product_claimed_slug.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (89, '0089_product_display_order.sql', datetime('now'));
