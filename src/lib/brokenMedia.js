// KIRIK GÖRSEL TARAYICISI — "D1'de yol var, R2'de nesne yok" durumundaki kayıtları bulur ve
// (admin onayıyla) ölü referansları kayıttan düşürür.
//
// KULLANICI İSTEĞİ (2026-09-13): "Ertegün Evi projesinin görselleri kırılmış, sorunu tespit et ve
// kökten düzelt. Başka böyle görseli kırılan örnek var mı bak."
//
// İKİ PARÇALI CEVAP:
//   * İLERİYE DÖNÜK (kök neden): src/lib/r2References.js — bir R2 nesnesi, başka bir D1 satırı onu
//     hâlâ gösteriyorken artık SİLİNEMEZ. Yeni kırık görsel oluşmaz.
//   * GERİYE DÖNÜK (bu dosya): kök neden düzeltilmeden ÖNCE kaybolmuş nesneler geri getirilemez —
//     R2 silmesi geri alınamaz. Yapılabilecek en iyi şey onları BULMAK ("başka örnek var mı")
//     ve ölü yolu kayıttan düşürmek: kart/pop-up o zaman tarayıcının kırık ikonu yerine sitenin
//     kendi yer tutucusunu gösterir (bkz. js/components/broken-image-fallback.js — o dosya AYNI
//     semptomu yalnızca istemci tarafında örtüyordu, veri hâlâ bozuktu).
//
// NEDEN PARÇALI (batch): canlıda ~30.000 görsel referansı var (bkz. scripts/build-image-manifest.py).
// Tek bir Worker isteği bunların tamamı için R2 head() çağıramaz (CPU/subrequest sınırları) —
// src/routes/unassignedArchive.js#archiveUnassignedBatch ile AYNI desen: her çağrı bir parti
// tarar ve bir sonraki imleci döner, admin ekranı bitene kadar döngüye sokar.
//
// SALT-OKUNUR VARSAYILAN: tarama hiçbir şeyi değiştirmez. Onarım AYRI bir POST'tur ve yalnızca
// admin'in gördüğü/onayladığı anahtar listesini işler; yazmadan hemen önce her anahtar R2'de
// YENİDEN kontrol edilir (bkz. r2Reconcile.js#confirmStillOrphaned'ın AYNI yarış koruması) —
// arada yeniden yüklenmiş bir görsel sessizce atlanır, kayıttan düşürülmez.
import { collectR2MediaKeysFromColumns } from './canonicalSync.js';
import { MEDIA_REFERENCE_SOURCES } from './r2References.js';

// Tarama sırası: önce ziyaretçinin GÖRDÜĞÜ canonical tablolar (kırık görsel oradaysa acildir),
// sonra taslak/ikincil tablolar. `label`/`slug` yalnızca raporun okunabilirliği içindir.
const SCAN_SOURCES = [
  { table: 'projects', kind: 'Proje', label: 'title', slug: 'slug', path: '/proje/' },
  { table: 'products', kind: 'Ürün', label: 'title', slug: 'slug', path: '/urun/' },
  { table: 'architects', kind: 'Kişi', label: 'name', slug: 'slug', path: '/kisi/' },
  { table: 'offices', kind: 'Firma', label: 'name', slug: 'slug', path: '/firma/' },
  { table: 'gundem_items', kind: 'Gündem', label: 'title', slug: 'slug', path: '/gundem/' },
  { table: 'project_submissions', kind: 'Proje gönderisi', label: 'title', slug: 'claimed_slug' },
  { table: 'product_submissions', kind: 'Ürün gönderisi', label: 'title', slug: 'claimed_slug' },
  { table: 'material_submissions', kind: 'Malzeme gönderisi', label: 'title', slug: 'claimed_slug' },
  { table: 'architect_submissions', kind: 'Kişi gönderisi', label: 'name', slug: 'claimed_profile_key' },
  { table: 'office_submissions', kind: 'Firma gönderisi', label: 'name', slug: 'claimed_profile_key' },
  { table: 'office_jobs', kind: 'İlan', label: 'title' },
  { table: 'users', kind: 'Üye', label: 'name' },
];

