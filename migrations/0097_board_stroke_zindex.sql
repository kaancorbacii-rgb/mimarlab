-- Vektörel çizim objeleri (kullanıcı isteği): her kalem izi (board_strokes satırı) artık
-- collection_items'taki öğelerle AYNI z-index uzayını paylaşır — "Öne Getir/Arkaya Gönder"
-- işlemi çizimlerle görseller/notlar arasında GERÇEKTEN sıralanabilsin diye (bkz. js/components/
-- auth-modal.js#renderDetail, çizimler artık TEK bir üstteki SVG katmanı değil, her biri kendi
-- position:absolute SVG sarmalayıcısında, diğer öğelerle aynı stacking context'te render edilir).
ALTER TABLE board_strokes ADD COLUMN z_index INTEGER NOT NULL DEFAULT 0;
