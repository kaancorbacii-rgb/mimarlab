#!/usr/bin/env node
// MİMARLAB görsel arama — GÖRSEL-DÜZEYİ SKORLARIN VARLIK SKORUNA TOPLANMA YÖNTEMİNİ KARŞILAŞTIR.
//
// NEDEN BU BETİK VAR (kullanıcı isteği, dördüncü tur denetim, madde 3/4/8): "Mevcut production
// dataset üzerinde score dağılımlarını incele ve yöntemi ölçerek seç... Bir değişiklik yalnızca
// ölçülebilir iyileşme gösteriyorsa uygula." Mevcut yöntem (imageEmbedIndex.js#aggregateEntityScore
// — azalan ağırlıklı top-4: 0.5/0.3/0.15/0.05) hiç KARŞILAŞTIRILMADAN seçilmişti (gerekçe akla
// yatkındı ama ÖLÇÜLMEMİŞTİ). Bu betik AYNI held-out yöntemini (scripts/visual-search-calibration-
// bench.mjs — her varlığın kendi görsellerinden biri sorgu olarak ayrılıp geri kalanında aranıyor)
// KULLANIR ama TEK bir sabit formül yerine BİRDEN ÇOK aday formülü aynı gerçek veri üzerinde koşup
// Top-1/Top-5'i karşılaştırır.
//
// ADAY YÖNTEMLER:
//   max            — yalnızca en yüksek tek görsel skoru (brief'in açıkça uyardığı "tek tesadüfi
//                     yükseğe bağlı kalma" hatası — kasıtlı olarak KÖTÜ bir taban çizgisi olarak dahil)
//   mean_all       — varlığın TÜM görsellerinin ortalaması (brief'in diğer uyarısı: "çok sayıda vasat
//                     açı, tek mükemmel eşleşmeyi boğar" — bu da kasıtlı kötü bir taban çizgisi)
//   top2_mean      — en iyi 2 görselin düz ortalaması
//   top3_mean      — en iyi 3 görselin düz ortalaması
//   current_wtopk  — MEVCUT production formülü (azalan ağırlık 0.5/0.3/0.15/0.05, imageEmbedIndex.js)
//   consistency    — max + TUTARLILIK bonusu: max'a yakın (max - 0.05 içinde) kaç görsel varsa buna
//                     orantılı küçük bir ek puan. "Birden fazla görselin sorguyla TUTARLI eşleşmesi"
//                     fikrini (brief madde 3) `current_wtopk`'tan FARKLI bir matematikle dener.
//
// KULLANIM: node scripts/visual-search-aggregation-ablation.mjs [--sample N]

import { unpackImageIndex, imageIndexKvKey, imageCosineScores } from '../src/lib/imageEmbedIndex.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const KV_NAMESPACE_ID = '9a8a1cfde13447a498bc5dcc4bc7d4ae';