const COLUMNS_BY_TABLE = new Map(MEDIA_REFERENCE_SOURCES.map(s => [s.table, s.columns]));
const SCAN_BY_TABLE = new Map(SCAN_SOURCES.map(s => [s.table, s]));

// Bir çağrıda taranacak satır tavanı ve R2 head() tavanı. head() sayısı asıl maliyet; satır sayısı
// yalnızca "kaç satırdan sonra duracağız" sorusunu yanıtlar (galeri başına ~20 kare olabiliyor).
const ROWS_PER_CALL = 150;
const HEADS_PER_CALL = 180;
const HEAD_CONCURRENCY = 30;

async function headExists(env, key) {
  try { return !!(await env.UPLOADS.head(key)); } catch { return true; } // hata -> "var say", yanlış alarm üretme
}

async function checkKeys(env, keys) {
  const missing = new Set();
  for (let i = 0; i < keys.length; i += HEAD_CONCURRENCY) {
    const part = keys.slice(i, i + HEAD_CONCURRENCY);
    const found = await Promise.all(part.map(k => headExists(env, k)));
    part.forEach((k, j) => { if (!found[j]) missing.add(k); });
  }
  return missing;
}

function parseCursor(cursor) {
  const [rawIndex, rawOffset] = String(cursor || '0:0').split(':');
  const index = Number.parseInt(rawIndex, 10);
  const offset = Number.parseInt(rawOffset, 10);
  return {
    index: Number.isFinite(index) && index >= 0 ? index : 0,
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
  };
}

// GET /api/admin/broken-images?cursor=<i>:<offset> — bir parti tarar.
export async function scanBrokenImageRefs(env, cursor) {
  let { index, offset } = parseCursor(cursor);
  const items = [];
  let scannedRows = 0;
  const keyOwners = new Map(); // anahtar -> [{...satır}] (aynı anahtar birden çok satırda olabilir)

  while (index < SCAN_SOURCES.length && scannedRows < ROWS_PER_CALL && keyOwners.size < HEADS_PER_CALL) {
    const source = SCAN_SOURCES[index];
    const columns = COLUMNS_BY_TABLE.get(source.table) || [];
    const select = ['id', ...columns];
    if (source.label && !select.includes(source.label)) select.push(source.label);
    if (source.slug && !select.includes(source.slug)) select.push(source.slug);

    let rows = [];
    try {
      const { results } = await env.DB.prepare(
        `SELECT ${select.join(', ')} FROM ${source.table} ORDER BY id LIMIT ? OFFSET ?`
      ).bind(ROWS_PER_CALL - scannedRows, offset).all();
      rows = results || [];
    } catch {
      // Tablo/kolon yok (yerel dev, geride kalmış şema) — bu kaynağı atla, tarama durmasın.
      index += 1; offset = 0; continue;
    }

    if (!rows.length) { index += 1; offset = 0; continue; }

    for (const row of rows) {
      scannedRows += 1;
      offset += 1;
      const keys = [...new Set(collectR2MediaKeysFromColumns(row, columns))];
      if (!keys.length) continue;
      const owner = {
        table: source.table,
        kind: source.kind,
        id: row.id,
        label: (source.label && row[source.label]) || String(row.id),
        slug: (source.slug && row[source.slug]) || null,
        path: source.path || null,
        totalKeys: keys.length,
      };
      for (const key of keys) {
        if (!keyOwners.has(key)) keyOwners.set(key, []);
        keyOwners.get(key).push(owner);
      }
      if (keyOwners.size >= HEADS_PER_CALL) break;
    }
  }

  const keys = [...keyOwners.keys()];
  const missing = await checkKeys(env, keys);

  // Satır bazında topla: bir kayıt için TÜM ölü anahtarlar tek kartta görünsün.
  const byRow = new Map();
  for (const key of missing) {
    for (const owner of keyOwners.get(key)) {
      const rowKey = `${owner.table}#${owner.id}`;
      if (!byRow.has(rowKey)) byRow.set(rowKey, { ...owner, missing: [] });
      byRow.get(rowKey).missing.push(key);
    }
  }
  items.push(...byRow.values());

  const done = index >= SCAN_SOURCES.length;
  return {
    items,
    scannedRows,
    checkedKeys: keys.length,
    missingKeys: missing.size,
    cursor: done ? null : `${index}:${offset}`,
    done,
    progress: { source: done ? null : SCAN_SOURCES[index].table, sourceIndex: index, sourceCount: SCAN_SOURCES.length },
  };
}

