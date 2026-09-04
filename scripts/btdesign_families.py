#!/usr/bin/env python3
"""B&T Design partisi — ELLE yapılan küratörlük katmanı (2026-09-04, dördüncü ürün partisi).

`scrape-btdesign.py` ham veriyi, `btdesign-dimensions.json` ise teknik föy görsellerinden
GÖZLE okunmuş ölçüleri taşır. Bu dosya ikisini bir araya getirecek KARARLARI içerir:

  FAMILIES     — 85 kaynak sayfa -> 62 ANA ÜRÜN. Gruplama ad benzerliğiyle DEĞİL, kaynak
                 metniyle doğrulanarak yapıldı (Drage/Round/Yuki/Noda sayfaları kendi
                 metinlerinde açıkça "… ailesi" diyor; bkz. [[project_batch67_...]] aynı kural).
  CONFIG_AXES  — teknik föydeki konfigürasyon adının HANGİ eksenlere ayrılacağı.
  SINGLE_AXIS  — " — " ile ayrılmasına rağmen TEK eksen sayılması gereken sayfalar.
  PAGE_ONLY    — aynı föyü PAYLAŞAN sayfalarda hangi konfigürasyonun hangi sayfaya ait olduğu.
  UPDATE_EXISTING — D1'de zaten var olan satırlar (yeni satır AÇILMAZ, zenginleştirilir).

Marka: B&T Design D1'de ZATEN KAYITLI (offices.id=770, slug `b-t-design`, about/logo/kapak
dolu) — yeni marka profili açılmaz, ürünler bu id'ye bağlanır.
"""

# ==============================================================================================
# 1) D1'de zaten var olan B&T Design ürünleri
# ==============================================================================================
# products.id -> aile anahtarı. Bu satırlar EZİLMEZ, ZENGİNLEŞTİRİLİR (bkz. import-btdesign.py):
# mevcut açıklama/spec'ler küratörlüdür ve bu kazımada YOKTUR ("İskelet: Metal karkas ve çelik
# yaylar", "Dolgu: Enjeksiyon yöntemiyle uygulanan poliüretan sünger" …).
#
# DİKKAT — id=190 ("Rest", source_url `rest-istiflenebilir-sandalye.html`) bu partide YOK:
# kullanıcının verdiği liste Rest ailesinden yalnızca `rest-klasik-kollu-sandalye` sayfasını
# içeriyor. 190 BAŞKA bir sayfadır, dokunulmaz.
UPDATE_EXISTING = {
    189: 'pera',      # Pera            -> pera-premium-ofis-sandalye.html
    191: 'rest',      # Rest Klasik     -> rest-klasik-kollu-sandalye.html
    192: 'roller',    # Roller          -> roller-puf.html
    193: 'to-be',     # To Be           -> to-be-koltuk.html
}

