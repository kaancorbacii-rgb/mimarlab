// Düello — mevcut proje rating/Top100 sisteminden tamamen bağımsız "winner stays" karşılaştırma
// oyunu (bkz. kullanıcı isteği, migrations/0062_duel_system.sql). Üç uç: GET .../match (aktif
// eşleşmeyi getirir/üretir), POST .../vote (oy kullanır, atomik), GET .../leaderboard (yalnızca
// duel_score'a göre — Top100 DEĞİL).
import { json, errorJson, readJson, parseCookies, isHttps } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId, randomToken } from '../lib/crypto.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { OFFICE_EDIT_POSITIONS } from '../lib/projectClaimAccess.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { fetchDuelPool } from '../lib/duelPool.js';
import { getCachedPool, poolCacheKey } from '../lib/publicCache.js';

export async function handleDuelRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "duel", "match"|"vote"|"leaderboard"]
  if (segments.length === 3 && segments[2] === 'match' && request.method === 'GET') return getMatch(request, env);
  if (segments.length === 3 && segments[2] === 'vote' && request.method === 'POST') return castVote(request, env);
  if (segments.length === 3 && segments[2] === 'leaderboard' && request.method === 'GET') return getLeaderboard(request, env);
  return errorJson('Bulunamadı', 404);
}

const DUEL_SID_MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 gün — mimarlab_session ile AYNI __Host-/Secure deseni (bkz. src/lib/http.js#sessionCookieHeader), ama ayrı, auth'tan bağımsız bir çerez.

function duelSidCookieName(request) {
  return isHttps(request) ? '__Host-mimarlab_duel_sid' : 'mimarlab_duel_sid';
}
function duelSidCookieHeader(token, request) {
  const secure = isHttps(request) ? '; Secure' : '';
  return `${duelSidCookieName(request)}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${DUEL_SID_MAX_AGE_SECONDS}`;
}

// Üye olmayan ziyaretçiler de oynayabilsin diye (kullanıcı isteği madde 11) auth session'dan
// BAĞIMSIZ, salt sunucu tarafı bir korelasyon çerezi. Giriş yapılmışsa daima kullanıcı kimliği
// önceliklidir ('u:<id>'), aksi halde anonim çerez ('s:<sid>') — bilinçli olarak basit tutuldu: bir
// kullanıcı sonradan giriş yaparsa önceki anonim geçmişi otomatik devralınmaz.
async function resolveActor(request, env) {
  const user = await getSessionUser(request, env);
  if (user) return { actorKey: `u:${user.id}`, user, setCookie: null };
  const cookies = parseCookies(request);
  const existing = cookies[duelSidCookieName(request)];
  if (existing) return { actorKey: `s:${existing}`, user: null, setCookie: null };
  const sid = randomToken();
  return { actorKey: `s:${sid}`, user: null, setCookie: duelSidCookieHeader(sid, request) };
}

// Bir kullanıcının "kendi" sayılan projeleri: doğrudan sahiplendiği (claimed_by_user_id) + onaylı bir
// mimar/firma profil talebi (profile_claims) üzerinden bağlı olduğu projeler — src/lib/
// projectClaimAccess.js#canUserEditProjectBySlug İLE AYNI yetki kuralı (firma için AYNI
// OFFICE_EDIT_POSITIONS pozisyon kısıtı), ama tersine (slug->yetkili değil, kullanıcı->proje id
// kümesi) çalışır çünkü düello aday havuzunu TOPLU filtrelemesi gerekiyor.
async function getOwnProjectIds(env, user) {
  const ids = new Set();
  if (!user) return ids;
  const claimedDirect = await env.DB.prepare(
    `SELECT id FROM projects WHERE claimed_by_user_id = ? AND deleted_at IS NULL`
  ).bind(user.id).all();
  claimedDirect.results.forEach(r => ids.add(r.id));

  const { results: claims } = await env.DB.prepare(
    `SELECT profile_type, profile_key FROM profile_claims WHERE user_id = ? AND status = 'approved'`
  ).bind(user.id).all();
  for (const c of claims) {
    if (c.profile_type === 'architect') {
      const { results } = await env.DB.prepare(
        `SELECT pd.project_id AS id FROM project_designers pd
         JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL
         WHERE ar.name = ?`
      ).bind(c.profile_key).all();
      results.forEach(r => ids.add(r.id));
    } else if (c.profile_type === 'office' && OFFICE_EDIT_POSITIONS.has(user.position)) {
      const { results } = await env.DB.prepare(
        `SELECT pd.project_id AS id FROM project_designers pd
         JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
         WHERE ofc.name = ?`
      ).bind(c.profile_key).all();
      results.forEach(r => ids.add(r.id));
    }
  }
  return ids;
}

function shapeCard(item) {
  return {
    slug: item.slug, title: item.title, image: item.image,
    designer: item.designer, officeNames: item.officeNames,
    category: item.category, type: item.type, location: item.location,
  };
}

function pairKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }
function shareAny(a, b) { return (a || []).some(x => (b || []).includes(x)); }

