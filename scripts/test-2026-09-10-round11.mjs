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

section('withSingleFlight — takılı in-flight girdisi anahtarı sonsuza dek kilitlemez');

await test('takılı (hiç settle olmayan) girdi bayatlayınca yeni hesaplama başlar', async () => {
  const src = readFileSync(new URL('../src/lib/publicCache.js', import.meta.url), 'utf8');
  assert.ok(src.includes('const SINGLE_FLIGHT_STALE_MS'), 'bayatlık eşiği tanımlı olmalı');
  assert.ok(/existing\.startedAt\) < SINGLE_FLIGHT_STALE_MS\) return existing\.promise/.test(src));
  assert.ok(src.includes('if (inFlight.get(key) === entry) inFlight.delete(key);'), 'finally yalnızca KENDİ girdisini silmeli');
  assert.ok(src.includes('return entry.promise;'));
});

// =============================================================================================
// ON BİRİNCİ TUR, İKİNCİ PARTİ (madde 2, 5, 6, 7)
// =============================================================================================
import { findInvalidVariantsField, normalizeSubmission, parseSubmissionRow } from '../src/lib/submissionTypes.js';
import { fetchUnclaimedPhotographerSlugs } from '../src/lib/claimedProfiles.js';
import { handleProjectDetailRoute } from '../src/routes/project.js';
import vm from 'node:vm';

section('madde 2 — versiyonlar: doğrulama + normalize (submissionTypes)');

await test('alan gövdede yoksa null kalır ("dokunma"), varsa normalize edilir', () => {
  const body = { title: 'X', brand: 'Y' };
  assert.equal(findInvalidVariantsField('products', body), null);
  assert.ok(!('variants' in body));
  const row = normalizeSubmission('products', body);
  assert.equal(row.variants, null, 'nullableArrayFields: gönderilmeyen alan NULL yazılmalı');
  const parsed = parseSubmissionRow('products', { ...row, variants: null });
  assert.equal(parsed.variants, null);
});

await test('geçerli versiyon listesi kanonik biçime iner (bilinmeyen anahtarlar düşer)', () => {
  const body = { variants: [
    { label: ' Ecosol 50 · Nötral ', options: [{ label: 'Model', value: '50' }, { label: 'Renk', value: 'Nötral' }], images: ['/media/u/a.webp'], specs: [{ label: 'Kalınlık', value: '6 mm' }, { label: '', value: '' }], zzz: 1 },
    { label: 'Ecosol 62', options: [{ label: 'Model', value: '62' }], images: [], specs: [], description: 'x', sourceUrl: 'https://sisecam.com' },
  ] };
  assert.equal(findInvalidVariantsField('products', body), null);
  assert.deepEqual(body.variants[0], { label: 'Ecosol 50 · Nötral', options: [{ label: 'Model', value: '50' }, { label: 'Renk', value: 'Nötral' }], images: ['/media/u/a.webp'], specs: [{ label: 'Kalınlık', value: '6 mm' }] });
  assert.equal(body.variants[1].description, 'x');
  assert.equal(body.variants[1].sourceUrl, 'https://sisecam.com');
  const row = normalizeSubmission('products', { title: 'X', brand: 'Y', variants: body.variants });
  assert.equal(typeof row.variants, 'string');
  assert.equal(parseSubmissionRow('products', row).variants.length, 2);
  const empty = normalizeSubmission('products', { title: 'X', brand: 'Y', variants: [] });
  assert.equal(empty.variants, '[]', 'boş dizi "versiyonları kaldır" — NULL değil');
});

await test('geçersiz yapılar reddedilir', () => {
  assert.match(findInvalidVariantsField('products', { variants: 'x' }), /geçersiz/);
  assert.match(findInvalidVariantsField('products', { variants: [{ label: '' }] }), /ad/);
  assert.match(findInvalidVariantsField('products', { variants: [{ label: 'A', options: [{ label: 'Renk', value: '' }] }] }), /grup adı ve değer/);
  assert.match(findInvalidVariantsField('products', { variants: [{ label: 'A', images: ['javascript:alert(1)'] }] }), /görsel/);
  assert.equal(findInvalidVariantsField('architects', { variants: 'x' }), null, 'yalnızca ürün/malzeme');
});

