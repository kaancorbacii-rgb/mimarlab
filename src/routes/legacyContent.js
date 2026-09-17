import { json, errorJson, readJson } from '../lib/http.js';
import { fetchUnclaimedPhotographerSlugs } from '../lib/claimedProfiles.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { SUBMISSION_TYPES, parseSubmissionRow, findInvalidFilesField, findInvalidVariantsField } from '../lib/submissionTypes.js';
import { cachedPublicJson, invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache, ssrPurgeTargetFor } from '../lib/ssrCache.js';
import { slugify } from '../lib/slugify.js';
import { cascadeDeleteArchitect, cascadeDeleteOffice, cascadeDeleteProject, cascadeDeleteProduct } from '../lib/cascadeDelete.js';
import {
  findCanonicalRowByNaturalKey, syncApprovedSubmissionToCanonical, CANONICAL_TABLE_BY_TYPE, canonicalKeyFor,
  deleteCanonicalRowFully, collectR2MediaKeys, deleteR2MediaKeys, MEDIA_IMAGE_FIELDS_BY_TYPE,
  findOneByName, findOrHealSubmissionDraft, cleanupReplacedR2Media, reconcileVariantImages,
} from '../lib/canonicalSync.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { bumpFacetCounts } from '../lib/facetCounts.js';
import { canUserEditProjectBySlug } from '../lib/projectClaimAccess.js';
import { classicSearch } from '../lib/classicSearch.js';
import { activateProfilesOnPublish, previewProfileIdsByKeys, PUBLISH_GRAPH_PROFILE_TYPE } from './admin.js';
import { collectOfficeArchiveTargets } from '../lib/officeArchiveCascade.js';

// bkz. src/routes/admin.js'deki AYNI temizlik/gerekçe.
const FACET_TYPES = new Set(['projects']);

// Faz 3 — architects/offices/projects/products/materials artık canonical tablolardan (bkz.
// migrations/0022_id_first_entities.sql) okunuyor/gizleniyor/siliniyor; legacy_content_hidden bu 5
// tip için ARTIK KULLANILMIYOR (bkz. migrations/0025_drop_legacy_content_hidden.sql'deki gerekçe —
// tablo 2026-09-05'te 'news' tipini de kaybetti — haber özelliği yayından çekilmiş, `news`/
// `news_submissions` migrations/0090_drop_dead_feature_tables.sql ile düşürülmüştü; canlıda
// legacy_content_hidden içinde o tipte tek bir satır bile yoktu).
// "Gizle" (hidden_at, geri alınabilir) ile "Sil" (deleted_at, kalıcı + cascade) artık canonical
// satırın KENDİSİNDE tutulur — ayrı bir moderasyon tablosuna gerek kalmadı.

// BİR CANONICAL KAYDIN TÜM *_submissions TASLAKLARI — kullanıcı isteği, 2026-09-17 madde 2 ("bir
// kullanıcı yönetici olarak atandığı firmada bir proje ya da ürünü sil derse DİREKT silinsin,
// arşivle derse hesabım sayfasındaki arşivim kısmına düşsün").
//
// GERÇEK BULGU (ölçüldü — scripts/test-2026-09-17-manager-moderation-drafts.mjs 1. bölümü aynı
// ölçümü kalıcı kelepçeye çevirdi): firma yöneticisi (admin DEĞİL) zorunlu olarak ANAHTAR tabanlı
// yolu kullanır (`DELETE /api/project/:slug`, `POST /api/product/:slug/moderate` — kendi taslağı
// olmadığından id tabanlı uç ona 404 döner, bkz. submissions.js#canAccessSubmissionRow). O yol
// taslakları YALNIZCA `claimed_slug`/claim kolonu üzerinden topluyordu:
//   * SİL: canonical satır hard-delete + karaliste, ama projeyi/ürünü SİTEYE EKLEYEN üyenin kendi
//     taslağı (claimed_slug NULL) `status='approved'` olarak D1'de KALIYORDU — o üyenin
//     Hesabım > Gönderilerim kutusunda "Yayında" görünmeye devam ediyor ve bir sonraki kaydetmesi
//     (updateOwnSubmission -> syncApprovedSubmissionToCanonical) kaydı GERİ getiriyordu. Yani
//     "direkt silinsin" tutmuyordu. products/materials'ta durum daha kötüydü: `key` dalı
//     claimedColumn olmadığı için HİÇBİR taslağı silmiyordu.
//   * ARŞİVLE: kayıt arşivim kutusuna düşüyordu ama üyenin taslağı `approved` kaldığından AYNI
//     içerik bir yanda "Yayında" bir yanda "Arşivde" görünüyor ve üyenin sonraki kaydetmesi
//     arşivlenmiş kaydı SESSİZCE yeniden yayına alıyordu (arşivin tanımı bu depoda status +
//     hidden_at İKİSİDİR — bkz. src/lib/archiveSync.js).
//
// BAĞ İKİ YOLDAN KURULUR ve ikisi de KESİNDİR (adla/slug'la gevşek eşleşme YOK — aynı başlıktan
// üretilmiş, henüz onaylanmamış BAŞKA bir gönderiyi yanlışlıkla silmesin):
//   1) `claimed_slug` / claim kolonu — sahiplenilen canonical kaydın düzenleme taslağı,
//   2) canonical satırın `legacy_key = 'submission:<id>'` işareti — kayıt TAM OLARAK o taslağın
//      onayından doğmuştur (bkz. src/lib/canonicalSync.js#submissionMarker). Bu, üyenin kendi
//      gönderisini bulmanın TEK kesin yoludur.
const SUBMISSION_MARKER_RE = /^submission:(.+)$/;
function draftIdFromCanonicalRow(canonRow) {
  const m = canonRow && canonRow.legacy_key ? SUBMISSION_MARKER_RE.exec(String(canonRow.legacy_key)) : null;
  return m ? m[1] : null;
}
async function canonicalDraftRows(env, table, { claimedColumn, key, canonRow }) {
  const rows = new Map();
  if (claimedColumn && key) {
    // ORDER BY created_at DESC — arşiv dalı birden fazla eşleşmede EN YENİSİNİ seçer (bu, kural
    // değişmeden önceki `... ORDER BY created_at DESC LIMIT 1` davranışıdır; sırasız bir SELECT o
    // seçimi sessizce başka bir taslağa kaydırırdı).
    const { results } = await env.DB.prepare(
      `SELECT * FROM ${table} WHERE ${claimedColumn} = ? ORDER BY created_at DESC`
    ).bind(key).all();
    for (const r of results || []) rows.set(r.id, r);
  }
  const originId = draftIdFromCanonicalRow(canonRow);
  if (originId && !rows.has(originId)) {
    const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(originId).first();
    if (row) rows.set(row.id, row);
  }
  return [...rows.values()];
}

// Silinen canonical kaydın taslaklarını da siler. R2 anahtarları ÖNCE toplanır, satırlar sonra
// silinir, medya temizliği EN SONA kalır — bkz. src/lib/canonicalSync.js#deleteR2MediaKeys ÇAĞIRAN
// SÖZLEŞMESİ (satır dururken kendi anahtarına "referans" sayılır).
async function deleteCanonicalDrafts(env, type, table, { claimedColumn, key, canonRow, skipId }) {
  const drafts = (await canonicalDraftRows(env, table, { claimedColumn, key, canonRow }))
    .filter(r => r.id !== skipId);
  if (!drafts.length) return;
  const mediaKeys = drafts.flatMap(d => collectR2MediaKeys(d, MEDIA_IMAGE_FIELDS_BY_TYPE[type] || {}));
  await env.DB.batch(drafts.map(d => env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(d.id)));
  await deleteR2MediaKeys(env, mediaKeys);
}

// Arşivlenen canonical kaydın, arşiv taslağı DIŞINDA kalan taslaklarını da 'archived' yapar —
// "arşivde ama bir taslağı hâlâ approved" çelişkisi (ve üyenin sonraki kaydetmesinde sessiz yeniden
// yayın) böyle kapanır. Zaten 'archived' olanlara dokunulmaz.
async function archiveCanonicalDrafts(env, table, { claimedColumn, key, canonRow, skipId, now }) {
  const drafts = (await canonicalDraftRows(env, table, { claimedColumn, key, canonRow }))
    .filter(r => r.id !== skipId && r.status !== 'archived');
  if (!drafts.length) return;
  await env.DB.batch(drafts.map(d => env.DB.prepare(
    `UPDATE ${table} SET status = 'archived', updated_at = ? WHERE id = ?`
  ).bind(now, d.id)));
}

// Taslağı canonical kayda bağlayan KOLON, tip başına. architects/offices'te bu CONTENT_ACTION_TYPES#
// claimedColumn ile aynıdır; products/materials'ta claimedColumn YOKTUR ama taslak `claimed_slug`
// ile bağlanır (bkz. migrations/0088_product_claimed_slug.sql ve aşağıdaki key dalı) — bu yüzden
// ayrı bir eşleme gerekir, config.claimedColumn tek başına ürünleri hep dışarıda bırakırdı.
const DRAFT_LINK_COLUMN = {
  architects: 'claimed_profile_key', offices: 'claimed_profile_key',
  products: 'claimed_slug', materials: 'claimed_slug',
};
// Bağ ANAHTARI: architects/offices'te doğal anahtarın (ad) kendisi; products/materials'ta canonical
// satırın SLUG'ı — o tipte `key` bir slug DA olabilir ('/api/product/:slug/moderate') ama legacy
// "marka|||başlık" biçimi DE olabilir (admin ?adminedit= yolu), ve taslakta duran değer her zaman
// slug'dır.
function draftLinkFor(type, config, key, canonRow) {
  const claimedColumn = DRAFT_LINK_COLUMN[type] || config.claimedColumn || null;
  const linkKey = (type === 'products' || type === 'materials')
    ? ((canonRow && canonRow.slug) || null)
    : (key || null);
  return { claimedColumn, key: linkKey };
}