// Bir değerden, ölü anahtarları gösteren her parçayı düşürür. Dizide eleman silinir, düz string
// alanda değer null olur, iç içe nesnelerde (products.variants) aynı kural tekrarlanır.
function stripDeadRefs(value, isDead) {
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) {
      const next = stripDeadRefs(v, isDead);
      if (next !== null && next !== undefined) out.push(next);
    }
    return out;
  }
  if (value && typeof value === 'object') {
    // {url: ...} biçimli dosya girdisi: url ölüyse girdinin tamamı düşer.
    if (typeof value.url === 'string' && isDead(value.url)) return null;
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripDeadRefs(v, isDead);
    return out;
  }
  if (typeof value === 'string') return isDead(value) ? null : value;
  return value;
}

function referencesKey(text, key) {
  if (typeof text !== 'string' || !text) return false;
  if (text.includes(key)) return true;
  try {
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    return encoded !== key && text.includes(encoded);
  } catch { return false; }
}

// POST /api/admin/broken-images — body: { table, id, keys: string[] }
// Yalnızca R2'de GERÇEKTEN bulunmayan anahtarları kayıttan düşürür (yeniden kontrol edilir).
export async function repairBrokenImageRefs(env, { table, id, keys }) {
  const source = SCAN_BY_TABLE.get(table);
  const columns = COLUMNS_BY_TABLE.get(table);
  if (!source || !columns) return { error: 'Geçersiz tablo.' };
  const wanted = [...new Set((keys || []).filter(k => typeof k === 'string' && k))];
  if (!wanted.length) return { error: 'Temizlenecek anahtar listesi (keys) gerekli.' };

  const stillMissing = await checkKeys(env, wanted);
  const skipped = wanted.filter(k => !stillMissing.has(k));
  if (!stillMissing.size) return { updatedColumns: [], removed: 0, skipped };

  const row = await env.DB.prepare(`SELECT ${['id', ...columns].join(', ')} FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) return { error: 'Kayıt bulunamadı.', status: 404 };

  const isDead = (text) => [...stillMissing].some(k => referencesKey(text, k));
  const updates = [];
  const binds = [];
  const updatedColumns = [];
  let removed = 0;

  for (const col of columns) {
    const raw = row[col];
    if (raw == null || raw === '') continue;
    let nextValue;
    if (typeof raw === 'string' && (raw.trim().startsWith('[') || raw.trim().startsWith('{'))) {
      let parsed;
      try { parsed = JSON.parse(raw); } catch { continue; }
      const before = JSON.stringify(parsed);
      const stripped = stripDeadRefs(parsed, isDead);
      const after = JSON.stringify(stripped);
      if (before === after) continue;
      if (Array.isArray(parsed) && Array.isArray(stripped)) removed += parsed.length - stripped.length;
      else removed += 1;
      nextValue = after;
    } else {
      if (!isDead(String(raw))) continue;
      nextValue = null;
      removed += 1;
    }
    updates.push(`${col} = ?`);
    binds.push(nextValue);
    updatedColumns.push(col);
  }

  if (!updates.length) return { updatedColumns: [], removed: 0, skipped };
  await env.DB.prepare(`UPDATE ${table} SET ${updates.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  return { updatedColumns, removed, skipped, cleaned: [...stillMissing] };
}
