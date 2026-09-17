#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-18 (BEŞİNCİ tur): "Fotoğraf sayfası için Künye fallbackini neden
// kaldırdın? Fotoğraf sayfasındaki arama filtreleri için en doğru ve en çok sonuç için gereken en
// iyi sistemi kur."
//
// ÖLÇÜLEN DURUM: canlıda 11.058 görselin yalnızca 275'i etiketliydi ("Tuvalet & Banyo": 3 sonuç) ve
// o etiketler de güvenilmezdi (v1 promptu dış cephe karelerini "Resepsiyon" yapıyordu). Bu dosya
// yeni sistemin ÜÇ sinyalini ve tek sıralamasını kelepçeler:
//   1. CLIP sıfır-atış ipucu — JS uygulaması Python/float referansını yeniden üretiyor mu,
//   2. vision-LLM etiketi v2 — sahne tutarlılığı, çeldiriciler, v1 girdilerinin "bakılmadı" sayılması,
//   3. künye ön bilgisi — TEK BAŞINA ASLA sonuç üretmez,
//   ve kademeli sıralama + havuzun CLIP ipuçlarını kalıcı önbellekle iliştirmesi + paralel betik.
// Havuz testleri GERÇEK SQLite + gerçek paketlenmiş görsel dizini (sahte KV üzerinde) ile koşar.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

globalThis.caches = {
  default: { async match() {}, async put() {}, async delete() { return false; } },
  async open() { return this.default; },
};

import {
  clipClassProbs, clipHintFromProbs, clipHintForRow, clipProbOf, clipIsDrawing, clipVerdict, canonicalImageKey,
  CLIP_STRONG_MIN, CLIP_KUNYE_MIN, CLIP_AGREE_MIN, CLIP_DRAWING_MIN, CLIP_PROMPT_SOURCE_SHA, CLIP_PROMPT_CLASSES,
} from '../src/lib/photoSpaceClip.js';
import { normalizeSpaces, reconcileScene, classifyPhotoSpace, storedSpaceEntry, SPACE_LABEL_VERSION } from '../src/lib/photoSpaceClassify.js';
import { normalizeStoredSpaces, kunyeSpacesFor, fetchPhotoPool, clipHintCacheKey, CLIP_SCORE_PER_BUILD } from '../src/lib/photoPool.js';
import { spaceTier, selectPhotos, handlePhotosRoute, TIER_COUNT } from '../src/routes/photos.js';
import { packImageIndex, imageIndexKvKey, IMAGE_EMBED_DIM, IMAGE_EMBED_MODEL } from '../src/lib/imageEmbedIndex.js';
import { resetImageIndexMemCache } from '../src/lib/imageEmbedStore.js';
import photoSpaceTaxonomyJs from '../photo-space-taxonomy.js';

const { PHOTO_SPACE_OPTIONS, PHOTO_SPACE_LABELS, PHOTO_SPACE_DISTRACTOR_LABELS, PHOTO_SPACE_AI_LABELS, PHOTO_SPACE_TAXONOMY } = photoSpaceTaxonomyJs;

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const FIXTURE = JSON.parse(read('./photo-space-clip-fixture.json')).items;
// Buffer.from(base64) küçük boyutlarda Node'un PAYLAŞIMLI havuzundan yer alır: `.buffer` tüm havuzdur,
// byteOffset hesaba katılmazsa başka bir tamponun baytları okunur.
const rowOf = (f) => { const b = Buffer.from(f.q, 'base64'); return new Int8Array(b.buffer.slice(b.byteOffset, b.byteOffset + IMAGE_EMBED_DIM)); };
const fx = (label, n = 0) => FIXTURE.filter(f => f.expectTop === label)[n];

// ---------------------------------------------------------------------------------------------
section('1 — CLIP sıfır-atış ipucu (görsel başına, anlık sinyal)');

await test('JS puanlaması Python/float referansını yeniden üretir (28 canlı görsel, 14 sınıf)', () => {
  assert.ok(FIXTURE.length >= 24);
  for (const f of FIXTURE) {
    const probs = clipClassProbs(rowOf(f));
    let top = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[top]) top = i;
    assert.equal(CLIP_PROMPT_CLASSES[top], f.expectTop, f.url);
    // Görsel tarafı int8 nicemli (dizin biçimi): ölçülen sapma ortalama 0,014, p99 ~0,06.
    assert.ok(Math.abs(probs[top] - f.expectP) < 0.1, `${f.url}: ${probs[top]} vs ${f.expectP}`);
    const sum = probs.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, 'sınıf olasılıkları 1\'e toplanır');
  }
});

