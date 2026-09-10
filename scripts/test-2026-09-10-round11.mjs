#!/usr/bin/env node
// 2026-09-10 ON BİRİNCİ TUR — BİRİM/ENTEGRASYON TESTLERİ.
//
// scripts/test-2026-09-08-round.mjs ile AYNI desen: test koşucusu/npm bağımlılığı yok, node:assert +
// node:sqlite üzerinde GERÇEK bir SQLite (schema.sql + gerekli migration'lar).
//
// KAPSAM — madde 2: "Blurlu kişi, firma ve marka popupları açılabilir olsun, kilitlerini kaldır.
// Ama popup olarak açıldıkları zaman da popuptaki tüm görseller blurlu gözüksünler. ... Hâli
// hazırdaki blurlu projeler ve ürünler bir kullanıcı; firma, marka veya kişi profilini sahiplenene
// kadar kilitli ve blurlu kalmaya devam etsin."
//
// ÜÇ DURUM (bkz. migrations/0107_preview_state.sql) ve detay uçlarının BEKLENEN yanıtı:
//   hidden_at NULL,  preview_at NULL   -> canlı     -> item DOLU, hidden=false, preview=false
//   hidden_at DOLU,  preview_at DOLU   -> önizleme  -> item DOLU, hidden=false, preview=TRUE   (YENİ)
//   hidden_at DOLU,  preview_at NULL   -> tam arşiv -> item NULL, hidden=true,  preview=false  (410)
//
// PROJE/ÜRÜN karşılığı BİLEREK değişmedi — aşağıda ayrıca test edilir.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 4).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

// ---- D1 shim (node:sqlite) — scripts/test-2026-09-08-round.mjs ile BİREBİR aynı ----------------
function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return {
    prepare: (sql) => stmt(sql, []),
    async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; },
  };
}
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  // (0107 — preview_at kolonları — schema.sql'de ZATEN var; ayrıca uygulanırsa "duplicate column".)
  return db;
}

const NOW = '2026-09-10T00:00:00Z';
function seed(db) {
  db.exec(`
    INSERT INTO offices (slug, name, loc, cats, source, hidden_at, preview_at) VALUES
      ('canli-firma',    'Canlı Firma',    'İstanbul', '["Mimarlık"]', 'legacy_static', NULL,       NULL),
      ('onizleme-firma', 'Önizleme Firma', 'İstanbul', '["Mimarlık"]', 'legacy_static', '${NOW}',   '${NOW}'),
      ('arsiv-firma',    'Arşiv Firma',    'İstanbul', '["Mimarlık"]', 'legacy_static', '${NOW}',   NULL);
    INSERT INTO architects (slug, name, source, hidden_at, preview_at) VALUES
      ('canli-kisi',    'Canlı Kişi',    'legacy_static', NULL,     NULL),
      ('onizleme-kisi', 'Önizleme Kişi', 'legacy_static', '${NOW}', '${NOW}'),
      ('arsiv-kisi',    'Arşiv Kişi',    'legacy_static', '${NOW}', NULL);
  `);
}

async function architectPayload(key) {
  const db = freshDb(); seed(db);
  const { buildArchitectPayload } = await import('../src/routes/architect.js');
  return buildArchitectPayload({ DB: d1(db), IMG_KV: null }, key);
}
async function officePayload(key) {
  const db = freshDb(); seed(db);
  const { buildOfficePayload } = await import('../src/routes/office.js');
  return buildOfficePayload({ DB: d1(db), IMG_KV: null }, key);
}

// statusFor'un (src/lib/publicCache.js) kararını burada aynen tekrar ederiz: gövde HTTP durumunu
// belirliyor, testin asıl konusu da bu — önizleme kaydı artık 200 dönmeli.
function statusFor(data) {
  if (!data || data.item !== null) return 200;
  return data.hidden ? 410 : 404;
}

section('KİŞİ (/api/architect/:key)');

