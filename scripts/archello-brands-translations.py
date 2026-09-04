#!/usr/bin/env python3
"""58 Archello markasının Türkçeleştirilmiş/normalize edilmiş alanları — kazıma çıktısını
`scripts/import-archello-brands.js`'in beklediği yükleme (payload) biçimine çevirir.

`scripts/archello-batch36-translations.py` ile AYNI desen: çeviri oturum içinde yapılır, sonuç
BURAYA sabitlenir; böylece içe aktarım yeniden çalıştırıldığında birebir aynı metin üretilir
(bir çeviri API'sine bağımlılık yok, çıktı deterministik).

ALAN KARARLARI (kullanıcı talimatı: "Sayfada tespit edilemeyen alanları zorlama, temiz geç"):
  * `website` — Archello marka sayfalarının ÇOĞU "non-client" şablonu ve dış bağlantı İÇERMİYOR.
    58 markanın yalnızca 2'sinde (SNOC, Na-De) gerçek bir site bağlantısı vardı; geri kalanına
    tahminî bir alan adı YAZILMAZ, NULL bırakılır.
  * `loc` — adres serbest metin; yalnızca İL (ve adres açıkça yazıyorsa İLÇE) çıkarılır.
    Adres yoksa NULL. Adresteki ilçe tahmin EDİLMEZ (ör. "Akaretler" -> yalnızca "İstanbul").
  * `yil` — yalnızca kuruluş yılı AÇIKÇA yazıyorsa. "nearly 30 years" gibi göreli ifadeler
    bugünün yılına göre hesaplanmaz (içe aktarım tarihine bağlı, kararsız bir değer olurdu).
  * `cats` — office-kind.js#BRAND_CATS'ten. Kaynak metin belirsizse markanın Archello künye
    etiketlerinden ("Facade cladding", "Parquet", "Glass Partitions" — bkz. project-specs
    çıktısı) ya da kapak görselinin dosya adından doğrulanır.

DÜŞÜK GÜVENLİ TEK KAYIT: `berk-2` (BERK). Archello sayfasında ne adres, ne kategori etiketi, ne
ürün, ne de anlamlı bir kapak dosya adı var; açıklama tamamen genel ("25 yıldır ... çevre dostu").
En geniş ve en az yanlış olacak kategori olan 'Yapı Malzemesi' atandı — daha kesin bir kaynak
çıkarsa DÜZELTİLMELİ.
"""

import argparse
import json
import re
import sys