await test('üretilmiş vektör modülü kaynak sınıf dosyasıyla AYNI özetten (elle düzenleme/unutulmuş yeniden üretim yakalanır)', () => {
  const sha = createHash('sha256').update(readFileSync(new URL('./photo-space-clip-classes.json', import.meta.url))).digest('hex').slice(0, 16);
  assert.equal(CLIP_PROMPT_SOURCE_SHA, sha, 'scripts/build-photo-space-clip-prompts.py yeniden koşturulmalı');
  const cfg = JSON.parse(read('./photo-space-clip-classes.json'));
  assert.deepEqual(Object.keys(cfg.classes), CLIP_PROMPT_CLASSES);
});

await test('CLIP sınıfları: 12 aranabilir mekanın ADI taksonomiyle birebir; gerisi "_" ile başlayan çeldirici', () => {
  const searchable = CLIP_PROMPT_CLASSES.filter(c => !c.startsWith('_'));
  assert.deepEqual(searchable, PHOTO_SPACE_OPTIONS);
  assert.ok(CLIP_PROMPT_CLASSES.includes('_drawing') && CLIP_PROMPT_CLASSES.includes('_exterior'));
  assert.ok(CLIP_PROMPT_CLASSES.filter(c => c.startsWith('_')).length >= 12, 'zengin çeldirici kümesi isabetin kaynağı');
});

await test('eşikler: her aranabilir mekan için GÜÇLÜ eşik var; künye eşiği yalnızca ölçümün desteklediği sınıfta', () => {
  for (const l of PHOTO_SPACE_OPTIONS) {
    assert.ok(CLIP_STRONG_MIN[l] >= 0.35 && CLIP_STRONG_MIN[l] <= 0.9, l);
  }
  assert.deepEqual(Object.keys(CLIP_KUNYE_MIN), ['Çalışma Odası'], 'künye yalnızca %78 isabet ölçülen sınıfta');
  assert.ok(CLIP_KUNYE_MIN['Çalışma Odası'] < CLIP_STRONG_MIN['Çalışma Odası']);
  assert.ok(CLIP_DRAWING_MIN >= 0.5 && CLIP_AGREE_MIN < 0.5);
});

await test('ipucu kompakt: aranabilir etiketler + çizim olasılığı; çeldirici ipucuna GİRMEZ', () => {
  const bath = clipHintForRow(rowOf(fx('Tuvalet & Banyo')));
  assert.equal(bath.t, 'Tuvalet & Banyo');
  assert.ok(clipProbOf(bath, 'Tuvalet & Banyo') > 0.9);
  assert.equal(clipProbOf(bath, 'Mutfak'), 0);
  const drawing = clipHintForRow(rowOf(fx('_drawing')));
  assert.equal(drawing.t, '_drawing'); assert.ok(clipIsDrawing(drawing)); assert.equal(drawing.s, undefined);
  const ext = clipHintForRow(rowOf(fx('_exterior')));
  assert.equal(ext.t, '_exterior'); assert.ok(!clipIsDrawing(ext));
  assert.ok(!(ext.s || []).some(e => e[0].startsWith('_')));
  assert.equal(clipHintFromProbs(new Float64Array(CLIP_PROMPT_CLASSES.length)).s, undefined);
});

await test('clipVerdict: güçlü = en olası sınıf + sınıfın eşiği; künye yalnızca tanımlı sınıfta ve CLIP kanıtıyla', () => {
  assert.equal(clipVerdict({ t: 'Mutfak', s: [['Mutfak', 0.7]] }, 'Mutfak', false), 'strong');
  assert.equal(clipVerdict({ t: 'Mutfak', s: [['Mutfak', 0.5]] }, 'Mutfak', true), null, 'Mutfak\'ta künye sonuç ÜRETMEZ (ölçüm: %40)');
  assert.equal(clipVerdict({ t: 'Oturma Odası', s: [['Oturma Odası', 0.5], ['Mutfak', 0.45]] }, 'Mutfak', true), null, 'en olası sınıf değil');
  assert.equal(clipVerdict({ t: 'Çalışma Odası', s: [['Çalışma Odası', 0.3]] }, 'Çalışma Odası', true), 'kunye');
  assert.equal(clipVerdict({ t: 'Çalışma Odası', s: [['Çalışma Odası', 0.3]] }, 'Çalışma Odası', false), null);
  assert.equal(clipVerdict(null, 'Çalışma Odası', true), null, 'KÜNYE TEK BAŞINA ASLA sonuç üretmez');
  assert.equal(clipVerdict({ t: '_exterior' }, 'Çalışma Odası', true), null);
});

