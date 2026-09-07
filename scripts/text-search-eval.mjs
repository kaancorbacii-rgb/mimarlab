#!/usr/bin/env node
// METİN ARAMA DEĞERLENDİRİCİ — hibrit arama motorunun (src/lib/searchEngine.js) LLM'siz,
// deterministik katmanını GERÇEK production havuzları üzerinde, production kod yolunun ta
// kendisini (kopya değil, doğrudan import) çağırarak ölçer. Amaç: bir değişiklikten ÖNCE ve
// SONRA aynı sorgu setinin ne döndürdüğünü yan yana görmek (bkz. scripts/vs2-benchmark.mjs'teki
// aynı yaklaşım — görsel arama için).
//
// LLM kanalı (extractPlanWithLlm) BİLEREK çağrılmaz: ölçülen şey deterministik ayrıştırıcı +
// skorlama. Gerçek serviste LLM yalnızca deterministik katmanın boş bıraktığı alanları doldurur
// (bkz. src/routes/ai.js#needsLlm/mergePlans), yani buradaki sonuçlar servisin ALT SINIRIDIR.
//
// KULLANIM:
//   node scripts/text-search-eval.mjs                       # varsayılan sorgu seti
//   node scripts/text-search-eval.mjs --out scripts/output/text-search-baseline.json
//   node scripts/text-search-eval.mjs --q "mermer" --q "taş cephe"
//   node scripts/text-search-eval.mjs --diff a.json b.json  # iki çıktıyı karşılaştır

import { deterministicParse, searchProjectPool, searchArchitects, searchOffices, searchProducts,
         buildVocabulary, unresolvableTerms, correctPlanTerms } from '../src/lib/searchEngine.js';
import { shapeProjectItem, DESIGNER_SEP, DESIGNER_JOIN_SQL, OFFICE_NAMES_SQL } from '../src/lib/projectPool.js';
import { parseProjectDateYear } from '../src/routes/project.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const argAll = (n) => argv.flatMap((a, i) => (a === n ? [argv[i + 1]] : []));
const OUT = argOf('--out', null);
const POOL_CACHE = join(process.cwd(), 'scripts/output/text-search-pools.json');

const DEFAULT_QUERIES = [
  'ofis', 'mermer', 'taş cephe', 'ahşap ev', 'koltuk', 'sandalye', 'galata', 'galata kulesi',
  'vitra', 'emre arolat', 'istanbul konut', 'bursa camii', 'İzmir\'de otel', 'kadıköy',
  'cam cephe', 'brüt beton', 'tuğla', 'kütüphane', 'ankara müze', 'restorasyon',
  'Nevzat Sayın', 'nevzat sayin', 'tabanlıoğlu', 'ersa', 'lavabo', 'ofis koltuğu',
  'mermr', 'İstanbulda ofis projleri', 'Zorblax Mimarlık ofisinin projeleri', 'deniz manzaralı ev',
  'son 5 yılda İstanbul\'da yapılmış oteller', 'ahşap', 'taş', 'cami',
];

function oauthToken() {
  const toml = readFileSync(join(process.env.HOME, 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  return toml.match(/oauth_token\s*=\s*"([^"]+)"/)[1];
}

async function d1Query(sql) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${oauthToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`D1: ${JSON.stringify(body.errors)}`);
  return body.result[0].results;
}

function parseJsonArr(raw) { try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }

// Havuzlar, production uçlarının (fetchActiveProjectPoolCached/fetchArchitectPool/fetchOfficePool/
// fetchProductPool) SKORLAMADA OKUNAN alanlarını birebir taşır (bkz. searchEngine.js#searchArchitects/
// searchOffices/searchProducts textOf/nameOf). Tekrarlanan çalıştırmalarda D1'e gitmemek için
// yerelde önbelleklenir (--refresh ile yenilenir).
async function loadPools() {
  if (!argv.includes('--refresh') && existsSync(POOL_CACHE)) return JSON.parse(readFileSync(POOL_CACHE, 'utf8'));
  const projRows = await d1Query(
    `SELECT p.id, p.slug, p.title, p.category, p.type, p.discipline, p.location, p.location_detail,
            p.project_date, p.date_bucket, p.period, p.description, p.images, p.photo_credit_text,
            p.photo_credit_url, p.build_status, p.concept_category, p.awards, p.lat, p.lng,
            GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names, ${OFFICE_NAMES_SQL}
     FROM projects p ${DESIGNER_JOIN_SQL}
     WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND p.build_status = 'built'
     GROUP BY p.id ORDER BY p.id`);
  const projects = projRows.map(row => shapeProjectItem(row, { coverOnly: true }));

  const archRows = await d1Query(
    `SELECT a.slug, a.name, a.photo_url, a.position, a.profession, o.name AS office_name
       FROM architects a LEFT JOIN offices o ON o.id = a.office_id AND o.deleted_at IS NULL
      WHERE a.deleted_at IS NULL AND a.hidden_at IS NULL AND a.directory_listed = 1 AND a.name != 'Bilinmiyor' ORDER BY a.id DESC`);
  const architects = archRows.map(r => ({
    slug: r.slug, name: r.name, photo: r.photo_url, office: r.office_name || '', positionRaw: r.position || '',
    professions: String(r.profession || '').split(',').map(s => s.trim()).filter(Boolean),
  }));

  const officeRows = await d1Query(
    `SELECT o.slug, o.name, o.loc, o.cats, o.logo_url, o.website,
            (SELECT COUNT(*) FROM products pr WHERE pr.brand_office_id = o.id AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL) AS product_count
       FROM offices o WHERE o.deleted_at IS NULL AND o.hidden_at IS NULL ORDER BY o.id DESC`);
  const offices = officeRows.map(r => ({
    slug: r.slug, name: r.name, loc: r.loc || '', cats: r.cats || '', logo: r.logo_url, website: r.website,
    productCount: r.product_count || 0,
  }));

  const prodRows = await d1Query(
    `SELECT slug, title, brand_name_raw, category, kind, images, designer, year FROM products
      WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY id`);
  const products = prodRows.map(r => ({
    slug: r.slug, title: r.title, brand: r.brand_name_raw || '', category: r.category || '', group: '',
    image: parseJsonArr(r.images)[0] || null,
    designers: String(r.designer || '').split(',').map(s => s.trim()).filter(Boolean),
  }));

  const pools = { projects, architects, offices, products, fetchedAt: new Date().toISOString() };
  mkdirSync(dirname(POOL_CACHE), { recursive: true });
  writeFileSync(POOL_CACHE, JSON.stringify(pools));
  return pools;
}

