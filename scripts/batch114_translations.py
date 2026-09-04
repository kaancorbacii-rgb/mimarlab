# -*- coding: utf-8 -*-
"""114 ürün bağlantısının ANA ÜRÜN ↔ VERSİYON haritası + Türkçe çeviri tablosu (elle küratörlük).

Bu dosya iki soruya cevap verir; `scripts/batch114-build-payload.py` ikisini de burada okur:

  1. **Hangi bağlantılar aynı ürün ailesidir?** — FAMILIES listesindeki her girdi katalogda TEK bir
     ürün kartına dönüşür; `variants` altındaki her URL o kartın içindeki bir "Versiyon"dur (bkz.
     migrations/0086_product_variants.sql). 114 URL → 64 katalog kartı. Gruplama BİLEREK elle
     yazıldı: otomatik ad benzerliği "Merano chair"/"Merano Armchair" ikilisini doğru birleştirirken
     "14 chair"/"18 chair"i (iki ayrı ikonik model) da yanlışlıkla birleştirirdi.

  2. **Türkçe karşılığı nedir?** — başlıklar ve açıklamalar profesyonel mobilya terminolojisiyle
     çevrildi: High-back → Yüksek Sırtlı, 4-star base → 4 Yıldız Ayak, Daybed → Uzanma Koltuğu,
     Coffee Table → Orta Sehpa, Barstool → Bar Taburesi, Dining Chair → Yemek Sandalyesi,
     Ottoman/Pouf → Puf, Coat Stand → Portmanto, Sunbed → Şezlong, Corner Module → Köşe Modülü.

VERSİYON SEÇENEK EKSENLERİ (`options`): ekranda her eksen kendi hap-butonu satırını alır (bkz.
js/components/product-modal.js#buildVariantGroups). Matris SEYREK olabilir — Toya'nın 3x3'ü tamdır
ama Whale'de her kaplama × her tip kombinasyonu yoktur; seçici en yakın gerçek versiyona düşer,
bu yüzden eksik kombinasyonlar sorun değildir. Tek değerli eksenler ekranda hiç görünmez.

SNOC AÇIKLAMALARI: dört koleksiyonun (savio/sestri/caleo/alvo) Türkçe metni 2026-09-04'teki ilk
Archello partisinde zaten çevrilmişti — KOPYALANMAZ, scripts/archello_products_translations.py'den
import edilir. Yalnızca o partide olmayan 'whale' burada eklenir.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from archello_products_translations import DESCRIPTIONS as SNOC_DESCRIPTIONS  # noqa: E402

# --------------------------------------------------------------------------------------------
# Yeni marka profilleri — sitede offices satırı OLMAYAN markalar (Nurus/Normod/SNOC/Flexform
# zaten var, onlara "zenginleştir, EZME" kuralıyla dokunulur; bkz. import betiği#sync_brands).
# --------------------------------------------------------------------------------------------
BRANDS = {
    'ton-design': {
        'name': 'TON',
        'website': 'https://www.ton.eu',
        'loc': 'Bystřice pod Hostýnem, Çekya',
        'cats': 'Mobilya',
        'about': """TON, 1861'den bu yana Çekya'nın Bystřice pod Hostýnem kasabasında ahşap büken bir mobilya üreticisidir. Fabrika, seri üretilen mobilyanın algısını kalıcı olarak değiştiren buharla ahşap bükme tekniğinin doğduğu yerdir; No. 14 sandalyesi bugüne dek 80 milyondan fazla üretilmiştir.

Marka, geleneksel el işçiliğini çağdaş tasarımla birleştirir. Kayın ve meşe kütüğünden başlayan süreç; buharlama, elde bükme, zımparalama ve döşemeye kadar aynı çatı altında yürütülür. Alexander Gufler, Arik Levy, Michal Riabič ve KASCHKASCH gibi tasarımcılarla yürütülen iş birlikleri, bükme teknolojisinin sınırlarını her koleksiyonda yeniden tarif eder.

Ürün gamı; kafe ve restoran sandalyelerinden bar taburelerine, yemek ve toplantı masalarından portmantolara uzanır. TON ürünleri dünya genelinde 60'tan fazla ülkede satılmakta, kamusal iç mekân projelerinde sıkça tercih edilmektedir.""",
    },
    'pedrali': {
        'name': 'Pedrali',
        'website': 'https://www.pedrali.com',
        'loc': 'Mornico al Serio, İtalya',
        'cats': 'Mobilya',
        'about': """Pedrali, 1963'te Mario Pedrali tarafından İtalya'nın Bergamo bölgesinde kurulan bir çağdaş mobilya markasıdır. Metal işlemeyle başlayan üretim, zaman içinde polipropilen enjeksiyon, alüminyum enjeksiyon ve ahşap işleme hatlarını da kapsayarak markayı bütünüyle İtalya'da üreten bütünleşik bir sanayi kuruluşuna dönüştürmüştür.

Marka; sandalye, tabure, koltuk, masa ve tamamlayıcı ürünlerden oluşan gamıyla ofis, ağırlama ve konut projelerine hizmet eder. Odo Fioravanti, Patrick Jouin, Claudio Dondoli & Marco Pocci, Marc Sadler ve Pio & Tito Toso gibi tasarımcılarla yürütülen iş birlikleri, Compasso d'Oro dâhil çok sayıda ödülle tanınmıştır.

Pedrali, üretim atıklarını geri döndüren kapalı döngü süreçleri ve tamamı geri dönüştürülebilir malzeme tercihleriyle sürdürülebilirliği ürün geliştirmenin merkezine alır.""",
    },
    'varaschin': {
        'name': 'Varaschin',
        'website': 'https://www.varaschin.it',
        'loc': 'Cordignano, İtalya',
        'cats': 'Mobilya',
        'about': """Varaschin, 1969'da İtalya'nın Treviso bölgesinde kurulan, dış mekân mobilyasında uzmanlaşmış bir markadır. Hasır örme geleneğinden gelen marka, bugün elektrostatik toz boyalı alüminyum iskeletler üzerine elde örülen sentetik halat ve fiber dokularıyla tanınır.

Markanın imzası, her koleksiyonda yeniden kurgulanan örgü desenidir: Emma'nın çiçek tacından esinlenen sarmalayan dokusu, Cricket'in ince örgüsü, Tibidabo'nun kum saati siluetini çizen dikey dokuması. VAR#TEX gibi kendi geliştirdiği dış mekân kumaşları, ürünlerin her hava koşuluna dayanmasını sağlar.

Anki Gneib, Monica Armani, Calvi Brambilla, Pio & Tito Toso ve Giopato & Coombes gibi tasarımcılarla çalışan Varaschin; konut bahçelerinden otel ve restoran teraslarına uzanan projelerde tercih edilmektedir.""",
    },
    'investwood': {
        'name': 'Investwood',
        'website': 'https://www.investwood.pt',
        'loc': 'Lizbon, Portekiz',
        'cats': 'Zemin & Yüzey Kaplama',
        'about': """Investwood, Portekiz merkezli bir ahşap esaslı panel üreticisidir ve kütlesel renkli MDF panel Valchromat'ın geliştiricisidir. Valchromat, rengin yüzeye kaplanmadığı, lif hamurunun tamamına organik pigmentlerle işlendiği bir malzemedir; bu yüzden panel kesildiğinde, frezelendiğinde ya da oyulduğunda renk kesit boyunca sürer.

Malzeme; mobilya, mağaza tasarımı, sergi ve iç mekân uygulamalarında hem strüktürel hem yüzey elemanı olarak kullanılır. Nem dayanımı artırılmış ve yangın geciktirici tipleri de üretilir.

Marka, panellerini sürdürülebilir orman kaynaklarından ve geri dönüştürülmüş ahşap liflerinden üretir; tasarımcılarla yürüttüğü iş birlikleri malzemenin sınırlarını gösteren mobilya prototiplerine dönüşür.""",
    },
}

