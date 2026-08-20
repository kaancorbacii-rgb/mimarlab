import { json } from '../lib/http.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { TOP100_BASELINE } from '../lib/top100Data.js';

// En İyi 100 sayfası (en-iyi-100.html) — kullanıcı isteği: sıra/puan editöryal (src/lib/
// top100Data.js#TOP100_BASELINE) kalsın ama (1) isim/görsel/link her istekte CANLI projects
// tablosundan taze çekilsin (proje admin panelinden yeniden adlandırılınca burada da otomatik
// değişsin) ve (2) gerçek kullanıcı puanları (ratings tablosu) bu editöryal tabanın ÜZERİNE
// eklenerek sıralamayı zamanla etkilesin. Yukarı/aşağı/sabit oklar için bir önceki hesaplanan
// sıra top100_rank_snapshot'ta saklanır (bkz. migrations/0053).
const SNAPSHOT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün — bkz. dosya başı yorumu

function snapshotKeyFor(entry, resolvedSlug) {
  return resolvedSlug || ('n:' + entry.name);
}

export async function handleTop100Route(request, env, url) {
  if (request.method !== 'GET') return json({ error: 'Bulunamadı' }, 404);

  const slugs = [...new Set(TOP100_BASELINE.map(e => e.slug).filter(Boolean))];

  const projectBySlug = new Map();
  const projectByLegacyKey = new Map();
  if (slugs.length) {
    const placeholders = slugs.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT slug, legacy_key, title, images, location, project_date, hidden_at, deleted_at FROM projects
       WHERE (slug IN (${placeholders}) OR legacy_key IN (${placeholders}))`
    ).bind(...slugs, ...slugs).all();
    for (const row of results) {
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
      avg: Math.round(entry.avg * 100) / 100,
      count: entry.count,
      delta,
    };
  });

  if (writes.length) await env.DB.batch(writes);

  return json({ items, generatedAt: now });
}
