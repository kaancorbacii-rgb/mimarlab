-- Faz 3 — canonical tablolara hidden_at ekler (bkz. docs/architecture-roadmap.md §1 Faz3.5).
-- 0022'de yalnızca deleted_at vardı; legacy_content_hidden'ın yerini alacak "gizle" (hidden_at,
-- silmeden geri alınabilir) ile "sil" (deleted_at) ayrımı canonical satırın kendisinde tutulur.

ALTER TABLE architects ADD COLUMN hidden_at TEXT;
ALTER TABLE offices ADD COLUMN hidden_at TEXT;
ALTER TABLE projects ADD COLUMN hidden_at TEXT;
ALTER TABLE products ADD COLUMN hidden_at TEXT;
