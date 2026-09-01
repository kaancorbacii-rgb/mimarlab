-- d1_migrations senkronizasyonu (production audit, 2026-09-01, madde D).
--
-- SORUN: tablo 0056'da takılıydı ama migrations/ klasöründe 0079'a kadar dosya var. Aradaki
-- 23 migration canlıya ELLE (`wrangler d1 execute --file`) uygulandı — bu depoda bilinen ve
-- kasıtlı bir pratik (bkz. proje notu: 'never bare wrangler d1 migrations apply') ama yan
-- etkisi şu: `wrangler d1 migrations apply --remote` ARTIK HİÇ KULLANILAMIYOR. Çalıştırılırsa
-- 0057'den itibaren hepsini yeniden uygulamaya kalkar; içlerindeki ALTER TABLE'lar
-- 'duplicate column name' ile HATA verir, koşu yarıda kalır ve GERÇEKTEN yeni olan bir
-- migration hiç uygulanamaz. Yani araç, tam da ihtiyaç duyulacağı anda bozuk durumda.
--
-- DOĞRULAMA: bu satırlar yazılmadan ÖNCE 0057-0079'un canlıda GERÇEKTEN uygulanmış olduğu
-- tek tek doğrulandı — her migration'ın oluşturduğu somut nesne (index/tablo/kolon/trigger)
-- sqlite_master ve pragma_table_xinfo ile sorgulandı, hepsi mevcut çıktı (0065'in DROP'u da
-- doğrulandı: quiz_attempts YOK). Bu adım olmadan kayıt eklemek, uygulanmamış bir migration'ı
-- kalıcı olarak atlamak anlamına gelirdi.

INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (57, '0057_top100_dedupe_rnk100.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (58, '0058_backfill_product_brand_offices.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (59, '0059_saved_items_type_key_index.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (60, '0060_newsletter_notify_counter.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (61, '0061_project_publish_date.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (62, '0062_duel_system.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (63, '0063_quiz_system.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (64, '0064_duel_analyses.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (65, '0065_drop_quiz_attempts.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (66, '0066_project_lat_lng.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (67, '0067_project_list_order_index.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (68, '0068_profile_claims_office_position.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (69, '0069_follows.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (70, '0070_profile_messages.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (71, '0071_product_files.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (72, '0072_product_project_links.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (73, '0073_collections.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (74, '0074_shared_items.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (75, '0075_office_cover_url.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (76, '0076_project_image_hotspots.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (77, '0077_live_row_fingerprint_indexes.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (78, '0078_entity_stats.sql', datetime('now'));
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (79, '0079_search_fold_columns.sql', datetime('now'));