await test('dizin anahtarı <-> havuz URL\'si: mutlak adres, "/media/.." ve çıplak yol AYNI anahtara iner', () => {
  assert.equal(canonicalImageKey('https://mimarlab.com/projects/x-1.webp'), 'projects/x-1.webp');
  assert.equal(canonicalImageKey('projects/x-1.webp'), 'projects/x-1.webp');
  assert.equal(canonicalImageKey('/media/u/a/b.webp'), 'media/u/a/b.webp');
  assert.equal(canonicalImageKey('https://www.mimarlab.com/media/u/a/b.webp?v=3'), 'media/u/a/b.webp');
});

// ---------------------------------------------------------------------------------------------
section('2 — vision-LLM etiketi v2 (sahne + çeldiriciler)');

await test('taksonomi: kullanıcının 15\'lik listesi DEĞİŞMEDİ; çeldiriciler AYRI ve yalnızca AI whitelist\'inde', () => {
  assert.equal(PHOTO_SPACE_LABELS.length, 15);
  assert.ok(PHOTO_SPACE_DISTRACTOR_LABELS.includes('Dış Cephe') && PHOTO_SPACE_DISTRACTOR_LABELS.includes('Genel İç Mekan'));
  for (const d of PHOTO_SPACE_DISTRACTOR_LABELS) assert.ok(!PHOTO_SPACE_LABELS.includes(d), d);
  assert.deepEqual(PHOTO_SPACE_AI_LABELS, [...PHOTO_SPACE_LABELS, ...PHOTO_SPACE_DISTRACTOR_LABELS]);
  // Arama kutusu PHOTO_SPACE_TAXONOMY'yi çiziyor: çeldiriciler O DİZİDE OLMAMALI.
  assert.ok(!PHOTO_SPACE_TAXONOMY.some(t => PHOTO_SPACE_DISTRACTOR_LABELS.includes(t.label)));
});

await test('prompt: sahne adımı + çeldirici listesi + en fazla 2 etiket', () => {
  const s = read('../src/lib/photoSpaceClassify.js');
  assert.match(s, /ADIM 1 — "scene"/); assert.match(s, /"dis_cephe"/); assert.match(s, /ZORLA UYDURMA/);
  assert.match(s, /const MAX_SPACES = 2;/);
  assert.match(s, /\$\{DISTRACTOR_DEFS\}/);
});

await test('normalizeSpaces: çeldirici KORUNUR (sıra bilgisi), uydurma etiket düşer, en fazla 2', () => {
  assert.deepEqual(normalizeSpaces({ spaces: [{ label: 'Dış Cephe', confidence: 0.9 }, { label: 'Bahçe', confidence: 0.6 }, { label: 'Havuz', confidence: 0.6 }] }),
    [{ label: 'Dış Cephe', confidence: 0.9 }, { label: 'Bahçe', confidence: 0.6 }]);
  assert.deepEqual(normalizeSpaces({ spaces: [{ label: 'Sinema Salonu', confidence: 0.9 }] }), []);
});

await test('SAHNE KAZANIR: dış cephe/detay karesinde aranabilir etiket tutulmaz; çizim sahnesi sayfadan dışlanacak etiketi garanti eder', () => {
  const facade = reconcileScene('dis_cephe', [{ label: 'Resepsiyon', confidence: 0.8 }, { label: 'Dış Cephe', confidence: 0.9 }]);
  assert.deepEqual(facade, { scene: 'dis_cephe', spaces: [{ label: 'Dış Cephe', confidence: 0.9 }] });
  assert.deepEqual(reconcileScene('detay', [{ label: 'Mutfak', confidence: 0.9 }]).spaces, []);
  assert.deepEqual(reconcileScene('cizim', [{ label: 'Mutfak', confidence: 0.9 }]).spaces, [{ label: 'Cephe Çizimi', confidence: null }]);
  assert.deepEqual(reconcileScene('cizim', [{ label: 'Plan Çizimi', confidence: 0.9 }]).spaces, [{ label: 'Plan Çizimi', confidence: 0.9 }]);
  assert.deepEqual(reconcileScene('ic_mekan', [{ label: 'Mutfak', confidence: 0.9 }, { label: 'Kesit Çizimi', confidence: 0.5 }]).spaces, [{ label: 'Mutfak', confidence: 0.9 }]);
  // Bilinmeyen sahne: etiketlere dokunulmaz (eski çıktı biçimi).
  assert.deepEqual(reconcileScene('uydurma', [{ label: 'Mutfak', confidence: 0.9 }]), { scene: null, spaces: [{ label: 'Mutfak', confidence: 0.9 }] });
});

