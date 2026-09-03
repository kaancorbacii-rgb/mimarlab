// MİMARLAB görsel arama — GÖRSEL EMBEDDING dizininin WORKER TARAFI (okuma + artımlı ekleme).
//
// src/lib/imageEmbedIndex.js SAF kalır (Node/Python betikleri de kavramsal olarak aynı biçimi
// üretir); bu dosya env'e (KV) dokunan tarafı barındırır. rebuildIndex-benzeri bir "D1'i tarayıp
// embedding üret" fonksiyonu BİLEREK YOK — Workers CNN çalıştıramadığından embedding'ler ya
// offline (scripts/build-image-embeddings.py, bir kerelik backfill) ya da TARAYICIDA (bkz.
// image-clip-embed.js, proje-ekle.html/urun-ekle.html kayıt anında) üretilir; bu dosya yalnızca
// zaten üretilmiş vektörleri OKUR ve EKLER.

import { unpackImageIndex, packImageIndex, imageIndexKvKey, IMAGE_EMBED_DIM, IMAGE_EMBED_MODEL, quantizeUnit } from './imageEmbedIndex.js';

const MEM_TTL_MS = 10 * 60 * 1000;
const memCache = new Map();   // type -> { at, index }

export async function loadImageIndex(env, type) {
  const hit = memCache.get(type);
  const now = Date.now();
  if (hit && (now - hit.at) < MEM_TTL_MS) return hit.index;
  let index = null;
  try {
    const buf = await env.FACET_CACHE.get(imageIndexKvKey(type), 'arrayBuffer');
    if (buf) index = unpackImageIndex(buf);
  } catch (err) {
    console.error('imageEmbedStore: KV okunamadı', type, err && err.message);
  }
  memCache.set(type, { at: now, index });
  return index;
}

function invalidateMemCache(type) {
  memCache.delete(type);
}

// ---------------------------------------------------------------------------------------------
// ARTIMLI EKLEME (brief madde 8/18: "yeni proje/ürün görseli eklendiğinde index otomatik
// güncellensin"). Tarayıcı proje-ekle.html/urun-ekle.html'de yeni bir görsel eklerken embedding'i
// KENDİSİ hesaplar (image-clip-embed.js) ve bu fonksiyona iletir — sunucu hiçbir CNN çalıştırmaz,
// yalnızca GELEN vektörü doğrulayıp pakete ekler.
//
// EŞZAMANLI YAZMA KORUMASI (brief madde 13: "concurrent indexing"): KV'de gerçek bir transaction
// yoktur — iki eşzamanlı istek aynı anda oku-değiştir-yaz yaparsa biri kaybolabilir. Bu, düşük
// yazma sıklıklı bir işlem için (yeni proje/ürün eklemek, saniyede binlerce olan bir şey değil)
// kabul edilebilir bir risktir; en kötü durumda o TEK görsel bir sonraki güncellemeye kadar
// dizine giremez, arama SÖZLÜKSEL/kimlik katmanından çalışmaya devam eder (sert hata değil).
// ---------------------------------------------------------------------------------------------
export async function addEntityImageEmbedding(env, type, slug, imageKey, vector) {
  if (!Array.isArray(vector) && !(vector instanceof Float32Array)) {
    throw new Error('geçersiz vektör');
  }
  if (vector.length !== IMAGE_EMBED_DIM) {
    throw new Error(`beklenmedik boyut: ${vector.length} (beklenen ${IMAGE_EMBED_DIM})`);
  }
  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i])) throw new Error('vektörde sonlu olmayan değer var');
  }

  const buf = await env.FACET_CACHE.get(imageIndexKvKey(type), 'arrayBuffer');
  const existing = buf ? unpackImageIndex(buf) : null;
  const q = quantizeUnit(vector);

  const entities = [];
  const chunks = [];
  let inserted = false;
  if (existing) {
    for (const e of existing.entities) {
      if (e.s === slug) {
        // Aynı varlığa yeni bir görsel daha — mevcut bloğun SONUNA eklenir. Aynı imageKey zaten
        // varsa (kullanıcı aynı görseli iki kez kaydetti) yinelenen embedding YAZILMAZ (brief
        // madde 13: "duplicate images, duplicate embeddings" — dizin şişmesin).
        if (e.k.includes(imageKey)) {
          entities.push(e);
          chunks.push(existing.vectors.subarray(e.offset * existing.dim, (e.offset + e.c) * existing.dim));
          continue;
        }
        entities.push({ s: e.s, c: e.c + 1, k: [...e.k, imageKey] });
        chunks.push(existing.vectors.subarray(e.offset * existing.dim, (e.offset + e.c) * existing.dim));
        chunks.push(q);
        inserted = true;
      } else {
        entities.push(e);
        chunks.push(existing.vectors.subarray(e.offset * existing.dim, (e.offset + e.c) * existing.dim));
      }
    }
  }
  if (!inserted) {
    entities.push({ s: slug, c: 1, k: [imageKey] });
    chunks.push(q);
  }

  const dim = existing ? existing.dim : IMAGE_EMBED_DIM;
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const vectors = new Int8Array(totalLen);
  let off = 0;
  for (const c of chunks) { vectors.set(c, off); off += c.length; }

  const packed = packImageIndex({
    type, dim, model: IMAGE_EMBED_MODEL, built: new Date().toISOString(),
    entities: entities.map(e => ({ s: e.s, c: e.c, k: e.k })),
    vectors,
  });
  await env.FACET_CACHE.put(imageIndexKvKey(type), packed);
  invalidateMemCache(type);
  return { entityCount: entities.length, totalImages: totalLen / dim };
}

/** Bir varlık SİLİNDİĞİNDE/gizlendiğinde dizinden çıkarır (brief madde 13: "deleted project/product
 * ... embedding index'te kalmasını engelle"). Varlık dizinde yoksa no-op. */
export async function removeEntityImages(env, type, slug) {
  const buf = await env.FACET_CACHE.get(imageIndexKvKey(type), 'arrayBuffer');
  if (!buf) return { removed: false };
  const existing = unpackImageIndex(buf);
  if (!existing || !existing.entityBySlug.has(slug)) return { removed: false };

  const entities = [];
  const chunks = [];
  for (const e of existing.entities) {
    if (e.s === slug) continue;
    entities.push(e);
    chunks.push(existing.vectors.subarray(e.offset * existing.dim, (e.offset + e.c) * existing.dim));
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const vectors = new Int8Array(totalLen);
  let off = 0;
  for (const c of chunks) { vectors.set(c, off); off += c.length; }

  const packed = packImageIndex({
    type, dim: existing.dim, model: existing.header.model, built: new Date().toISOString(),
    entities: entities.map(e => ({ s: e.s, c: e.c, k: e.k })),
    vectors,
  });
  await env.FACET_CACHE.put(imageIndexKvKey(type), packed);
  invalidateMemCache(type);
  return { removed: true };
}

export async function imageIndexStatus(env, type) {
  const index = await loadImageIndex(env, type);
  if (!index) return { type, present: false };
  let totalImages = 0;
  for (const e of index.entities) totalImages += e.c;
  return {
    type, present: true, entityCount: index.entities.length, totalImages,
    dim: index.dim, model: index.header.model, built: index.header.built,
  };
}
