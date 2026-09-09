#!/usr/bin/env node
// TEK SEFERLİK SEED — TELİF/YAYIN HAKKI KİLİTLEME (kullanıcı isteği, 2026-09-09).
//
// migrations/0106_media_rights.sql yalnızca tabloları açar; canlıdaki ~10.000 proje görselinin hak
// KAYITLARINI bu betik üretir. Kullanıcının açık kararı (2026-09-09):
//
//   KATI MOD  — her şey 'unknown' + public_original_allowed=0 (kilitli) başlar.
//   İSTİSNA   — PROFİLİNİ SAHİPLENMİŞ kullanıcıların içeriği: o kişilerin/firmaların projeleri ve
//               görselleri doğrudan 'approved' + public_original_allowed=1 + is_copyright_approved=1.
//
// "Sahiplenilmiş" tanımı, sitenin başka yerlerinde ZATEN kullanılan tanımın aynısıdır (yeni bir
// sahiplik kavramı icat edilmedi) — src/lib/mediaRights.js#isProjectClaimBacked ile BİREBİR aynı
// üç yol: (a) projects.claimed_by_user_id, (b) künyedeki architects/offices.claimed_by_user_id,
// (c) künyedeki ad için onaylı profile_claims. Üçü de gerekli, çünkü sahiplik bu depoda üç ayrı
// izden okunabiliyor (bkz. proje notu: "Profil sahipliğinin İKİ yolu" + "Atamanın İKİ admin yolu").
//
// İDEMPOTENT: zaten hak satırı olan (entity_type,entity_id,media_url) üçlüsüne DOKUNULMAZ
// (INSERT OR IGNORE) — betik tekrar çalıştırıldığında elle verilmiş onayları/ihtilafları geri almaz.
//
// Kullanım:
//   node scripts/backfill-media-rights.mjs                 # yalnızca RAPOR, hiçbir şey yazmaz
//   node scripts/backfill-media-rights.mjs --apply         # SQL dosyaları üretir (uygulamaz)
// Üretilen dosyalar sırayla:
//   npx wrangler d1 execute mimarlab-db --remote --file=<dosya>
//
// TOPLU IMPORT'LARDAN SONRA TEKRAR ÇALIŞTIR. Canonical projects satırını yazan TEK uygulama kodu
// src/lib/canonicalSync.js#syncProject'tir ve o, hak kayıtlarını kendisi kurar (syncProjectMediaRights).
// Ama scripts/ altındaki toplu içe aktarma betikleri D1'e DOĞRUDAN yazar, o yoldan geçmez — yani
// import edilen projelerin görselleri hak kaydı OLMADAN kalır ve kapı onları tanımadığı için açık
// görünür. Her import partisinden sonra bu betiği yeniden çalıştırmak yeterlidir (idempotent).
//
// NOT (wrangler oturumu): 10.000 satırlık bir seed birden fazla dosya üretir ve uygulanması uzun
// sürebilir; wrangler'ın OAuth token'ı ~1 saatte dolar (bkz. proje notu) — dosyaları arka arkaya
// uygularken 7403 alırsan `npx wrangler whoami` ile oturumu tazeleyip KALDIĞIN dosyadan devam et
// (INSERT OR IGNORE sayesinde tekrar uygulamak zararsızdır).

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { collectEntityMediaUrls, normalizeMediaPath } from '../src/lib/mediaRights.js';