async function runContentCascadeDelete(env, user, type, { id, row, key }) {
  const name = row ? row.name : key;
  if (type === 'architects') return cascadeDeleteArchitect(env, name);
  if (type === 'offices') return cascadeDeleteOffice(env, user, name);
  if (type === 'products' || type === 'materials') {
    const engagementType = type === 'products' ? 'product' : 'material';
    if (id && row) return cascadeDeleteProduct(env, engagementType, `m-${id}`);
    const [brand, title] = (key || '').split('|||');
    return cascadeDeleteProduct(env, engagementType, slugify(`${title || ''}-${brand || ''}`));
  }
}

const CANONICAL_NAME_COL = { architects: 'name', offices: 'name', projects: 'title', products: 'title', materials: 'title' };
const CANONICAL_KEY_COL = { architects: 'name', offices: 'name', projects: 'slug' }; // products: legacy_key ("marka|||başlık")

function shapeCanonicalCard(type, row) {
  if (type === 'projects') {
    const p = parseCanonicalRow('projects', row);
    return { title: p.title, subtitle: [p.location, p.project_date].filter(Boolean).join(' · '), image: (p.images && p.images[0]) || null };
  }
  if (type === 'architects') {
    return { title: row.name, subtitle: [row.school].filter(Boolean).join(' · '), image: row.photo_url || null };
  }
  if (type === 'offices') {
    const cats = (() => { try { return row.cats ? JSON.parse(row.cats) : null; } catch { return null; } })();
    return { title: row.name, subtitle: [row.loc, cats].filter(Boolean).join(' · '), image: row.logo_url || null };
  }
  // products/materials
  const p = parseCanonicalRow('products', row);
  return { title: p.title, subtitle: [p.brand_name_raw, p.category].filter(Boolean).join(' · '), image: (p.images && p.images[0]) || null };
}

// /api/admin/legacy?type=<tip>&q=<arama>  (GET: kayıtlarda başlık/isim araması)
// /api/admin/legacy/hidden  (PATCH: {type, key, hidden} — gizle/tekrar göster)
// requireAdmin kontrolü çağıran (src/routes/admin.js#handleAdminRoute) tarafından zaten yapıldı.
export async function handleLegacyAdmin(request, env, url, segments, user) {
  if (segments.length === 3 && request.method === 'GET') return searchLegacy(env, url);
  if (segments.length === 4 && segments[3] === 'hidden' && request.method === 'PATCH') return toggleLegacyHidden(request, env, user);
  if (segments.length === 4 && segments[3] === 'project-action' && request.method === 'POST') return handleProjectAction(request, env, user);
  if (segments.length === 4 && segments[3] === 'content-action' && request.method === 'POST') return handleContentAction(request, env, user);
  if (segments.length === 5 && segments[3] === 'product' && request.method === 'GET') return handleAdminProductDetail(env, segments[4]);
  if (segments.length === 5 && segments[3] === 'product' && request.method === 'PATCH') return handleAdminProductEdit(request, env, segments[4]);
  return errorJson('Bulunamadı', 404);
}

// GET/PATCH /api/admin/legacy/product/:id — admin'in HİÇ gönderiden gelmeyen (legacy_static kökenli)
// ürün/malzeme satırlarını doğrudan düzenleyebilmesi için (bkz. kullanıcı isteği: "Admine tüm
// ürünleri düzenleyebilme yetkisi ver") — products/materials'ta architects/offices/projects'teki gibi
// bir claim sistemi yok (bkz. src/routes/submissions.js#CLAIMED_COLUMN_BY_TYPE, bu ikisi orada yok),
// bu yüzden gönderi tablosuna hiç uğramadan canonical `products` satırını id'siyle doğrudan okuyup
// güncelleyen ayrı, basit bir yol. slug/legacy_key'e KASITLI OLARAK dokunulmaz — products/materials
// hiçbir rename cascade'i desteklemediğinden (bkz. syncProduct'ın da slug'ı hiç değiştirmemesi),
// başlık değişse bile kaydın mevcut URL'si (canonical `slug`) korunur. `id`, hem 'product' hem
// 'material' satırları için AYNI (tek) `products` tablosunun paylaşılan PK'sı olduğundan (bkz.
// migrations/0022_id_first_entities.sql#kind kolonu) tip parametresi gerekmez, satırın kendi `kind`
// kolonundan okunur.
async function handleAdminProductDetail(env, id) {
  const row = await env.DB.prepare(`SELECT * FROM products WHERE id = ? AND deleted_at IS NULL`).bind(id).first();
  if (!row) return errorJson('Bulunamadı', 404);
  const p = parseCanonicalRow('products', row);
  return json({
    item: {
      id: p.id, slug: p.slug, kind: p.kind, title: p.title, brand: p.brand_name_raw, website: p.website,
      category: p.category, description: p.description, images: p.images, specs: p.specs, files: p.files,
      designer: p.designer, year: p.year,
      variants: p.variants, // "Versiyonlar" — form artık düzenliyor (bkz. migrations/0110)
    },
  });
}

async function handleAdminProductEdit(request, env, id) {
  const row = await env.DB.prepare(`SELECT * FROM products WHERE id = ? AND deleted_at IS NULL`).bind(id).first();
  if (!row) return errorJson('Bulunamadı', 404);
  const body = await readJson(request);
  const title = (body.title || '').trim();
  if (!title) return errorJson('Başlık zorunlu.');
  const invalidFilesError = findInvalidFilesField('products', body);
  if (invalidFilesError) return errorJson(invalidFilesError);
  const invalidVariantsError = findInvalidVariantsField('products', body); // body.variants'ı normalize eder
  if (invalidVariantsError) return errorJson(invalidVariantsError);

  let brandOfficeId = null;
  if (body.brand) {
    const match = await findOneByName(env, 'offices', body.brand);
    if (match.ambiguous) return errorJson('Bu marka adıyla birden fazla firma eşleşiyor, önce admin panelinden tekilleştirmen gerekiyor.');
    brandOfficeId = match.row ? match.row.id : null;
  }

  const images = JSON.stringify(body.images || []);
  const specs = JSON.stringify(body.specs || []);
  const files = JSON.stringify(body.files || []); // bkz. migrations/0071_product_files.sql

  // GERÇEK BULGU (kullanıcı isteği, 2026-09-04: "senin yüklediğin ürünlerde görsellerin yerlerini
  // değiştiriyorum ama sıralama popupta değişmiyor"): versiyon galerisinin ürün galerisini
  // gölgelemesi sorunu 2026-09-04'te düzeltilmişti AMA yalnızca GÖNDERİ yolunda
  // (canonicalSync.js#syncProduct). Bu handler İKİNCİ yazma yolu ve tam da içe aktarılmış
  // satırların düzenlendiği yol: toplu içe aktarım `products` satırını doğrudan yazar, hiç
  // `product_submissions` taslağı açmaz — bu yüzden pop-up'taki "Düzenle" o ürünleri buraya
  // (/urun-ekle?adminedit=<id> -> PATCH /api/admin/legacy/product/:id) yönlendirir. Burada
  // `variants` hiç güncellenmediğinden `product-modal.js#renderDetailBody` seçili versiyonun ESKİ
  // `images` dizisini okumaya devam ediyor ve galeri sıralaması pop-up'a HİÇ yansımıyordu.
  //
  // reconcileVariantImages versiyonları SİLMEZ (0086'nın güvencesi korunur): ortak görseller yeni
  // sıraya dizilir, ürün galerisinden çıkarılan görsel versiyondan da düşer, versiyona ÖZEL
  // görseller (teknik çizim gibi, ürün galerisinde hiç bulunmayanlar) dokunulmadan kalır.
  // body.variants bir DİZİYSE form versiyonları açıkça düzenledi (kullanıcı isteği, 2026-09-10 on
  // birinci tur madde 2) — olduğu gibi yazılır; yoksa eski uyarlama (bkz. canonicalSync#syncProduct).
  const nextVariants = Array.isArray(body.variants)
    ? JSON.stringify(body.variants)
    : reconcileVariantImages(row.variants, row.images, images);
  const variantSet = nextVariants === null ? '' : ', variants = ?';
  const variantVal = nextVariants === null ? [] : [nextVariants];
  await env.DB.prepare(
    `UPDATE products SET title = ?, brand_office_id = ?, brand_name_raw = ?, website = ?, category = ?, description = ?, images = ?, specs = ?, files = ?, designer = ?, year = ?${variantSet}, updated_at = datetime('now') WHERE id = ?`
  ).bind(title, brandOfficeId, body.brand || null, body.website || null, body.category || null, body.description || null, images, specs, files, body.designer || null, body.year || null, ...variantVal, id).run();

  // legacy_static kökenli ürünlerin bir product_submissions taslağı hiç olmadığından updateOwnSubmission'daki
  // cleanupReplacedR2Media çağrısından geçmezler — galeriden çıkarılan/dosyalar listesinden kaldırılan
  // eski R2 nesneleri bu yol için AYRICA temizlenmezse sonsuza kadar erişilemez ama silinmemiş kalırdı
  // (bkz. o fonksiyonun dosya başı yorumu — AYNI gerçek bulgu, admin'in doğrudan düzenleme yolu için tekrarı).
  await cleanupReplacedR2Media(env, 'products', row, { images, files });

  await invalidatePublicCache(env);
  await purgeSsrDetailCache('product', row.slug, env);
  if (row.category !== (body.category || null)) await bumpFacetCounts(env, 'products');
  return json({ ok: true, slug: row.slug });
}