await test('canlı kişi: item dolu, preview=false, 200', async () => {
  const p = await architectPayload('canli-kisi');
  assert.ok(p.item, 'item dolu olmalı');
  assert.equal(p.hidden, false);
  assert.equal(p.preview, false);
  assert.equal(statusFor(p), 200);
});

await test('ÖNİZLEME kişi: item DOLU, hidden=false, preview=true, 200 (popup açılabilir)', async () => {
  const p = await architectPayload('onizleme-kisi');
  assert.ok(p.item, 'önizleme kaydının gövdesi artık tam dönmeli');
  assert.equal(p.item.name, 'Önizleme Kişi');
  assert.equal(p.hidden, false, 'hidden true kalırsa istemci fetchEntity gövdeyi "yok" sayar');
  assert.equal(p.preview, true, 'preview bayrağı popuptaki blurun tek kaynağı');
  assert.equal(statusFor(p), 200);
});

await test('ARŞİV kişi: item null, hidden=true, 410 (koruma sürüyor)', async () => {
  const p = await architectPayload('arsiv-kisi');
  assert.equal(p.item, null);
  assert.equal(p.hidden, true);
  assert.equal(p.preview, false);
  assert.equal(statusFor(p), 410);
});

section('FİRMA / MARKA (/api/office/:key)');

await test('canlı firma: item dolu, preview=false, 200', async () => {
  const p = await officePayload('canli-firma');
  assert.ok(p.item);
  assert.equal(p.hidden, false);
  assert.equal(p.preview, false);
  assert.equal(statusFor(p), 200);
});

await test('ÖNİZLEME firma: item DOLU, hidden=false, preview=true, 200 (popup açılabilir)', async () => {
  const p = await officePayload('onizleme-firma');
  assert.ok(p.item, 'önizleme kaydının gövdesi artık tam dönmeli');
  assert.equal(p.item.name, 'Önizleme Firma');
  assert.equal(p.hidden, false);
  assert.equal(p.preview, true);
  assert.equal(statusFor(p), 200);
});

await test('ARŞİV firma: item null, hidden=true, 410 (koruma sürüyor)', async () => {
  const p = await officePayload('arsiv-firma');
  assert.equal(p.item, null);
  assert.equal(p.hidden, true);
  assert.equal(p.preview, false);
  assert.equal(statusFor(p), 410);
});

section('İSTEMCİ SÖZLEŞMELERİ (kaynak taraması — DOM gerektirmeyen kısım)');

const previewCardsSrc = readFileSync(new URL('../js/components/preview-cards.js', import.meta.url), 'utf8');
const modalShellSrc = readFileSync(new URL('../js/components/modal-shell.js', import.meta.url), 'utf8');
const architectModalSrc = readFileSync(new URL('../js/components/architect-modal.js', import.meta.url), 'utf8');
const officeModalSrc = readFileSync(new URL('../js/components/office-modal.js', import.meta.url), 'utf8');
const claimBoxSrc = readFileSync(new URL('../js/components/claim-correction-box.js', import.meta.url), 'utf8');

