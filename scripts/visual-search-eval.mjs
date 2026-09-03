#!/usr/bin/env node
// MİMARLAB görsel arama — REGRESYON/DEĞERLENDİRME BETİĞİ (kullanıcı isteği, brief madde 22/23).
//
// NE TEST EDER, NE TEST ETMEZ
// Gerçek bir fotoğrafın Cloudflare vision modelinden ne döneceğini bu betik ÜRETMEZ (o, ayrı bir
// dış sistemin çıktısıdır ve her koşuda değişebilir). Bunun yerine sistemin GERÇEK zayıf noktasını
// test eder: vision ÇIKTISI verildiğinde src/routes/visualSearch.js#resolveVisualMatch doğru
// KARARI veriyor mu? Bu ayrım kasıtlıdır — brief'in 21. maddesindeki "SAME ENTITY/DIFFERENT PHOTO"
// senaryosu tam olarak budur: aynı varlığın FARKLI bir fotoğrafı, vision modelinden HER ZAMAN
// birebir aynı JSON'u üretmez (farklı açı/ışık farklı kelimeler doğurur) — asıl garanti edilmesi
// gereken şey, o farklı JSON'lardan HANGİSİ gelirse gelsin sıralama/eşik mantığının doğru varlığı
// bulmasıdır. Bu yüzden her "aynı varlık, farklı fotoğraf" test senaryosu, GERÇEK belgeyle AYNI
// kelimeleri kullanmayan, elle yazılmış bir betimleme kullanır (bkz. her fixture'daki yorum).
//
// GERÇEK ALTYAPI KULLANILIR — sahte/mock veri YOK:
//   * D1: Cloudflare REST API (gerçek production verisi, salt okunur SELECT).
//   * KV: gerçek görsel arama dizini (scripts/build-visual-index.mjs ile kurulan, production'da
//     cron'un bakımını yaptığı AYNI paket).
//   * bge-m3: gerçek Workers AI çağrısı (sorgu embedding'i için, fixture başına 1 çağrı).
//   * Sıralama/eşik/karar mantığı: production kod yolunun TAMAMEN AYNISI
//     (src/routes/visualSearch.js#resolveVisualMatch — kopya değil, doğrudan import).
//
// KULLANIM
//     node scripts/visual-search-eval.mjs              # tüm senaryolar, özet rapor
//     node scripts/visual-search-eval.mjs --verbose     # her senaryonun tam sıralamasını yazdır

import { resolveVisualMatch, buildQueryText, hydrateVision } from '../src/routes/visualSearch.js';
import { unpackIndex, EMBED_DIM, indexKvKey } from '../src/lib/visualIndex.js';
import { shapeProjectItem, DESIGNER_SEP, DESIGNER_JOIN_SQL, OFFICE_NAMES_SQL } from '../src/lib/projectPool.js';
import { shapeProductItem } from '../src/routes/product.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const KV_NAMESPACE_ID = '9a8a1cfde13447a498bc5dcc4bc7d4ae'; // FACET_CACHE

function oauthToken() {
  const toml = readFileSync(join(process.env.HOME, 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  const m = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!m) throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın.');
  return m[1];
}

const TOKEN = oauthToken();

async function d1Query(sql) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`D1 hatası: ${JSON.stringify(body.errors)}`);
  return body.result[0].results;
}

async function kvGetBinary(key) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV hatası ${res.status}: ${await res.text()}`);
  return await res.arrayBuffer();
}

async function embedQuery(text) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/baai/bge-m3`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: [text] }),
  });
  const body = await res.json();
  const vec = body && body.result && body.result.data && body.result.data[0];
  if (!vec || vec.length !== EMBED_DIM) throw new Error('beklenmedik embedding yanıtı');
  return vec;
}

// ---------------------------------------------------------------------------------------------
// HAVUZ + DİZİN YÜKLEME — src/lib/projectPool.js#fetchActiveProjectPool ve src/routes/product.js#
// fetchProductPool ile AYNI SQL/şekillendirme (shapeProjectItem/shapeProductItem doğrudan import
// edilir, kopyalanmaz), yalnızca D1 erişimi env.DB yerine REST API üzerinden yapılır.
// ---------------------------------------------------------------------------------------------
async function loadProjectPool() {
  const rows = await d1Query(
    `SELECT p.id, p.slug, p.title, p.category, p.type, p.discipline, p.location, p.location_detail,
            p.project_date, p.date_bucket, p.period, p.description, p.images, p.photo_credit_text,
            p.photo_credit_url, p.build_status, p.concept_category, p.awards, p.lat, p.lng,
            GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names, ${OFFICE_NAMES_SQL}
     FROM projects p ${DESIGNER_JOIN_SQL}
     WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND p.build_status = 'built'
     GROUP BY p.id ORDER BY COALESCE(p.publish_date, p.created_at) DESC, p.id DESC`);
  return rows.map(row => shapeProjectItem(row, { coverOnly: true }));
}

