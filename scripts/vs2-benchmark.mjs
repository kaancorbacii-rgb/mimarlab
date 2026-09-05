#!/usr/bin/env node
// VISUAL SEARCH V2 — benchmark DEĞERLENDİRİCİ (brief madde 19/20).
//
// scripts/vs2-make-benchmark-queries.py'nin ürettiği GERÇEK CLIP sorgu vektörlerini, GERÇEK
// production havuzları + GERÇEK KV görsel dizini üzerinde, production kod yolunun TA KENDİSİNİ
// (src/routes/visualSearch.js#resolveVisualMatch — kopya değil, doğrudan import) çağırarak ölçer.
//
// Vision metni BİLEREK BOŞ bırakılır (hydrateVision boş nesneyle): amaç GÖRSEL KANALIN tek
// başına ne yaptığını ölçmek. Gerçek serviste vision çıktısı da katkı verir, yani buradaki
// sayılar görsel kanalın ALT SINIRIDIR — regresyon tespiti için doğru olan da budur.
//
// KULLANIM:
//   node scripts/vs2-benchmark.mjs                 # KV'deki canlı dizinle
//   node scripts/vs2-benchmark.mjs --pack <dosya>  # yerel bir paket dosyasıyla (KV'ye yazmadan)
//   node scripts/vs2-benchmark.mjs --label baseline

