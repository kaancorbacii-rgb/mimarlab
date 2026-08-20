import { json, errorJson, readJson } from '../lib/http.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';

// En İyi 100 sayfası (en-iyi-100.html) — kullanıcı isteği: sıra/puan editöryal (D1 tablosu
// top100_entries, bkz. migrations/0054) kalsın ama (1) isim/görsel/link her istekte CANLI projects
// tablosundan taze çekilsin (proje admin panelinden yeniden adlandırılınca burada da otomatik
// değişsin) ve (2) gerçek kullanıcı puanları (ratings tablosu) bu editöryal tabanın ÜZERİNE
// eklenerek sıralamayı zamanla etkilesin. Yukarı/aşağı/sabit oklar için bir önceki hesaplanan
// sıra top100_rank_snapshot'ta saklanır (bkz. migrations/0053). Editöryal taban BAŞTA statik bir
// JS dosyasıydı (src/lib/top100Data.js) — kullanıcı isteği üzerine ("admine buradaki projeleri
// değiştirebilme yetkisi ver") D1'e taşındı ki admin panelden (bkz. handleTop100AdminRoute
// aşağıda, admin.html#loadTop100Admin) kod deploy'u gerekmeden satır ekleyip/çıkarabilsin.
const SNAPSHOT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün — bkz. dosya başı yorumu

function snapshotKeyFor(entry, resolvedSlug) {
  return resolvedSlug || ('n:' + entry.name);
}

export async function handleTop100Route(request, env, url) {
  if (request.method !== 'GET') return json({ error: 'Bulunamadı' }, 404);

  const { results: baselineRows } = await env.DB.prepare(
    `SELECT rnk, name, slug, base_avg, base_count FROM top100_entries ORDER BY rnk ASC`
  ).all();
  const TOP100_BASELINE = baselineRows.map(r => ({ rank: r.rnk, name: r.name, slug: r.slug, baseAvg: r.base_avg, baseCount: r.base_count }));

  const slugs = [...new Set(TOP100_BASELINE.map(e => e.slug).filter(Boolean))];

  const projectBySlug = new Map();
  const projectByLegacyKey = new Map();
  if (slugs.length) {
    // İKİ AYRI sorgu (bkz. kullanıcı isteği: canlı projects'ten taze isim/görsel çekme) — TEK
    // sorguda "slug IN (...) OR legacy_key IN (...)" ile aynı ~59 slug listesi İKİ KEZ bind
    // edilince (118 parametre) D1 "too many SQL variables" ile 500 veriyordu (gerçek bulgu,
    // canlıda yakalandı — D1'in parametre sınırı SQLite'ın kendi varsayılanından düşük). İki ayrı
    // sorgu, her biri yalnızca ~59 parametreyle, aynı sonucu sorunsuz üretir.
    const placeholders = slugs.map(() => '?').join(',');
    const [bySlug, byLegacy] = await Promise.all([
      env.DB.prepare(`SELECT slug, legacy_key, title, images, location, project_date, description, hidden_at, deleted_at FROM projects WHERE slug IN (${placeholders})`).bind(...slugs).all(),
      env.DB.prepare(`SELECT slug, legacy_key, title, images, location, project_date, description, hidden_at, deleted_at FROM projects WHERE legacy_key IN (${placeholders})`).bind(...slugs).all(),
    ]);
    for (const row of [...bySlug.results, ...byLegacy.results]) {
      const parsed = parseCanonicalRow('projects', row);
      if (parsed.slug) projectBySlug.set(parsed.slug, parsed);
      if (parsed.legacy_key) projectByLegacyKey.set(parsed.legacy_key, parsed);
    }
  }

  const { results: ratingRows } = await env.DB.prepare(
    `SELECT target_id, SUM(stars) AS sum, COUNT(*) AS count FROM ratings WHERE target_type = 'project' GROUP BY target_id`
  ).all();
  const realRatingsBySlug = new Map(ratingRows.map(r => [r.target_id, { sum: r.sum, count: r.count }]));

  const resolved = TOP100_BASELINE.map(entry => {
    let live = null;
    if (entry.slug) {
      live = projectBySlug.get(entry.slug) || projectByLegacyKey.get(entry.slug) || null;
      if (live && (live.deleted_at || live.hidden_at)) live = null;
    }
    const resolvedSlug = live ? live.slug : null;
    const name = live ? live.title : entry.name;
    const image = (live && live.images && live.images[0]) || null;
    const location = live ? live.location : null;
    const projectDate = live ? live.project_date : null;
    const description = live ? live.description : null;

    const real = resolvedSlug ? realRatingsBySlug.get(resolvedSlug) : null;
    const blendedCount = entry.baseCount + (real ? real.count : 0);
    const blendedSum = entry.baseAvg * entry.baseCount + (real ? real.sum : 0);
    const blendedAvg = blendedCount > 0 ? blendedSum / blendedCount : entry.baseAvg;

    return {
      baselineRank: entry.rank,
      name,
      slug: resolvedSlug,
      image,
      location,
      projectDate,
      description,
      avg: blendedAvg,
      count: blendedCount,
    };
  });

  resolved.sort((a, b) => (b.avg - a.avg) || (a.baselineRank - b.baselineRank));

  const snapshotRows = await env.DB.prepare(`SELECT target_key, rnk, snapshot_at FROM top100_rank_snapshot`).all();
  const snapshotByKey = new Map(snapshotRows.results.map(r => [r.target_key, r]));
  const now = Date.now();
  const writes = [];

  const items = resolved.map((entry, i) => {
    const rank = i + 1;
    const key = snapshotKeyFor(entry, entry.slug);
    const snap = snapshotByKey.get(key);
    let delta = 'flat';
    if (!snap) {
      // INSERT OR IGNORE (bkz. kullanıcı isteği: editöryal tabanda aynı canlı projeye işaret eden
      // iki farklı sıra satırı olabilir, ör. "Süleymaniye Camii" + "Süleymaniye Külliyesi" ikisi de
      // suleymaniye-camii slug'ına çözülüyor, bkz. src/lib/top100Data.js) — düz INSERT burada AYNI
      // target_key'i tek bir batch() içinde iki kez yazmaya çalışıp PRIMARY KEY çakışmasıyla TÜM
      // batch'i (ve dolayısıyla isteği) patlatırdı (gerçek bulgu, kod incelemesiyle yakalandı).
      writes.push(env.DB.prepare(
        `INSERT OR IGNORE INTO top100_rank_snapshot (target_key, rnk, snapshot_at) VALUES (?, ?, ?)`
      ).bind(key, rank, now));
    } else {
      if (rank < snap.rnk) delta = 'up';
      else if (rank > snap.rnk) delta = 'down';
      if (now - snap.snapshot_at > SNAPSHOT_REFRESH_MS) {
        writes.push(env.DB.prepare(
          `UPDATE top100_rank_snapshot SET rnk = ?, snapshot_at = ? WHERE target_key = ?`
        ).bind(rank, now, key));
      }
    }
    return {
      rank,
      name: entry.name,
      slug: entry.slug,
      image: entry.image,
      location: entry.location,
      projectDate: entry.projectDate,
      description: entry.description,
      avg: Math.round(entry.avg * 100) / 100,
      count: entry.count,
      delta,
    };
  });

  if (writes.length) await env.DB.batch(writes);

  return json({ items, generatedAt: now });
}