section('madde 2 — product-variants.js: gruplar, en yakın versiyon, kapalı hap\'lar');

function loadVariantsApi() {
  const src = readFileSync(new URL('../js/components/product-variants.js', import.meta.url), 'utf8');
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx);
  return ctx.window.MLProductVariants;
}
const VARIANTS = [
  { label: '50 · Nötral', options: [{ label: 'Model', value: '50' }, { label: 'Renk', value: 'Nötral' }] },
  { label: '50 · Füme', options: [{ label: 'Model', value: '50' }, { label: 'Renk', value: 'Füme' }] },
  { label: 'T 21 · Füme', options: [{ label: 'Model', value: 'T 21' }, { label: 'Renk', value: 'Füme' }] },
  { label: 'T 21 · Bronz', options: [{ label: 'Model', value: 'T 21' }, { label: 'Renk', value: 'Bronz' }] },
];

await test('buildGroups: sıra korunur, tek değerli gruplar elenir', () => {
  const api = loadVariantsApi();
  const groups = api.buildGroups(VARIANTS);
  // vm bağlamının Array'i farklı realm'den — deepEqual yerine JSON karşılaştırması.
  assert.equal(JSON.stringify(groups.map(g => g.label)), JSON.stringify(['Model', 'Renk']));
  assert.equal(JSON.stringify(groups[1].values), JSON.stringify(['Nötral', 'Füme', 'Bronz']));
  const single = api.buildGroups([{ label: 'A', options: [{ label: 'Renk', value: 'X' }] }, { label: 'B', options: [{ label: 'Renk', value: 'X' }] }]);
  assert.equal(single.length, 1); assert.ok(single[0].byVariantLabel);
});

await test('availability: seçili modelde olmayan renkler KAPALI (ekteki örnek: bir modelin bir rengi yoksa)', () => {
  const api = loadVariantsApi();
  const groups = api.buildGroups(VARIANTS);
  const av = api.availability(VARIANTS, groups, 0); // 50 · Nötral seçili
  assert.deepEqual([...av.get('Renk')].sort(), ['Füme', 'Nötral'].sort(), 'Model 50 için Bronz kapalı');
  assert.deepEqual([...av.get('Model')].sort(), ['50'], 'Nötral için T 21 kapalı');
  const av2 = api.availability(VARIANTS, groups, 2); // T 21 · Füme
  assert.deepEqual([...av2.get('Renk')].sort(), ['Bronz', 'Füme'].sort());
});

await test('pickIndex: kapalı hap\'a tıklamak en yakın gerçek versiyona düşer (çıkmaz yok)', () => {
  const api = loadVariantsApi();
  const groups = api.buildGroups(VARIANTS);
  // 50 · Nötral'dayken "Bronz" (Model 50'de yok) → T 21 · Bronz (Bronz zorlanır, en yakın)
  assert.equal(api.pickIndex(VARIANTS, groups, 0, groups[1], 'Bronz'), 3);
  // 50 · Nötral'dayken "T 21" (Nötral'da yok) → T 21 · Füme ya da Bronz (ilk eşleşen, skor eşit)
  assert.equal(api.pickIndex(VARIANTS, groups, 0, groups[0], 'T 21'), 2);
  assert.equal(api.pickIndex(VARIANTS, groups, 0, groups[1], 'Yok'), -1);
});

await test('product-modal.js kapalı hap sınıfını yazıyor; form ve popup aynı modülü kullanıyor', () => {
  const pm = readFileSync(new URL('../js/components/product-modal.js', import.meta.url), 'utf8');
  assert.ok(pm.includes("btn.classList.toggle('is-off', off && !active)"));
  // Kuralın YERİ değişti (2026-09-12): ürün popup'ının CSS'i artık JS dizesinde değil,
  // css/product-detail.css'te (bkz. o dosyanın başı — popup her sayfadan açılabildiği için
  // stiller gerçek bir stil dosyasında tek kaynakta tutuluyor). Testin amacı "kapalı hap
  // GÖRSEL olarak da işaretleniyor"; kural hangi dosyada olursa olsun bu doğrulanır.
  const productCss = readFileSync(new URL('../css/product-detail.css', import.meta.url), 'utf8');
  assert.ok(productCss.includes('.pr-variant-pill.is-off{'), '.pr-variant-pill.is-off kuralı css/product-detail.css\'te olmalı');
  assert.ok(pm.includes('window.MLProductVariants'));
  const form = readFileSync(new URL('../urun-ekle.html', import.meta.url), 'utf8');
  assert.ok(form.includes('id="variants-section"'));
  assert.ok(form.includes('js/components/product-variants.js'));
  assert.ok(form.includes('if(variantsDirty){'), 'dokunulmadıysa alan gönderilmemeli');
  const lm = readFileSync(new URL('../js/components/lazy-modals.js', import.meta.url), 'utf8');
  assert.ok(lm.includes("'js/components/product-variants.js'"), 'tembel yüklenen ürün modalı da modülü almalı');
});

