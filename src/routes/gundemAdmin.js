// GÜNDEM — ADMİN YÖNETİM UÇLARI (kullanıcı isteği, 2026-09-07 madde 5:
// "Sadece admine özel içerikleri düzenleme (görsel, başlık ve metin değiştirme), arşivleme ve
// silme yetkisi ver").
//
// YETKİ: bu dosyadaki hiçbir fonksiyon kendi başına yetki kontrolü yapmaz — çağıran
// src/routes/admin.js#handleAdminRoute ZATEN requireAdmin()'den geçmiştir ve tüm /api/admin/*
// yolları o kapının arkasındadır. İkinci bir kontrol eklemek, iki yerde ayrışabilecek bir yetki
// mantığı yaratırdı (bu depodaki bilinen tuzak).
//
// KAPSAM SINIRI: admin İÇERİĞİ DÜZENLER, üretmez. Yeni Gündem kaydı ELLE oluşturulamaz — sistem
// tanımı gereği otomatiktir (madde 1: "Kullanıcı veya benim her içerik için manuel giriş yapmam
// gerekmemeli"). Bu yüzden burada POST/create YOKTUR; yalnızca var olan bir kaydı düzeltme,
// gizleme ve silme vardır.

import { json, errorJson, readJson } from '../lib/http.js';
import { purgeGundemCache } from '../lib/gundemCache.js';
import { purgeSsrDetailCache } from '../lib/ssrCache.js';
// Admin listesi de PUBLIC listeyle AYNI sırayı göstermeli — yönetici, ziyaretçinin gördüğü
// sırayı görmezse "şu kart neden yukarıda" sorusu cevapsız kalır (bkz. gundem.js#GUNDEM_SORT).
import { GUNDEM_SORT } from './gundem.js';
import { normalizeOwnMediaPath } from './gundemSubmit.js';
import { parseGundemImages } from '../lib/gundemSsr.js';

// Admin'in değiştirebileceği alanlar — BİLEREK dar. Kategori de düzenlenebilir çünkü otomatik
// sınıflandırma en çok orada yanılır; slug/source_url/content_hash gibi KİMLİK ve MÜKERRER
// alanları düzenlenemez (değiştirilirse mükerrer kontrolü ve kalıcı URL bozulurdu).
const EDITABLE = ['title', 'summary', 'image_url', 'category'];

async function purgeItem(env, slug) {
  await Promise.all([
    purgeGundemCache(env),
    // Tekil içeriğin kendi SSR sayfası + JSON detay ucu (bkz. ssrCache.js) — liste purge'ü bunlara
    // DOKUNMAZ, bu yüzden ayrıca çağrılır.
    purgeSsrDetailCache('gundem', slug, env),
  ]);
}