async function searchLegacy(env, url) {
  const type = url.searchParams.get('type');
  const q = (url.searchParams.get('q') || '').trim();
  if (!['projects', 'architects', 'offices', 'products', 'materials'].includes(type)) return errorJson('Geçersiz tip.');
  if (q.length < 2) return json({ items: [] });

  const table = CANONICAL_TABLE_BY_TYPE[type];
  const nameCol = CANONICAL_NAME_COL[type];
  const kindClause = (type === 'products' || type === 'materials') ? `AND kind = '${type === 'products' ? 'product' : 'material'}'` : '';
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${table} WHERE deleted_at IS NULL ${kindClause} AND ${nameCol} LIKE ? ORDER BY ${nameCol} LIMIT 50`
  ).bind(`%${q}%`).all();

  return json({
    items: results.map(row => ({ key: canonicalKeyFor(type, row), hidden: !!row.hidden_at, ...shapeCanonicalCard(type, row) })),
  });
}

// canonical satırın hidden_at kolonunu set/temizler.
// skipFacets: bkz. src/routes/unassignedArchive.js#archiveOne — toplu turda facet yeniden hesabı
// KAYIT BAŞINA değil PARTİ BAŞINA yapılır (recomputeProjectFacets her çağrıda TÜM aktif proje
// havuzunu tarar). Tekil admin işlemlerinde bu bayrak hiç geçilmez, davranış birebir aynı kalır.
// skipPublishGraph: bkz. src/routes/submissions.js#unhideIfClaimedApproved — o yol grafı KENDİSİ
// yürütür (id'leri bu çağrıdan ÖNCE yakalar) ve iki kez yürütmek zararsız DEĞİLDİR: ikinci turda
// unpreviewByIds boş döner ama promoteOfficeProjectsOnAssignment `noSpreadIds` BOŞ kümeyle çalışıp
// partideki ikinci projeyi de 1. sıraya damgalar — "kümelenme yok" kuralı bozulur (gerçek regresyon,
// scripts/test-2026-09-11-office-publish-cascade.mjs yakaladı).
export async function setLegacyHidden(env, user, type, key, hidden, { skipFacets = false, skipPublishGraph = false } = {}) {
  const row = await findCanonicalRowByNaturalKey(env, type, key);
  if (!row) return; // henüz canonical karşılığı yoksa sessizce atla (ör. bozuk/eski bir anahtar)
  const table = CANONICAL_TABLE_BY_TYPE[type];
  // preview_at HER İKİ YÖNDE DE temizlenir.
  //   * Yayına alırken (hidden=false): kayıt ÖNİZLEME ("soluk") durumundan da çıkmalı — aksi halde
  //     canlıya dönen kart listede hâlâ soluk/tıklanamaz görünürdü.
  //   * Arşivlerken (hidden=true, kullanıcı isteği 2026-09-10 madde 2: "Kullanıcı arşivle butonuyla
  //     kendi içeriğini arşivlerse bu blurlu gösterim değil direkt arşivleme olsun."): "Arşivle"
  //     HER ZAMAN TAM arşiv demektir. Bu satır olmadan, ZATEN önizlemede olan bir kaydın
  //     arşivlenmesi hiçbir şeyi değiştirmiyordu (hidden_at zaten doluydu, preview_at'e
  //     dokunulmuyordu) — kayıt listelerde soluk kart olarak görünmeye devam ediyordu.
  //     Toplu önizleme dönüşümü bundan ETKİLENMEZ: o, arşivlemeden SONRA preview_at'i ayrı bir
  //     UPDATE ile damgalar (bkz. scripts/archive-unassigned.mjs --to-preview, archive-cinici.mjs).
  // relisted_at: önizlemeden çıkan kayıt liste sıralamasında canlılar arasında EN ÖNE geçsin diye
  // (kullanıcı isteği: "yeni bir paylaşım gibi ilk sıraya yerleşsin") — bkz.
  // migrations/0108_relisted_at.sql'deki sıralama sözleşmesi. YALNIZCA gerçekten önizlemedeyken
  // damgalanır: zaten yayında olan bir kaydın rutin düzenlemesi onu listenin başına fırlatmamalı.
  const previewSet = hidden ? ', preview_at = NULL' : ', preview_at = NULL, relisted_at = CASE WHEN preview_at IS NOT NULL THEN ? ELSE relisted_at END';
  const previewBinds = hidden ? [] : [new Date().toISOString()];
  // YAYIN GRAFI (kullanıcı isteği, 2026-09-12: "Bir mimar profili yayına alınınca projeleri, firması,
  // ortakları vs. hepsi yayına alınmış olsun"). Burası preview_at'i temizleyen İKİ çıkış kapısından
  // biri (öteki canonicalSync'in publish dalı, onu çağıran üç yol grafı KENDİ yakaladıkları id'lerle
  // yürütür) — admin panelinin Gizle/Göster anahtarı ve claim'li gönderinin unhide'ı buradan geçer ve
  // eskiden hiçbir graf çalıştırmıyordu. `wasPreview` UPDATE'ten ÖNCE okunmalı: satır sonrasında
  // önizlemede görünmez. Graf ZATEN CANLI satırlara dokunmaz (unpreviewByIds preview_at süzer), bu
  // yüzden çağıranın ayrıca yürüttüğü grafla çakışması zararsızdır.
  const graphType = (!hidden && !skipPublishGraph) ? PUBLISH_GRAPH_PROFILE_TYPE[type] : null;
  const wasPreview = !!(graphType && row.preview_at);
  await env.DB.prepare(`UPDATE ${table} SET hidden_at = ?${previewSet} WHERE id = ?`).bind(hidden ? new Date().toISOString() : null, ...previewBinds, row.id).run();
  if (!skipFacets && FACET_TYPES.has(type)) await bumpFacetCounts(env, type);
  if (wasPreview) await activateProfilesOnPublish(env, graphType, [row.id], user && user.id);
}

async function toggleLegacyHidden(request, env, user) {
  const body = await readJson(request);
  if (!['projects', 'architects', 'offices', 'products', 'materials'].includes(body.type)) return errorJson('Geçersiz tip.');
  const key = (body.key || '').trim();
  if (!key) return errorJson('Geçersiz kayıt.');
  await setLegacyHidden(env, user, body.type, key, !!body.hidden);
  await invalidatePublicCache(env);
  return json({ ok: true });
}

// GET /api/public/hidden — proje.html/kisi.html/firma.html/urun.html gibi statik sayfaların
// hardcoded data.js dizilerini (projeler-data.js vb.) filtrelemek için kullandığı TEK D1 sinyali
// (bkz. proje.html/proje-detay.html/kisi.html/firma.html/urun.html — hepsi bu uçtan dönen
// slug/name/"marka|||başlık" setini statik diziden çıkarmak için kullanır). Bu yüzden her tip için
// İKİ ayrı "artık gösterme" kaynağını BİRLEŞTİRİR:
//   1) canonical satırın kendisi hâlâ duruyor ama hidden_at (Gizle/Arşivle, geri alınabilir) veya
//      (bu koddan ÖNCE silinmiş, eski) deleted_at set edilmiş,
//   2) canonical satır artık YOK (hardDeleteCanonicalRow ile hard-delete edildi) — bu durumda
//      TEK kalıntı iz legacy_content_hidden'daki blacklist damgasıdır (bkz.
//      src/lib/canonicalSync.js#blacklistLegacyKey/hardDeleteCanonicalRow).
// Önceki hata: bu sorgu yalnızca "hidden_at IS NOT NULL AND deleted_at IS NULL" arıyordu — bir
// kayıt SİLİNDİĞİNDE (deleted_at set edildiğinde, hidden_at hiç dokunulmadığından NULL kalır) bu
// koşulla EŞLEŞMİYOR, yani silinen statik kayıt hiçbir zaman bu listeye girmiyor, dolayısıyla
// data.js'teki karşılığı sitede sonsuza kadar görünmeye devam ediyordu (gerçek bulgu: "Galata
// Apartmanı" silinip "Silindi" mesajı alınmasına rağmen /proje'de kalmaya devam etmesi).
// Faz 4A — Projection Optimization: canonicalKeyFor() yalnızca aşağıdaki kolonları okur (name/slug/
// legacy_key+brand_name_raw+title) — SELECT * ile satırın tamamını (about/awards/description/specs
// gibi bu uçta hiç kullanılmayan ağır metin kolonları dahil) çekmenin okuma tarafında hiçbir faydası
// yoktu; WHERE'deki hidden_at/deleted_at zaten migrations/0028'deki partial indeksle karşılanıyor.
const HIDDEN_MAP_PROJECTION = { architects: 'name', offices: 'name', projects: 'slug', products: 'legacy_key, brand_name_raw, title', materials: 'legacy_key, brand_name_raw, title' };

async function fetchHiddenMap(env) {
  const out = { projects: [], architects: [], offices: [], products: [], materials: [] };
  for (const type of ['projects', 'architects', 'offices', 'products', 'materials']) {
    const table = CANONICAL_TABLE_BY_TYPE[type];
    const kindClause = (type === 'products' || type === 'materials') ? `AND kind = '${type === 'products' ? 'product' : 'material'}'` : '';
    const { results } = await env.DB.prepare(`SELECT ${HIDDEN_MAP_PROJECTION[type]} FROM ${table} WHERE (hidden_at IS NOT NULL OR deleted_at IS NOT NULL) ${kindClause}`).all();
    const keys = new Set(results.map(row => canonicalKeyFor(type, row)).filter(Boolean));
    const { results: blacklisted } = await env.DB.prepare(`SELECT content_key FROM legacy_content_hidden WHERE content_type = ?`).bind(type).all();
    for (const row of blacklisted) keys.add(row.content_key);
    out[type] = [...keys];
  }
  return out;
}

export async function handlePublicHidden(request, env) {
  return cachedPublicJson(request, env, '/api/public/hidden', () => fetchHiddenMap(env));
}

// GET /api/public/preview — ÖNİZLEME ("soluk") durumundaki kayıtların doğal anahtarları
// (kullanıcı isteği, 2026-09-10: "önizleme şeklinde soluk olarak görünsünler, üzerlerine
// tıklanamasın"). handlePublicHidden İLE AYNI desen/gerekçe: istemcinin tek bir D1 sinyaliyle
// hangi kartın soluk olacağını bilmesi gerekiyor.
//
// NEDEN AYRI BİR UÇ (kartlardaki `preview` alanı zaten varken): kartları basan ~30 ayrı render
// noktası var (liste sayfaları, popup şeritleri, ana sayfa karuseli, ilgili projeler...). Hepsine
// tek tek `preview` kontrolü eklemek hem riskli hem de ileride eklenecek YENİ bir render noktasında
// sessizce unutulur. js/components/preview-cards.js bu tek listeyi okuyup DOM'daki eşleşen TÜM
// bağlantıları işaretler — yeni render noktaları otomatik kapsanır.
async function fetchPreviewMap(env) {
  const out = { projects: [], architects: [], offices: [], products: [] };
  const q = async (table) => {
    const { results } = await env.DB.prepare(
      `SELECT slug FROM ${table} WHERE preview_at IS NOT NULL AND deleted_at IS NULL`
    ).all();
    return (results || []).map(r => r.slug).filter(Boolean);
  };
  out.projects = await q('projects');
  out.architects = await q('architects');
  out.offices = await q('offices');
  out.products = await q('products');
  // photographerBlur — sahiplenilmemiş fotoğrafçıların /kisi/ slug'ları (kullanıcı isteği, 2026-09-10
  // on birinci tur madde 7); önizleme listeleriyle AYNI "tek sinyal, DOM'da eşle" deseni, bkz.
  // src/lib/claimedProfiles.js#fetchUnclaimedPhotographerSlugs ve preview-cards.js#markAll.
  out.photographerBlur = await fetchUnclaimedPhotographerSlugs(env);
  return out;
}

export async function handlePublicPreview(request, env) {
  return cachedPublicJson(request, env, '/api/public/preview', () => fetchPreviewMap(env));
}

// GET /api/public/search-suggest?q=<metin> — auth gerektirmez. Üst navigasyondaki arama
// penceresinin canlı öneri listesini besler.
//
// ARTIK (arama denetimi, 2026-09-07): /api/public/search ile AYNI getirme + AYNI sıralama
// (src/lib/classicSearch.js) — pencere o listenin grup başına ilk 3'ünü, sayfa ilk 20'sini
// gösterir; ikisi de aynı gerçek toplamı söyler. Eski uygulama (bkz. git geçmişi) ayrı bir
// fuzzyMatch/alt-dize yoluydu, sıralama yapmıyordu ve toplamı 20'de kırpıyordu ("cami" için
// pencere 21, sayfa 70 diyordu).
const SEARCH_SUGGEST_PER_GROUP = 3;
const SEARCH_SUGGEST_TOTAL = 8;

export async function handlePublicSearchSuggest(request, env, url) {
  const rawQ = (url.searchParams.get('q') || '').trim();
  if (!rawQ) return json({ items: [], total: 0 });

  // KÖKTEN BULGU (2026-09-01, kullanıcı isteği madde 4 — "canlı arama sonuçlarında bazı URL'ler
  // bulunamadı gösteriyor"): anahtar `url.pathname` idi, yani ?q= HARİÇ. Bu uç cacheable
  // listelerinde olmadığından caches.default'a hiç yazılmıyor, ama cachedPublicJson'ın `!cacheable`
  // dalı AYNI anahtarla withSingleFlight uyguluyor — kullanıcı yazarken art arda giden istekler
  // (her tuş vuruşunda bir tane) tek bir in-flight Promise'e bağlanıp BAŞKA bir sorgunun (ör. üç
  // harf önceki ön ekin, hatta aynı isolate'teki BAŞKA bir ziyaretçinin) sonuçlarını alıyordu;
  // açılır pencerede görünen satırlar o yüzden yazılan metinle alakasız olabiliyordu.
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const r = await classicSearch(env, rawQ, { perGroup: SEARCH_SUGGEST_PER_GROUP });
    // href'ler artık kanonik slug kolonundan (eskiden slugify(name) — ad ile slug ayrışmış
    // kayıtlarda "bulunamadı"ya götürüyordu) ve saf markalar için /marka/ önekiyle (bkz.
    // src/lib/officeUrl.js) üretilir.
    // ÖNİZLEME KAYITLARI (kullanıcı isteği, 2026-09-10 madde 5): classicSearch artık arşivdeki
    // "önizleme" satırlarını da döndürüyor, o yüzden burada AYRI bir iş yok — satırlar sıradan
    // /kisi/, /firma/, /marka/, /proje/, /urun/ bağlantıları olarak basılır ve
    // js/components/preview-cards.js (bu sayfada da yüklü) onları DOM'da yakalayıp soluklaştırır,
    // tıklanınca "Bu profil sana mı ait?" popup'ını açar. Bilerek ek bir bayrak taşınmaz: bileşenin
    // tüm tasarım gerekçesi "render noktası başına kontrol serpiştirmemek"tir.
    const groups = [
      { label: 'Kişi', items: r.architects.map(a => ({ title: a.name, meta: a.office || 'Kişi', href: `/kisi/${encodeURIComponent(a.slug)}`, image: a.photo || null, score: a.score })) },
      { label: 'Firma', items: r.offices.map(o => ({ title: o.name, meta: o.loc || '', href: o.href, image: o.logo || null, label: o.pureBrand ? 'Marka' : 'Firma', score: o.score })) },
      { label: 'Proje', items: r.projects.map(p => ({ title: p.title, meta: [p.location, p.date].filter(Boolean).join(' · '), href: `/proje/${encodeURIComponent(p.slug)}`, image: p.image, score: p.score })) },
      { label: 'Ürün', items: r.products.map(p => ({ title: p.title, meta: [p.category, p.brand].filter(Boolean).join(' · '), href: `/urun/${encodeURIComponent(p.slug)}`, image: p.image, score: p.score })) },
    ];
    // Gruplar EN İYİ EŞLEŞMESİNE göre sıralanır (sabit Kişi→Firma→Proje→Ürün sırası DEĞİL):
    // "ofis" yazınca "Ofis MPU" firması, ofisinin adında "Ofis" geçen kişilerden önce; "galata"
    // yazınca projeler en üstte. Ölçülen gerçek durum: sabit sırada ilk üç satır hep ikincil
    // alanla eşleşen kişilerdi (yerel test, 2026-09-07).
    groups.sort((a, b) => (b.items[0] ? b.items[0].score : 0) - (a.items[0] ? a.items[0].score : 0));
    const items = [];
    for (const g of groups) {
      for (const { score, ...it } of g.items.slice(0, SEARCH_SUGGEST_PER_GROUP)) items.push({ label: g.label, ...it });
    }
    const total = Object.values(r.totals).reduce((a, b) => a + b, 0);
    const capped = Object.keys(r.capped).length > 0;
    return { items: items.slice(0, SEARCH_SUGGEST_TOTAL), total, capped };
  });
}

// GET /api/public/search?q=<metin> — arama.html'in tam sonuç sayfası. search-suggest ile AYNI
// getirme/sıralama (src/lib/classicSearch.js), yalnızca grup başına daha yüksek sınır. Dört
// varlık türünü BİRDEN döner (kişi/firma+marka/proje/ürün) — arama.html eskiden ürün ve
// firma/marka için üç ek isteği (/api/products?search, /api/offices?search, ?brands=1) ayrı
// ayrı atıyor ve her biri kendi (farklı) alt-dize eşleştirmesini yapıyordu.
const SEARCH_FULL_PER_GROUP = 20;

export async function handlePublicSearchFull(request, env, url) {
  const rawQ = (url.searchParams.get('q') || '').trim();
  if (!rawQ) {
    return json({ architects: [], offices: [], projects: [], products: [],
      totals: { architects: 0, offices: 0, projects: 0, products: 0 }, capped: {} });
  }
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    return classicSearch(env, rawQ, { perGroup: SEARCH_FULL_PER_GROUP });
  });
}

// Bir projenin "şu an canlıda görünen" hâli, canonical satırdan doğrudan okunur (artık statik +
// overlay birleştirmesi gerekmiyor — bkz. src/routes/project.js'teki AYNI okuma). Arşivleme, projeyi
// bu haliyle bir project_submissions taslağına kopyalar ki admin panelde düzenlerken en son
// görünen içerikten devam etsin.
const PROJECT_FIELD_KEYS = ['title', 'category', 'type', 'discipline', 'location', 'locationDetail', 'date', 'dateBucket', 'period', 'designer', 'photoCreditText', 'photoCreditUrl', 'description', 'images', 'brands', 'build_status', 'awards'];

async function currentCanonicalProjectFields(env, slug) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE (slug = ? OR legacy_key = ?) AND deleted_at IS NULL`).bind(slug, slug).first();
  if (!row) return null;
  const p = parseCanonicalRow('projects', row);
  const { results: designerRows } = await env.DB.prepare(
    `SELECT COALESCE(ar.name, ofc.name) AS name FROM project_designers pd
     LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL
     LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
     WHERE pd.project_id = ?`
  ).bind(row.id).all();
  return {
    title: p.title, category: p.category, type: p.type, discipline: p.discipline,
    location: p.location, locationDetail: p.location_detail,
    date: p.project_date, dateBucket: p.date_bucket, period: p.period,
    designer: designerRows.map(d => d.name).filter(Boolean),
    photoCreditText: p.photo_credit_text || null, photoCreditUrl: p.photo_credit_url || null,
    description: p.description, images: p.images, brands: [], // bkz. src/routes/project.js#shapeProjectItem'daki AYNI kapsam notu
    build_status: p.build_status === 'concept' ? 'concept' : 'built',
    awards: p.awards || [],
  };
}