function oauthToken() {
  const toml = readFileSync(join(process.env.HOME, 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  return toml.match(/oauth_token\s*=\s*"([^"]+)"/)[1];
}
const TOKEN = oauthToken();

async function kvGetBinary(key) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV hatası ${res.status}`);
  return await res.arrayBuffer();
}

// ---------------------------------------------------------------------------------------------
// ADAY AGGREGATION FONKSİYONLARI — her biri sıralanmış (azalan) bir görsel-skor dizisi alır,
// tek bir varlık skoru döner. imageEmbedIndex.js#AGG_WEIGHTS İLE AYNI kelepçe (en fazla ilk 4
// terimi kullanır current_wtopk'ta) — karşılaştırma adil olsun diye diğerleri de sınırsız/mantıklı
// kendi kurallarını uygular.
// ---------------------------------------------------------------------------------------------
const METHODS = {
  max: (sorted) => sorted[0] ?? 0,
  mean_all: (sorted) => sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
  top2_mean: (sorted) => {
    const top = sorted.slice(0, 2);
    return top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
  },
  top3_mean: (sorted) => {
    const top = sorted.slice(0, 3);
    return top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
  },
  current_wtopk: (sorted) => {
    const W = [0.5, 0.3, 0.15, 0.05];
    let sum = 0, wsum = 0;
    for (let i = 0; i < Math.min(sorted.length, W.length); i++) { sum += sorted[i] * W[i]; wsum += W[i]; }
    return wsum ? sum / wsum : 0;
  },
  consistency: (sorted) => {
    if (!sorted.length) return 0;
    const max = sorted[0];
    const supporting = sorted.filter(s => s >= max - 0.05).length - 1; // max hariç kaç görsel "destekliyor"
    const bonus = Math.min(0.06, supporting * 0.02); // en fazla +0.06, aşırı şişirmesin diye kelepçeli
    return Math.min(1, max + bonus);
  },
};

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function runMethod(index, methodFn, sample) {
  let top1 = 0, top5 = 0;
  for (const heldOutEntity of sample) {
    const heldOutRow = heldOutEntity.offset;
    const query = index.rowOf(heldOutRow);
    const scores = imageCosineScores(index, query);
    scores[heldOutRow] = -1; // kendisiyle trivial eşleşmeyi devre dışı bırak

    const results = [];
    for (const e of index.entities) {
      if (!e.c) { results.push([e.s, 0]); continue; }
      const rows = [];
      for (let i = 0; i < e.c; i++) rows.push(scores[e.offset + i]);
      rows.sort((a, b) => b - a);
      results.push([e.s, methodFn(rows)]);
    }
    results.sort((a, b) => b[1] - a[1]);
    const rank = results.findIndex(([slug]) => slug === heldOutEntity.s);
    if (rank === 0) top1++;
    if (rank >= 0 && rank < 5) top5++;
  }
  return { top1: top1 / sample.length, top5: top5 / sample.length, n: sample.length };
}

async function main() {
  const args = process.argv.slice(2);
  const sampleIdx = args.indexOf('--sample');
  const sampleCap = sampleIdx >= 0 ? Number(args[sampleIdx + 1]) : null;

  console.log('Gerçek görsel dizinleri KV\'den yükleniyor...');
  const [projBuf, prodBuf] = await Promise.all([
    kvGetBinary(imageIndexKvKey('project')), kvGetBinary(imageIndexKvKey('product')),
  ]);
  const projectIndex = projBuf ? unpackImageIndex(projBuf) : null;
  const productIndex = prodBuf ? unpackImageIndex(prodBuf) : null;
  if (!projectIndex || !productIndex) { console.error('Dizin eksik.'); process.exit(1); }

  for (const [label, index] of [['PROJE', projectIndex], ['ÜRÜN', productIndex]]) {
    const eligible = index.entities.filter(e => e.c >= 2);
    const sample = sampleCap && eligible.length > sampleCap
      ? eligible.filter((_, i) => i % Math.ceil(eligible.length / sampleCap) === 0).slice(0, sampleCap)
      : eligible;
    console.log(`\n=== ${label} (n=${sample.length}, uygun varlık: ${eligible.length}) ===`);
    const rows = [];
    for (const [name, fn] of Object.entries(METHODS)) {
      const t0 = Date.now();
      const r = runMethod(index, fn, sample);
      rows.push({ name, ...r, ms: Date.now() - t0 });
    }
    rows.sort((a, b) => b.top1 - a.top1);
    for (const r of rows) {
      const marker = r.name === 'current_wtopk' ? '  <- MEVCUT PRODUCTION' : '';
      console.log(`  ${r.name.padEnd(14)} Top-1=${(r.top1 * 100).toFixed(1)}%  Top-5=${(r.top5 * 100).toFixed(1)}%  (${r.ms}ms)${marker}`);
    }
  }

  console.log('\n--- SONUÇ ---');
  console.log('Sıralama Top-1\'e göre azalan; en üstteki yöntem bu ölçümde en iyi performansı gösterdi.');
  console.log('current_wtopk açıkça ve TUTARLI biçimde (hem proje hem ürün) geçilmedikçe DEĞİŞİKLİK YAPILMAYACAK.');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