await test('classifyPhotoSpace uçtan uca: canlıda görülen "cepheye Resepsiyon" hatası artık YAZILAMAZ', async () => {
  const env = { AI: { async run() { return { response: '{"scene":"dis_cephe","spaces":[{"label":"Resepsiyon","confidence":0.8},{"label":"Bahçe","confidence":0.7}]}' }; } } };
  const out = await classifyPhotoSpace(env, new Uint8Array([1, 2, 3]), 5000, 'image/jpeg');
  assert.equal(out.scene, 'dis_cephe'); assert.deepEqual(out.spaces, []);
  assert.deepEqual(storedSpaceEntry(out), { v: SPACE_LABEL_VERSION, scene: 'dis_cephe', spaces: [] });
});

await test('SAKLAMA v2: v1\'in düz dizisi "AI BAKMADI" sayılır; birincillik çeldirici atılmadan ÖNCE belirlenir', () => {
  assert.equal(normalizeStoredSpaces(['Resepsiyon', 'Çalışma Odası']), null, 'v1 girdisi güvenilmez -> yeniden etiketlenecek');
  assert.equal(normalizeStoredSpaces([{ label: 'Mutfak', confidence: 0.9 }]), null);
  assert.equal(normalizeStoredSpaces({ v: 1, spaces: [] }), null);
  assert.deepEqual(normalizeStoredSpaces({ v: 2, scene: 'dis_cephe', spaces: [{ label: 'Dış Cephe', confidence: 0.9 }] }), [], 'baktı, aranabilir mekan yok');
  // "Dış Cephe" birinci, "Bahçe" ikinci: Bahçe listenin ilki GİBİ görünse de birincil DEĞİLDİR.
  assert.deepEqual(normalizeStoredSpaces({ v: 2, scene: 'dis_mekan', spaces: [{ label: 'Dış Cephe', confidence: 0.9 }, { label: 'Bahçe', confidence: 0.6 }] }),
    [{ label: 'Bahçe', confidence: 0.6, primary: false }]);
});

// ---------------------------------------------------------------------------------------------
section('3 — künye ön bilgisi');

await test('kunyeSpacesFor: kelime başı + Türkçe ek serbest; kısa kök TAM kelime; sahte eşleşmeler yok', () => {
  assert.deepEqual(kunyeSpacesFor('Yenilenen banyolarında mermer kullanıldı'), ['Tuvalet & Banyo']);
  assert.deepEqual(kunyeSpacesFor('ACME Holding genel müdürlük OFİSİ'), ['Çalışma Odası'], '"hol" künye listesinde yok -> Holding koridor değil');
  assert.deepEqual(kunyeSpacesFor('İyi düşünülmüş bir cephe'), [], '"duş" kökü "düşünülmüş"ü yakalamaz');
  assert.deepEqual(kunyeSpacesFor('Konutun WC ve duş hacimleri'), ['Tuvalet & Banyo']);
  assert.deepEqual(kunyeSpacesFor('Salon Alper Derinboğaz tasarımı'), [], 'firma adındaki "Salon" oturma odası değil');
  assert.deepEqual(kunyeSpacesFor(''), []);
});

// ---------------------------------------------------------------------------------------------
section('4 — tek sıralama (kademeler)');

