// "Üzerine kullanıcı atanmamış içerikleri arşive taşı" — admin toplu işlemi
// (kullanıcı isteği, 2026-09-10 madde 3: "Admin panelindeki üyeler bölümünden üzerine bir kullanıcı
// atanmamış tüm firmaları, kişileri, ürün ve markaları arşive taşı. Bu arşive taşınan tüm içerikler,
// eğer bir firmaya bir kullanıcı atanırsa o kullanıcının hesabım sayfasındaki arşiv kutusunda
// gözüksünler.").
//
// "ATANMAMIŞ" TANIMI (tek kaynak, admin ekranında da AYNI sayıyı üretir):
//   1) architects/offices: adıyla EŞLEŞEN onaylı bir profile_claims satırı YOK, ve
//   2) products/materials: markasının (brand_office_id -> offices.name, yoksa brand_name_raw)
//      onaylı bir firma ataması YOK — markasız ürünler her zaman atanmamış sayılır, ve
//   3) her tip için: kaydı YÜKLEYEN bir ÜYE de yok, yani o kayda karşılık gelen hiçbir
//      *_submissions satırının owner_user_id'si admin OLMAYAN bir kullanıcıya ait değil.
// (3) kritiktir: bir üyenin kendi yüklediği içerik "üzerine kullanıcı atanmamış" değildir — arkasında
// zaten bir kullanıcı vardır ve o içerik toplu arşivlemenin hedefi DEĞİLDİR.
//
// NEDEN PARÇALI (batch) ÇALIŞIR: tek bir Worker isteği binlerce kaydı işleyemez (CPU/alt-istek
// sınırları). Uç her çağrıda en fazla `limit` kayıt arşivler ve KALAN sayısını döner; admin ekranı
// (admin.html#archive-unassigned) bitene kadar çağrıyı tekrarlar. İşlem idempotenttir — arşivlenen
// kayıt bir sonraki taramada zaten hidden_at taşıdığı için listeye girmez.
//
// ARŞİVLEME İŞİNİ KENDİ BAŞINA YAPMAZ: src/routes/legacyContent.js#runContentAction'ın 'archive'
// dalını çağırır (bkz. [[project_bulk_admin_ops_via_live_code_2026_09_08]] — elle UPDATE hidden_at
// yazmak arşiv taslağını hiç oluşturmaz ve kaydı GERİ ALINAMAZ hale getirir; Arşivim kutusunun
// tamamı o taslağa dayanır).
import { json, errorJson, readJson } from '../lib/http.js';
import { runContentAction } from './legacyContent.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { foldTr } from '../lib/textMatch.js';
import officeKindJs from '../../office-kind.js';

const { isBrandOffice } = officeKindJs;

const TYPES = ['architects', 'offices', 'products', 'materials'];
// scripts/archive-unassigned.mjs bu ikisini import eder — toplu betik "atanmamış" tanımını
// KOPYALAMAZ, panelin kullandığı AYNI taramayı çağırır (bkz. o dosyanın başındaki gerekçe).
export const UNASSIGNED_TYPES = TYPES;
const SUBMISSION_TABLE = {
  architects: 'architect_submissions',
  offices: 'office_submissions',
  products: 'product_submissions',
  materials: 'material_submissions',
};

const MAX_BATCH = 25;

// Onaylı atamaların adları. office_position kısıtı BİLEREK uygulanmaz: buradaki soru "bu profilin
// üzerinde bir kullanıcı VAR MI" — yetkisiz görevle atanmış bir kullanıcı da bir kullanıcıdır ve o
// profil "atanmamış" sayılmamalıdır (bkz. src/routes/archive.js'teki AYNI kolonun FARKLI amaçla,
// görev kısıtıyla okunması — orada soru "yayına alma yetkisi var mı").
async function fetchAssignedNames(env) {
  const { results } = await env.DB.prepare(
    `SELECT profile_type, profile_key FROM profile_claims WHERE status = 'approved'`
  ).all();
  const architects = new Set();
  const offices = new Set();
  for (const r of results || []) {
    if (r.profile_type === 'architect') architects.add(foldTr(r.profile_key || ''));
    else if (r.profile_type === 'office') offices.add(foldTr(r.profile_key || ''));
  }
  return { architects, offices };
}

// Admin OLMAYAN bir üyenin sahibi olduğu gönderilerin taşıdığı doğal anahtarlar. Bir kayıt bu
// kümedeyse arkasında gerçek bir kullanıcı var demektir (bkz. dosya başı (3) numaralı koşul).
async function fetchMemberOwnedKeys(env, typeKey) {
  const table = SUBMISSION_TABLE[typeKey];
  const nameCol = (typeKey === 'products' || typeKey === 'materials') ? 'title' : 'name';
  const claimedCol = (typeKey === 'products' || typeKey === 'materials') ? 'claimed_slug' : 'claimed_profile_key';
  const { results } = await env.DB.prepare(
    `SELECT s.${nameCol} AS nm, s.${claimedCol} AS ck FROM ${table} s
     JOIN users u ON u.id = s.owner_user_id
     WHERE u.role != 'admin'`
  ).all();
  const keys = new Set();
  for (const r of results || []) {
    if (r.nm) keys.add(foldTr(r.nm));
    if (r.ck) keys.add(foldTr(r.ck));
  }
  return keys;
}