section('madde 7 — önizleme PROJESİ tam açılır (görseller blurlu, medya kilitli); ürün kilitli kalır');

function projectDb() {
  const db = freshDb();
  db.exec(`
    INSERT INTO projects (slug, title, images, build_status, source, hidden_at, preview_at) VALUES
      ('canli-proje', 'Canlı Proje', '["/media/a.webp"]', 'built', 'legacy_static', NULL, NULL),
      ('onizleme-proje', 'Önizleme Proje', '["/media/b.webp","/media/c.webp"]', 'built', 'legacy_static', '${NOW}', '${NOW}'),
      ('arsiv-proje', 'Arşiv Proje', '["/media/d.webp"]', 'built', 'legacy_static', '${NOW}', NULL);
  `);
  return db;
}
async function projectPayload(slug) {
  const db = projectDb();
  const url = new URL('https://mimarlab.com/api/project/' + slug);
  const res = await handleProjectDetailRoute(new Request(url), { DB: d1(db), IMG_KV: null, FACET_CACHE: null }, url, slug);
  return { status: res.status, body: await res.json() };
}

await test('ÖNİZLEME proje: 200 + item dolu + preview:true', async () => {
  const p = await projectPayload('onizleme-proje');
  assert.equal(p.status, 200, JSON.stringify(p.body).slice(0, 200));
  assert.ok(p.body.item && p.body.item.title === 'Önizleme Proje');
  assert.equal(p.body.hidden, false);
  assert.equal(p.body.preview, true);
});
await test('ARŞİV proje: 410 + item null (koruma sürüyor); canlı proje preview:false', async () => {
  const a = await projectPayload('arsiv-proje');
  assert.equal(a.status, 410); assert.equal(a.body.item, null); assert.equal(a.body.preview, false);
  const c = await projectPayload('canli-proje');
  assert.equal(c.status, 200); assert.equal(c.body.preview, false);
});

await test('istemci: /proje/ kartı açılabilir, /urun/ kilitli; proje modalı blur + kilit uyguluyor', () => {
  assert.ok(/PROFILE_PREFIXES = \['\/kisi\/', '\/firma\/', '\/marka\/', '\/proje\/'\]/.test(previewCardsSrc.includes('/proje/') ? readFileSync(new URL('../js/components/preview-cards.js', import.meta.url), 'utf8') : ''), '/proje/ açılabilir öneklere eklenmeli');
  const pm = readFileSync(new URL('../js/components/project-modal.js', import.meta.url), 'utf8');
  assert.ok(pm.includes('ModalShell.setPreviewBlur(!!item.preview);'));
  assert.ok(pm.includes('result.item.preview = true'), 'payload.preview item\'a taşınmalı');
  const pg = readFileSync(new URL('../js/components/project-gallery.js', import.meta.url), 'utf8');
  assert.ok(pg.includes('locked: !!item.preview'));
  const g = readFileSync(new URL('../js/components/gallery.js', import.meta.url), 'utf8');
  assert.ok(g.includes('if(galleryEl._pmGalleryState.locked) return;'), 'kilitli galeri lightbox açmamalı');
  assert.ok(g.includes('if(locked) return; // önizleme: işaretçi yok'));
  const prod = readFileSync(new URL('../src/routes/product.js', import.meta.url), 'utf8');
  assert.ok(prod.includes('if (row.hidden_at) return { item: null, hidden: true, preview: !!row.preview_at'), 'ürün 410 önizleme yolu DEĞİŞMEMELİ');
});

