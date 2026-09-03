// MİMARLAB görsel arama — varlık dizininin WORKER TARAFI (okuma + artımlı yeniden kurulum).
//
// src/lib/visualIndex.js SAF kalır (Node betiği de import eder); bu dosya ise env'e (AI, KV, D1)
// dokunan tarafı barındırır:
//   * loadIndex()     — KV'den paketlenmiş dizini okur, isolate belleğinde tutar.
//   * embedTexts()    — bge-m3 ile metin embedding'i üretir (TEK toplu çağrı yerine parti parti).
//   * rebuildIndex()  — ARTIMLI yeniden kurulum: yalnızca belgesi DEĞİŞMİŞ varlıkları embed eder
//                       (brief 18). Cron bunu çağırır; ilk kurulum scripts/build-visual-index.mjs
//                       ile yapılır (aynı belge üreticisini kullanır, bkz. visualIndex.js).

import {
  EMBED_MODEL, EMBED_DIM, indexKvKey, packIndex, unpackIndex,
  projectDocFromRow, productDocFromRow, docHash, quantizeUnit,
} from './visualIndex.js';

// ISOLATE-İÇİ ÖNBELLEK. Dizin ~1,8 MB'lık tek bir KV nesnesidir; her istekte yeniden okumak
// gereksiz gecikme demektir. TTL kısa tutulur ki cron'un yazdığı yeni dizin en geç 10 dakikada
// devreye girsin (dizin gecikmesi aramayı BOZMAZ, yalnızca yeni eklenen varlıklar biraz gecikir).
const MEM_TTL_MS = 10 * 60 * 1000;
const memCache = new Map();   // type -> { at, index }

export async function loadIndex(env, type) {
  const hit = memCache.get(type);
  const now = Date.now();
  if (hit && (now - hit.at) < MEM_TTL_MS) return hit.index;
  let index = null;
  try {
    const buf = await env.FACET_CACHE.get(indexKvKey(type), 'arrayBuffer');
    if (buf) index = unpackIndex(buf);
  } catch (err) {
    console.error('visualIndex: KV okunamadı', type, err && err.message);
  }
  // Dizin YOKSA da null önbelleklenir: eksik bir dizinde her istek KV'ye gitmemeli. Arama bu
  // durumda anlamsal katman olmadan (sözlüksel + taksonomik) çalışmaya devam eder.
  memCache.set(type, { at: now, index });
  return index;
}

// bge-m3'e gönderilen parti büyüklüğü. Workers AI toplu embedding kabul eder; parti çok büyük
// olursa tek bir isteğin token sınırı aşılır ve TÜM parti hata verir. 24 × ~700 karakter güvenli
// bölgededir (ölçülen: 1715 proje = 72 çağrı, toplam ~40 sn).
const EMBED_BATCH = 24;

function extractVectors(result) {
  const data = (result && (result.data || (result.result && result.result.data))) || null;
  if (!Array.isArray(data)) return null;
  return data;
}

/**
 * @param {Array<string>} texts
 * @returns {Promise<Array<number[]|null>>} girdiyle AYNI sırada; başarısız parti için null'lar.
 */
