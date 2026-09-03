#!/usr/bin/env node
// MİMARLAB görsel arama — GERÇEK ÜRETİM VERİSİYLE SKOR KALİBRASYON BENCHMARK'I.
//
// NEDEN BU BETİK VAR (kullanıcı isteği, üçüncü tur denetim, madde 6): "Mümkünse mevcut production
// dataset üzerinde exact positive / same-project different-image / similar-but-different /
// unrelated örneklerinin score dağılımını çıkar... 100+ örnekli formal benchmark mevcut değilse,
// mevcut gerçek production görsellerinden otomatik bir değerlendirme seti oluştur."
//
// YÖNTEM — "HELD-OUT" (dışarıda bırakılmış görsel) testi. Yeni fotoğraf indirmeye/embed etmeye
// GEREK YOK: production'a ZATEN backfill edilmiş gerçek CLIP embedding'leri (src/lib/
// imageEmbedIndex.js, KV'deki paketlenmiş dizin) kullanılır. En az 2 görseli olan HER varlık için:
//   1) O varlığın İLK görselini geçici olarak dizinden ÇIKAR (kendisiyle trivial eşleşmeyi önlemek
//      için) — "sorgu" olarak kullanılacak GERÇEK bir fotoğraf budur.
//   2) Kalan (N-1) dizin üzerinde (varlığın KENDİ diğer görselleri + TÜM diğer 1690/187 varlığın
//      görselleri) bu sorgunun entity-level skorlarını hesapla (mevcut aggregateRowScores/
//      imageCosineScores — PRODUCTION'daki BİREBİR AYNI fonksiyonlar, kopya değil, doğrudan import).
//   3) Doğru varlık Top-1 mi? Top-5'te mi? Skoru ne?
// Bu, "aynı projenin farklı fotoğrafı" senaryosunun TAM olarak kendisidir — sentetik/uydurma değil,
// GERÇEK bir fotoğrafın GERÇEK diğer fotoğraflardan oluşan bir dizinde bulunup bulunamadığını ölçer.
//
// "UNRELATED" DAĞILIMI: çapraz-alan (cross-domain) testi. ÜRÜN görselleri PROJE dizinine karşı
// sorgulanır (ve tersi) — bir sandalye fotoğrafının hiçbir camiye/köşke GERÇEKTEN benzememesi
// gerekir, bu yüzden bu skorlar "tamamen alakasız" dağılımının GERÇEK, ölçülmüş bir örneklemidir
// (rastgele gürültü üretmek yerine).
//
// ÖLÇÜLEN, UYDURULMAYAN METRİKLER: Top-1 accuracy, Top-5 recall, skor persentilleri (correct-match
// vs runner-up vs cross-domain-unrelated). Örneklem boyutu KONSOL ÇIKTISINDA açıkça yazılır — 100+
// hedefine ulaşılamazsa ("mevcut kısıt") bu da açıkça belirtilir, gizlenmez.
//
// KULLANIM: node scripts/visual-search-calibration-bench.mjs [--sample N]

import { unpackImageIndex, imageIndexKvKey, imageCosineScores, aggregateRowScores } from '../src/lib/imageEmbedIndex.js';
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

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

