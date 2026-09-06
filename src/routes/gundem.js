// GÜNDEM PUBLIC API + SSR GÖVDESİ (kullanıcı isteği, 2026-09-06 madde 13 ve 14).
//
// GET /api/gundem            — sayfalanmış liste (limit, page, category, source, search)
// GET /api/gundem/:slug      — tek içerik (detay sayfası + paylaşım önizlemesi için)
//
// ÖNBELLEK: bu depodaki mevcut public uç sarmalayıcısı (cachedPublicJson) kullanılır — yeni bir
// cache katmanı yazılmaz. Sarmalayıcı admin oturumlarını no-store'a düşürür, anonim istekleri
// caches.default'a yazar, ETag/If-None-Match ile 304 döndürür ve listFingerprint sayesinde bir
// purge kaçırılsa bile bayat girdiyi tespit eder.
//
// AUTH/SESSION VERİSİ BU YANITLARA GİRMEZ (madde 13/20). Kullanıcıya özel "kaydedildi mi" durumu
// AYRI ve kimliği doğrulanmış bir uçtan (GET /api/saved, save-widget.js zaten sayfa başına bir kez
// çağırıyor) gelir ve yalnızca istemcide birleştirilir — böylece public gövde herkes için birebir
// aynı bayt kalır ve paylaşılan önbellekte güvenle tutulabilir.

import { json, errorJson } from '../lib/http.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { GUNDEM_CATEGORIES, isValidGundemCategory } from '../lib/gundemCategories.js';
import { GUNDEM_SOURCES } from '../lib/gundemSources.js';
import { gundemSsrList } from '../lib/gundemSsr.js';
import { foldTr } from '../lib/textMatch.js';

const SITE_ORIGIN = 'https://mimarlab.com';

// js/pages/gundem.js#PAGE_SIZE ile AYNI olmalı (bkz. gundemCache.js'teki purge anahtarı notu ve
// scripts/preflight-check.sh'teki statik kontrol). 12 = "ilk sayfada 10-15 item" (madde 19).
export const GUNDEM_PAGE_SIZE = 12;
const MAX_LIMIT = 24;

// Liste kartında dönen alanlar. Kaynak makale metninden HİÇBİR ŞEY dönmez — yalnızca MİMARLAB'ın
// kendi ürettiği başlık/özet ve kaynağa götüren metadata (bkz. migrations/0099 dosya başı notu).
const LIST_COLUMNS = `id, slug, title, summary, image_url, source_name, source_domain, source_url,
  source_published_at, published_at, category, source_id`;

function shapeItem(row, entitiesByItem) {
  return {
    // id — YALNIZCA admin kontrollerinin hedefi (bkz. js/pages/gundem.js#applyAdminControls).
    // Hassas değil (rastgele UUID) ve yetki bu alanla DEĞİL, sunucudaki requireAdmin ile verilir;
    // admin olmayan biri id'yi bilse de /api/admin/gundem/* uçlarından 401 alır.
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    image: row.image_url,
    sourceName: row.source_name,
    sourceDomain: row.source_domain,
    sourceUrl: row.source_url,
    // Kartın gösterdiği tarih: kaynağın kendi yayın tarihi (varsa) — bizim toplama anımız değil.
    date: row.source_published_at || row.published_at,
    publishedAt: row.published_at,
    category: row.category,
    sourceId: row.source_id,
    entities: (entitiesByItem && entitiesByItem.get(row.id)) || [],
  };
}

// Bir içerik kümesinin bilgi-grafiği kenarları — TEK sorguda (N+1 yok).
async function loadEntities(env, ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT item_id, entity_type, entity_key, entity_name FROM gundem_entities WHERE item_id IN (${placeholders})`
  ).bind(...ids).all();
  const map = new Map();
  for (const r of results) {
    if (!map.has(r.item_id)) map.set(r.item_id, []);
    map.get(r.item_id).push({ type: r.entity_type, key: r.entity_key, name: r.entity_name });
  }
  return map;
}

// Ucuz tazelik parmak izi (bkz. publicCache.js#cachedPublicJson'daki listFingerprint sözleşmesi).
// idx_gundem_items_published tam olarak bu WHERE'i karşılar, yani tam tablo taraması yok.
async function gundemListFingerprint(env) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), 0) AS m FROM gundem_items WHERE status = 'published'`
  ).first();
  return `${(row && row.c) || 0}:${(row && row.m) || 0}`;
}

export async function handleGundemRoute(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);
  const rest = url.pathname.slice('/api/gundem'.length).replace(/^\//, '');
  if (rest) return handleGundemDetail(request, env, url, decodeURIComponent(rest));
  return handleGundemList(request, env, url);
}