# archelloSlug -> {name, slug, cats[], loc, yil, website, about}
# `about` None ise Archello sayfasında açıklama YOKTU (6 marka) — uydurulmaz, NULL yazılır.
TR = {
    'snoc': dict(
        name='SNOC', slug='snoc', cats=['Dış Mekan & Peyzaj', 'Mobilya'], loc=None, yil='2004',
        website='https://snoc-eu.com',
        about='SNOC, zanaatkârlık, malzeme kalitesi ve sakin bir mimari duyarlılık üzerine kurulu, '
              'küresel bir tasarım diyaloğuyla biçimlenen bir dış mekân tasarım markasıdır. 2004 '
              'yılında kurulan marka, uluslararası tasarımcılarla iş birliği yaparak berraklık, denge '
              've dış mekân yaşamına dair rafine bir yaklaşımla tanımlanan koleksiyonlar üretir. '
              'Tasarım dili; biçim, ışık ve dokunsal nüansın etkileşiminden doğar, açık havada '
              'yaşama çağdaş bir bakış getirerek dış mekân çevrelerinin deneyimini yükseltir.'),
    'serapool': dict(
        name='Serapool', slug='serapool', cats=['Zemin & Yüzey Kaplama', 'Dış Mekan & Peyzaj'],
        loc='İstanbul / Pendik', yil='1984', website=None,
        about='1984 yılında Anadolu Porselen San. ve Tic. A.Ş. adıyla kurulan ve elektroporselen '
              'üretimiyle faaliyete başlayan şirket, 1990 yılında havuz pazarının ihtiyacını görerek '
              'o dönemde yalnızca ithal edilebilen havuz porselenlerini üretmeye başlamıştır. 2005 '
              'yılında marka adını şirket unvanı olarak benimseyerek Serapool Porselen San. ve Tic. '
              'A.Ş. adını almıştır.\n\n'
              'Türkiye’nin ilk havuz porseleni üreticisi olan Serapool, kuruluşundan bu yana '
              'edindiği deneyim ve yüzlerce çeşit ürünüyle detaylara yönelik teknik çözümler ve '
              'yenilikler geliştirir. %100 porselen ürünleriyle kaliteyi ve hijyeni aynı noktada '
              'buluşturan marka; renk, desen, model ve ebat çeşitliliğiyle farkını ortaya koyar.\n\n'
              '%100 yerli üretim olan Serapool; olimpik havuzlar, otel havuzları, villa havuzları, '
              'süs havuzları, termal havuzlar ve eğitim havuzları başta olmak üzere her tür havuz '
              'için geniş bir ürün yelpazesi sunar ve üretiminin yarısını 90’dan fazla ülkeye '
              'ihraç eder.'),
    'cuhadaroglu-aluminyum-sanayi-ve-ticaret': dict(
        name='Çuhadaroğlu Alüminyum', slug='cuhadaroglu-aluminyum',
        cats=['Cephe & Açıklıklar', 'Yapı Malzemesi'], loc='İstanbul', yil=None, website=None,
        about='Çuhadaroğlu Alüminyum Sanayi ve Ticaret A.Ş., projeye özel çözümler üreterek yapının '
              'ihtiyaçlarını belirler ve özgünlük, üstün kalite ile ileri teknoloji gerektiren '
              'çağdaş çözümler sunar. Tasarım, test, üretim ve montaj hizmetlerinin tamamını tek '
              'çatı altında yürütebilen dünyadaki sayılı kuruluşlardan biridir.\n\n'
              'Yurt içinde ve yurt dışında gerçekleştirdiği, her biri referans niteliğindeki '
              'uygulamalar, şirketin yüksek yapı cephe kaplaması portföyünü her geçen gün '
              'genişletmektedir. Türkiye’de alüminyum taahhüt işlerinin öncüsü olan Çuhadaroğlu, '
              'Fransa’dan Kazakistan’a, Rusya’dan İngiltere’ye 25 ülkede imza attığı projelerle '
              'faaliyet coğrafyasını sürekli büyütmektedir.'),
    'tacer': dict(
        name='Tacer', slug='tacer', cats=['Cephe & Açıklıklar', 'Zemin & Yüzey Kaplama'],
        loc='Ankara / Çankaya', yil=None, website=None,
        about='Tacer, otuz yıla yaklaşan üretim uzmanlığını, bilgi birikimini ve deneyimini hayal '
              'gücünü zorlayan tasarımlarla birleştirir. Mimari bakış açısını estetik beklentiyle, '
              'işlevsel çözümleri mühendis gözüyle ve gelecek kuşaklar için sürdürülebilir, çağdaş '
              'yapıların ihtiyaçlarını harmanlayarak sektörün hizmetine sunar.'),
    'egem-mozaik-dizayn': dict(
        name='Egem Mozaik Dizayn', slug='egem-mozaik-dizayn',
        cats=['Zemin & Yüzey Kaplama', 'Dekorasyon & Tamamlayıcılar'], loc=None, yil='1995',
        website=None,
        about='Egem Mozaik Dizayn, deneyim ve bilgi birikiminden doğan bir hizmet ve üretim '
              'anlayışıyla estetik ve işlevsel ürünler üreterek sektörde eğilim belirler. 1995 '
              'yılından bu yana el yapımı seramik, mozaik, seramik karo, karo çimento ve porselen '
              'karo alanlarında çalışan marka, güçlü Ar-Ge ekibi ve çok sayıda projeyle büyümesini '
              'sürdürmektedir.'),
    'vitra-bathrooms': dict(
        name='VitrA', slug='vitra', cats=['Mutfak & Banyo', 'Zemin & Yüzey Kaplama'],
        loc='İstanbul', yil=None, website=None,
        about='Eczacıbaşı Yapı Ürünleri Grubu küresel ölçekte faaliyet gösterir ve 9’u Almanya, '
              'İngiltere ile Fransa’da, 6’sı Türkiye’de olmak üzere toplam 15 üretim tesisine '
              'sahiptir. Bu tesislerde yılda ortalama 5 milyon adet seramik sağlık gereci, 36 milyon '
              'metrekare yer ve duvar karosu, 370 bin modül banyo mobilyası, 3 milyon armatür, 350 '
              'bin küvet, 2,5 milyon banyo aksesuarı, 150 bin gömme rezervuar ile 550 bin klozet '
              'kapağı üretilmektedir.\n\n'
              'Geniş ürün yelpazesi ve yaygın dağıtım ağıyla Eczacıbaşı Yapı Ürünleri Grubu, '
              'ürünlerini 75’ten fazla ülkeye ihraç etmektedir. VitrA’nın yanı sıra Engers Keramik, '
              'Villeroy & Boch Fliesen ve Burgbad markalarını bünyesine katarak banyo ürünleri ve '
              'karo alanında dünya çapında tanınan bir tedarikçi konumuna gelmiştir.'),
    'efesus-stone': dict(
        name='Efesus Stone', slug='efesus-stone', cats=['Zemin & Yüzey Kaplama', 'Yapı Malzemesi'],
        loc=None, yil=None, website=None, about=None),
    'designnobis': dict(
        name='Designnobis', slug='designnobis', cats=['Mobilya', 'Dekorasyon & Tamamlayıcılar'],
        loc=None, yil=None, website=None,
        about='Designnobis, sürdürülebilir bir tasarım merkezi olarak ürün tasarımı, marka '
              'kimliği ve mekân kurgusu alanlarında yenilikçi çözümler geliştirir. Araştırma ve '
              'konsept geliştirme aşamasından prototipleme ve üretime uzanan tasarım hizmetleriyle, '
              'müşterilerinin stratejik değer taşıyan ürün ve hizmetlerle pazarda farklılaşmasını '
              'sağlar.\n\n'
              'Yüksek katma değerli, rekabetçi ürünler geliştirerek ulusal ve küresel sanayiye '
              'katkı sunan stüdyo, teknoloji ve buluşları tüketiciye ulaşan ürün ve hizmetlere '
              'dönüştürmek üzere firmalara Ar-Ge hizmeti verir ve marka imajına değer katar.'),
    'vitra-karo': dict(
        # VitrA Karo, VitrA'nın karo iş kolu; MİMARLAB'da ayrı bir marka satırı AÇILMAZ, aynı
        # `vitra` kaydına bağlanır (bkz. import-archello-brands.js#MERGE_INTO).
        name='VitrA', slug='vitra', cats=['Zemin & Yüzey Kaplama', 'Mutfak & Banyo'],
        loc='İstanbul', yil=None, website=None,
        about='VitrA Karo, Avrupa Birliği’ne en çok seramik karo ihraç eden Türk üreticisidir; '
              'üretimine 1991’de İstanbul Tuzla’da, 1992’de Bilecik Bozüyük’te ve 2011’de Rusya’da '
              'başlamıştır. Yıllık 30 milyon metrekare kapasiteyle ürünlerini dünya genelinde 75 '
              'ülkede satmaktadır.\n\n'
              'VitrA markasının altmış yıllık birikimini banyoların yanı sıra iç ve dış mekân '
              'havuzları, bahçeler ve bina cepheleri gibi yaşam alanlarına taşıyan VitrA Karo, doku '
              've malzeme alanında sürekli yenilikçi çözümler geliştirir. Avrupa Birliği eko '
              'etiketini alan ilk Türk karosu olan VitrA Karo, TSE Çift Yıldız belgesine de sahiptir.'),
    'yaaz': dict(
        name='YAAZ', slug='yaaz', cats=['Dış Mekan & Peyzaj', 'Mobilya'], loc=None, yil=None,
        website=None, about=None),
    'omana-natural-idea': dict(
        name='OMANA Natural Idea', slug='omana-natural-idea',
        cats=['Zemin & Yüzey Kaplama', 'Yapı Malzemesi'], loc=None, yil=None, website=None,
        about='OMANA Natural Idea, ECF Mermer Danışmanlık Madencilik İnşaat ve İthalat İhracat '
              'Ltd. Şti. (ECF Natural Stones Co. Ltd.) tarafından kurulmuş doğal taş markasıdır.'),
    'bt-design': dict(
        name='B&T Design', slug='b-t-design', cats=['Mobilya', 'Dış Mekan & Peyzaj'],
        loc='İstanbul', yil='1995', website=None,
        about='B&T Design’da her güne yalın bir soruyla başlanır: “Bugün insanlara ilham verecek '
              'yeni ne yapabiliriz?” Marka yalnızca sandalye, kanepe, puf ve masa değil; ilham '
              'veren mekânlar için görünüşler, atmosferler ve duygular tasarlar.\n\n'
              '1995 yılında İstanbul’da kurulan B&T Design, ticari iç mekânlar için çağdaş oturma '
              'grupları, masalar ve dış mekân koleksiyonları üretir. İstanbul ve Bulgaristan '
              'Plovdiv’deki üretim tesisleriyle rafine zanaatkârlığı, endüstriyel kapasiteyi ve '
              'ileri görüşlü bir tasarım yaklaşımını bir araya getirir.\n\n'
              'Moda odaklı bir mobilya markası olarak konumlanan B&T, özenle seçilmiş ve sürekli '
              'zenginleşen kumaş ile malzeme yelpazesiyle öne çıkar. Tasarımlarının çoğu modüler '
              'esneklik sunarak farklı mekânlara ve yerleşim ihtiyaçlarına uyum sağlar.\n\n'
              'Küçük bir metal atölyesinde başlayan yolculuk, bugün küresel bir tasarım markasına '
              'dönüşmüştür. B&T; saygın uluslararası tasarımcılarla çalışır, önde gelen tasarım '
              'etkinliklerine katılır ve 65’ten fazla ülkeye ihracat yapar. Koleksiyonları ofis, '
              'konaklama ve sağlık yapıları başta olmak üzere geniş bir ticari mekân yelpazesine '
              'uyarlanabilecek şekilde tasarlanır.'),
    'arcnorm': dict(
        name='Arcnorm', slug='arcnorm', cats=['Mobilya'], loc=None, yil='2012', website=None,
        about='Arcnorm, Bilkent Üniversitesi mezunu iç mimar ve çevre tasarımcısı Görkem Sever '
              'tarafından 2012 yılında kurulmuştur. Marka, mimari bir bakış açısıyla yeni ve '
              'sürdürülebilir malzemeler geliştirmeye ve ahşap ürün sistemlerinin ömrüne çözüm '
              'aramaya odaklanır.\n\n'
              'Tüketim kültürüne karşı bir duruş benimseyen Arcnorm, sürdürülebilir mobilyalar '
              'üretirken malzemenin yeniden kullanımını teşvik eder. İnsan odaklı, doğal ve yeniden '
              'kullanıma izin veren yapısı nedeniyle ahşap, markanın tüm mobilya tasarımlarında ve '
              'malzeme arayışında merkezî bir yer tutar. Malzeme seçiminde marka, karbon '
              'döngüsünü tamamlamış ve sürdürülebilir zincire hazır ahşabı kullanmayı ilke edinir.'),
    'brn-sleep-products': dict(
        name='BRN Sleep Products', slug='brn-sleep-products', cats=['Mobilya'], loc=None, yil=None,
        website=None,
        about='BRN Sleep Products; yatak, yatak kılıfı, baza ve hareketli yatak sistemleri '
              'alanında dünyanın önde gelen üreticilerinden biridir. Rakiplerine odaklanmak yerine '
              'müşterilerini dinleyerek anlamlı ve yenilikçi çözümler sunmayı ilke edinmiştir.\n\n'
              'Marka; ROYAL COIL doğal lüks el yapımı yataklar, ORTHO yüksek kaliteli bonel yaylı '
              'yataklar, ERGO uzun ömürlü torba yaylı yataklar ve STYLE özgün tasarımlı yataklar '
              'başta olmak üzere farklı ürün gruplarında uzmanlaşmıştır. ROLL paketleme çözümüyle '
              'depolama kapasitesine yanıt verir; ayrıca ayrıcalıklı bir ürün gamı korumak isteyen '
              'distribütör ve perakendeciler için özel markalı yatak programı sunar.'),
    'berk-2': dict(
        # DÜŞÜK GÜVENLİ KATEGORİ — bkz. dosya başındaki not.
        name='BERK', slug='berk', cats=['Yapı Malzemesi'], loc=None, yil=None, website=None,
        about='BERK, kuruluşundan bu yana ülkesine en iyisini ve en mükemmelini sunmaya özen '
              'göstermiş bir markadır. Çeyrek asrı geride bırakan marka, ilk günkü heyecanını '
              'koruyarak güvenilir bir şirket olmanın onurunu taşır. Yeni ürünlere, yeni teknolojiye '
              've yeni fikirlere daima açık olan BERK; deneyimli ve çalışkan kişilere ve kurumlara '
              'saygı duymuş, öncü tavrını yeni ürünlere ve geleceğe aktarmaya çalışmıştır. Markanın '
              'temel ilkeleri istikrar, süreklilik ve çevre dostu olmaktır.'),
    'artstone-panel-systems': dict(
        name='Artstone Panel Systems', slug='artstone-panel-systems',
        cats=['Dekorasyon & Tamamlayıcılar', 'Zemin & Yüzey Kaplama'], loc='İstanbul / Beşiktaş',
        yil='2005', website=None,
        about='2005 yılında dekoratif duvar panellerinin öncü ve yenilikçi markası olarak faaliyete '
              'geçen Artstone, Türkiye’deki dekorasyon anlayışını ve vizyonunu farklı bir alana '
              'taşıyarak tüm mekânlarda doğadan ilham alan yaratıcı çözümlere olanak tanır. Genç, '
              'dinamik ve vizyoner ekibiyle yurt içinde ve yurt dışında proje çözümlerinin başarılı '
              'bir iş ortağı olarak kalite ve güvenin temsilcisi olmayı sürdürür.\n\n'
              'Tamamı Türkiye’de tasarlanıp üretilen “Artstone Dekoratif Duvar Panelleri”, kendi '
              'çizgisi ve özgün modelleriyle modayı takip etmek yerine modayı yaratan bir markadır.'),
    'rafevi': dict(
        name='Rafevi', slug='rafevi', cats=['Mobilya', 'Dekorasyon & Tamamlayıcılar'], loc=None,
        yil=None, website=None,
        about='Rafevi, modüler mobilya alanında üretimini sürdüren Tamada Mobilya tarafından, zarif '
              've yenilikçi tasarımlarıyla dikkat çekmeyi amaçlayan tasarım odaklı bir mobilya '
              'markası olarak kurulmuştur. Tamada markasıyla ortak bir “öncülük” misyonu taşıyan '
              'Rafevi, tamamlayıcı mobilya kategorisinde lider bir marka olmayı hedefler.\n\n'
              'Tasarım gücüyle pazardaki eğilimleri takip etmek yerine belirleyen bir çizgide '
              'ilerleyen marka, tasarladığı her ürünü kullanıcıyı mutlu edebilecek küçük ama önemli '
              'birer vesile olarak görür. Rafevi stüdyolarında tutkuyla tasarlanan her ürün, keyifli '
              'deneyimler yaratmayı amaçlar ve bu ayrıcalığı çok daha erişilebilir bir fiyatla geniş '
              'kitlelere ulaştırmayı hedefler.'),
    'skymotif': dict(
        name='SkyMotif', slug='skymotif', cats=['Dekorasyon & Tamamlayıcılar'], loc=None, yil=None,
        website=None,
        about='SkyMotif, ürünlerinde sanat ve tasarımı harmanlayarak tasarımlara görsellik ve '
              'çeşitlilik katar.'),
    'gotwob': dict(
        name='Gotwob', slug='gotwob', cats=['Mobilya', 'Dekorasyon & Tamamlayıcılar'], loc=None,
        yil='2009', website=None,
        about='Gotwob, Begüm Çelik ve Berk Şimşek’in İstanbul merkezli ürün tasarımı ve mimarlık '
              'stüdyosudur. 2007 yılından bu yana birlikte çalışan ikili, bireysel bakış açılarını '
              've fikirlerini tek bir ortak estetikte buluşturarak 2009 yılında Gotwob’u kurmuştur.'),
    'papatya': dict(
        name='Papatya', slug='papatya', cats=['Mobilya', 'Dış Mekan & Peyzaj'], loc='İstanbul',
        yil='1945', website=None,
        about='1945’ten bu yana yüksek nitelikli ve yenilikçi ürünler üretmek Papatya’nın aile '
              'geleneğidir. Üstün kaliteli dış mekân mobilyasıyla başlayan “öncü marka” konumunu '
              'korumak amacıyla, yirmi beş yılı aşkın süredir iç ve dış mekân mobilyası alanında '
              'yeni malzeme ve teknolojilere odaklanarak pazardaki güncel eğilimleri ve yaşam '
              'biçimlerini takip eder.\n\n'
              'Şirketin tasarım anlayışı buluşçuluk, yaratıcılık, kalite ve Ar-Ge üzerine kuruludur. '
              'Polikarbonat, polipropilen, metal ve ahşap malzemeden üretilen sandalye, koltuk, bar '
              'taburesi ve masalardan oluşan özgün ve zengin koleksiyon, kullanıcıların gerçek '
              'ihtiyaçlarına üst düzeyde yanıt verir.'),
    'newjoy': dict(
        name='NewJoy', slug='newjoy', cats=['Mobilya'], loc=None, yil='1986', website=None,
        about='NewJoy, 1986 yılından bu yana faaliyet gösteren Öner Ev Aletleri’nin bebek, çocuk ve '
              'genç odası mobilyası alanındaki markasıdır. Mobilya pazarına girdikten sonra 2003 '
              'yılında Elmob adıyla televizyon sehpası üretimine başlayan şirketin üretim ağı, '
              'zamanla elektronik, beyaz eşya, konut ve otomotiv yan sanayilerini kapsayacak biçimde '
              'genişlemiştir.\n\n'
              'Elmob’un kardeş markası olan NewJoy, Sakarya Hendek’teki 20.000 m² açık ve 9.000 m² '
              'kapalı alana sahip fabrikasında en güncel teknoloji ve ekipmanla üretim yapmaktadır.'),
    'stepevi': dict(
        name='Stepevi', slug='stepevi', cats=['Zemin & Yüzey Kaplama', 'Dekorasyon & Tamamlayıcılar'],
        loc='İstanbul', yil=None, website=None,
        about='Stepevi, dünyanın halı üretim başkentindeki zengin deneyim ve uzmanlığıyla halıyı '
              'yeniden tanımlayan bir markadır. Geleneksel halı dokuma tekniklerini yeni '
              'teknolojiyle birleştiren marka, güncel moda renklerinden ve dokularından ilham alan '
              'yenilikçi koleksiyonlarıyla öncü bir iç mekân markasıdır. Küresel müşterilerine '
              'kapsamlı kişiselleştirme ve proje hizmetleri sunar.\n\n'
              '“Yeniden tanımlanmış halı geleneği, yenilikçi zanaatkârlık ve kitlesel '
              'kişiselleştirme ilkeleriyle yaratılan, zamansız bir zevke sahip rafine modern lüks '
              'halılar” felsefesini benimseyen Stepevi, sade ve sürdürülebilir ürün değerlerinin '
              'peşindedir.\n\n'
              'Tüm Stepevi halıları, halı üretimiyle özdeşleşmiş Isparta’daki üretim üssünde '
              'üretilir. Marka, Avrupa ve Orta Doğu’nun en büyük entegre üretim merkezine sahiptir. '
              'Bugün Londra, Paris, Milano, İstanbul, New York ve Dubai başta olmak üzere dünyanın '
              'birçok tasarım başkentindeki mağazalarıyla çağdaş halının tartışmasız ölçütüdür.'),
    'creavit': dict(
        name='Creavit', slug='creavit', cats=['Mutfak & Banyo'], loc='Zonguldak / Gökçebey',
        yil=None, website=None,
        about='Çanakçılar Kurumsal Grubu bünyesinde 1960’lı yıllarda küçük bir atölyede mozaik '
              'klozet üretimiyle başlayan süreç, 1970’li yıllarda polyester kaplı seramik görünümlü '
              'klozet üretimi ve pazarlamasıyla sürmüş, 1980’lerin başında fabrika üretimine '
              'geçilmiştir. Nüfusu 8.000 olan Gökçebey’de ürettiği yüksek kaliteli ürünlerin '
              '%40’ını dünya pazarlarına ihraç eden Creavit, ülke ölçeğinde sektörünün önde '
              'gelenleri arasındadır.\n\n'
              '140.000 m² açık alan içinde 60.000 m² kapalı alana kurulu “Gökçebey Vitrifiye Üretim '
              'Tesisleri”, tek merkezde kurulmuş en büyük üç tesisten biridir. 2006 yılında kurulan '
              'ikinci kuşak “Çaydeğirmeni Üretim Tesisleri” ise banyo mobilyası, ofis mobilyası, '
              'küvet, lavabo ve mutfak armatürü, gömme rezervuar ve klozet kapağı üretimini '
              'karşılamaktadır.'),
    'heper': dict(
        name='Heper', slug='heper', cats=['Aydınlatma', 'Dış Mekan & Peyzaj'], loc=None, yil='1996',
        website=None,
        about='1996 yılında kurulan Heper, Türkiye’nin profesyonel dış mekân aydınlatması alanındaki '
              'öncü şirketlerinden biridir. Tasarımı ve teknolojisi sayesinde işlevsel olan ürün '
              'yelpazesi, Heper Moonlight’ı hem konut hem de kentsel alanlar için güçlü bir çözüm '
              'hâline getirir. Marka; mimari aydınlatma (park armatürleri, bollardlar, duvar ve '
              'tavan armatürleri, projektörler, gömme armatürler), teknik aydınlatma (yol, tünel ve '
              'LED sokak aydınlatması) ve özel üretim ürünler sunar.\n\n'
              '70’in üzerinde ülkede satılan ürünleriyle Heper Moonlight, profesyonel dış mekân '
              'aydınlatma ihtiyaçlarının tedarikçisidir. Marka yeni aydınlatma sistemleri '
              'tasarlamanın yanı sıra mevcut sistemleri yenileyerek onlara yeni bir ömür ve esneklik '
              'kazandırır.'),
    'na-de-elektronik-san-tic-ltd': dict(
        name='Na-De Elektronik', slug='na-de-elektronik', cats=['Yapı Malzemesi'], loc=None,
        yil=None, website='http://na-de.com.tr',
        about='Na-De Elektronik San. ve Tic. Ltd. Şti., Türkiye’de bina otomasyonu ve haberleşme '
              'sektörünün önde gelen kuruluşlarından biridir. 1970’li yıllardan bu yana iç ve dış '
              'pazarlar için çok sayıda otomasyon ve haberleşme ürünü üreten şirket, teknoloji ve '
              'kalite alanındaki birikimini her geçen yıl artırarak sektörde kırk yılı aşkın bir '
              'deneyime ulaşmıştır.'),
    'krafta': dict(
        name='Krafta', slug='krafta', cats=['Mobilya'], loc=None, yil='1958', website=None,
        about='Krafta’nın geçmişi, çağdaş mobilya tasarımı ve üretimi yapan bir şirket olarak '
              '1958 yılına uzanır. Markanın bakış açısı, disiplinler arası bileşenlerin '
              'harmanlandığı bir tasarım ölçütü yaratmaktır. Tasarımda yalınlık öğesini '
              'önemsemenin yanı sıra, tasarımın duruşunu tam olarak ifade etmek daima odak '
              'noktası olmuştur. Krafta, farklı becerilere sahip çok sayıda tasarımcı ve '
              'zanaatkârı bir araya getirerek geleneksel mobilya üretim tekniklerini çağdaş '
              'tasarımla birleştirir.'),
    'ersa-mobilya': dict(
        name='Ersa Mobilya', slug='ersa-mobilya', cats=['Mobilya'], loc='Ankara', yil='1958',
        website=None,
        about='Türkiye’nin ofis mobilyası üreticileri arasında güvenilirliği ve kalitesiyle önemli '
              'bir konuma sahip olan Ersa, sektöre 1958 yılında adım atmıştır. Bir bölümü ailenin '
              'üçüncü kuşağı tarafından yönetilen Ersa, ofis mobilyalarının yanı sıra sandalye ve '
              'kanepe gibi oturma birimleri üretir. Ürünleri arasında çalışma masaları, çoklu '
              'çalışma grupları, konsollar, keson ve sehpaların yanında bölücü paneller ile evrak, '
              'arşiv ve vestiyer dolapları yer alır.\n\n'
              'Çağdaş iş yaşamının en önemli özelliklerinden biri olan verimliliğin motivasyonla '
              'sağlanabileceğine inanan Ersa; işlevsel, pratik, ergonomik ve kişiselleştirilebilir '
              'tasarımlarla iş ortamındaki mutluluğu artırmayı hedefler.\n\n'
              'Sürdürülebilirliği üretim felsefesinin merkezine koyan Ersa, fabrikasında çevre dostu '
              'bir altyapı geliştirmiş; artık ahşap tozunu ısınma ve enerji üretimi için özel '
              'fırınlarda yakarak doğal gaz kullanmamaktadır. ISO 14001 ve OHSAS 18001 belgeleri, '
              'markanın insana ve çevreye saygılı üretim anlayışını belgelemektedir.'),
    'seranova-seramik': dict(
        name='Seranova Seramik', slug='seranova-seramik', cats=['Zemin & Yüzey Kaplama'], loc=None,
        yil='2000', website=None,
        about='Yatırımlarının ardından 2000 yılında üretim aşamasına geçen Seranova Seramik, yeni '
              'yatırımlarıyla birlikte yıllık üretim kapasitesini 2 milyon m²’den 11 milyon m²’ye '
              'çıkarmıştır. Seramik sektöründeki yenilikleri yakından takip eden marka, iç ve dış '
              'pazarlardaki itibarını sürdürmek için istikrarlı bir büyüme ve gelişme hedefler.\n\n'
              '50.000 m²’si kapalı, 480.000 m²’si açık toplam 530.000 m²’lik bir alanda yer ve duvar '
              'karosu üreten Seranova Seramik, yılda 6 milyon m² yer ve 5 milyon m² duvar karosu '
              'olmak üzere toplam 11 milyon m² üretim kapasitesine sahiptir. Tüm ürünler TS EN 14411 '
              'standardına göre üretilir; şirket ISO 9001 Kalite Yönetim Sistemi ve ISO 14001 Çevre '
              'Yönetim Sistemi’ni uygular. Üretiminin en az %35’ini ihracata ayıran Seranova '
              'Seramik, seramik ürünlerin Avrupa’da serbest dolaşımını sağlayan CE uygunluk '
              'beyanına kaydolan ilk kuruluştur.'),
    'rengarenk-kidsyoung-furniture': dict(
        name='Rengarenk', slug='rengarenk', cats=['Mobilya'], loc=None, yil=None, website=None,
        about='Rengarenk, çocuk ve genç odaları için özgün tasarımlı mobilyalar üretir. Markada '
              'düşlerden alınan ilham; güvenilirlik, sorumluluk ve işlevsellikle buluşur. Yalnızca '
              'estetik açıdan tasarlanmakla kalmayıp yaşam alanlarına renk katacak biçimde '
              'kurgulanan Rengarenk Genç Odası Mobilyaları, en güncel teknolojiyle ve profesyonel '
              'ekiplerin yönetiminde yüksek kalitede üretilmektedir.'),
    'megaron-by-makomim-ltd': dict(
        name='Megaron', slug='megaron', cats=['Mobilya'], loc=None, yil='1989', website=None,
        about='Makomim, 1989 yılında mimarlık, inşaat ve mühendislik alanlarında faaliyet gösteren '
              'bir aile şirketi olarak kurulmuştur. Kurulduğu günden bu yana mimari ve iç mekân '
              'projeleri ile uygulama ve ticari işler alanında hizmet vermiştir; gerçekleştirdiği '
              'mimari projeler ve iç mekân uygulamaları çok sayıda dergi ve kitapta yayımlanmıştır.\n\n'
              'Makomim ekibi, uygulamalarında malzeme, incelikli detaylar ve işçilik kalitesi '
              'aracılığıyla mekânsal ihtiyaçları keyif araçlarına dönüştürmeyi amaçlar. Çözümlerde '
              'daima odakta olan konfor, güçlü bir altyapıyla sağlanır; gereksiz detaylardan ve '
              'fazlalıktan arınma kurumun kendi üslubu hâline gelmiştir. İlk kez 2003 yılında '
              'Paris’te tanıtılan “Megaron” markası, şirketin yarattığı mobilya koleksiyonudur.'),
    'derin-design': dict(
        name='Derin Design', slug='derin-design', cats=['Mobilya', 'Dekorasyon & Tamamlayıcılar'],
        loc='İstanbul', yil=None, website=None, about=None),
    'tureks': dict(
        name='Tureks', slug='tureks', cats=['Zemin & Yüzey Kaplama', 'Yapı Malzemesi'],
        loc='Afyonkarahisar', yil='1982', website=None,
        about='Tureks, 1982 yılından bu yana Türkiye’nin önde gelen doğal taş şirketlerinden biri '
              'olarak; gelişmiş kurumsal yapısı ve ileri teknolojisiyle dünya genelindeki '
              'müşterilerine yüksek kaliteli ve eşsiz çeşitlilikte Türk mermeri, traverten, kireç '
              'taşı ve oniks tedarik etmektedir.\n\n'
              'Tureks, müşterilerinin ihtiyaç ve beklentileri doğrultusunda ürün ve hizmetlerini '
              'sürekli geliştirmeye odaklanır; sürekli bir Ar-Ge programıyla müşterilerine düzenli '
              'olarak yeni ürün ve uygulamalar sunar. Şirket, çalışan güvenliğini önceliklendiren '
              'iş sağlığı ve güvenliği mevzuatına uygun olarak faaliyet gösterir ve tüm '
              'operasyonlarında yüksek etik standartları benimser.'),
    'carisa': dict(
        name='Carisa', slug='carisa', cats=['Mutfak & Banyo', 'Dekorasyon & Tamamlayıcılar'],
        loc='İstanbul', yil=None, website=None, about=None),
    'accuro-korle': dict(
        name='Accuro-Korle', slug='accuro-korle', cats=['Mutfak & Banyo', 'Dekorasyon & Tamamlayıcılar'],
        loc='İstanbul / Ataşehir', yil=None, website=None,
        about='Çağdaş konut ve iş yerlerinde ısıtma cihazları, bütünsel tasarım kurgusunda belirleyici '
              'bir rol üstlenir. Accuro-Korle radyatörleri, göz önünden gizlenen salt işlevsel '
              'nesneler olmaktan çıkıp birer sanat eseri niteliği taşır; işlevsellik, güzellik ve '
              'estetiğin kalıcı bir birleşimini sunar.\n\n'
              'Accuro-Korle’nin tasarım ekibi, her iç mekânı zenginleştirecek özgün bir radyatör '
              'yelpazesi geliştirmiştir. Çağdaş ama zamansız bir zarafete sahip fırçalanmış '
              'paslanmaz çelik radyatörler, kişiye özel her iç mekâna üstün bir hava katar.\n\n'
              'Marka, cihazlarının dayanıklılığına ve güvenilirliğine mutlak öncelik verir. '
              'Radyatörlerde yalnızca en yüksek kalitede masif paslanmaz çelik kullanılır; boya ya '
              'da vernik uygulanmaz, böylece saf paslanmaz çeliğin doğal parlaklığı korunur. Tüm '
              'birleşimler argon gazıyla TIG kaynak tekniğiyle yapılır ve en az 16 bar basınca '
              'karşı test edilir. Tüm radyatörler usta zanaatkârlar tarafından el işçiliğiyle '
              'üretilir ve her cihaz tamamlandığında kalite kontrolünden geçer.'),
    'solide-signature-by-ayyapi': dict(
        name='Solide Signature', slug='solide-signature', cats=['Mobilya', 'Cephe & Açıklıklar'],
        loc=None, yil='2007', website=None,
        about='Ayyapı Mimarlık, 2007 yılında Ümit Aykanat tarafından kurulmuştur. Şirketin başarısı '
              've güvenilirliği otuz yıllık bir deneyime dayanır. Ayyapı; perakende zincirleri, '
              'oteller, ofis bölme sistemleri, fuar yapıları, konut ve iş merkezi taahhüt işleri '
              'alanlarında faaliyet gösterir. Mimarlık, iç mimarlık ve yapı denetimi arasındaki '
              'bütünleşme ile disiplinler arası yaklaşım, şirketin başarısının anahtarıdır.\n\n'
              'İnşaat mühendisi, mimar ve teknik personel çeşitli projelere katkı sunarak dünya '
              'standartlarına uygun, nitelikli ve güvenilir hizmet verir. Ayyapı, sözleşmeden doğan '
              'tüm yükümlülüklerini yerine getirmesi ve işleri zamanında teslim etmesiyle tanınır. '
              'Şirket, öncelikle kendi projelerinin tedariğini sağlamak üzere 4.500 m²’lik tesisinde '
              'mobilya üretimi de yapmaktadır.'),
    'buka-sofa': dict(
        name='Buka Sofa', slug='buka-sofa', cats=['Mobilya'], loc=None, yil=None, website=None,
        about='Buka markası adını, Türkçedeki “bukalemun” sözcüğünden alır. Buka kanepeler, '
              'bukalemunların renk değiştirmesi kadar kolay biçimde kılıf değiştirme olanağı sunar. '
              '“Ev ortamına uyum” kavramı kullanıcıya farklı seçenekler, tercihlerinde esneklik ve '
              'değiştirme imkânı tanır. Güvenilirlik, yalınlık, işlevsellik ve tasarım, Buka '
              'koleksiyonlarının sunduğu temel değerlerdir. Markanın çıkış noktası, “kaliteli '
              'mobilyayı herkes için erişilebilir kılmak”tır.'),
    'asas-aluminium': dict(
        name='ASAŞ Alüminyum', slug='asas-aluminyum', cats=['Cephe & Açıklıklar', 'Yapı Malzemesi'],
        loc='İstanbul / Beykoz', yil='1990', website=None,
        about='1990 yılındaki kuruluşundan bu yana istikrarlı bir büyüme gösteren ASAŞ, altı kıtada '
              '90’dan fazla ülkeye ihracat yapan Avrupa’nın önde gelen üreticilerinden biridir. '
              'Şirket; Akyazı ve Karapürçek’teki toplam 1.000.000 m² alan içinde 400.000 m² kapalı '
              'alana kurulu tesislerinde alüminyum profil, alüminyum kompozit panel, alüminyum yassı '
              'ürün, PVC profil ve panjur üretimi alanlarında hizmet verir.\n\n'
              'ASAŞ; inşaat, otomotiv, raylı sistemler, ticari araçlar, havacılık, enerji, ambalaj, '
              'tüketim ürünleri ve denizcilik gibi birçok sektöre çözüm ortaklığı sunarken kendi '
              'markalarıyla da pazarda yer alır. Kendi markası altında sattığı ürün grupları '
              'arasında alüminyum mimari sistemler (kapı, pencere ve giydirme cephe sistemleri), '
              'alüminyum kompozit panel, PVC kapı ve pencere sistemleri, alüminyum tasarım ürünleri, '
              'panjur sistemleri ve garaj kapıları bulunur.\n\n'
              'Sektöründe Türkiye’nin ilk Ar-Ge merkezine sahip olan ASAŞ, tam entegre üretim '
              'tesisi sayesinde tedarik zincirinde ihtiyaç duyulabilecek tüm işlevleri aynı çatı '
              'altında sunar.'),
    'fyt-muhendislik': dict(
        name='FYT Mühendislik', slug='fyt-muhendislik', cats=['Cephe & Açıklıklar'], loc=None,
        yil=None, website=None,
        about='FYT Mühendislik’in vizyonu, rekabete uygun güncel teknolojiyi benimseyen ve kaliteden '
              'ile güvenilirlikten ödün vermeyen küresel bir şirket olmaktır.\n\n'
              'Şirket; giydirme cephe sistemleri, alüminyum panel cephe sistemleri, şeffaf cephe '
              'sistemleri, çatı ışıklığı sistemleri, doğrama sistemleri ve güneş kırıcı sistemler '
              'alanlarında müşteri gereksinimlerine uygun çeşitli çözümler sunarak beklentileri en '
              'üst düzeyde karşılamayı amaçlar.\n\n'
              '2011 yılından itibaren yürütülen tüm hizmetler, akredite bir kuruluş tarafından ISO '
              '9001 kalite yönetim sistemine uygun olarak belgelendirilmiştir. Süreçlerde sürekli '
              'iyileştirme, uygunsuzlukların yerinde tespiti ve giderilmesi ile düzeltici ve '
              'önleyici faaliyetlerin yürütülmesi esas alınır.'),
    'novawood': dict(
        name='Novawood', slug='novawood', cats=['Cephe & Açıklıklar', 'Zemin & Yüzey Kaplama'],
        loc='İstanbul', yil=None, website=None,
        about='Novawood, “ağacın” dokusunu “yaşamın” dokusuna işlemek amacıyla yola çıkmıştır. Amaç, '
              'doğanın bu en güzel armağanını nefes alan, yaşayan mekânlara dönüştürmekti. Marka, '
              'dünyanın zengin ormanlarını sürdürülebilir çözümlerle korumaya çalışırken '
              'ürünlerinin en önemli marka değeri olarak “uzun ömürlülüğü” benimser. Doğanın '
              'uyumundan ve estetiğinden ilham alan ürünler, en gelişmiş ısıl işlem yöntemi olan '
              '“Thermowood” ile dayanıklılık ve direnç kazanır.\n\n'
              'Novawood, Türkiye’de “Thermowood” ısıl işlem teknolojisini tanıtan ilk şirket olmanın '
              'haklı gururunu taşır. En güncel teknolojiyle donatılmış dünya standartlarındaki '
              'tesisleri ve yıllık 18.000 m³ üretim kapasitesiyle; İngiltere, İsviçre, Kanada, '
              'Almanya, İspanya, Japonya, Rusya, Finlandiya, Çin ve Hindistan başta olmak üzere 55 '
              'ülkeye ürün göndermektedir.\n\n'
              'Avrupa standartlarına tam uyumlu çalışma ilkeleri, Thermowood üretimini de içeren '
              'güçlü teknolojik altyapısı, Türkiye’nin tek masif ahşap Ar-Ge laboratuvarı ve '
              'yeniliğe odaklı kurum kültürü, Novawood’u sektörünün lideri yapan niteliklerdir.'),
    'pulver-kimya': dict(
        name='Pulver Kimya', slug='pulver-kimya', cats=['Yapı Malzemesi'], loc='Kocaeli', yil='1988',
        website=None,
        about='Toz boya sektöründe Türkiye bugün Avrupa’nın en büyük üreticisi ve en yüksek hacimli '
              'ihracatçı ülkeler arasındadır. Pulver Kimya 1988 yılından bu yana toz boya sektöründe '
              'faaliyet göstermektedir ve ulaştığı büyüklükle Türkiye’deki toz boya üretiminin '
              '%30’unu karşılamaktadır. Ürettiği ürünlerin yarısı 30 ülkeye ihraç edilmektedir.\n\n'
              'Pulver Kimya, Türkiye’nin en büyük, Avrupa’nın ise ikinci büyük toz boya şirketidir. '
              'Ürün yelpazesi mimari, otomotiv, beyaz eşya ve genel sanayi toz boyaları olmak üzere '
              'dört bölümden oluşur. Şirket 1994’te Qualicoat Sınıf 1, 1995’te ISO 9001, 2009’da '
              'WRAS, 2010’da Qualicoat Sınıf 2, 2012’de GSB ve 2015’te GSB Master belgelerini '
              'almıştır.'),
    'teknosel': dict(
        name='Teknosel', slug='teknosel', cats=['Yapı Malzemesi'], loc='İstanbul', yil='1998',
        website=None,
        about='1998 yılında İstanbul’da kurulan Teknosel Teknolojik Yapı Ürünleri, “yüksek kaliteli '
              'teknolojik yapı malzemeleri”nin ithalatı, pazarlaması ve satışı alanında faaliyet '
              'gösterir. Şirket, bu yapı ürünlerinin günümüzün çağdaş mimari projelerinde ve '
              'tasarımlarında uygulanmasını sağlar.\n\n'
              'Teknosel; güncel mimari eğilimleri, gelişmeleri ve kalite standartlarını takip eden, '
              'mimarların taleplerini karşılayacak teknik bilgiye sahip genç ve deneyimli bir '
              'kadroya sahiptir. “Müşteri odaklılık” ve “verimlilik” temelli bir yönetim süreci '
              'izleyen şirket, kurum kültüründe “güven” ve “müşteri memnuniyeti”ni ilke edinir.'),
    'kastamonu-entegre': dict(
        name='Kastamonu Entegre', slug='kastamonu-entegre',
        cats=['Yapı Malzemesi', 'Zemin & Yüzey Kaplama', 'Mobilya'], loc='İstanbul', yil='1969',
        website=None,
        about='Gelişime ve yeniliğe önem veren, çevreye ve tüketici haklarına saygılı, pazarlama, '
              'satış ve hizmet süreçlerini müşteri odaklı bir felsefeyle tanımlayan Hayat Holding’in '
              'temelleri 1937 yılına dayanır. Hayat Holding bugün 10 ülkede, 41 şirketle, 32 marka '
              'altında, 29 üretim tesisinde 14.000’den fazla çalışanla ahşap panel sanayii, hızlı '
              'tüketim, enerji, liman işletmeciliği, perakende ve inşaat sektörlerinde faaliyet '
              'göstermekte ve 100’den fazla ülkeye ihracat yapmaktadır.\n\n'
              'Hayat Holding’in iki lokomotif şirketinden biri olan Kastamonu Entegre Ağaç Sanayi, '
              '1969 yılında ahşap panel sanayiinde üretim yapmak üzere kurulmuş ve bugün alanında '
              'Türkiye’de birinci, Avrupa’da dördüncü, dünyada yedinci sıradaki küresel bir güç '
              'hâline gelmiştir.'),
    'trio-ceiling': dict(
        name='Trio Ceiling', slug='trio-ceiling',
        cats=['Yapı Malzemesi', 'Dekorasyon & Tamamlayıcılar'], loc='İstanbul', yil=None,
        website=None,
        about='Trio Ceiling, tüm faaliyetlerinde uluslararası kurumsal yönetim standartlarını '
              'benimseyerek artan biçimde katma değer üretir; müşteri memnuniyetini, sosyal '
              'sorumluluğu ve çevrenin korunmasını ilke edinir. Uzun yıllar önce başlayan yolculuğunu '
              'iyileştirme ve verimlilik odaklı bir büyüme stratejisiyle sürdürmektedir.'),
    'kalsedon-stone': dict(
        name='Kalsedon Stone', slug='kalsedon-stone',
        cats=['Zemin & Yüzey Kaplama', 'Cephe & Açıklıklar'], loc=None, yil=None, website=None,
        about='Kalsedon Stone, yapay kültür taşı ve tuğla üretiminde (taş-tuğla sistemleri ve panel '
              'sistemleri) uzmanlaşmıştır. Ürünleri; konut, villa, peyzaj, apartman, tatil evi, '
              'otel, park, golf sahası, kafe ve resepsiyon holü gibi hem iç hem dış mekân '
              'duvarlarında yaygın olarak kullanılabilir.\n\n'
              'Ürünler su geçirmez, yangına dayanıklı, ses yutucu ve ısı yalıtımlı özelliklere '
              'sahiptir. Doğal taşa kıyasla daha fazla enerji tasarrufu sağlar ve ağırlığı doğal '
              'taşın yalnızca yarısı ya da üçte biri kadardır.'),
    'koleksiyon': dict(
        name='Koleksiyon', slug='koleksiyon', cats=['Mobilya'], loc='İstanbul', yil='1972',
        website=None,
        about='Koleksiyon, müşterilerine sunduğu tasarım ve hizmet mükemmelliğiyle eşsiz bir itibara '
              'sahiptir. Gerek Türkiye’de gerekse yurt dışında, seçtiği sektörlerdeki kırk yıllık '
              'deneyimine ve temel ilkelerine dayanarak; tasarımlarının yalın ve gösterişsiz '
              'zekâsıyla, üretim kalitesiyle ve müşteri ihtiyaçlarını kavrayışıyla tanınır.\n\n'
              'Tasarımları kültür, tarih ve coğrafya konusunda derin bir bilgiye dayanır. '
              'Çözümleri, bildiğimiz geçmişi ve onun renklerini, seslerini ve biçimlerini geri '
              'kazandırırken bilmediğimiz geleceğe işaret eder. Amaç daima mükemmelliğin peşinden '
              'gitmek ve belirli değerlere bağlı kalmaktır. Koleksiyon, geçmişten geleceğe uzanan '
              'bir çizginin daima var olduğunu; yerel kültür ve ideallerin yanı sıra hepimizin '
              'paylaştığı evrensel değerlerin bulunduğunu bilir.'),
    'neteren-luxury-wall-panels': dict(
        name='Neteren', slug='neteren',
        cats=['Dekorasyon & Tamamlayıcılar', 'Zemin & Yüzey Kaplama'], loc='İstanbul', yil='2005',
        website=None,
        about='İstanbul merkezli Neteren, 2005 yılında İspanya’dan taş görünümlü fiberglas duvar '
              'paneli ithal etmek ve Türkiye pazarında münhasıran dağıtmak üzere kurulmuştur. '
              'Türkiye’de taş, tuğla ve ahşap gibi doğal öğelerin %100 doğal görünümünü ve dokusunu '
              'panel, kemer ve kolon biçimlerinde sunan polyester ve fiberglas panelleri sağlayan '
              'ilk şirkettir.\n\n'
              'Türkiye ve çevre ülkelerde 10.000’den fazla projede çözüm ortağı olarak yer almıştır. '
              'Alışılmış al-sat ticaret anlayışından farklı olarak; proje analizinden satışa, hızlı '
              'teslimattan montaj denetimine, esnek çalışma planlarından etkin program yönetimine '
              'uzanan duyarlı ve ilerlemeci bir yaklaşım benimsemiştir.\n\n'
              '2016 yılında, duvar kaplaması konusundaki derin bilgi birikimiyle ve mimarlar ile '
              'tasarımcıların talepleri doğrultusunda, başta beton ve gerçek taş olmak üzere doğal '
              'bileşenlerden üretilen yeni ürünler geliştirmeye karar vermiştir. 2005’ten bu yana '
              'ithalatçı ve özel markalı ürün sahibi kimliğinin yanı sıra, Türkiye’deki '
              'fabrikalarında saf çimento esaslı CRETOX Doğal Beton Panel ve PU esaslı CROSSWALK '
              'doğal görünümlü 3D duvar paneli gibi kendi ürünlerini de üretmeye başlamıştır.\n\n'
              'Neteren bugün iki ana kategori altında beş özgün marka barındırır: çimento, kuvars ve '
              'taş gibi doğal bileşenlerden üretilen panellerden oluşan “NATURA Koleksiyonu” ile '
              'PVC, PU ve polyesterden üretilen doğal etkili panellerden oluşan “REPLICA Koleksiyonu”.'),
    'yapitas': dict(
        name='Yapıtaş Kablo & Profil', slug='yapitas-kablo-profil', cats=['Yapı Malzemesi'],
        loc=None, yil='1976', website=None,
        about='Yapıtaş Kablo & Profil, 1976 yılında bir ticaret şirketi olarak kurulmuştur. 2000’li '
              'yılların başında “Zorlu Koşullar İçin Özel Ürünler” sloganıyla kablo üretimine '
              'başlayan şirket, o güne dek yalnızca Türkiye dışında üretilebilen bazı özel kablo '
              'türlerine odaklanmıştır; floropolimer yalıtımlı kablolar ve termokupl kabloları bu '
              'ürünlerin başında gelir.\n\n'
              'Şirket bugün, “sürekli iyileştirme” ilkesiyle fabrika yenileme, teknolojik yatırımlar '
              've Ar-Ge faaliyetleri aracılığıyla üretim kapasitesini, ürün yelpazesini, müşteri '
              'memnuniyetini ve kalite hedeflerini artırmaktadır. Başlıca ürünleri floropolimer '
              'yalıtımlı kablolar, silikon kauçuk yalıtımlı kablolar, termokupl kabloları ve cam '
              'elyaf örgülü silikon kablolardır. Ürün portföyünde ayrıca silikon hortumlar, silikon '
              'kalıp parçaları ile silikon kauçuktan üretilen kapı ve cephe profilleri yer alır.'),
    'termodinamik': dict(
        name='Termodinamik', slug='termodinamik', cats=['Yapı Malzemesi'], loc=None, yil='1992',
        website=None,
        about='1992 yılında 20-40 kW kapasiteli bin adet katı yakıtlı kazan üretimiyle faaliyetine '
              'başlayan Termodinamik, 15 Avrupa ülkesine ihracat yaparak Avrupa ısıtma sektöründe '
              'saygın bir konum edinmiş ve Türkiye’de liderliğini sürdürmüştür.\n\n'
              'Avrupa’daki sektör eğilimlerini yakından izleyen ve Türkiye’de pazar kuralları '
              'oluşturan Termodinamik; pelet, biyokütle, odun, kömür, gaz ve elektrikli kazanlar, '
              'pelet ve odun sobaları ile gazlı ve elektrikli su ısıtıcıları üreterek konut ve '
              'endüstriyel kullanıcıların ihtiyaçlarına yanıt verir. Yeniliğe duyduğu açlık, '
              'koşulsuz kalite anlayışı ve son kullanıcının ihtiyaçlarını kavraması, ürünlerini '
              'yapı marketlere, showroomlara ve mekanik tesisat profesyonellerinin depolarına '
              'taşımıştır.'),
    'fatih-panjur': dict(
        name='Fatih Panjur', slug='fatih-panjur', cats=['Cephe & Açıklıklar'], loc=None, yil=None,
        website=None, about=None),
    'kurtoglu-aluminyum': dict(
        name='Kurtoğlu Alüminyum', slug='kurtoglu-aluminyum',
        cats=['Cephe & Açıklıklar', 'Yapı Malzemesi'], loc='Tekirdağ', yil='1960', website=None,
        about='Şirket 1960 yılında bakır ve kurşun üreticisi olarak kurulmuştur. 1980 yılında 1.200 '
              'tonluk bir alüminyum ekstrüzyon presiyle alüminyum profil üretimine başlanmıştır.\n\n'
              'Kurtoğlu Alüminyum, İstanbul’a yaklaşık 100 km uzaklıktaki Çorlu’da yer alır. Son '
              'yatırımların ardından tesis bugün 31.000 m² kapalı alanda faaliyet göstermekte olup '
              'tam entegre ve çağdaş bir üretim tesisi hâline gelmiştir. Şirketin başlıca '
              'nitelikleri arasında yıllık yaklaşık 34.000 tonluk kapasite, 500 civarında nitelikli '
              'çalışan, ISO 9001 kalite sistemi belgesi, Qualicoat ve Qualanod belgeleri ile CE '
              'belgesi bulunur. Tesiste kalıphane, 800 ile 2.600 ton arasında değişen alüminyum '
              'ekstrüzyon presleri, eloksal hattı, elektrostatik toz boya tesisi ve CNC işleme '
              'merkezi yer alır.\n\n'
              'Kurtoğlu Alüminyum ürünleri; İsviçre, Almanya, Avusturya, Yunanistan, Kıbrıs, '
              'Bulgaristan, Rusya Federasyonu, Ukrayna, İsrail, Azerbaycan ve Kazakistan başta olmak '
              'üzere otuzdan fazla ülkeye ihraç edilmektedir.'),
    'lantana-parke': dict(
        name='Lantana Parke', slug='lantana-parke', cats=['Zemin & Yüzey Kaplama'], loc='İstanbul',
        yil=None, website=None, about=None),
    'btm-bitumlu-tecrit-maddeleri': dict(
        name='BTM', slug='btm', cats=['Yapı Malzemesi'], loc=None, yil='1975', website=None,
        about='Merkezi İzmir’de bulunan ve Türkiye’nin önde gelen yalıtım şirketi olan BTM’nin '
              'temelleri 1975 yılında İstanbul’da Türkiye Şişe Cam Grubu tarafından atılmıştır. '
              'Şirket 1986 yılından bu yana İzmir Kemalpaşa Organize Sanayi Bölgesi’ndeki üretim '
              'tesislerinde yeni ve teknolojik yatırımlarla faaliyetlerini artırarak sürdürmektedir. '
              'Su yalıtımı, ısı yalıtımı ve çatı kaplama malzemelerinin üretildiği toplam beş '
              'tesise sahiptir.\n\n'
              'Türkiye’de birçok ilke imza atan BTM; 1989’da polimer bitümlü su yalıtım örtüsü, '
              '1995’te kapalı gözenekli XPS ısı yalıtım levhası ve 1996’da çatı kaplama malzemesi '
              'Shingle ile yalıtım sektöründeki öncü konumunu pekiştirmiştir. 2007 yılında Polypan '
              'markasıyla sentetik örtü üretimine başlamıştır.\n\n'
              'Kendi teknolojisini ve ürünlerini geliştiren BTM; mühendislik gücüne ve laboratuvar '
              'altyapısına yatırım yapmış, araştırma kuruluşları ve üniversitelerle ortak projeler '
              'yürütmüştür. Kuruluşundan bu yana ürün yelpazesini hızla genişleten BTM’nin ürünleri, '
              'çatıdan temele kullanıcının her ihtiyacına yanıt verebilecek geniş bir aralıkta '
              'sunulmakta olup şirket, talep hâlinde 180’den fazla farklı ürün üretme kabiliyetine '
              'sahiptir.'),
    'cretox-concrete-panel-haute-couture': dict(
        name='Cretox', slug='cretox', cats=['Cephe & Açıklıklar', 'Dekorasyon & Tamamlayıcılar'],
        loc='İstanbul', yil=None, website=None,
        about='Cretox, Türkiye’de Neteren Ltd. Şti. tarafından geliştirilen ve üretilen ultra hafif '
              'beton panelin simge markasıdır.'),
    'pergola-as': dict(
        name='Pergola A.Ş.', slug='pergola-as', cats=['Dış Mekan & Peyzaj', 'Cephe & Açıklıklar'],
        loc='İstanbul', yil=None, website=None,
        about='Pergola A.Ş., sanatın yapıcı, çözümleyici ve evrensel enerjisinden ilham alan; '
              'kalıcı, estetik ve yalın bir çabanın ürünü olan özel motorlu tente sistemleriyle dört '
              'mevsimin sorunlarını çözüme dönüştüren Pergola markasını yeniden tasarlar.\n\n'
              'Pergola motorlu tente sistemleri her hava koşulunda ideal koruma sağlar. Özel tente '
              'kumaşı sayesinde; güneşe, yağmura ve rüzgâra karşı yüksek koruma sunarak bahçe, '
              'balkon ve teras gibi dış mekânlardan en iyi biçimde yararlanma olanağı verir. '
              'Uygulanabilen çeşitli kapatma sistemleriyle bütünleşen Pergola motorlu tente sistemi, '
              'tümüyle kapalı bir mekâna dönüştürülebilir.\n\n'
              'Özel germe sistemiyle kolayca açılıp kapanacak biçimde tasarlanan motorlu, raylı '
              'tente sistemi yaşama yeni bakış açıları kazandırır. İsteğe göre hazırlanan özel tente '
              'kumaşı, katlanır tavan ve LED aydınlatma sayesinde gece ile gündüz arasındaki fark '
              'ortadan kalkar ve günün her saatinde yaşanabilir mekânlar oluşturulur.'),
    'lagu-2': dict(
        name='Lagu', slug='lagu', cats=['Mobilya', 'Dekorasyon & Tamamlayıcılar'],
        loc='İstanbul / Ataşehir', yil=None, website=None,
        about='İyi detaylarla yaşamayı kutlayan bir tasarım yaklaşımı.\n\n'
              'Lagu; masif ahşap, taş ve pirinç gibi doğal malzemeleri geleceğe dönük üretim '
              'teknikleriyle birleştirerek zamansız ve rafine yaşam alanları yaratır. Tasarımcı Ufuk '
              'Ceylan tarafından kurulan marka, ilk Famed koleksiyonundan yola çıkarak zanaatkârlığa, '
              'yalınlığa ve işlevselliğe odaklanan kapsamlı bir tasarım stüdyosuna dönüşmüştür.\n\n'
              'Lagu bugün İstanbul Ataşehir’deki üretim tesisi ve showroomundan çalışmalarını '
              'yürütür; kendi internet sitesi ve önde gelen uluslararası tasarım platformları '
              'aracılığıyla küresel müşterilere ulaşır. Yüzü aşkın ürünüyle; iç mimarlık, endüstriyel '
              'tasarım, kullanıcı deneyimi ve grafik tasarım alanlarından oluşan ekibi, Studio Lagu '
              've Ufuk Ceylan imzalarıyla kişiye özel mobilya ve mekân çözümleri geliştirir.\n\n'
              'Markanın Malzeme Laboratuvarı, yenilikçi ve sürdürülebilir malzemelerden oluşan geniş '
              'bir kitaplık sunarak müşterilerin doku ve yüzeyleri keşfetmesine ve projelerine özel '
              'ilham panoları oluşturmasına olanak tanır.'),
    'kale-2': dict(
        name='Kale', slug='kale', cats=['Mutfak & Banyo'], loc='İstanbul', yil=None, website=None,
        about='Kale; her konut ve yaşam alanında konforu artırmak üzere yüksek kaliteli, işlevsel, '
              'şık ve uygun fiyatlı ürünler sunan güvenilir ve öncü bir markadır.\n\n'
              'Kale; çağdaş banyolar için vitrifiye ve yardımcı ürünler, banyo ve mutfak '
              'aksesuarları, akrilik küvet ve duş tekneleri ile duş-küvet kabinleri üreterek '
              'kaliteyi, işlevselliği ve estetiği uygun fiyatlarla bir araya getirir.\n\n'
              'Kale banyo mobilyaları, tasarım dünyasının en güncel eğilimlerini yansıtan banyolar '
              'yaratır. Klasik görünümlerden en yeni desen ve dokulara uzanan yelpazesiyle Kale, '
              'tasarımda en çok arzu edilen estetik görünümü sunar. Kale Grubu ayrıca deneyimini ve '
              'gücünü çağdaş bir mutfak konseptinde birleştirir; dinamik tasarımlar, kişiye özel '
              'çözümler ve kalite güvencesiyle hayalinizdeki mutfağı gerçeğe dönüştürür.'),
    'aspen': dict(
        name='Aspen', slug='aspen',
        cats=['Yapı Malzemesi', 'Zemin & Yüzey Kaplama', 'Dekorasyon & Tamamlayıcılar'],
        loc='İstanbul', yil='1989', website=None,
        about='1989 yılından bu yana ilk günkü tutkuyla çalışan Aspen; metal asma tavanlar, bölme '
              'duvarlar, yükseltilmiş döşeme ve LED aydınlatma sistemlerini kapsayan geniş ürün '
              'yelpazesiyle mimarlara, iç mimarlara ve müteahhitlere çözümler sunar.\n\n'
              'Tüm ölçeklerde sunduğu iç mekân ürünleriyle (asma tavan, bölme duvar ve döşeme) '
              'inşaat sektöründeki çağdaş çözümlere imza atan Aspen, yıllar içinde edindiği bilgi ve '
              'deneyimle sektöre en iyi biçimde hizmet eder. Müşteri memnuniyeti ve güven ilkelerine '
              'dayalı ürün yelpazesiyle Türkiye’yi küresel ölçekte temsil eder.\n\n'
              'Aspen ürünleri, Sakarya Bölme Duvar ve Yükseltilmiş Döşeme Üretim Tesisi ile '
              'Eskişehir Metal Asma Tavan Üretim Tesisi olmak üzere iki ayrı entegre üretim '
              'tesisinde en yüksek kalite koşullarında üretilmektedir.'),
    'dendro-parke': dict(
        name='Dendro Parke', slug='dendro-parke', cats=['Zemin & Yüzey Kaplama'], loc='İstanbul',
        yil=None, website=None,
        about='Dendro Lamine Parke; 60 bin m² açık ve 12 bin m² kapalı alana sahip üretim '
              'tesisimizde, Avrupa EN 13489 ve E1 kalite standartlarına uygun olarak en güncel '
              'teknolojik ekipmanlarla ve profesyonel uzmanlığımızla üretilmektedir.\n\n'
              'Üç katmanlı Dendro Lamine Parke, ahşabın ortam koşullarına bağlı genleşme gibi '
              'istenmeyen davranışlarını bastırmak üzere üç farklı ahşap katmanın dikey olarak '
              'birleştirilmesiyle oluşturulur. Üç katmanlı yapı sayesinde ahşabın doğal hareketi '
              '%70 oranında giderilir. En iyi stabilite için iklim kontrollü fırınlarda kurutulan üç '
              'farklı ahşap katman, E1 standardına uygun özel yapıştırıcılarla birleştirilir; her '
              'Dendro paneli kısa kenarlarında 10 cm’lik denizcilik sınıfı kontrplak ya da dayanıklı '
              'sert ahşap içerir.\n\n'
              'Otomatik makinelerle uygulanan altı kat özel UV sertleştirilmiş Bona X yüzey '
              'bitirmesi, Dendro Lamine Parke’yi daha dirençli kılar. Marka; doğal, renklendirilmiş, '
              'fırçalanmış veya yağ uygulanmış gibi özel doku seçenekleriyle tek, iki, üç ve dört '
              'şeritli lamine parke alternatifleri sunar.'),
}

