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
  const row = await env.DB.prepare('SELECT slug FROM gundem_items WHERE id = ?').bind(id).first();
  if (!row) return errorJson('Bulunamadı', 404);

  const sets = [];
  const binds = [];
  for (const field of EDITABLE) {
    if (!(field in body)) continue;
    const value = typeof body[field] === 'string' ? body[field].trim() : '';
    if (!value) return errorJson(`${field} boş olamaz.`);
    if (field === 'image_url') {
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

// GET /api/admin/gundem — arşivlenenler DAHİL tüm kayıtlar (admin listesi).
async function listGundemAdmin(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, slug, title, summary, image_url, category, status, source_name, source_url,
            source_published_at, published_at
       FROM gundem_items ORDER BY published_at DESC LIMIT 200`
  ).all();
  return json({ items: results });
}

// segments: ["api","admin","gundem", <id?>, <action?>]
export async function handleGundemAdminRoute(request, env, segments) {
  const id = segments[3];
  const action = segments[4];

  if (!id) {
    if (request.method === 'GET') return listGundemAdmin(env);
    return errorJson('Bulunamadı', 404);
  }
  if (action === 'archive' && request.method === 'POST') return archiveGundemItem(request, env, id);
  if (!action && request.method === 'PATCH') return updateGundemItem(request, env, id);
  if (!action && request.method === 'DELETE') return deleteGundemItem(env, id);
  return errorJson('Bulunamadı', 404);
}