function bindProjectFields(fields) {
  return PROJECT_FIELD_KEYS.map(f =>
    SUBMISSION_TYPES.projects.arrayFields.includes(f) ? JSON.stringify(fields[f] || []) : fields[f]
  );
}

// POST /api/admin/legacy/project-action  body: {action:'delete'|'archive'|'publish', id?, slug?}
// requireAdmin kontrolü çağıran (handleAdminRoute) tarafından zaten yapıldı — gövde parse edilip
// runProjectAction'a (aşağıda, gerçek işlem mantığı) devredilir.
async function handleProjectAction(request, env, user) {
  const body = await readJson(request);
  return runProjectAction(env, user, body);
}

// runProjectAction: handleProjectAction'ın (admin, yukarıda) VE handleSelfProjectDelete'in (proje
// sahibi kendi popup'ından "Sil"e bastığında, bkz. kullanıcı isteği "Kullanıcı Gönderi Düzenleme &
// Silme İzinleri") paylaştığı gerçek işlem mantığı — iki çağıran da (request gövdesi parse edilmiş
// biçimde) BURAYA gelmeden önce KENDİ yetki kontrolünü (admin rolü / proje sahipliği) yapmış olmalı,
// bu fonksiyon kendi başına hiçbir yetki kontrolü YAPMAZ.
export async function runProjectAction(env, user, { action, id, slug, skipFacets = false } = {}) {
  id = (id || '').trim();
  slug = (slug || '').trim();
  if (!['delete', 'archive', 'publish'].includes(action)) return errorJson('Geçersiz işlem.');
  if (!id && !slug) return errorJson('Geçersiz istek.');

  if (id) {
    const row = await env.DB.prepare(`SELECT * FROM project_submissions WHERE id = ?`).bind(id).first();
    if (!row) return errorJson('Bulunamadı.', 404);
    const now = Date.now();
    const targetSlug = row.claimed_slug || row.slug;
    if (action === 'delete') {
      // R2 temizliği satır D1'den SİLİNDİKTEN sonra (bkz. src/lib/canonicalSync.js#deleteR2MediaKeys
      // ÇAĞIRAN SÖZLEŞMESİ) — satır dururken kendi anahtarlarına "referans" sayılırdı. Canonical
      // satır aşağıda ayrıca siliniyor; ortak anahtarlar bu çağrıda KORUNUR, hardDeleteCanonicalRow
      // kendi turunda (taslak artık yokken) siler.
      const draftKeys = collectR2MediaKeys(row, MEDIA_IMAGE_FIELDS_BY_TYPE.projects);
      await env.DB.prepare(`DELETE FROM project_submissions WHERE id = ?`).bind(id).run();
      await deleteR2MediaKeys(env, draftKeys);
      // Bu içeriği CANLIDAN kaldırmak — hem bağımsız üye projesi hem (arşivlenmiş) claimed_slug'lı
      // bir taslak için de canonical satırı KALICI olarak (hard delete) siler + statik data.js
      // karşılığının bir daha görünmemesi için blacklist'e damgalar. deleteCanonicalRowFully bunu
      // (hard-delete/blacklist) ve engagement cascade'i (cascadeDeleteProject) HER ZAMAN birlikte
      // çalıştırır (bkz. src/lib/canonicalSync.js#deleteCanonicalRowFully'deki audit notu).
      const canonRow = await findCanonicalRowByNaturalKey(env, 'projects', targetSlug);
      // AYNI canonical projeyi temsil eden DİĞER taslaklar da gider (bkz. canonicalDraftRows) —
      // canonical satır SİLİNMEDEN ÖNCE, çünkü bağın ikinci yolu o satırın legacy_key'idir.
      await deleteCanonicalDrafts(env, 'projects', 'project_submissions',
        { claimedColumn: 'claimed_slug', key: targetSlug, canonRow, skipId: id });
      await deleteCanonicalRowFully(env, user.id, 'projects', canonRow, targetSlug, () => cascadeDeleteProject(env, targetSlug));
      await bumpFacetCounts(env, 'projects');
    } else if (action === 'archive') {
      await env.DB.prepare(`UPDATE project_submissions SET status = 'archived', updated_at = ? WHERE id = ?`).bind(now, id).run();
      if (row.claimed_slug) await setLegacyHidden(env, user, 'projects', row.claimed_slug, true);
      else await bumpFacetCounts(env, 'projects');
      // AYNI canonical projeyi temsil eden diğer taslaklar da 'archived' olur — biri 'approved'
      // kalırsa proje bir yanda "Yayında" bir yanda "Arşivde" görünür ve o taslağın sahibi
      // kaydederek arşivlenmiş projeyi sessizce yeniden yayına alabilir (bkz. archiveCanonicalDrafts).
      await archiveCanonicalDrafts(env, 'project_submissions', {
        claimedColumn: 'claimed_slug', key: targetSlug, now, skipId: id,
        canonRow: await findCanonicalRowByNaturalKey(env, 'projects', targetSlug),
      });
    } else {
      await env.DB.prepare(`UPDATE project_submissions SET status = 'approved', updated_at = ? WHERE id = ?`).bind(now, id).run();
      await syncApprovedSubmissionToCanonical(env, 'projects', parseSubmissionRow('projects', { ...row, status: 'approved' }));
      if (row.claimed_slug) await setLegacyHidden(env, user, 'projects', row.claimed_slug, false);
      else await bumpFacetCounts(env, 'projects');
    }
    await invalidatePublicCache(env);
    await purgeSsrDetailCache('project', targetSlug, env);
    return json({ ok: true });
  }

  // slug ile: statik/canonical bir proje, henüz kendine ait bir project_submissions satırı olmayabilir.
  if (action === 'publish') return errorJson('Geçersiz istek.');

  if (action === 'delete') {
    // canonical satır hiç yoksa (ör. statik migration hiç çalıştırılmadıysa) bile blacklist'e
    // damgalamak GEREKİR — aksi halde data.js'teki karşılığı asla gizlenmeyecek bir "hayalet" olur.
    // deleteCanonicalRowFully bunu (hard-delete/blacklist) ve engagement cascade'i HER ZAMAN
    // birlikte çalıştırır (bkz. src/lib/canonicalSync.js#deleteCanonicalRowFully'deki audit notu).
    const canonRow = await findCanonicalRowByNaturalKey(env, 'projects', slug);
    // Taslaklar canonical satır SİLİNMEDEN ÖNCE toplanır: bağın ikinci (ve üyenin KENDİ gönderisi
    // için TEK) yolu o satırın legacy_key='submission:<id>' işaretidir (bkz. canonicalDraftRows).
    // Eskiden yalnızca `claimed_slug = slug` taslakları siliniyordu — bu yolu kullanan tek çağıran
    // firma yetkilisinin "Sil"i olduğundan, projeyi siteye ekleyen üyenin taslağı 'approved' olarak
    // kalıyor ve bir sonraki kaydetmesinde proje geri geliyordu ("direkt silinsin" tutmuyordu).
    await deleteCanonicalDrafts(env, 'projects', 'project_submissions',
      { claimedColumn: 'claimed_slug', key: slug, canonRow });
    await deleteCanonicalRowFully(env, user.id, 'projects', canonRow, slug, () => cascadeDeleteProject(env, slug));
    await bumpFacetCounts(env, 'projects');
    await invalidatePublicCache(env);
    await purgeSsrDetailCache('project', slug, env);
    return json({ ok: true });
  }

  const fields = await currentCanonicalProjectFields(env, slug);
  if (!fields) return errorJson('Böyle bir proje bulunamadı.', 404);
  const now = Date.now();
  const canonRow = await findCanonicalRowByNaturalKey(env, 'projects', slug);
  // ARŞİV TASLAĞI: önce claimed_slug'lı bir taslak, YOKSA projenin DOĞDUĞU taslak (canonical
  // satırın legacy_key işareti — üyenin kendi gönderisi) kullanılır. İkinci dal kullanıcı isteğinin
  // (2026-09-17 madde 2) gereği: eskiden HER ZAMAN İKİNCİ bir taslak açılıyor, üyenin taslağı
  // 'approved' kalıyordu — aynı proje bir yanda "Yayında" bir yanda "Arşivde" görünüyordu.
  const drafts = await canonicalDraftRows(env, 'project_submissions',
    { claimedColumn: 'claimed_slug', key: slug, canonRow });
  const existing = drafts.find(d => d.claimed_slug === slug) || drafts[0] || null;
  if (existing) {
    // owner_user_id KORUNUR (varsa): taslak projeyi siteye ekleyen üyenin gönderi satırı olabilir,
    // onu arşivleyenin üzerine yazmak o üyenin gönderisini elinden almak olurdu. Arşiv kutusunda
    // yetkiliye GÖRÜNMESİ sahiplikten değil firma bağından gelir (bkz. src/routes/archive.js).
    // claimed_slug da yazılır — "Düzenle ve Yayına Al" yolunun yetki kapısı (bkz. submissions.js#
    // canAccessSubmissionRow -> claimedSlugVerifierFor) bu kolonu okur.
    await env.DB.prepare(
      `UPDATE project_submissions SET ${PROJECT_FIELD_KEYS.map(f => `${f} = ?`).join(', ')}, status = 'archived',
        claimed_slug = ?, owner_user_id = COALESCE(owner_user_id, ?), updated_at = ? WHERE id = ?`
    ).bind(...bindProjectFields(fields), slug, user.id, now, existing.id).run();
  } else {
    const columns = ['id', 'owner_user_id', 'status', 'created_at', 'updated_at', 'slug', 'claimed_slug', ...PROJECT_FIELD_KEYS];
    const placeholders = columns.map(() => '?').join(', ');
    await env.DB.prepare(
      `INSERT INTO project_submissions (${columns.join(', ')}) VALUES (${placeholders})`
    ).bind(newId(), user.id, 'archived', now, now, slug, slug, ...bindProjectFields(fields)).run();
  }
  // Kalan taslaklar da 'archived' (normalde hiç yoktur; iki yetkilinin ayrı ayrı taslağı varsa olur).
  await archiveCanonicalDrafts(env, 'project_submissions',
    { claimedColumn: 'claimed_slug', key: slug, canonRow, now, skipId: existing ? existing.id : null });
  await setLegacyHidden(env, user, 'projects', slug, true, { skipFacets });
  await invalidatePublicCache(env);
  await purgeSsrDetailCache('project', slug, env);
  return json({ ok: true });
}