# Archello'da AYRI birer marka sayfası olan ama MİMARLAB'da TEK bir kayda karşılık gelen slug'lar.
# VitrA Bathrooms ve VitrA Karo, VitrA'nın iki iş kolu; MİMARLAB'da zaten tek bir "VitrA" satırı var
# (offices id 725) ve isim anahtarlı dedup ikisini de aynı satıra götürür. Ayrı satır açmak, marka
# dizininde birbirinin kopyası üç kart üretirdi (bkz. [[project_duplicate_name_key_limitation]]).
#
# TUZAK — Archello'daki `/brand/vitra` BU MARKA DEĞİLDİR: o, İsviçre Birsfelden merkezli mobilya
# üreticisi **Vitra AG**'dir (doğrulandı: adres "Klünenfeldstrasse 22, 4127 Birsfelden,
# Switzerland"). Türk VitrA (Eczacıbaşı) ile yalnızca adı benzeşen, tamamen ayrı bir şirkettir ve
# proje künyelerinde "Furniture" elemanıyla geçer. Alias listesine eklenirse İsviçre Vitra'nın
# proje kenarları Türk VitrA'nın pop-up'ında görünür — bu yüzden BİLEREK dışarıda bırakılmıştır.
BRAND_ALIASES = {'vitra-bathrooms': 'vitra', 'vitra-karo': 'vitra'}

