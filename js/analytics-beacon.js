// Görüntülenme / arama gösterimi sayacı (kullanıcı isteği, 2026-09-04 — Profil İstatistikleri).
// Sunucu tarafı: src/routes/analytics.js#trackEvents, tablo: migrations/0084_analytics_daily.sql.
//
// NEDEN İSTEMCİDEN: sunucudaki detay/liste uçları (/api/architect/:slug vb.) caches.default ve
// tarayıcı önbelleğiyle servis ediliyor — orada saymak hem önbellek HIT'lerini kaçırır hem de
// bot/prefetch isteklerini gerçek görüntülenme sayardı. Buradan sayılan şey GERÇEKTEN açılmış bir
// detay pop-up'ı/sayfası ya da GERÇEKTEN ekrana basılmış bir arama sonucu listesidir.
//
// TEKİLLEŞTİRME: aynı sekme oturumunda (sessionStorage) aynı varlık+metrik ikinci kez sayılmaz —
// F5, geri/ileri tuşu, pop-up'ı kapatıp yeniden açma sayacı şişirmez. Sunucu tarafında ayrıca IP
// başına dakikalık sınır var.
//
// GÖNDERİM: olaylar kısa bir pencerede biriktirilip TEK istekte gönderilir (arama sonucu sayfası
// bir defada onlarca gösterim üretir). Sayfa kapanırken navigator.sendBeacon ile kalan kuyruk da
// gider — fetch() o anda iptal edilirdi.
(function () {
  var ENDPOINT = '/api/analytics/track';
  var FLUSH_MS = 1200;
  var MAX_BATCH = 60;
  var SESSION_PREFIX = 'mlab:an:';

  var queue = [];
  var timer = null;

  // sessionStorage bazı gizli-mod/gömülü tarayıcılarda erişilemez — o durumda tekilleştirme
  // sessizce devre dışı kalır, sayaç yine çalışır (bilerek: ölçüm hiç olmamasındansa biraz
  // gürültülü olması yeğdir, sunucudaki IP sınırı üst sınırı zaten koruyor).
  function seen(id) {
    try {
      var k = SESSION_PREFIX + id;
      if (sessionStorage.getItem(k)) return true;
      sessionStorage.setItem(k, '1');
      return false;
    } catch (e) { return false; }
  }

  function flush(useBeacon) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    var events = queue.splice(0, MAX_BATCH);
    var payload = JSON.stringify({ events: events });
    try {
      if (useBeacon && navigator.sendBeacon) {
        // type: application/json — sunucu readJson ile okuyor; Blob olmadan sendBeacon
        // text/plain gönderir ve request.json() yine çalışır, ama doğru Content-Type daha temiz.
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
        return;
      }
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        // keepalive: sekme kapanırken fetch'in iptal edilmemesi için.
        keepalive: true,
      }).catch(function () { /* ölçüm kaybı kullanıcıyı etkilemez, sessiz geç */ });
    } catch (e) { /* aynı gerekçe */ }
    if (queue.length) schedule();
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; flush(false); }, FLUSH_MS);
  }

  function push(metric, type, key) {
    if (!type || !key) return;
    var id = metric + ':' + type + ':' + key;
    if (seen(id)) return;
    queue.push({ metric: metric, type: type, key: String(key) });
    if (queue.length >= MAX_BATCH) flush(false);
    else schedule();
  }

  // view(type, key) — bir detay pop-up'ı/sayfası açıldığında.
  function view(type, key) { push('view', type, key); }

  // impressions([{type, key}, ...]) — bir arama sonucu listesi ekrana basıldığında. Tek tek
  // çağırmak yerine liste alır: aynı render'daki tüm gösterimler tek istekte gider.
  function impressions(items) {
    (items || []).forEach(function (it) { if (it) push('search_impression', it.type, it.key); });
  }

  // Sekme gizlenince/kapanınca kalanları gönder — pagehide, mobil Safari'de unload'ın
  // tetiklenmediği durumları da kapsar.
  window.addEventListener('pagehide', function () { flush(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
  });

  window.MimarlabAnalytics = { view: view, impressions: impressions };
})();
