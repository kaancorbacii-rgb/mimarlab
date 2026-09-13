// SİTE ÇEVİRİSİ — İSTEMCİ (kullanıcı isteği, 2026-09-13 madde 1: "EN'e tıklayınca site
// İngilizce'ye dönsün ve EN yerine burada TR yazsın").
//
// ===============================================================================================
// NEDEN DOM ÇEVİRİSİ, ANAHTAR TABANLI i18n DEĞİL
// ===============================================================================================
// Anahtar tabanlı bir i18n (t('nav.proje')) yalnızca ARAYÜZ metinlerini çevirirdi. Oysa kullanıcının
// istediği "sitedeki İÇERİKLERİ" çevirmek: proje başlıkları, açıklamalar, gündem metinleri, ürün
// künyeleri — bunların hepsi D1'de YALNIZCA Türkçe duruyor ve hiçbir anahtar kataloğunda yeri yok.
// Ayrıca sitedeki metinlerin neredeyse tamamı 40'tan fazla JS bileşeninin şablon dizelerinin İÇİNDE
// üretiliyor; her birini anahtara çevirmek aylık bir iş olurdu ve bir sonraki yeni bileşende yine
// unutulurdu (bkz. js/components/site-chrome.js dosya başındaki AYNI "her sayfa kendi kopyasını
// tutuyordu" gerekçesi).
//
// Bu yüzden çeviri, boyanmış DOM'un ÜSTÜNDE çalışır: metin düğümleri ve çevrilebilir öznitelikler
// toplanır, sunucuya (POST /api/translate) gönderilir, gelen karşılıklarla değiştirilir. Sunucu
// tarafında çeviriler KÜRESEL ve KALICI olarak önbelleklenir (bkz. migrations/0117_translations.sql),
// yani ikinci ziyaretçiden itibaren AI'ya hiç gidilmez.
//
// ===============================================================================================
// MALİYET: TÜRKÇE ZİYARETÇİ İÇİN SIFIR
// ===============================================================================================
// Bu dosya YALNIZCA dil 'en' iken ya da kullanıcı EN'e bastığında yüklenir (bkz. auth-nav.js
// #ensureTranslator). Varsayılan Türkçe ziyaretçi ne bu baytları indirir ne de tek bir istek atar.
//
// ===============================================================================================
// GERİ DÖNÜŞ (TR) SAYFA YENİLEMEDEN
// ===============================================================================================
// Değiştirilen her düğümün ÖZGÜN değeri `touched` listesinde saklanır; TR'ye basıldığında hepsi
// yerine konur. Yeniden yükleme YAPILMAZ — açık bir modal, yarım kalan bir form ya da kaydırma
// konumu dil değiştirdi diye kaybolmamalı.
(function () {
  'use strict';

  var LANG_KEY = 'mimarlab-lang';
  var CACHE_KEY = 'mimarlab-tr-cache-en';
  var COOKIE = 'ml_lang';
  var SUPPORTED = { tr: 1, en: 1 };

  // Sunucu ile AYNI sınır (bkz. src/lib/translateStore.js#MAX_SOURCE_LEN). Bundan uzun bir metin
  // düğümü zaten bir makale gövdesidir; onu tek parça göndermek hem partiyi hem modeli boğar.
  var MAX_TEXT_LEN = 600;
  // Sunucunun tek istekte kabul ettiği dize sayısı (bkz. aiConfig.js#TRANSLATE_MAX_TEXTS_PER_REQUEST).
  var CHUNK = 60;
  // Tek turda toplanacak en fazla İŞ. Karusel/liste sayfaları binlerce düğüm üretebilir; tavan,
  // ilk boyamayı kilitlememek için. Artanlar MutationObserver'ın bir sonraki turunda toplanır.
  var MAX_JOBS_PER_PASS = 600;
  // Yerel önbellekte tutulan en fazla dize. Aşılınca önbellek tamamen atılır (LRU tutmaya değmez:
  // sunucu önbelleği zaten kalıcı, buradaki yalnızca ağ turunu atlatan bir kısayol).
  var MAX_LOCAL_CACHE = 4000;

  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, TEXTAREA: 1,
    CANVAS: 1, IFRAME: 1, SVG: 1, MATH: 1, TEMPLATE: 1,
  };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  // En az bir HARF içermeyen dizeler çevrilmez: "2026", "—", "12 / 48", "•" gibi düğümler için
  // ağa çıkmak saf israftır ve model bazen bunları "yaratıcı" biçimde değiştirir.
  var HAS_LETTER = /[A-Za-zÀ-ÖØ-öø-ÿĀ-ſƀ-ɏ]/;
  // URL/e-posta/dosya adı görünümlü dizeler olduğu gibi kalmalı.
  var LOOKS_TECHNICAL = /^(https?:\/\/|www\.|[^\s@]+@[^\s@]+\.[^\s@]+$|[\w.-]+\.(?:jpe?g|png|webp|svg|pdf|css|js)$)/i;

  var lang = readLang();
  var memory = readLocalCache();     // source -> translated
  var touched = [];                  // {node, kind, attr, original}

  // ZATEN ÇEVRİLDİ İZİ — iki ayrı hatayı birden önler:
  //   (a) SONSUZ DÖNGÜ: kendi yazmalarımız MutationObserver'ı tetikler; iz olmasaydı her tur bir
  //       sonrakini doğurur, İngilizce metin tekrar tekrar "çevrilmeye" gönderilirdi.
  //   (b) İSRAF: aynı düğüm her turda yeniden toplanır ve ağa çıkardı.
  // Değer olarak BİZİM YAZDIĞIMIZ metni saklıyoruz, düz bir "işaretlendi" bayrağı değil: uygulama
  // aynı düğümü yeniden kullanıp içine YENİ Türkçe yazarsa (karusel bir sonraki slayta geçtiğinde
  // tam olarak bu olur) değer artık eşleşmez ve düğüm doğru biçimde yeniden çevrilir.
  var lastTextWrite = new WeakMap();   // textNode -> yazdığımız nodeValue
  var lastAttrWrite = new WeakMap();   // element  -> Map(attrName -> yazdığımız değer)
  var observer = null;
  var applying = false;
  var pending = false;
  var inFlight = new Set();          // ağda olan kaynak dizeler — aynı turda ikinci kez sorulmasın
  var passTimer = null;

  // ---------------------------------------------------------------------------------------------
  // DİL DURUMU
  // ---------------------------------------------------------------------------------------------
  function readLang() {
    var v = null;
    try { v = localStorage.getItem(LANG_KEY); } catch (_) {}
    if (!v) {
      var m = document.cookie.match(/(?:^|;\s*)ml_lang=([^;]+)/);
      if (m) v = decodeURIComponent(m[1]);
    }
    return SUPPORTED[v] ? v : 'tr';
  }

  function persistLang(next) {
    try { localStorage.setItem(LANG_KEY, next); } catch (_) {}
    // Çerez, ileride SSR tarafının da dili bilebilmesi için (bugün okuyan yok). 1 yıl, Lax.
    try {
      document.cookie = COOKIE + '=' + encodeURIComponent(next)
        + ';path=/;max-age=31536000;samesite=lax' + (location.protocol === 'https:' ? ';secure' : '');
    } catch (_) {}
  }

  function readLocalCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return new Map();
      var obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? new Map(Object.entries(obj)) : new Map();
    } catch (_) { return new Map(); }
  }

  function writeLocalCache() {
    try {
      if (memory.size > MAX_LOCAL_CACHE) memory = new Map();
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(memory)));
    } catch (_) { /* kota/özel pencere — önbelleksiz de çalışır */ }
  }

  // ---------------------------------------------------------------------------------------------
  // TOPLAMA
  // ---------------------------------------------------------------------------------------------
  // Sunucudaki normalizasyonun AYNISI olmalı (bkz. src/routes/translate.js) — ayrışırlarsa istemci
  // bir anahtar gönderir, sunucu başka bir anahtara yazar ve önbellek hiç tutmaz.
  function normalizeText(s) { return s.normalize('NFC').trim(); }

  function isTranslatable(s) {
    if (typeof s !== 'string') return false;
    var t = normalizeText(s);
    if (!t || t.length > MAX_TEXT_LEN) return false;
    if (!HAS_LETTER.test(t)) return false;
    if (LOOKS_TECHNICAL.test(t)) return false;
    return true;
  }

  function walk(node, jobs) {
    if (jobs.length >= MAX_JOBS_PER_PASS) return;

    if (node.nodeType === 3) { // metin düğümü
      var raw = node.nodeValue;
      if (!isTranslatable(raw)) return;
      if (lastTextWrite.get(node) === raw) return;   // bizim yazdığımız çeviri — dokunma
      // Kenar boşlukları AYRI tutulur: `"\n      Proje\n    "` düğümünde yalnızca "Proje" çevrilir
      // ve sonuç aynı girinti içine geri yazılır. Aksi halde her çeviri HTML'in boşluk yapısını
      // bozar ve inline elemanlar birbirine yapışırdı.
      var lead = raw.match(/^\s*/)[0];
      var tail = raw.match(/\s*$/)[0];
      jobs.push({ node: node, kind: 'text', source: normalizeText(raw), lead: lead, tail: tail });
      return;
    }

    if (node.nodeType !== 1) return;
    var el = node;
    if (SKIP_TAGS[el.tagName]) return;
    // Çeviri dışında kalması gereken adacıklar: dil düğmesinin kendisi, marka adı, kod örnekleri.
    if (el.hasAttribute('data-no-translate') || el.getAttribute('translate') === 'no') return;

    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var v = el.getAttribute(a);
      if (!isTranslatable(v)) continue;
      var written = lastAttrWrite.get(el);
      if (written && written.get(a) === v) continue;  // bizim yazdığımız çeviri — dokunma
      jobs.push({ node: el, kind: 'attr', attr: a, source: normalizeText(v) });
    }

    for (var c = el.firstChild; c; c = c.nextSibling) walk(c, jobs);
  }

  // ---------------------------------------------------------------------------------------------
  // UYGULAMA
  // ---------------------------------------------------------------------------------------------
  function applyJob(job, translated) {
    if (!translated) return;
    applying = true;
    try {
      if (job.kind === 'text') {
        if (job.node.nodeValue === undefined) return;
        touched.push({ node: job.node, kind: 'text', original: job.node.nodeValue });
        var next = job.lead + translated + job.tail;
        job.node.nodeValue = next;
        lastTextWrite.set(job.node, next);
      } else {
        touched.push({ node: job.node, kind: 'attr', attr: job.attr, original: job.node.getAttribute(job.attr) });
        job.node.setAttribute(job.attr, translated);
        var map = lastAttrWrite.get(job.node);
        if (!map) { map = new Map(); lastAttrWrite.set(job.node, map); }
        map.set(job.attr, translated);
      }
    } finally {
      applying = false;
      // Kendi yazmalarımızın ürettiği mutation kayıtlarını KUYRUKTAN AT. `applying` bayrağı tek
      // başına yetmez: MutationObserver geri çağrısı bir mikro-görevdir, yani biz bayrağı senkron
      // olarak false'a çektikten SONRA çalışır ve yazmalarımızı "yeni içerik" sanardı.
      if (observer) observer.takeRecords();
    }
  }

  // Bir turu çalıştırır: topla → önbellekten karşıla → kalanları sunucudan iste → uygula.
  async function translatePass(root) {
    if (lang !== 'en') return;
    var jobs = [];
    walk(root || document.body, jobs);
    if (!jobs.length) return;

    // Önce yerel bellekten karşılanabilenler — ağa hiç çıkmadan uygulanır.
    var needed = [];
    var neededSet = new Set();
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      var hit = memory.get(job.source);
      if (hit !== undefined) { applyJob(job, hit); continue; }
      if (inFlight.has(job.source)) continue;       // başka bir tur zaten soruyor
      if (!neededSet.has(job.source)) { neededSet.add(job.source); needed.push(job.source); }
    }
    if (!needed.length) return;

    needed.forEach(function (s) { inFlight.add(s); });
    var received = new Map();
    try {
      for (var start = 0; start < needed.length; start += CHUNK) {
        var chunk = needed.slice(start, start + CHUNK);
        var res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: 'en', texts: chunk }),
        });
        if (!res.ok) continue;
        var data = await res.json();
        var map = (data && data.translations) || {};
        for (var key in map) {
          if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
          received.set(key, map[key]);
          memory.set(key, map[key]);
        }
      }
    } catch (_) {
      // Ağ hatası: bu tur çevrilmeden geçer, site Türkçe kalır. Bir sonraki DOM değişiminde
      // (MutationObserver) yeniden denenir.
    } finally {
      needed.forEach(function (s) { inFlight.delete(s); });
    }

    if (!received.size) return;
    writeLocalCache();

    // Yeni gelen çevirileri, BU turda toplanmış ve henüz uygulanmamış işlere yaz. Düğümler bu arada
    // DOM'dan çıkmış olabilir (karusel bir sonraki slayta geçmiş olabilir) — isConnected kontrolü
    // kopmuş düğümlere yazmayı önler.
    for (var j = 0; j < jobs.length; j++) {
      var it = jobs[j];
      var tr = received.get(it.source);
      if (!tr) continue;
      var target = it.kind === 'text' ? it.node.parentNode : it.node;
      if (!target || !target.isConnected) continue;
      applyJob(it, tr);
    }
  }

  function schedulePass() {
    if (lang !== 'en') return;
    if (passTimer) clearTimeout(passTimer);
    // 150ms: karuseller ve modal'lar tek bir etkileşimde onlarca düğüm ekliyor; her biri için ayrı
    // tur açmak yerine sakinleşmeyi bekleyip tek turda toplamak hem ağ isteklerini hem de yeniden
    // boyamayı azaltır.
    passTimer = setTimeout(function () {
      passTimer = null;
      if (pending) return;
      pending = true;
      translatePass(document.body).catch(function () {}).then(function () { pending = false; });
    }, 150);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(function (records) {
      if (applying) return;                       // kendi yazmalarımız yeni tur açmasın
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'childList' && r.addedNodes.length) { schedulePass(); return; }
        if (r.type === 'attributes') { schedulePass(); return; }
      }
    });
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ATTRS,
    });
  }

  function stopObserver() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  function restoreTurkish() {
    applying = true;
    try {
      // Ters sırada: aynı düğüme birden çok kez yazılmışsa (iç içe turlar) en eski değer kazanır.
      for (var i = touched.length - 1; i >= 0; i--) {
        var t = touched[i];
        try {
          if (t.kind === 'text') t.node.nodeValue = t.original;
          else if (t.original === null) t.node.removeAttribute(t.attr);
          else t.node.setAttribute(t.attr, t.original);
        } catch (_) {}
      }
    } finally {
      touched = [];
      applying = false;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // DIŞA AÇIK API — auth-nav.js'teki EN/TR düğmesi buradan sürer.
  // ---------------------------------------------------------------------------------------------
  function apply() {
    if (lang === 'en') {
      document.documentElement.lang = 'en';
      startObserver();
      schedulePass();
      // İlk turu beklemeden de başlat: schedulePass 150ms gecikmeli, ilk boyamada bunu beklemek
      // gereksiz bir gecikme yaratır.
      if (!pending) {
        pending = true;
        translatePass(document.body).catch(function () {}).then(function () { pending = false; });
      }
    } else {
      document.documentElement.lang = 'tr';
      stopObserver();
      restoreTurkish();
    }
    document.dispatchEvent(new CustomEvent('mimarlab:langchange', { detail: { lang: lang } }));
  }

  window.MLTranslate = {
    current: function () { return lang; },
    set: function (next) {
      if (!SUPPORTED[next] || next === lang) return;
      lang = next;
      persistLang(next);
      apply();
    },
    // auth-nav.js dosya yüklendikten SONRA çağırır: kullanıcı EN'e bastığı için yüklendiyse dil
    // zaten 'en' yazılmıştır ve tek yapılacak iş uygulamaktır.
    boot: function () { if (lang === 'en') apply(); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { window.MLTranslate.boot(); });
  } else {
    window.MLTranslate.boot();
  }
})();
