// Profil İstatistikleri (kullanıcı isteği, 2026-09-04) — iki uç:
//   POST /api/analytics/track    — görüntülenme/arama gösterimi sayacı (herkese açık, oturum gerekmez)
//   GET  /api/analytics/summary  — rozetli üyenin KENDİ istatistikleri (oturum + rozet zorunlu)
//
// VERİ KAYNAĞI İLKESİ: uydurma/tahmin YOK. Her sayı ya analytics_daily'deki gerçek bir sayaçtan ya
// da zaten var olan bir tablodan (saved_items / follows / messages) doğrudan gelir. Ölçemediğimiz
// hiçbir şey (ör. Google'dan gelen trafiğin kaynağı) raporlanmaz.
import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { slugify } from '../lib/slugify.js';
import { hasAnalyticsAccess, resolveOwnedSubjects } from '../lib/analyticsAccess.js';
// bkz. src/routes/follows.js/office.js'teki AYNI CJS-interop deseni — firma/marka ayrımının tek kaynağı.
import officeKindJs from '../../office-kind.js';

const { isPureBrandOffice } = officeKindJs;

const SUBJECT_TYPES = new Set(['architect', 'office', 'project', 'product']);
const METRICS = new Set(['view', 'search_impression']);
// Tek istekte kabul edilen en fazla olay — arama sonucu sayfası bir defada en çok birkaç düzine
// kart gösterir (bkz. arama.html#MAX_PER_GROUP), 60 fazlasıyla yeter ve kötü niyetli tek bir
// isteğin binlerce satır yazmasını engeller.
const MAX_EVENTS_PER_CALL = 60;

export async function handleAnalyticsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api","analytics",...]
  if (segments[2] === 'track' && request.method === 'POST') return trackEvents(request, env);
  if (segments[2] === 'summary' && request.method === 'GET') return summary(request, env, url);
  return errorJson('Bulunamadı', 404);
}