const APPLY = process.argv.includes('--apply');
// --check-derivatives[=N|all] — KİLİTLİ görsellerin güvenli sürümünün (w400/w800 türevi) GERÇEKTEN
// var olup olmadığını canlıdan ölçer. Bu ölçüm bu sistemin tek "yumuşak" bağımlılığıdır: kilitli
// içerikte orijinale ASLA düşülmediğinden (bkz. src/routes/media.js#readSafeBytes), türevi olmayan
// bir görsel ziyaretçiye bulanık fotoğraf yerine KİLİT YER TUTUCUSU olarak görünür.
// İlk ölçüm (2026-09-09, 36 görsellik örnek): w400 kapsamı ~%94 — yani ~1.400 kilitli görselin
// türevi eksik. Eksikler mevcut hatla kapatılır: scripts/generate-image-derivatives.py.
const CHECK_ARG = process.argv.find(a => a.startsWith('--check-derivatives'));
const CHECK_N = CHECK_ARG ? (CHECK_ARG.split('=')[1] || '200') : null;
const OUT_DIR = 'scripts/.out/media-rights-backfill';
const STATEMENTS_PER_FILE = 2000;

function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'mimarlab-db', '--remote', '--json', '--command', sql], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const start = out.indexOf('[');
  let depth = 0, end = null;
  for (let i = start; i < out.length; i++) {
    if (out[i] === '[') depth++;
    else if (out[i] === ']' && --depth === 0) { end = i + 1; break; }
  }
  return JSON.parse(out.slice(start, end))[0].results;
}

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

// src/lib/mediaRights.js#isProjectClaimBacked ile BİREBİR AYNI koşul — ikisi ayrışırsa seed ile
// çalışma zamanı farklı projeleri "sahiplenilmiş" sayar.
const CLAIM_BACKED_SQL = `
  p.claimed_by_user_id IS NOT NULL
  OR EXISTS (SELECT 1 FROM project_designers pd
               LEFT JOIN architects a ON a.id = pd.architect_id AND a.deleted_at IS NULL
               LEFT JOIN offices o ON o.id = pd.office_id AND o.deleted_at IS NULL
              WHERE pd.project_id = p.id
                AND (a.claimed_by_user_id IS NOT NULL OR o.claimed_by_user_id IS NOT NULL))
  OR EXISTS (SELECT 1 FROM project_designers pd
               LEFT JOIN architects a ON a.id = pd.architect_id AND a.deleted_at IS NULL
               LEFT JOIN offices o ON o.id = pd.office_id AND o.deleted_at IS NULL
               JOIN profile_claims c ON c.status = 'approved'
                    AND (c.profile_key = a.name OR c.profile_key = o.name)
              WHERE pd.project_id = p.id)`;

const rows = d1(`
  SELECT p.id, p.slug, p.images, p.photo_credit_text,
         CASE WHEN ${CLAIM_BACKED_SQL} THEN 1 ELSE 0 END AS claim_backed
    FROM projects p
   WHERE p.deleted_at IS NULL`);

const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
const statements = [];
const approvedProjectIds = [];
// Kapsam ölçümü için: KİLİTLİ kalacak her medyanın normalize yolu (dört tip birden).
const lockedTargets = [];
let totalImages = 0;
let approvedImages = 0;
let lockedImages = 0;
let externalImages = 0;
let projectsWithImages = 0;

for (const row of rows) {
  let images = [];
  try { images = row.images ? JSON.parse(row.images) : []; } catch { images = []; }
  if (!Array.isArray(images)) images = [];
  images = images.filter(u => typeof u === 'string' && u.trim());
  if (!images.length) continue;
  projectsWithImages++;

  const claimBacked = Number(row.claim_backed) === 1;
  if (claimBacked) approvedProjectIds.push(row.id);

  images.forEach((url, i) => {
    totalImages++;
    const path = normalizeMediaPath(url);
    if (!path) externalImages++;
    if (claimBacked) approvedImages++; else { lockedImages++; if (path) lockedTargets.push(path); }
    statements.push(
      `INSERT OR IGNORE INTO media_rights (id, entity_type, entity_id, media_url, media_path, sort_order,` +
      ` rights_status, public_original_allowed, photographer, content_origin, rights_verified_at, created_at, updated_at)` +
      ` VALUES (${q(randomUUID())}, 'project', ${row.id}, ${q(url)}, ${q(path)}, ${i},` +
      ` ${claimBacked ? "'approved'" : "'unknown'"}, ${claimBacked ? 1 : 0}, ${q(row.photo_credit_text || null)},` +
      ` ${claimBacked ? "'owner_submitted'" : "'platform_curated'"}, ${claimBacked ? q(now) : 'NULL'}, ${q(now)}, ${q(now)});`
    );
  });
}