async function loadProductPool() {
  const rows = await d1Query(
    `SELECT slug, title, brand_name_raw, category, kind, images, legacy_key, designer, year
       FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY id DESC`);
  return rows.map(row => {
    const p = shapeProductItem(row);
    return {
      slug: row.slug, title: p.title, brand: p.brand, category: p.category, kind: p.kind,
      image: (p.images && p.images[0]) || null, rating: { average: 0, count: 0 },
      designers: (p.designer || '').split(',').map(s => s.trim()).filter(Boolean),
    };
  });
}

async function loadIndexRemote(type) {
  const buf = await kvGetBinary(indexKvKey(type));
  if (!buf) return null;
  return unpackIndex(buf);
}

// ---------------------------------------------------------------------------------------------
// TEST SENARYOLARI (brief 21/22: SAME ENTITY/DIFFERENT PHOTO, SIMILAR BUT DIFFERENT, UNRELATED,
// MIXED). Her senaryo elle yazılmış bir "vision çıktısı" fixture'ıdır — GERÇEK belge metniyle
// AYNI kelimeleri BİLEREK kullanmaz (bkz. dosya başı yorumu): amaç sistemin ezber değil,
// paraphrase/farklı fotoğraf koşulunda da doğru varlığı bulduğunu göstermek.
//
// `expect`:
//   { tier: 'exact', slug }         -> match.project/product bu slug olmalı
//   { tier: 'similar', slugIn }     -> exact iddiası OLMAMALI, ama slug benzerler listesinde geçmeli
//   { tier: 'none' }                -> ne exact ne belirli bir benzer beklenir (yalnızca sayım)
//   { productGate: false }          -> ürün bölümü HİÇ açılmamalı (productsSuppressed=true)
// ---------------------------------------------------------------------------------------------
const SCENARIOS = [
  {
    id: 'exact-project-ayasofya-paraphrase',
    category: 'SAME_ENTITY_DIFFERENT_PHOTO',
    kind: 'project',
    vision: {
      subject: 'project', isArchitectural: true,
      identity: [{ name: 'Ayasofya', kind: 'project', confidence: 0.9 }],
      place: { city: 'İstanbul', country: 'Türkiye' },
      spaceTypes: ['Cami'], discipline: 'Restorasyon', materials: ['taş'],
      // GERÇEK belge metninden FARKLI kelimeler: "kubbe/tarihi yarımada/Bizans" yerine tamamen
      // başka bir açıdan, turistik bir fotoğrafın betimlemesi.
      description: 'Büyük bir kubbeli anıtsal yapı, dört minaresi ve kalabalık bir avlusu var, akşam ışığında altın renkte, çok sayıda turist önünde fotoğraf çekiyor.',
    },
    expect: { tier: 'exact', slug: 'ayasofya-camii' },
  },
  {
    id: 'exact-project-galata-tower-english',
    category: 'SAME_ENTITY_DIFFERENT_PHOTO',
    kind: 'project',
    vision: {
      subject: 'project', isArchitectural: true,
      identity: [{ name: 'Galata Tower', kind: 'project', confidence: 0.85 }],
      place: { city: 'İstanbul', country: 'Türkiye' },
      spaceTypes: [], discipline: null, materials: ['taş'],
      description: 'Konik çatılı, silindirik, taş örgülü tarihi bir kule, denize ve şehre hakim bir tepede.',
    },
    expect: { tier: 'exact', slug: 'galata-kulesi' },
  },
  {
    id: 'exact-project-suleymaniye',
    category: 'SAME_ENTITY_DIFFERENT_PHOTO',
    kind: 'project',
    vision: {
      subject: 'project', isArchitectural: true,
      identity: [{ name: 'Süleymaniye Camii', kind: 'project', confidence: 0.88 }],
      place: { city: 'İstanbul', country: 'Türkiye' },
      spaceTypes: ['Cami'], discipline: null, materials: [],
      description: 'Mimar Sinan eseri büyük külliye camisi, geniş avlusu ve çok sayıda kubbesiyle şehrin silüetinde öne çıkan yapı.',
    },
    expect: { tier: 'exact', slug: 'suleymaniye-camii' },
  },
  {
    id: 'similar-generic-mosque-no-identity',
    category: 'SIMILAR_BUT_DIFFERENT_ENTITY',
    kind: 'project',
    vision: {
      subject: 'project', isArchitectural: true,
      identity: [], place: { city: null, country: null },
      spaceTypes: ['Cami'], discipline: 'Restorasyon', materials: ['taş'],
      description: 'Osmanlı döneminden kalma küçük bir mahalle camisi, tek kubbeli, taş cephe, sade bir minare.',
    },
    // Kimlik yok -> exact iddiası OLMAMALI, sonuçlar cami/restorasyon havuzundan gelmeli.
    expect: { tier: 'similar-only' },
  },
  {
    id: 'unrelated-cat-photo',
    category: 'UNRELATED',
    kind: 'project',
    vision: {
      subject: 'other', isArchitectural: false,
      identity: [], place: { city: null, country: null },
      spaceTypes: [], discipline: null, materials: [], products: [],
      description: 'Bir kedi bahçede güneşleniyor, arkasında çim ve birkaç çiçek var.',
    },
    // gate testi ayrı fonksiyonda: isArchitectural=false + products boş + identity boş ->
    // route seviyesinde ZATEN erken dönüş yapılır (bkz. handleVisualSearchRoute). Burada yalnızca
    // resolveVisualMatch'in KENDİSİ zorla bir eşleşme UYDURMADIĞINI doğruluyoruz.
    expect: { tier: 'none' },
  },
  {
    id: 'exact-product-designer-brand',
    category: 'SAME_ENTITY_DIFFERENT_PHOTO',
    kind: 'product',
    vision: {
      subject: 'product', isArchitectural: true,
      identity: [], place: { city: null, country: null },
      spaceTypes: [], discipline: null, materials: [],
      brand: 'Lazzoni', model: 'Mony',
      products: [{ category: 'Koltuk & Kanepe', confidence: 0.8 }],
      description: 'Modüler bir kanepe, hareketli kolçaklı, gri kumaş kaplama, oturma odası fotoğrafı, üretici katalog görseli.',
    },
    expect: { tier: 'exact', slug: null, kind: 'product' },   // slug production verisinden dinamik doğrulanır
  },
  {
    id: 'mixed-building-with-furniture-visible',
    category: 'MIXED_IMAGE',
    kind: 'project',
    vision: {
      subject: 'project', isArchitectural: true,
      // "Ayasofya Camii" (tam ad) — bare "Ayasofya" GERÇEKTEN belirsizdir (bkz. Küçük Ayasofya
      // Camii de D1'de kayıtlı); bu fixture, iç mekanı tanıyan bir vision modelinin muhtemelen
      // vereceği TAM adı kullanır, sistemin belirsizlikte GERÇEKTEN geri çekildiğini az önce
      // doğruladık (bkz. "Ayasofya" tek başına -> exact YOK, benzer #1 -> doğru davranış).
      identity: [{ name: 'Ayasofya Camii', kind: 'project', confidence: 0.7 }],
      place: { city: 'İstanbul', country: null },
      spaceTypes: ['Cami'], discipline: null, materials: [],
      // Görselde mobilya YOK, ürün tespiti BOŞ — ürün bölümü açılmamalı.
      products: [],
      description: 'Büyük bir caminin iç mekanı, halı kaplı zemin, avizeler ve mihrap görünüyor.',
    },
    expect: { tier: 'exact', slug: 'ayasofya-camii', productGate: false },
  },
  {
    id: 'ambiguous-bare-name-declines-exact',
    category: 'SIMILAR_BUT_DIFFERENT_ENTITY',
    kind: 'project',
    vision: {
      subject: 'project', isArchitectural: true,
      // Bilerek BELİRSİZ: "Ayasofya" tek başına Ayasofya Camii İLE Küçük Ayasofya Camii arasında
      // ayrım yapamaz. Sistem TEST 4'ün gerektirdiği gibi exact iddiasında BULUNMAMALI.
      identity: [{ name: 'Ayasofya', kind: 'project', confidence: 0.7 }],
      place: { city: 'İstanbul', country: null },
      spaceTypes: ['Cami'], discipline: null, materials: [],
      description: 'Büyük bir caminin iç mekanı, halı kaplı zemin, avizeler ve mihrap görünüyor.',
    },
    expect: { tier: 'similar-only' },
  },
  {
    id: 'no-product-signal-pure-architecture',
    category: 'PRODUCT_GATING',
    kind: 'product',
    vision: {
      subject: 'project', isArchitectural: true,
      identity: [{ name: 'Galata Kulesi', kind: 'project', confidence: 0.8 }],
      place: { city: 'İstanbul', country: null },
      spaceTypes: [], discipline: null, materials: ['taş'],
      products: [],   // hiç ürün tespiti yok — brief 11: bölüm HİÇ açılmamalı.
      description: 'Taş örgülü tarihi bir kule, dış cephe fotoğrafı.',
    },
    expect: { tier: 'none', productGate: false },
  },
  {
    id: 'similar-product-category-only-no-identity',
    category: 'SIMILAR_BUT_DIFFERENT_ENTITY',
    kind: 'product',
    vision: {
      subject: 'product', isArchitectural: true,
      identity: [], place: { city: null, country: null },
      spaceTypes: [], discipline: null, materials: ['ahşap'],
      brand: null, model: null,
      products: [{ category: 'Koltuk & Kanepe', confidence: 0.75 }],
      description: 'Ahşap ayaklı, kumaş kaplama bir berjer, marka bilgisi yok, jenerik katalog fotoğrafı.',
    },
    // Marka/kimlik yok -> exact iddiası OLMAMALI, ama kategori eşleşen adaylar (koltuk/kanepe)
    // benzer listesinde çıkmalı (brief 9: kategori + malzeme birlikte SIRALAMA sinyali).
    expect: { tier: 'similar-only' },
  },
];