// GET/POST /api/admin/top100, DELETE /api/admin/top100/:id — kullanıcı isteği: "admine buradaki
// projeleri değiştirebilme yetkisi ver, ör. bir projeyi listeden çıkartıp başka bir proje
// ekleyebileyim". src/routes/admin.js#handleAdminRoute zaten requireAdmin() ile korunuyor, bu
// yüzden burada AYRICA bir yetki kontrolü yok (bkz. o dosyadaki dispatch). Sıra numarası
// çakışmaları (iki kayıt aynı rnk) kasıtlı olarak ENGELLENMEZ — handleTop100Route zaten avg'ye
// göre yeniden sıralayıp gerçek görüntü sırasını üretiyor, rnk yalnızca eşit puan durumunda
// döngü kırıcı ve ilk (hiç geçmişi olmayan) sıralama referansı olarak kullanılıyor.
export async function handleTop100AdminRoute(request, env, url, segments) {
  // segments: ["api", "admin", "top100", id?]
  if (segments.length === 3 && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT id, rnk, name, slug, base_avg, base_count FROM top100_entries ORDER BY rnk ASC`
    ).all();
    return json({ items: results });
  }
  if (segments.length === 3 && request.method === 'POST') {
    const body = await readJson(request);
    const rnk = parseInt(body.rnk, 10);
    const name = (body.name || '').trim();
    const slug = (body.slug || '').trim() || null;
    const baseAvg = parseFloat(body.baseAvg);
    const baseCount = parseInt(body.baseCount, 10);
    if (!name || !Number.isInteger(rnk) || rnk < 1 || !Number.isFinite(baseAvg) || baseAvg < 0 || baseAvg > 5 || !Number.isInteger(baseCount) || baseCount < 0) {
      return errorJson('Geçersiz veri: isim, sıra no (≥1), taban puan (0-5) ve taban oy sayısı (≥0) gerekli.');
    }
    const now = Date.now();
    const result = await env.DB.prepare(
      `INSERT INTO top100_entries (rnk, name, slug, base_avg, base_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(rnk, name, slug, baseAvg, baseCount, now, now).run();
    return json({ ok: true, id: result.meta.last_row_id });
  }
  if (segments.length === 4 && request.method === 'DELETE') {
    await env.DB.prepare(`DELETE FROM top100_entries WHERE id = ?`).bind(segments[3]).run();
    return json({ ok: true });
  }
  return errorJson('Bulunamadı', 404);
}