// Proje düzeyi onay, görsel satırlarından SONRA yazılır: trigger'lar rights_bucket'ı her iki
// yazımda da yeniden hesaplar, ama sıralamanın doğru oturması için önce medyanın var olması gerekir
// (aksi halde is_copyright_approved=1 yazıldığı anda "onaylı medya yok" görülüp bucket 1 kalırdı ve
// ancak sonraki medya yazımında düzelirdi — sonuç aynı, sıra yalnızca ara durumu temiz tutar).
for (let i = 0; i < approvedProjectIds.length; i += 200) {
  const chunk = approvedProjectIds.slice(i, i + 200);
  statements.push(`UPDATE projects SET is_copyright_approved = 1 WHERE id IN (${chunk.join(',')});`);
}

// ---------------------------------------------------------------------------------------------
// DİĞER ÜÇ TİP (kullanıcı isteği, 2026-09-09 ikinci tur): ürün, kişi, firma/marka.
// Kural proje ile AYNI: sahiplenilmemişse kilitli, sahiplenilmişse açık. "Sahiplenilmiş" tanımı
// src/lib/mediaRights.js#isEntityClaimBacked ile BİREBİR aynı olmalı — ikisi ayrışırsa seed ile
// çalışma zamanı farklı kayıtları sahiplenilmiş sayar.
// ---------------------------------------------------------------------------------------------
const EXTRA_TYPES = [
  {
    type: 'architect', table: 'architects', cols: 'id, photo_url, portfolio',
    claimSql: `a.claimed_by_user_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM profile_claims c WHERE c.status='approved' AND c.profile_type='architect'
                   AND (c.profile_key = a.name OR c.profile_key = a.legacy_key))`,
    alias: 'a',
  },
  {
    type: 'office', table: 'offices', cols: 'id, logo_url, cover_url',
    claimSql: `o.claimed_by_user_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM profile_claims c WHERE c.status='approved' AND c.profile_type='office'
                   AND (c.profile_key = o.name OR c.profile_key = o.legacy_key))`,
    alias: 'o',
  },
  {
    type: 'product', table: 'products', cols: 'id, images, variants',
    claimSql: `pr.claimed_by_user_id IS NOT NULL
      OR bo.claimed_by_user_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM profile_claims c WHERE c.status='approved' AND c.profile_type='office'
                   AND (c.profile_key = bo.name OR c.profile_key = bo.legacy_key OR c.profile_key = pr.brand_name_raw))`,
    alias: 'pr',
    join: 'LEFT JOIN offices bo ON bo.id = pr.brand_office_id AND bo.deleted_at IS NULL',
  },
];

const extraStats = {};
for (const cfg of EXTRA_TYPES) {
  const prefixed = cfg.cols.split(', ').map(c => `${cfg.alias}.${c}`).join(', ');
  const rows2 = d1(`
    SELECT ${prefixed}, CASE WHEN ${cfg.claimSql} THEN 1 ELSE 0 END AS claim_backed
      FROM ${cfg.table} ${cfg.alias} ${cfg.join || ''}
     WHERE ${cfg.alias}.deleted_at IS NULL`);
  let open = 0;
  let locked = 0;
  let entities = 0;
  const openIds = [];
  for (const row of rows2) {
    const urls = collectEntityMediaUrls(row, cfg.type);
    if (!urls.length) continue;
    entities++;
    const claimBacked = Number(row.claim_backed) === 1;
    if (claimBacked) openIds.push(row.id);
    urls.forEach((url, i) => {
      const npath = normalizeMediaPath(url);
      if (claimBacked) open++; else { locked++; if (npath) lockedTargets.push(npath); }
      statements.push(
        `INSERT OR IGNORE INTO media_rights (id, entity_type, entity_id, media_url, media_path, sort_order,` +
        ` rights_status, public_original_allowed, content_origin, rights_verified_at, created_at, updated_at)` +
        ` VALUES (${q(randomUUID())}, ${q(cfg.type)}, ${row.id}, ${q(url)}, ${q(npath)}, ${i},` +
        ` ${claimBacked ? "'approved'" : "'unknown'"}, ${claimBacked ? 1 : 0},` +
        ` ${claimBacked ? "'owner_submitted'" : "'platform_curated'"}, ${claimBacked ? q(now) : 'NULL'}, ${q(now)}, ${q(now)});`
      );
    });
  }
  extraStats[cfg.type] = { entities, open, locked, openEntities: openIds.length };
}