function fmtPct(n) { return `${(n * 100).toFixed(0)}%`; }

async function main() {
  const verbose = process.argv.includes('--verbose');

  console.log('Havuzlar ve dizinler yükleniyor (gerçek production verisi)...');
  const [projectPool, productPool, projectIndex, productIndex] = await Promise.all([
    loadProjectPool(), loadProductPool(), loadIndexRemote('project'), loadIndexRemote('product'),
  ]);
  console.log(`projects=${projectPool.length} products=${productPool.length} projectIndex=${projectIndex ? projectIndex.items.length : 'YOK'} productIndex=${productIndex ? productIndex.items.length : 'YOK'}`);
  if (!projectIndex || !productIndex) {
    console.error('UYARI: dizin eksik — scripts/build-visual-index.mjs çalıştırılmamış olabilir. Anlamsal katman OLMADAN devam ediliyor.');
  }

  // exact-product senaryosunun beklenen slug'ını gerçek veriden bul (marka+başlık eşleşmesi).
  const monyProduct = productPool.find(p => p.brand === 'Lazzoni' && p.title === 'Mony');
  for (const sc of SCENARIOS) {
    if (sc.id === 'exact-product-designer-brand' && monyProduct) sc.expect.slug = monyProduct.slug;
  }

  let pass = 0, fail = 0;
  const results = [];
  for (const sc of SCENARIOS) {
    const vision = hydrateVision(sc.vision);
    const queryText = buildQueryText(vision);
    let queryVec = null;
    try { queryVec = await embedQuery(queryText); } catch (err) { console.error(`[${sc.id}] embedding hatası: ${err.message}`); }

    const resolved = resolveVisualMatch(vision, queryVec, { projectPool, productPool, projectIndex, productIndex });
    const match = sc.kind === 'product' ? resolved.match.product : resolved.match.project;
    const list = sc.kind === 'product' ? resolved.products : resolved.projects;

    let ok = true;
    let note = '';
    if (sc.expect.tier === 'exact') {
      ok = !!match && (sc.expect.slug ? match.slug === sc.expect.slug : true);
      note = match ? `eşleşme=${match.slug} (conf=${match.confidence})` : 'eşleşme YOK (beklenen VARDI)';
    } else if (sc.expect.tier === 'similar-only') {
      ok = !match && list.length > 0;
      note = `exact=${match ? match.slug : 'yok'} benzerSayisi=${list.length}`;
    } else if (sc.expect.tier === 'none') {
      ok = !match;
      note = `exact=${match ? match.slug : 'yok'}`;
    }
    if (sc.expect.productGate === false) {
      const gateOk = resolved.productsSuppressed;
      ok = ok && gateOk;
      note += ` | productGate beklenen=kapalı gerçek=${gateOk ? 'kapalı' : 'AÇIK'}`;
    }

    if (ok) pass++; else fail++;
    results.push({ sc, ok, note });
    console.log(`${ok ? '✓' : '✗'} [${sc.category}] ${sc.id} — ${note}`);
    if (verbose) {
      console.log('   sıra:', list.slice(0, 5).map(r => `${r.slug}:${r.score}`).join(', '));
    }
  }

  console.log('\n--- ÖZET ---');
  console.log(`${pass}/${SCENARIOS.length} senaryo geçti (${fmtPct(pass / SCENARIOS.length)})`);
  const byCat = {};
  for (const r of results) {
    byCat[r.sc.category] = byCat[r.sc.category] || { pass: 0, total: 0 };
    byCat[r.sc.category].total++;
    if (r.ok) byCat[r.sc.category].pass++;
  }
  for (const [cat, s] of Object.entries(byCat)) console.log(`  ${cat}: ${s.pass}/${s.total}`);

  if (fail > 0) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
