-- P2 hardening (denetim raporu, 2026-08-23) — migrations/0040_remove_consultant_schema.sql'in
-- kendi dosya başı yorumu "architect_submissions.consultant_request/hourly_rate/
-- session_duration_min/expertise_tags/available_slots/consultant_experience_years KASITLI OLARAK
-- burada yok: yerel geliştirme D1'inde bu kolonlar hiç mevcut değildi — 0034 hiçbir ortamda
-- gerçekten uygulanmamış görünüyor" diyordu. Bu iddia PRODUCTION için YANLIŞ çıktı: doğrudan
-- production sqlite_master sorgusuyla doğrulandı (2026-08-23) — architect_submissions'ta bu 6
-- kolon ve idx_architect_submissions_consultant indeksi GERÇEKTEN mevcut (muhtemelen 0034 o an
-- yalnızca yazarın kendi local D1'inde eksikti, production'a ayrıca uygulanmıştı — bu projede daha
-- önce de görülen bir local/prod ayrışma deseni). Bu dosya, 0040'ın kasıtlı olarak eksik bıraktığı
-- bu parçayı tamamlar.
--
-- GÜVENLİK DOĞRULAMASI (production, 2026-08-23, salt-okunur sorgularla):
--   - SELECT COUNT(*) FROM architect_submissions WHERE consultant_request = 1  → 0
--   - Hiçbir canlı route/frontend/script bu 6 kolonu okumuyor/yazmıyor (repo genelinde grep
--     edildi: consultant|consultation_request|is_consultant|hourly_rate|session_duration|
--     expertise_tags|available_slots → src/, js/, *.html, scripts/ içinde SIFIR sonuç).
--   - Bu tabloda hiçbir CHECK constraint/trigger/view bu kolonlara referans vermiyor (DB'de hiç
--     trigger yok, doğrulandı).
--   - idx_architect_submissions_consultant PARTIAL bir indeks (WHERE consultant_request = 1) —
--     SQLite/D1 bir kolonu indeksten önce DROP etmeye izin vermez, bu yüzden aşağıda önce indeks
--     düşürülür.
--
-- UYGULAMA SIRASI: bu dosya migrations/0040_remove_consultant_schema.sql'e EK niteliğindedir, onun
-- YERİNE geçmez — 0040 kendisi de production'a henüz uygulanmadı (bkz. d1_migrations, 2026-08-23
-- itibarıyla tek "pending" migration budur). Consultant şemasını TAMAMEN temizlemek için ikisi de
-- (önce 0040, sonra bu dosya, sıra önemli değil — birbirinden bağımsız tablolara dokunuyorlar)
-- production'a uygulanmalı. Bu dosya BİLEREK bu P2 fazında ÇALIŞTIRILMADI (yalnızca hazırlandı) —
-- kullanıcı onayı/ayrı bir uygulama adımı bekliyor.

DROP INDEX IF EXISTS idx_architect_submissions_consultant;

ALTER TABLE architect_submissions DROP COLUMN consultant_request;
ALTER TABLE architect_submissions DROP COLUMN hourly_rate;
ALTER TABLE architect_submissions DROP COLUMN session_duration_min;
ALTER TABLE architect_submissions DROP COLUMN expertise_tags;
ALTER TABLE architect_submissions DROP COLUMN available_slots;
ALTER TABLE architect_submissions DROP COLUMN consultant_experience_years;