// Admin olmayan bir çağıranın bir projeyi silip/arşivleyebilmesi için gereken sahiplik kontrolü —
// handleSelfProjectDelete/handleSelfProjectModerate'te ORTAK. İki AYRI kaynaktan gelebilir:
//   1) Bağımsız kendi gönderisi (claimed_slug YOK) — owner_user_id eşleşmesi TEK BAŞINA yeterli,
//      bu bir mimar/firma sahiplenmesinden bağımsız, kalıcı bir haktır (bkz. kullanıcı isteği:
//      "Kullanıcı Gönderi Düzenleme & Silme İzinleri").
//   2) Künyedeki bir mimar/firmayı sahiplenerek düzenlenen bir statik proje (claimed_slug DOLU) —
//      BURADA owner_user_id eşleşmesi TEK BAŞINA YETERLİ DEĞİL: bu satır, aşağıdaki runProjectAction
//      'archive' dalının (claimed_slug'lı, sahibi=user.id) OTOMATİK OLUŞTURDUĞU bir taslaktır ve admin
//      o profil atamasını (profile_claims) SONRADAN geri alsa bile kalıcı olarak DB'de kalır — gerçek
//      bulgu: bir mimar/firma ataması Kaldır'la geri alındıktan SONRA bile, o profile daha önce erişimi
//      olmuş kullanıcı bu satır üzerinden projeyi silmeye devam edebiliyordu. Bu yüzden claimed_slug'lı
//      satırlarda yetki HER SEFERİNDE canUserEditProjectBySlug (profile_claims.status='approved'i CANLI
//      okuyan) ile yeniden doğrulanır — kalıcı bir "bir kere erişti, sonsuza dek erişir" hakkı YOKTUR.
async function canDeleteOrModerateProject(env, user, slug) {
  const owns = await env.DB.prepare(
    `SELECT 1 FROM project_submissions WHERE owner_user_id = ? AND slug = ? AND claimed_slug IS NULL LIMIT 1`
  ).bind(user.id, slug).first();
  if (owns) return true;
  return canUserEditProjectBySlug(env, user, slug);
}