# Bir markanın Archello sayfasında birden fazla iş kolu varsa `about` metni en zengin olanından
# alınır; VitrA'da bu VitrA Bathrooms'tur (VitrA Karo metni yalnızca karo iş kolunu anlatıyor).
PREFERRED_SOURCE_FOR_ALIAS = {'vitra': 'vitra-bathrooms'}


def build(raw_path: str, out_path: str) -> int:
    raw = {r['archelloSlug']: r for r in json.load(open(raw_path, encoding='utf8'))}
    missing = [s for s in raw if s not in TR]
    if missing:
        print(f'HATA: çevirisi olmayan marka: {missing}', file=sys.stderr)
        return 1

    out = []
    for ah_slug, r in raw.items():
        tr = TR[ah_slug]
        canonical = BRAND_ALIASES.get(ah_slug, tr['slug'])
        # Alias grubunda about/cats birleşimi: tercih edilen kaynağın metni, kategoriler UNION.
        preferred = PREFERRED_SOURCE_FOR_ALIAS.get(canonical)
        about = tr['about']
        cats = list(tr['cats'])
        if preferred and preferred != ah_slug:
            about = TR[preferred]['about']
            for c in TR[preferred]['cats']:
                if c not in cats:
                    cats.append(c)
        out.append({
            'archelloSlug': ah_slug,
            'archelloUrl': r['archelloUrl'],
            'canonicalSlug': canonical,
            'name': tr['name'],
            'cats': cats,
            'loc': tr['loc'],
            'yil': tr['yil'],
            'website': tr['website'],
            'about': about,
            'logoUrl': r['logoUrl'] or None,
            'coverUrl': r['coverUrl'] or None,
        })

    # Alias'lar aynı canonicalSlug'a düştüğü için tekilleştir — tercih edilen kaynak kazanır.
    by_slug = {}
    for rec in out:
        prev = by_slug.get(rec['canonicalSlug'])
        if not prev:
            by_slug[rec['canonicalSlug']] = rec
            continue
        pref = PREFERRED_SOURCE_FOR_ALIAS.get(rec['canonicalSlug'])
        if pref and rec['archelloSlug'] == pref:
            by_slug[rec['canonicalSlug']] = rec

    result = list(by_slug.values())
    json.dump(result, open(out_path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(f'{len(raw)} Archello markası → {len(result)} MİMARLAB marka kaydı → {out_path}',
          file=sys.stderr)
    n_about = sum(1 for r in result if r['about'])
    print(f'  açıklamalı: {n_about}, açıklamasız (Archello’da yoktu): {len(result) - n_about}',
          file=sys.stderr)
    return 0


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    sys.exit(build(a.raw, a.out))
