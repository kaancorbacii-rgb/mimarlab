import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { createNotification } from '../lib/notify.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache } from '../lib/ssrCache.js';
import { MAX_HOTSPOTS_PER_IMAGE } from '../lib/submissionTypes.js';
import { foldTr } from '../lib/textMatch.js';
import { escapeLike } from '../lib/searchFold.js';
import { hasAnyActiveBadge } from '../lib/badgeAccess.js';

// ============================================================================================
// MARKA SAHİBİ ÜRÜN ETİKETLEME + ONAY AKIŞI (kullanıcı isteği, 2026-09-05 madde 5)
// ============================================================================================
// "Marka sahipleri sitede yüklü olan proje gönderilerindeki medyada kendi ürünlerini hotspot olarak
// işaretleyebilsinler. ... ürün etiketlemeleri marka sahibine ve admin hesabına bildirim olarak
// gitsin. Ancak marka sahibi ya da admin bu bildirimlere onay verirse ürünler hotspot olarak
// etiketlenebilsin. Admin hesaplarından yapılan etiketlemelerin onaya düşmesine gerek yok."
//
// TASARIM KARARLARI (ve NEDEN):
//
// 1) KİM ETİKETLEYEBİLİR — **ROZETLİ ÜYELER VE ADMİN** (kullanıcı isteği, 2026-09-05 takip:
//    "Ürün Etiketle butonu ve özelliği sadece rozeti olan kullanıcılara has olsun. Rozeti olan tüm
//    kullanıcılar tüm ürünleri etiketleme yetkisine sahip olsunlar ... Rozeti olmayanlar lightbox'ta
//    Ürün Etiketle butonunu görmesinler.").
//
//    İLK SÜRÜMDEN FARK: kapı önce "kendi ürünün" idi (ürünü ya da markasını sahiplenmiş olmak) ve
//    ürün araması buna göre daraltılıyordu. Artık kapı ROZET; rozetli bir üye SİTEDEKİ HER ürünü
//    etiketleyebilir. Yetkinin genişlemesi onay kuyruğunu ZAYIFLATMAZ, tam tersine onun varlık
//    sebebini güçlendirir: etiketleyen kişi artık ürünle ilgisiz biri olabileceğinden, bildirim ve
//    onay hâlâ ÜRÜNÜN/MARKANIN SAHİBİNE + adminlere gider (bkz. canDecide — orası DEĞİŞMEDİ).
//
//    Rozet kademesi (verified/gold) AYIRT EDİLMEZ — istek "rozeti olan tüm kullanıcılar" diyor.
//    Kapı: badgeAccess.js#hasAnyActiveBadge (üç rozet kaynağını da kabul eder). İstemci tarafı
//    (js/components/gallery.js butonu gizler) yalnızca UI'dır; GERÇEK kapı buradaki
//    requireTaggingAccess'tir — /api/hotspot-tags/access yalnızca butonun gösterilip
//    gösterilmeyeceğini söyler, hiçbir yetki VERMEZ.
//
// 2) ÜRÜN SAHİPLİĞİ artık ETİKETLEME yetkisini değil yalnızca ONAY yetkisini ve bildirim
//    alıcılarını belirler. İki yoldan gelir: products.claimed_by_user_id (ürünü doğrudan
//    sahiplenmiş hesap) VEYA products.brand_office_id -> offices.claimed_by_user_id (markanın/
//    firmanın profilini sahiplenmiş hesap). İkincisi olmadan "marka sahibi" ifadesi karşılıksız
//    kalırdı: canlıda ürünlerin büyük kısmı tek tek sahiplenilmemiş, marka profili sahiplenilmiş.
//
// 3) ONAY KUYRUĞU ATLATILAMAZ — POST, status'ü İSTEMCİDEN HİÇ OKUMAZ; yalnızca isteği yapanın
//    rolüne bakar (admin -> 'approved' + anında uygula, diğer herkes -> 'pending'). Bkz. proje notu
//    [[project_submission_moderation_bypass_2026_09_05]]: gönderi PATCH'i koşulsuz 'approved'
//    yazdığı için üye, gönderip düzenleyerek onay kuyruğunu tamamen atlayabiliyordu. Aynı hatayı
//    burada yapmamak için karar verme (decide) TAMAMEN AYRI bir uçtur ve kendi yetki kontrolü var.
//
// 4) ONAYLANINCA NEREYE YAZILIR — hem projects.image_hotspots'a (yayındaki tek kaynak, bkz.
//    migrations/0076) HEM DE varsa projenin project_submissions taslağının imageHotspots alanına.
//    Yalnızca canonical'a yazmak SESSİZ VERİ KAYBI olurdu: proje sahibi projesini bir daha
//    kaydettiğinde canonicalSync#syncProject canonical satırın image_hotspots'unu taslaktan baştan
//    yazar (images ile AYNI koşulda) ve markanın onaylanmış işaretçisi iz bırakmadan silinirdi.
// ============================================================================================

