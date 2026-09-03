#!/usr/bin/env node
// MİMARLAB görsel arama — GÖRSEL KANALI (gerçek CLIP embedding) regresyon testi.
//
// scripts/visual-search-eval.mjs metin-kanalı (bge-m3) yedek yolunu test eder; bu betik sistemin
// YENİ BİRİNCİL yolunu test eder: resolveVisualMatch'e GERÇEK bir CLIP görsel embedding'i +
// GERÇEK, production'a yüklenmiş görsel-düzeyinde dizin (src/lib/imageEmbedIndex.js) verildiğinde
// doğru kararı üretiyor mu?
//
// Sorgu embedding'leri GERÇEK fotoğraflardan (production'daki Ayasofya/Küçük Ayasofya/Galata
// Kulesi/Mony-Lazzoni görselleri + tamamen rastgele bir gürültü görseli) offline Python/onnxruntime
// pipeline'ıyla (bkz. scripts/build-image-embeddings.py) ÖNCEDEN hesaplanıp buradan okunur — bu
// betik kendisi hiçbir AI çağrısı yapmaz, yalnızca GERÇEK üretilmiş vektörleri sisteme besler.
//
// KULLANIM: node scripts/visual-search-image-eval.mjs
//
// scratch-test-vecs.json (repo köküne, git'e COMMIT EDİLMEZ — türetilmiş/yeniden üretilebilir veri)
// önceden şu adımlarla üretilir: 6 test görseli indirilir (Ayasofya×2 açı, Küçük Ayasofya, Galata
// Kulesi, Mony/Lazzoni koltuk, rastgele gürültü) ve /tmp/clip_env (python3 -m venv + onnxruntime +
// pillow + transformers + huggingface_hub) ile Xenova/clip-vit-base-patch32 vision_model_uint8.onnx
// üzerinden embed edilir — bkz. scripts/build-image-embeddings.py dosya başı yorumundaki AYNI
// model/venv kurulumu. Dosya yoksa bu betik açık bir hata verip çıkar, production'ı ETKİLEMEZ.

import { resolveVisualMatch, hydrateVision } from '../src/routes/visualSearch.js';
import { unpackImageIndex, imageIndexKvKey } from '../src/lib/imageEmbedIndex.js';
import { unpackIndex, indexKvKey } from '../src/lib/visualIndex.js';
import { shapeProjectItem, DESIGNER_SEP, DESIGNER_JOIN_SQL, OFFICE_NAMES_SQL } from '../src/lib/projectPool.js';
import { shapeProductItem } from '../src/routes/product.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const KV_NAMESPACE_ID = '9a8a1cfde13447a498bc5dcc4bc7d4ae';

