#!/usr/bin/env node
// MİMARLAB görsel arama — VARLIK DİZİNİNİN İLK KURULUMU (backfill).
//
// NEDEN AYRI BİR BETİK (bkz. src/index.js#scheduled)
// Günlük bakımı cron yapar: 6 saatte bir yalnızca DEĞİŞMİŞ satırların embedding'ini üretir. Ama
// sıfırdan kurulum 1715 proje + 191 ürün = ~1900 embedding demektir; bunu tek bir Worker
// isteğinde/cron turunda yapmak hem CPU süresini hem de "her şey tek seferde ya hep ya hiç"
// riskini gereksizce üstlenmek olurdu. Bu betik aynı işi dışarıdan, paralel ve yeniden
// başlatılabilir biçimde yapar.
//
// AYNI BELGE ÜRETİCİSİNİ KULLANIR: src/lib/visualIndex.js buraya doğrudan import edilir. Bu
// ZORUNLUDUR — belge metni iki tarafta farklılaşırsa doc_hash'ler de farklılaşır ve cron, betiğin
// yazdığı HER SATIRI "değişmiş" sayıp sonsuza kadar yeniden embed eder.
//
// KİMLİK DOĞRULAMA: wrangler'ın kendi OAuth token'ı kullanılır (`wrangler whoami` ile görülen
// oturum; kapsamlarında `ai (write)` ve `workers_kv (write)` var). Yeni bir secret/API token
// OLUŞTURULMAZ.
//
// KULLANIM
//     node scripts/build-visual-index.mjs                 # proje + ürün
//     node scripts/build-visual-index.mjs --type product
//     node scripts/build-visual-index.mjs --dry-run       # embed etme, yalnızca belgeleri say
//
// MALİYET (ölçüldü, 2026-09-03): bge-m3 12 girdi tokenı için 0,0129 neuron. ~1900 belge × ~180
// token ≈ 340k token ≈ 370 neuron. Workers AI ücretsiz günlük kotası 10.000 neuron olduğundan
// TAM BACKFILL ÜCRETSİZ KOTANIN İÇİNDE KALIR.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import {
  EMBED_MODEL, EMBED_DIM, indexKvKey, packIndex,
  projectDocFromRow, productDocFromRow, docHash, quantizeUnit,
} from '../src/lib/visualIndex.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const WRANGLER_CONFIG = join(process.env.HOME, 'Library/Preferences/.wrangler/config/default.toml');

// src/lib/visualIndexStore.js#PROJECT_INDEX_SQL / PRODUCT_INDEX_SQL ile BİREBİR AYNI olmak
// zorunda (aynı sütunlar, aynı sıralama) — aksi halde cron ile bu betik farklı belge üretir.
const SQL = {
  project: `SELECT p.slug, p.title, p.location, p.location_detail, p.type, p.discipline, p.period,
         p.project_date, p.description,
         (SELECT GROUP_CONCAT(COALESCE(a.name, ofc.name), ', ')
            FROM project_designers pd
            LEFT JOIN architects a ON a.id = pd.architect_id
            LEFT JOIN offices ofc ON ofc.id = pd.office_id
           WHERE pd.project_id = p.id) AS designer_names
    FROM projects p
   WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL
   ORDER BY p.id`,
  product: `SELECT pr.slug, pr.title, pr.brand_name_raw, o.name AS brand_office_name, pr.category, pr.kind,
         pr.designer, pr.year, pr.description, pr.specs
    FROM products pr
    LEFT JOIN offices o ON o.id = pr.brand_office_id AND o.deleted_at IS NULL
   WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL
   ORDER BY pr.id`,
};
const DOC_OF = { project: projectDocFromRow, product: productDocFromRow };

function oauthToken() {
  const toml = readFileSync(WRANGLER_CONFIG, 'utf8');
  const m = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!m) throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın.');
  return m[1];
}