# --------------------------------------------------------------------------------------------
# Aile açıklamaları — birden çok versiyonun paylaştığı metinler burada tek kez yazılır.
# --------------------------------------------------------------------------------------------
DESCRIPTIONS = dict(SNOC_DESCRIPTIONS)
DESCRIPTIONS.update({
    'whale': """Whale Koleksiyonu, bir balina iskeletinin formundan esinlenen zarif ve sağlam bir tasarım ortaya koyar. Koleksiyon, sürdürülebilir ve doğal malzemeleri yüksek kaliteli tik ağacıyla dengeli biçimde bir araya getirir. Düşey düzlemdeki güçlü ve kalın hatlar tasarımı netleştirirken, yatay düzlemdeki strüktür dikkat çeker.

İskeletsi kurgusunun yanı sıra geniş oturum detayları konforu artırır ve dinlendirici bir deneyim sunar. Koleksiyon; Ash ve Noche tik kaplama seçeneklerinde Sunbrella kumaş alternatifleriyle sunulur ve kum taşından üretilen sehpa takımıyla tamamlanır.""",

    # --- TON ---
    'again': """Geleneksel masif ahşap ile bükme ahşabın bir arada kullanıldığı, konforlu kolçakları ve istiflenebilirliğiyle sıra dışı bir oturma birimi. Alex Gufler'in tasarladığı kendine özgü yuvarlak form, bir tenis raketinden esinlenmiştir.

Aile, aynı silueti hem sandalye hem bar taburesi ölçeğinde sürdürür; iki versiyon da yemek masası ve bar tezgâhı çevresinde birlikte kullanılabilecek tutarlı bir görsel dil kurar.""",
    'la-zitta': """Güç, sessizlikte bulunur. İtalyanca "sessiz" anlamına gelen La Zitta; zamansızlığı, sağlamlığı ve çok yönlülüğü tek bir formda birleştirir. Geleneksel ve gösterişsiz siluet, çağdaş oranlar ve özenli detaylarla yeniden yorumlanmıştır.

Sandalye tümüyle masif kayın ağacından ve TON'un kuşaklardır sınadığı ahşap bükme teknolojisiyle üretilir. İlk bakışta yalın görünen forma, oturma konforunu artıran ergonomik detaylar eşlik eder. Aile, aynı tasarımın sandalye ve bar taburesi versiyonlarını kapsar.""",
    'merano': """Konforlu ve istiflenebilir bu ahşap sandalyenin formu, ahşap bükme mirasını katı bir modernizmle birleştirir. Avusturyalı tasarımcı Alexander Gufler'in imzasını taşıyan model, TON'un modern tarihindeki en çok satan — ve en çok kopyalanan — tasarımıdır.

Aile; kolçaksız sandalye ve hafif, ferah siluetini koruyan kollu sandalye versiyonlarıyla sunulur.""",

    # --- Flexform ---
    'luchino': """Bin yıllık bir geçmişe sahip katlanır sandalye, sinema endüstrisinin yaygınlaşmasıyla "yönetmen sandalyesi" olarak ikonik bir statü kazandı. Konforlu, hafif ve kolay taşınabilir olma niteliği, Antonio Citterio ve Flexform'u bu tipolojiyi Luchino ile yeniden yorumlamaya yöneltti.

Elde torna edilip bitirilmiş masif ahşap gövde, katlanma mekanizmasını düzenleyen ince metal bileşenlerle birleşir. İlk bakışta yalın görünen tasarım, yakından bakıldığında üstün ahşap işçiliğini ve detaya gösterilen özeni açık eder.

Aile; iç mekân için deri oturumlu berjer versiyonuyla, dış mekân için masif iroko ağacı gövdeli ve dayanıklı branda kumaş oturumlu yemek sandalyesi versiyonuyla sunulur.""",
    'kim': """Kim, Antonio Citterio'nun Flexform için yürüttüğü çalışmanın imzası olan estetik sadelik ile üstün zanaat işçiliğinin buluşmasından doğdu. Yalın çizgilere sahip ama detay bakımından zengin olan tasarım, nitelikli malzemelerin bir araya gelişiyle zamansız bir zarafet kurar.

Elde bitirilmiş masif ahşaptan sağlam gövde, örgü kordonla dokunmuş oturum ve sırtın hafifliğiyle rahat bir diyalog kurar; bu işçilik İtalyan üretim geleneğinin özetidir. Konfor ile üslup arasında kusursuz biçimde dengelenen Kim; oturma odasından yatak odasına, konuttan ağırlama mekânlarına kadar her kurguya uyum sağlar.

Aile, kollu berjer ve yemek sandalyesi versiyonlarıyla sunulur.""",
    'ozzy': """Ozzy; kullanımda çok yönlü, tasarımda özgün ve titizlikle üretilmiş bir oturma birimidir. Küçültülmüş oranlarıyla evin bir odasından diğerine kolayca taşınabilen göçebe bir karaktere sahiptir.

Ailenin ayırt edici detayı, dış sırtı kaplayan deridir; bu yüzey, kumaş ya da deri seçenekleriyle sunulan oturum döşemesiyle zarif kombinasyonlar kurar. Metal döner ayak üzerine oturan berjer versiyonu, oturuma olağanüstü bir konfor katan yumuşak kaz tüyü minderlerle tamamlanır.

Aile; berjer ve yemek sandalyesi versiyonlarını kapsar.""",
    'eri': """Zarif biçimde kaldırılmış ceket yakaları, Eri ailesinin ince tasarımına ilham verdi. Berjer, puf ve orta sehpalardan oluşan aile; yumuşak ve sarmalayan üslup imzasıyla derin bir rahatlama duygusu kurmak üzere tasarlandı.

Ailenin ayırt edici özelliği, zarif yüzey seçenekleriyle sunulan metal ayaktır. Cömertçe doldurulmuş oturum minderi en üst düzey konforu sağlar ve geniş bir kumaş ile deri döşeme yelpazesinde sunulur.

Aile; kollu berjer ve puf versiyonlarını kapsar.""",
    'loungescape': """Loungescape, Antonio Citterio'nun kanepeyi yaşam alanını dönüştürebilecek çok yönlü bir parça olarak tasarladığı bir oturma sistemidir. Arazinin konturlarının bir peyzajı belirlemesi gibi, Loungescape de evin atmosferini biçimlendirir; mekânın odak noktasına yerleşerek konfor ve güzelliğe yeni bakış açıları sunar.

Sistemin kendine özgü tek parça strüktürü, yumuşak minderleri uyumlu bir bütün hâlinde bir araya getirir. Organik formlar; oranlar ile eğim açıları arasındaki ideal dengenin ilkelerine dayanılarak titizlikle geliştirilmiştir.

Loungescape'in imza detayı, monolitik sağlamlık izleniminin karşısına strüktüre hafiflik katan eğimli kaidesidir. Modülerliği ve ölçü seçenekleri, sistemi berjerden çok kişilik kanepeye uzanan geniş bir kurgu yelpazesine açar.""",
    'camelot': """İleri düzey modülerlik ve yüksek konfor ölçütlerine göre tasarlanan Camelot oturma sistemi; modüllerin birleştirilebilirliği ve malzemelerin eşleştirilebilmesi sayesinde büyük ölçüde kişiselleştirilmiş kurgulara olanak tanır.

Görsel olarak sistem, metal taşıyıcılar ile ahşap veya deri kaplı silindirik çubuktan oluşan strüktürün biçimsel sadeliği ile döşemeli öğelerin davetkâr yumuşaklığı arasında ilgi çekici bir karşıtlık sunar.

Farklı genişlik ve derinlikteki çok sayıda öğeden oluşan geniş ürün gamı, en çeşitli mekânlara uygun kurgu olanaklarını en üst düzeye çıkarır. Sırt minderleri cömert oranlara ve sarmalayan kaz tüyü dolguya sahiptir.""",

    # --- Varaschin ---
    'emma': """Sırtın ikonik el dokuması ve çok sayıda kişiselleştirme olanağı, zarif Emma koltuğunu vazgeçilmez kılmıştır. Kalıplanmış plastik oturum, suyun tahliyesine izin verdiği için dış mekân kullanımına idealdir.

Emma Cross versiyonu ise bir çiçeğin tacından esinlenen sarmalayan tasarımıyla öne çıkar: akrilik kumaştan bant, alüminyum çerçeveyi kaplayan halat dokumanın üzerine binerek sırt yüzeyini çapraz çizgilerle çizer. Bu çift dokuma, koltuğun ikonik motifine dönüşmüştür.

Aile; hem konut hem de ağırlama projelerinde kullanılan iki dokuma versiyonuyla sunulur.""",

    # --- Nurus ---
    'toya': """Toya, Nurus çalışma sandalyesi ailesinin en çok yönlü oturma çözümüdür ve çalışma alanlarının tüm ihtiyaçlarını karşılamak için dokuz farklı varyasyon sunar. İster bir ofisi tümüyle donatın, ister evdeki çalışma alanı için doğru sandalyeyi seçin; Toya her gereksinime uygun bir seçenek sunar.

Sekiz derecelik sırt eğimi desteği ve konforlu oturumuyla uzun çalışma saatlerinde vücudu ve hareketleri destekler. Güçlü tekerlekleri gün içinde yerinden kalkmadan hareket etmeyi sağlar; tekerlek frenleri sayesinde üzerinden kalkıldığında yerinde durur. Boy ayarı mekanizması sayesinde yıldız ayaklı versiyonlar her kullanıcının boyuna kolayca uyarlanabilir.

Aile; alçak, orta ve yüksek sırt yükseklikleri ile 5 yıldız, sabit ve ahşap ayak seçeneklerinin kombinasyonlarından oluşur.""",
    'alava': """Alava, yalın çizgileri ve ince profiliyle çalışma alanlarına sakin bir karakter taşıyan bir oturma birimidir. Döşemeli sırt ve oturum, uzun süreli kullanımda konforu korurken; ince gövde, mekânda görsel bir hafiflik bırakır.

Aile; toplantı ve çalışma masası çevresinde farklı kullanım senaryolarına yanıt veren 4 yıldız ayak, 5 yıldız ayak ve ahşap ayak versiyonlarıyla sunulur.""",
    'flora': """Flora, organik hatlarıyla çalışma ve toplantı alanlarına yumuşak bir ifade katan bir sandalye ailesidir. Sarmalayan sırt formu, kolçaksız kullanımda bile destekleyici bir oturum sunar.

Aile; hareketli kullanım için 4 yıldız ve 5 yıldız ayak, daha yerleşik kurgular için ise ahşap ayak versiyonlarıyla sunulur.""",
    'ron': """Ron, ofis ve toplantı alanları için tasarlanmış, sırt yüksekliğine göre farklılaşan bir çalışma koltuğu ailesidir. Döşemeli sırt ve oturum, gün boyu süren kullanımda dengeli bir destek sağlar.

Aile; kısa süreli oturumlar için alçak sırt, genel çalışma için orta sırt ve yönetici kullanımı için yüksek sırt versiyonlarıyla sunulur.""",
    'sacha': """Sacha, ince siluetini ergonomik bir sırt desteğiyle birleştiren bir çalışma koltuğu ailesidir. Sırt yüksekliği arttıkça destek alanı genişler; böylece aynı tasarım dili farklı kullanım sürelerine uyarlanır.

Aile; alçak, orta ve yüksek sırt versiyonlarıyla sunulur.""",
    'aura': """Aura, çalışma alanlarında hem masa başı hem de dinlenme kurgularına yanıt veren bir oturma ailesidir. Sarmalayan gövde formu, kullanıcıyı çevreleyerek odaklanmayı destekleyen yarı-özel bir alan kurar.

Aile; standart çalışma versiyonu, daha derin oturumlu lounge versiyonu ve yüksek sırt versiyonuyla sunulur.""",
    'metope': """Metope, yalın geometrisi ve net hatlarıyla çalışma ve ağırlama alanlarına uyum sağlayan bir sandalyedir. Döşemeli oturum ve sırt, uzun toplantılarda konforu korur.

Aile; standart ayak ve ahşap ayak versiyonlarıyla sunulur.""",
    'trea': """Trea, çalışma ve toplantı alanları için tasarlanmış çok yönlü bir sandalye ailesidir. İnce kabuk formu, istiflenebilirlik ve hafiflikle birlikte gün boyu kullanımda konfor sağlar.

Aile; sandalye, toplantı ve U formlu sandalye versiyonlarıyla sunulur.""",
    't-mec': """T-Mec, çalışma masalarına esneklik kazandıran bir masa sistemidir. Taşıyıcı strüktürü kablo yönetimini gövdeye gizler; farklı tabla ölçüleri ve bağlantı seçenekleriyle bireysel çalışma alanlarından bench kurgularına uzanır.

Aile; standart T-Mec ve daha yüksek taşıma kapasitesi ile genişletilmiş donanım seçenekleri sunan T-Mec Pro versiyonlarıyla sunulur.""",
    'mou': """Mou, ince kabuk formu ve esnek sırt yapısıyla gün boyu süren çalışma temposuna eşlik eden bir çalışma koltuğudur. Sırt, kullanıcının hareketine yanıt vererek sabit bir oturuş dayatmaz.

Aile; standart mekanizmalı Mou Pro ve oturumun öne eğimini ayarlamaya izin veren Mou Pro Front Tilt versiyonlarıyla sunulur.""",

    # --- Normod ---
    'klem': """Klem, yumuşak hatları ve derin oturumuyla oturma alanının merkezine yerleşen bir kanepe serisidir. Konik ahşap ayaklar gövdeye hafiflik katarken, geniş oturum minderleri uzun süreli kullanımda konforu korur.

Seri; tekli, ikili ve üçlü koltuk ile köşe kurgularını kapsar. Daha ince kolçak ve daha kompakt ölçülere sahip Klem Slim versiyonu, küçük ve orta ölçekli yaşam alanları için geliştirilmiştir. Tüm versiyonlar kadife kumaş, ayak rengi ve sırt minderi tipi seçenekleriyle kişiselleştirilebilir.""",
    'carle': """Carle, çift kolçaklı gövdesi ve fitilli kadife dokusuyla klasik bir kanepe siluetini çağdaş oranlarla yeniden yorumlar. Yumuşak sırt minderleri ve geniş oturum, günlük kullanımda rahat bir dinlenme alanı kurar.

Seri; tekli ve üçlü koltuk versiyonlarının yanı sıra üçlü koltuğun puflu kurgusuyla sunulur.""",
})