// PATCH /api/admin/gundem/:id — başlık / özet / görsel / kategori düzenleme.
async function updateGundemItem(request, env, id) {
  const body = await readJson(request);
  const row = await env.DB.prepare('SELECT slug, images FROM gundem_items WHERE id = ?').bind(id).first();
  if (!row) return errorJson('Bulunamadı', 404);

  const sets = [];
  const binds = [];
  for (const field of EDITABLE) {
    if (!(field in body)) continue;
    let value = typeof body[field] === 'string' ? body[field].trim() : '';
    if (!value) return errorJson(`${field} boş olamaz.`);
    // Kullanıcı gönderisinin görseli KENDİ R2'mizdedir (/media/u/...) — CSP 'self' kapsar, dış host
    // listesine bakılmaz. Satır içi düzenleyici mutlak adres gönderir; göreli yola indirilir ve
    // karusel dizisinin kapağı (images[0]) da aynı görsele güncellenir.
    const ownMedia = field === 'image_url' ? normalizeOwnMediaPath(value) : null;
    if (ownMedia) {
      value = ownMedia;
      sets.push('image_host = ?');
      binds.push('mimarlab.com');
      if (row.images) {
        const imgs = parseGundemImages({ images: row.images, image_url: ownMedia });
        imgs[0] = ownMedia;
        sets.push('images = ?');
        binds.push(JSON.stringify([...new Set(imgs)]));
      }
    } else if (field === 'image_url') {
      // Görsel yalnızca https olabilir. Host KISITLANMAZ (admin bilinçli olarak başka bir görsel
      // koyabilmeli) ama CSP img-src yalnızca beyan edilmiş host'lara izin verdiğinden, listede
      // olmayan bir host tarayıcıda engellenir — bu yüzden admin'e uyarı döndürülür, sessizce
      // bozuk bir kart bırakılmaz.
      let host;
      try {
        const u = new URL(value);
        if (u.protocol !== 'https:') return errorJson('Görsel adresi https olmalı.');
        host = u.hostname.toLowerCase();
      } catch { return errorJson('Görsel adresi geçersiz.'); }
      const { GUNDEM_IMAGE_HOSTS } = await import('../lib/gundemSources.js');
      if (!GUNDEM_IMAGE_HOSTS.includes(host)) {
        return errorJson(`Bu görsel adresi (${host}) site güvenlik politikasında (CSP) tanımlı değil; tarayıcıda engellenir. İzinli host'lar: ${GUNDEM_IMAGE_HOSTS.join(', ')}`);
      }
      sets.push('image_host = ?');
      binds.push(host);
    }
    if (field === 'category') {
      const { isValidGundemCategory } = await import('../lib/gundemCategories.js');
      if (!isValidGundemCategory(value)) return errorJson('Geçersiz kategori.');
    }
    sets.push(`${field} = ?`);
    binds.push(value);
  }
  if (!sets.length) return errorJson('Değiştirilecek alan yok.');

  sets.push('updated_at = ?');
  binds.push(Date.now());
  await env.DB.prepare(`UPDATE gundem_items SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  await purgeItem(env, row.slug);
  return json({ ok: true });
}

// POST /api/admin/gundem/:id/archive  { archived: true|false }
// Arşivlenen içerik SİLİNMEZ: status='archived' olur, listeden ve sitemap'ten düşer, doğrudan
// URL'si 410 döner (bkz. seo.js#isKnownButHidden'daki gundem dalı). Geri alınabilir.
async function archiveGundemItem(request, env, id) {
  const body = await readJson(request);
  const archived = body.archived !== false;
  const row = await env.DB.prepare('SELECT slug FROM gundem_items WHERE id = ?').bind(id).first();
  if (!row) return errorJson('Bulunamadı', 404);
  await env.DB.prepare('UPDATE gundem_items SET status = ?, updated_at = ? WHERE id = ?')
    .bind(archived ? 'archived' : 'published', Date.now(), id).run();
  await purgeItem(env, row.slug);
  return json({ ok: true, status: archived ? 'archived' : 'published' });
}

// DELETE /api/admin/gundem/:id — kalıcı silme.
//
// MÜKERRER SONUCU (bilerek): silinen içeriğin source_url'i de gittiği için AYNI içerik bir sonraki
// turda yeniden çekilebilir. Kullanıcı "beğenmedim, gitsin" derken çoğu zaman bunu istemez —
// bu yüzden arşivleme ÖNERİLEN yoldur (arşiv satırı durduğu için mükerrer kontrolü onu tanımaya
// devam eder ve içerik geri gelmez). Silme yine de sunulur çünkü hatalı/sakıncalı bir kaydın
// tamamen kaldırılması gerekebilir.
async function deleteGundemItem(env, id) {
  const row = await env.DB.prepare('SELECT slug FROM gundem_items WHERE id = ?').bind(id).first();
  if (!row) return errorJson('Bulunamadı', 404);
  // Bilgi grafiği kenarları ÖNCE silinir (yetim satır kalmasın).
  await env.DB.batch([
    env.DB.prepare('DELETE FROM gundem_entities WHERE item_id = ?').bind(id),
    env.DB.prepare('DELETE FROM gundem_items WHERE id = ?').bind(id),
  ]);
  await purgeItem(env, row.slug);
  return json({ ok: true });
}

// POST /api/admin/gundem/:id/moderate  { action: 'approve' | 'reject' } — KULLANICI GÖNDERİLERİNİN
// tek yayın kapısı (kullanıcı isteği, 2026-09-11: "gönderilen içerikler admin panelinde onaya
// düşsünler"). Onay:
//   * status='published'; source_published_at İLK onayda "şimdi" olur ve sonraki onaylarda KORUNUR
//     (liste sırası = COALESCE(source_published_at, published_at), bkz. gundem.js#GUNDEM_SORT) —
//     sahibin küçük bir düzeltmesi içeriği listenin en üstüne yeniden taşımasın.
//   * gönderen kişi/firma/marka ise gundem_entities'e kenar yazılır → o profilin popup'ındaki
//     Gündem şeridi (architect-modal.js / office-modal.js#loadGundemStrip) içeriği gösterir.
async function moderateGundemItem(request, env, id) {
  const body = await readJson(request);
  const action = body.action;
  if (action !== 'approve' && action !== 'reject') return errorJson('Geçersiz işlem.');
  const row = await env.DB.prepare(
    `SELECT slug, status, submitter_type, submitter_key, submitter_name FROM gundem_items WHERE id = ? AND source_id = 'user'`
  ).bind(id).first();
  if (!row) return errorJson('Bulunamadı', 404);
  const now = Date.now();
  if (action === 'reject') {
    await env.DB.prepare(`UPDATE gundem_items SET status = 'rejected', updated_at = ? WHERE id = ?`).bind(now, id).run();
  } else {
    const stmts = [
      env.DB.prepare(
        `UPDATE gundem_items SET status = 'published', published_at = ?, source_published_at = COALESCE(source_published_at, ?), updated_at = ? WHERE id = ?`
      ).bind(now, now, now, id),
    ];
    if ((row.submitter_type === 'architect' || row.submitter_type === 'office') && row.submitter_key) {
      stmts.push(env.DB.prepare(
        'INSERT OR IGNORE INTO gundem_entities (item_id, entity_type, entity_key, entity_name, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(id, row.submitter_type, row.submitter_key, row.submitter_name || row.submitter_key, now));
    }
    await env.DB.batch(stmts);
  }
  await purgeItem(env, row.slug);
  return json({ ok: true, status: action === 'approve' ? 'published' : 'rejected' });
}

// GET /api/admin/gundem?status=pending|rejected — kullanıcı gönderilerinin onay kuyruğu (gönderen
// kullanıcının adı/e-postası dahil, admin kimin gönderdiğini görsün).
async function listGundemSubmissionsAdmin(env, status) {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.slug, g.title, g.summary, g.image_url, g.images, g.category, g.status,
            g.submitter_type, g.submitter_key, g.submitter_name, g.created_at, g.updated_at,
            u.name AS user_name, u.email AS user_email
       FROM gundem_items g LEFT JOIN users u ON u.id = g.submitted_by
      WHERE g.source_id = 'user' AND g.status = ?
      ORDER BY g.created_at DESC LIMIT 200`
  ).bind(status).all();
  return json({ items: (results || []).map(r => ({ ...r, images: parseGundemImages(r) })) });
}

// GET /api/admin/gundem — arşivlenenler DAHİL tüm kayıtlar (admin listesi).
async function listGundemAdmin(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, slug, title, summary, image_url, category, status, source_name, source_url,
            source_published_at, published_at
       FROM gundem_items ORDER BY ${GUNDEM_SORT} LIMIT 200`
  ).all();
  return json({ items: results });
}

// segments: ["api","admin","gundem", <id?>, <action?>]
export async function handleGundemAdminRoute(request, env, segments) {
  const id = segments[3];
  const action = segments[4];

  if (!id) {
    if (request.method === 'GET') {
      const status = new URL(request.url).searchParams.get('status');
      if (status === 'pending' || status === 'rejected') return listGundemSubmissionsAdmin(env, status);
      return listGundemAdmin(env);
    }
    return errorJson('Bulunamadı', 404);
  }
  if (action === 'archive' && request.method === 'POST') return archiveGundemItem(request, env, id);
  if (action === 'moderate' && request.method === 'POST') return moderateGundemItem(request, env, id);
  if (!action && request.method === 'PATCH') return updateGundemItem(request, env, id);
  if (!action && request.method === 'DELETE') return deleteGundemItem(env, id);
  return errorJson('Bulunamadı', 404);
}