export async function embedTexts(env, texts) {
  const out = new Array(texts.length).fill(null);
  for (let start = 0; start < texts.length; start += EMBED_BATCH) {
    const slice = texts.slice(start, start + EMBED_BATCH);
    try {
      const res = await env.AI.run(EMBED_MODEL, { text: slice });
      const vecs = extractVectors(res);
      if (!vecs || vecs.length !== slice.length) {
        console.error('visualIndex: embedding parti biçimi beklenmedik', start, vecs && vecs.length);
        continue;
      }
      for (let i = 0; i < slice.length; i++) out[start + i] = vecs[i];
    } catch (err) {
      // Bir parti başarısız olursa DİĞERLERİ devam eder; o varlıklar bu turda dizinsiz kalır ve
      // bir sonraki cron turunda (hash'leri hâlâ değişik göründüğü için) yeniden denenir.
      console.error('visualIndex: embedding partisi başarısız', start, err && err.message);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// KAYNAK SORGULARI — belgelerin üretildiği TEK SQL. scripts/build-visual-index.mjs bu iki sorguyu
// BİREBİR kopyalar (aynı sütunlar, aynı sıra); farklılaşırlarsa iki taraf farklı doc_hash üretir
// ve cron her turda her şeyi yeniden embed eder.
// ---------------------------------------------------------------------------------------------
export const PROJECT_INDEX_SQL = `
  SELECT p.slug, p.title, p.location, p.location_detail, p.type, p.discipline, p.period,
         p.project_date, p.description,
         (SELECT GROUP_CONCAT(COALESCE(a.name, ofc.name), ', ')
            FROM project_designers pd
            LEFT JOIN architects a ON a.id = pd.architect_id
            LEFT JOIN offices ofc ON ofc.id = pd.office_id
           WHERE pd.project_id = p.id) AS designer_names
    FROM projects p
   WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL
   ORDER BY p.id`;

export const PRODUCT_INDEX_SQL = `
  SELECT pr.slug, pr.title, pr.brand_name_raw, o.name AS brand_office_name, pr.category, pr.kind,
         pr.designer, pr.year, pr.description, pr.specs
    FROM products pr
    LEFT JOIN offices o ON o.id = pr.brand_office_id AND o.deleted_at IS NULL
   WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL
   ORDER BY pr.id`;

export const INDEX_TYPES = {
  project: { sql: PROJECT_INDEX_SQL, docOf: projectDocFromRow },
  product: { sql: PRODUCT_INDEX_SQL, docOf: productDocFromRow },
};

/**
 * ARTIMLI yeniden kurulum. Her turda:
 *   1) kaynak satırları okunur, belge + hash hesaplanır (AI çağrısı YOK),
 *   2) mevcut dizindeki hash ile karşılaştırılır,
 *   3) YALNIZCA değişen/yeni olanlar embed edilir (en fazla `maxEmbeds` tane),
 *   4) silinmiş varlıklar dizinden düşürülür, dizin yeniden paketlenip KV'ye yazılır.
 *
 * Değişiklik yoksa hiçbir AI çağrısı yapılmaz ve KV'ye YAZILMAZ.
 *
 * @returns {Promise<{type, total, embedded, removed, pending, wrote}>}
 */
export async function rebuildIndex(env, type, opts) {
  const cfg = INDEX_TYPES[type];
  if (!cfg) throw new Error(`bilinmeyen dizin türü: ${type}`);
  const maxEmbeds = (opts && opts.maxEmbeds) || 400;

  const { results } = await env.DB.prepare(cfg.sql).all();
  const rows = results || [];

  // Mevcut dizin: slug -> {hash, vec}
  let existing = null;
  try {
    const buf = await env.FACET_CACHE.get(indexKvKey(type), 'arrayBuffer');
    if (buf) existing = unpackIndex(buf);
  } catch { /* yoksa sıfırdan kurulur */ }
  const prev = new Map();
  if (existing) {
    for (let i = 0; i < existing.items.length; i++) {
      prev.set(existing.items[i].s, { hash: existing.items[i].h, row: existing.rowOf(i) });
    }
  }

  const docs = [];
  for (const row of rows) {
    const text = cfg.docOf(row);
    docs.push({ slug: row.slug, text, hash: await docHash(text) });
  }

  const stale = docs.filter(d => {
    const p = prev.get(d.slug);
    return !p || p.hash !== d.hash;
  });
  const pending = Math.max(0, stale.length - maxEmbeds);
  const batch = stale.slice(0, maxEmbeds);

  const fresh = new Map();
  if (batch.length) {
    const vecs = await embedTexts(env, batch.map(d => d.text));
    for (let i = 0; i < batch.length; i++) {
      if (!vecs[i] || vecs[i].length !== EMBED_DIM) continue;
      fresh.set(batch[i].slug, quantizeUnit(vecs[i]));
    }
  }

  // Hiç değişiklik yoksa (yeni embedding yok VE silinen yok) KV'ye dokunma.
  const liveSlugs = new Set(docs.map(d => d.slug));
  let removed = 0;
  for (const slug of prev.keys()) if (!liveSlugs.has(slug)) removed++;
  if (!fresh.size && !removed && existing) {
    return { type, total: docs.length, embedded: 0, removed: 0, pending, wrote: false };
  }

  // Yeniden paketle: her varlık için ya YENİ vektör ya da ESKİ vektör kullanılır. Embedding'i
  // hiç üretilememiş varlık (ne yeni ne eski) dizine SIFIR vektörle girer — kosinüsü daima 0'dır,
  // yani anlamsal aday olmaz ama sözlüksel yoldan bulunabilir ve hash'i "eski" kalmaz.
  const items = [];
  const vectors = new Int8Array(docs.length * EMBED_DIM);
  const zero = new Int8Array(EMBED_DIM);
  let embedded = 0;
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const nv = fresh.get(d.slug);
    const pv = prev.get(d.slug);
    let row = zero;
    let hash = d.hash;
    if (nv) { row = nv; embedded++; }
    else if (pv && pv.hash === d.hash) { row = pv.row; }
    else if (pv) {
      // Belgesi değişmiş ama bu turda embed edilememiş: ESKİ vektör korunur, hash ESKİ bırakılır
      // ki bir sonraki tur onu yine "değişmiş" görüp yeniden denesin.
      row = pv.row; hash = pv.hash;
    }
    items.push({ s: d.slug, h: hash });
    vectors.set(row, i * EMBED_DIM);
  }

  const buf = packIndex({
    type, dim: EMBED_DIM, model: EMBED_MODEL,
    built: new Date().toISOString(), items, vectors,
  });
  await env.FACET_CACHE.put(indexKvKey(type), buf);
  memCache.delete(type);
  return { type, total: docs.length, embedded, removed, pending, wrote: true };
}

/** Dizinin durumu (admin/gözlemlenebilirlik). AI çağrısı yapmaz. */
export async function indexStatus(env, type) {
  const index = await loadIndex(env, type);
  if (!index) return { type, present: false };
  let zero = 0;
  for (let i = 0; i < index.items.length; i++) {
    const row = index.rowOf(i);
    let nonZero = false;
    for (let d = 0; d < index.dim; d += 64) { if (row[d]) { nonZero = true; break; } }
    if (!nonZero) zero++;
  }
  return {
    type, present: true, count: index.items.length, dim: index.dim,
    model: index.header.model, built: index.header.built, emptyVectors: zero,
  };
}
