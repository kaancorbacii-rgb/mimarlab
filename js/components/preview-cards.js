// ÖNİZLEME ("soluk") KARTLARI — kullanıcı isteği, 2026-09-10:
// "Arşivlediğin Kişi, firma, marka, ürün ve projeleri canlıya geri al ama bunlar sadece ilgili
//  sayfalarda ve popuplarda önizleme şeklinde soluk olarak görünsünler. Yani üzerlerine
//  tıklanamasın."
//
// NEDEN TEK, MERKEZİ BİR BİLEŞEN (her render noktasına `if (item.preview)` eklemek yerine):
// bu depoda kart basan ~30 ayrı yer var — liste sayfaları (proje/kisi/firma/marka/urun), ana sayfa
// karuseli, popup içindeki şeritler (İlgili Projeler, Şehirdeki Diğer Projeler, Firmanın Diğer
// Ürünleri, Kurucular/Ekip...), arama önerileri, hesabım kutuları. Hepsine tek tek kontrol
// serpiştirmek hem riskli hem de ileride eklenecek YENİ bir render noktasında sessizce unutulur —
// bu, bu depodaki tekrar eden kök nedendir (bkz. proje notu: "doğru yardımcı, kod yolu taşınınca
// bypass edildi"). Bu dosya bunun yerine SONUÇTAKİ DOM'a bakar: hangi bileşen basmış olursa olsun,
// önizleme durumundaki bir kayda giden her bağlantıyı yakalar.
//
// VERİ KAYNAĞI: /api/public/preview (bkz. src/routes/legacyContent.js#handlePublicPreview) —
// /api/public/hidden ile AYNI desen: tek, önbelleklenmiş, herkese açık bir D1 sinyali.
//
// GÜVENLİK NOTU: bu YALNIZCA görsel/etkileşim katmanıdır. Asıl koruma sunucuda: önizleme
// satırlarının hidden_at'i DOLU kalır, dolayısıyla detay uçları 410, sitemap/arama/JSON-LD hariç
// (bkz. migrations/0107_preview_state.sql). Yani bu dosya devre dışı kalsa bile kimse önizleme
// içeriğinin detayına ulaşamaz — burada engellenen yalnızca "ölü bağlantıya tıklama" deneyimidir.
(function () {
  var PREFIX_BY_KIND = {
    projects: ['/proje/'],
    architects: ['/kisi/'],
    // Firma ve marka AYNI offices tablosundan gelir, iki farklı URL öneki taşır (bkz.
    // src/lib/officeUrl.js) — hangi önekin kullanıldığı karta göre değişebildiğinden ikisi de taranır.
    offices: ['/firma/', '/marka/'],
    products: ['/urun/'],
  };

  var previewHrefs = null;   // Set<string> — "/proje/slug" biçiminde
  var pending = false;

  function injectStyles() {
    if (document.getElementById('preview-cards-styles')) return;
    var el = document.createElement('style');
    el.id = 'preview-cards-styles';
    el.textContent = [
      /* Kart TAMAMEN kaybolmaz, "önizleme" olduğu belli olacak kadar soluklaşır ve tıklama alır
         ama hiçbir şey yapmaz (pointer-events:none kullanılmaz: o zaman imleç bile değişmez ve
         kullanıcı kartın neden tepkisiz olduğunu anlamaz — cursor:default + başlık ipucu daha açık). */
      /* TON (kullanıcı isteği, 2026-09-10: "Blurlama tonunu birazcık daha arttır. Telif hakkı
         doğmasın."): asıl telif riski GÖRSELDE olduğundan görsele GERÇEK bir blur uygulanır —
         yalnızca opacity düşürmek görseli hâlâ okunabilir/kullanılabilir bırakırdı. Metin
         (başlık/altyazı) blurlanmaz, yalnızca soluklaşır: kullanıcı kaydın NE olduğunu görebilmeli,
         sadece görselden yararlanamamalı. */
      '.ml-preview-card{opacity:.62; cursor:pointer;}',
      '.ml-preview-card img, .ml-preview-card .related-card-placeholder, .ml-preview-card [style*="background-image"]{',
      '  filter:blur(9px) grayscale(.5); transform:scale(1.06);',
      '}',
      '.ml-preview-card:hover{opacity:.72;}',
      /* Kart içindeki alt butonlar (kaydet/paylaş) da devre dışı görünsün — tıklama zaten
         yakalama fazında durduruluyor (bkz. #guard). */
      '.ml-preview-card *{pointer-events:none;}',
      /* "Bu profil sana mı ait?" mini popup'ı (kullanıcı isteği, 2026-09-10 madde 4). Kendi
         katmanında, sitenin modal kabuğundan BAĞIMSIZ: bu bileşen her sayfada yüklü ve ModalShell
         her sayfada yüklü DEĞİL. */
      '.ml-claim-pop-overlay{position:fixed; inset:0; z-index:9998; background:rgba(20,18,15,.45); display:flex; align-items:center; justify-content:center; padding:20px;}',
      '.ml-claim-pop{background:var(--paper-card, #fff); color:var(--ink, #1d1b18); border-radius:16px; max-width:420px; width:100%; padding:22px 22px 18px; box-shadow:0 24px 60px rgba(0,0,0,.28); font-family:inherit;}',
      '.ml-claim-pop h2{font-size:18px; font-weight:700; margin:0 0 6px;}',
      '.ml-claim-pop p{font-size:13px; line-height:1.55; color:var(--ink-soft, #6b655c); margin:0 0 14px;}',
      '.ml-claim-pop textarea{width:100%; box-sizing:border-box; min-height:74px; padding:10px 12px; border-radius:10px; border:1px solid var(--line, #dcd7cd); background:var(--paper, #fffdf9); font-family:inherit; font-size:13px; color:var(--ink, #1d1b18); resize:vertical;}',
      '.ml-claim-pop-actions{display:flex; gap:10px; justify-content:flex-end; margin-top:14px; align-items:center;}',
      '.ml-claim-pop button{font-family:inherit; font-size:13px; font-weight:600; border-radius:100px; padding:9px 16px; cursor:pointer; border:1px solid var(--line, #dcd7cd); background:transparent; color:var(--ink, #1d1b18);}',
      '.ml-claim-pop button.primary{background:var(--ink, #1d1b18); color:var(--paper-card, #fff); border-color:var(--ink, #1d1b18);}',
      '.ml-claim-pop button[disabled]{opacity:.55; cursor:default;}',
      '.ml-claim-pop-msg{font-size:12.5px; margin:10px 0 0; color:var(--walnut, #7a5c3e);}',
    ].join('\n');
    document.head.appendChild(el);
  }

  function hrefKey(href) {
    if (!href) return null;
    var path;
    try { path = new URL(href, document.baseURI).pathname; } catch (e) { return null; }
    return path.replace(/\/+$/, '');
  }

  function markAll(root) {
    if (!previewHrefs || !previewHrefs.size) return;
    var scope = (root && root.querySelectorAll) ? root : document;
    var links = scope.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.dataset.mlPreviewChecked === '1') continue;
      var key = hrefKey(a.getAttribute('href'));
      if (!key) continue;
      // Yalnızca ilgilendiğimiz önekleri taşıyan bağlantılar işaretlenir (nav/footer bağlantıları
      // boşuna gezilmesin diye ucuz bir ön eleme).
      var relevant = false;
      for (var k in PREFIX_BY_KIND) {
        var prefixes = PREFIX_BY_KIND[k];
        for (var j = 0; j < prefixes.length; j++) { if (key.indexOf(prefixes[j]) === 0) { relevant = true; break; } }
        if (relevant) break;
      }
      if (!relevant) continue;
      a.dataset.mlPreviewChecked = '1';
      if (!previewHrefs.has(key)) continue;
      a.classList.add('ml-preview-card');
      a.setAttribute('aria-disabled', 'true');
      if (!a.getAttribute('title')) a.setAttribute('title', 'Bu içerik önizleme modunda — henüz yayında değil.');
    }
  }

  function scheduleMark() {
    if (pending) return;
    pending = true;
    // Kartlar toplu basılır (innerHTML) — her düğüm için ayrı tarama yapmak yerine tek bir
    // gecikmeli turda bir kez taranır.
    //
    // requestAnimationFrame KULLANILMAZ (gerçek bulgu, canlıda ölçüldü): rAF ARKA PLANDAKİ/gizli
    // sekmede HİÇ çalışmaz. Popup şeritleri (İlgili Projeler vb.) sekme arka plandayken basılırsa
    // işaretleme hiç yapılmıyor, kullanıcı sekmeye döndüğünde önizleme kartları SOLUK OLMADAN ve
    // TIKLANABİLİR görünüyordu (ölçüm: 47 proje bağlantısından yalnızca 6'sı taranmıştı).
    // setTimeout arka planda kısılır ama ÇALIŞIR — bu iş için doğru zamanlayıcı odur.
    setTimeout(function () { pending = false; markAll(document); }, 0);
  }

  // PROFİL SAHİPLENME MİNİ POPUP'I (kullanıcı isteği, 2026-09-10 madde 4): kişi/firma/marka
  // önizleme kartına tıklayınca "Bu profil/firma/marka sana mı ait?" kutusu açılır ve kullanıcı
  // buradan sahiplenme talebi gönderir. PROJE ve ÜRÜN kartlarında böyle bir akış YOKTUR (onların
  // sahipliği künyedeki firma/kişi üzerinden gelir), orada tıklama sessizce engellenmeye devam eder.
  var CLAIM_KIND_BY_PREFIX = {
    '/kisi/': { profileType: 'architect', title: 'Bu profil sana mı ait?', noun: 'profil' },
    '/firma/': { profileType: 'office', title: 'Bu firma sana mı ait?', noun: 'firma' },
    '/marka/': { profileType: 'office', title: 'Bu marka sana mı ait?', noun: 'marka' },
  };

  function claimKindFor(key) {
    for (var prefix in CLAIM_KIND_BY_PREFIX) {
      if (key.indexOf(prefix) === 0) {
        return { cfg: CLAIM_KIND_BY_PREFIX[prefix], slug: decodeURIComponent(key.slice(prefix.length)) };
      }
    }
    return null;
  }

  function closePop() {
    var el = document.querySelector('.ml-claim-pop-overlay');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function openClaimPopup(cfg, slug, label) {
    closePop();
    var overlay = document.createElement('div');
    overlay.className = 'ml-claim-pop-overlay';
    overlay.innerHTML =
      '<div class="ml-claim-pop" role="dialog" aria-modal="true">' +
        '<h2></h2>' +
        '<p></p>' +
        '<textarea placeholder="İstersen kısa bir not ekle (ör. firmadaki görevin)."></textarea>' +
        '<p class="ml-claim-pop-msg" hidden></p>' +
        '<div class="ml-claim-pop-actions">' +
          '<button type="button" data-act="cancel">Vazgeç</button>' +
          '<button type="button" class="primary" data-act="send">Talep Gönder</button>' +
        '</div>' +
      '</div>';
    overlay.querySelector('h2').textContent = cfg.title;
    overlay.querySelector('p').textContent =
      (label ? label + ' — ' : '') + 'Bu ' + cfg.noun + ' şu an önizleme modunda ve yayında değil. Sahibiysen talep gönder; onaylandığında ' + cfg.noun + ' yayına alınır ve düzenleyebilirsin.';
    document.body.appendChild(overlay);

    var msg = overlay.querySelector('.ml-claim-pop-msg');
    function say(text) { msg.textContent = text; msg.hidden = false; }

    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay || ev.target.getAttribute('data-act') === 'cancel') { closePop(); return; }
      if (ev.target.getAttribute('data-act') !== 'send') return;
      var btn = ev.target;
      btn.disabled = true;
      btn.textContent = 'Gönderiliyor…';
      fetch('/api/claims', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileType: cfg.profileType, profileKey: slug, note: overlay.querySelector('textarea').value.trim() || null }),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
      }).then(function (res) {
        if (res.status === 401) { say('Talep göndermek için önce giriş yapmalısın.'); btn.disabled = false; btn.textContent = 'Talep Gönder'; return; }
        if (!res.ok) { say(res.d.error || 'Talep gönderilemedi, tekrar dene.'); btn.disabled = false; btn.textContent = 'Talep Gönder'; return; }
        say('Talebin alındı. Onaylandığında bilgilendirileceksin.');
        btn.textContent = 'Gönderildi';
      }).catch(function () {
        say('Sunucuya ulaşılamadı, tekrar dene.');
        btn.disabled = false; btn.textContent = 'Talep Gönder';
      });
    });
    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') { closePop(); document.removeEventListener('keydown', esc); }
    });
  }

  // Tıklamayı YAKALAMA fazında durdurur: kartın kendi dinleyicisi (ör. proje.html'in popup açan
  // delegated handler'ı) çalışmadan önce. Sayfa geçişi de (varsayılan davranış) engellenir.
  function guard(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !a.classList.contains('ml-preview-card')) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    if (e.type !== 'click') return; // orta tık / yeni sekme: yalnızca engelle, popup açma
    var hit = claimKindFor(hrefKey(a.getAttribute('href')) || '');
    if (hit) openClaimPopup(hit.cfg, hit.slug, (a.textContent || '').trim().slice(0, 60));
  }

  function start() {
    injectStyles();
    document.addEventListener('click', guard, true);
    document.addEventListener('auxclick', guard, true); // orta tık / yeni sekme
    fetch('/api/public/preview')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        previewHrefs = new Set();
        Object.keys(PREFIX_BY_KIND).forEach(function (kind) {
          (data[kind] || []).forEach(function (slug) {
            PREFIX_BY_KIND[kind].forEach(function (prefix) {
              previewHrefs.add(prefix + encodeURIComponent(slug));
              // Bazı render noktaları slug'ı encode ETMEDEN yazıyor — iki biçim de eşlensin.
              previewHrefs.add(prefix + slug);
            });
          });
        });
        markAll(document);
        // Kartlar tembel/asenkron basıldığından (liste sayfalaması, popup şeritleri, sonsuz kaydırma)
        // DOM'u izlemek şart — tek seferlik bir tarama yalnızca ilk ekranı kapsardı.
        if ('MutationObserver' in window) {
          new MutationObserver(scheduleMark).observe(document.documentElement, { childList: true, subtree: true });
        }
      })
      .catch(function () { /* sinyal alınamadıysa kartlar normal görünür — sunucu tarafı koruma zaten yerinde */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