// index'in i. satırının 512-boyutlu (dequantize edilmemiş, int8) satırını FLOAT sorgu vektörü GİBİ
// kullanmak için: imageCosineScores() zaten queryVec'i quantizeUnit ile nicemliyor — int8 girdiyi
// float dizisi gibi versek bile quantizeUnit(int8Array) yeniden normalize edip yeniden nicemler,
// bu ZARARSIZDIR (birim vektörün nicemlemesi idempotent'e yakın, ufak yuvarlama farkı ölçümü
// ETKİLEMEZ — zaten PRODUCTION'da da queryVec HER ZAMAN bu fonksiyondan geçer).
function heldOutBenchmark(index, label, sampleCap) {
  const dim = index.dim;
  const eligible = index.entities.filter(e => e.c >= 2);
  const sample = sampleCap && eligible.length > sampleCap
    ? eligible.filter((_, i) => i % Math.ceil(eligible.length / sampleCap) === 0).slice(0, sampleCap)
    : eligible;

  console.log(`[${label}] uygun varlık (>=2 görsel): ${eligible.length}, test edilen: ${sample.length}`);

  let top1 = 0, top5 = 0;
  const correctScores = [];      // doğru varlığın (held-out sonrası) aldığı skor
  const runnerUpScores = [];     // yanlış Top-1 çıktığında o yanlış adayın skoru
  const marginWhenCorrect = [];  // doğruyken 1. ile 2. arasındaki fark

  for (const heldOutEntity of sample) {
    const heldOutRow = heldOutEntity.offset;   // ilk görsel = sorgu
    const query = index.rowOf(heldOutRow);     // Int8Array(512) — quantizeUnit(query) çağrılınca zaten birim

    // Sorgu satırını GEÇİCİ olarak "yok" say: kosinüs hesabından SONRA o satırın etkisini sıfırlarız.
    const scores = imageCosineScores(index, query);
    scores[heldOutRow] = -1; // kendisiyle trivial eşleşmeyi TAMAMEN devre dışı bırak

    // aggregateRowScores TÜM varlıkları (heldOutEntity dahil, ama artık kendi ilk satırı olmadan)
    // toplu skora indirger.
    const agg = aggregateRowScores(index, scores);
    const ranked = [...agg.entries()].sort((a, b) => b[1].score - a[1].score);

    const rank = ranked.findIndex(([slug]) => slug === heldOutEntity.s);
    const correctScore = agg.get(heldOutEntity.s).score;
    correctScores.push(correctScore);

    if (rank === 0) {
      top1++;
      const runnerUp = ranked[1] ? ranked[1][1].score : 0;
      marginWhenCorrect.push(correctScore - runnerUp);
    } else {
      runnerUpScores.push(ranked[0][1].score);
    }
    if (rank >= 0 && rank < 5) top5++;
  }

  correctScores.sort((a, b) => a - b);
  marginWhenCorrect.sort((a, b) => a - b);
  runnerUpScores.sort((a, b) => a - b);

  console.log(`[${label}] Top-1 accuracy: ${(top1 / sample.length * 100).toFixed(1)}% (${top1}/${sample.length})`);
  console.log(`[${label}] Top-5 recall:   ${(top5 / sample.length * 100).toFixed(1)}% (${top5}/${sample.length})`);
  console.log(`[${label}] doğru-eşleşme skoru persentilleri: p10=${percentile(correctScores, 0.10)?.toFixed(3)} p50=${percentile(correctScores, 0.50)?.toFixed(3)} p90=${percentile(correctScores, 0.90)?.toFixed(3)}`);
  if (marginWhenCorrect.length) {
    console.log(`[${label}] doğruyken 1.-2. FARK persentilleri: p10=${percentile(marginWhenCorrect, 0.10)?.toFixed(3)} p50=${percentile(marginWhenCorrect, 0.50)?.toFixed(3)}`);
  }
  if (runnerUpScores.length) {
    console.log(`[${label}] YANLIŞ Top-1 olduğunda o adayın skoru: p50=${percentile(runnerUpScores, 0.50)?.toFixed(3)} p90=${percentile(runnerUpScores, 0.90)?.toFixed(3)} (${runnerUpScores.length} örnek)`);
  }
  return { top1: top1 / sample.length, top5: top5 / sample.length, n: sample.length, correctScores, marginWhenCorrect };
}