section('madde 7 — sahiplenilmemiş fotoğrafçı profil fotoğrafı bluru');

await test('fetchUnclaimedPhotographerSlugs: sahipsiz fotoğrafçı listede, sahiplenilmiş/mimar değil', async () => {
  const db = freshDb();
  const now = Date.now();
  db.exec(`
    INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1', 'a@b.c', 'x', 'Sahip Foto', 'user', ${now});
    INSERT INTO offices (id, slug, name) VALUES (1, 'foto-studyo', 'Foto Stüdyo');
    INSERT INTO architects (id, slug, name, profession) VALUES
      (1, 'sahipsiz-foto', 'Sahipsiz Foto', 'Fotoğrafçı'),
      (2, 'sahip-foto', 'Sahip Foto', 'Mimar, Fotoğrafçı'),
      (3, 'mimar', 'Mimar Kişi', 'Mimar'),
      (4, 'kurucu-foto', 'Kurucu Foto', 'Fotoğrafçı');
    INSERT INTO office_founders (office_id, architect_id) VALUES (1, 4);
    INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at) VALUES
      ('c1', 'u1', 'architect', 'Sahip Foto', 'approved', ${now}, ${now}),
      ('c2', 'u1', 'office', 'Foto Stüdyo', 'approved', ${now}, ${now});
  `);
  const slugs = await fetchUnclaimedPhotographerSlugs({ DB: d1(db) });
  assert.deepEqual(slugs, ['sahipsiz-foto']);
});

await test('architect payload photoBlur: sahipsiz fotoğrafçı true, mimar false', async () => {
  const db = freshDb();
  db.exec(`INSERT INTO architects (slug, name, profession) VALUES ('foto', 'Foto Kişi', 'Fotoğrafçı'), ('mimar', 'Mimar Kişi', 'Mimar');`);
  const { buildArchitectPayload } = await import('../src/routes/architect.js');
  assert.equal((await buildArchitectPayload({ DB: d1(db), IMG_KV: null }, 'foto')).photoBlur, true);
  assert.equal((await buildArchitectPayload({ DB: d1(db), IMG_KV: null }, 'mimar')).photoBlur, false);
  const pc = readFileSync(new URL('../js/components/preview-cards.js', import.meta.url), 'utf8');
  assert.ok(pc.includes('data.photographerBlur'), 'preview-cards /api/public/preview#photographerBlur okumalı');
  assert.ok(pc.includes(".ml-photo-blur img{"));
});

section('madde 6 — mesaj butonu sahiplenilmiş profilde de aktif');
await test('architect/office modal: rozet YOK ama claimed ise buton kalır', () => {
  for (const [name, src] of [['architect-modal', architectModalSrc], ['office-modal', officeModalSrc]]) {
    assert.ok(src.includes('if (!badges.length && !payload.claimed) { slot.innerHTML = \'\'; return; }'), name);
  }
});

section('madde 5 — kart karuseli: liste yükü çoklu görsel, kart data-images, modül');
await test('proje liste yükü ilk 4, ürün ilk 6 görseli taşıyor; kartlar data-images basıyor; modül iki sayfada da yüklü', () => {
  // 6 -> 4 YALNIZCA proje kartlarında (kullanıcı isteği, 2026-09-12 madde 2); ürün kartı 6'da kaldı.
  const pool = readFileSync(new URL('../src/lib/projectPool.js', import.meta.url), 'utf8');
  assert.ok(pool.includes('export const CARD_CAROUSEL_IMAGES = 4;'));
  assert.ok(pool.includes('p.images.slice(0, CARD_CAROUSEL_IMAGES)'));
  const prod = readFileSync(new URL('../src/routes/product.js', import.meta.url), 'utf8');
  assert.ok(prod.includes('images: (p.images || []).slice(0, 6),'));
  const pj = readFileSync(new URL('../js/pages/proje.js', import.meta.url), 'utf8');
  assert.ok(pj.includes('data-images='));
  // İstemci sabiti sunucununkiyle AYNI olmalı — yoksa kart, sunucunun gönderdiğinden farklı sayıda
  // görsel gezdirir (sessiz sapma).
  assert.ok(pj.includes('const CARD_CAROUSEL_IMAGES = 4;'));
  assert.ok(pj.includes('p.images.slice(0, CARD_CAROUSEL_IMAGES)'));
  const uh = readFileSync(new URL('../urun.html', import.meta.url), 'utf8');
  assert.ok(uh.includes('data-images=') && uh.includes('js/components/card-carousel.js'));
  assert.ok(readFileSync(new URL('../proje.html', import.meta.url), 'utf8').includes('js/components/card-carousel.js'));
  const cc = readFileSync(new URL('../js/components/card-carousel.js', import.meta.url), 'utf8');
  assert.ok(cc.includes("document.addEventListener('click', function (e) {") && cc.includes('}, true);'), 'oklar capture fazında durdurulmalı');
  const pcv = readFileSync(new URL('../src/lib/publicCache.js', import.meta.url), 'utf8');
  // Sürüm SAYI olarak karşılaştırılır: eski /v3[1-9]/ deseni v40'ta sessizce başarısız oluyordu
  // (2026-09-12'de gerçekten oldu) — kastedilen "en az v31", "v31..v39" değil.
  const apiVersion = Number((pcv.match(/const API_PAYLOAD_VERSION = 'v(\d+)';/) || [])[1]);
  assert.ok(apiVersion >= 31, `liste şekli değişti — sürüm bump (şu an v${apiVersion})`);
});