# --------------------------------------------------------------------------------------------
# ANA ÜRÜNLER — sıra ÖNEMSİZ: içe aktarma betiği bu listeyi markalar arasında dönüşümlü (round
# robin) olarak yeniden diziyor, böylece katalogda ve anasayfada aynı markanın ürünleri peş peşe
# çıkmıyor (kullanıcı isteği: "marka marka peş peşe değil, karışık bir sıra"). Sıralamanın kendisi
# `products.id` üzerinden okunduğundan (bkz. src/routes/product.js — varsayılan ORDER BY id DESC),
# karıştırma INSERT sırasında yapılır; sorgu tarafında rastgelelik YOKTUR (aksi halde sayfalama
# tutarsızlaşır ve KV önbelleği her istekte farklı sonuç üretirdi).
#
# Alanlar:
#   key       : açıklama sözlüğü anahtarı + slug tabanı
#   title     : katalogda görünen Türkçe ad (ANA ÜRÜN)
#   brand     : offices.slug (var olan ya da BRANDS'te tanımlı yeni marka)
#   cat       : catalog-taxonomy.js kategorisi
#   designer  : serbest metin (sitede kayıtlıysa product-modal.js chip'e çevirir)
#   desc      : DESCRIPTIONS anahtarı; None ise ilk versiyonun kaynak metni Türkçeleştirilmemiş
#               şekilde KULLANILMAZ — bunun yerine `desc_tr` alanı zorunludur
#   desc_tr   : tek versiyonlu ürünlerde doğrudan Türkçe metin
#   variants  : [{url, label, options:[(eksen, değer)]}] — TEK elemanlıysa seçici gösterilmez
# --------------------------------------------------------------------------------------------

A = 'https://archello.com/product/'
N = 'https://nurus.com/tr/product/'
M = 'https://normod.com/products/'