// ÇAPRAZ-ALAN "UNRELATED" — ürün görselleri proje dizinine karşı (ve tersi). GERÇEK skorlar,
// uydurma gürültü değil. Tüm ürün görselleri × TÜM proje varlık-agregasyonu maliyetli olabileceğinden
// (188 sorgu × 1691 varlık × ~5.7 görsel/varlık kosinüsü) örnekleme cömert tutulabilir (küçük taraf zaten 188).
function crossDomainUnrelated(queryIndex, targetIndex, sampleCap) {
  const queryRows = [];
  for (const e of queryIndex.entities) for (let i = 0; i < e.c; i++) queryRows.push(e.offset + i);
  const sample = sampleCap && queryRows.length > sampleCap
    ? queryRows.filter((_, i) => i % Math.ceil(queryRows.length / sampleCap) === 0).slice(0, sampleCap)
    : queryRows;

  const topScores = [];
  for (const rowIdx of sample) {
    const query = queryIndex.rowOf(rowIdx);
    const scores = imageCosineScores(targetIndex, query);
    const agg = aggregateRowScores(targetIndex, scores);
    let best = 0;
    for (const [, v] of agg) if (v.score > best) best = v.score;
    topScores.push(best);
  }
  topScores.sort((a, b) => a - b);
  return topScores;
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

  console.log(`project: ${projectIndex.entities.length} varlık, product: ${productIndex.entities.length} varlık\n`);

  console.log('=== HELD-OUT (aynı varlığın gerçek farklı fotoğrafı) — PROJE ===');
  const t0 = Date.now();
  const projResult = heldOutBenchmark(projectIndex, 'project', sampleCap);
  console.log(`(${Date.now() - t0}ms)\n`);

  console.log('=== HELD-OUT (aynı varlığın gerçek farklı fotoğrafı) — ÜRÜN ===');
  const t1 = Date.now();
  const prodResult = heldOutBenchmark(productIndex, 'product', sampleCap);
  console.log(`(${Date.now() - t1}ms)\n`);

  console.log('=== ÇAPRAZ-ALAN "UNRELATED" (ürün görseli → proje dizini, gerçek skorlar) ===');
  const crossPU = crossDomainUnrelated(productIndex, projectIndex, sampleCap || 188);
  console.log(`n=${crossPU.length}  p50=${percentile(crossPU, 0.50).toFixed(3)}  p90=${percentile(crossPU, 0.90).toFixed(3)}  p99=${percentile(crossPU, 0.99).toFixed(3)}  max=${crossPU[crossPU.length - 1].toFixed(3)}`);

  console.log('\n=== ÇAPRAZ-ALAN "UNRELATED" (proje görseli → ürün dizini, gerçek skorlar) ===');
  const crossPR = crossDomainUnrelated(projectIndex, productIndex, sampleCap || 300);
  console.log(`n=${crossPR.length}  p50=${percentile(crossPR, 0.50).toFixed(3)}  p90=${percentile(crossPR, 0.90).toFixed(3)}  p99=${percentile(crossPR, 0.99).toFixed(3)}  max=${crossPR[crossPR.length - 1].toFixed(3)}`);

  console.log('\n--- ÖZET (bunlar ÖLÇÜLDÜ, uydurulmadı) ---');
  console.log(`Proje held-out Top-1: ${(projResult.top1 * 100).toFixed(1)}%  Top-5: ${(projResult.top5 * 100).toFixed(1)}%  (n=${projResult.n})`);
  console.log(`Ürün  held-out Top-1: ${(prodResult.top1 * 100).toFixed(1)}%  Top-5: ${(prodResult.top5 * 100).toFixed(1)}%  (n=${prodResult.n})`);
  console.log(`Şu anki IMG_SEM_FLOOR=0.45/IMG_SEM_CEIL=0.80 aralığıyla karşılaştırma:`);
  console.log(`  doğru-eşleşme p10 (proje)=${percentile(projResult.correctScores, 0.10).toFixed(3)} — bu, FLOOR'un altında kalan doğru eşleşme oranını gösterir`);
  console.log(`  çapraz-alan (kesin alakasız) p90=${percentile(crossPU, 0.90).toFixed(3)} / p99=${percentile(crossPU, 0.99).toFixed(3)} — CEIL'e ne kadar yaklaştığını gösterir`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