const hint = (label, p, top) => ({ t: top || label, s: [[label, p]] });
await test('kademe sırası: çifte onay > LLM birincil > CLIP güçlü > LLM ikincil(+CLIP) > LLM ikincil > CLIP+künye', () => {
  const S = 'Çalışma Odası';
  const proj = { kunye: [S] };
  const pool = { projects: { p: proj, q: { kunye: [] } }, items: [
    { url: 't6', projectSlug: 'p', spaces: null, clip: hint(S, 0.3) },
    { url: 't5', projectSlug: 'p', spaces: [{ label: 'Resepsiyon', confidence: 0.9, primary: true }, { label: S, confidence: 0.6, primary: false }] },
    { url: 't4', projectSlug: 'p', spaces: [{ label: 'Resepsiyon', confidence: 0.9, primary: true }, { label: S, confidence: 0.6, primary: false }], clip: hint(S, 0.4, 'Resepsiyon') },
    { url: 't3', projectSlug: 'q', spaces: null, clip: hint(S, 0.8) },
    { url: 't2', projectSlug: 'p', spaces: [{ label: S, confidence: 0.9, primary: true }] },
    { url: 't1', projectSlug: 'p', spaces: [{ label: S, confidence: 0.9, primary: true }], clip: hint(S, 0.7) },
    { url: 'no-künye-tek-başına', projectSlug: 'p', spaces: null },
    { url: 'no-zayıf-clip-künyesiz', projectSlug: 'q', spaces: null, clip: hint(S, 0.3) },
    { url: 'no-llm-hayır-dedi', projectSlug: 'p', spaces: [], clip: hint(S, 0.99) },
    { url: 'no-llm-başka-dedi', projectSlug: 'p', spaces: [{ label: 'Mutfak', confidence: 0.9, primary: true }], clip: hint(S, 0.99) },
  ] };
  assert.deepEqual(pool.items.map(it => spaceTier(it, S, pool.projects[it.projectSlug])), [6, 5, 4, 3, 2, 1, 0, 0, 0, 0]);
  assert.deepEqual(selectPhotos(pool, S).map(i => i.url), ['t1', 't2', 't3', 't4', 't5', 't6']);
  assert.equal(TIER_COUNT, 6);
});

await test('HÜKÜM LLM\'İNDİR: LLM bakıp saymadıysa CLIP ne derse desin sonuç YOK; künye tek başına sonuç YOK', () => {
  const proj = { kunye: ['Tuvalet & Banyo', 'Çalışma Odası'] };
  assert.equal(spaceTier({ spaces: [], clip: hint('Tuvalet & Banyo', 0.99) }, 'Tuvalet & Banyo', proj), 0);
  assert.equal(spaceTier({ spaces: null }, 'Tuvalet & Banyo', proj), 0, 'künyede "banyo" geçmesi görsel seçemez (kaldırılan ikincil sonuç GERİ GELMEDİ)');
  assert.equal(spaceTier({ spaces: null, clip: hint('Tuvalet & Banyo', 0.6) }, 'Tuvalet & Banyo', proj), 0, 'banyoda künye+orta CLIP de yetmez (ölçüm: %50)');
  assert.equal(spaceTier({ spaces: null, clip: hint('Tuvalet & Banyo', 0.85) }, 'Tuvalet & Banyo', { kunye: [] }), 3);
});

await test('her kademe KENDİ içinde yükleme sırasını korur', () => {
  const S = 'Havuz';
  const pool = { projects: {}, items: [
    { url: 'yeni-clip', projectSlug: 'a', spaces: null, clip: hint(S, 0.9) },
    { url: 'yeni-llm', projectSlug: 'a', spaces: [{ label: S, confidence: 0.9, primary: true }] },
    { url: 'eski-clip', projectSlug: 'b', spaces: null, clip: hint(S, 0.7) },
    { url: 'eski-llm', projectSlug: 'b', spaces: [{ label: S, confidence: 0.8, primary: true }] },
  ] };
  assert.deepEqual(selectPhotos(pool, S).map(i => i.url), ['yeni-llm', 'eski-llm', 'yeni-clip', 'eski-clip']);
});

// ---------------------------------------------------------------------------------------------
section('5 — havuz: CLIP ipuçları gerçek dizinden, kalıcı önbellekle');