console.log('--- TELİF SEED RAPORU ---');
console.log(`Görselli proje              : ${projectsWithImages}`);
console.log(`Sahiplenilmiş (açık) proje  : ${approvedProjectIds.length}`);
console.log(`Kilitli kalan proje         : ${projectsWithImages - approvedProjectIds.length}`);
console.log(`Toplam görsel               : ${totalImages}`);
console.log(`  -> approved + orijinal açık: ${approvedImages}`);
console.log(`  -> kilitli (unknown)       : ${lockedImages}`);
console.log(`  -> harici host (güvenli sürüm üretilemez, yer tutucu gösterilir): ${externalImages}`);
for (const [type, st] of Object.entries(extraStats)) {
  const label = { architect: 'KİŞİ', office: 'FİRMA/MARKA', product: 'ÜRÜN' }[type] || type;
  console.log(`--- ${label} ---`);
  console.log(`  medyalı kayıt             : ${st.entities} (açık ${st.openEntities} / kilitli ${st.entities - st.openEntities})`);
  console.log(`  görsel                    : açık ${st.open} / kilitli ${st.locked}`);
}
console.log(`Üretilecek ifade            : ${statements.length}`);

if (CHECK_N) await reportDerivativeCoverage();

if (!APPLY) {
  console.log('\n(rapor modu — hiçbir dosya yazılmadı. SQL üretmek için --apply ekle.)');
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
const files = [];
for (let i = 0; i < statements.length; i += STATEMENTS_PER_FILE) {
  const part = String(files.length + 1).padStart(3, '0');
  const file = `${OUT_DIR}/${part}.sql`;
  writeFileSync(file, statements.slice(i, i + STATEMENTS_PER_FILE).join('\n') + '\n', 'utf8');
  files.push(file);
}
console.log(`\n${files.length} dosya yazıldı:`);
for (const f of files) console.log(`  npx wrangler d1 execute mimarlab-db --remote --file=${f}`);

// -------------------------------------------------------------------------------------------------
// GÜVENLİ SÜRÜM KAPSAM ÖLÇÜMÜ
// -------------------------------------------------------------------------------------------------
// Türevin varlığı HTTP başlığından anlaşılır: gerçek türev `immutable` ile döner, türev YOKSA
// handleMediaRoute orijinale düşer ve `max-age=3600` yazar (bkz. src/routes/upload.js#
// DERIVED_FALLBACK_EDGE_MAX_AGE_SECONDS). R2 listelemeye gerek yok, HEAD yeterli.
async function reportDerivativeCoverage() {
  // DÖRT TİPİN DE kilitli medyası ölçülür. Kişi fotoğrafları ve firma logoları ZATEN küçük
  // (mimarlar-thumb/, logos-thumb/) olduğundan türev üretimi onlarda daha sık atlanmıştır —
  // ölçüm bu yüzden proje dışı tipler için en az proje kadar önemli.
  //
  // ZATEN KAYITLI (ve dolayısıyla KAPIDAN GEÇMEYEN) yollar ölçüm dışı bırakılır. Ölçüm yöntemi
  // türev URL'sine HEAD atıp `immutable` başlığı aramaktır; ama kilit CANLIYA ALINDIKTAN sonra o
  // URL kapıdan 404 döner ve yöntem "türev yok" ile "kapı kapattı"yı ayırt edemez — canlıda
  // doğrulandı: seed'li proje medyası bu yüzden %93 "eksik" görünüyordu, oysa türevleri tamdı.
  // Kayıtlı medyanın kapsamı ZATEN kaydedilmeden ÖNCE ölçülmüştür; burada ölçülmesi gereken,
  // HENÜZ kaydedilmemiş (yani bir sonraki --apply ile kilitlenecek) medyadır.
  let registered = new Set();
  try {
    registered = new Set(d1('SELECT DISTINCT media_path FROM media_rights WHERE media_path IS NOT NULL')
      .map(r => r.media_path));
  } catch { /* tablo henüz yoksa hepsi ölçülür */ }
  const targets = [...new Set(lockedTargets)].filter(p => !registered.has(p));
  if (registered.size) {
    console.log(`(${registered.size} yol zaten kayıtlı/kapıda — ölçüm dışı, kapsamları kayıttan ÖNCE doğrulandı)`);
  }
  const all = CHECK_N === 'all';
  const sample = all ? targets : shuffle(targets).slice(0, Number(CHECK_N) || 200);
  console.log(`\n--- GÜVENLİ SÜRÜM KAPSAMI (${sample.length}/${targets.length} kilitli görsel) ---`);

  // Eşzamanlı HEAD — 23 bin görselin tamamı sırayla taranırsa ~1 saat sürer. 20 paralel istek,
  // yalnızca HEAD olduğu (gövde inmiyor) ve hepsi edge'den yanıtlandığı için origin'e yük bindirmez.
  const missing = [];
  let checked = 0;
  const CONCURRENCY = 20;
  const queue = sample.slice();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const path = queue.shift();
      if (path === undefined) return;
      const ok = await hasDerivative(path, 400) || await hasDerivative(path, 800);
      if (!ok) missing.push(path);
      if (++checked % 500 === 0) process.stdout.write(`  ${checked}/${sample.length}\r`);
    }
  }));
  missing.sort();
  const ratio = sample.length ? (missing.length / sample.length) : 0;
  console.log(`Türevi eksik: ${missing.length}/${sample.length} (%${(ratio * 100).toFixed(1)})`);
  if (!all) console.log(`Tüm kilitli görsellere oranlanan tahmin: ~${Math.round(ratio * targets.length)} görsel yer tutucu gösterir.`);
  if (missing.length) {
    mkdirSync(OUT_DIR, { recursive: true });
    const file = `${OUT_DIR}/missing-derivatives.txt`;
    writeFileSync(file, missing.join('\n') + '\n', 'utf8');
    console.log(`Eksik yolların listesi: ${file}`);
    console.log('Kapatmak için: python3 scripts/generate-image-derivatives.py (bkz. o betiğin kullanımı)');
  }
}

async function hasDerivative(localPath, width) {
  const clean = localPath.replace(/^\/+/, '');
  const key = clean.startsWith('media/')
    ? `_derived/w${width}/r2/${clean.slice('media/'.length)}`
    : `_derived/w${width}/s/${clean}`;
  try {
    // CACHE BUSTER ŞART: türev YOKKEN yapılan bir HEAD, orijinale geri düşen yanıtı edge'de 1 saat
    // saklar (bkz. src/routes/upload.js#DERIVED_FALLBACK_EDGE_MAX_AGE_SECONDS). Türev üretildikten
    // hemen sonra yapılan ölçüm, bu bayat girdi yüzünden "hâlâ eksik" der. Benzersiz sorgu dizesi
    // Worker'ın cache anahtarını değiştirir ve gerçek durumu okutur.
    const res = await fetch(`https://mimarlab.com/media/${key}?cb=${Date.now()}-${Math.random().toString(36).slice(2)}`, { method: 'HEAD' });
    return res.ok && /immutable/.test(res.headers.get('cache-control') || '');
  } catch { return false; }
}

function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