// DELETE /api/project/:slug — proje sahibinin (admin-panel DIŞINDA, doğrudan proje pop-up'ından)
// kendi projesini silmesi (bkz. kullanıcı isteği: "Kullanıcı Gönderi Düzenleme & Silme İzinleri").
// Admin'in /api/admin/legacy/project-action'ından farkı: burası admin ÖN-YETKİ KONTROLÜNDEN
// (handleAdminRoute) GEÇMİYOR, dolayısıyla admin olmayan bir çağıran için sahiplik BURADA açıkça
// doğrulanır — bkz. yukarıdaki canDeleteOrModerateProject; bu, proje.html'in "Sil" butonunu göstermeden
// ÖNCE istemci tarafında yaptığı AYNI kontrolün sunucu tarafı garantisidir — istemci kontrolü tek
// başına güvenlik sağlamaz. Admin isteği ownership kontrolüne takılmadan geçer (mevcut admin uçlarıyla
// aynı davranış). İşlem her zaman slug tabanlı silme yolunu (runProjectAction action:'delete', id YOK)
// kullanır — sıradan bir kullanıcının kendi project_submissions.id'sini bilmesi gerekmez.
export async function handleSelfProjectDelete(request, env, slug) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);
  if (user.role !== 'admin') {
    if (!(await canDeleteOrModerateProject(env, user, slug))) return errorJson('Bu projeyi silme yetkin yok.', 403);
  }
  return runProjectAction(env, user, { action: 'delete', slug });
}

// POST /api/project/:slug/moderate  body: {action:'archive'}  — proje sahibinin (ya da admin'in)
// kendi popup'ından "Arşivle"ye basması (bkz. kullanıcı isteği: sahibe Düzenle/Arşivle/Sil üçü
// birden gösterilsin). handleSelfProjectDelete ile AYNI sahiplik doğrulaması kullanılır; delete
// zaten ayrı bir DELETE metoduna sahip olduğundan burada yalnızca 'archive' kabul edilir.
export async function handleSelfProjectModerate(request, env, slug) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);
  const body = await readJson(request);
  if (body.action !== 'archive') return errorJson('Geçersiz işlem.');
  if (user.role !== 'admin') {
    if (!(await canDeleteOrModerateProject(env, user, slug))) return errorJson('Bu proje için yetkin yok.', 403);
  }
  return runProjectAction(env, user, { action: 'archive', slug });
}

// architects/offices için "arşivle" — canonical satırın GÜNCEL hâlini bir *_submissions taslağına
// kopyalar (admin'in mevcut düzenleme formlarıyla düzenleyebilmesi için), sonra canonical satırı
// hidden_at ile canlıdan çeker. "Yayınla" taslağı onaylar (canonical'a senkronlar) ve hidden_at'i temizler.
const CONTENT_ACTION_TYPES = {
  architects: {
    table: 'architect_submissions',
    claimedColumn: 'claimed_profile_key',
    // portfolio — bkz. migrations/0105_architect_portfolio.sql. Arşivle/Yayınla, canonical satırı
    // bir taslağa kopyalayıp geri yazar; buraya eklenmezse arşivlenip yeniden yayımlanan her kişi
    // profili portfolyosunu SESSİZCE kaybederdi (bindContentFields arrayFields'ı JSON'a çevirir).
    copyFields: ['name', 'dob', 'school', 'dept', 'office', 'position', 'profession', 'awards', 'photo_url', 'about', 'portfolio'],
    async canonicalFields(env, key) {
      const row = await findCanonicalRowByNaturalKey(env, 'architects', key);
      if (!row) return null;
      const a = parseCanonicalRow('architects', row);
      const office = a.office_id ? await env.DB.prepare(`SELECT name FROM offices WHERE id = ?`).bind(a.office_id).first() : null;
      return {
        name: a.name, dob: a.dob, school: a.school, dept: a.dept, office: office ? office.name : null,
        position: a.position, profession: a.profession, awards: a.awards, photo_url: a.photo_url, about: a.about,
        portfolio: a.portfolio,
      };
    },
  },
  offices: {
    table: 'office_submissions',
    claimedColumn: 'claimed_profile_key',
    copyFields: ['name', 'loc', 'cats', 'yil', 'website', 'about', 'logo_url', 'awards', 'founders'],
    async canonicalFields(env, key) {
      const row = await findCanonicalRowByNaturalKey(env, 'offices', key);
      if (!row) return null;
      const o = parseCanonicalRow('offices', row);
      return {
        name: o.name, loc: o.loc, cats: o.cats, yil: o.yil, website: o.website,
        about: o.about, logo_url: o.logo_url, awards: o.awards, founders: [],
      };
    },
  },
  products: {
    table: 'product_submissions',
    claimedColumn: null,
    copyFields: ['title', 'brand', 'designer', 'year', 'website', 'category', 'description', 'images', 'specs'],
    async canonicalFields(env, key) {
      const row = await findCanonicalRowByNaturalKey(env, 'products', key);
      if (!row) return null;
      const p = parseCanonicalRow('products', row);
      return { title: p.title, brand: p.brand_name_raw, designer: row.designer || null, year: row.year || null, website: p.website, category: p.category, description: p.description, images: p.images, specs: p.specs };
    },
  },
  materials: {
    table: 'material_submissions',
    claimedColumn: null,
    copyFields: ['title', 'brand', 'designer', 'year', 'website', 'category', 'description', 'images', 'specs'],
    async canonicalFields(env, key) {
      const row = await findCanonicalRowByNaturalKey(env, 'materials', key);
      if (!row) return null;
      const p = parseCanonicalRow('products', row);
      return { title: p.title, brand: p.brand_name_raw, designer: row.designer || null, year: row.year || null, website: p.website, category: p.category, description: p.description, images: p.images, specs: p.specs };
    },
  },
};