# ==============================================================================================
# 2) Konfigürasyon eksenleri
# ==============================================================================================
# slug -> (1. eksenin adı, 2. eksenin adı | None)
# Teknik föydeki konfigürasyon adı " — " ile ikiye bölünür; parçalar bu eksenlere yazılır.
# product-modal.js#buildVariantGroups tek değerli ekseni kendisi eler, o yüzden ikinci eksenin
# yalnızca bazı sayfalarda dolu olması sorun değil.
CONFIG_AXES = {
    'alek-lounge-koltuk': ('Versiyon', None),
    'alek-sandalye': ('Versiyon', None),
    'another-chair-tr': ('Model', None),
    'bob-kanepe': ('Modül', 'Ayak'),
    'bold-sehpali-koltuk': ('Sehpa', None),
    'bonny-ahsap-donebilen-ayak-koltuk': ('Ayak Tipi', None),
    'boxer-puf': ('Ölçü', None),
    'daisy-lounge-koltuk-': ('Ayak Tipi', None),
    'daisy-papel-ayak-sandalye': ('Ayak Tipi', None),
    'dante-bar-taburesi': ('Oturum / Sırt', 'Yükseklik'),
    'dante-sandalye': ('Oturum / Sırt', None),
    'dia-50-bar-taburesi': ('Yükseklik', 'Ayak Tipi'),
    'dion-sandalye': ('Kolçak', None),
    'dot-bar-taburesi-papel': ('Oturum', 'Yükseklik'),
    'dot-sandalye': ('Oturum', 'Kolçak'),
    'drage-ortak-oturum': ('Form / Ölçü', None),
    'drage-sehpa': ('Ölçü', None),
    'dupont-bar-taburesi-papel': ('Oturum', 'Yükseklik'),
    'dupont-koltuk-dosemeli': ('Oturum', None),
    'dupont-sandalye-dosemeli': ('Oturum', None),
    'durgu-kanepe': ('Modül', 'Kolçak'),
    'elusive-masa': ('Ölçü', None),
    'ferno': ('Versiyon', None),
    'fil-masa': ('Ölçü', None),
    'flint-puf': ('Boyut', None),
    'fly-sehpa': ('Ölçü', None),
    'glee-tabure': ('Yükseklik', None),
    'globe-masa': ('Tabla', 'Ayak Tipi'),
    'globe-sehpa': ('Ölçü', None),
    'grace-premium-donebilen-sandalye': ('Ayak Tipi', 'Sırt'),
    'kav-koltuk': ('Versiyon', None),
    'lamy-elips-donebilen-ayak-sandalye': ('Ayak Tipi', None),
    'lamy-lounge-metal': ('Versiyon', None),
    'lamy-lounge-premium-donebilen-ayak---baslikli': ('Versiyon', None),
    'led-kanepe': ('Modül', None),
    'loft-bank': ('Modül', None),
    'loom-sehpa': ('Ölçü', None),
    'mabel-comfort-kanepe': ('Modül', 'Ayak'),
    'matt-moduler-oturma-sistemi': ('Modül / Kurgu', None),
    'may-puf': ('Ölçü', None),
    'mentor-executive-sandalye': ('Tip', 'Ayak'),
    'metric-ortak-oturum': ('Modül', None),
    'mika-sandalye': ('Oturum', None),
    'mika-sirtli-bar-taburesi': ('Oturum / Sırt', 'Yükseklik'),
    'modest-sehpa': ('Ölçü', None),
    'most-kanepe': ('Modül', None),
    'noa-sehpa': ('Ölçü', None),
    'noda-bank': ('Modül', None),
    'noda-kanepe': ('Modül', None),
    'odin-bar': ('Oturum', 'Yükseklik'),
    'odin-sandalye': ('Oturum', None),
    'ora-koltuk': ('Versiyon', None),
    'pera-bar-elips-ayak-bar-taburesi': ('Ayak Tipi', 'Yükseklik'),
    'pera-lounge-metal-donebilen-ayak-koltuk': ('Ayak Tipi', 'Kolçak'),
    'pera-premium-ofis-sandalye': ('Ayak Tipi', 'Kolçak'),
    'pi-puf': ('Ölçü', None),
    'pick-kanepe': ('Modül', 'Kolçak'),
    'pick-small-oturum-sistemleri-tr': ('Modül', None),
    'piu-kanepe': ('Kurgu', None),
    'pod-quad-oturum-adasi': ('Model', None),
    'radius-masa': ('Ölçü', 'Tabla Malzemesi'),
    'rego-koltuk-klasik-ahsap': ('Ürün', 'Ayak Tipi'),
    'rego-lounge-executive-tr': ('Ürün', 'Ayak Tipi'),
    'rego-play-ahsap-ayak-sandalye': ('Ayak Tipi', 'Döşeme'),
    'rego-x-ayak-sandalye': ('Ayak Tipi', None),
    'rest-klasik-kollu-sandalye': ('Ayak Tipi / Döşeme', 'Kolçak'),
    'roller-puf': ('Ölçü', None),
    'round-metal-donebilen-ayak-koltuk': ('Model', 'Ayak / Kolçak'),
    'round-private-koltuk': ('Model', 'Ayak / Kolçak'),
    'seri-masa': ('Ölçü', None),
    'sini-sehpa': ('Ölçü', None),
    'sole-bar-taburesi-oturum-dosemeli': ('Oturum', 'Yükseklik'),
    'sole-sandalye-metal': ('Oturum', None),
    'sorbe-tr': ('Ölçü', None),
    'spirit-kollu-sandalye': ('Kolçak', None),
    'theo-sehpa': ('Ölçü', None),
    'to-be-koltuk': ('Versiyon', None),
    'tori-indoor-masa': ('Ölçü', None),
    'woodplate-masa': ('Ölçü', None),
    'woodplate-sehpa': ('Ölçü', None),
    'yuki-kanepe': ('Modül', None),
    'yuki-koltuk-tr': ('Modül', None),
    'zen-kanepe': ('Modül', None),
    'zenger-puf': ('Ölçü', None),
    'zone-executive-sandalye': ('Tip', 'Ayak / Kolçak'),
}