// ---------------------------------------------------------------------------------------------
// YAZMA — POST /api/analytics/track
// ---------------------------------------------------------------------------------------------
// Oturum GEREKMEZ: görüntülenmelerin çoğu giriş yapmamış ziyaretçilerden gelir, oturum şartı
// koymak metriği anlamsız kılardı. Buna karşılık:
//   * IP başına dakikalık sınır (checkRateLimit) — tek kaynaktan sayaç şişirmeyi sınırlar,
//   * istemci tarafında oturum başına tekilleştirme (bkz. js/analytics-beacon.js) — F5/geri-ileri
//     aynı görüntülenmeyi tekrar saymaz,
//   * yalnızca bilinen tür/metrik ve makul uzunlukta slug kabul edilir.
// Var olmayan bir slug için satır yazılması zararsızdır: okuma yolu sahiplik JOIN'i yaptığından
// hiçbir kullanıcının raporunda görünmez (ve doğrulamak için her olayda ek D1 okuması gerekirdi).
async function trackEvents(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  // checkRateLimit düz bir boolean döner (bkz. src/lib/rateLimit.js) — sınır aşılırsa false.
  if (!await checkRateLimit(env, 'analytics-track', ip, 120, 60_000)) {
    return errorJson('Çok fazla istek. Biraz sonra tekrar dene.', 429);
  }

  const body = await readJson(request);
  const events = Array.isArray(body && body.events) ? body.events.slice(0, MAX_EVENTS_PER_CALL) : [];
  if (!events.length) return json({ ok: true, written: 0 });

  const day = utcDay(Date.now());
  // Aynı çağrıdaki tekrarlar (ör. bir listede aynı kart iki kez) burada birleştirilir — böylece
  // batch içinde AYNI birincil anahtara iki UPSERT gitmez.
  const buckets = new Map();
  for (const e of events) {
    const type = String((e && e.type) || '');
    const key = String((e && e.key) || '').trim();
    const metric = String((e && e.metric) || 'view');
    if (!SUBJECT_TYPES.has(type) || !METRICS.has(metric)) continue;
    if (!key || key.length > 200) continue;
    // denetim bulgusu (2026-09-05): birleştirme anahtarı HAM BİR NUL BAYTIYLA birleştirilmiş bir
    // metin olarak üretilip aşağıda id.split(NUL) ile geri ayrıştırılıyordu. İki ayrı sorun:
    //   1) `key` istemciden gelen (yalnızca uzunluğu sınırlanan) bir değerdir; içinde bir NUL
    //      taşırsa (JSON'da "a\u0000b" tamamen geçerlidir) ayrıştırma kayar ve yukarıdaki METRICS
    //      beyaz listesi ATLANARAK analytics_daily'ye keyfi bir `metric` yazılabilir; subject_key de
    //      ilk NUL'da kırpılır. Uç oturum gerektirmediğinden bu, anonim bir istekle tetiklenebilirdi.
    //   2) Kaynak dosyadaki ham NUL baytı, dosyayı POSIX `grep` için İKİLİ (binary) yapar — bu
    //      depoda gerçekten yaşandı: `grep` bu dosyada HİÇBİR eşleşme döndürmedi ve bir denetim
    //      turunda "analytics.js'te rate limit yok" şeklinde YANLIŞ bir sonuca götürdü (yalnızca
    //      ripgrep doğru sonucu veriyordu).
    // Çözüm: doğrulanmış üçlü hiç metne çevrilmeden Map DEĞERİNDE taşınır; anahtar yalnızca aynı
    // istek içindeki tekrarları birleştirmek içindir ve bir daha ayrıştırılmaz.
    const id = JSON.stringify([type, key, metric]);
    const bucket = buckets.get(id);
    if (bucket) bucket.n += 1;
    else buckets.set(id, { type, key, metric, n: 1 });
  }
  if (!buckets.size) return json({ ok: true, written: 0 });

  const stmt = env.DB.prepare(
    `INSERT INTO analytics_daily (day, subject_type, subject_key, metric, count) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(day, subject_type, subject_key, metric) DO UPDATE SET count = count + excluded.count`
  );
  // batch(): tüm UPSERT'ler TEK D1 round-trip'inde gider (bkz. rateLimit.js'teki aynı "round-trip
  // sayısını düşür" gerekçesi).
  await env.DB.batch([...buckets.values()].map(({ type, key, metric, n }) =>
    stmt.bind(day, type, key, metric, n)
  ));
  return json({ ok: true, written: buckets.size });
}

// ---------------------------------------------------------------------------------------------
// OKUMA — GET /api/analytics/summary?range=7d|30d|90d|12m|all
// ---------------------------------------------------------------------------------------------
const RANGES = {
  '7d': { days: 7, granularity: 'day' },
  '30d': { days: 30, granularity: 'day' },
  '90d': { days: 90, granularity: 'day' },
  '12m': { days: 365, granularity: 'month' },
  'all': { days: null, granularity: 'month' },
};

// Yanıt ASLA paylaşılan bir önbelleğe girmemeli: kullanıcıya özel veri (bkz. kullanıcı isteği:
// "kullanıcılar arasında veri sızıntısı kesinlikle olmasın"). private + no-store, ayrıca Vary:Cookie
// — cachedPublicJson'ın caches.default yoluna HİÇ girmez, bu uç onu zaten kullanmıyor.
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Cookie' };

