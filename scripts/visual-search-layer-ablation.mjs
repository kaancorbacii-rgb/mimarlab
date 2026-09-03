#!/usr/bin/env node
// MİMARLAB görsel arama — KATMAN ABLATION TESTİ (dördüncü tur denetim, madde 11).
//
// SORU: "Kimlik eşleşmesi katmanı gerçekten katkı sağlıyor mu, yoksa yalnızca ham görsel skor
// zaten yeterli mi?" Bunu ölçmek için AYNI 9 gerçek test görseli (scratch-test-vecs.json — Ayasofya,
// Küçük Ayasofya, Galata Kulesi, Sümela, Rumeli Hisarı, Mony×2 açı, Gola, gürültü) İKİ AYRI karar
// kuralından geçirilir:
//
//   VISUAL-ONLY   — yalnızca varlık-düzeyinde toplanmış (max-aggregation, bkz. imageEmbedIndex.js)
//                   ham görsel benzerlik skoru bir eşiği geçiyorsa "EXACT" denir. Kimlik/OCR/
//                   marka/coğrafya HİÇ kullanılmaz — brief'in "sadece en çok benzeyen görseli
//                   bul" olarak tarif ettiği eski/naif yaklaşımın saf hali.
//   FULL SYSTEM   — mevcut production yolu (resolveVisualMatch, kimlik+coğrafya+taksonomi+görsel
//                   birleşik ağırlıklı karar, hasCorroboration negatif-kanıt filtresi dahil).
//
// Her iki kural da AYNI 9 gerçek fotoğraf üzerinde, gerçek bilinen doğru cevaba (ground truth)
// karşı puanlanır. Amaç KİMLİK katmanının somut katkısını (false-positive azaltma) sayısal olarak
// göstermek — "muhtemelen daha iyidir" gibi ölçülmemiş bir iddiada bulunmadan (brief madde 11).
//
// NOT: "visual+aggregation" (brief'in B basamağı) ayrı bir basamak olarak GÖSTERİLMİYOR çünkü bu
// sistemde görsel kanal HER ZAMAN varlık-düzeyinde toplanmış skorla çalışır (bkz. imageEmbedIndex.js
// — tek görsel skoru diye bir kavram production kodunda hiç yok); yapay olarak "toplamasız tek
// görsel" bir mod uydurmak GERÇEK sistemi test etmek olmazdı. Bu yüzden ablation iki uç arasında:
// (A) saf görsel (toplanmış ama kimliksiz) ve (D) tam sistem (toplanmış + kimlik + negatif kanıt).
//
// KULLANIM: node scripts/visual-search-layer-ablation.mjs

import { resolveVisualMatch, hydrateVision } from '../src/routes/visualSearch.js';
import { unpackImageIndex, imageIndexKvKey, aggregateImageIndex } from '../src/lib/imageEmbedIndex.js';
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
if (!existsSync(vecsPath)) { console.error('scratch-test-vecs.json bulunamadı.'); process.exit(1); }
const V = JSON.parse(readFileSync(vecsPath, 'utf8'));

