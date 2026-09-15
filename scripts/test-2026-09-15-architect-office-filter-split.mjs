#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-15 (ikinci tur): "Proje sayfasındaki filtrelerde mimar kısmında sadece
// mimar künyesindeki isimler yer alacak. Firma kısmında ise sadece mimarlık firması künyesindeki
// isimler yer alacak. Şu an filtrelerde firma isimleri mimar kısmına karışmış gözüküyor."
//
// KÖK NEDEN (bkz. src/lib/projectPool.js#officeNamesInDesignerBox): aynı günün BİRİNCİ turunda
// künyeye yazıldığı hâliyle ham adlar filtrelere dahil edildi; bu, iki ad kümesini birden Mimar
// filtresinde görünür yaptı — (1) 0030 öncesi TEK kutulu gönderilerde mimar+firma adları
// `project_submissions.designer` içinde birlikte duruyor, (2) firma adı Mimar kutusuna yazıldığında
// resolveArchitectLink `architects`te eşleşme bulamadığı için ad yalnızca ham Mimar listesine düşüyor.
//
// Bu dosya ayrımın sözleşmesini kilitler: karar sırası (a) project_designers'ta mimar olarak bağlı
// -> kesin mimar, (b) sitede `offices` kaydı var -> kesin firma, (c) yalnızca eski BİRLEŞİK kutuda
// isOfficeName() sezgisi.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shapeProjectItem, buildFilterGroups, DESIGNER_SEP } from '../src/lib/projectPool.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(title) { console.log(`\n${title}`); }
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const SEP = DESIGNER_SEP;
const GROUPS = buildFilterGroups(new Map());
const mimar = (item) => GROUPS.find(g => g.key === 'designer').field(item);
const firma = (item) => GROUPS.find(g => g.key === 'designerOffice').field(item);
// Sitede kayıtlı firma adları (foldTr'lı) — canlıda fetchOfficeNameFolds üretir.
const OFFICES = new Set(['kayitli mimarlik', 'birim design']);

section('firma adı MİMAR kutusuna yazılmışsa Mimar filtresine düşmez');

test('sitede kaydı olan firma adı Firma tarafına geçer', () => {
  const row = {
    slug: 'a', title: 'A', images: '[]',
    // Firma `architects` tablosunda olmadığı için project_designers'a hiç yazılamadı:
    designer_names: 'Nevzat Sayın', office_names: null,
    designer_names_raw: JSON.stringify(['Nevzat Sayın', 'Kayıtlı Mimarlık']),
    office_names_raw: JSON.stringify([]),
  };
  const item = shapeProjectItem(row, { coverOnly: true, officeNameFolds: OFFICES });
  // Künyenin TAMAMI `designer`da kalır (arama/altyazı onu okur), ayrım filtrede yapılır.
  assert.deepEqual(item.designer, ['Nevzat Sayın', 'Kayıtlı Mimarlık']);
  assert.deepEqual(mimar(item), ['Nevzat Sayın']);
  assert.deepEqual(firma(item), ['Kayıtlı Mimarlık']);
});

test('yazım farkı (TR katlama) sızıntıya yol açmaz', () => {
  const item = shapeProjectItem({
    slug: 'b', title: 'B', images: '[]',
    designer_names: null, office_names: null,
    designer_names_raw: JSON.stringify(['KAYITLI MİMARLIK']),
    office_names_raw: JSON.stringify([]),
  }, { coverOnly: true, officeNameFolds: OFFICES });
  assert.deepEqual(mimar(item), []);
  assert.deepEqual(firma(item), ['KAYITLI MİMARLIK']);
});

test('sitede kaydı OLMAYAN ad modern gönderide kutusunda kalır (sezgi YOK)', () => {
  const item = shapeProjectItem({
    slug: 'c', title: 'C', images: '[]',
    designer_names: null, office_names: null,
    // "Kayıtsız Mimar" bir kişi; "Serbest Tasarım" isOfficeName sezgisine UYAR ama modern gönderide
    // kullanıcının hangi kutuya yazdığı kesin bilgidir, sezgiye başvurulmaz.
    designer_names_raw: JSON.stringify(['Kayıtsız Mimar', 'Serbest Tasarım']),
    office_names_raw: JSON.stringify([]),
  }, { coverOnly: true, officeNameFolds: OFFICES });
  assert.deepEqual(mimar(item), ['Kayıtsız Mimar', 'Serbest Tasarım']);
  assert.deepEqual(firma(item), []);
});

test('project_designers\'ta MİMAR olarak bağlı ad ASLA taşınmaz', () => {
  // Aynı adla hem architects hem offices kaydı olabilir — bağlanmış olan kazanır.
  const item = shapeProjectItem({
    slug: 'd', title: 'D', images: '[]',
    designer_names: 'Kayıtlı Mimarlık', office_names: null,
    designer_names_raw: JSON.stringify(['Kayıtlı Mimarlık']),
    office_names_raw: JSON.stringify([]),
  }, { coverOnly: true, officeNameFolds: OFFICES });
  assert.deepEqual(mimar(item), ['Kayıtlı Mimarlık']);
  assert.deepEqual(firma(item), []);
});

section('eski (0030 öncesi) BİRLEŞİK kutu — office_names_raw NULL');