import { resolveVisualMatch, hydrateVision } from '../src/routes/visualSearch.js';
import { unpackImageIndex, imageIndexKvKey, aggregateImageIndex } from '../src/lib/imageEmbedIndex.js';
import { shapeProjectItem, DESIGNER_SEP, DESIGNER_JOIN_SQL, OFFICE_NAMES_SQL } from '../src/lib/projectPool.js';
import { shapeProductItem } from '../src/routes/product.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const KV_NAMESPACE_ID = '9a8a1cfde13447a498bc5dcc4bc7d4ae';

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const LABEL = argOf('--label', 'run');
const PACK = argOf('--pack', null);

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
  if (!body.success) throw new Error(`D1: ${JSON.stringify(body.errors)}`);
  return body.result[0].results;
}
async function kvGetBinary(key) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV ${res.status}`);
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
    return { slug: row.slug, title: p.title, brand: p.brand, category: p.category, kind: p.kind,
      image: (p.images && p.images[0]) || null, rating: { average: 0, count: 0 },
      designers: (p.designer || '').split(',').map(s => s.trim()).filter(Boolean) };
  });
}

const QPATH = join(process.cwd(), 'scripts/output/vs2-bench-queries.json');
if (!existsSync(QPATH)) { console.error('vs2-bench-queries.json yok — önce vs2-make-benchmark-queries.py'); process.exit(1); }
const QUERIES = JSON.parse(readFileSync(QPATH, 'utf8'));

function rankOf(list, slug) {
  for (let i = 0; i < list.length; i++) if (list[i].slug === slug) return i + 1;
  return 0;   // listede yok
}

async function main() {
  console.log(`[${LABEL}] havuzlar + dizinler yükleniyor...`);
  const [projectPool, productPool] = await Promise.all([loadProjectPool(), loadProductPool()]);
  const projBuf = PACK ? readFileSync(PACK).buffer : await kvGetBinary(imageIndexKvKey('project'));
  const prodBuf = await kvGetBinary(imageIndexKvKey('product'));
  const projectImageIndex = projBuf ? unpackImageIndex(projBuf) : null;
  const productImageIndex = prodBuf ? unpackImageIndex(prodBuf) : null;
  const rows = projectImageIndex ? projectImageIndex.entities.reduce((a, e) => a + e.c, 0) : 0;
  console.log(`[${LABEL}] proje dizini: ${projectImageIndex?.entities.length || 0} varlık / ${rows} görsel`);
  console.log(`[${LABEL}] ürün dizini : ${productImageIndex?.entities.length || 0} varlık`);

  const pools = { projectPool, productPool, projectIndex: null, productIndex: null, projectImageIndex, productImageIndex };
  const byTest = new Map();       // uçtan uca (resolveVisualMatch) — KARAR katmanı
  const byTestRetr = new Map();   // saf GÖRSEL KANAL sıralaması — RETRIEVAL katmanı
  const latencies = [];
  const dupStats = [];            // near-duplicate eşiği kalibrasyonu için ham kosinüsler

  // İKİ KATMAN AYRI ÖLÇÜLÜR — aksi halde ne olduğunu anlamak imkânsız:
  //   RETRIEVAL: aggregateImageIndex sıralamasında doğru proje kaçıncı? Bu, indeks KAPSAMININ
  //              doğrudan ölçüsüdür (bu çalışmanın ana müdahalesi) ve hiçbir kapıdan geçmez.
  //   KARAR    : resolveVisualMatch'in DÖNDÜRDÜĞÜ liste. hasCorroboration/eşikler burada devrede.
  // İlk koşuda KARAR katmanı her testte %0 çıktı: vision metni boşken hiçbir aday
  // korroborasyon bulamıyor ve saf-görsel aday listeye HİÇ girmiyor. Bu bir ölçüm hatası değil,
  // sistemin tasarım kararı — ama retrieval'ı ayrı ölçmeden iyileştirmenin etkisi görünmez.
  for (const q of QUERIES) {
    const idx = q.kind === 'project' ? projectImageIndex : productImageIndex;
    if (idx) {
      const agg = aggregateImageIndex(idx, q.vec);
      const ranked = [...agg.entries()].sort((a, b) => b[1].score - a[1].score);
      const rr = q.expectSlug ? (ranked.findIndex(([slug]) => slug === q.expectSlug) + 1) : 0;
      const rb = byTestRetr.get(q.test) || { n: 0, top1: 0, top5: 0, top10: 0, found: 0 };
      rb.n++;
      if (rr === 1) rb.top1++;
      if (rr >= 1 && rr <= 5) rb.top5++;
      if (rr >= 1 && rr <= 10) rb.top10++;
      if (rr >= 1) rb.found++;
      byTestRetr.set(q.test, rb);
      // Kalibrasyon: doğru projenin ham kosinüsü vs EN İYİ YANLIŞ projenin ham kosinüsü.
      if (q.expectSlug) {
        const correct = agg.get(q.expectSlug);
        const bestWrong = ranked.find(([slug]) => slug !== q.expectSlug);
        dupStats.push({ test: q.test, correct: correct ? correct.score : 0,
                        wrong: bestWrong ? bestWrong[1].score : 0,
                        // MARJ: doğru (=en iyi) ile en iyi YANLIŞ arasındaki fark. Mutlak eşik
                        // artık ayırmıyor (indeks zenginleşince yanlışların tavanı yükseldi) —
                        // kimlik "mutlak bir çizgiyi aşmak" değil "belirgin biçimde en iyi olmak".
                        margin: (correct ? correct.score : 0) - (bestWrong ? bestWrong[1].score : 0),
                        isTop1: ranked.length ? ranked[0][0] === q.expectSlug : false });
      } else {
        dupStats.push({ test: q.test, correct: null, wrong: ranked.length ? ranked[0][1].score : 0 });
      }
    }
    const vision = hydrateVision({ subject: q.kind, isArchitectural: q.kind === 'project' });
    const t0 = performance.now();
    const r = resolveVisualMatch(vision, null, pools, q.vec);
    latencies.push(performance.now() - t0);
    const list = q.kind === 'project' ? (r.projects || []) : (r.products || []);
    const rank = q.expectSlug ? rankOf(list, q.expectSlug) : 0;
    const bucket = byTest.get(q.test) || { n: 0, top1: 0, top5: 0, top10: 0, found: 0, anyResult: 0 };
    bucket.n++;
    if (list.length) bucket.anyResult++;
    if (rank === 1) bucket.top1++;
    if (rank >= 1 && rank <= 5) bucket.top5++;
    if (rank >= 1 && rank <= 10) bucket.top10++;
    if (rank >= 1) bucket.found++;
    byTest.set(q.test, bucket);
  }

  latencies.sort((a, b) => a - b);
  const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';
  console.log(`\n=== VS2 BENCHMARK [${LABEL}] — RETRIEVAL (saf görsel kanal sıralaması) ===`);
  console.log('test   n     Top1     Top5     Top10    bulundu');
  for (const t of ['A', 'B', 'B2', 'C', 'D', 'E', 'F', 'PROD']) {
    const b = byTestRetr.get(t); if (!b) continue;
    console.log(`${t.padEnd(6)} ${String(b.n).padEnd(5)} ${pct(b.top1, b.n).padEnd(8)} ${pct(b.top5, b.n).padEnd(8)} ${pct(b.top10, b.n).padEnd(8)} ${pct(b.found, b.n)}`);
  }
  const retr = ['A', 'B', 'B2', 'C', 'D', 'E', 'F'].reduce((a, t) => {
    const b = byTestRetr.get(t); if (!b) return a;
    a.n += b.n; a.top1 += b.top1; a.top5 += b.top5; a.top10 += b.top10; return a;
  }, { n: 0, top1: 0, top5: 0, top10: 0 });
  console.log(`RETRIEVAL PROJE  Top1=${pct(retr.top1, retr.n)}  Top5=${pct(retr.top5, retr.n)}  Top10=${pct(retr.top10, retr.n)}  (n=${retr.n})`);

  // Near-duplicate eşiği kalibrasyonu: doğru vs en iyi yanlış kosinüs dağılımı
  const q = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length * p)] : 0; };
  const byT = {};
  for (const d of dupStats) (byT[d.test] = byT[d.test] || []).push(d);
  console.log('\n--- ham kosinüs dağılımı (near-duplicate eşiği kalibrasyonu) ---');
  console.log('test   doğru p05   doğru p50   yanlış p50  yanlış p95  yanlış MAX  marj p05  marj p50');
  for (const t of ['A', 'B', 'B2', 'C', 'D', 'E', 'F', 'G']) {
    const arr = byT[t]; if (!arr) continue;
    const cor = arr.map(d => d.correct).filter(v => v != null);
    const wr = arr.map(d => d.wrong);
    const mg = arr.map(d => d.margin).filter(v => v != null);
    console.log(`${t.padEnd(6)} ${q(cor,0.05).toFixed(3).padEnd(11)} ${q(cor,0.5).toFixed(3).padEnd(11)} ${q(wr,0.5).toFixed(3).padEnd(11)} ${q(wr,0.95).toFixed(3).padEnd(11)} ${Math.max(0,...wr).toFixed(3).padEnd(11)} ${q(mg,0.05).toFixed(3).padEnd(9)} ${q(mg,0.5).toFixed(3)}`);
  }
  // Top1 olan sorgularda marj dağılımı — eşik buradan seçilir.
  const top1m = dupStats.filter(d => d.isTop1 && d.margin != null).map(d => d.margin);
  console.log(`Top1 doğru sorgularda marj: p01=${q(top1m,0.01).toFixed(3)} p05=${q(top1m,0.05).toFixed(3)} p10=${q(top1m,0.10).toFixed(3)} p50=${q(top1m,0.5).toFixed(3)}  (n=${top1m.length})`);

  console.log(`\n=== KARAR katmanı (resolveVisualMatch — hasCorroboration/eşikler devrede) ===`);
  console.log('test   n     Top1     Top5     Top10    bulundu');
  const order = ['A', 'B', 'B2', 'C', 'D', 'E', 'F', 'G', 'PROD'];
  for (const t of order) {
    const b = byTest.get(t); if (!b) continue;
    if (t === 'G') { console.log(`G      ${String(b.n).padEnd(6)}sonuç dönen: ${b.anyResult}/${b.n} (0 olmalı — false positive)`); continue; }
    console.log(`${t.padEnd(6)} ${String(b.n).padEnd(5)} ${pct(b.top1, b.n).padEnd(8)} ${pct(b.top5, b.n).padEnd(8)} ${pct(b.top10, b.n).padEnd(8)} ${pct(b.found, b.n)}`);
  }
  const proj = ['A', 'B', 'B2', 'C', 'D', 'E', 'F'].reduce((a, t) => {
    const b = byTest.get(t); if (!b) return a;
    a.n += b.n; a.top1 += b.top1; a.top5 += b.top5; a.top10 += b.top10; return a;
  }, { n: 0, top1: 0, top5: 0, top10: 0 });
  const prod = byTest.get('PROD') || { n: 0, top1: 0, top5: 0 };
  const g = byTest.get('G') || { n: 0, anyResult: 0 };
  const summary = {
    label: LABEL,
    retrievalTop1: retr.n ? retr.top1 / retr.n : 0,
    retrievalTop5: retr.n ? retr.top5 / retr.n : 0,
    retrievalTop10: retr.n ? retr.top10 / retr.n : 0,
    cosineStats: byT && Object.fromEntries(Object.entries(byT).map(([t, arr]) => [t, {
      correctP05: q(arr.map(d => d.correct).filter(v => v != null), 0.05),
      correctP50: q(arr.map(d => d.correct).filter(v => v != null), 0.5),
      wrongP95: q(arr.map(d => d.wrong), 0.95),
      wrongMax: Math.max(0, ...arr.map(d => d.wrong)),
    }])), indexedEntities: projectImageIndex?.entities.length || 0, indexedImages: rows,
    projectTop1: proj.n ? proj.top1 / proj.n : 0, projectTop5: proj.n ? proj.top5 / proj.n : 0,
    projectTop10: proj.n ? proj.top10 / proj.n : 0,
    productTop1: prod.n ? prod.top1 / prod.n : 0, productTop5: prod.n ? prod.top5 / prod.n : 0,
    falsePositive: g.n ? g.anyResult / g.n : 0,
    avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1),
    p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] || 0,
    queries: QUERIES.length,
  };
  console.log(`\nPROJE  Top1=${pct(proj.top1, proj.n)}  Top5=${pct(proj.top5, proj.n)}  Top10=${pct(proj.top10, proj.n)}  (n=${proj.n})`);
  console.log(`ÜRÜN   Top1=${pct(prod.top1, prod.n)}  Top5=${pct(prod.top5, prod.n)}  (n=${prod.n})`);
  console.log(`false positive (G): ${pct(g.anyResult, g.n)}`);
  console.log(`latency ort=${summary.avgLatencyMs.toFixed(1)}ms  p95=${summary.p95LatencyMs.toFixed(1)}ms  (yalnızca sıralama, AI/ağ hariç)`);

  const outPath = join(process.cwd(), `scripts/output/vs2-bench-${LABEL}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\n-> ${outPath}`);
}
main().catch(e => { console.error(e); process.exit(1); });