function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}
function fakeKv() {
  const store = new Map();
  const log = { gets: [], puts: [] };
  return {
    store, log,
    async get(key, type) {
      log.gets.push(key);
      if (!store.has(key)) return null;
      const v = store.get(key);
      if (type === 'arrayBuffer') return v;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value, opts) { log.puts.push({ key, opts: opts || null }); store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}
function packIndex(entities) {
  // entities: [{ slug, keys: [...], rows: [Int8Array...] }]
  const total = entities.reduce((a, e) => a + e.rows.length, 0);
  const vectors = new Int8Array(total * IMAGE_EMBED_DIM);
  let off = 0;
  for (const e of entities) for (const r of e.rows) { vectors.set(r, off); off += IMAGE_EMBED_DIM; }
  return packImageIndex({ type: 'project', dim: IMAGE_EMBED_DIM, model: IMAGE_EMBED_MODEL, built: '2026-09-18T00:00:00Z',
    entities: entities.map(e => ({ s: e.slug, c: e.rows.length, k: e.keys })), vectors });
}
async function poolFixture({ extraImages = 0 } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(read('../schema.sql'));
  db.exec(read('../migrations/0079_search_fold_columns.sql'));
  // KV yazma kotası sayacının tek satırı (migrations/0043 tohumlar; schema.sql yalnızca tabloyu kurar).
  // Satır yoksa reserveKvWrite "kota doldu" der ve hiçbir KV yazımı yapılmaz.
  db.prepare(`INSERT INTO kv_usage (id, writes_count, writes_day, updated_at) VALUES ('singleton', 0, '', 0)`).run();
  // 'ofis' projesi: künyesi çalışma alanını anıyor. Görseller: banyo (CLIP güçlü, LLM bakmadı),
  // çizim (LLM bakmadı -> CLIP ile dışlanır), cephe, dizinde OLMAYAN bir görsel, LLM'in "mutfak"
  // dediği ama CLIP'in banyo dediği görsel (hüküm LLM'in), v1 etiketli görsel (bakılmadı sayılır).
  const images = ['projects/banyo.webp', '/media/u/cizim.webp', 'https://mimarlab.com/projects/cephe.webp', 'projects/dizinde-yok.webp', 'projects/llm-mutfak.webp', 'projects/v1.webp'];
  for (let i = 0; i < extraImages; i++) images.push(`projects/ek-${i}.webp`);
  db.prepare(`INSERT INTO projects (slug,title,description,type,images,image_spaces,created_at) VALUES ('ofis','ACME Ofis','Açık ofis ve toplantı odaları','["Ofis / İş Merkezi"]',?,?,'2026-09-01 10:00:00')`)
    .run(JSON.stringify(images), JSON.stringify({
      'projects/llm-mutfak.webp': { v: 2, scene: 'ic_mekan', spaces: [{ label: 'Mutfak', confidence: 0.9 }] },
      'projects/v1.webp': ['Resepsiyon', 'Çalışma Odası', 'Bahçe'],
    }));
  const kv = fakeKv();
  const bath = rowOf(fx('Tuvalet & Banyo')), drawing = rowOf(fx('_drawing')), ext = rowOf(fx('_exterior')), office = rowOf(fx('Çalışma Odası'));
  const keys = ['https://mimarlab.com/projects/banyo.webp', '/media/u/cizim.webp', 'https://mimarlab.com/projects/cephe.webp', 'https://mimarlab.com/projects/llm-mutfak.webp', 'https://mimarlab.com/projects/v1.webp'];
  const rows = [bath, drawing, ext, bath, office];
  for (let i = 0; i < extraImages; i++) { keys.push(`https://mimarlab.com/projects/ek-${i}.webp`); rows.push(ext); }
  kv.store.set(imageIndexKvKey('project'), packIndex([{ slug: 'baska-proje', keys: ['x'], rows: [ext] }, { slug: 'ofis', keys, rows }]));
  resetImageIndexMemCache();
  return { db, kv, env: { DB: d1(db), FACET_CACHE: kv } };
}

await test('havuz: ipuçları dizinden iliştirilir (üç anahtar biçimi de eşleşir), çizim ANINDA düşer, v1 etiketi yok sayılır', async () => {
  const { env } = await poolFixture();
  const pool = await fetchPhotoPool(env);
  const by = Object.fromEntries(pool.items.map(i => [i.url, i]));
  assert.ok(!by['/media/u/cizim.webp'], 'LLM bakmadan CLIP çizimi sayfadan düşürür');
  assert.equal(by['projects/banyo.webp'].clip.t, 'Tuvalet & Banyo');
  assert.equal(by['https://mimarlab.com/projects/cephe.webp'].clip.t, '_exterior');
  assert.equal(by['projects/dizinde-yok.webp'].clip, undefined);
  assert.equal(by['projects/v1.webp'].spaces, null, 'v1 girdisi "bakılmadı"');
  assert.equal(by['projects/v1.webp'].clip.t, 'Çalışma Odası');
  assert.deepEqual(by['projects/llm-mutfak.webp'].spaces, [{ label: 'Mutfak', confidence: 0.9, primary: true }]);
  assert.deepEqual(pool.projects.ofis.kunye, ['Çalışma Odası']);
  assert.equal(pool.stats.images, 5); assert.equal(pool.stats.llmLabeled, 1); assert.equal(pool.stats.clipHinted, 4);
  assert.equal(pool.stats.clipMissing, 1); assert.equal(pool.stats.clipDrawingsHidden, 1); assert.equal(pool.stats.clipPending, 0);
});

await test('uç: banyo araması CLIP-güçlü görseli getirir; LLM\'in "mutfak" dediği banyo-benzeri kare GELMEZ; çip CLIP\'ten', async () => {
  const { env } = await poolFixture();
  const url = new URL(`https://mimarlab.com/api/photos?space=${encodeURIComponent('Tuvalet & Banyo')}`);
  const data = JSON.parse(await (await handlePhotosRoute(new Request(url.href), env, url)).text());
  assert.deepEqual(data.items.map(i => i.url), ['projects/banyo.webp']);
  assert.deepEqual(data.items[0].spaces, ['Tuvalet & Banyo']);
  assert.ok(!('clip' in data.items[0]) && !('via' in data.items[0]), 'iç sinyaller yanıta sızmaz');
  const all = new URL('https://mimarlab.com/api/photos');
  const feed = JSON.parse(await (await handlePhotosRoute(new Request(all.href), env, all)).text());
  assert.equal(feed.total, 5, 'filtresiz akışta çizim yok, gerisi var');
  const ext = feed.items.find(i => i.url.endsWith('cephe.webp'));
  assert.deepEqual(ext.spaces, [], 'çeldirici sınıf çip OLMAZ');
});

await test('/api/photos/stats: kapsam + mekan başına kademe sayıları (yalnızca sayılar)', async () => {
  const { env } = await poolFixture();
  const url = new URL('https://mimarlab.com/api/photos/stats');
  const s = JSON.parse(await (await handlePhotosRoute(new Request(url.href), env, url)).text());
  assert.equal(s.images, 5); assert.equal(s.llmLabeled, 1);
  assert.deepEqual(s.spaces['Tuvalet & Banyo'], { total: 1, byTier: [0, 0, 1, 0, 0, 0] });
  assert.deepEqual(s.spaces['Mutfak'].byTier.slice(0, 2), [0, 1]);
  assert.equal(s.spaces['Çalışma Odası'].total, 1, 'v1.webp: CLIP güçlü ofis');
  assert.match(read('../src/index.js'), /path === '\/api\/photos\/stats'/);
});

await test('ipuçları KALICI önbellekte: dizin KV\'den silinse de ikinci kurulum ipuçlarını taşır; "yok" işaretli görsel dizini yeniden okutmaz', async () => {
  const { env, kv } = await poolFixture();
  await fetchPhotoPool(env);
  assert.ok(kv.store.has(clipHintCacheKey()), 'ipucu önbelleği yazıldı');
  const cached = JSON.parse(kv.store.get(clipHintCacheKey()));
  assert.equal(cached['projects/banyo.webp'].t, 'Tuvalet & Banyo');
  assert.ok(cached['projects/dizinde-yok.webp'].m != null, 'dizinde olmayan görsel "yok" işaretlenir');
  assert.ok(!('x' in cached), 'havuzda olmayan anahtar önbelleğe girmez');
  kv.store.delete(imageIndexKvKey('project')); kv.store.delete('pool:photos'); resetImageIndexMemCache();
  kv.log.gets.length = 0;
  const again = await fetchPhotoPool(env);
  assert.equal(again.items.find(i => i.url === 'projects/banyo.webp').clip.t, 'Tuvalet & Banyo');
  assert.ok(!kv.log.gets.includes(imageIndexKvKey('project')), 'eksik yoksa 14 MB\'lık dizin HİÇ okunmaz');
});

await test('CPU bütçesi: tur başına en fazla CLIP_SCORE_PER_BUILD görsel puanlanır; bitmediyse havuz 60 sn yaşar, sonraki tur tamamlar', async () => {
  const { env, kv } = await poolFixture({ extraImages: CLIP_SCORE_PER_BUILD + 40 });
  const first = await fetchPhotoPool(env);
  assert.ok(first.stats.clipPending > 0, 'ilk turda hepsi puanlanmaz');
  const put1 = kv.log.puts.filter(p => p.key === 'pool:photos').pop();
  assert.equal(put1.opts.expirationTtl, 60, 'KV alt sınırı 60 sn — altı 400 döner');
  kv.store.delete('pool:photos');
  const second = await fetchPhotoPool(env);
  assert.equal(second.stats.clipPending, 0);
  const put2 = kv.log.puts.filter(p => p.key === 'pool:photos').pop();
  assert.equal(put2.opts.expirationTtl, 1800, 'tamamlanınca olağan TTL');
});

await test('KV yoksa (yerel/test) havuz çalışmaya devam eder: ipucu yok, LLM etiketi var', async () => {
  const { db } = await poolFixture();
  const pool = await fetchPhotoPool({ DB: d1(db) });
  assert.equal(pool.stats.clipHinted, 0);
  assert.equal(pool.items.length, 6, 'CLIP yokken çizim ancak LLM etiketiyle düşer');
});

// ---------------------------------------------------------------------------------------------
section('6 — etiketleme betiği + workflow + değerlendirme kümesi');

await test('betik PARALEL, v2 olmayan her girdiyi yeniden işler, yazmadan önce kolonu YENİDEN okur', () => {
  const s = read('./photo-space-classify-backfill.mjs');
  assert.match(s, /const CONCURRENCY = Math\.min\(32, Math\.max\(1, Number\(args\.concurrency \?\? 10\)/);
  assert.match(s, /\.filter\(u => FORCE \|\| !isV2\(spacesByUrl\[u\]\)\)/, 'v1 girdisi --force gerekmeden yeniden işlenir');
  assert.match(s, /const fresh = await d1\(`SELECT images, image_spaces FROM projects WHERE id = \?`/);
  assert.match(s, /storedSpaceEntry\(result\)/);
  assert.match(s, /const where = \['deleted_at IS NULL', 'hidden_at IS NULL'\];/, 'havuzla AYNI görünürlük: blurlu projeye AI harcanmaz');
  assert.match(s, /res\.status === 429 \|\| res\.status >= 500/, 'hız sınırı/5xx yeniden denenir');
  assert.match(s, /catch \(err\) \{ lastErr = err; await sleep/, 'ağ seviyesi hata süreci çökertmez');
});

await test('değerlendirme modu HİÇBİR ŞEY yazmaz', () => {
  const s = read('./photo-space-classify-backfill.mjs');
  const evalBlock = s.slice(s.indexOf('if (EVAL) {'), s.indexOf('// ETİKETLEME MODU'));
  assert.ok(evalBlock.length > 500);
  assert.ok(!/UPDATE\s+projects/i.test(evalBlock), 'eval bloğunda UPDATE yok');
  assert.match(evalBlock, /process\.exit\(0\);/);
});

await test('workflow: zamanlanmış koşu yalnızca eksikleri YAZAR; ölçüm modu --eval çağırır', () => {
  const y = read('../.github/workflows/photo-space-classify.yml');
  assert.match(y, /schedule:\n\s+- cron: '41 2,8,14,20 \* \* \*'/);
  assert.match(y, /if \[ "\$\{GITHUB_EVENT_NAME\}" = "schedule" \]; then IN_APPLY=evet; IN_SCOPE=tumu;[^\n]*IN_FORCE=hayir; fi/);
  assert.match(y, /node scripts\/photo-space-classify-backfill\.mjs --eval/);
  assert.match(y, /concurrency:\n\s+group: mimarlab-photo-space-classify/, 'iki tur aynı satırları aynı anda yazmaz');
});

await test('gözle etiketli küme: yalnızca aranabilir etiketler, evet/hayır çakışmaz', () => {
  const gold = JSON.parse(read('./photo-space-gold.json')).items;
  assert.ok(gold.length >= 600);
  for (const g of gold) {
    assert.ok(g.url && g.slug);
    for (const l of [...g.yes, ...g.no]) assert.ok(PHOTO_SPACE_OPTIONS.includes(l), l);
    assert.ok(!g.yes.some(l => g.no.includes(l)), g.url);
  }
  assert.ok(gold.filter(g => g.scene === 'dis_cephe').length >= 60, 'dış cephe negatifleri: v1\'in asıl hata sınıfı');
});

await test('getCachedPool TTL seçeneği 60 sn\'nin altına inemez, olağan TTL\'i aşamaz', async () => {
  const { getCachedPool } = await import('../src/lib/publicCache.js');
  const kv = fakeKv();
  await getCachedPool({ FACET_CACHE: kv }, 'photos', async () => ({ a: 1 }), { ttlSeconds: () => 5 });
  assert.equal(kv.log.puts.pop().opts.expirationTtl, 60);
  kv.store.clear();
  await getCachedPool({ FACET_CACHE: kv }, 'photos', async () => ({ a: 1 }), { ttlSeconds: () => 999999 });
  assert.equal(kv.log.puts.pop().opts.expirationTtl, 1800);
  kv.store.clear();
  await getCachedPool({ FACET_CACHE: kv }, 'photos', async () => ({ a: 1 }));
  assert.equal(kv.log.puts.pop().opts.expirationTtl, 1800, 'seçenek yoksa davranış eskisi gibi');
});

console.log(`\n${failed ? 'BAŞARISIZ' : 'TAMAM'} — ${passed} geçti, ${failed} kaldı`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
