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
// GÜNCELLEME (kullanıcı isteği, 2026-09-10 on birinci tur madde 2): "tıklanamasın" kuralı artık
// YALNIZCA PROJE ve ÜRÜN kartları için geçerli. Kişi/firma/marka önizleme kartları soluk/blurlu
// görünmeye devam eder ama AÇILABİLİR — popup içindeki görseller blurlu kalır (bkz.
// js/components/modal-shell.js#setPreviewBlur) ve kullanıcı sahiplenme talebini popup'taki
// "Bu profil/firma sana mı ait?" kutusundan gönderir.
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

  // KİLİTLİ (tıklanamaz) önizleme kartlarının başlık ipucu. Yalnızca proje/ürün kartlarına yazılır
  // — kişi/firma/marka kartları artık açılabildiğinden onlarda yanlış bilgi olurdu (bkz. markAll).
  var LOCKED_TITLE = 'Bu içerik önizleme modunda — henüz yayında değil.';

  // Bu adres bir KİŞİ/FİRMA/MARKA profiline mi gidiyor? (kullanıcı isteği, 2026-09-10 on birinci tur
  // madde 2: "Blurlu kişi, firma ve marka popupları açılabilir olsun, kilitlerini kaldır ... Hâli
  // hazırdaki blurlu projeler ve ürünler ... kilitli ve blurlu kalmaya devam etsin.")
  // '/proje/' de AÇILABİLİR (aynı turun madde 7'si): önizleme projesi popup'ta görselleri blurlu ve
  // medyası kilitli açılır (bkz. project-modal.js#renderItem). Yalnızca ÜRÜN kartı kilitli kalır.
  var PROFILE_PREFIXES = ['/kisi/', '/firma/', '/marka/', '/proje/'];
  function isProfileKey(key) {
    for (var i = 0; i < PROFILE_PREFIXES.length; i++) if (key.indexOf(PROFILE_PREFIXES[i]) === 0) return true;
    return false;
  }

  // Sahiplenilmemiş FOTOĞRAFÇI profilleri (kullanıcı isteği, 2026-09-10 on birinci tur madde 7:
  // "profilini henüz sahiplenmeyen fotoğrafçı profil fotoğraflarını da blurla"): /api/public/preview
  // #photographerBlur'daki slug'lar; bu kişilere giden her kartın/çipin GÖRSELİ blurlanır — kartın
  // kendisi soluklaşmaz ve tıklanabilir kalır (profil yayında, yalnızca fotoğrafı korunuyor).
  var blurPhotoHrefs = null; // Set<string> — "/kisi/slug"

  function injectStyles() {
    if (document.getElementById('preview-cards-styles')) return;
    var el = document.createElement('style');
    el.id = 'preview-cards-styles';
    el.textContent = [
      /* Kart TAMAMEN kaybolmaz, "önizleme" olduğu belli olacak kadar soluklaşır. Kilitli (proje/
         ürün) kartlarda tıklama alınır ama hiçbir şey yapmaz — kök elemanda pointer-events:none
         kullanılmaz, o zaman imleç bile değişmez ve kullanıcı kartın neden tepkisiz olduğunu
         anlamazdı (cursor:pointer + başlık ipucu daha açık). Profil kartlarında (kişi/firma/marka)
         aynı imleç gerçekten çalışır: kart normal şekilde açılır. */
      /* TON (kullanıcı isteği, 2026-09-10: "Blurlama tonunu birazcık daha arttır. Telif hakkı
         doğmasın."): asıl telif riski GÖRSELDE olduğundan görsele GERÇEK bir blur uygulanır —
         yalnızca opacity düşürmek görseli hâlâ okunabilir/kullanılabilir bırakırdı. Metin
         (başlık/altyazı) blurlanmaz, yalnızca soluklaşır: kullanıcı kaydın NE olduğunu görebilmeli,
         sadece görselden yararlanamamalı. */
      '.ml-preview-card{opacity:.62; cursor:pointer;}',
      /* Görsel, bağlantının İÇİNDE olmayabilir: liste sayfalarında kart yapısı
         .content-card > (.content-card-photo > img) + (.content-card-title > a) biçimindedir, yani
         <a> yalnızca BAŞLIK bağlantısıdır. Bu yüzden sınıf KART KAPSAYICISINA uygulanır (bkz.
         #cardRootFor) ve blur oradan aşağı iner — aksi halde ürün/proje listelerinde metin
         soluklaşıyor ama GÖRSEL net kalıyordu (kullanıcı bulgusu: "ürünleri blurlamamışsın"). */
      '.ml-preview-card img, .ml-preview-card .related-card-placeholder, .ml-preview-card [style*="background-image"]{',
      '  filter:blur(9px) grayscale(.5); transform:scale(1.06);',
      '}',
      '.ml-preview-card:hover{opacity:.72;}',
      /* KİLİTLİ kartlar (proje + ürün): kart içindeki alt butonlar (kaydet/paylaş) da devre dışı
         görünsün — tıklama zaten yakalama fazında durduruluyor (bkz. #guard).
         KİLİT ARTIK YALNIZCA PROJE VE ÜRÜNDE (kullanıcı isteği, 2026-09-10 on birinci tur madde 2):
         kişi/firma/marka önizleme kartları açılabilir olmalı — bunlar `ml-preview-locked` sınıfını
         ALMAZ, yani soluk/blurlu görünür ama normal kart gibi tıklanıp popup açar. Popupta
         görsellerin blurlu kalması modal tarafında yapılır (bkz. modal-shell.js#setPreviewBlur). */
      '.ml-preview-locked *{pointer-events:none;}',
      /* Fotoğrafçı bluru — yalnızca görsel; opacity/pointer-events yok. Aynı ton (bkz. yukarısı). */
      '.ml-photo-blur img{filter:blur(9px) grayscale(.5); transform:scale(1.06);}',
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
      /* BAŞARI durumu (kullanıcı isteği, 2026-09-10): talep gönderildikten sonra not kutusu
         kapanır ve mesaj YEŞİL görünür — kırmızımsı ceviz tonu hata mesajlarına ayrılır. */
      '.ml-claim-pop-msg.ok{color:#1a7f37; font-weight:600;}',
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
    if (!(previewHrefs && previewHrefs.size) && !(blurPhotoHrefs && blurPhotoHrefs.size)) return;
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
      if (blurPhotoHrefs && blurPhotoHrefs.has(key)) cardRootFor(a).classList.add('ml-photo-blur');
      if (!previewHrefs || !previewHrefs.has(key)) continue;
      var cardRoot = cardRootFor(a);
      cardRoot.classList.add('ml-preview-card');
      // Hedef adres kapsayıcıda saklanır — hangi kaydın önizleme olduğu DOM'dan okunabilsin diye
      // (hata ayıklama + ileride kart üzerinde rozet/etiket basmak isteyen kod için tek kaynak).
      cardRoot.dataset.mlPreviewHref = key;
      // PROFİL kartları (kişi/firma/marka) artık AÇILABİLİR — yalnızca proje/ürün kilitli kalır
      // (kullanıcı isteği, 2026-09-10 on birinci tur madde 2). Kilitli olmayan kartta aria-disabled
      // ve "tıklanamaz" ipucu yanlış bilgi verirdi, bu yüzden ikisi de yalnızca kilitli dalda yazılır.
      if (isProfileKey(key)) {
        cardRoot.removeAttribute('aria-disabled');
        if (cardRoot.getAttribute('title') === LOCKED_TITLE) cardRoot.removeAttribute('title');
        continue;
      }
      cardRoot.classList.add('ml-preview-locked');
      cardRoot.setAttribute('aria-disabled', 'true');
      if (!cardRoot.getAttribute('title')) cardRoot.setAttribute('title', LOCKED_TITLE);
    }
  }

  function isRelevantKey(key) {
    for (var k in PREFIX_BY_KIND) {
      var prefixes = PREFIX_BY_KIND[k];
      for (var j = 0; j < prefixes.length; j++) if (key.indexOf(prefixes[j]) === 0) return true;
    }
    return false;
  }

  function countRelevantLinks(el) {
    var links = el.querySelectorAll('a[href]');
    var n = 0;
    for (var i = 0; i < links.length; i++) {
      var key = hrefKey(links[i].getAttribute('href'));
      if (key && isRelevantKey(key)) n++;
      if (n > 1) return n;
    }
    return n;
  }

  // Bağlantıdan KART KAPSAYICISINA çıkar. İki nedenle şart:
  //   1) Görsel çoğu liste sayfasında <a>'nın DIŞINDA (bkz. CSS notu) — blur oradan uygulanmalı.
  //   2) Kartın TIKLAMA İŞLEYİCİSİ de kapsayıcıda (ör. /urun'de .content-card cursor:pointer ile
  //      popup açıyor), yani yalnızca <a>'yı engellemek kartı açmayı DURDURMUYORDU.
  // En fazla 4 seviye çıkılır ve kapsayıcı BİRDEN FAZLA detay bağlantısı taşımamalı — aksi halde
  // tüm ızgara tek bir "kart" sanılıp sayfanın tamamı blurlanırdı.
  function cardRootFor(a) {
    var el = a;
    var best = a;
    for (var hops = 0; hops < 4 && el && el.parentElement; hops++) {
      el = el.parentElement;
      if (!el.querySelectorAll || el === document.body) break;
      if (countRelevantLinks(el) > 1) break;
      best = el;
      if (el.querySelector('img')) break; // görseli kapsayan ilk ata yeterli
    }
    return best;
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

  // PROFİL SAHİPLENME MİNİ POPUP'I ARTIK ÖNİZLEME KARTINDAN AÇILMIYOR (kullanıcı isteği, 2026-09-10
  // on birinci tur madde 2: "artık önizleme tıklayınca çıkan küçük popup olmasın, kullanıcı açılan
  // kişi, firma veya marka popupından 'Bu firma sana mı ait?' butonundan sahiplenme talebi
  // göndersin"). Kişi/firma/marka önizleme kartları normal kart gibi açılıyor ve talep, popupun
  // içindeki paylaşılan claim kutusundan gönderiliyor (bkz. js/components/claim-correction-box.js).
  //
  // openClaimPopup/MLClaimPopup yine de KALDI: kişi/firma/marka EKLE formlarındaki "bu profil zaten
  // kayıtlı" uyarısı hâlâ bu kutuyu açıyor (bkz. js/components/duplicate-name-check.js) — tek kaynak
  // olarak burada durur, stilleri de (injectStyles) buradan gelir.

  function closePop() {
    var el = document.querySelector('.ml-claim-pop-overlay');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // opts: { profileType, profileKey, title, description }
  //   profileKey — POST /api/claims'e gönderilecek anahtar. ÖNİZLEME kartlarından slug gelir;
  //   sunucu onu canonical ada çevirip öyle yazar (bkz. src/lib/canonicalRead.js#
  //   resolveCanonicalName), yani buradan slug göndermek artık görünmez bir sahiplik satırı
  //   ÜRETMEZ. Yeni çağıranlar yine de elindeki canonical adı göndermelidir.
  function openClaimPopup(opts) {
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
    overlay.querySelector('h2').textContent = opts.title;
    overlay.querySelector('p').textContent = opts.description;
    document.body.appendChild(overlay);

    var msg = overlay.querySelector('.ml-claim-pop-msg');
    function say(text, ok) {
      msg.textContent = text;
      msg.classList.toggle('ok', !!ok);
      msg.hidden = false;
    }

    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay || ev.target.getAttribute('data-act') === 'cancel') { closePop(); return; }
      if (ev.target.getAttribute('data-act') !== 'send') return;
      var btn = ev.target;
      btn.disabled = true;
      btn.textContent = 'Gönderiliyor…';
      fetch('/api/claims', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileType: opts.profileType, profileKey: opts.profileKey, note: overlay.querySelector('textarea').value.trim() || null }),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
      }).then(function (res) {
        if (res.status === 401) { say('Talep göndermek için önce giriş yapmalısın.'); btn.disabled = false; btn.textContent = 'Talep Gönder'; return; }
        if (!res.ok) { say(res.d.error || 'Talep gönderilemedi, tekrar dene.'); btn.disabled = false; btn.textContent = 'Talep Gönder'; return; }
        // Talep alındı: not kutusu artık işe yaramaz (ikinci kez gönderilemez), gizlenir —
        // kullanıcı isteği, 2026-09-10: "gönderildi dedikten sonra yazı yazma kutucuğu kapatılsın".
        var ta = overlay.querySelector('textarea');
        if (ta) ta.hidden = true;
        say('Talebin alındı, onaylandığında hesabım sayfasında bildirim olarak göreceksin.', true);
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
    // Kapsayıcıdan yakalanır, <a>'dan DEĞİL: kartın kendi tıklama işleyicisi de kapsayıcıdadır
    // (bkz. #cardRootFor) — yalnızca bağlantıyı engellemek /urun'de popup'ın açılmasını
    // DURDURMUYORDU.
    //
    // Seçici `.ml-preview-locked` (kullanıcı isteği, 2026-09-10 on birinci tur madde 2): kişi/firma/
    // marka önizleme kartları bu sınıfı ALMAZ, yani buradan hiç geçmez ve normal kart gibi açılır —
    // yalnızca proje ve ürün kartları kilitli kalmaya devam eder.
    var root = e.target && e.target.closest ? e.target.closest('.ml-preview-locked') : null;
    if (!root) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  // Popup'ı DIŞARI AÇ (kullanıcı isteği, 2026-09-10 madde 3): kişi/firma/marka ekle
  // formlarındaki "Bu profil zaten yüklü" uyarısı da aynı sahiplenme kutusunu açar (bkz.
  // js/components/duplicate-name-check.js). Aynı kutunun ikinci bir kopyasını yazmak yerine bu
  // dosya tek kaynak olarak kalır — stiller de (injectStyles) buradan gelir.
  // window'a asılır, top-level `const` DEĞİL (bkz. proje notu: const global'ler window'a YAZILMAZ).
  window.MLClaimPopup = { open: function (opts) { injectStyles(); openClaimPopup(opts); }, close: closePop };

  function start() {
    injectStyles();
    document.addEventListener('click', guard, true);
    document.addEventListener('auxclick', guard, true); // orta tık / yeni sekme
    fetch('/api/public/preview')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        previewHrefs = new Set();
        blurPhotoHrefs = new Set();
        (data.photographerBlur || []).forEach(function (slug) {
          blurPhotoHrefs.add('/kisi/' + encodeURIComponent(slug));
          blurPhotoHrefs.add('/kisi/' + slug);
        });
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