section('madde 4 — lightbox sağ altında fotoğrafçı adı');
await test('gallery.js kredi etiketi + project-gallery kredi kaynağı', () => {
  const g = readFileSync(new URL('../js/components/gallery.js', import.meta.url), 'utf8');
  assert.ok(g.includes(".lightbox-credit{") && g.includes("creditEl.textContent = credit ? `© ${credit}` : '';"));
  const pg = readFileSync(new URL('../js/components/project-gallery.js', import.meta.url), 'utf8');
  assert.ok(pg.includes('credit: photographerCredit(item)') && pg.includes('item.photoCredit && item.photoCredit.text'));
});

// =============================================================================================
// 2026-09-11 — SUNUCU TARAFI BLUR (gated görseller)
// =============================================================================================
import { normalizeImageKey, keyForRequestPath, blurDerivativeKey, fetchGatedImageKeys, serveGatedMedia, _resetGatedMediaMemo } from '../src/lib/gatedMedia.js';
import { fetchUnclaimedPhotographers } from '../src/lib/claimedProfiles.js';

section('gated görseller — anahtar normalizasyonu (betikle birebir)');
await test('normalizeImageKey: göreli/mutlak/media/statik biçimler tek anahtara iner', () => {
  assert.equal(normalizeImageKey('/media/u/a/b.webp'), 'r2:u/a/b.webp');
  assert.equal(normalizeImageKey('https://mimarlab.com/media/projects/x.webp'), 'r2:projects/x.webp');
  assert.equal(normalizeImageKey('miras/beyti-restaurant-1.webp'), 's:miras/beyti-restaurant-1.webp');
  assert.equal(normalizeImageKey('/projects/y.jpg'), 's:projects/y.jpg');
  assert.equal(normalizeImageKey('https://dis.site/x.jpg'), null);
  assert.equal(normalizeImageKey('data:image/png;base64,AAA'), null);
  assert.equal(normalizeImageKey(''), null);
});
await test('keyForRequestPath: /media, türev basamağı ve statik yol aynı anahtara çözülür; blur türevi ve sayfalar gated değil', () => {
  assert.equal(keyForRequestPath('/media/u/a/b.webp'), 'r2:u/a/b.webp');
  assert.equal(keyForRequestPath('/media/_derived/w800/r2/u/a/b.webp'), 'r2:u/a/b.webp');
  assert.equal(keyForRequestPath('/media/_derived/w400/s/miras/beyti-restaurant-1.webp'), 's:miras/beyti-restaurant-1.webp');
  assert.equal(keyForRequestPath('/miras/beyti-restaurant-1.webp'), 's:miras/beyti-restaurant-1.webp');
  assert.equal(keyForRequestPath('/media/_derived/blur/s/miras/x.webp.webp'), null);
  assert.equal(keyForRequestPath('/proje/galataport'), null);
  assert.equal(keyForRequestPath('/js/components/gallery.js'), null);
  assert.equal(blurDerivativeKey('s:miras/x.webp'), '_derived/blur/s/miras/x.webp.webp');
  assert.equal(blurDerivativeKey('r2:u/a.webp'), '_derived/blur/r2/u/a.webp.webp');
});