# Konfigürasyon adında " — " geçse bile İKİYE BÖLÜNMEMESİ gereken sayfalar. Bu sayfalarda ayıraç
# "eksen" değil, kod ile açıklamayı ("L3B — Tam Sırtlı", "1SWA — Tekli Oturum, Kolçaklı") veya
# birbirini dışlamayan iki farklı listeyi ("Puf — Ahşap Ayak" ile "Ahşap Ayak — Başlıklı"
# aynı sütunda buluşur) ayırır; bölmek anlamsız/çakışan hap grupları üretirdi.
SINGLE_AXIS = {
    'lamy-lounge-metal', 'lamy-lounge-premium-donebilen-ayak---baslikli',
    'loft-bank', 'matt-moduler-oturma-sistemi', 'metric-ortak-oturum',
    'noda-bank', 'noda-kanepe', 'pick-small-oturum-sistemleri-tr',
}

# Aynı teknik föyü PAYLAŞAN sayfalar: föy ailenin TAMAMINI gösterdiği için, hangi
# konfigürasyonun hangi sayfaya ait olduğu elle bölünür. Bölünmezse aynı versiyon iki kez
# (ör. "Tekli Koltuk" hem Yuki Koltuk hem Yuki Kanepe altında) listelenirdi.
PAGE_ONLY = {
    'yuki-koltuk-tr': ['Tekli Koltuk'],
    'yuki-kanepe': ['Üçlü Kanepe', 'İkili Kanepe'],
    'round-private-koltuk': ['Private S', 'Private S — Ø30 Tabletli Kolçak'],
    'round-metal-donebilen-ayak-koltuk': ['Metal S — Dönebilen Ayak'],
    'noda-kanepe': ['1S — Tekli Oturum', '1SH — Tekli Oturum, Yüksek Sırt',
                    '1SWA — Tekli Oturum, Kolçaklı',
                    '1SWAH — Tekli Oturum, Kolçaklı, Yüksek Sırt',
                    'C — Köşe Modülü', 'CH — Köşe Modülü, Yüksek Sırt'],
    'noda-bank': ['P1 — Puf', 'P2 — Puf'],
    'lamy-lounge-metal': ['Premium (Metal) Dönebilen Ayak', 'Ahşap Dönebilen Ayak',
                          'Ahşap Ayak', 'Kızak (Sled) Ayak',
                          'Puf — Premium Dönebilen Ayak', 'Puf — Ahşap Dönebilen Ayak',
                          'Puf — Ahşap Ayak', 'Puf — Kızak Ayak'],
    'lamy-lounge-premium-donebilen-ayak---baslikli': [
        'Premium (Metal) Dönebilen Ayak — Başlıklı', 'Ahşap Dönebilen Ayak — Başlıklı',
        'Ahşap Ayak — Başlıklı', 'Kızak (Sled) Ayak — Başlıklı'],
    'rego-koltuk-klasik-ahsap': ['Klasik — Ahşap Dönebilen Ayak',
                                 'Klasik — Premium Dönebilen Ayak',
                                 'Puf — Ahşap Dönebilen Ayak', 'Puf — Premium Dönebilen Ayak'],
    'rego-lounge-executive-tr': ['Executive — Premium Dönebilen Ayak',
                                 'Executive — Ahşap Dönebilen Ayak'],
}