async function summary(request, env, url) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401, PRIVATE_HEADERS);
  if (!await hasAnalyticsAccess(env, user.id)) {
    return errorJson('Bu özellik yalnızca Altın Üye rozetine sahip üyeler içindir.', 403, PRIVATE_HEADERS);
  }

  const rangeKey = RANGES[url.searchParams.get('range')] ? url.searchParams.get('range') : '30d';
  const range = RANGES[rangeKey];
  const now = Date.now();
  // since: 'YYYY-MM-DD'. 'all' için 1970 — tüm satırları kapsar ve sorgular tek bir kod yolunda kalır
  // (ayrı bir "WHERE yok" dalı yazmaya gerek yok).
  const since = range.days ? utcDay(now - (range.days - 1) * 86_400_000) : '1970-01-01';
  const sinceMs = range.days ? Date.parse(since + 'T00:00:00Z') : 0;

  const owned = await resolveOwnedSubjects(env, user.id);
  // Profil anahtarları İKİ biçimde aranır: canonical `slug` (analytics_daily ve URL'ler bunu
  // kullanır) ve slugify(name) (saved_items/follows tarihsel olarak bunu yazmış — canlıda
  // doğrulandı: item_key 'emre-arolat'). İkisi çoğu profilde aynıdır; farklı olduğu satırlar
  // sessizce kaybolmasın diye birleşim alınır.
  const profileSlugs = uniq([
    ...owned.architects.map(a => a.slug), ...owned.architects.map(a => slugify(a.name)),
    ...owned.offices.map(o => o.slug), ...owned.offices.map(o => slugify(o.name)),
  ]);
  const architectKeys = uniq([...owned.architects.map(a => a.slug), ...owned.architects.map(a => slugify(a.name))]);
  const officeKeys = uniq([...owned.offices.map(o => o.slug), ...owned.offices.map(o => slugify(o.name))]);
  const projectSlugs = owned.projectSlugs;
  const productSlugs = owned.productSlugs;

  const hasAnything = profileSlugs.length || projectSlugs.length || productSlugs.length;

  const J = arr => JSON.stringify(arr);
  const bucketExpr = range.granularity === 'month' ? "substr(day, 1, 7)" : 'day';

  // TEK batch — tüm okuma sorguları bir D1 round-trip'inde gider.
  const [viewTotals, trendRows, topViewed, savedRows, topSaved, followRows, msgRows, senderRows, firstDayRow] =
    await env.DB.batch([
      // 1) analytics_daily toplamları: metrik + varlık türü kırılımı (profil görüntülenmesi, arama
      //    gösterimi, proje/ürün görüntülenmesi hepsi bu tek sorgudan çıkar).
      env.DB.prepare(
        `SELECT subject_type, metric, SUM(count) AS total FROM analytics_daily
         WHERE day >= ?1 AND (
           (subject_type IN ('architect','office') AND subject_key IN (SELECT value FROM json_each(?2)))
           OR (subject_type = 'project' AND subject_key IN (SELECT value FROM json_each(?3)))
           OR (subject_type = 'product' AND subject_key IN (SELECT value FROM json_each(?4)))
         ) GROUP BY subject_type, metric`
      ).bind(since, J(profileSlugs), J(projectSlugs), J(productSlugs)),
      // 2) Trend kovaları — yalnızca 'view' metriği (grafik "görüntülenme" eğrisini gösterir).
      env.DB.prepare(
        `SELECT ${bucketExpr} AS bucket,
                SUM(CASE WHEN subject_type IN ('architect','office') THEN count ELSE 0 END) AS profile_views,
                SUM(CASE WHEN subject_type IN ('project','product') THEN count ELSE 0 END) AS content_views
         FROM analytics_daily
         WHERE day >= ?1 AND metric = 'view' AND (
           (subject_type IN ('architect','office') AND subject_key IN (SELECT value FROM json_each(?2)))
           OR (subject_type = 'project' AND subject_key IN (SELECT value FROM json_each(?3)))
           OR (subject_type = 'product' AND subject_key IN (SELECT value FROM json_each(?4)))
         ) GROUP BY bucket ORDER BY bucket`
      ).bind(since, J(profileSlugs), J(projectSlugs), J(productSlugs)),
      // 3) En çok görüntülenen içerikler (proje + ürün birlikte, ilk 8).
      env.DB.prepare(
        `SELECT subject_type, subject_key, SUM(count) AS total FROM analytics_daily
         WHERE day >= ?1 AND metric = 'view' AND (
           (subject_type = 'project' AND subject_key IN (SELECT value FROM json_each(?2)))
           OR (subject_type = 'product' AND subject_key IN (SELECT value FROM json_each(?3)))
         ) GROUP BY subject_type, subject_key ORDER BY total DESC LIMIT 8`
      ).bind(since, J(projectSlugs), J(productSlugs)),
      // 4) Kaydetmeler — saved_items zaten created_at taşıdığından GEÇMİŞ veri de gelir.
      env.DB.prepare(
        `SELECT item_type, COUNT(*) AS total FROM saved_items
         WHERE created_at >= ?1 AND (
           (item_type IN ('architect','office') AND item_key IN (SELECT value FROM json_each(?2)))
           OR (item_type = 'project' AND item_key IN (SELECT value FROM json_each(?3)))
           OR (item_type IN ('product','material') AND item_key IN (SELECT value FROM json_each(?4)))
         ) GROUP BY item_type`
      ).bind(sinceMs, J(profileSlugs), J(projectSlugs), J(productSlugs)),
      // 5) En çok kaydedilen içerikler.
      env.DB.prepare(
        `SELECT item_type, item_key, COUNT(*) AS total FROM saved_items
         WHERE created_at >= ?1 AND (
           (item_type = 'project' AND item_key IN (SELECT value FROM json_each(?2)))
           OR (item_type IN ('product','material') AND item_key IN (SELECT value FROM json_each(?3)))
         ) GROUP BY item_type, item_key ORDER BY total DESC LIMIT 8`
      ).bind(sinceMs, J(projectSlugs), J(productSlugs)),
      // 6) Yeni takipçiler.
      env.DB.prepare(
        `SELECT COUNT(*) AS total FROM follows
         WHERE created_at >= ?1 AND followed_type IN ('architect','office')
           AND followed_key IN (SELECT value FROM json_each(?2))`
      ).bind(sinceMs, J(profileSlugs)),
      // 7) Alınan mesajlar + benzersiz gönderenler. Alıcılık message_thread_recipients'tan gelir
      //    (bkz. src/routes/messages.js#resolveRecipients) — kullanıcının KENDİ gönderdiği mesajlar
      //    (m.sender_user_id = kendisi) sayılmaz.
      env.DB.prepare(
        `SELECT COUNT(*) AS total, COUNT(DISTINCT m.sender_user_id) AS senders
         FROM messages m
         JOIN message_thread_recipients r ON r.thread_id = m.thread_id
         WHERE r.user_id = ?1 AND m.sender_user_id != ?1 AND m.created_at >= ?2`
      ).bind(user.id, sinceMs),
      // 8) Gönderenlerin ANONİM meslek/kurum dağılımı — kimlik döndürülmez, yalnızca kova sayıları.
      //    profession users tablosundan, kurum türü ise gönderenin ONAYLI firma talebindeki firmanın
      //    `cats` alanından çözülür (bkz. aşağıdaki isPureBrandOffice sınıflandırması).
      env.DB.prepare(
        `SELECT DISTINCT m.sender_user_id AS uid, u.profession AS profession
         FROM messages m
         JOIN message_thread_recipients r ON r.thread_id = m.thread_id
         JOIN users u ON u.id = m.sender_user_id
         WHERE r.user_id = ?1 AND m.sender_user_id != ?1 AND m.created_at >= ?2`
      ).bind(user.id, sinceMs),
      // 9) Görüntülenme sayacının GERÇEKTEN ne zaman başladığı — UI "bu tarihten beri toplanıyor"
      //    notunu bundan yazar (özellik yeni açıldığı için eski dönemlerde view verisi YOKTUR ve
      //    bunu gizlemek yanıltıcı olurdu).
      env.DB.prepare(`SELECT MIN(day) AS first_day FROM analytics_daily`),
    ]);

  const vt = (type, metric) => {
    const row = (viewTotals.results || []).find(r => r.subject_type === type && r.metric === metric);
    return row ? Number(row.total) || 0 : 0;
  };
  const profileViews = vt('architect', 'view') + vt('office', 'view');
  const searchImpressions = vt('architect', 'search_impression') + vt('office', 'search_impression');
  const projectViews = vt('project', 'view');
  const productViews = vt('product', 'view');

  const savedBy = t => {
    const rows = (savedRows.results || []).filter(r => t.includes(r.item_type));
    return rows.reduce((n, r) => n + (Number(r.total) || 0), 0);
  };
  const profileSaves = savedBy(['architect', 'office']);
  const projectSaves = savedBy(['project']);
  const productSaves = savedBy(['product', 'material']);

  const newFollowers = Number((followRows.results || [])[0]?.total) || 0;
  const messagesReceived = Number((msgRows.results || [])[0]?.total) || 0;
  const uniqueSenders = Number((msgRows.results || [])[0]?.senders) || 0;

  const orgTypes = await senderOrgTypes(env, (senderRows.results || []).map(r => r.uid));
  const professions = countLabels((senderRows.results || []).flatMap(r => splitProfessions(r.profession)));

  // Başlıklar: en çok görüntülenen/kaydedilen listelerinde slug yerine gerçek ad gösterilir.
  const titles = await lookupTitles(env, [...(topViewed.results || []), ...(topSaved.results || [])]);
  const shapeTop = rows => (rows || []).map(r => {
    const type = r.subject_type || (r.item_type === 'material' ? 'product' : r.item_type);
    const key = r.subject_key || r.item_key;
    return { type, key, title: titles.get(JSON.stringify([type, key])) || key, count: Number(r.total) || 0 };
  });

  return json({
    range: rangeKey,
    since: range.days ? since : null,
    granularity: range.granularity,
    hasOwnedContent: !!hasAnything,
    // İzlemenin başladığı gün — istemci "daha eski dönemler için görüntülenme verisi yok" uyarısını
    // buna göre gösterir (bkz. kullanıcı isteği: tahmini/sahte veri gösterme).
    viewTrackingSince: (firstDayRow.results || [])[0]?.first_day || null,
    profile: { views: profileViews, searchImpressions, saves: profileSaves, newFollowers },
    content: {
      projectViews, productViews, projectSaves, productSaves,
      ownedProjects: projectSlugs.length, ownedProducts: productSlugs.length,
      topViewed: shapeTop(topViewed.results), topSaved: shapeTop(topSaved.results),
    },
    messages: {
      received: messagesReceived,
      uniqueSenders,
      // Dönüşüm oranı: profil görüntülenmesi başına mesaj yazan BENZERSİZ kişi. Payda 0 ise oran
      // hesaplanmaz (null döner) — 0'a bölmek yerine UI "—" gösterir, uydurma bir sayı üretilmez.
      profileToMessageRate: profileViews > 0 ? Math.round((uniqueSenders / profileViews) * 1000) / 10 : null,
      professions,
      orgTypes,
    },
    trend: (trendRows.results || []).map(r => ({
      bucket: r.bucket,
      profileViews: Number(r.profile_views) || 0,
      contentViews: Number(r.content_views) || 0,
    })),
  }, 200, PRIVATE_HEADERS);
}