FAMILIES = [
    # ---------------- TON ----------------
    {'key': 'delta', 'title': 'Delta Orta Sehpa', 'brand': 'ton-design', 'cat': 'Masa',
     'designer': 'Kai Stania',
     'desc_tr': """Avusturyalı Kai Stania'nın tasarladığı Delta sehpa hem zarif hem kullanışlıdır. Minimalist tasarım ve masif ahşap, ofiste de evde de yerini kolayca bulur; ince ayaklar rahat bir oturuşun önüne geçmez.

Farklı çaplarda üretilen Delta orta sehpalar, bulundukları mekânın ölçüsüne göre tek başına ya da gruplar hâlinde kullanılabilir.""",
     'variants': [{'url': A + 'delta-coffee-table', 'label': 'Delta Orta Sehpa', 'options': []}]},

    {'key': 'easy-mix-fix', 'title': 'Easy Mix & Fix Masa Sistemi', 'brand': 'ton-design', 'cat': 'Masa',
     'designer': 'TON Ar-Ge',
     'desc_tr': """Easy Mix & Fix masaları, ağırlama sektörünün her tür iç mekânı için geliştirilmiş modüler bir sistemdir. Ekonomik olmasına karşın güzellikten ve kaliteden ödün vermez; ayarlı vidalara sahip metal kaide masanın dengesini garanti eder.

Sistem hem yemek masası hem bar masası yüksekliğinde üretilir; farklı tabla ölçüleri ve kaide tipleriyle birlikte kurgulanabilir.""",
     'variants': [{'url': A + 'easy-mix-fix-table', 'label': 'Easy Mix & Fix Masa', 'options': []}]},

    {'key': 'ode-to-the-fourteen', 'title': 'Ode to the Fourteen Sandalye', 'brand': 'ton-design',
     'cat': 'Sandalye & Tabure', 'designer': 'Jiří Krejčiřík',
     'desc_tr': """"Ode to the Fourteen, benim için TON'un kimliğini cisimleştiren ikonik No. 14 modeline bir saygı duruşudur" diyor Jiří Krejčiřík. Tasarımcı, sırtlık bölgesinde tamamlanan kendine özgü dairesel bükümlerle modeli bir sanat nesnesine dönüştürüyor.

Sandalye, TON'un ahşap bükme teknolojisinin ulaştığı sınırı gösteren bir ustalık gösterisi olarak masif kayın ağacından üretilir.""",
     'variants': [{'url': A + 'ode-to-the-fourteen', 'label': 'Ode to the Fourteen', 'options': []}]},

    {'key': 'again', 'title': 'Again Sandalye Ailesi', 'brand': 'ton-design', 'cat': 'Sandalye & Tabure',
     'designer': 'Alex Gufler', 'desc': 'again',
     'variants': [
         {'url': A + 'again-chair-2', 'label': 'Again Sandalye', 'options': [('Tip', 'Sandalye')]},
         {'url': A + 'again-barstool', 'label': 'Again Bar Taburesi', 'options': [('Tip', 'Bar Taburesi')]},
     ]},

    {'key': 'split', 'title': 'Split Sandalye', 'brand': 'ton-design', 'cat': 'Sandalye & Tabure',
     'designer': 'Arik Levy',
     'desc_tr': """Tek bir ahşap parçayı boyuna yararak iki farklı yönde büken ve bu sayede konforlu bir oturumu taşıyan ilk üretici dünyada TON oldu.

Split sandalye, bu tekniğin doğrudan görünür kılındığı bir tasarımdır: yarılan ahşap, sırt ile oturumu tek bir sürekli hareketle taşır.""",
     'variants': [{'url': A + 'split-chair-2', 'label': 'Split Sandalye', 'options': []}]},

    {'key': 'chair-14', 'title': 'No. 14 Sandalye', 'brand': 'ton-design', 'cat': 'Sandalye & Tabure',
     'designer': 'TON Ar-Ge',
     'desc_tr': """No. 14 sandalye ilk kez 1859'da üretildi ve seri üretilen mobilyanın algısını kalıcı olarak değiştirdi. Zarif formu, hafifliği ve dayanıklılığı; erişilebilir fiyatıyla birleşerek modelin bugüne dek süren popülerliğini güvence altına aldı.

Bugüne kadar 80 milyondan fazla adet satılmıştır. Sandalye hâlâ aynı fabrikada, buharla bükülen masif kayın ağacından üretilmektedir.""",
     'variants': [{'url': A + '14-chair-2', 'label': 'No. 14 Sandalye', 'options': []}]},

    {'key': 'chair-18', 'title': 'No. 18 Sandalye', 'brand': 'ton-design', 'cat': 'Sandalye & Tabure',
     'designer': 'TON Ar-Ge',
     'desc_tr': """1876'da üretilen bu diğer klasik model, özgün kafe sandalyesi fikrini bir adım öteye taşır. No. 18, No. 14 sandalyeyle karşılaştırılabilir ölçüde hafif ve zariftir; ancak dayanıklılığı artırmak ve konforu güçlendirmek için düşey çubuklarla doldurulmuş bir sırtlığa sahiptir.

Model, kafe ve restoran iç mekânlarının klasik dağarcığında yerini korumaktadır.""",
     'variants': [{'url': A + '18-chair-2', 'label': 'No. 18 Sandalye', 'options': []}]},

    {'key': 'punton', 'title': 'Punton Sandalye', 'brand': 'ton-design', 'cat': 'Sandalye & Tabure',
     'designer': 'Tom Kelley',
     'desc_tr': """Klasik Punton ailesinin ana bileşeni yuvarlak oturumdur. Tasarımcı Tom Kelley bu öğeyi geleneksel bükme ahşap mobilya anlayışından alıp, karşıtlık kurmak üzere düz ayaklarla birleştirmiştir.

Sonuç; dikkat çeken, oturulduğunda ise beden ağırlığını dengeli biçimde taşıyan bir sandalyedir.""",
     'variants': [{'url': A + 'punton-chair-2', 'label': 'Punton Sandalye', 'options': []}]},

    {'key': 'la-zitta', 'title': 'La Zitta Sandalye Ailesi', 'brand': 'ton-design',
     'cat': 'Sandalye & Tabure', 'designer': 'Alexander Gufler', 'desc': 'la-zitta',
     'variants': [
         {'url': A + 'la-zitta', 'label': 'La Zitta Sandalye', 'options': [('Tip', 'Sandalye')]},
         {'url': A + 'la-zitta-bar-stool', 'label': 'La Zitta Bar Taburesi', 'options': [('Tip', 'Bar Taburesi')]},
     ]},

    {'key': 'merano', 'title': 'Merano Sandalye Ailesi', 'brand': 'ton-design',
     'cat': 'Sandalye & Tabure', 'designer': 'Alexander Gufler', 'desc': 'merano',
     'variants': [
         {'url': A + 'merano-chair-2', 'label': 'Merano Sandalye', 'options': [('Tip', 'Sandalye')]},
         {'url': A + 'merano-armchair-2', 'label': 'Merano Kollu Sandalye', 'options': [('Tip', 'Kollu Sandalye')]},
     ]},

    {'key': '811', 'title': '811 Kollu Sandalye', 'brand': 'ton-design', 'cat': 'Sandalye & Tabure',
     'designer': 'Josef Hoffmann',
     'desc_tr': """İyi tasarım eskimez. Bu model yaklaşık yüz yıl önce Avusturyalı Josef Hoffmann tarafından tasarlandı. Hoffmann, bükme ahşabı kullanarak bir klasik yarattı; model genellikle hasır örgüyle birleştirilerek son derece konforlu bir oturma deneyimi sunar.

Kollu versiyon, aynı silueti kolçaklarla genişleterek uzun süreli oturumlara uygun hâle getirir.""",
     'variants': [{'url': A + '811-armchair-2', 'label': '811 Kollu Sandalye', 'options': []}]},

    {'key': 'fleur', 'title': 'Fleur Portmanto', 'brand': 'ton-design', 'cat': 'Dolap & Depolama',
     'designer': 'Lubo Majer',
     'desc_tr': """Yalın bir portmanto olan Fleur, tümüyle geleneksel el ile ahşap bükme süreçlerinden esinlenmiştir. Üç parça kayın ağacı, asılması gereken her giysi için dengeli bir askı oluşturur.

Pigmentli yüzeylerde özellikle etkileyici görünen tasarım, Slovak tasarımcı Lubo Majer'in imzasını taşır.""",
     'variants': [{'url': A + 'fleur-coat-stand', 'label': 'Fleur Portmanto', 'options': []}]},

    {'key': 'ink', 'title': 'Ink Yemek Masası', 'brand': 'ton-design', 'cat': 'Masa',
     'designer': 'Michal Riabič',
     'desc_tr': """Doğal yüzeyiyle dikkat çeken Ink masa, köşelerden doğal biçimde uzanan üçgen ayaklarıyla diğerlerinden ayrılır. Bu mutlak klasik; markanın en eski ikonik modelleriyle de, en yeni tasarımlarıyla da bir arada kullanılabilir.

Tasarım Michal Riabič'e aittir.""",
     'variants': [{'url': A + 'ink-table', 'label': 'Ink Yemek Masası', 'options': []}]},

    {'key': 'lasu', 'title': 'Lasu Masa', 'brand': 'ton-design', 'cat': 'Masa',
     'designer': 'Alexander Gufler',
     'desc_tr': """Net formlar ve çeşitli yüzey seçenekleri Lasu masayı pek çok kurguya uygun kılar; tasarımcısı Alexander Gufler'dir.

Lasu masalar istiflenebilir; ayrıca birbirine bağlanarak yemekhane, konferans salonu ve ofislerde kullanılmak üzere daha büyük birimler oluşturacak biçimde birleştirilebilir.""",
     'variants': [{'url': A + 'lasu-table', 'label': 'Lasu Masa', 'options': []}]},

    {'key': 'pov-plus', 'title': 'P.O.V. Plus Toplantı Masası Sistemi', 'brand': 'ton-design',
     'cat': 'Ofis Mobilyası', 'designer': 'KASCHKASCH',
     'desc_tr': """Alman stüdyo KASCHKASCH imzalı, 6 metreyi aşan modüler bir kurgu özgürlüğü. Bu masa sistemi kullanıcının üslubuna uyum sağlar; istendiği kadar iddialı ya da sakin olabilir. Her şey bakış açısına (point of view) bağlıdır.

Gövdeye entegre elektrik kanalı ve geniş konfigürasyon seçenekleri, geleneksel ofis kurgularına bakışı da değiştirir.""",
     'variants': [{'url': A + 'pov-plus', 'label': 'P.O.V. Plus', 'options': []}]},

    # ---------------- Pedrali ----------------
    {'key': 'volt', 'title': 'Volt 678/2 Bar Taburesi', 'brand': 'pedrali', 'cat': 'Sandalye & Tabure',
     'designer': 'Claudio Dondoli & Marco Pocci',
     'desc_tr': """Volt koleksiyonu zarif ve sıcak bir karaktere sahiptir. İnce kesitini ergonomik formu ve dengeli oranlarıyla birleştirir.

Bar taburesi, cam elyaf takviyeli polipropilenden gaz destekli enjeksiyon kalıplama yöntemiyle üretilir. Oturum kumaş ya da suni deri ile döşenir.""",
     'variants': [{'url': A + 'volt-6782', 'label': 'Volt 678/2', 'options': []}]},

    {'key': 'noa', 'title': 'NOA 726 Kollu Sandalye', 'brand': 'pedrali', 'cat': 'Sandalye & Tabure',
     'designer': 'Marc Sadler',
     'desc_tr': """Noa koleksiyonu, oranlarının zarafetini oturumun konforuyla birleştirir; bunu yenilikçi bir üretim tekniğine borçludur.

Kollu sandalye, polikarbonat sırt kabuğu ve döşemeli oturumdan oluşur. Gövde Ø16 mm çelik borudan üretilmiştir.""",
     'variants': [{'url': A + 'noa-726', 'label': 'NOA 726', 'options': []}]},

    {'key': 'ikon', 'title': 'IKON 862 Bar Taburesi', 'brand': 'pedrali', 'cat': 'Sandalye & Tabure',
     'designer': 'Pio & Tito Toso',
     'desc_tr': """Ikon oturma koleksiyonu, güzellik ile işlevselliğin sentezinden doğar.

Bar taburesi; enjeksiyon kalıplama polipropilenden üretilen konik kaideye ve kumaşla döşenmiş poliüretan enjeksiyon süngerli oturuma sahiptir.""",
     'variants': [{'url': A + 'ikon-862', 'label': 'IKON 862', 'options': []}]},

    # ---------------- Investwood / Valchromat ----------------
    {'key': 'valchromat-strabello', 'title': 'Valchromat Strabello Tabure ve Sehpa Ailesi',
     'brand': 'investwood', 'cat': 'Sandalye & Tabure', 'designer': 'Bravate Artigiane',
     'desc_tr': """Strabello ailesi; alçak taburelerden, yüksek taburelerden ve iki farklı ölçüdeki orta sehpalardan oluşur. Parçalar çok çeşitli biçimlerde kullanılabilir ve her mekâna yerleştirilebilir.

Ürün ailesinin arkasındaki fikir, gereksiz olanı çıkarmakta (az çoktur felsefesi), sürdürülebilirliğe odaklanarak şeylerin özüne dönmekte ve çoğu zaman karmaşıklaştırılan bir aşamayı basitleştirmekte yatar: mobilyanın montajı.

Strabello'yu kurmak için yalnızca iki adım yeterlidir: önce ayaklar birbirinin içine geçirilerek sabitlenir, ardından tabla (oturum) ayakların üzerine yerleştirilerek bütün kilitlenir. Parçalar kütlesel renkli Valchromat panelden üretilir.""",
     'variants': [{'url': A + 'valchromat-strabello', 'label': 'Strabello', 'options': []}]},

    {'key': 'valchromat-commuting', 'title': 'Valchromat Commuting Table Çalışma Masası',
     'brand': 'investwood', 'cat': 'Masa', 'designer': 'Dear Objects – Marc Meeuwissen',
     'desc_tr': """Evden çalışma için tasarlanmış, yemek masası ile çalışma masası arasında dönüşümlü kullanılabilen çok işlevli bir masa. Tasarım, pandemi döneminde ve o dönemden esinlenerek üretildi.

Tek parça katmanlardan kurulan gövde, tek bir Valchromat levhadan (açık gri ve turuncu) elde testereyle kesilerek biçimlendirilmiştir. Yüzeyler kısmen renkli talaşla kaplanmış ve su bazlı vernikle korunmuştur.

Ölçüler: y 870 × g 690 × d 850 mm.""",
     'variants': [{'url': A + 'valchromat-commuting-table', 'label': 'Commuting Table', 'options': []}]},

    {'key': 'valchromat-movl', 'title': 'Valchromat MOVL Sökülebilir Mobilya Sistemi',
     'brand': 'investwood', 'cat': 'Sandalye & Tabure', 'designer': 'Pedro Fonseca Jorge',
     'desc_tr': """Bu proje, istikrarın çoğu zaman bir efsane olduğu çağdaş yaşam düşünülerek kurgulandı; iş, yaşam biçimi, ev, şehir ve hatta ülke sürekli değişiyor.

Amaç, bu yeni göçebelere her "durakta" geçici parçalarla yetinmek yerine yanlarında taşıyabilecekleri mobilyalara sahip olma imkânı sunmaktı — hem estetik değerden hem de tekrarlanan taşınmalara dayanacak nitelikten yoksun ürünlerin yerine geçecek parçalar.

Bu nedenle önerinin; vida ya da çivi kullanmadan kolay kurulup sökülebilme özelliğini, taşınmaya değecek kadar arzu edilir bir estetikle birleştirmesi zorunluydu.""",
     'variants': [{'url': A + 'valchromat-movl', 'label': 'MOVL', 'options': []}]},

    # ---------------- Varaschin ----------------
    {'key': 'babylon', 'title': 'Babylon Berjer', 'brand': 'varaschin', 'cat': 'Bahçe Mobilyası',
     'designer': 'Giopato & Coombes',
     'desc_tr': """Sağlam bir strüktür Babylon berjerin sırtını sarar. Bu strüktür üzerinde, kolçaktan kolçağa düşey çizgiler hâlinde bir dokuma gelişir. Uçlardaki iki büyük tutamak, oturağı kavrayıp kolayca taşımayı sağlar.

Ev bahçesinden gösterişli bir mekânın dış alanına kadar Babylon berjer, açık hava keyfini yaşamak için doğru atmosferi kurar.""",
     'variants': [{'url': A + 'babylon-armchair', 'label': 'Babylon Berjer', 'options': []}]},

    {'key': 'clever-bucket', 'title': 'Clever Bucket Kollu Sandalye', 'brand': 'varaschin',
     'cat': 'Bahçe Mobilyası', 'designer': 'Varaschin Ar-Ge',
     'desc_tr': """Yumuşak eğriler, Clever bucket sandalyenin sırtını ve kolçaklarını çizer. Hafif ve zarif olan bu oturma birimi; dış mekânı, bir restoranın verandasını ya da özel bir konutun açık hava yemek alanını donatmak için ideal seçimdir.

Kabuk döşemesinde kullanılan VAR#TEX kumaş özellikle dış mekân için geliştirilmiştir ve sandalyenin her hava koşuluna karşı üstün dayanımını güvence altına alır.""",
     'variants': [{'url': A + 'clever-bucket-armchair', 'label': 'Clever Bucket', 'options': []}]},

    {'key': 'smart', 'title': 'Smart Kollu Yemek Sandalyesi', 'brand': 'varaschin',
     'cat': 'Bahçe Mobilyası', 'designer': 'Varaschin Ar-Ge',
     'desc_tr': """Smart koltuğun tasarımı, sırtı çizen sarmalayan eğri ile sentetik VAR#TEX halat dokumanın dinamik düşeyliği arasındaki kusursuz dengeden doğar.

Hafif ve kolay taşınabilir olan Smart koltuklar dörtlü gruplar hâlinde istiflenebilir; bu nitelik onları ağırlama projelerinin dış mekânları için doğru seçim hâline getirir.""",
     'variants': [{'url': A + 'smart-dining-armchair', 'label': 'Smart', 'options': []}]},

    {'key': 'noss', 'title': 'Noss Kollu Yemek Sandalyesi', 'brand': 'varaschin',
     'cat': 'Bahçe Mobilyası', 'designer': 'Edoardo Gherardi',
     'desc_tr': """Elde örülmüş sentetik halatların yoğun dokuması, Noss koltuğun sırtını kolçaktan kolçağa uyumlu ve hafif bir şerit gibi çizer. Yumuşak ve zarif eğriler strüktürü tanımlar; konfor ile dayanıklılığı kusursuz bir dengede birleştirir.

Noss en iyi hâlini gün batımında bulur: güneş ışınları, kendine özgü sırtlığın dinamik dokusunu parlatır. Çok yönlü ve kolay taşınabilir olan Noss koltuklar dörtlü gruplar hâlinde istiflenebilir.""",
     'variants': [{'url': A + 'noss-dining-armchair', 'label': 'Noss', 'options': []}]},

    {'key': 'plinto', 'title': 'Plinto Kollu Yemek Sandalyesi', 'brand': 'varaschin',
     'cat': 'Bahçe Mobilyası', 'designer': 'Pio & Tito Toso',
     'desc_tr': """Mimarlar Pio ve Tito Toso'nun masa kaidesi koleksiyonu, iki versiyonda sunulan bir kollu yemek sandalyesiyle genişledi. Her iki versiyon da elektrostatik toz boyalı alüminyumdan üretilmiş ve sentetik fiberden konforlu, zarif bir sırtlığa sahiptir.

İlk versiyon, halat dokumayla kaplanmış toz boyalı alüminyum borudan oluşan dokuma oturumludur; ikinci seçenek ise kolayca çıkarılıp yıkanabilen bir minder kılıfının eklenmesiyle daha da konforludur.

Sandalye, strüktür için dokuz farklı renk seçeneğiyle sunulur ve aynı koleksiyondaki tüm masalarla kusursuz biçimde eşleşecek şekilde tasarlanmıştır.""",
     'variants': [{'url': A + 'plinto-dining-armchair', 'label': 'Plinto', 'options': []}]},

    {'key': 'cricket', 'title': 'Cricket Kollu Yemek Sandalyesi', 'brand': 'varaschin',
     'cat': 'Bahçe Mobilyası', 'designer': 'Anki Gneib',
     'desc_tr': """Cricket koltuğa biçimini veren şey, iyi kurgulanmış bir dokuma oyunudur; hafiflik ve zarafet bu tasarımın üslup imzasıdır.

Özgün karakteri ve rafine dokuması sayesinde Cricket, mimarların ve tasarımcıların en çok tercih ettiği koleksiyonlardan birine dönüşmüştür; hem konut hem ağırlama projelerinin dış mekânlarında kullanılır.""",
     'variants': [{'url': A + 'cricket-dining-armchair', 'label': 'Cricket', 'options': []}]},

    {'key': 'tibidabo', 'title': 'Tibidabo Berjer', 'brand': 'varaschin', 'cat': 'Bahçe Mobilyası',
     'designer': 'Calvi Brambilla',
     'desc_tr': """Zarif ve ince olan Tibidabo koltuk, kendine özgü kum saati formuyla öne çıkar.

Boyalı metal strüktür, sırtın ve kaidenin eğrilerini çizer; bu strüktür üzerinde güçlü bir düşeyliğe sahip sentetik fiber halat dokuma biçimlenir.

Tibidabo'da oturmak; kendi bahçenizde ya da gözde bir mekânın ayrıcalıklı terasında, dış mekânda nitelikli zaman geçirmek demektir.""",
     'variants': [{'url': A + 'tibidabo-dining-armchair', 'label': 'Tibidabo', 'options': []}]},

    {'key': 'emma', 'title': 'Emma Kollu Yemek Sandalyesi Ailesi', 'brand': 'varaschin',
     'cat': 'Bahçe Mobilyası', 'designer': 'Monica Armani', 'desc': 'emma',
     'variants': [
         {'url': A + 'emma-dining-armchair', 'label': 'Emma', 'options': [('Dokuma', 'Emma')]},
         {'url': A + 'emma-cross-dining-armchair', 'label': 'Emma Cross', 'options': [('Dokuma', 'Emma Cross')]},
     ]},

    # ---------------- Flexform ----------------
    {'key': 'luchino', 'title': 'Luchino Katlanır Sandalye Ailesi', 'brand': 'flexform',
     'cat': 'Sandalye & Tabure', 'designer': 'Antonio Citterio', 'desc': 'luchino',
     'variants': [
         {'url': A + 'luchino-armchair', 'label': 'Luchino Berjer (İç Mekân)',
          'options': [('Kullanım', 'İç Mekân'), ('Tip', 'Berjer')]},
         {'url': A + 'luchino-outdoor-dining-chairchair', 'label': 'Luchino Outdoor Yemek Sandalyesi',
          'options': [('Kullanım', 'Dış Mekân'), ('Tip', 'Yemek Sandalyesi')]},
     ]},

    {'key': 'kim', 'title': 'Kim Koltuk Ailesi', 'brand': 'flexform', 'cat': 'Koltuk & Kanepe',
     'designer': 'Antonio Citterio', 'desc': 'kim',
     'variants': [
         {'url': A + 'kim-armchair', 'label': 'Kim Berjer', 'options': [('Tip', 'Berjer')]},
         {'url': A + 'kim-dining-chairchair', 'label': 'Kim Yemek Sandalyesi', 'options': [('Tip', 'Yemek Sandalyesi')]},
     ]},

    {'key': 'ozzy', 'title': 'Ozzy Koltuk Ailesi', 'brand': 'flexform', 'cat': 'Koltuk & Kanepe',
     'designer': 'Patrick Norguet', 'desc': 'ozzy',
     'variants': [
         {'url': A + 'ozzy-armchair', 'label': 'Ozzy Berjer', 'options': [('Tip', 'Berjer')]},
         {'url': A + 'ozzy-dining-chairchair', 'label': 'Ozzy Yemek Sandalyesi', 'options': [('Tip', 'Yemek Sandalyesi')]},
     ]},

    {'key': 'eri', 'title': 'Eri Koltuk Ailesi', 'brand': 'flexform', 'cat': 'Koltuk & Kanepe',
     'designer': 'Fumie Shibata', 'desc': 'eri',
     'variants': [
         {'url': A + 'eri-armchair', 'label': 'Eri Berjer', 'options': [('Tip', 'Berjer')]},
         {'url': A + 'eri-ottoman', 'label': 'Eri Puf', 'options': [('Tip', 'Puf')]},
     ]},

    {'key': 'loungescape', 'title': 'Loungescape Oturma Sistemi', 'brand': 'flexform',
     'cat': 'Koltuk & Kanepe', 'designer': 'Antonio Citterio', 'desc': 'loungescape',
     'variants': [
         {'url': A + 'loungescape-sofa', 'label': 'Loungescape Kanepe', 'options': [('Tip', 'Kanepe')]},
         {'url': A + 'loungescape-armchair', 'label': 'Loungescape Berjer', 'options': [('Tip', 'Berjer')]},
     ]},

    {'key': 'camelot', 'title': 'Camelot Modüler Kanepe', 'brand': 'flexform', 'cat': 'Koltuk & Kanepe',
     'designer': 'Antonio Citterio', 'desc': 'camelot',
     'variants': [{'url': A + 'camelot-sofa', 'label': 'Camelot Kanepe', 'options': []}]},

    # ---------------- SNOC ----------------
    {'key': 'alvo-corner', 'title': 'Alvo Bisque Köşe Modülü', 'brand': 'snoc', 'cat': 'Koltuk & Kanepe',
     'designer': None, 'desc': 'alvo',
     'variants': [{'url': A + 'alvo-bisque-corner-module', 'label': 'Bisque Köşe Modülü', 'options': []}]},

    {'key': 'caleo-modular', 'title': 'Caleo Modüler Oturma Serisi', 'brand': 'snoc',
     'cat': 'Koltuk & Kanepe', 'designer': None, 'desc': 'caleo',
     'variants': [
         {'url': A + 'caleo-ash-1-seater-central-module', 'label': 'Ash Tekli Orta Modül',
          'options': [('Kaplama', 'Ash'), ('Modül', 'Tekli Orta Modül')]},
         {'url': A + 'caleo-natural-2-seater-left-module', 'label': 'Natural İkili Sol Modül',
          'options': [('Kaplama', 'Natural'), ('Modül', 'İkili Sol Modül')]},
     ]},

    {'key': 'whale', 'title': 'Whale Dış Mekân Koleksiyonu', 'brand': 'snoc', 'cat': 'Koltuk & Kanepe',
     'designer': None, 'desc': 'whale',
     'variants': [
         {'url': A + 'whale-noche-armchair-2', 'label': 'Noche Berjer',
          'options': [('Kaplama', 'Noche'), ('Ürün Tipi', 'Berjer')]},
         {'url': A + 'whale-noche-dining-chair-2', 'label': 'Noche Yemek Sandalyesi',
          'options': [('Kaplama', 'Noche'), ('Ürün Tipi', 'Yemek Sandalyesi')]},
         {'url': A + 'whale-noche-daybed-2', 'label': 'Noche Uzanma Koltuğu',
          'options': [('Kaplama', 'Noche'), ('Ürün Tipi', 'Uzanma Koltuğu')]},
         {'url': A + 'whale-ash-2-seater-sofa-2', 'label': 'Ash İkili Kanepe',
          'options': [('Kaplama', 'Ash'), ('Ürün Tipi', 'İkili Kanepe')]},
         {'url': A + 'whale-ash-daybed-2', 'label': 'Ash Uzanma Koltuğu',
          'options': [('Kaplama', 'Ash'), ('Ürün Tipi', 'Uzanma Koltuğu')]},
         {'url': A + 'whale-ash-dining-table-2', 'label': 'Ash Yemek Masası',
          'options': [('Kaplama', 'Ash'), ('Ürün Tipi', 'Yemek Masası')]},
     ]},

    {'key': 'sestri', 'title': 'Sestri Dış Mekân Koleksiyonu', 'brand': 'snoc', 'cat': 'Masa',
     'designer': None, 'desc': 'sestri',
     'variants': [
         {'url': A + 'sestri-terra-m-size-coffee-table', 'label': 'Terra M Boy Orta Sehpa',
          'options': [('Renk', 'Terra'), ('Ürün / Ebat', 'M Boy Orta Sehpa')]},
         {'url': A + 'sestri-bisque-s-size-coffee-table', 'label': 'Bisque S Boy Orta Sehpa',
          'options': [('Renk', 'Bisque'), ('Ürün / Ebat', 'S Boy Orta Sehpa')]},
         {'url': A + 'sestri-bisque-m-size-coffee-table', 'label': 'Bisque M Boy Orta Sehpa',
          'options': [('Renk', 'Bisque'), ('Ürün / Ebat', 'M Boy Orta Sehpa')]},
         {'url': A + 'sestri-nightfall-s-size-coffee-table', 'label': 'Nightfall S Boy Orta Sehpa',
          'options': [('Renk', 'Nightfall'), ('Ürün / Ebat', 'S Boy Orta Sehpa')]},
         {'url': A + 'sestri-nightfall-m-size-coffee-table', 'label': 'Nightfall M Boy Orta Sehpa',
          'options': [('Renk', 'Nightfall'), ('Ürün / Ebat', 'M Boy Orta Sehpa')]},
         {'url': A + 'sestri-nightfall-director-chair', 'label': 'Nightfall Yönetmen Sandalyesi',
          'options': [('Renk', 'Nightfall'), ('Ürün / Ebat', 'Yönetmen Sandalyesi')]},
     ]},

    {'key': 'savio-140', 'title': 'Savio Noche 140 cm Yuvarlak Yemek Masası', 'brand': 'snoc',
     'cat': 'Masa', 'designer': None, 'desc': 'savio',
     'variants': [{'url': A + 'savio-noche-140-cm-round-dining-table',
                   'label': 'Noche 140 cm Yuvarlak', 'options': []}]},

    # ---------------- Normod ----------------
    {'key': 'klem', 'title': 'Klem Kanepe Serisi', 'brand': 'normod', 'cat': 'Koltuk & Kanepe',
     'designer': None, 'desc': 'klem',
     'variants': [
         {'url': M + 'klem-tekli-koltuk-ahsap-ayak-kadife', 'label': 'Klem Tekli Koltuk',
          'options': [('Seri', 'Klem'), ('Ebat', 'Tekli Koltuk')]},
         {'url': M + 'klem-uclu-koltuk-ahsap-ayak-kadife', 'label': 'Klem Üçlü Koltuk',
          'options': [('Seri', 'Klem'), ('Ebat', 'Üçlü Koltuk')]},
         {'url': M + 'klem-290-x-290-kose-ahsap-ayak-kadife', 'label': 'Klem 290 × 290 Köşe',
          'options': [('Seri', 'Klem'), ('Ebat', 'Köşe Koltuk')]},
         {'url': M + 'klem-slim-tekli-koltuk-ahsap-ayak-kadife', 'label': 'Klem Slim Tekli Koltuk',
          'options': [('Seri', 'Klem Slim'), ('Ebat', 'Tekli Koltuk')]},
         {'url': M + 'klem-slim-ikili-koltuk-ahsap-ayak-kadife', 'label': 'Klem Slim İkili Koltuk',
          'options': [('Seri', 'Klem Slim'), ('Ebat', 'İkili Koltuk')]},
         {'url': M + 'klem-slim-283-x-203-kose-ahsap-ayak-kadife', 'label': 'Klem Slim 283 × 203 Köşe',
          'options': [('Seri', 'Klem Slim'), ('Ebat', 'Köşe Koltuk')]},
     ]},

    {'key': 'carle', 'title': 'Carle Kanepe Serisi', 'brand': 'normod', 'cat': 'Koltuk & Kanepe',
     'designer': None, 'desc': 'carle',
     'variants': [
         {'url': M + 'carle-tekli-koltuk-cift-kollu-fitilli-kadife', 'label': 'Carle Tekli Koltuk',
          'options': [('Ebat', 'Tekli Koltuk')]},
         {'url': M + 'carle-uclu-koltuk-cift-kollu-fitilli-kadife', 'label': 'Carle Üçlü Koltuk',
          'options': [('Ebat', 'Üçlü Koltuk')]},
         {'url': M + 'carle-uclu-koltuk-cift-kollu-ve-puf-fitilli-kadife', 'label': 'Carle Üçlü Koltuk + Puf',
          'options': [('Ebat', 'Üçlü Koltuk + Puf')]},
     ]},

    {'key': 'levy', 'title': 'Levy Meşe Berjer', 'brand': 'normod', 'cat': 'Koltuk & Kanepe',
     'designer': None,
     'desc_tr': """Levy, masif meşe iskeleti ve yumuşak kadife döşemesiyle oturma alanına sıcak bir odak kuran bir berjerdir. Sarmalayan sırt formu, tek başına kullanıldığında bile mekânda kendi köşesini tanımlar.

Kadife kumaş ve ayak rengi seçenekleriyle kişiselleştirilebilir.""",
     'variants': [{'url': M + 'levy-mese-berjer-kadife', 'label': 'Levy Meşe Berjer', 'options': []}]},

    {'key': 'modsy', 'title': 'Modsy Berjer', 'brand': 'normod', 'cat': 'Koltuk & Kanepe',
     'designer': None,
     'desc_tr': """Modsy, geniş oturumu ve alçak sırt yüksekliğiyle rahat bir dinlenme koltuğudur. Konik ahşap ayaklar gövdeyi yerden yükselterek silueti hafifletir.

Kadife kumaş ve ayak rengi seçenekleriyle kişiselleştirilebilir.""",
     'variants': [{'url': M + 'modsy-kadife-berjer-ahsap-ayak', 'label': 'Modsy Berjer', 'options': []}]},

    # ---------------- Nurus ----------------
    {'key': 'toya', 'title': 'Toya Çalışma Koltuğu Ailesi', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None, 'desc': 'toya',
     'variants': [
         {'url': N + 'toya-family-tr/toya-alcak-sirt-5-yildiz-ayak/', 'label': 'Alçak Sırt · 5 Yıldız Ayak',
          'options': [('Sırt Yüksekliği', 'Alçak Sırt'), ('Ayak Tipi', '5 Yıldız Ayak')]},
         {'url': N + 'toya-family-tr/toya-alcak-sirt-sabit-ayak/', 'label': 'Alçak Sırt · Sabit Ayak',
          'options': [('Sırt Yüksekliği', 'Alçak Sırt'), ('Ayak Tipi', 'Sabit Ayak')]},
         {'url': N + 'toya-family-tr/toya-alcak-sirt-ahsap-ayak/', 'label': 'Alçak Sırt · Ahşap Ayak',
          'options': [('Sırt Yüksekliği', 'Alçak Sırt'), ('Ayak Tipi', 'Ahşap Ayak')]},
         {'url': N + 'toya-family-tr/toya-orta-sirt-5-yildiz-ayak/', 'label': 'Orta Sırt · 5 Yıldız Ayak',
          'options': [('Sırt Yüksekliği', 'Orta Sırt'), ('Ayak Tipi', '5 Yıldız Ayak')]},
         {'url': N + 'toya-family-tr/toya-orta-sirt-sabit-ayak/', 'label': 'Orta Sırt · Sabit Ayak',
          'options': [('Sırt Yüksekliği', 'Orta Sırt'), ('Ayak Tipi', 'Sabit Ayak')]},
         # Nurus'un KENDİ sayfa başlığı burada HATALI: "-2" sayfası da "Toya Orta Sırt Sabit Ayak"
         # diyor, ama sayfanın galerisi Office-Chairs_Toya-Mid-WOOD_* görselleriyle dolu ve
         # ailenin diğer sekiz varyantı zaten 3 sırt × 3 ayak matrisini tamamlıyor — bu sayfa
         # ailenin eksik dokuzuncu üyesi, yani ORTA SIRT AHŞAP AYAK. Kaynak başlığı körlemesine
         # kopyalamak katalogda birebir aynı adlı iki versiyon üretirdi.
         {'url': N + 'toya-family-tr/toya-orta-sirt-sabit-ayak-2/', 'label': 'Orta Sırt · Ahşap Ayak',
          'options': [('Sırt Yüksekliği', 'Orta Sırt'), ('Ayak Tipi', 'Ahşap Ayak')]},
         {'url': N + 'toya-family-tr/toya-yuksek-sirt-5-yildiz-ayak/', 'label': 'Yüksek Sırt · 5 Yıldız Ayak',
          'options': [('Sırt Yüksekliği', 'Yüksek Sırt'), ('Ayak Tipi', '5 Yıldız Ayak')]},
         {'url': N + 'toya-family-tr/toya-yuksek-sirt-sabit-ayak/', 'label': 'Yüksek Sırt · Sabit Ayak',
          'options': [('Sırt Yüksekliği', 'Yüksek Sırt'), ('Ayak Tipi', 'Sabit Ayak')]},
         {'url': N + 'toya-family-tr/toya-yuksek-sirt-ahsap-ayak/', 'label': 'Yüksek Sırt · Ahşap Ayak',
          'options': [('Sırt Yüksekliği', 'Yüksek Sırt'), ('Ayak Tipi', 'Ahşap Ayak')]},
     ]},

    {'key': 'alava', 'title': 'Alava Çalışma Sandalyesi Ailesi', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None, 'desc': 'alava',
     'variants': [
         {'url': N + 'alava-family-tr/alava-4-yildiz-ayak-tr/', 'label': 'Alava 4 Yıldız Ayak',
          'options': [('Ayak Tipi', '4 Yıldız Ayak')]},
         {'url': N + 'alava-family-tr/alava-5-yildiz-ayak-tr/', 'label': 'Alava 5 Yıldız Ayak',
          'options': [('Ayak Tipi', '5 Yıldız Ayak')]},
         {'url': N + 'alava-family-tr/alava-ahsap-ayak-tr/', 'label': 'Alava Ahşap Ayak',
          'options': [('Ayak Tipi', 'Ahşap Ayak')]},
     ]},

    {'key': 'flora', 'title': 'Flora Çalışma Sandalyesi Ailesi', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None, 'desc': 'flora',
     'variants': [
         {'url': N + 'flora-family-tr/flora-4-yildiz-ayak-tr/', 'label': 'Flora 4 Yıldız Ayak',
          'options': [('Ayak Tipi', '4 Yıldız Ayak')]},
         {'url': N + 'flora-family-tr/flora-5-yildiz-ayak-tr/', 'label': 'Flora 5 Yıldız Ayak',
          'options': [('Ayak Tipi', '5 Yıldız Ayak')]},
         {'url': N + 'flora-family-tr/flora-ahsap-ayak-tr/', 'label': 'Flora Ahşap Ayak',
          'options': [('Ayak Tipi', 'Ahşap Ayak')]},
     ]},

    {'key': 'ron', 'title': 'Ron Çalışma Koltuğu Ailesi', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None, 'desc': 'ron',
     'variants': [
         {'url': N + 'ron-family-tr/ron-alcak-sirt-tr/', 'label': 'Ron Alçak Sırt',
          'options': [('Sırt Yüksekliği', 'Alçak Sırt')]},
         {'url': N + 'ron-family-tr/ron-orta-sirt-tr/', 'label': 'Ron Orta Sırt',
          'options': [('Sırt Yüksekliği', 'Orta Sırt')]},
         {'url': N + 'ron-family-tr/ron-yuksek-sirt-tr/', 'label': 'Ron Yüksek Sırt',
          'options': [('Sırt Yüksekliği', 'Yüksek Sırt')]},
     ]},

    {'key': 'sacha', 'title': 'Sacha Çalışma Koltuğu Ailesi', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None, 'desc': 'sacha',
     'variants': [
         {'url': N + 'sacha-family-tr/sacha-alcak-sirt-tr/', 'label': 'Sacha Alçak Sırt',
          'options': [('Sırt Yüksekliği', 'Alçak Sırt')]},
         {'url': N + 'sacha-family-tr/sacha-orta-sirt-tr/', 'label': 'Sacha Orta Sırt',
          'options': [('Sırt Yüksekliği', 'Orta Sırt')]},
         {'url': N + 'sacha-family-tr/sacha-yuksek-sirt-tr/', 'label': 'Sacha Yüksek Sırt',
          'options': [('Sırt Yüksekliği', 'Yüksek Sırt')]},
     ]},

    {'key': 'aura', 'title': 'Aura Oturma Ailesi', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None, 'desc': 'aura',
     'variants': [
         {'url': N + 'aura-family-tr/aura-tr/', 'label': 'Aura', 'options': [('Versiyon', 'Aura')]},
         {'url': N + 'aura-family-tr/aura-lounge-tr/', 'label': 'Aura Lounge', 'options': [('Versiyon', 'Aura Lounge')]},
         {'url': N + 'aura-family-tr/aura-yuksek-sirt-tr/', 'label': 'Aura Yüksek Sırt',
          'options': [('Versiyon', 'Aura Yüksek Sırt')]},
     ]},

    {'key': 'metope', 'title': 'Metope Sandalye Ailesi', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None, 'desc': 'metope',
     'variants': [
         {'url': N + 'metope-family-tr/metope-tr/', 'label': 'Metope Standart Ayak',
          'options': [('Ayak Tipi', 'Standart Ayak')]},
         {'url': N + 'metope-family-tr/metope-ahsap-ayak/', 'label': 'Metope Ahşap Ayak',
          'options': [('Ayak Tipi', 'Ahşap Ayak')]},
     ]},

    {'key': 'trea', 'title': 'Trea Sandalye Ailesi', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None, 'desc': 'trea',
     'variants': [
         {'url': N + 'trea-family-tr/trea-sandalye-tr/', 'label': 'Trea Sandalye', 'options': [('Versiyon', 'Sandalye')]},
         {'url': N + 'trea-family-tr/trea-toplanti-tr/', 'label': 'Trea Toplantı', 'options': [('Versiyon', 'Toplantı')]},
         {'url': N + 'trea-family-tr/trea-u-sandalye-tr/', 'label': 'Trea U Sandalye', 'options': [('Versiyon', 'U Sandalye')]},
     ]},

    {'key': 't-mec', 'title': 'T-Mec Masa Sistemi Ailesi', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None, 'desc': 't-mec',
     'variants': [
         {'url': N + 't-mec/', 'label': 'T-Mec', 'options': [('Versiyon', 'T-Mec')]},
         {'url': N + 't-mec-pro/', 'label': 'T-Mec Pro', 'options': [('Versiyon', 'T-Mec Pro')]},
     ]},

    {'key': 'mou', 'title': 'Mou Pro Çalışma Koltuğu Ailesi', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None, 'desc': 'mou',
     'variants': [
         {'url': N + 'mou-family-tr/mou-tr/', 'label': 'Mou Pro', 'options': [('Mekanizma', 'Standart')]},
         {'url': N + 'mou-family-tr/mou-front-tilt-tr/', 'label': 'Mou Pro Front Tilt',
          'options': [('Mekanizma', 'Front Tilt')]},
     ]},

    {'key': 'air', 'title': 'Air Pro Çalışma Koltuğu', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None,
     'desc_tr': """Air; sadelik, zarafet ve kullanıcı dostu tasarımı birleştiren bir çalışma koltuğudur. Her ortama sorunsuzca uyum sağlamak üzere tasarlanan Air, ihtiyaca göre şekillenen sezgisel bir oturma deneyimi sunar.

Her boya uyarlanabilen koltuk, oturma yüksekliğinde 12 cm'e varan ayar mesafesi ve oturma derinliğini özelleştirme imkânı sunar. Hareketlere kolayca uyum sağlayan tasarımı, omurgayı kavrayan file sırtı ve güçlü tekerlekleriyle gün boyu güvenli bir yaslanma ve özgür hareket sağlar.""",
     'variants': [{'url': N + 'air-family-tr/air-tr/', 'label': 'Air Pro', 'options': []}]},

    {'key': 'lucrezia', 'title': 'Lucrezia Çalışma Sandalyesi', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None,
     'desc_tr': """Lucrezia, yumuşak hatlı kabuğu ve ince ayak yapısıyla çalışma alanlarına sakin bir karakter taşıyan bir sandalyedir. Döşemeli oturum, uzun süreli kullanımda konforu korur.

Ev ofisi ile kurumsal çalışma alanları arasında sorunsuzca yer değiştirebilecek bir ölçek ve görünüme sahiptir.""",
     'variants': [{'url': N + 'lucrezia-family-tr/lucrezia-calisma-sandalyesi/', 'label': 'Lucrezia', 'options': []}]},

    {'key': 'me-too', 'title': 'Me Too Çalışma Koltuğu', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None,
     'desc_tr': """Me Too, esnek sırt yapısı ve ince siluetiyle paylaşımlı çalışma alanları için tasarlanmış bir çalışma koltuğudur. Sırt, kullanıcının hareketine yanıt vererek sabit bir oturuş dayatmaz.

Yalın görünümü, açık ofis kurgularında görsel yoğunluğu artırmadan çok sayıda birimin bir arada kullanılmasına olanak tanır.""",
     'variants': [{'url': N + 'me-too-family-tr/me-too-tr/', 'label': 'Me Too', 'options': []}]},

    {'key': 'spring', 'title': 'Spring Çalışma Koltuğu', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None,
     'desc_tr': """Spring, esnek sırt mekanizmasıyla kullanıcının hareketini takip eden bir çalışma koltuğudur. Oturum ve sırt, gün içindeki duruş değişimlerine kendiliğinden uyum sağlar.

Ayarlanabilir oturma yüksekliği ve kolçak seçenekleriyle farklı kullanıcı boylarına uyarlanabilir.""",
     'variants': [{'url': N + 'spring-tr/', 'label': 'Spring', 'options': []}]},

    {'key': 'uneo', 'title': 'Uneo Pro Plus Çalışma Koltuğu', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None,
     'desc_tr': """Uneo Pro Plus, file sırtlığı ve ayarlanabilir bel desteğiyle uzun çalışma saatlerinde omurgayı destekleyen bir çalışma koltuğudur.

Oturma yüksekliği, oturma derinliği ve kolçak ayarlarıyla kullanıcıya göre uyarlanabilir; sert ve yumuşak zeminler için farklı tekerlek seçenekleri sunar.""",
     'variants': [{'url': N + 'uneo-family-tr/uneo-tr/', 'label': 'Uneo Pro Plus', 'options': []}]},

    {'key': 'waves', 'title': 'Waves Oturma Birimi', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None,
     'desc_tr': """Waves, dalgalı gövde formuyla açık ofislerde ve ortak alanlarda yumuşak bölücü görevi de üstlenen bir oturma birimidir. Modüller yan yana getirildiğinde sürekli bir oturma bandı oluşturur.

Farklı kumaş ve renk seçenekleriyle mekânın renk kurgusuna uyarlanabilir.""",
     'variants': [{'url': N + 'waves-tr/', 'label': 'Waves', 'options': []}]},

    {'key': 'dora', 'title': 'Dora Sandalye', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None,
     'desc_tr': """Dora, ince kabuk formu ve hafif gövdesiyle toplantı ve yemek alanları için tasarlanmış bir sandalyedir. İstiflenebilir yapısı, kullanılmadığı zamanlarda az yer kaplamasını sağlar.

Farklı ayak ve yüzey seçenekleriyle hem kurumsal hem ağırlama mekânlarına uyum sağlar.""",
     'variants': [{'url': N + 'dora/', 'label': 'Dora', 'options': []}]},

    {'key': 'mini-go', 'title': 'Mini Go Hareketli Ünite', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None,
     'desc_tr': """Mini Go, tekerlekli gövdesiyle çalışma alanı içinde kolayca yer değiştirebilen kompakt bir depolama ve destek ünitesidir. Kişisel eşyalar için kilitli çekmece seçeneği sunar.

Üst yüzeyi, gerektiğinde ek bir çalışma ya da oturma yüzeyi olarak kullanılabilir.""",
     'variants': [{'url': N + 'mini-go-tr/', 'label': 'Mini Go', 'options': []}]},

    {'key': 'tulya', 'title': 'Tulya Oturma Birimi', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None,
     'desc_tr': """Tulya, yumuşak hatlı gövdesiyle karşılama ve bekleme alanlarına davetkâr bir karakter katan bir oturma birimidir. Sarmalayan sırt formu, kısa görüşmeler için yarı-özel bir alan kurar.

Kumaş ve ayak seçenekleriyle mekânın malzeme diline uyarlanabilir.""",
     'variants': [{'url': N + 'tulya-tr/', 'label': 'Tulya', 'options': []}]},

    {'key': 'vela', 'title': 'Vela Oturma Birimi', 'brand': 'nurus', 'cat': 'Ofis Mobilyası',
     'designer': None,
     'desc_tr': """Vela, yelken formundan esinlenen ince gövdesiyle ortak alanlara hafif bir siluet taşıyan bir oturma birimidir. Gövdenin eğrisi, oturum boyunca sürekli bir destek yüzeyi kurar.

Tekli ve çoklu kurgularda kullanılabilir; farklı kumaş seçenekleriyle sunulur.""",
     'variants': [{'url': N + 'vela-tr/', 'label': 'Vela', 'options': []}]},
]