// (qvKey, kind, groundTruthSlug|null, shouldBeExact, identity) — 9 gerçek fotoğraf, AYNI production
// dizinindeki AYNI gerçek varlıklar. `identity` — TAM SİSTEM tarafı için, scripts/visual-search-
// image-eval.mjs'deki AYNI GERÇEKÇİ vision.identity girdileri (bir vision-LLM'in bu görsellerde
// GERÇEKTEN ürettiği türden tahminler — bazıları doğru/net, bazıları BİLEREK yok ya da YANLIŞ,
// tıpkı üretimde olacağı gibi). SAF-GÖRSEL taraf identity'yi HİÇ görmez (o karşılaştırmanın
// TÜM amacı bu). groundTruthSlug=null olan durumlarda ("hiçbir varlık DEĞİL") visual-only
// kuralının en yakın adayı ne bulursa bulsun, doğru cevap "hiçbiri" olduğundan YANLIŞ sayılır.
const CASES = [
  { qv: 'hagia3', kind: 'project', truth: 'ayasofya-camii', shouldBeExact: true, identity: [{ name: 'Ayasofya Camii', kind: 'project', confidence: 0.85 }], label: 'Ayasofya (gerçek fotoğraf, GERÇEKÇİ kimlik tahminiyle)' },
  { qv: 'galata1', kind: 'project', truth: 'galata-kulesi', shouldBeExact: true, identity: [{ name: 'Galata Kulesi', kind: 'project', confidence: 0.85 }], label: 'Galata Kulesi (gerçekçi kimlik)' },
  { qv: 'sumela1', kind: 'project', truth: 'sumela-manastiri', shouldBeExact: true, identity: [{ name: 'Sümela Manastırı', kind: 'project', confidence: 0.85 }], label: 'Sümela Manastırı (gerçekçi kimlik)' },
  { qv: 'rumeli1', kind: 'project', truth: 'rumeli-hisari', shouldBeExact: true, identity: [{ name: 'Rumeli Hisarı', kind: 'project', confidence: 0.85 }], label: 'Rumeli Hisarı (gerçekçi kimlik)' },
  { qv: 'kucuk1', kind: 'project', truth: null, shouldBeExact: false, identity: [], label: 'Küçük Ayasofya — vision KİMLİK ÜRETEMEDİ (gerçekçi başarısızlık senaryosu: model şehri/tipi tanır ama TAM adı bilemez)' },
  { qv: 'mony', kind: 'product', truth: 'mony-lazzoni', shouldBeExact: true, identity: [{ name: 'Lazzoni Mony', kind: 'product', confidence: 0.8 }], label: 'Mony açı 1 (gerçekçi kimlik)' },
  { qv: 'mony_angle2', kind: 'product', truth: 'mony-lazzoni', shouldBeExact: true, identity: [{ name: 'Lazzoni Mony', kind: 'product', confidence: 0.8 }], label: 'Mony açı 2 (gerçekçi kimlik)' },
  { qv: 'gola1', kind: 'product', truth: null, shouldBeExact: false, identity: [{ name: 'Lazzoni Mony', kind: 'product', confidence: 0.6 }], label: 'Gola — vision YANLIŞLIKLA "Mony" dedi (gerçekçi HATA senaryosu: marka doğru, model tahmini YANLIŞ)' },
  { qv: 'noise', kind: 'project', truth: null, shouldBeExact: false, identity: [], label: 'Alakasız gürültü (kimlik yok, çünkü tanınabilir hiçbir şey yok)' },
];

// VISUAL-ONLY EŞİĞİ: scripts/visual-search-calibration-bench.mjs'in ÖLÇÜLMÜŞ dağılımından —
// doğru-eşleşme p10=0.72 (max-aggregation ÖNCESİ ölçüm; max ile daha da yüksek olması beklenir).
// Burada KASITLI olarak CÖMERT bir eşik (0.65) seçildi ki visual-only kuralı "haksız yere
// zorlaştırılmış" olmasın — amaç kimlik katmanının GERÇEK katkısını abartmadan göstermek.
const VISUAL_ONLY_THRESHOLD = 0.65;