const HISTORY_LOOKBACK = 200;
// Aynı actor'e daha önce gösterilmiş çiftlerin (kullanıcı isteği madde 6) tekrarını engellemek için
// — sınırsız geçmiş yerine SON N eşleşmeyle sınırlı (idx_duel_matches_actor bunu ucuza karşılar);
// bir oturumun bunu aşan geçmişinde nadiren bir tekrar OLABİLİR ("mümkün olduğunca" — kullanıcı
// isteğinin kendi ifadesi), tam tablo taraması yapmaktansa bu ödünleşim tercih edildi.
async function fetchSeenPairKeys(env, actorKey) {
  const { results } = await env.DB.prepare(
    `SELECT project_a_id, project_b_id FROM duel_matches WHERE actor_key = ? ORDER BY created_at DESC LIMIT ?`
  ).bind(actorKey, HISTORY_LOOKBACK).all();
  return new Set(results.map(r => pairKey(r.project_a_id, r.project_b_id)));
}

// Aktif proje sabitken rakip seçimi — öncelik sırası (kullanıcı isteği madde 5): daha önce
// görülmemiş + uyumlu tipoloji (category) > uyumlu grup (type) > herhangi biri. Havuz zaten cache'li
// olduğundan (bkz. duelPool.js) bu tamamen JS tarafında, ek bir D1 sorgusu olmadan çalışır.
function pickOpponent(pool, activeId, activeCategory, activeType, excludeIds, seenPairKeys) {
  const candidates = pool.filter(p => p.id !== activeId && !excludeIds.has(p.id));
  if (!candidates.length) return null;
  const notSeen = candidates.filter(p => !seenPairKeys.has(pairKey(activeId, p.id)));
  const tier0 = notSeen.length ? notSeen : candidates;
  const sameCategory = tier0.filter(p => shareAny(p.category, activeCategory));
  const sameType = tier0.filter(p => shareAny(p.type, activeType));
  const tier = sameCategory.length ? sameCategory : (sameType.length ? sameType : tier0);
  return tier[Math.floor(Math.random() * tier.length)];
}

// Sıfırdan (aktif proje yokken) rastgele, birbirinden farklı, mümkünse daha önce eşleşmemiş iki
// proje seçer — sınırlı denemeyle (havuz çok küçükse/hepsi görülmüşse sonsuz döngüye girmeden
// makul bir çifte düşer).
function pickFreshPair(pool, excludeIds, seenPairKeys) {
  const candidates = pool.filter(p => !excludeIds.has(p.id));
  if (candidates.length < 2) return null;
  for (let i = 0; i < 8; i++) {
    const a = candidates[Math.floor(Math.random() * candidates.length)];
    const b = candidates[Math.floor(Math.random() * candidates.length)];
    if (a.id !== b.id && !seenPairKeys.has(pairKey(a.id, b.id))) return [a, b];
  }
  const a = candidates[Math.floor(Math.random() * candidates.length)];
  const rest = candidates.filter(p => p.id !== a.id);
  if (!rest.length) return null;
  return [a, rest[Math.floor(Math.random() * rest.length)]];
}