# ==============================================================================================
# 3) Aileler
# ==============================================================================================
# key   : payload/güncelleme anahtarı
# title : MİMARLAB'da görünecek ürün adı
# cat    : catalog-taxonomy.js#PRODUCT_TAXONOMY yaprak kategorisi
# axis  : sayfa ekseninin adı (tek sayfalı ailelerde None)
# pages : [(slug, o sayfanın eksen değeri)] — sıra popup'ta hap sırasıdır
_F = lambda key, title, cat, axis, pages: {   # noqa: E731
    'key': key, 'title': title, 'cat': cat, 'axis': axis, 'pages': pages}

FAMILIES = [
    # ---- çok sayfalı aileler (kullanıcının istediği konsolidasyon) -------------------------
    _F('odin', 'Odin Sandalye ve Bar Taburesi Serisi', 'Sandalye & Tabure', 'Tip', [
        ('odin-sandalye', 'Sandalye'), ('odin-bar', 'Bar Taburesi')]),
    _F('alek', 'Alek Sandalye ve Lounge Serisi', 'Sandalye & Tabure', 'Tip', [
        ('alek-sandalye', 'Sandalye'), ('alek-lounge-koltuk', 'Lounge Koltuk')]),
    _F('dot', 'Dot Sandalye ve Bar Taburesi Serisi', 'Sandalye & Tabure', 'Tip', [
        ('dot-sandalye', 'Sandalye'), ('dot-bar-taburesi-papel', 'Bar Taburesi')]),
    _F('sole', 'Sole Sandalye ve Bar Taburesi Serisi', 'Sandalye & Tabure', 'Tip', [
        ('sole-sandalye-metal', 'Sandalye'), ('sole-bar-taburesi-oturum-dosemeli', 'Bar Taburesi')]),
    _F('dante', 'Dante Sandalye ve Bar Taburesi Serisi', 'Sandalye & Tabure', 'Tip', [
        ('dante-sandalye', 'Sandalye'), ('dante-bar-taburesi', 'Bar Taburesi')]),
    _F('mika', 'Mika Sandalye ve Bar Taburesi Serisi', 'Sandalye & Tabure', 'Tip', [
        ('mika-sandalye', 'Sandalye'), ('mika-sirtli-bar-taburesi', 'Bar Taburesi')]),
    _F('dupont', 'Dupont Sandalye, Lounge ve Bar Serisi', 'Sandalye & Tabure', 'Tip', [
        ('dupont-sandalye-dosemeli', 'Sandalye'), ('dupont-koltuk-dosemeli', 'Lounge Koltuk'),
        ('dupont-bar-taburesi-papel', 'Bar Taburesi')]),
    _F('rego', 'Rego Koltuk ve Sandalye Serisi', 'Ofis Mobilyası', 'Tip', [
        ('rego-x-ayak-sandalye', 'Sandalye'), ('rego-play-ahsap-ayak-sandalye', 'Play Sandalye'),
        ('rego-koltuk-klasik-ahsap', 'Lounge Klasik'),
        ('rego-lounge-executive-tr', 'Lounge Executive')]),
    _F('lamy', 'Lamy Oturma Ailesi', 'Ofis Mobilyası', 'Tip', [
        ('lamy-elips-donebilen-ayak-sandalye', 'Sandalye'),
        ('lamy-lounge-metal', 'Lounge Koltuk'),
        ('lamy-lounge-premium-donebilen-ayak---baslikli', 'Lounge Başlıklı')]),
    _F('pera', 'Pera Koltuk Koleksiyonu', 'Ofis Mobilyası', 'Tip', [
        ('pera-premium-ofis-sandalye', 'Ofis Sandalyesi'),
        ('pera-lounge-metal-donebilen-ayak-koltuk', 'Lounge Koltuk'),
        ('pera-bar-elips-ayak-bar-taburesi', 'Bar Taburesi')]),
    _F('round', 'Round Koltuk Ailesi', 'Koltuk & Kanepe', None, [
        ('round-private-koltuk', None),
        ('round-metal-donebilen-ayak-koltuk', None)]),
    _F('daisy', 'Daisy Sandalye ve Lounge Serisi', 'Sandalye & Tabure', 'Tip', [
        ('daisy-papel-ayak-sandalye', 'Sandalye'), ('daisy-lounge-koltuk-', 'Lounge Koltuk')]),
    _F('globe', 'Globe Masa & Sehpa Grubu', 'Masa', 'Tip', [
        ('globe-masa', 'Masa'), ('globe-sehpa', 'Sehpa')]),
    _F('woodplate', 'Woodplate Masa & Sehpa Grubu', 'Masa', 'Tip', [
        ('woodplate-masa', 'Masa'), ('woodplate-sehpa', 'Sehpa')]),
    _F('yuki', 'Yuki Koltuk ve Kanepe Serisi', 'Koltuk & Kanepe', None, [
        ('yuki-koltuk-tr', None), ('yuki-kanepe', None)]),
    _F('pick', 'Pick Modüler Oturma Ailesi', 'Koltuk & Kanepe', 'Tip', [
        ('pick-kanepe', 'Kanepe'), ('pick-small-oturum-sistemleri-tr', 'Pick Small')]),
    _F('noda', 'Noda Modüler Oturma Ailesi', 'Koltuk & Kanepe', 'Tip', [
        ('noda-kanepe', 'Kanepe'), ('noda-bank', 'Bank')]),
    _F('drage', 'Drage Sehpa ve Ortak Oturum Ailesi', 'Koltuk & Kanepe', 'Tip', [
        ('drage-ortak-oturum', 'Ortak Oturum'), ('drage-sehpa', 'Sehpa')]),

    # ---- tek sayfalı ürünler ---------------------------------------------------------------
    _F('another-chair', 'Another Chair', 'Sandalye & Tabure', None, [('another-chair-tr', None)]),
    _F('spirit', 'Spirit Kollu Sandalye', 'Sandalye & Tabure', None, [('spirit-kollu-sandalye', None)]),
    _F('dion', 'Dion Sandalye', 'Sandalye & Tabure', None, [('dion-sandalye', None)]),
    _F('rest', 'Rest Klasik Kollu Sandalye', 'Sandalye & Tabure', None, [('rest-klasik-kollu-sandalye', None)]),
    _F('grace', 'Grace Premium Dönebilen Sandalye', 'Ofis Mobilyası', None, [('grace-premium-donebilen-sandalye', None)]),
    _F('zone', 'Zone Executive Sandalye', 'Ofis Mobilyası', None, [('zone-executive-sandalye', None)]),
    _F('mentor', 'Mentor Executive Sandalye', 'Ofis Mobilyası', None, [('mentor-executive-sandalye', None)]),
    _F('glee', 'Glee Tabure', 'Sandalye & Tabure', None, [('glee-tabure', None)]),
    _F('dia-50', 'Dia 50 Bar Taburesi', 'Sandalye & Tabure', None, [('dia-50-bar-taburesi', None)]),

    _F('ora', 'Ora Koltuk', 'Koltuk & Kanepe', None, [('ora-koltuk', None)]),
    _F('bonny', 'Bonny Dönebilen Ayak Koltuk', 'Koltuk & Kanepe', None, [('bonny-ahsap-donebilen-ayak-koltuk', None)]),
    _F('ferno', 'Ferno Koltuk', 'Koltuk & Kanepe', None, [('ferno', None)]),
    _F('bold', 'Bold Sehpalı Koltuk', 'Koltuk & Kanepe', None, [('bold-sehpali-koltuk', None)]),
    _F('kav', 'Kav Dönebilen Koltuk', 'Koltuk & Kanepe', None, [('kav-koltuk', None)]),
    _F('to-be', 'To Be Koltuk', 'Koltuk & Kanepe', None, [('to-be-koltuk', None)]),

    _F('zen', 'Zen Kanepe', 'Koltuk & Kanepe', None, [('zen-kanepe', None)]),
    _F('durgu', 'Durgu Kanepe', 'Koltuk & Kanepe', None, [('durgu-kanepe', None)]),
    _F('most', 'Most Kanepe', 'Koltuk & Kanepe', None, [('most-kanepe', None)]),
    _F('led', 'Led Kanepe', 'Koltuk & Kanepe', None, [('led-kanepe', None)]),
    _F('mabel-comfort', 'Mabel Comfort Kanepe', 'Koltuk & Kanepe', None, [('mabel-comfort-kanepe', None)]),
    _F('piu', 'Piu Modüler Kanepe', 'Koltuk & Kanepe', None, [('piu-kanepe', None)]),
    _F('bob', 'Bob Kanepe', 'Koltuk & Kanepe', None, [('bob-kanepe', None)]),

    _F('fil', 'Fil Masa', 'Masa', None, [('fil-masa', None)]),
    _F('tori', 'Tori Masa', 'Masa', None, [('tori-indoor-masa', None)]),
    _F('seri', 'Seri Masa', 'Masa', None, [('seri-masa', None)]),
    _F('radius', 'Radius Masa', 'Masa', None, [('radius-masa', None)]),
    _F('elusive', 'Elusive Masa', 'Masa', None, [('elusive-masa', None)]),

    _F('sini', 'Sini Sehpa', 'Masa', None, [('sini-sehpa', None)]),
    _F('modest', 'Modest Sehpa', 'Masa', None, [('modest-sehpa', None)]),
    _F('theo', 'Theo Sehpa', 'Masa', None, [('theo-sehpa', None)]),
    _F('loom', 'Loom Sehpa', 'Masa', None, [('loom-sehpa', None)]),
    _F('noa', 'Noa Sehpa', 'Masa', None, [('noa-sehpa', None)]),
    _F('fly', 'Fly Sehpa', 'Masa', None, [('fly-sehpa', None)]),

    _F('flint', 'Flint Puf', 'Koltuk & Kanepe', None, [('flint-puf', None)]),
    _F('sorbe', 'Sorbe Puf', 'Koltuk & Kanepe', None, [('sorbe-tr', None)]),
    _F('zenger', 'Zenger Puf', 'Koltuk & Kanepe', None, [('zenger-puf', None)]),
    _F('boxer', 'Boxer Puf', 'Koltuk & Kanepe', None, [('boxer-puf', None)]),
    _F('may', 'May Puf', 'Koltuk & Kanepe', None, [('may-puf', None)]),
    _F('roller', 'Roller Puf', 'Koltuk & Kanepe', None, [('roller-puf', None)]),
    _F('pi', 'Pi Puf', 'Koltuk & Kanepe', None, [('pi-puf', None)]),

    _F('metric', 'Metric Ortak Oturum', 'Koltuk & Kanepe', None, [('metric-ortak-oturum', None)]),
    _F('matt', 'Matt Modüler Oturma Sistemi', 'Koltuk & Kanepe', None, [('matt-moduler-oturma-sistemi', None)]),
    _F('loft', 'Loft Modüler Bank', 'Koltuk & Kanepe', None, [('loft-bank', None)]),
    _F('pod', 'Pod Oturum Adası', 'Koltuk & Kanepe', None, [('pod-quad-oturum-adasi', None)]),
]

# ==============================================================================================
# 4) B&T Design markası (D1'de MEVCUT — yeni satır açılmaz)
# ==============================================================================================
BRAND_OFFICE_ID = 770
BRAND_NAME = 'B&T Design'
BRAND_WEBSITE = 'https://bt.design'