// D1'den satırları çeker.
// --file KULLANILAMAZ (ölçüldü): wrangler o modda dosyayı bir "import" işi olarak yükler ve
// SATIRLARI DEĞİL yalnızca özet istatistikleri döner ("Total queries executed", "Rows read").
// --command ise gerçek sonuç kümesini verir; execFileSync kabuk açmadığından çok satırlı SQL'in
// tırnaklanması da sorun değildir.
function fetchRows(type) {
  const out = execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'mimarlab-db', '--remote', '--json', '--command', SQL[type],
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  // wrangler çıktısının başında banner satırları olabilir; ilk '[' karakterinden itibaren JSON.
  const start = out.indexOf('[');
  const parsed = JSON.parse(out.slice(start));
  return parsed[0].results;
}

async function embedBatch(token, texts) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${EMBED_MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const data = body && body.result && body.result.data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error(`beklenmedik embedding yanıtı (${data ? data.length : 'yok'}/${texts.length})`);
  }
  return data;
}

const BATCH = 24;
const CONCURRENCY = 4;

async function buildType(type, token, dryRun) {
  process.stdout.write(`[${type}] D1'den okunuyor... `);
  const rows = fetchRows(type);
  console.log(`${rows.length} satır`);

  const docs = [];
  for (const row of rows) {
    const text = DOC_OF[type](row);
    docs.push({ slug: row.slug, text, hash: await docHash(text) });
  }
  const avg = Math.round(docs.reduce((s, d) => s + d.text.length, 0) / Math.max(1, docs.length));
  console.log(`[${type}] ${docs.length} belge, ortalama ${avg} karakter`);
  if (dryRun) {
    console.log(`[${type}] --dry-run: örnek belge ->`, JSON.stringify(docs[0] && docs[0].text.slice(0, 220)));
    return;
  }

  // Partiler CONCURRENCY kadar paralel çalışır. Bir partinin hatası TÜM koşuyu düşürmez:
  // o varlıklar sıfır vektörle dizine girer (anlamsal aday olmazlar, sözlüksel yol çalışmaya
  // devam eder) ve bir sonraki cron turu hash'leri değişmiş göreceğinden onları yeniden dener.
  const batches = [];
  for (let i = 0; i < docs.length; i += BATCH) batches.push({ start: i, docs: docs.slice(i, i + BATCH) });
  const vectors = new Int8Array(docs.length * EMBED_DIM);
  let done = 0;
  let failed = 0;

  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const b = batches[cursor++];
      try {
        const vecs = await embedBatch(token, b.docs.map(d => d.text));
        for (let i = 0; i < b.docs.length; i++) {
          vectors.set(quantizeUnit(vecs[i]), (b.start + i) * EMBED_DIM);
        }
      } catch (err) {
        failed += b.docs.length;
        console.error(`[${type}] parti ${b.start} başarısız: ${err.message}`);
      }
      done += b.docs.length;
      process.stdout.write(`\r[${type}] embedding ${done}/${docs.length}   `);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write('\n');
  if (failed) console.warn(`[${type}] ${failed} belge embed edilemedi (sıfır vektörle yazılacak)`);

  const buf = packIndex({
    type, dim: EMBED_DIM, model: EMBED_MODEL, built: new Date().toISOString(),
    items: docs.map(d => ({ s: d.slug, h: d.hash })),
    vectors,
  });
  const tmp2 = mkdtempSync(join(tmpdir(), 'mimarlab-vindex-out-'));
  const outFile = join(tmp2, `${type}.bin`);
  writeFileSync(outFile, Buffer.from(buf));
  console.log(`[${type}] paket ${(buf.byteLength / 1048576).toFixed(2)} MB -> KV ${indexKvKey(type)}`);
  try {
    execFileSync('npx', [
      'wrangler', 'kv', 'key', 'put', indexKvKey(type),
      '--path', outFile, '--binding', 'FACET_CACHE', '--remote',
    ], { cwd: ROOT, stdio: 'inherit' });
  } finally {
    rmSync(tmp2, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const typeArg = args.includes('--type') ? args[args.indexOf('--type') + 1] : null;
const types = typeArg ? [typeArg] : ['project', 'product'];

const token = dryRun ? '' : oauthToken();
for (const t of types) {
  if (!SQL[t]) throw new Error(`bilinmeyen tür: ${t}`);
  await buildType(t, token, dryRun);
}
console.log('bitti.');