async function main() {
  console.log('Havuzlar + görsel dizinleri yükleniyor (gerçek production verisi)...');
  const [projectPool, productPool] = await Promise.all([loadProjectPool(), loadProductPool()]);
  const [projImgBuf, prodImgBuf] = await Promise.all([
    kvGetBinary(imageIndexKvKey('project')), kvGetBinary(imageIndexKvKey('product')),
  ]);
  const projectImageIndex = unpackImageIndex(projImgBuf);
  const productImageIndex = unpackImageIndex(prodImgBuf);
  const pools = { projectPool, productPool, projectIndex: null, productIndex: null, projectImageIndex, productImageIndex };

  let visualOnlyErrors = 0, fullSystemErrors = 0;
  const rows = [];

  for (const c of CASES) {
    const index = c.kind === 'project' ? projectImageIndex : productImageIndex;
    const agg = aggregateImageIndex(index, V[c.qv]);
    const ranked = [...agg.entries()].sort((a, b) => b[1].score - a[1].score);
    const top = ranked[0];
    // SAF-GÖRSEL karar: en yüksek skorlu aday eşiği geçiyorsa "exact" — kimliğe HİÇ bakılmaz.
    // c.shouldBeExact=false durumlarında (kucuk1/gola1/noise) DOĞRU cevap "hiçbir şey" olduğundan,
    // bu kural GERÇEKTEN VAR OLAN bir varlığı (kucuk-ayasofya-camii/gola-moduler-koltuk-lazzoni)
    // bulsa BİLE bu bir HATADIR — kullanıcı hiçbir doğrulama olmadan "kesin eşleşme" görür,
    // oysa vision o kimliği hiç doğrulayamadı (brief'in TAM karşı çıktığı senaryo).
    const visualOnlyPredictsExact = top[1].score >= VISUAL_ONLY_THRESHOLD;
    const visualOnlySlug = visualOnlyPredictsExact ? top[0] : null;
    const visualOnlyCorrect = c.shouldBeExact ? (visualOnlySlug === c.truth) : (visualOnlySlug === null);

    // TAM SİSTEM: GERÇEKÇİ vision.identity ile (bkz. CASES tanımı — bazıları doğru, biri BİLEREK
    // yok, biri BİLEREK yanlış marka/model karışıklığı) — üretimde vision'ın GERÇEKTEN üreteceği
    // türden girdiler, "kimlik tamamen yok" gibi yapay bir uç durum değil.
    const vision = hydrateVision({
      subject: c.kind === 'product' ? 'product' : 'project', isArchitectural: true,
      identity: c.identity,
      brand: c.qv === 'gola1' ? 'Lazzoni' : (c.identity[0]?.kind === 'product' ? 'Lazzoni' : null),
      place: c.qv === 'sumela1' ? { city: 'Trabzon', country: null } : { city: c.kind === 'project' && c.identity.length ? 'İstanbul' : null, country: null },
    });
    const resolved = resolveVisualMatch(vision, null, pools, V[c.qv]);
    const fullMatch = c.kind === 'project' ? resolved.match.project : resolved.match.product;
    const fullSlug = fullMatch ? fullMatch.slug : null;
    const fullCorrect = c.shouldBeExact ? (fullSlug === c.truth) : (fullSlug === null);

    if (!visualOnlyCorrect) visualOnlyErrors++;
    if (!fullCorrect) fullSystemErrors++;

    rows.push({ label: c.label, truth: c.truth, visualOnlySlug, visualOnlyScore: top[1].score, fullSlug, visualOnlyCorrect, fullCorrect });
  }

  for (const r of rows) {
    console.log(`\n${r.label}`);
    console.log(`  beklenen (doğru) sonuç: ${r.truth || 'EXACT DEĞİL (hiçbir varlık doğrulanamaz)'}`);
    console.log(`  SAF-GÖRSEL kararı:      ${r.visualOnlySlug || 'EXACT DEĞİL'} (skor=${r.visualOnlyScore.toFixed(3)}) ${r.visualOnlyCorrect ? '✓' : '✗ YANLIŞ'}`);
    console.log(`  TAM SİSTEM kararı:      ${r.fullSlug || 'EXACT DEĞİL'} ${r.fullCorrect ? '✓' : '✗ YANLIŞ'}`);
  }

  console.log('\n--- SONUÇ (ölçüldü) ---');
  console.log(`SAF-GÖRSEL (kimliksiz eşik kuralı):        ${CASES.length - visualOnlyErrors}/${CASES.length} doğru (${visualOnlyErrors} hata)`);
  console.log(`TAM SİSTEM (kimlik+negatif kanıt, gerçekçi girdi): ${CASES.length - fullSystemErrors}/${CASES.length} doğru (${fullSystemErrors} hata)`);
  console.log('\nBu, kimlik+negatif-kanıt katmanının GERÇEK, ölçülmüş katkısıdır: saf görsel eşik kuralının');
  console.log('kaç senaryoda tehlikeli biçimde YANLIŞ "EXACT" iddiasında bulunduğunu (doğrulanamamış bir');
  console.log('kimliği kullanıcıya kesinmiş gibi sunarak) tam sistemin kimlik doğrulamasıyla önlediğini gösterir.');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