function oauthToken() {
  const toml = readFileSync(join(process.env.HOME, 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  return toml.match(/oauth_token\s*=\s*"([^"]+)"/)[1];
}
const TOKEN = oauthToken();

async function d1Query(sql) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`D1 hatası: ${JSON.stringify(body.errors)}`);
  return body.result[0].results;
}
async function kvGetBinary(key) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV hatası ${res.status}`);
  return await res.arrayBuffer();
}

async function loadProjectPool() {
  const rows = await d1Query(
    `SELECT p.id, p.slug, p.title, p.category, p.type, p.discipline, p.location, p.location_detail,
            p.project_date, p.date_bucket, p.period, p.description, p.images, p.photo_credit_text,
            p.photo_credit_url, p.build_status, p.concept_category, p.awards, p.lat, p.lng,
            GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names, ${OFFICE_NAMES_SQL}
     FROM projects p ${DESIGNER_JOIN_SQL}
     WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND p.build_status = 'built'
     GROUP BY p.id ORDER BY p.id`);
  return rows.map(row => shapeProjectItem(row, { coverOnly: true }));
}
async function loadProductPool() {
  const rows = await d1Query(`SELECT slug, title, brand_name_raw, category, kind, images, legacy_key, designer, year FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY id`);
  return rows.map(row => {
    const p = shapeProductItem(row);
    return {
      slug: row.slug, title: p.title, brand: p.brand, category: p.category, kind: p.kind,
      image: (p.images && p.images[0]) || null, rating: { average: 0, count: 0 },
      designers: (p.designer || '').split(',').map(s => s.trim()).filter(Boolean),
    };
  });
}

const vecsPath = join(process.cwd(), 'scratch-test-vecs.json');
if (!existsSync(vecsPath)) {
  console.error('scratch-test-vecs.json bulunamadı — önce test embedding\'leri üretilmeli.');
  process.exit(1);
}
const TEST_VECS = JSON.parse(readFileSync(vecsPath, 'utf8'));

// Bilerek ZAYIF/BOŞ kimlik sinyalleri — amaç GÖRSEL KANALIN kendi başına ne kadar iş gördüğünü
// ölçmek. entityMatch.js'in sözlüksel katmanı ÖNCEKİ eval'da (visual-search-eval.mjs) zaten
// kapsamlı test edildi; burada odak SADECE yeni image-channel'ın katkısı.
function vision(overrides) {
  return hydrateVision({ subject: 'project', isArchitectural: true, ...overrides });
}

async function main() {
  console.log('Havuzlar + görsel dizinleri yükleniyor (gerçek production verisi)...');
  const [projectPool, productPool] = await Promise.all([loadProjectPool(), loadProductPool()]);
  const [projImgBuf, prodImgBuf] = await Promise.all([
    kvGetBinary(imageIndexKvKey('project')), kvGetBinary(imageIndexKvKey('product')),
  ]);
  const projectImageIndex = projImgBuf ? unpackImageIndex(projImgBuf) : null;
  const productImageIndex = prodImgBuf ? unpackImageIndex(prodImgBuf) : null;
  console.log(`projectImageIndex: ${projectImageIndex ? projectImageIndex.entities.length + ' varlık' : 'YOK'}`);
  console.log(`productImageIndex: ${productImageIndex ? productImageIndex.entities.length + ' varlık' : 'YOK'}`);
  if (!projectImageIndex || !productImageIndex) { console.error('Görsel dizin eksik — backfill çalıştırılmalı.'); process.exit(1); }

  const pools = { projectPool, productPool, projectIndex: null, productIndex: null, projectImageIndex, productImageIndex };

  const SCENARIOS = [
    {
      id: 'image-only-hagia3-no-identity',
      // NOT: type='Dini Yapı' (PROJECT_GROUP_OPTIONS) ile spaceTypes='Cami' (vision'ın SPACE_TYPES
      // sözlüğü) FARKLI taksonomiler — gerçek bulgu, bu turun ölçümü — bu yüzden tax=0 kalıyor;
      // corroboration için place.city veriliyor (gerçekçi: vision genelde şehri de tahmin eder).
      desc: 'GERÇEK Ayasofya fotoğrafı, vision kimlik tahmini VERİLMEDİ (bilerek boş) — yalnızca görsel kanal + coğrafya çalışıyor.',
      vision: vision({ spaceTypes: ['Cami'], place: { city: 'İstanbul', country: null } }),
      qv: TEST_VECS.hagia3, kind: 'project',
      // Kimlik sinyali olmadan SALT görsel benzerlik exact üretmemeli (brief madde 6: görsel
      // kanal tek başına exact karar VEREMEZ) — bu davranışın KENDİSİ doğrulanıyor.
      expect: (r) => r.match.project === null && r.projects.some(p => p.slug === 'ayasofya-camii'),
      expectDesc: 'exact YOK ama ayasofya-camii benzerler listesinde (Top-K içinde)',
    },
    {
      id: 'image-plus-identity-hagia3',
      desc: 'GERÇEK Ayasofya fotoğrafı + vision kimlik tahmini "Ayasofya Camii" — TAM boru hattı (kimlik + gerçek görsel).',
      vision: vision({ identity: [{ name: 'Ayasofya Camii', kind: 'project', confidence: 0.85 }], spaceTypes: ['Cami'], place: { city: 'İstanbul', country: null } }),
      qv: TEST_VECS.hagia3, kind: 'project',
      expect: (r) => r.match.project && r.match.project.slug === 'ayasofya-camii',
      expectDesc: 'exact=ayasofya-camii',
    },
    {
      id: 'image-plus-identity-galata',
      desc: 'GERÇEK Galata Kulesi fotoğrafı + kimlik "Galata Kulesi".',
      vision: vision({ identity: [{ name: 'Galata Kulesi', kind: 'project', confidence: 0.85 }], place: { city: 'İstanbul', country: null } }),
      qv: TEST_VECS.galata1, kind: 'project',
      expect: (r) => r.match.project && r.match.project.slug === 'galata-kulesi',
      expectDesc: 'exact=galata-kulesi',
    },
    {
      id: 'similar-entity-no-false-exact',
      desc: 'GERÇEK Küçük Ayasofya fotoğrafı ama kimlik tahmini YOK (yalnızca görsel benzerlik çok yüksek olabilir) — sistem YANLIŞ bir exact iddia etmemeli (TEST 4).',
      vision: vision({ spaceTypes: ['Cami'] }),
      qv: TEST_VECS.kucuk1, kind: 'project',
      expect: (r) => r.match.project === null,
      expectDesc: 'exact YOK (kimlik sinyali yokken görsel benzerlik tek başına karar vermiyor)',
    },
    {
      id: 'unrelated-noise-no-match',
      desc: 'Tamamen rastgele gürültü görseli — hiçbir eşleşme/aday zorlanmamalı.',
      vision: vision({ isArchitectural: false, subject: 'other' }),
      qv: TEST_VECS.noise, kind: 'project',
      expect: (r) => r.match.project === null && r.projects.length === 0,
      expectDesc: 'exact YOK, benzer liste BOŞ (min-score eşiğinin altında kalmalı)',
    },
    {
      id: 'product-image-plus-identity',
      desc: 'GERÇEK Mony/Lazzoni koltuk fotoğrafı + kimlik "Lazzoni Mony".',
      vision: hydrateVision({ subject: 'product', isArchitectural: true, identity: [{ name: 'Lazzoni Mony', kind: 'product', confidence: 0.8 }], brand: 'Lazzoni', model: 'Mony', products: [{ category: 'Koltuk & Kanepe', confidence: 0.8 }] }),
      qv: TEST_VECS.mony, kind: 'product',
      expect: (r) => r.match.product && r.match.product.slug === 'mony-lazzoni',
      expectDesc: 'exact=mony-lazzoni',
    },
  ];

  let pass = 0;
  for (const sc of SCENARIOS) {
    const resolved = resolveVisualMatch(sc.vision, null, pools, sc.qv);
    const ok = sc.expect(resolved);
    if (ok) pass++;
    console.log(`${ok ? '✓' : '✗'} ${sc.id}`);
    console.log(`   ${sc.desc}`);
    console.log(`   beklenen: ${sc.expectDesc}`);
    console.log(`   gerçek: channel=${JSON.stringify(resolved.visualChannel)} match.project=${resolved.match.project ? resolved.match.project.slug + '@' + resolved.match.project.confidence : 'yok'} match.product=${resolved.match.product ? resolved.match.product.slug : 'yok'}`);
    console.log(`   benzerler(proje ilk 3): ${resolved.projects.slice(0, 3).map(p => `${p.slug}:${p.score}`).join(', ') || '(boş)'}`);
  }
  console.log(`\n--- ÖZET --- ${pass}/${SCENARIOS.length} senaryo geçti`);
  if (pass !== SCENARIOS.length) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