// Canlıda görünen (arşivlenmemiş, silinmemiş) canonical satırlar — atanmamış olanlar.
// Her satır için runContentAction'ın beklediği doğal anahtar (`key`) da hesaplanır.
async function findUnassigned(env, typeKey, assigned, memberKeys, limit) {
  if (typeKey === 'architects' || typeKey === 'offices') {
    const { results } = await env.DB.prepare(
      `SELECT id, name, slug${typeKey === 'offices' ? ', cats' : ''} FROM ${typeKey}
       WHERE hidden_at IS NULL AND deleted_at IS NULL ORDER BY id`
    ).all();
    const pool = typeKey === 'architects' ? assigned.architects : assigned.offices;
    const out = [];
    for (const row of results || []) {
      const folded = foldTr(row.name || '');
      if (!folded || pool.has(folded) || memberKeys.has(folded)) continue;
      out.push({ key: row.name, name: row.name, cats: row.cats });
      if (limit && out.length >= limit) break;
    }
    return out;
  }
  // products/materials — canonical tablo TEK: `products`, ayrım `kind` kolonunda (bkz.
  // migrations/0022_id_first_entities.sql). Doğal anahtar legacy_key'dir; yoksa slug kullanılır
  // (findCanonicalRowByNaturalKey ikisini de tanır, bkz. src/lib/canonicalSync.js).
  const kind = typeKey === 'products' ? 'product' : 'material';
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.slug, p.legacy_key, COALESCE(o.name, p.brand_name_raw) AS brand
     FROM products p LEFT JOIN offices o ON o.id = p.brand_office_id
     WHERE p.kind = ? AND p.hidden_at IS NULL AND p.deleted_at IS NULL ORDER BY p.id`
  ).bind(kind).all();
  const out = [];
  for (const row of results || []) {
    const brandFolded = foldTr(row.brand || '');
    if (brandFolded && assigned.offices.has(brandFolded)) continue;
    if (memberKeys.has(foldTr(row.title || '')) || (row.slug && memberKeys.has(foldTr(row.slug)))) continue;
    out.push({ key: row.legacy_key || row.slug, name: row.title });
    if (limit && out.length >= limit) break;
  }
  return out.filter(r => !!r.key);
}

// GET /api/admin/unassigned-archive — her tip için kaç kayıt arşivlenecek (ÖNİZLEME, hiçbir şeyi
// değiştirmez). Marka/Firma ayrımı office-kind.js ile yapılır: ikisi de `offices` tablosundadır,
// ekranda ayrı sayılır ki admin ne kadarının marka olduğunu görsün.
async function previewUnassigned(env) {
  const assigned = await fetchAssignedNames(env);
  const counts = {};
  for (const typeKey of TYPES) {
    const memberKeys = await fetchMemberOwnedKeys(env, typeKey);
    const rows = await findUnassigned(env, typeKey, assigned, memberKeys, 0);
    if (typeKey === 'offices') {
      counts.offices = rows.filter(r => !isBrandOffice(r.cats, 0)).length;
      counts.brands = rows.filter(r => isBrandOffice(r.cats, 0)).length;
    } else {
      counts[typeKey] = rows.length;
    }
  }
  counts.total = TYPES.reduce((sum, t) => sum + (t === 'offices' ? counts.offices + counts.brands : counts[t]), 0);
  return json({ counts });
}

// POST /api/admin/unassigned-archive  body: {type, limit}
// En fazla `limit` (üst sınır MAX_BATCH) kaydı arşivler, kalan sayıyı döner.
async function archiveUnassignedBatch(request, env, user) {
  const body = await readJson(request);
  const typeKey = (body.type || '').trim();
  if (!TYPES.includes(typeKey)) return errorJson('Geçersiz tip.');
  const limit = Math.min(MAX_BATCH, Math.max(1, parseInt(body.limit, 10) || MAX_BATCH));

  const assigned = await fetchAssignedNames(env);
  const memberKeys = await fetchMemberOwnedKeys(env, typeKey);
  const all = await findUnassigned(env, typeKey, assigned, memberKeys, 0);
  const batch = all.slice(0, limit);

  const errors = [];
  let archived = 0;
  for (const row of batch) {
    try {
      const res = await runContentAction(env, user, { type: typeKey, action: 'archive', key: row.key });
      if (res && res.status >= 400) errors.push({ key: row.key, status: res.status });
      else archived++;
    } catch (err) {
      errors.push({ key: row.key, reason: (err && err.message) || String(err) });
    }
  }
  // runContentAction her kayıt için ayrıca invalidatePublicCache çağırıyor; parti sonunda bir kez
  // daha çağırmak ucuz ve son durumu garanti eder (bkz. o dosyadaki AYNI çağrı).
  await invalidatePublicCache(env);
  return json({ archived, remaining: Math.max(0, all.length - archived), errors: errors.slice(0, 10) });
}

// Betik girişi (bkz. UNASSIGNED_TYPES yorumu): tek tipin TÜM atanmamış kayıtlarını döner.
export async function findUnassignedForScript(env, typeKey) {
  if (!TYPES.includes(typeKey)) throw new Error(`Geçersiz tip: ${typeKey}`);
  const assigned = await fetchAssignedNames(env);
  const memberKeys = await fetchMemberOwnedKeys(env, typeKey);
  return findUnassigned(env, typeKey, assigned, memberKeys, 0);
}

export async function handleUnassignedArchiveAdmin(request, env, user) {
  if (request.method === 'GET') return previewUnassigned(env);
  if (request.method === 'POST') return archiveUnassignedBatch(request, env, user);
  return errorJson('Bulunamadı', 404);
}
