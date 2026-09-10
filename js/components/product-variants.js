// ÜRÜN VERSİYONLARI — PAYLAŞILAN MANTIK (kullanıcı isteği, 2026-09-10 on birinci tur madde 2).
//
// Aynı ürün ailesinin türevleri (model, renk, ebat, ayak tipi…) products.variants JSON'unda durur
// (biçim: migrations/0086_product_variants.sql). Seçenek GRUPLARI ayrıca saklanmaz, dizinin
// options[].label'larından türetilir — tek kaynak dizinin kendisi.
//
// NEDEN AYRI DOSYA: bu mantık eskiden yalnızca js/components/product-modal.js'in içindeydi. Artık
// ürün ekle/düzenle formu (urun-ekle.html) da AYNI türetmeyi ("popup'ta nasıl görünecek?"
// önizlemesi ve mevcut/mevcut olmayan kombinasyon durumları) çalıştırıyor; iki kopya tutmak ikisinin
// sessizce ayrışmasına yol açardı. Global `window.MLProductVariants` — const global DEĞİL (bkz.
// proje notu: const global'ler window'a yazılmaz).
//
// SEYREK MATRİS (kullanıcı isteği, aynı madde: "bir modelin bir rengi mevcut değilse o renkler
// kapalı butonlar olmalı"): availability(), mevcut seçime göre her hap'ın "var / yok" durumunu
// verir. "Yok" hap'lar KAPALI görünür ama tıklanabilir kalır — tıklanınca pickIndex() o değeri
// taşıyan EN YAKIN gerçek versiyona düşer. Aksi halde (gerçekten devre dışı olsalardı) kullanıcı
// bazı versiyonlara hiç ulaşamazdı: "Model T21 yalnızca Füme'de var, Füme ise Model 50'de yok"
// durumunda iki hap da kapalı kalır, T21·Füme'ye giden yol kapanırdı.
(function () {
  function optionValue(v, label) {
    var o = ((v && v.options) || []).find(function (x) { return x && x.label === label; });
    return o ? o.value : null;
  }

  // Sıra korunur: gruplar ilk görüldükleri, değerler ilk göründükleri sırada ("Alçak / Orta / Yüksek",
  // "S / M / L" içe aktarma sırasıyla çıkar). TEK DEĞERLİ gruplar elenir: her versiyonda aynı olan
  // bir seçenek bir "seçim" değildir. Hiç çok değerli grup yoksa versiyonların KENDİ adları tek bir
  // "Versiyon" grubu olur (byVariantLabel) — options'ı olmayan bir liste de çalışır durumda kalır.
  function buildGroups(variants) {
    var groups = [];
    var byLabel = new Map();
    (variants || []).forEach(function (v) {
      ((v && v.options) || []).forEach(function (o) {
        if (!o || !o.label || !o.value) return;
        var g = byLabel.get(o.label);
        if (!g) { g = { label: o.label, values: [] }; byLabel.set(o.label, g); groups.push(g); }
        if (g.values.indexOf(o.value) === -1) g.values.push(o.value);
      });
    });
    var multi = groups.filter(function (g) { return g.values.length > 1; });
    if (multi.length) return multi;
    var labels = (variants || []).map(function (v) { return (v && v.label) || ''; }).filter(Boolean);
    return labels.length > 1 ? [{ label: 'Versiyon', values: labels, byVariantLabel: true }] : [];
  }

  function matches(v, group, value) {
    return group.byVariantLabel ? ((v && v.label) === value) : optionValue(v, group.label) === value;
  }

  // Bir hap'a tıklanınca hangi versiyona geçilecek: "değişen ekseni zorla, kalan eksenlerde mevcut
  // seçime EN ÇOK benzeyeni al". Hiç eşleşme yoksa -1.
  function pickIndex(variants, groups, curIdx, group, value) {
    var cur = variants[curIdx] || {};
    var best = -1, bestScore = -1;
    variants.forEach(function (v, i) {
      if (!matches(v, group, value)) return;
      var score = 0;
      groups.forEach(function (g) {
        if (g === group || g.byVariantLabel) return;
        if (optionValue(v, g.label) === optionValue(cur, g.label)) score++;
      });
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  }

  // Mevcut seçime göre hangi hap'lar GERÇEK bir versiyona karşılık geliyor?
  // Dönen: Map<groupLabel, Set<value>> — grup g'deki v değeri, DİĞER tüm gruplarda mevcut seçimle
  // eşleşen ve g'de v taşıyan bir versiyon varsa "mevcut"tur. Tek gruplu (ya da byVariantLabel)
  // durumda her değer mevcuttur.
  function availability(variants, groups, curIdx) {
    var cur = variants[curIdx] || {};
    var out = new Map();
    groups.forEach(function (g) {
      var ok = new Set();
      g.values.forEach(function (value) {
        var exists = variants.some(function (v) {
          if (!matches(v, g, value)) return false;
          return groups.every(function (other) {
            if (other === g || other.byVariantLabel) return true;
            return optionValue(v, other.label) === optionValue(cur, other.label);
          });
        });
        if (exists) ok.add(value);
      });
      out.set(g.label, ok);
    });
    return out;
  }

  window.MLProductVariants = { optionValue: optionValue, buildGroups: buildGroups, pickIndex: pickIndex, availability: availability };
})();