// GERÇEK BULGU (bkz. [[project_bulk_admin_ops_via_live_code_2026_09_08]]): `offices.cats` bu depoda
// ' · ' ile ayrılmış TEK BİR METİN olarak saklanır ve arrayFields'ta DEĞİLDİR — ama canlıda bazı
// satırlarda dizi biçiminde durur (eski içe aktarımlar) ve parseCanonicalRow onları dizi olarak
// döndürür. O durumda aşağıdaki `fields[f] ?? null` D1'e bir DİZİ bind etmeye çalışır ve arşivleme
// o kayıt için PATLAR. Tekil bir kayıtta bu yalnızca bir hata mesajıdır; toplu arşivlemede (bkz.
// src/routes/unassignedArchive.js) ilerlemeyi tümden durdurur. Dizi olarak gelen dizi-OLMAYAN bir
// alan, saklandığı biçime (birleştirilmiş metin) normalize edilir.
function bindContentFields(type, fields) {
  const { copyFields } = CONTENT_ACTION_TYPES[type];
  const arrayFields = SUBMISSION_TYPES[type].arrayFields;
  return copyFields.map(f => {
    if (arrayFields.includes(f)) return JSON.stringify(fields[f] || []);
    const value = fields[f];
    if (Array.isArray(value)) return value.filter(Boolean).join(' · ') || null;
    return value ?? null;
  });
}

// POST /api/admin/legacy/content-action  body: {type:'architects'|'offices'|'products'|'materials', action:'delete'|'archive'|'publish', id?, key?}
async function handleContentAction(request, env, user) {
  const body = await readJson(request);
  return runContentAction(env, user, { type: body.type, action: body.action, id: body.id, key: body.key });
}

// ADMIN BİR FİRMAYI/MARKAYI ARŞİVLEYİNCE KÜNYESİNDEKİ KİŞİ/PROJE/ÜRÜNLER DE ARŞİVLENİR
// (kullanıcı isteği, 2026-09-14: "admin bir firmayı ya da markayı arşivlerse o firma ve markaya ait
// kişiler, projeler ve ürünler otomatik olarak arşivlensin").
//
// YAYIN GRAFININ TERSİ: src/routes/admin.js#activateProfileGraph ("firmayı yayına alınca projeleri
// ve kişileri de yayına gelsin") ile AYNI ilişkileri okur — hangi kayıtların birlikte hareket ettiği
// sorusunun iki yönde iki ayrı cevabı olmasın diye. İlişki toplama işi tek kaynakta:
// src/lib/officeArchiveCascade.js#collectOfficeArchiveTargets (orada neyin neden kapsam dışı
// bırakıldığı da yazılı).
//
// YALNIZCA ADMIN: istek açıkça "admin ... arşivlerse" diyor. Sıradan bir kullanıcının kendi firmasını
// arşivlemesi (src/routes/submissions.js#handleSelfContentModerate -> runContentAction) BU CASCADE'İ
// TETİKLEMEZ — o kullanıcının, künyedeki başka kişilerin profillerini ve ortak projeleri canlıdan
// düşürme yetkisi yoktur; admin panelindeki toplu işlem ile kullanıcının kendi kaydını gizlemesi
// aynı şey değildir.
//
// YALNIZCA firma/marka (type === 'offices'): marka ayrı bir tablo DEĞİL, o da bir `offices` satırıdır
// (bkz. office-kind.js) — tek dal ikisini birden kapsar. Kişi arşivlemek bu cascade'i tetiklemez,
// dolayısıyla özyineleme (kişi -> firma -> kişi) da yoktur.
//
// CANLI KOD YOLU: her kayıt runProjectAction/runContentAction'dan geçer, çünkü geri alınabilirliği
// sağlayan *_submissions taslağı ("Arşivim > Yayına Al") yalnızca orada oluşur — toplu bir
// `UPDATE ... hidden_at` bu taslakları HİÇ yaratmaz.
//
// skipFacets: proje arşivlemek bumpFacetCounts('projects')i tetikler, o da TÜM aktif proje havuzunu
// okuyup facet_counts'u baştan yazar (bkz. src/lib/facetCounts.js#recomputeProjectFacets). Kayıt
// başına çalıştırmak tek bir admin isteğini dakikalara çıkarır; parti sonunda BİR KEZ çalıştırılır
// (src/routes/unassignedArchive.js#archiveOne ile AYNI gerekçe ve AYNI çözüm).
async function archiveOfficeGraph(env, user, type, officeKey) {
  if (type !== 'offices' || !officeKey) return null;
  if (!user || user.role !== 'admin') return null;
  const office = await findCanonicalRowByNaturalKey(env, 'offices', officeKey);
  if (!office) return null;

  const targets = await collectOfficeArchiveTargets(env, office);
  const done = { architects: [], projects: [], products: [] };
  const failed = [];

  for (const p of targets.projects) {
    const res = await runProjectAction(env, user, { action: 'archive', slug: p.key, skipFacets: true });
    if (res && res.status >= 400) failed.push(p.label); else done.projects.push(p.label);
  }
  for (const a of targets.architects) {
    const res = await runContentAction(env, user, { type: 'architects', action: 'archive', key: a.key });
    if (res && res.status >= 400) failed.push(a.label); else done.architects.push(a.label);
  }
  for (const pr of targets.products) {
    const res = await runContentAction(env, user, { type: pr.type, action: 'archive', key: pr.key });
    if (res && res.status >= 400) failed.push(pr.label); else done.products.push(pr.label);
  }
  if (done.projects.length) await bumpFacetCounts(env, 'projects');

  return {
    archived: { architects: done.architects, projects: done.projects, products: done.products },
    // Ortak künye koruması nedeniyle canlıda BIRAKILANLAR (bkz. collectOfficeArchiveTargets) —
    // admin "arşivledim" dedikten sonra hâlâ yayında duran bir kaydı görünce bunun bir hata değil,
    // hâlâ yayında olan BAŞKA bir firmanın künyesini koruma olduğunu anlayabilsin.
    skipped: targets.skipped,
    ...(failed.length ? { failed } : {}),
  };
}