await test('tıklama kilidi yalnızca .ml-preview-locked kartlarda (proje/ürün)', () => {
  assert.ok(previewCardsSrc.includes(".closest('.ml-preview-locked')"),
    'guard() artık .ml-preview-card yerine .ml-preview-locked aramalı');
  assert.ok(previewCardsSrc.includes("'.ml-preview-locked *{pointer-events:none;}'"),
    'pointer-events kilidi yalnızca kilitli kartlara uygulanmalı');
  assert.ok(!/\.ml-preview-card \*\{pointer-events/.test(previewCardsSrc),
    'tüm önizleme kartlarını tıklanamaz yapan eski kural kalmamalı');
});

await test('kişi/firma/marka kartı kilitlenmez, proje/ürün kartı kilitlenir', () => {
  assert.ok(previewCardsSrc.includes('function isProfileKey(key)'));
  assert.ok(/if \(isProfileKey\(key\)\) \{[\s\S]{0,400}?continue;/.test(previewCardsSrc),
    'profil kartı ml-preview-locked eklenmeden döngüye devam etmeli');
  assert.ok(previewCardsSrc.includes("cardRoot.classList.add('ml-preview-locked')"));
});

await test('önizleme kartı artık mini sahiplenme popup’ı AÇMAZ (talep popupun içinden gider)', () => {
  assert.ok(!previewCardsSrc.includes('CLAIM_KIND_BY_PREFIX'), 'kart tıklamasına bağlı kutu kaldırılmalı');
  assert.ok(!previewCardsSrc.includes('claimKindFor('), 'kart tıklamasına bağlı kutu kaldırılmalı');
  // MLClaimPopup kalmalı: kişi/firma/marka EKLE formlarındaki "zaten kayıtlı" uyarısı onu kullanıyor.
  assert.ok(previewCardsSrc.includes('window.MLClaimPopup'), 'duplicate-name-check.js hâlâ bu kutuyu açıyor');
  assert.ok(previewCardsSrc.includes('function openClaimPopup(opts)'));
});

await test('ModalShell.setPreviewBlur var, dışa açık ve kapanışta sıfırlanıyor', () => {
  assert.ok(modalShellSrc.includes('function setPreviewBlur(on)'));
  assert.ok(/return \{[^}]*setPreviewBlur[^}]*\};/.test(modalShellSrc), 'setPreviewBlur dışa açılmalı');
  assert.ok(/function close\(\) \{[\s\S]{0,400}?setPreviewBlur\(false\);/.test(modalShellSrc), 'close() bluru temizlemeli');
  assert.ok(modalShellSrc.includes(".classList.remove('preview-blur')"), 'claimContent() bluru temizlemeli');
  assert.ok(modalShellSrc.includes('.modal-shell-overlay.preview-blur .modal-shell-body img'),
    'blur CSS kuralı popup gövdesindeki görselleri kapsamalı');
});

await test('kişi ve firma popupları preview bayrağını ModalShell’e geçiriyor', () => {
  for (const [name, src] of [['architect-modal', architectModalSrc], ['office-modal', officeModalSrc]]) {
    assert.ok(src.includes('ModalShell.setPreviewBlur(!!payload.preview);'), `${name}: renderItem bayrağı yazmalı`);
    assert.ok(src.includes('ModalShell.setPreviewBlur(false);'), `${name}: renderNotFound bluru temizlemeli`);
  }
});

section('madde 1 — "Bu profil sana mı ait?" kutusu hiç görünmemeli (flash yok)');

await test('claim kutusu şablonda display:none ile başlıyor', () => {
  for (const [name, src] of [['architect-modal', architectModalSrc], ['office-modal', officeModalSrc]]) {
    assert.ok(src.includes('id="claim-info-card" style="display:none;"'), `${name}: şablon kutuyu gizli mount etmeli`);
  }
});

await test('loadClaimCard kutuyu önce GİZLER, yalnızca gösterilecek dallarda açar', () => {
  assert.ok(!claimBoxSrc.includes("card.style.display = '';\n    if(config.ready)"),
    'koşulsuz "göster" satırı kalmamalı — flash’ın kök nedeni oydu');
  assert.ok(/card\.style\.display = 'none';\s*\n\s*if\(config\.ready\) await config\.ready;/.test(claimBoxSrc),
    'kutu varsayılan olarak gizlenmeli');
  // Üç "göster" dalı: giriş daveti, bekleyen talep, talep formu.
  const shows = (claimBoxSrc.match(/card\.style\.display = '';/g) || []).length;
  assert.equal(shows, 3, `3 göster dalı bekleniyordu, ${shows} bulundu`);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(`  - ${f.name}: ${f.message}`); process.exit(1); }