async function handleGundemList(request, env, url) {
  const params = url.searchParams;
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(params.get('limit'), 10) || GUNDEM_PAGE_SIZE));
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);
  const categoryParam = params.get('category');
  const category = isValidGundemCategory(categoryParam) ? categoryParam : null;
  const sourceParam = (params.get('source') || '').trim();
  const source = GUNDEM_SOURCES.some(s => s.id === sourceParam) ? sourceParam : null;
  const search = (params.get('search') || '').trim().slice(0, 80);

  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const where = [`status = 'published'`];
    const binds = [];
    if (category) { where.push('category = ?'); binds.push(category); }
    if (source) { where.push('source_id = ?'); binds.push(source); }
    // Arama: Türkçe katlamalı LIKE. Bu tablo (yüzler mertebesinde satır) için ayrı bir fold kolonu/
    // FTS kurmak gereksiz karmaşıklık olurdu — arama zaten ikincil bir filtre (madde 13:
    // "Gerekli değilse fazla filtre ekleme"). Katlama SQL'de yapılamadığından JS tarafında
    // uygulanır; bu yüzden arama VARSA sayfalama da JS tarafında yapılır (aşağıya bkz.).
    const whereSql = where.join(' AND ');

    if (search) {
      const { results } = await env.DB.prepare(
        `SELECT ${LIST_COLUMNS} FROM gundem_items WHERE ${whereSql} ORDER BY published_at DESC LIMIT 400`
      ).bind(...binds).all();
      const needle = foldTr(search);
      const filtered = results.filter(r =>
        foldTr(r.title || '').includes(needle) ||
        foldTr(r.summary || '').includes(needle) ||
        foldTr(r.source_name || '').includes(needle)
      );
      const pageRows = filtered.slice((page - 1) * limit, (page - 1) * limit + limit);
      const entities = await loadEntities(env, pageRows.map(r => r.id));
      return {
        items: pageRows.map(r => shapeItem(r, entities)),
        total: filtered.length,
        page,
        limit,
        hasMore: (page - 1) * limit + pageRows.length < filtered.length,
        categories: GUNDEM_CATEGORIES,
      };
    }

    const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM gundem_items WHERE ${whereSql}`).bind(...binds).first();
    const total = (totalRow && totalRow.c) || 0;
    // LIMIT/OFFSET: bu depoda büyük tablolarda index'i bozduğu bilinen bir desen (bkz. proje notu)
    // ama burada ORDER BY tam olarak idx_gundem_items_published/idx_gundem_items_category'nin
    // sırasıdır ve tablo mertebesi yüzlerdir — offset taraması index üzerinde kalır. Sayfa sayısı
    // ayrıca hasMore ile sınırlıdır (sonsuz kaydırma en fazla birkaç sayfa gider).
    const { results } = await env.DB.prepare(
      `SELECT ${LIST_COLUMNS} FROM gundem_items WHERE ${whereSql} ORDER BY published_at DESC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, (page - 1) * limit).all();
    const entities = await loadEntities(env, results.map(r => r.id));
    return {
      items: results.map(r => shapeItem(r, entities)),
      total,
      page,
      limit,
      hasMore: (page - 1) * limit + results.length < total,
      categories: GUNDEM_CATEGORIES,
    };
  }, () => gundemListFingerprint(env));
}

async function handleGundemDetail(request, env, url, slug) {
  return cachedPublicJson(request, env, url.pathname, async () => {
    const row = await env.DB.prepare(
      `SELECT ${LIST_COLUMNS}, original_title, author FROM gundem_items WHERE slug = ? AND status = 'published'`
    ).bind(slug).first();
    if (!row) {
      // Satır VAR ama arşivlenmişse 410 (bilinçli kaldırma), hiç yoksa 404 — bu depodaki mevcut
      // ayrım (bkz. publicCache.js#statusFor).
      const archived = await env.DB.prepare('SELECT 1 FROM gundem_items WHERE slug = ? LIMIT 1').bind(slug).first();
      return { item: null, hidden: !!archived };
    }
    const entities = await loadEntities(env, [row.id]);
    // categories — liste ucuyla AYNI alan. Detay görünümü de kartın meta satırında kategori
    // ETİKETİNİ gösterdiğinden (js/pages/gundem.js#categoryLabel) bu olmadan doğrudan /gundem/:slug
    // ile açılan sayfada kategori sessizce boş kalırdı.
    return { item: shapeItem(row, entities), categories: GUNDEM_CATEGORIES };
  });
}

// -----------------------------------------------------------------------------------------------
// SSR (madde 14) — JS kapalıyken de içeriğin HTML'de görünmesi
// -----------------------------------------------------------------------------------------------
// Kart HTML'i src/lib/gundemSsr.js'te (detay meta'sıyla PAYLAŞILAN tek kaynak) — kapsam sınırı ve
// escaping gerekçeleri o dosyanın başında.

// /gundem liste sayfasının SSR gövdesi (ilk sayfa kadar).
export async function gundemSsrListBody(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${LIST_COLUMNS} FROM gundem_items WHERE status = 'published' ORDER BY published_at DESC LIMIT ?`
  ).bind(GUNDEM_PAGE_SIZE).all();
  return gundemSsrList(results);
}

// /sitemap.xml için (bkz. src/index.js#buildSitemapUrlBlocks). Yalnızca YAYINDA olan kayıtlar —
// "sitemap'a yalnızca gerçekten indexlenmesi amaçlanan URL'leri ekle" (madde 14).
export async function listGundemSitemapUrls(env) {
  const { results } = await env.DB.prepare(
    `SELECT slug, updated_at FROM gundem_items WHERE status = 'published' ORDER BY published_at DESC`
  ).all();
  return results.map(r => [`${SITE_ORIGIN}/gundem/${encodeURIComponent(r.slug)}`, r.updated_at || null]);
}