test('birleşik kutuda kayıtsız firma adı sezgiyle Firma tarafına geçer', () => {
  const item = shapeProjectItem({
    slug: 'e', title: 'E', images: '[]',
    designer_names: null, office_names: null,
    designer_names_raw: JSON.stringify(['Ahmet Yılmaz', 'Kayıtsız Mimarlık Ofisi']),
    office_names_raw: null,
  }, { coverOnly: true, officeNameFolds: OFFICES });
  assert.deepEqual(mimar(item), ['Ahmet Yılmaz']);
  assert.deepEqual(firma(item), ['Kayıtsız Mimarlık Ofisi']);
});

test('birleşik kutuda kayıtlı firma adı da Firma tarafına geçer', () => {
  const item = shapeProjectItem({
    slug: 'f', title: 'F', images: '[]',
    designer_names: null, office_names: null,
    designer_names_raw: JSON.stringify(['BİRİM Design', 'Ahmet Yılmaz']),
    office_names_raw: null,
  }, { coverOnly: true, officeNameFolds: OFFICES });
  assert.deepEqual(mimar(item), ['Ahmet Yılmaz']);
  assert.deepEqual(firma(item), ['BİRİM Design']);
});

section('davranış SINIRI — officeNameFolds geçilmeyen çağıranlar değişmedi');

test('officeNameFolds yokken eski şekil aynen korunur', () => {
  const row = {
    slug: 'g', title: 'G', images: '[]',
    designer_names: ['Nevzat Sayın', 'Kayıtlı Mimarlık'].join(SEP), office_names: 'Kayıtlı Mimarlık',
    designer_names_raw: JSON.stringify(['Kayıtsız Mimarlık Ofisi']),
    office_names_raw: null,
  };
  const item = shapeProjectItem(row, { coverOnly: true });
  assert.deepEqual(item.designer, ['Nevzat Sayın', 'Kayıtlı Mimarlık', 'Kayıtsız Mimarlık Ofisi']);
  assert.deepEqual(item.officeNames, ['Kayıtlı Mimarlık']);
});

section('kaynak kapıları');

const projectPool = read('src/lib/projectPool.js');
const facetCounts = read('src/lib/facetCounts.js');

test('filtre havuzu firma adlarını D1\'den okuyup shapeProjectItem\'a geçiriyor', () => {
  assert.match(projectPool, /SELECT name FROM offices WHERE deleted_at IS NULL/);
  assert.match(projectPool, /shapeProjectItem\(row, \{ coverOnly: true, officeNameFolds \}\)/);
  // Gizli/arşivlenmiş firmalar DIŞARIDA BIRAKILMAMALI (2026-09-14'te markaların çoğu arşive alındı).
  assert.ok(!/FROM offices WHERE deleted_at IS NULL AND hidden_at/.test(projectPool),
    'arşivdeki firmalar kümeden düşerse adları Mimar filtresine geri sızar');
});

test('Mimar filtresi firma adlarını TR-katlamalı karşılaştırmayla eliyor', () => {
  assert.match(projectPool, /const officeFold = new Set\(\(p\.officeNames \|\| \[\]\)\.map\(n => foldTr\(n\)\)\)/);
});

test('facet_counts sayaç şekli sürümlü (eski satırlar servis edilmez)', () => {
  assert.match(facetCounts, /FACET_SHAPE_VERSION/);
  assert.match(facetCounts, /function storedListType/);
  assert.match(facetCounts, /DELETE FROM facet_counts WHERE list_type IN \(\?, \?\)/);
});

// GERÇEK BULGU (2026-09-15 dördüncü tur — deploy #70'in sağlık kontrolü kırmızı döndü:
// "/proje -> kabuk HIT ama #ml-list-data yok"). Sürümleme tabloyu boşalttığı için /api/projects/
// filters her istekte tam taramaya düşüyordu; /proje'nin SSR verisi o ucu 2 sn timeout ile
// çektiğinden soğuk havuzda #ml-list-data sayfaya HİÇ yazılmıyordu. Sayaçlar artık ilk istekte
// kendini onarıyor — bu kapı kalkarsa aynı sessiz SSR kaybı geri gelir.
test('sayaçlar boşsa uç kendini onarıyor (ctx.waitUntil ile yazma)', () => {
  const projectRoute = read('src/routes/project.js');
  assert.match(projectRoute, /import \{ getCachedFacetCounts, bumpFacetCounts \} from '\.\.\/lib\/facetCounts\.js';/);
  assert.match(projectRoute, /if \(!Object\.keys\(cached\)\.length\) \{[\s\S]*?bumpFacetCounts\(env, 'projects'\)/);
  assert.match(projectRoute, /ctx && typeof ctx\.waitUntil === 'function'/);
  // Yazma hatası bu ucu ASLA 500'e düşürmemeli — tam tarama zaten doğru sonucu üretir.
  assert.match(projectRoute, /\} catch \{ \/\* tam tarama zaten doğru sonucu üretir/);
  // ctx gerçekten geçiriliyor mu (yoksa waitUntil dalı hiç çalışmaz).
  assert.match(read('src/index.js'), /handleProjectFiltersRoute\(request, env, url, ctx\)/);
  // Sağlık kontrolü ölçümden önce ucu ısıtıyor (bkz. o dosyadaki gerekçe).
  assert.match(read('scripts/health-check.sh'), /3y\) Facet sayaçlarını ısıtma/);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