section('gated görseller — küme + servis kararı');
function gatedDb() {
  const db = freshDb();
  const now = Date.now();
  db.exec(`
    INSERT INTO projects (slug, title, images, build_status, source, hidden_at, preview_at) VALUES
      ('onizleme', 'Önizleme', '["/media/u/p1.webp","miras/p2.webp"]', 'built', 'legacy_static', '${NOW}', '${NOW}'),
      ('canli', 'Canlı', '["/media/u/c1.webp"]', 'built', 'legacy_static', NULL, NULL),
      ('arsiv', 'Arşiv', '["/media/u/a1.webp"]', 'built', 'legacy_static', '${NOW}', NULL);
    INSERT INTO products (slug, title, kind, images, variants, hidden_at, preview_at) VALUES
      ('u1', 'Ürün', 'product', '["/media/u/pr1.webp"]', '[{"label":"v","images":["/media/u/pv1.webp"]}]', '${NOW}', '${NOW}');
    INSERT INTO offices (slug, name, logo_url, cover_url, hidden_at, preview_at) VALUES ('f1', 'Firma', 'logos/f1.png', '/media/u/cover.webp', '${NOW}', '${NOW}');
    INSERT INTO architects (slug, name, photo_url, profession, hidden_at, preview_at) VALUES
      ('k1', 'Kişi', '/media/u/k1.webp', 'Mimar', '${NOW}', '${NOW}'),
      ('foto', 'Foto Kişi', 'mimarlar/foto.jpg', 'Fotoğrafçı', NULL, NULL),
      ('mimar', 'Mimar Kişi', 'mimarlar/mimar.jpg', 'Mimar', NULL, NULL);
  `);
  return db;
}
await test('fetchGatedImageKeys: önizleme proje/ürün(+versiyon)/firma/kişi + sahipsiz fotoğrafçı; canlı ve arşiv DEĞİL', async () => {
  const set = await fetchGatedImageKeys({ DB: d1(gatedDb()) }, fetchUnclaimedPhotographers);
  for (const k of ['r2:u/p1.webp', 's:miras/p2.webp', 'r2:u/pr1.webp', 'r2:u/pv1.webp', 's:logos/f1.png', 'r2:u/cover.webp', 'r2:u/k1.webp', 's:mimarlar/foto.jpg']) assert.ok(set.has(k), k);
  assert.ok(!set.has('r2:u/c1.webp'), 'canlı proje gated olmamalı');
  assert.ok(!set.has('r2:u/a1.webp'), 'tam arşiv zaten 410 — gated kümede gereksiz');
  assert.ok(!set.has('s:mimarlar/mimar.jpg'), 'sahipsiz mimar fotoğrafı gated değil');
});
function envFor(db, blurKeys) {
  return {
    DB: d1(db),
    UPLOADS: { async get(key) { return blurKeys.has(key) ? { body: 'BLUR', size: 4 } : null; } },
  };
}
await test('serveGatedMedia: gated istekte blur türevi (no-store), türev yoksa placeholder, gated değilse null', async () => {
  _resetGatedMediaMemo();
  const env = envFor(gatedDb(), new Set(['_derived/blur/r2/u/p1.webp.webp']));
  const deps = { fetchUnclaimedPhotographers };
  const req = (p, m = 'GET') => new Request('https://mimarlab.com' + p, { method: m });
  const r1 = await serveGatedMedia(req('/media/_derived/w800/r2/u/p1.webp'), env, new URL('https://mimarlab.com/media/_derived/w800/r2/u/p1.webp'), deps);
  assert.ok(r1 && r1.status === 200 && r1.headers.get('Content-Type') === 'image/webp' && r1.headers.get('Cache-Control') === 'private, no-store' && r1.headers.get('X-ML-Gated') === '1');
  const r2 = await serveGatedMedia(req('/miras/p2.webp'), env, new URL('https://mimarlab.com/miras/p2.webp'), deps);
  assert.ok(r2 && r2.headers.get('Content-Type') === 'image/svg+xml', 'türev yok → placeholder, ASLA net dosya');
  const r3 = await serveGatedMedia(req('/media/u/c1.webp'), env, new URL('https://mimarlab.com/media/u/c1.webp'), deps);
  assert.equal(r3, null, 'canlı proje görseli normal yola düşer');
  const r4 = await serveGatedMedia(req('/mimarlar/foto.jpg', 'HEAD'), env, new URL('https://mimarlab.com/mimarlar/foto.jpg'), deps);
  assert.ok(r4 && r4.status === 200 && r4.body === null, 'HEAD gövdesiz');
  const r5 = await serveGatedMedia(req('/media/u/p1.webp', 'POST'), env, new URL('https://mimarlab.com/media/u/p1.webp'), deps);
  assert.equal(r5, null);
  _resetGatedMediaMemo();
});
await test('sahiplenince küme değişir (memo sıfırlanınca net dosya döner)', async () => {
  _resetGatedMediaMemo();
  const db = gatedDb();
  const env = envFor(db, new Set());
  const deps = { fetchUnclaimedPhotographers };
  const url = new URL('https://mimarlab.com/media/u/k1.webp');
  assert.ok(await serveGatedMedia(new Request(url), env, url, deps), 'önce gated');
  db.exec(`UPDATE architects SET hidden_at = NULL, preview_at = NULL WHERE slug = 'k1'`); // yayına alındı
  _resetGatedMediaMemo(); // invalidatePublicCache'in yaptığı
  assert.equal(await serveGatedMedia(new Request(url), env, url, deps), null, 'yayına alınınca net dosya');
  _resetGatedMediaMemo();
});
await test('kablolama: index.js gated kontrolü /media ve statik dallardan ÖNCE; ingest dblur; istemci dblur', () => {
  const idx = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.ok(idx.includes('await serveGatedMedia(request, env, url, { fetchUnclaimedPhotographers })'));
  assert.ok(idx.indexOf('serveGatedMedia(request') < idx.indexOf("response = await handleMediaRoute(request, env, url, ctx);"));
  const pc = readFileSync(new URL('../src/lib/publicCache.js', import.meta.url), 'utf8');
  // (env) — sürüm damgasını D1'e yazar (bkz. gatedMedia.js#SÜRÜM DAMGASI, 2026-09-11).
  assert.ok(pc.includes('await invalidateGatedMediaCache(env);'));
  const di = readFileSync(new URL('../src/lib/derivativeIngest.js', import.meta.url), 'utf8');
  assert.ok(di.includes("form.get('dblur')") && di.includes('_derived/blur/r2/${originalKey}.webp'));
  const iu = readFileSync(new URL('../image-upload.js', import.meta.url), 'utf8');
  assert.ok(iu.includes("form.append('dblur'"));
});

