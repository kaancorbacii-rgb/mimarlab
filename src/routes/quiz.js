// AI Architecture Quiz — MİMARLAB'ın kendi D1 verisinden ÜRETİLEN, tamamen deterministik günlük
// mimarlık sorusu oyunu (bkz. kullanıcı isteği). Bilinçli olarak AI çağrısı YOK — sorular ve
// açıklamalar proje kayıtlarındaki gerçek/doğrulanabilir alanlardan (mimar/şehir/dönem/yapı türü)
// şablonla üretilir, hallüsinasyon riski taşımaz. Sunucu tarafında "bekleyen soru" state'i hiç
// TUTULMAZ: her soru projectId+questionType'a deterministik bağlıdır, doğru cevap yalnızca
// POST .../answer anında proje kaydından yeniden okunup karşılaştırılır (bkz. src/routes/duel.js#
// castVote'taki AYNI ilke: client'ın gönderdiği hiçbir şey otoriter kabul edilmez).
import { json, errorJson, readJson, parseCookies, isHttps } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId, randomToken } from '../lib/crypto.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { getActiveBadge } from '../lib/badgeAccess.js';
import { fetchQuizPool } from '../lib/quizPool.js';

export async function handleQuizRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "quiz", "status"|"question"|"answer"]
  if (segments.length === 3 && segments[2] === 'status' && request.method === 'GET') return getStatus(request, env);
  if (segments.length === 3 && segments[2] === 'question' && request.method === 'GET') return getQuestion(request, env);
  if (segments.length === 3 && segments[2] === 'answer' && request.method === 'POST') return postAnswer(request, env);
  return errorJson('Bulunamadı', 404);
}

// duel.js#resolveActor İLE AYNI desen (bkz. o dosyadaki yorum) — ayrı, dar bir çerez tercih edildi
// (paylaşılan tek bir helper'a çıkarmak, iki bağımsız oyunun kimlik ömrünü/adını birbirine
// bağımlı kılardı; kullanıcı ile netleştirildi: Quiz için giriş ZORUNLU DEĞİL, anonim kullanıcılar
// da cihaz/tarayıcı bazlı bir cookie ile günlük 5 soru oynayabilir).
const QUIZ_SID_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
function quizSidCookieName(request) {
  return isHttps(request) ? '__Host-mimarlab_quiz_sid' : 'mimarlab_quiz_sid';
}
function quizSidCookieHeader(token, request) {
  const secure = isHttps(request) ? '; Secure' : '';
  return `${quizSidCookieName(request)}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${QUIZ_SID_MAX_AGE_SECONDS}`;
}
async function resolveActor(request, env) {
  const user = await getSessionUser(request, env);
  if (user) return { actorKey: `u:${user.id}`, user, setCookie: null };
  const cookies = parseCookies(request);
  const existing = cookies[quizSidCookieName(request)];
  if (existing) return { actorKey: `s:${existing}`, user: null, setCookie: null };
  const sid = randomToken();
  return { actorKey: `s:${sid}`, user: null, setCookie: quizSidCookieHeader(sid, request) };
}

// Kullanıcının SAHİP OLDUĞU en yüksek entitlement'a göre günlük soru hakkı (kullanıcı isteği) —
// mevcut rozet sistemi AYNEN reuse edilir (bkz. src/lib/badgeAccess.js#getActiveBadge, halihazırda
// submissions.js/comments.js'te kullanılan TEK "en yüksek rozet" kaynağı). Anonim kullanıcılar ve
// hiçbir aktif rozeti olmayan giriş yapmış kullanıcılar aynı ücretsiz limiti (5) paylaşır.
const QUIZ_DAILY_LIMITS = { destekci: 7, verified: 10, gold: 15, platinum: 25 };
const FREE_DAILY_LIMIT = 5;
async function resolveDailyLimit(env, user) {
  if (!user) return FREE_DAILY_LIMIT;
  const badge = await getActiveBadge(env, user.id);
  if (!badge) return FREE_DAILY_LIMIT;
  return QUIZ_DAILY_LIMITS[badge.badge_type] || FREE_DAILY_LIMIT;
}

// UTC takvim günü — kvQuota.js/r2Quota.js İLE AYNI konvansiyon (bkz. proje hafızası: kod tabanında
// başka bir "canonical" saat dilimi yaklaşımı yok).
function todayKey() { return new Date().toISOString().slice(0, 10); }