// GET /api/duel/match — bekleyen (oy kullanılmamış) bir eşleşme varsa AYNEN döner (reload'da/aynı
// sekmede tekrar istekte yeni rastgele çift ÜRETİLMEZ, kullanıcı isteği: state korunsun, full page
// reload olmasın). Yoksa duel_sessions'taki son duruma (aktif proje + streak) göre yeni bir eşleşme
// üretir; hiç oynanmamışsa sıfırdan rastgele bir çift verir.
async function getMatch(request, env) {
  const { actorKey, user, setCookie } = await resolveActor(request, env);
  const headers = setCookie ? { 'Set-Cookie': setCookie } : {};

  if (!(await checkRateLimit(env, 'duel_match', actorKey, 120, 60 * 1000))) {
    return errorJson('Çok fazla istek. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '60', ...headers });
  }

  const pool = await fetchDuelPool(env);
  if (pool.length < 2) return errorJson('Şu anda düello için yeterli proje yok.', 503, headers);
  const byId = new Map(pool.map(p => [p.id, p]));

  const pending = await env.DB.prepare(
    `SELECT id, project_a_id, project_b_id FROM duel_matches WHERE actor_key = ? AND voted_at IS NULL ORDER BY created_at DESC LIMIT 1`
  ).bind(actorKey).first();

  if (pending && byId.has(pending.project_a_id) && byId.has(pending.project_b_id)) {
    const session = await env.DB.prepare(`SELECT active_project_id, streak FROM duel_sessions WHERE actor_key = ?`).bind(actorKey).first();
    const activeSide = session && session.active_project_id === pending.project_a_id ? 'a'
      : session && session.active_project_id === pending.project_b_id ? 'b' : null;
    return json({
      matchId: pending.id,
      streak: session ? session.streak : 0,
      activeSide,
      a: shapeCard(byId.get(pending.project_a_id)),
      b: shapeCard(byId.get(pending.project_b_id)),
    }, 200, headers);
  }

  const ownIds = await getOwnProjectIds(env, user);
  const session = await env.DB.prepare(`SELECT active_project_id, streak FROM duel_sessions WHERE actor_key = ?`).bind(actorKey).first();
  const seenPairKeys = await fetchSeenPairKeys(env, actorKey);

  let a = null, b = null, streak = 0, activeSide = null;
  const activeItem = session && session.active_project_id ? byId.get(session.active_project_id) : null;
  if (activeItem && !ownIds.has(activeItem.id)) {
    const opponent = pickOpponent(pool, activeItem.id, activeItem.category, activeItem.type, ownIds, seenPairKeys);
    if (opponent) { a = activeItem; b = opponent; streak = session.streak || 0; activeSide = 'a'; }
  }
  if (!a) {
    const pair = pickFreshPair(pool, ownIds, seenPairKeys);
    if (!pair) return errorJson('Şu anda uygun bir rakip bulunamadı.', 503, headers);
    [a, b] = pair;
    streak = 0;
    activeSide = null;
  }

  const matchId = newId();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO duel_matches (id, actor_key, project_a_id, project_b_id, created_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(matchId, actorKey, a.id, b.id, now).run();

  return json({ matchId, streak, activeSide, a: shapeCard(a), b: shapeCard(b) }, 200, headers);
}

// POST /api/duel/vote {matchId, choice:'a'|'b'} — client'ın gönderdiği winner/score/streak HİÇBİR
// ZAMAN otoriter kabul edilmez (kullanıcı isteği madde 8): sunucu match satırını kendi okur, gerçek
// proje id'lerini oradan alır, atomik `UPDATE ... WHERE voted_at IS NULL` ile TEK seferlik puanlama
// garantisi verir (ratings.js#upsertRating'teki AYNI ilke — bkz. o dosyadaki INSERT..ON CONFLICT
// yorumu).
async function castVote(request, env) {
  const { actorKey, user, setCookie } = await resolveActor(request, env);
  const headers = setCookie ? { 'Set-Cookie': setCookie } : {};

  if (!(await checkRateLimit(env, 'duel_vote', actorKey, 60, 60 * 1000))) {
    return errorJson('Çok fazla oylama işlemi yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '60', ...headers });
  }

  const body = await readJson(request);
  const matchId = String(body.matchId || '').trim();
  const choice = body.choice;
  if (!matchId || (choice !== 'a' && choice !== 'b')) return errorJson('Geçersiz istek.', 400, headers);

  const match = await env.DB.prepare(
    `SELECT id, actor_key, project_a_id, project_b_id, winner_project_id, voted_at FROM duel_matches WHERE id = ?`
  ).bind(matchId).first();
  if (!match) return errorJson('Eşleşme bulunamadı.', 404, headers);
  // Bir eşleşme yalnızca onu ÜRETEN actor tarafından oylanabilir — başka bir kullanıcı/session'ın
  // matchId'sini tahmin edip/paylaşıp o eşleşmeyi sahte oylaması engellenir.
  if (match.actor_key !== actorKey) return errorJson('Bu eşleşme sana ait değil.', 403, headers);

  const winnerId = choice === 'a' ? match.project_a_id : match.project_b_id;
  const loserId = choice === 'a' ? match.project_b_id : match.project_a_id;

  // Duplicate vote — ikinci isteği REDDETMEK yerine (kullanıcı isteği madde 19: idempotent
  // döndürülebilir) önceden kaydedilmiş gerçek sonucu, hiçbir mutasyon yapmadan aynen döner.
  if (match.voted_at) {
    const session = await env.DB.prepare(`SELECT streak FROM duel_sessions WHERE actor_key = ?`).bind(actorKey).first();
    return json({ ok: true, winnerId: match.winner_project_id, streak: session ? session.streak : 0, duplicate: true }, 200, headers);
  }

  // Kendi projesini seçerek puanlandıramama (kullanıcı isteği madde 7) — rakip seçiminde zaten
  // kendi projeleri havuzdan çıkarılıyor (bkz. getMatch#ownIds), ama eşleşme üretildikten SONRA
  // kullanıcı o projeyi claim edebileceğinden (ör. paralel sekme) burada AYRICA (defense in depth)
  // doğrulanır — hiçbir mutasyon yapılmadan reddedilir.
  if (user) {
    const ownIds = await getOwnProjectIds(env, user);
    if (ownIds.has(winnerId)) return errorJson('Kendi projeni seçerek puanlandıramazsın.', 403, headers);
  }

  const now = Date.now();
  const updateResult = await env.DB.prepare(
    `UPDATE duel_matches SET winner_project_id = ?, voted_at = ? WHERE id = ? AND voted_at IS NULL`
  ).bind(winnerId, now, matchId).run();

  if (!updateResult.meta.changes) {
    // Bu istekle EŞ ZAMANLI başka bir istek (ör. çift tıklama) atomik guard'ı önce geçti — ikinci
    // artış hiç OLMADI (kullanıcı isteği madde 8), şimdiki gerçek sonuç idempotent olarak döner.
    const finalMatch = await env.DB.prepare(`SELECT winner_project_id FROM duel_matches WHERE id = ?`).bind(matchId).first();
    const session = await env.DB.prepare(`SELECT streak FROM duel_sessions WHERE actor_key = ?`).bind(actorKey).first();
    return json({ ok: true, winnerId: finalMatch.winner_project_id, streak: session ? session.streak : 0, duplicate: true }, 200, headers);
  }

  const priorSession = await env.DB.prepare(`SELECT active_project_id, streak FROM duel_sessions WHERE actor_key = ?`).bind(actorKey).first();
  const newStreak = (priorSession && priorSession.active_project_id === winnerId) ? (priorSession.streak || 0) + 1 : 1;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO project_duel_stats (project_id, duel_score, total_comparisons, updated_at) VALUES (?, 1, 1, ?)
       ON CONFLICT(project_id) DO UPDATE SET duel_score = duel_score + 1, total_comparisons = total_comparisons + 1, updated_at = excluded.updated_at`
    ).bind(winnerId, now),
    env.DB.prepare(
      `INSERT INTO project_duel_stats (project_id, duel_score, total_comparisons, updated_at) VALUES (?, 0, 1, ?)
       ON CONFLICT(project_id) DO UPDATE SET total_comparisons = total_comparisons + 1, updated_at = excluded.updated_at`
    ).bind(loserId, now),
    env.DB.prepare(
      `INSERT INTO duel_sessions (actor_key, active_project_id, streak, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(actor_key) DO UPDATE SET active_project_id = excluded.active_project_id, streak = excluded.streak, updated_at = excluded.updated_at`
    ).bind(actorKey, winnerId, newStreak, now),
  ]);

  // Yalnızca leaderboard'un KENDİ dar KV anahtarı temizlenir (publicCache.js#invalidatePublicCache
  // İLE AYNI site-geneli sweep'e KASITLI OLARAK girmez — her oyda TÜM public cache'i (Top100/proje/
  // mimar/firma/ürün listeleri) temizlemek performans önceliğine aykırı olurdu). Bu, leaderboard'un
  // her oydan hemen sonra taze görünmesini (kullanıcı isteği: kendi oyunun sonucunu görmek ister)
  // yalnızca TEK, ucuz bir KV silme ile sağlar — sonraki GET bir kez lazy yeniden hesaplar.
  if (env.FACET_CACHE) {
    try { await env.FACET_CACHE.delete(poolCacheKey('duel:leaderboard')); } catch {}
  }

  return json({ ok: true, winnerId, streak: newStreak }, 200, headers);
}

// GET /api/duel/leaderboard — YALNIZCA duel_score'a göre (Top100 DEĞİL, kullanıcı isteği madde 15).
// idx_project_duel_stats_score(duel_score DESC) sayesinde LIMIT 20 sonrası tam tablo taraması
// gerekmez; sonuç ayrıca getCachedPool (duelPool.js İLE AYNI FACET_CACHE/TTL altyapısı) ile
// önbelleklenir — her oyda TÜM projects tablosunun sorgulanmaması (kullanıcı isteği madde 15/16).
async function computeDuelLeaderboard(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.slug, p.title, p.images, p.location, pds.duel_score AS duelScore
     FROM project_duel_stats pds
     JOIN projects p ON p.id = pds.project_id AND p.deleted_at IS NULL AND p.hidden_at IS NULL
     WHERE pds.duel_score > 0
     ORDER BY pds.duel_score DESC
     LIMIT 20`
  ).all();
  return {
    items: results.map(row => {
      const p = parseCanonicalRow('projects', row);
      return { slug: row.slug, title: row.title, location: row.location, image: (p.images && p.images[0]) || null, duelScore: row.duelScore };
    }),
  };
}

const LEADERBOARD_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, s-maxage=300' };

async function getLeaderboard(request, env) {
  const data = await getCachedPool(env, 'duel:leaderboard', () => computeDuelLeaderboard(env));
  return json(data, 200, LEADERBOARD_CACHE_HEADERS);
}