// =============================================================================================
// 2026-09-11 — sağlık taraması + çoklu kategori + firma popup önizlemeleri
// =============================================================================================
import { splitCategories } from '../src/routes/product.js';
section('çoklu kategori (products.category " · ")');
await test('splitCategories: tek/çoklu/boş', () => {
  assert.deepEqual(splitCategories('Cam'), ['Cam']);
  assert.deepEqual(splitCategories('Cam · Vitrifiye · '), ['Cam', 'Vitrifiye']);
  assert.deepEqual(splitCategories(null), []);
  const src = readFileSync(new URL('../src/routes/product.js', import.meta.url), 'utf8');
  assert.ok(src.includes("!(p.groups || [p.group]).includes(groupParam)") && src.includes("!(p.categories || [p.category]).includes(categoryParam)"), 'filtre çoklu kategoriyi tanımalı');
  const form = readFileSync(new URL('../urun-ekle.html', import.meta.url), 'utf8');
  assert.ok(form.includes("category: [...selectedCategories].join(' · ')") && form.includes('id="u-category-pills"'));
});
section('firma/marka popup: önizleme proje/ürünleri dahil');
await test('buildOfficePayload önizleme projelerini ve ürünlerini de döner (preview bayrağıyla)', async () => {
  const db = freshDb();
  db.exec(`
    INSERT INTO offices (id, slug, name, cats) VALUES (1, 'f1', 'Firma Bir', '["Mimarlık"]');
    INSERT INTO projects (id, slug, title, images, build_status, source, hidden_at, preview_at) VALUES
      (1, 'p-canli', 'Canlı P', '[]', 'built', 'legacy_static', NULL, NULL),
      (2, 'p-oniz', 'Önizleme P', '[]', 'built', 'legacy_static', '${NOW}', '${NOW}'),
      (3, 'p-arsiv', 'Arşiv P', '[]', 'built', 'legacy_static', '${NOW}', NULL);
    INSERT INTO project_designers (project_id, office_id) VALUES (1, 1), (2, 1), (3, 1);
    INSERT INTO products (slug, title, kind, brand_office_id, images, hidden_at, preview_at) VALUES
      ('u-canli', 'Canlı Ü', 'product', 1, '[]', NULL, NULL),
      ('u-oniz', 'Önizleme Ü', 'product', 1, '[]', '${NOW}', '${NOW}'),
      ('u-arsiv', 'Arşiv Ü', 'product', 1, '[]', '${NOW}', NULL);
  `);
  const { buildOfficePayload } = await import('../src/routes/office.js');
  const p = await buildOfficePayload({ DB: d1(db), IMG_KV: null }, 'f1');
  const pslugs = p.relatedProjects.map(x => x.slug);
  assert.ok(pslugs.includes('p-canli') && pslugs.includes('p-oniz') && !pslugs.includes('p-arsiv'), JSON.stringify(pslugs));
  assert.equal(pslugs[pslugs.length - 1], 'p-oniz', 'önizleme en sonda');
  // preview bayrağı kartta gerekmez: preview-cards.js kartı href üzerinden işaretler, gatedMedia görseli sunucuda bulanıklaştırır.
  const uslugs = p.relatedProducts.map(x => x.slug);
  assert.ok(uslugs.includes('u-canli') && uslugs.includes('u-oniz') && !uslugs.includes('u-arsiv'), JSON.stringify(uslugs));
});
section('SSR künyesi arşivlenmiş firmaya link vermez');
await test('findProjectRow: arşivlenmiş firma/kişi slug\'ı "-" (linksiz), önizleme ve canlı linkli', async () => {
  const db = freshDb();
  db.exec(`
    INSERT INTO offices (id, slug, name, hidden_at, preview_at) VALUES (1, 'canli-f', 'Canlı F', NULL, NULL), (2, 'arsiv-f', 'Arşiv F', '${NOW}', NULL), (3, 'oniz-f', 'Öniz F', '${NOW}', '${NOW}');
    INSERT INTO projects (id, slug, title, images, build_status, source) VALUES (1, 'px', 'PX', '[]', 'built', 'legacy_static');
    INSERT INTO project_designers (project_id, office_id) VALUES (1, 1), (1, 2), (1, 3);
  `);
  const seo = await import('../src/lib/seo.js');
  const meta = await seo.buildMeta('project', 'px', { DB: d1(db) });
  const html = (meta && (meta.bodyHtml || meta.ssrBody || JSON.stringify(meta))) || '';
  assert.ok(html.includes('/firma/canli-f'), 'canlı firma linkli');
  assert.ok(html.includes('/firma/oniz-f'), 'önizleme firma linkli (açılabiliyor)');
  assert.ok(!html.includes('/firma/arsiv-f'), 'arşiv firma LİNKSİZ');
  assert.ok(html.includes('Arşiv F'), 'ama adı künyede kalır');
});
section('anonim 401 temizliği (ml-auth meta)');
await test('index.js oturum ipucu metası; auth-nav/badge-shared ipucu 0 iken istek atmaz', () => {
  const idx = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.ok(idx.includes('<meta name="ml-auth" content="${hasSessionCookie ? \'1\' : \'0\'}">'));
  assert.ok(/mimarlab_session=/.test(idx));
  const an = readFileSync(new URL('../auth-nav.js', import.meta.url), 'utf8');
  assert.ok(an.includes("if (!hasSessionHint()) return Promise.resolve({ user: null });"));
  const bs = readFileSync(new URL('../badge-shared.js', import.meta.url), 'utf8');
  assert.ok(bs.includes("meta[name=\"ml-auth\"]"));
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(`  - ${f.name}: ${f.message}`); process.exit(1); }
