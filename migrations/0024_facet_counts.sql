-- Faz 3 — canlı filtre sayaçları (bkz. docs/architecture-roadmap.md §2b). KV ile birlikte
-- kullanılır (bkz. src/lib/facetCounts.js) — bu tablo kalıcı/gerçek sayı kaynağı, KV yalnızca
-- hızlı okuma için önbellek katmanıdır.

CREATE TABLE IF NOT EXISTS facet_counts (
  list_type TEXT NOT NULL,            -- 'architects' | 'offices' | 'projects' | 'products'
  facet_key TEXT NOT NULL,            -- 'category' | 'position' | 'award' | ...
  facet_value TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (list_type, facet_key, facet_value)
);