// ---------------------------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------------------------
function utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }

// architects.profession gibi users.profession de virgülle ayrılmış BİRDEN ÇOK etiket taşıyabilir
// (bkz. src/routes/architect.js#professionLabelList) — her etiket kendi kovasına sayılır.
function splitProfessions(value) {
  const list = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : ['Belirtilmemiş'];
}

function countLabels(labels) {
  const counts = new Map();
  for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'tr'));
}

// Gönderenlerin "kurum türü" — UYDURULMAZ, gönderenin kendi ONAYLI firma talebinden çözülür:
//   * onaylı bir firma profili var ve o firma saf üretici/marka ise  -> "Marka"
//   * onaylı bir firma profili var (mimarlık hizmeti veriyor)        -> "Firma"
//   * yalnızca onaylı bir kişi profili var                            -> "Bireysel"
//   * hiçbiri                                                        -> "Belirtilmemiş"
// Kimlik döndürülmez; yalnızca kova adı + sayı.
async function senderOrgTypes(env, senderIds) {
  const ids = uniq(senderIds);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  // BU ALT SORGUYU src/lib/officeProductCounts.js İLE DEĞİŞTİRMEYİN — ölçüldü, EŞDEĞER DEĞİLLER
  // (hardening denetimi, 2026-09-07). İkisi ilk bakışta aynı görünür ama buradaki `hidden_at IS NULL`
  // koşulunu TAŞIMAZ, o modüldeki taşır. Canlı veride fark iki ofiste ortaya çıkıyor
  // (+MURAT TABANLIOĞLU STUDIO ve Marshall: burada 1, havuzda 0) ve fark tam da isPureBrandOffice'in
  // eşiğine denk geliyor — yani naif bir "tek kaynağa taşıyalım" refactor'ü bu iki ofisin analitik
  // etiketini sessizce "Marka"dan "Firma"ya çevirirdi. Hangi davranışın DOĞRU olduğu ayrı bir ürün
  // kararıdır (gizli bir ürün markalığa sayılmalı mı?); burada bilerek DEĞİŞTİRİLMEDİ.
  //
  // Performans gerekçesi de yok: officeProductCounts.js'teki toplu biçim ofis havuzu için şarttı
  // (orada ofis BAŞINA tam tarama = 598.715 satır / 1.048 ms), ama bu sorgu yalnızca ONAYLI
  // profile_claims satırlarıyla sınırlı — canlıda ölçüldü: 4.565 satır / 9,5 ms (6 claim).
  const { results } = await env.DB.prepare(
    `SELECT pc.user_id, pc.profile_type, o.cats AS cats,
            (SELECT COUNT(*) FROM products pr WHERE pr.deleted_at IS NULL
               AND (pr.brand_office_id = o.id OR pr.brand_name_raw = o.name COLLATE NOCASE)) AS product_count
     FROM profile_claims pc
     LEFT JOIN offices o ON pc.profile_type = 'office' AND o.name = pc.profile_key AND o.deleted_at IS NULL
     WHERE pc.user_id IN (${placeholders}) AND pc.status = 'approved'`
  ).bind(...ids).all();

  const byUser = new Map();
  for (const row of results || []) {
    const current = byUser.get(row.user_id);
    if (row.profile_type === 'office') {
      let cats = null;
      try { cats = row.cats ? JSON.parse(row.cats) : null; } catch { cats = null; }
      const label = isPureBrandOffice(cats, Number(row.product_count) || 0) ? 'Marka' : 'Firma';
      byUser.set(row.user_id, label); // firma/marka her zaman bireyselin önüne geçer
      continue;
    }
    if (!current) byUser.set(row.user_id, 'Bireysel');
  }
  const labels = ids.map(id => byUser.get(id) || 'Belirtilmemiş');
  return countLabels(labels);
}

// En çok görüntülenen/kaydedilen listelerindeki slug'ları gerçek başlığa çevirir — iki sorgu
// (projects + products), liste uzunluğu ne olursa olsun sabit.
async function lookupTitles(env, rows) {
  const projectKeys = uniq(rows.filter(r => (r.subject_type || r.item_type) === 'project').map(r => r.subject_key || r.item_key));
  const productKeys = uniq(rows.filter(r => ['product', 'material'].includes(r.subject_type || r.item_type)).map(r => r.subject_key || r.item_key));
  const map = new Map();
  const statements = [];
  if (projectKeys.length) statements.push(['project', env.DB.prepare(`SELECT slug, title FROM projects WHERE slug IN (${projectKeys.map(() => '?').join(',')})`).bind(...projectKeys)]);
  if (productKeys.length) statements.push(['product', env.DB.prepare(`SELECT slug, title FROM products WHERE slug IN (${productKeys.map(() => '?').join(',')})`).bind(...productKeys)]);
  if (!statements.length) return map;
  const out = await env.DB.batch(statements.map(s => s[1]));
  out.forEach((res, i) => {
    const type = statements[i][0];
    for (const row of res.results || []) map.set(JSON.stringify([type, row.slug]), row.title);
  });
  return map;
}