const PENDING = 'pending';

function isAdmin(user) { return !!user && user.role === 'admin'; }

// Kullanıcının sahiplendiği ofis/marka id'leri. ETİKETLEME yetkisiyle ilgisi YOK (o artık rozete
// bağlı, bkz. tasarım notu 1) — yalnızca ONAY tarafında kullanılır: "bana düşen bekleyen öneriler"
// (listPending) sorgusu, kullanıcının markası altındaki ürünlere gelen önerileri bulmak için.
async function ownedOfficeIds(env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT id FROM offices WHERE claimed_by_user_id = ? AND deleted_at IS NULL'
  ).bind(userId).all();
  return results.map(r => r.id);
}

// ETİKETLEME KAPISI (bkz. tasarım notu 1): admin ya da HERHANGİ bir aktif rozet.
async function hasTaggingAccess(env, user) {
  if (isAdmin(user)) return true;
  return hasAnyActiveBadge(env, user.id);
}

// Etiketlenecek ürünü yükler. ARTIK SAHİPLİK KONTROLÜ YOK (bkz. tasarım notu 1) — rozetli üye her
// ürünü etiketleyebilir; buradaki tek koşul ürünün YAYINDA olmasıdır (silinmiş/gizlenmiş bir ürün,
// tıklanınca 404'e götüren bir işaretçi üretirdi). Dönen satır ayrıca onay/bildirim tarafının
// ihtiyaç duyduğu sahiplik alanlarını da taşır, ayrı bir SELECT atılmasın diye.
async function loadPublishedProduct(env, productSlug) {
  return env.DB.prepare(
    `SELECT p.id, p.slug, p.title, p.images, p.brand_name_raw, p.claimed_by_user_id, p.brand_office_id,
            o.name AS brand_office_name, o.claimed_by_user_id AS brand_owner_user_id
     FROM products p
     LEFT JOIN offices o ON o.id = p.brand_office_id AND o.deleted_at IS NULL
     WHERE p.slug = ? AND p.deleted_at IS NULL AND p.hidden_at IS NULL`
  ).bind(productSlug).first();
}

// Bu öneriyi kim karara bağlayabilir: ürünün/markanın sahibi ya da admin (kullanıcı isteği:
// "marka sahibi ya da admin bu bildirimlere onay verirse"). Proje sahibi BİLEREK dışarıda —
// istekte geçmiyor; eklenecekse tek yer burasıdır.
function canDecide(user, productRow) {
  if (isAdmin(user)) return true;
  if (!productRow) return false;
  return productRow.claimed_by_user_id === user.id || productRow.brand_owner_user_id === user.id;
}

async function adminUserIds(env) {
  const { results } = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  return results.map(r => r.id);
}