async function countToday(env, actorKey, day) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM quiz_attempts WHERE actor_key = ? AND day = ?`
  ).bind(actorKey, day).first();
  return row ? row.c : 0;
}

async function getStatus(request, env) {
  const { actorKey, user, setCookie } = await resolveActor(request, env);
  const headers = setCookie ? { 'Set-Cookie': setCookie } : {};
  const day = todayKey();
  const [limit, usedRow] = await Promise.all([
    resolveDailyLimit(env, user),
    env.DB.prepare(
      `SELECT COUNT(*) AS used, SUM(correct) AS correct FROM quiz_attempts WHERE actor_key = ? AND day = ?`
    ).bind(actorKey, day).first(),
  ]);
  const used = (usedRow && usedRow.used) || 0;
  const correctToday = (usedRow && usedRow.correct) || 0;
  return json({ limit, used, correctToday, wrongToday: used - correctToday }, 200, headers);
}

// Soru tipleri — hepsi proje görseli üzerinden sorulur (kullanıcı isteği: "görsel üzerinden mimari
// eseri tahmin etme" maddesi bu şekilde zaten karşılanıyor, ayrı bir tip değil). field() proje havuzu
// item'ından doğru cevabı okur; yalnızca bu alanı DOLU olan projeler o tip için havuza girer
// (kullanıcı isteği: "doğrulanabilir veri önceliği", uydurma/boş cevap yok).
const QUESTION_TYPES = [
  { type: 'architect', prompt: 'Bu yapı hangi mimara aittir?', field: item => item.architect },
  { type: 'city', prompt: 'Bu yapı hangi şehirde?', field: item => item.city },
  { type: 'period', prompt: 'Bu yapı hangi döneme ait?', field: item => item.period },
  { type: 'discipline', prompt: 'Bu proje hangi yapı türüne ait?', field: item => item.discipline },
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function getQuestion(request, env) {
  const { actorKey, user, setCookie } = await resolveActor(request, env);
  const headers = setCookie ? { 'Set-Cookie': setCookie } : {};

  if (!(await checkRateLimit(env, 'quiz_question', actorKey, 60, 60 * 1000))) {
    return errorJson('Çok fazla istek. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '60', ...headers });
  }

  const day = todayKey();
  const [limit, used] = await Promise.all([resolveDailyLimit(env, user), countToday(env, actorKey, day)]);
  if (used >= limit) return errorJson('Bugünkü soru hakkını kullandın.', 403, { ...headers, 'X-Quiz-Limit': String(limit), 'X-Quiz-Used': String(used) });

  const pool = await fetchQuizPool(env);
  if (pool.length < 4) return errorJson('Şu anda Quiz için yeterli proje yok.', 503, headers);

  // Aynı günde ART ARDA aynı proje tekrarını önle (kullanıcı isteği madde 5) — o günün son birkaç
  // sorusunun proje id'lerini dışla.
  const { results: recent } = await env.DB.prepare(
    `SELECT project_id FROM quiz_attempts WHERE actor_key = ? AND day = ? ORDER BY created_at DESC LIMIT 3`
  ).bind(actorKey, day).all();
  const recentIds = new Set(recent.map(r => r.project_id));

  // Uygulanabilir tip + proje çifti: o tipin alanı dolu olan projelerden, mümkünse son sorulardan
  // farklı birini rastgele seç.
  const candidates = [];
  for (const qt of QUESTION_TYPES) {
    for (const item of pool) {
      if (qt.field(item)) candidates.push({ qt, item });
    }
  }
  if (!candidates.length) return errorJson('Şu anda Quiz için yeterli veri yok.', 503, headers);
  const fresh = candidates.filter(c => !recentIds.has(c.item.id));
  const pickFrom = fresh.length ? fresh : candidates;
  const { qt, item } = pickFrom[Math.floor(Math.random() * pickFrom.length)];

  const correctValue = qt.field(item);
  const distractorPool = pool
    .map(p => qt.field(p))
    .filter(v => v && v !== correctValue);
  const uniqueDistractors = shuffle([...new Set(distractorPool)]).slice(0, 3);
  const options = shuffle([correctValue, ...uniqueDistractors]).map(v => ({ value: v, label: v }));

  return json({
    projectId: item.id,
    questionType: qt.type,
    image: item.image,
    prompt: qt.prompt,
    options,
    progress: { limit, used },
  }, 200, headers);
}

// Şehir adına doğrudan "'de/'da" eki eklemek Türkçe ünlü uyumu gerektirir (ör. "İstanbul'da" değil
// yanlışlıkla "İstanbul'de") — bunu doğru çözmek yerine (tam ünlü uyumu + ünsüz yumuşaması mantığı
// gerektirir) cümle eksiz kurulur, her şehir adında doğru kalır.
const EXPLANATION_BY_TYPE = {
  architect: (v, item) => `Bu projenin mimarı ${v}.`,
  city: (v, item) => `Bu projenin bulunduğu şehir: ${v}.`,
  period: (v, item) => `Bu proje ${v} dönemine ait.`,
  discipline: (v, item) => `Bu proje "${v}" türünde.`,
};

async function postAnswer(request, env) {
  const { actorKey, user, setCookie } = await resolveActor(request, env);
  const headers = setCookie ? { 'Set-Cookie': setCookie } : {};

  if (!(await checkRateLimit(env, 'quiz_answer', actorKey, 60, 60 * 1000))) {
    return errorJson('Çok fazla istek. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '60', ...headers });
  }

  const body = await readJson(request);
  const projectId = Number(body.projectId);
  const questionType = String(body.questionType || '');
  const choice = typeof body.choice === 'string' ? body.choice : '';
  const qt = QUESTION_TYPES.find(q => q.type === questionType);
  if (!projectId || !qt || !choice) return errorJson('Geçersiz istek.', 400, headers);

  const day = todayKey();
  const limit = await resolveDailyLimit(env, user);
  // Hızlı-yol kontrolü — açıkça limit üstündeyse pool sorgusu/karşılaştırma hiç yapılmaz (performans).
  // TEK BAŞINA yeterli DEĞİL: bu SELECT ile aşağıdaki atomik INSERT arasında paralel bir istek aynı
  // "henüz doldurulmadı" anını görüp geçebilir (audit bulgusu, 2026-08-27 — 20 eşzamanlı istekle
  // doğrulandı: yalnızca bu ön-kontrol olsaydı limit aşılabilirdi). Asıl, yarışa kapalı garanti
  // aşağıdaki atomik INSERT...WHERE'de.
  if ((await countToday(env, actorKey, day)) >= limit) {
    return errorJson('Bugünkü soru hakkını kullandın.', 403, headers);
  }

  const pool = await fetchQuizPool(env);
  const item = pool.find(p => p.id === projectId);
  if (!item) return errorJson('Proje bulunamadı.', 404, headers);
  const correctValue = qt.field(item);
  if (!correctValue) return errorJson('Bu proje için bu soru tipi geçersiz.', 400, headers);
  const correct = choice === correctValue;

  // Atomik yazma-anı guard'ı — src/lib/rateLimit.js#checkRateLimit VE duel.js#castVote'un
  // (`UPDATE ... WHERE voted_at IS NULL`) İLE AYNI ilke: sayım + yazma TEK bir SQL ifadesinde,
  // aralarında başka bir isteğin sızabileceği bir pencere BIRAKMADAN çalışır. WHERE alt sorgusu
  // limit zaten dolmuşsa 0 satır etkiler — INSERT hiç gerçekleşmez, meta.changes bunu yansıtır.
  const insertResult = await env.DB.prepare(
    `INSERT INTO quiz_attempts (id, actor_key, user_id, day, question_type, project_id, correct, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT COUNT(*) FROM quiz_attempts WHERE actor_key = ? AND day = ?) < ?`
  ).bind(newId(), actorKey, user ? user.id : null, day, questionType, projectId, correct ? 1 : 0, Date.now(), actorKey, day, limit).run();

  if (!insertResult.meta.changes) {
    return errorJson('Bugünkü soru hakkını kullandın.', 403, headers);
  }

  const explain = EXPLANATION_BY_TYPE[questionType];
  return json({
    correct,
    correctAnswer: correctValue,
    explanation: explain ? explain(correctValue, item) : '',
    projectLink: `/proje/${item.slug}`,
    architectLink: item.architectSlug ? `/mimar/${item.architectSlug}` : null,
  }, 200, headers);
}