function runQuery(pools, q) {
  const plan = deterministicParse(q);
  const vocab = buildVocabulary(pools);
  // production yolu (src/routes/ai.js) ile AYNI sıra: önce düzeltme, sonra çözülemeyen kontrolü.
  if (typeof correctPlanTerms === 'function') correctPlanTerms(plan, vocab);
  const unknown = unresolvableTerms(plan, vocab);
  const projects = searchProjectPool(pools.projects, plan, parseProjectDateYear, new Set());
  const architects = searchArchitects(pools.architects, plan);
  const officesAll = searchOffices(pools.offices, plan);
  const offices = officesAll.filter(r => !(r.item.productCount > 0));
  const brands = officesAll.filter(r => r.item.productCount > 0);
  const products = searchProducts(pools.products, plan);
  const top = (list, n, f) => list.slice(0, n).map(r => f(r.item));
  return {
    query: q,
    plan: { city: plan.city, yearFrom: plan.yearFrom, yearTo: plan.yearTo, type: plan.type, category: plan.category,
      discipline: plan.discipline, name: plan.name, keywords: plan.keywords, residual: plan.residual,
      textGroups: plan.textGroups, entity: plan.entity, corrected: plan.corrected || null },
    unresolved: unknown,
    totals: { projects: projects.length, architects: architects.length, offices: offices.length, brands: brands.length, products: products.length },
    projects: top(projects, 8, p => p.title),
    architects: top(architects, 5, a => a.name),
    offices: top(offices, 5, o => o.name),
    brands: top(brands, 5, o => o.name),
    products: top(products, 8, p => `${p.title} [${p.brand}]`),
  };
}

function printResult(r) {
  console.log(`\n=== "${r.query}"`);
  const p = Object.fromEntries(Object.entries(r.plan).filter(([, v]) => v && (!Array.isArray(v) || v.length)));
  console.log('  plan:', JSON.stringify(p));
  if (r.unresolved.length) console.log('  ÇÖZÜLEMEYEN:', r.unresolved.join(', '));
  console.log('  totals:', JSON.stringify(r.totals));
  for (const k of ['projects', 'architects', 'offices', 'brands', 'products']) {
    if (r[k].length) console.log(`  ${k}:`, r[k].join(' | '));
  }
}

function diff(aPath, bPath) {
  const a = JSON.parse(readFileSync(aPath, 'utf8')), b = JSON.parse(readFileSync(bPath, 'utf8'));
  const byQ = new Map(a.map(r => [r.query, r]));
  for (const rb of b) {
    const ra = byQ.get(rb.query);
    if (!ra) { console.log(`+ yeni sorgu "${rb.query}"`); continue; }
    const changed = [];
    for (const k of ['totals', 'projects', 'architects', 'offices', 'brands', 'products', 'unresolved']) {
      if (JSON.stringify(ra[k]) !== JSON.stringify(rb[k])) changed.push(k);
    }
    if (!changed.length) continue;
    console.log(`\n### "${rb.query}" — değişen: ${changed.join(', ')}`);
    for (const k of changed) {
      console.log(`  ${k} ÖNCE: ${JSON.stringify(ra[k])}`);
      console.log(`  ${k} SONRA: ${JSON.stringify(rb[k])}`);
    }
  }
}

async function main() {
  const di = argv.indexOf('--diff');
  if (di >= 0) { diff(argv[di + 1], argv[di + 2]); return; }
  const pools = await loadPools();
  console.log(`havuz: ${pools.projects.length} proje, ${pools.architects.length} kişi, ${pools.offices.length} firma, ${pools.products.length} ürün (${pools.fetchedAt})`);
  const queries = argAll('--q').length ? argAll('--q') : DEFAULT_QUERIES;
  const results = queries.map(q => runQuery(pools, q));
  results.forEach(printResult);
  if (OUT) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(results, null, 1));
    console.log(`\nyazıldı: ${OUT}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