function parseHotspots(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function firstImage(imagesJson) {
  try { const arr = imagesJson ? JSON.parse(imagesJson) : []; return Array.isArray(arr) ? (arr[0] || null) : null; } catch { return null; }
}

// ---------------------------------------------------------------------------------------------
// Onaylanmış bir öneriyi GERÇEKTEN uygular: canonical projects satırı + (varsa) o projenin
// project_submissions taslağı. İkisini birden yazmanın gerekçesi için bkz. tasarım notu 4.
// Döndürür: { ok: true } | { ok: false, error: '<kullanıcıya gösterilecek sebep>' }
// ---------------------------------------------------------------------------------------------
async function applyHotspot(env, tag, productRow) {
  const project = await env.DB.prepare(
    'SELECT id, slug, legacy_key, images, image_hotspots FROM projects WHERE slug = ? AND deleted_at IS NULL'
  ).bind(tag.project_slug).first();
  if (!project) return { ok: false, error: 'Proje artık yayında değil.' };

  // Görsel hâlâ projenin galerisinde mi? Proje sahibi bu arada o kareyi kaldırmış olabilir — o
  // durumda işaretçi hiçbir zaman görünmeyecek bir URL'ye yazılırdı.
  let images = [];
  try { images = JSON.parse(project.images || '[]'); } catch { images = []; }
  if (Array.isArray(images) && images.length && !images.includes(tag.image_url)) {
    return { ok: false, error: 'Bu görsel projenin galerisinde artık yok.' };
  }

  const hotspots = parseHotspots(project.image_hotspots);
  const list = Array.isArray(hotspots[tag.image_url]) ? hotspots[tag.image_url] : [];
  if (list.some(h => h && h.slug === tag.product_slug)) {
    return { ok: false, error: 'Bu ürün bu görselde zaten işaretli.' };
  }
  // Görsel başına üst sınır (bkz. submissionTypes.js#MAX_HOTSPOTS_PER_IMAGE). sanitizeImageHotspots
  // sınırı aşanı SESSİZCE atardı — burada sessizce düşürmek "onayladım ama görünmüyor" demek
  // olurdu, o yüzden açık bir hata döner.
  if (list.length >= MAX_HOTSPOTS_PER_IMAGE) {
    return { ok: false, error: `Bu görselde zaten ${MAX_HOTSPOTS_PER_IMAGE} ürün işaretli. Yeni bir işaret eklemek için önce birini kaldır.` };
  }

  const entry = { x: tag.x, y: tag.y, slug: tag.product_slug, title: productRow?.title || '' };
  hotspots[tag.image_url] = [...list, entry];
  const serialized = JSON.stringify(hotspots);

  await env.DB.prepare(
    `UPDATE projects SET image_hotspots = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(serialized, project.id).run();

  // Taslak(lar): canonicalSync#syncProject bir gönderiyi canonical'a "claimed_slug (legacy_key ya da
  // slug eşleşmesi)" ya da "legacy_key = submission:<id>" üzerinden bağlar — ters yön de aynı iki
  // yoldan aranır. Birden fazla taslak aynı projeye bağlı olabilir (ör. proje sahiplenmesi + admin
  // düzenlemesi); HEPSİ güncellenir, aksi halde hangisi son kaydedilirse o kazanırdı.
  const marker = /^submission:(.+)$/.exec(project.legacy_key || '');
  const drafts = await env.DB.prepare(
    `SELECT id, imageHotspots FROM project_submissions
     WHERE claimed_slug IN (?, ?) OR (? IS NOT NULL AND id = ?)`
  ).bind(project.slug, project.legacy_key || '', marker ? marker[1] : null, marker ? marker[1] : '').all();
  for (const draft of drafts.results) {
    const draftHotspots = parseHotspots(draft.imageHotspots);
    const draftList = Array.isArray(draftHotspots[tag.image_url]) ? draftHotspots[tag.image_url] : [];
    if (draftList.some(h => h && h.slug === tag.product_slug)) continue;
    if (draftList.length >= MAX_HOTSPOTS_PER_IMAGE) continue;
    draftHotspots[tag.image_url] = [...draftList, entry];
    await env.DB.prepare('UPDATE project_submissions SET imageHotspots = ? WHERE id = ?')
      .bind(JSON.stringify(draftHotspots), draft.id).run();
  }

  // GERÇEK BULGU (yerel uçtan uca testte yakalandı): invalidatePublicCache() TEK BAŞINA YETMİYOR.
  // O fonksiyon yalnızca CACHEABLE_PATHS + BARE_LIST_PATHS'i (sabit liste yolları) temizler; TEKİL
  // /api/project/:slug detay yanıtı ise cachedPublicJson'ın isDetailPath dalında 5 dakikalık
  // s-maxage ile caches.default'ta durur ve listFingerprint TAŞIMAZ — yani HIT yolunda tazelik
  // DOĞRULANMAZ. Testte tam olarak bu görüldü: onay D1'e yazıldı (üç görselde işaretçi var) ama
  // /api/project/atiye-ali-cicek-camii hâlâ tek görsellik ESKİ gövdeyi döndürdü; sorgu dizesiyle
  // cache-buster denemek de işe yaramaz, çünkü cache anahtarı yalnızca pathname'dir. Onay veren
  // kişi "onayladım ama görünmüyor" diye bakakalırdı. purgeSsrDetailCache, diğer tüm proje yazma
  // yollarının (submissions/admin/legacyContent) kullandığı AYNI yardımcı: hem /proje/:slug SSR
  // HTML'ini hem /api/project/:slug JSON detayını (hem de secret'lar tanımlıysa zone genelinde)
  // temizler.
  await Promise.all([
    invalidatePublicCache(env),
    purgeSsrDetailCache('project', project.slug, env),
  ]);
  return { ok: true, projectSlug: project.slug };
}

// ---------------------------------------------------------------------------------------------
// Router. TÜM uçlar oturum ister — herkese açık okuma yolu YOK (bkz. src/routes/saved.js'teki AYNI
// desen): bekleyen öneriler yayında görünmeyen içeriktir.
// ---------------------------------------------------------------------------------------------
export async function handleHotspotTagsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "hotspot-tags", ...]

  const user = await getSessionUser(request, env);

  // GET .../access — YALNIZCA "bu ziyaretçiye 'Ürün Etiketle' butonu gösterilsin mi" sorusunu
  // yanıtlar (bkz. js/components/gallery.js). Diğer uçların aksine oturumsuz istekte 401 DEĞİL
  // {canTag:false} döner: giriş yapmamış bir ziyaretçi için "hayır" doğru ve beklenen yanıttır,
  // 401 ise her proje sayfasında gereksiz bir konsol hatası üretirdi. Hiçbir yetki VERMEZ —
  // gerçek kapı createTag'deki hasTaggingAccess kontrolüdür.
  if (segments.length === 3 && segments[2] === 'access' && request.method === 'GET') {
    if (!user) return json({ canTag: false });
    return json({ canTag: await hasTaggingAccess(env, user) });
  }

  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 3 && segments[2] === 'my-products' && request.method === 'GET') {
    return listTaggableProducts(env, user, url);
  }
  if (segments.length === 3 && segments[2] === 'pending' && request.method === 'GET') {
    return listPending(env, user);
  }
  if (segments.length === 2 && request.method === 'POST') {
    return createTag(request, env, user);
  }
  if (segments.length === 4 && segments[3] === 'decide' && request.method === 'POST') {
    return decideTag(request, env, user, segments[2]);
  }
  if (segments.length === 3 && request.method === 'GET') {
    return getTag(env, user, segments[2]);
  }
  return errorJson('Bulunamadı', 404);
}

// GET /api/hotspot-tags/my-products?q=... — etiketleme formunun ürün araması.
// Yol adı ('my-products') tarihsel: ilk sürümde liste kullanıcının KENDİ ürünleriyle sınırlıydı.
// Artık kapı rozettir ve rozetli üye SİTEDEKİ TÜM yayında ürünleri görür (bkz. tasarım notu 1);
// isim, dışarıdaki tek çağıranı (hotspot-tagger.js) kırmamak için korundu.
// /api/products/search'ün YETKİYE DUYARLI karşılığı: o uç herkese açık ve önbelleklidir, bu uç
// oturuma bağlıdır ve ASLA önbelleklenmez.
async function listTaggableProducts(env, user, url) {
  if (!(await hasTaggingAccess(env, user))) {
    return json({ items: [], canTag: false });
  }
  const q = foldTr((url.searchParams.get('q') || '').trim());
  const params = [];
  let where = 'p.deleted_at IS NULL AND p.hidden_at IS NULL';
  if (q) {
    // title_fold/brand_fold — foldTr()'nin SQL karşılığını hesaplayan generated column'lar ve
    // ikisi de index'li (bkz. migrations/0079). Liste artık TÜM kataloğu kapsadığından (birkaç yüz
    // ürün) LIMIT 40 ile sınırlanır; düz substring araması bu boyutta ölçülebilir bir maliyet
    // getirmiyor. % ve _ kullanıcı girdisinde joker anlamı kazanmasın diye kaçışlanır.
    where += " AND (p.title_fold LIKE ? ESCAPE '\\' OR p.brand_fold LIKE ? ESCAPE '\\')";
    const like = `%${escapeLike(q)}%`;
    params.push(like, like);
  }
  const { results } = await env.DB.prepare(
    `SELECT p.slug, p.title, p.images, COALESCE(o.name, p.brand_name_raw, '') AS brand
     FROM products p
     LEFT JOIN offices o ON o.id = p.brand_office_id AND o.deleted_at IS NULL
     WHERE ${where}
     ORDER BY p.title COLLATE NOCASE
     LIMIT 40`
  ).bind(...params).all();
  return json({
    items: results.map(r => ({ slug: r.slug, title: r.title, brand: r.brand, image: firstImage(r.images) })),
    canTag: true,
  });
}

// POST /api/hotspot-tags — yeni etiketleme önerisi. Admin'de anında uygulanır (kullanıcı isteği).
async function createTag(request, env, user) {
  // GERÇEK KAPI (bkz. tasarım notu 1) — istemcideki buton gizleme yalnızca UI'dır, yetki burada
  // verilir. Doğrulama, gövde ayrıştırmasından ÖNCE: rozetsiz bir hesabın gönderdiği istek hiçbir
  // sorgu/yazma tetiklemeden reddedilsin.
  if (!(await hasTaggingAccess(env, user))) {
    return errorJson('Ürün etiketleme rozetli üyelere özel bir ayrıcalıktır.', 403);
  }
  const body = await readJson(request);
  const projectSlug = String(body.projectSlug || '').trim();
  const imageUrl = String(body.imageUrl || '').trim();
  const productSlug = String(body.productSlug || '').trim();
  const x = Number(body.x), y = Number(body.y);
  if (!projectSlug || !imageUrl || !productSlug) return errorJson('Eksik bilgi.');
  if (!Number.isFinite(x) || !Number.isFinite(y)) return errorJson('Geçersiz konum.');
  const cx = Math.min(100, Math.max(0, Math.round(x * 100) / 100));
  const cy = Math.min(100, Math.max(0, Math.round(y * 100) / 100));

  const project = await env.DB.prepare(
    'SELECT id, slug, title, images FROM projects WHERE slug = ? AND deleted_at IS NULL AND hidden_at IS NULL'
  ).bind(projectSlug).first();
  if (!project) return errorJson('Proje bulunamadı.', 404);
  let images = [];
  try { images = JSON.parse(project.images || '[]'); } catch { images = []; }
  if (!Array.isArray(images) || !images.includes(imageUrl)) return errorJson('Bu görsel bu projeye ait değil.');

  // Sahiplik ARANMAZ (bkz. tasarım notu 1) — rozetli üye her yayında ürünü etiketleyebilir; satırın
  // sahiplik alanları yalnızca aşağıdaki bildirim alıcılarını belirlemek için okunur.
  const productRow = await loadPublishedProduct(env, productSlug);
  if (!productRow) return errorJson('Ürün bulunamadı.', 404);

  const now = Date.now();
  const id = newId();

  // ADMIN: onaya hiç düşmez (kullanıcı isteği) — doğrudan uygulanır ve 'approved' olarak kaydedilir
  // (denetim izi: kimin, ne zaman eklediği kayıtlı kalır).
  if (isAdmin(user)) {
    const applied = await applyHotspot(env, { project_slug: projectSlug, image_url: imageUrl, x: cx, y: cy, product_slug: productSlug }, productRow);
    if (!applied.ok) return errorJson(applied.error);
    await env.DB.prepare(
      `INSERT INTO project_hotspot_tags (id, project_slug, image_url, x, y, product_slug, created_by_user_id, status, decided_by_user_id, decided_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)`
    ).bind(id, projectSlug, imageUrl, cx, cy, productSlug, user.id, user.id, now, now).run();
    return json({ ok: true, status: 'approved' });
  }

  try {
    await env.DB.prepare(
      `INSERT INTO project_hotspot_tags (id, project_slug, image_url, x, y, product_slug, created_by_user_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '${PENDING}', ?)`
    ).bind(id, projectSlug, imageUrl, cx, cy, productSlug, user.id, now).run();
  } catch (err) {
    // migrations/0091'deki kısmi UNIQUE indeks — aynı ürün/görsel için zaten bekleyen bir öneri var.
    if (String(err && err.message || '').includes('UNIQUE')) {
      return errorJson('Bu ürün için bu görselde zaten onay bekleyen bir etiketleme var.');
    }
    throw err;
  }

  // Bildirimler: ürünün sahibi + markanın/firmanın sahibi + TÜM adminler (kullanıcı isteği:
  // "marka sahibine ve admin hesabına bildirim olarak gitsin"). Tekilleştirilir; öneriyi yapan
  // hesap da listede kalabilir — o kişi aynı zamanda onaylayıcıdır, bildirim onun için "onayına
  // sunuldu" satırıdır ve tıklayınca kararı oradan verir.
  const recipients = new Set([
    ...(productRow.claimed_by_user_id ? [productRow.claimed_by_user_id] : []),
    ...(productRow.brand_owner_user_id ? [productRow.brand_owner_user_id] : []),
    ...(await adminUserIds(env)),
  ]);
  const brandName = productRow.brand_office_name || productRow.brand_name_raw || '';
  for (const uid of recipients) {
    await createNotification(
      env, uid, 'hotspot_tag',
      'Yeni ürün etiketlemesi onay bekliyor',
      `${user.name || 'Bir üye'}, “${project.title}” projesinin bir görselinde ${brandName ? brandName + ' ' : ''}“${productRow.title}” ürününü işaretledi. Onaylarsan işaretçi projede görünür olur.`,
      `hotspot-tag:${id}`
    );
  }

  return json({ ok: true, status: PENDING });
}

// GET /api/hotspot-tags/:id — Hesabım'daki onay popup'ının gösterdiği tek kayıt (bkz.
// js/components/auth-modal.js#openHotspotTagPrompt).
async function getTag(env, user, id) {
  const tag = await env.DB.prepare('SELECT * FROM project_hotspot_tags WHERE id = ?').bind(id).first();
  if (!tag) return errorJson('Bulunamadı', 404);
  const productRow = await env.DB.prepare(
    `SELECT p.slug, p.title, p.images, p.brand_name_raw, p.claimed_by_user_id, p.brand_office_id,
            o.name AS brand_office_name, o.claimed_by_user_id AS brand_owner_user_id
     FROM products p
     LEFT JOIN offices o ON o.id = p.brand_office_id AND o.deleted_at IS NULL
     WHERE p.slug = ?`
  ).bind(tag.product_slug).first();
  // Öneriyi YAPAN kişi de görebilir (kendi gönderdiği önerinin durumunu görmek için) ama karar
  // yetkisi ayrı bir bayrakla söylenir.
  const mayDecide = canDecide(user, productRow);
  if (!mayDecide && tag.created_by_user_id !== user.id) return errorJson('Bulunamadı', 404);
  const project = await env.DB.prepare('SELECT slug, title, location FROM projects WHERE slug = ? AND deleted_at IS NULL').bind(tag.project_slug).first();
  const creator = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(tag.created_by_user_id).first();
  return json({
    item: {
      id: tag.id,
      status: tag.status,
      x: tag.x, y: tag.y,
      imageUrl: tag.image_url,
      createdAt: tag.created_at,
      createdBy: creator?.name || '',
      project: project ? { slug: project.slug, title: project.title, location: project.location || '' } : null,
      product: productRow ? {
        slug: productRow.slug, title: productRow.title,
        brand: productRow.brand_office_name || productRow.brand_name_raw || '',
        image: firstImage(productRow.images),
      } : null,
    },
    canDecide: mayDecide,
  });
}

// GET /api/hotspot-tags/pending — kullanıcının karara bağlayabileceği tüm bekleyen öneriler.
// Hesabım'daki bildirim satırından bağımsız bir "toplu bakış" için (bildirim silinmiş olsa bile
// öneri kaybolmaz).
async function listPending(env, user) {
  const params = [];
  let where = "t.status = 'pending'";
  if (!isAdmin(user)) {
    const officeIds = await ownedOfficeIds(env, user.id);
    const officePlaceholders = officeIds.length ? officeIds.map(() => '?').join(', ') : '0';
    where += ` AND (p.claimed_by_user_id = ? OR p.brand_office_id IN (${officePlaceholders}))`;
    params.push(user.id, ...officeIds);
  }
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.project_slug, t.image_url, t.x, t.y, t.product_slug, t.created_at,
            p.title AS product_title, COALESCE(o.name, p.brand_name_raw, '') AS brand,
            pr.title AS project_title
     FROM project_hotspot_tags t
     JOIN products p ON p.slug = t.product_slug AND p.deleted_at IS NULL
     LEFT JOIN offices o ON o.id = p.brand_office_id AND o.deleted_at IS NULL
     LEFT JOIN projects pr ON pr.slug = t.project_slug AND pr.deleted_at IS NULL
     WHERE ${where}
     ORDER BY t.created_at DESC LIMIT 50`
  ).bind(...params).all();
  return json({ items: results });
}

// POST /api/hotspot-tags/:id/decide { approve: true|false }
async function decideTag(request, env, user, id) {
  const body = await readJson(request);
  const approve = body.approve === true;
  const tag = await env.DB.prepare('SELECT * FROM project_hotspot_tags WHERE id = ?').bind(id).first();
  if (!tag) return errorJson('Bulunamadı', 404);
  if (tag.status !== PENDING) return errorJson('Bu etiketleme zaten karara bağlanmış.');

  const productRow = await env.DB.prepare(
    `SELECT p.slug, p.title, p.claimed_by_user_id, p.brand_office_id, p.brand_name_raw,
            o.name AS brand_office_name, o.claimed_by_user_id AS brand_owner_user_id
     FROM products p
     LEFT JOIN offices o ON o.id = p.brand_office_id AND o.deleted_at IS NULL
     WHERE p.slug = ? AND p.deleted_at IS NULL`
  ).bind(tag.product_slug).first();
  if (!canDecide(user, productRow)) return errorJson('Bu etiketlemeyi onaylama yetkin yok.', 403);

  if (approve) {
    const applied = await applyHotspot(env, tag, productRow);
    if (!applied.ok) return errorJson(applied.error);
  }
  await env.DB.prepare(
    'UPDATE project_hotspot_tags SET status = ?, decided_by_user_id = ?, decided_at = ? WHERE id = ?'
  ).bind(approve ? 'approved' : 'rejected', user.id, Date.now(), id).run();

  // Öneriyi yapan kişi kararı öğrensin — kendi kararıysa kendine bildirim göndermeye gerek yok.
  if (tag.created_by_user_id !== user.id) {
    await createNotification(
      env, tag.created_by_user_id, 'hotspot_tag',
      approve ? 'Ürün etiketlemen onaylandı' : 'Ürün etiketlemen reddedildi',
      approve
        ? `“${productRow?.title || tag.product_slug}” ürünü artık ${tag.project_slug} projesinin görselinde işaretli.`
        : `“${productRow?.title || tag.product_slug}” için gönderdiğin işaretleme onaylanmadı.`,
      // 2026-09-06 madde 2'den SONRA: bildirim satırı artık düz varlık yollarını da açıyor (bkz.
      // js/components/auth-modal.js#notifEntityPath) — onaylanan işaretleme kararı için doğru hedef
      // işaretçinin GÖRÜNDÜĞÜ projedir. Reddedilende açılacak bir şey yok, link boş kalır.
      approve && tag.project_slug ? `/proje/${encodeURIComponent(tag.project_slug)}` : null
    );
  }

  return json({ ok: true, status: approve ? 'approved' : 'rejected' });
}