// runProjectAction (bu dosyada aşağıda) ile AYNI desen — bu fonksiyon kendi başına hiçbir yetki
// kontrolü YAPMAZ, çağıranı (handleContentAction, admin dispatcher) kendi yetki kontrolünü yapıp
// buraya düşer.
export async function runContentAction(env, user, { type, action, id, key }) {
  const config = CONTENT_ACTION_TYPES[type];
  if (!config) return errorJson('Geçersiz tip.');
  id = (id || '').trim();
  key = (key || '').trim();
  if (!['delete', 'archive', 'publish'].includes(action)) return errorJson('Geçersiz işlem.');
  if (!id && !key) return errorJson('Geçersiz istek.');

  // Firma/marka arşivlenince künyesindeki kişi/proje/ürünlere ne olduğunun raporu (bkz.
  // archiveOfficeGraph). Yanıtta döner ki admin ne kadarının birlikte arşivlendiğini görsün.
  let cascade = null;

  if (id) {
    // bkz. src/lib/canonicalSync.js#findOrHealSubmissionDraft dosya başı yorumu — products/materials'ta
    // taslak (product_submissions/material_submissions) satırı eksik ama canonical `products` satırı
    // hâlâ varsa, taslağı canonical'dan yeniden türetir ki id tabanlı Sil/Arşivle/Yayınla sessizce
    // 404 vermesin (gerçek bulgu: doğrudan D1'e geri yüklenen ürünler için taslak hiç yoktu).
    const row = (type === 'products' || type === 'materials')
      ? await findOrHealSubmissionDraft(env, type, id)
      : await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
    if (!row) return errorJson('Bulunamadı.', 404);
    const now = Date.now();
    // products/materials'ın claimedColumn'u yok (bkz. CONTENT_ACTION_TYPES) — canonical satırları
    // legacy_key = 'submission:<id>' işaretiyle bulunur (bkz. src/lib/canonicalSync.js#syncProduct).
    // GERÇEK BULGU: targetKey eskiden yalnızca claimedColumn/key'e düşüyordu, ikisi de products/
    // materials'ta hep boş olduğundan Sil (canonical satır HİÇ silinmiyor/karalisteye alınmıyordu,
    // yalnızca moderasyon satırı gidiyordu — ürün canlıda kalmaya devam ediyordu) VE Arşivle
    // (hidden_at HİÇ set edilmiyordu, yalnızca facet sayaçları güncelleniyordu — ürün canlıdan asla
    // kalkmıyordu) products/materials için sessizce hiçbir şey yapmıyordu.
    const legacyKeyFallback = (type === 'products' || type === 'materials') ? `submission:${id}` : null;
    // products/materials'ın claimedColumn'u yok ama `claimed_slug`'ı VAR (bkz. migrations/
    // 0088_product_claimed_slug.sql) — anahtarla (key ile) arşivlenmiş bir ürünün taslağı artık
    // canonical satırın slug'ını taşıyor (bkz. aşağıdaki key dalı), bu yüzden id ile yapılan
    // Arşivle/Yayınla/Sil de o canonical satırı bulabilmeli. GERÇEK BULGU (kullanıcı isteği,
    // 2026-09-10 madde 3 hazırlığı): bu olmadan `submission:<id>` fallback'ine düşülüyordu; o
    // anahtara karşılık gelen canonical satır HİÇ YOK, dolayısıyla "Yayınla" orijinal (gizli) ürünü
    // geri açmak yerine syncProduct'a YENİ bir satır açtırıyor, eski kayıt sonsuza dek gizli
    // kalıyordu — yani arşivden yayına alma ürünlerde kaydı ÇOĞALTIYORDU.
    const claimedSlugKey = (type === 'products' || type === 'materials') ? (row.claimed_slug || null) : null;
    const targetKey = (config.claimedColumn && row[config.claimedColumn]) || claimedSlugKey || key || legacyKeyFallback;
    if (action === 'delete') {
      // bkz. yukarıdaki proje dalındaki AYNI sıra gerekçesi (deleteR2MediaKeys ÇAĞIRAN SÖZLEŞMESİ).
      const draftKeys = collectR2MediaKeys(row, MEDIA_IMAGE_FIELDS_BY_TYPE[type] || {});
      await env.DB.prepare(`DELETE FROM ${config.table} WHERE id = ?`).bind(id).run();
      await deleteR2MediaKeys(env, draftKeys);
      // deleteCanonicalRowFully, runContentCascadeDelete (yorum/puan/kaydetme + *_submissions
      // temizliği) ile hard-delete/blacklist'i HER ZAMAN birlikte çalıştırır (bkz.
      // src/lib/canonicalSync.js#deleteCanonicalRowFully'deki audit notu).
      const canonRow = targetKey ? await findCanonicalRowByNaturalKey(env, type, targetKey) : null;
      // AYNI canonical kaydı temsil eden DİĞER taslaklar da gider (bkz. canonicalDraftRows) —
      // canonical satır silinmeden ÖNCE, bağın ikinci yolu onun legacy_key'i olduğu için.
      await deleteCanonicalDrafts(env, type, config.table,
        { ...draftLinkFor(type, config, targetKey, canonRow), canonRow, skipId: id });
      await deleteCanonicalRowFully(env, user.id, type, canonRow, targetKey, () => runContentCascadeDelete(env, user, type, { id, row }));
      if (FACET_TYPES.has(type)) await bumpFacetCounts(env, type);
    } else if (action === 'archive') {
      await env.DB.prepare(`UPDATE ${config.table} SET status = 'archived', updated_at = ? WHERE id = ?`).bind(now, id).run();
      if (targetKey) await setLegacyHidden(env, user, type, targetKey, true);
      else if (FACET_TYPES.has(type)) await bumpFacetCounts(env, type);
      // Kalan taslaklar da 'archived' — biri 'approved' kalırsa kayıt bir yanda "Yayında" bir yanda
      // "Arşivde" görünür ve o taslağın sahibi kaydederek arşivi sessizce geri açabilir.
      {
        const canonRow = targetKey ? await findCanonicalRowByNaturalKey(env, type, targetKey) : null;
        await archiveCanonicalDrafts(env, config.table,
          { ...draftLinkFor(type, config, targetKey, canonRow), canonRow, now, skipId: id });
      }
      // Firma/marka arşivleniyorsa künyesindeki kişi/proje/ürünler de — bkz. archiveOfficeGraph.
      cascade = await archiveOfficeGraph(env, user, type, targetKey || row.name);
    } else {
      // Arşiv > "Yayınla" önizlemedeki bir firmayı ya da KİŞİYİ açıyorsa grafı da (projeler,
      // firmalar/ortaklar, ürünler — bkz. src/routes/admin.js#activateProfilesOnPublish);
      // id'ler senkrondan ÖNCE yakalanır.
      const publishGraphType = PUBLISH_GRAPH_PROFILE_TYPE[type] || null;
      const publishingProfileIds = publishGraphType
        ? await previewProfileIdsByKeys(env, publishGraphType, [targetKey, row.name, `submission:${id}`]) : [];
      await env.DB.prepare(`UPDATE ${config.table} SET status = 'approved', updated_at = ? WHERE id = ?`).bind(now, id).run();
      await syncApprovedSubmissionToCanonical(env, type, parseSubmissionRow(type, { ...row, status: 'approved' }));
      if (targetKey) await setLegacyHidden(env, user, type, targetKey, false);
      else if (FACET_TYPES.has(type)) await bumpFacetCounts(env, type);
      if (publishingProfileIds.length) await activateProfilesOnPublish(env, publishGraphType, publishingProfileIds, user.id);
    }
    await invalidatePublicCache(env);
    const target = ssrPurgeTargetFor(type, row);
    if (target) await purgeSsrDetailCache(target.type, target.key, env);
    return json({ ok: true, ...(cascade ? { cascade } : {}) });
  }

  // key ile: canonical bir kayıt, henüz kendine ait bir *_submissions satırı olmayabilir.
  if (action === 'publish') return errorJson('Geçersiz istek.');

  if (action === 'delete') {
    // deleteCanonicalRowFully, runContentCascadeDelete ile hard-delete/blacklist'i HER ZAMAN
    // birlikte çalıştırır (bkz. src/lib/canonicalSync.js#deleteCanonicalRowFully'deki audit notu).
    const canonRow = await findCanonicalRowByNaturalKey(env, type, key);
    // Taslaklar canonical satır SİLİNMEDEN ÖNCE (bağın ikinci yolu onun legacy_key'i) ve ARTIK
    // ÜRÜNLERDE DE: eski `if (config.claimedColumn)` koşulu products/materials'ta hiç girmiyordu
    // (o tipte claimedColumn yok), yani markanın yetkilisi bir ürünü "Sil" dediğinde canonical satır
    // gidiyor ama ürünü ekleyen üyenin taslağı 'approved' olarak kalıyordu — bir sonraki kaydetmesi
    // ürünü geri getiriyordu (kullanıcı isteği, 2026-09-17 madde 2: "sil derse direkt silinsin").
    await deleteCanonicalDrafts(env, type, config.table,
      { ...draftLinkFor(type, config, key, canonRow), canonRow });
    await deleteCanonicalRowFully(env, user.id, type, canonRow, key, () => runContentCascadeDelete(env, user, type, { key }));
    if (FACET_TYPES.has(type)) await bumpFacetCounts(env, type);
    await invalidatePublicCache(env);
    const target = ssrPurgeTargetFor(type, { name: key });
    if (target) await purgeSsrDetailCache(target.type, target.key, env);
    return json({ ok: true });
  }

  const fields = await config.canonicalFields(env, key);
  if (!fields) return errorJson('Böyle bir kayıt bulunamadı.', 404);
  const now = Date.now();
  const boundValues = bindContentFields(type, fields);

  // ARŞİV TASLAĞI — tek dal, İKİ tip için (eskiden claimedColumn olan/olmayan diye ikiye ayrılmıştı
  // ve ürün dalı HER ZAMAN yeni satır açıyordu). Sıra: önce bağ kolonuyla eşleşen taslak, YOKSA
  // kaydın DOĞDUĞU taslak (canonical satırın legacy_key='submission:<id>' işareti — üyenin kendi
  // gönderisi). İkinci dal kullanıcı isteğinin (2026-09-17 madde 2) gereği: ikinci bir taslak
  // açmak, aynı kaydı bir yanda "Yayında" (üyenin taslağı) bir yanda "Arşivde" gösteriyordu.
  const canonRow = await findCanonicalRowByNaturalKey(env, type, key);
  const link = draftLinkFor(type, config, key, canonRow);
  // Taslağa yazılacak bağ değeri: architects/offices'te claim anahtarı, products/materials'ta
  // canonical slug — "Yayınla" orijinal satırı geri açsın diye (aksi halde syncProduct İKİNCİ bir
  // ürün satırı yaratırdı, bkz. migrations/0088_product_claimed_slug.sql).
  const linkValue = link.key;
  const drafts = await canonicalDraftRows(env, config.table, { ...link, canonRow });
  const existing = drafts.find(d => link.claimedColumn && d[link.claimedColumn] === linkValue) || drafts[0] || null;
  if (existing) {
    // owner_user_id KORUNUR (varsa) — bkz. runProjectAction'daki AYNI gerekçe: taslak, kaydı siteye
    // ekleyen üyenin gönderi satırı olabilir.
    const setLink = link.claimedColumn && linkValue ? `, ${link.claimedColumn} = ?` : '';
    await env.DB.prepare(
      `UPDATE ${config.table} SET ${config.copyFields.map(f => `${f} = ?`).join(', ')}, status = 'archived'${setLink},
        owner_user_id = COALESCE(owner_user_id, ?), updated_at = ? WHERE id = ?`
    ).bind(...boundValues, ...(setLink ? [linkValue] : []), user.id, now, existing.id).run();
  } else {
    const columns = ['id', 'owner_user_id', 'status', 'created_at', 'updated_at',
      ...(link.claimedColumn && linkValue ? [link.claimedColumn] : []), ...config.copyFields];
    const placeholders = columns.map(() => '?').join(', ');
    await env.DB.prepare(
      `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`
    ).bind(newId(), user.id, 'archived', now, now, ...(link.claimedColumn && linkValue ? [linkValue] : []), ...boundValues).run();
  }
  // Kalan taslaklar da 'archived' (normalde hiç yoktur; iki yetkilinin ayrı taslağı varsa olur).
  await archiveCanonicalDrafts(env, config.table,
    { ...link, canonRow, now, skipId: existing ? existing.id : null });

  await setLegacyHidden(env, user, type, key, true);
  // Firma/marka arşivleniyorsa künyesindeki kişi/proje/ürünler de — bkz. archiveOfficeGraph.
  cascade = await archiveOfficeGraph(env, user, type, key);
  await invalidatePublicCache(env);
  const target = ssrPurgeTargetFor(type, { name: key });
  if (target) await purgeSsrDetailCache(target.type, target.key, env);
  return json({ ok: true, ...(cascade ? { cascade } : {}) });
}
