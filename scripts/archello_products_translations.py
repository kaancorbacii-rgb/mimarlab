# -*- coding: utf-8 -*-
"""27 Archello ürününün Türkçe çeviri/eşleme tablosu (elle küratörlükten geçmiş).

Ölçüler BURADA DEĞİL, build_payload.py içinde İngilizce açıklamanın DIMENSIONS bloğundan
programatik olarak ayrıştırılır — 27 ürün × 7 ölçüyü elle kopyalamak sessiz transkripsiyon
hatalarına açıktı. Emperyal (inç/lbs) sütunu BİLEREK atılır: kaynakta birden çok satırda hatalı
(ör. Link "Height: 63 cm | 248”", Lyora "35 kg | 15.87 lbs"), ayrıca kullanıcı metrik/Türkçe
biçim istedi.
"""

# Aynı koleksiyonun birden fazla ürünü aynı açıklamayı paylaşır (kaynakta da öyle).
DESCRIPTIONS = {
    'miura': """Miura Koleksiyonu, kendine özgü formu ve farklı çaplardaki halat dokusuyla dikkat çeker. Koleksiyon, dış mekânlar için birbirini tamamlayan parçalar sunarak farklı ihtiyaçlara çözüm üretir. Şıklığı ve işlevselliği bir araya getiren oturma grubu, yemek grubu ve koleksiyonun her bir parçası, bulunduğu mekâna rafine bir karakter katar.

İki renk varyasyonuyla sunulan koleksiyonda Bisque, açık alanlara uyum sağlayan doğal tonlara sahipken; Nightfall daha koyu bir seçenekle daha sofistike bir atmosfer yaratır. Hem estetiği hem çok yönlülüğü öne çıkaran Miura Koleksiyonu, dış mekânları konfor ve etkileyici bir görsel varlıkla zenginleştirmek üzere tasarlanmış özel bir ürün yelpazesi sunar.""",

    'link': """Link Koleksiyonu'nu tasarlarken Junpei ve Iori Tamaki, bir araya getirilen parçaların nasıl bir bağ kuracağını ve bu bağlantının farklı biçimlerde nasıl evrileceğini hayal etti. Koleksiyonu ifade edebilmek için hem sadeliği hem de ayırt edici, akılda kalıcı detayları bir arada barındıran bir tasarımın gerekli olduğuna inandılar. Böylece hasırın gücü, derinin rafine varlığıyla buluştu.

Tasarım, deri görünümlü hasırla sarılmış bölümler ile sarılmamış bölümler arasındaki karşıtlığı yalın bir gövde strüktürü üzerinde vurgular. Bu karşıtlık, hoyratlık ile inceliğin dengesinde bir güzellik yaratır; etkileyici ve ayırt edici tasarımın bir arada var olmasına olanak tanır.""",

    'lyora': """Yalın çizgileri ve geometrik formlarıyla tanımlanan Lyora Koleksiyonu, işlevselliğe bir saygı duruşudur.

Rafine bir zarafetle hayata geçirilen koleksiyon, bulunduğu mekâna sofistike bir hava ve tarihe dair ince bir dokunuş taşır. Tümüyle tik ağacından üretilen strüktür, hem işlevselliği hem ergonomiyi en üst düzeye çıkaran özenli bir işçilikle güçlendirilmiştir.

Çağdaş ve eklektik etkilerle zenginleşen zarif mid-century üslubuyla koleksiyon; oturma grubu, kompakt ölçülere sahip yemek grubu ve sarmalayan çizgileriyle öne çıkan modüler bir birim olarak sunulur.""",

    'ralph': """Ralph Koleksiyonu; estetik, işlevsellik ve ergonominin sentezini zarifçe cisimleştiren tik ağacı ve halat detaylarıyla tasarlandı.

İkonik bir tasarıma dönüşen koleksiyon, çerçeveli detayları ile güçlü ve net çizgileri sayesinde görsel bir bütünlük kurar. Tik ağacının doğal güzelliğini tamamlayan tonlardaki minderlerle zenginleşen koleksiyon, dış mekân yaşamına rafine bir yorum getirir.

Modern bir tasarım yaklaşımını yeni nesil sürdürülebilir malzemelerle harmanlayan koleksiyon, stil kodlarını zarafet ve özgünlükle yeniden tanımlar. Oturma grubu, yemek grubu ve şezlongdan oluşan her bir öğesiyle Ralph Koleksiyonu, insan ölçeğinde konforu ve gerçek ergonomik tasarımı öne çıkarır.""",

    'lorvain': """Lorvain Koleksiyonu, saf bir dinginlikle biçimlenen konturlarında ifadesini bulan sağlam bir berraklıkla tanımlanır. Güçlü alüminyum profiller ve sakin, kendinden emin çizgiler parçalara köklü bir varlık kazandırırken; ölçülü oranlar genel dili rafine ve iddiasız tutar.

Koleksiyon; bir tekli koltuk, ikili ve üçlü kanepe, orta sehpa, şezlong ve uzanma koltuğundan oluşarak tutarlı bir malzeme tavrına sahip eksiksiz bir dış mekân ailesi kurar. Yemek grubu, aynı strüktürel alüminyum çerçeve üzerinden bu ifadeyi sürdürür ve tüm tipolojiler arasında görsel uyumu korur. Halat dokuları ve renkleri özellikle Lorvain için geliştirilmiş, koleksiyona ince bir dokunsal nüans katmıştır.

Gücü sadelikle dengeleyen Lorvain; dayanıklı, dingin ve sessizce yükseltilmiş bütünlüklü bir kimlik sunar.""",

    'elythia': """Elythia, ahşabın ilksel gücünü dile getirir; malzemeyi en saf hâliyle kucaklar ve onu halatla bağlamanın yalın, köklendirici eylemiyle buluşturur. Sağlam ve topraksı bir strüktür ile özenle düşünülmüş detaylar arasındaki etkileşim sayesinde koleksiyon, hem yerden yükselen gücü hem de doğada bulunan yumuşak teslimiyeti yakalar.

Junpei ve Iori Tamaki tarafından tasarlanan koleksiyon; bir oturma grubu, bir yemek grubu, bir şezlong ve bir uzanma koltuğundan oluşur. Her parça yumuşak çizgiler ve sıcak, dokunsal bir varlıkla biçimlendirilmiştir. Tik ağacı, ince halat öğeleri ve taştan esinlenen yüzeylerle tamamlanarak sakin, samimi ve sessizce ifade dolu bir malzeme kompozisyonu oluşturur.

Elythia, tik ağacının daha şefkatli bir yorumunu SNOC'un dünyasına taşıyarak doğal malzemeleri hem köklü hem yumuşakça yükseltilmiş bir dış mekân ifadesine dönüştürür.""",

    'savio': """Kadim arketiplerin bilgeliğinden doğan Savio Koleksiyonu, zamansız geometrinin çağdaş mobilya ve heykel merceğinden bir keşfidir.

Binlerce yıldır kullanılan kemerler ve sütunlar üzerine yapılan araştırma, Savio masalarının ve bahçe aydınlatmalarının temel ilkelerini biçimlendirdi. Dijital teknolojiler, parabolik eğriler ve SNOC bünyesindeki ileri üretim yöntemleri sayesinde; kum taşı benzeri dayanıklı bir kompozitte, alışılmışın dışında zarif ve akışkan formlar ortaya çıktı.

Masaların ve aydınlatmaların kendine özgü dokulu yüzeyi ışığı dağıtarak yüzeye sofistike bir derinlik kazandırır. Savio Yemek Masaları, dış mekân yaşamının iddialı parçalarıdır. Gün boyunca ışık ve gölge yumuşakça yer değiştirirken masaların görünümü değişir ve geometrideki detaylar açığa çıkar. Geceleri ise Savio bahçe ve masa aydınlatmaları, depoladıkları güneş enerjisiyle mekânı aydınlatır.""",

    'sestri': """Denizciliğin teknik dünyasından ilham alan Sestri Koleksiyonu, işlevsel hassasiyeti sakin ve mimari bir dile çevirir. Bir teknedeki her öğenin net bir amaca hizmet etmesi gibi, Sestri de ifadesini tanımlı çizgiler, dengeli oranlar ve titizlik ile hafiflik arasındaki ölçülü etkileşim üzerine kurar.

Koleksiyon; bir yönetmen sandalyesi, bir şezlong ve bir orta sehpadan oluşur. Her biri aynı disiplinli geometri ile alüminyum ve tik ağacı arasındaki uyum çevresinde tasarlanmıştır. Yönetmen sandalyesi bu ilişkiyi alüminyum çerçevesi ve tik kolçak detaylarıyla öne çıkarırken; şezlong, temiz ve uzun bir profille estetiği sürdürür. Orta sehpa ise form ve malzemenin sessizce dengelenmiş birleşimiyle aileyi tamamlar.""",

    'caleo': """Caleo Koleksiyonu, çağdaş formu zamansız malzemelerle harmanlayarak gösterişsiz bir lüksü cisimleştirir. Dış mekân yaşamı için tasarlanan bu modüler oturma grubu, konfor ve uyarlanabilirliği önceliklendirir; esnekliğini korurken mekânı tanımlayan zarif ve minimalist çizgiler sunar.

Rafine Ash ve Natural tik ağacı gövdesiyle üretilen koleksiyonun modülerliği yaratıcı kurgulara davet eder ve farklı çevrelere sorunsuzca uyum sağlar. Yumuşak ama dayanıklı kumaşlarla döşenen oturma birimleri, sağlam strüktürle güzel bir karşıtlık kuran dokunsal bir sıcaklık sunar; böylece yumuşaklık ve gücün uyumlu bir birleşimi doğar. Caleo Koleksiyonu, dingin bir zarafet ve huzur deneyimi sunarak her mekânı sofistike bir sığınağa dönüştürür.""",

    'thara': """Thara, uçsuz bucaksız bir dinginlik fikrini araştırır; tik ağacını hem köklü hem sessizce yükseltilmiş hissettiren bir forma dönüştürür.

Adam Court tarafından tasarlanan yüksek sırtlı berjer; yumuşak eğriliği ve açıklık sezdirirken güçlü, kararlı bir varlığı koruyan dingin siluetiyle tanımlanır. Parça kendi başına kendinden emin durur; rafine oranlar ve dengeli bir duruşla elde edilmiş belirgin bir kimlik taşır. Tik işçiliği tasarımın merkezindedir ve kendini dokunsal sıcaklığı ile çizgilerinin berraklığında gösterir.

Thara, strüktür ile yumuşaklık arasında bir uyumu yansıtır; mekânı rahatlıkla, berraklıkla ve sakin bir otoriteyle tutmak üzere biçimlendirilmiş bir parçadır.""",

    'alvo': """Alvo Koleksiyonu, güçlü alüminyum profilleri sıcak tik detayları ve doğal örgü dokularıyla birleştirerek SNOC'un kimliğine taze bir malzeme ifadesi kazandırır. Oturma grubu; net bir geometri ve sakin, çağdaş bir karakterle biçimlendirilmiş bir tekli koltuk, bir ikili ve bir üçlü kanepeden oluşur.

Koleksiyonun kapsamını genişleten Alvo; entegre masa öğeleriyle kurgulanabilen modüler bir sistem, bir uzanma koltuğu modülü ve bir şezlong içerir. Böylece farklı dış mekân çevrelerinde uyarlanabilir yerleşimler mümkün olur. İki farklı masa ölçüsünde sunulan yemek parçalarıyla koleksiyon, tüm tipolojiler boyunca tutarlı ve rafine bir tasarım dilini korur.""",

    'take-out': """Take-Out ailesinin bir parçası.

Take-Out Mini; Take-Out ailesinin sadeliğini, dayanıklılığını ve kolay taşınabilirliğini daha genç kullanıcılara taşır. İlkokul (K-5) eğitim ortamlarının ölçeğine göre tasarlanan ürün; çocukların öğrenmek, oynamak ve bir araya gelmek için toplandığı açık hava sınıflarını, okul bahçelerini ve aile dostu mekânları destekler. Yeniden düzenlenebilecek kadar hafif olması, eğitimcilere ve bakım verenlere etkinliğe uygun ortamlar kurma imkânı tanır; ister grup çalışması, ister yaratıcı oyun, isterse bir arkadaşla geçirilen sakin anlar için olsun.""",

    'tara-outdoor': """Tara Outdoor kendini saf bir monolit olarak ortaya koyar: anıtsal bir varlığı görsel hafiflikle birleştiren bir masa. Tümüyle betondan üretilen tasarım, ayak ile tabla arasındaki malzeme sürekliliğini öne çıkararak neredeyse atalara özgü bir denge duygusu sezdirir. Yine de burada Brütalist bir niyet yoktur: madde şiire dönüşür. İnce honlanmış, neredeyse dokunsal yüzey her gündelik hareketi bir varoluş anına çevirir. Malzemenin gücü formun inceliğiyle buluşur; bu denge Tara Outdoor masa ve sehpa ailesine ayırt edici bir karakter kazandırır: hem sağlam hem zarif, her dış mekânı sofistike bir ortama dönüştürebilecek nitelikte.""",

    'tara': """Anıtsal ama bir o kadar ifade dolu Tara masa ve sehpa ailesi, varlığını sakin bir otoriteyle ortaya koyar. Adını, kadim İrlanda kraliyet hanedanı için kutsal sayılan bir yerden alır. Beton ayak; çağdaş bir duyarlılık ve dokunsal bir incelikle yeniden yorumlanmış bir monolitin ağırbaşlılığını çağrıştırır. Birbirinin aynası iki öğe, hafif, duyusal ve zarif görünürken dengeyi sağlar. Betonun ton nüansları ile ayağın içbükey eğrileri, kusursuzluğa incelmiş bir güzellik yaratır. Beton, arkadan boyalı camın hafifliğiyle diyaloğa girer. Mineral yoğunluk ile ışıklı saydamlık arasındaki bu dengede Tara masa, mekâna düzen ve uyum getiren heykelsi bir varlığa dönüşür.""",

    'tone': """Görsel olarak yumuşak ve minimalist bir dile sahip Tone koltuk, bulunduğu ortamla kusursuzca bütünleşmek üzere tasarlandı. Yuvarlatılmış çerçevesi dokunmaya davet ederken, saf silueti sadeliği üstün konforla dengeler.

Tone; iki farklı file dokusu ve aynı koltuğa görsel bir tazelik kazandıran kılıf eklentileriyle malzemenin ifade gücünü öne çıkarır. Performance Mesh; nefes alan, açık ve yarı saydam bir örgü sunar. Lifestyle Mesh ise ev tekstiline yakın, daha yumuşak ve sık dokulu bir alternatif sağlar.""",

    'soleva': """Vincent Van Duysen imzalı Soleva şezlong, strüktür ile malzeme arasındaki dengeli ilişkiyle tanımlanır. Uzun alüminyum çerçevesi hassas bir kompozisyonun sınırlarını çizerken; Batyline sırtlık ve iki farklı kalınlıkta sunulan serbest minder bu kurguyu tamamlar. İstiflenebilir strüktür, uyarlanabilirliği tasarımın içine katarak farklı dış mekân bağlamlarını berraklık ve ölçülülükle destekler.""",
}

# Malzeme cümlesi (PRODUCT DETAILS) -> Türkçe "Malzeme" spec değeri.
MATERIALS = {
    'rope-alu': 'Halat ve elektrostatik toz boyalı alüminyum',
    'wicker-alu': 'Deri görünümlü hasır ve elektrostatik toz boyalı alüminyum',
    'teak': 'FSC sertifikalı tik ağacı',
    'teak-rope': 'FSC sertifikalı tik ağacı ve halat',
    'sandstone': 'Kum taşı',
    'sinter-alu': 'Sinterlenmiş taş tabla ve elektrostatik toz boyalı alüminyum',
    'teak-alu-tex': 'FSC sertifikalı tik ağacı, elektrostatik toz boyalı alüminyum ve textilene',
    'concrete': 'Beton',
    'concrete-glass': 'Beton ve arkadan boyalı cam',
    'alu-batyline': 'Alüminyum ve Batyline',
    'alu-hdpe': 'Alüminyum ve pudra kaplamalı çelik',
    'mesh': 'File (Performance Mesh / Lifestyle Mesh) ve döşeme kumaşı',
}

# index -> ürün eşlemesi. desc: DESCRIPTIONS anahtarı. mat: MATERIALS anahtarı (None = spec yazma).
PRODUCTS = [
    dict(i=0,  title='Miura Bisque 3 Kişilik Kanepe',            group='Mobilya', cat='Koltuk & Kanepe',  desc='miura',    mat='rope-alu',     designer=None, outdoor=True),
    dict(i=1,  title='Link Bisque 2 Kişilik Kanepe',             group='Mobilya', cat='Koltuk & Kanepe',  desc='link',     mat='wicker-alu',   designer='Junpei ve Iori Tamaki', outdoor=True),
    dict(i=2,  title='Lyora Lume Yemek Sandalyesi',              group='Mobilya', cat='Sandalye & Tabure',desc='lyora',    mat='teak',         designer=None, outdoor=True),
    dict(i=3,  title='Ralph Ash 2 Kişilik Kanepe',               group='Mobilya', cat='Koltuk & Kanepe',  desc='ralph',    mat='teak-rope',    designer=None, outdoor=True),
    dict(i=4,  title='Ralph Noche 2 Kişilik Kanepe',             group='Mobilya', cat='Koltuk & Kanepe',  desc='ralph',    mat='teak-rope',    designer=None, outdoor=True),
    dict(i=5,  title='Lorvain Nightfall 2 Kişilik Kanepe',       group='Mobilya', cat='Koltuk & Kanepe',  desc='lorvain',  mat='rope-alu',     designer=None, outdoor=True),
    dict(i=6,  title='Link Terra 2 Kişilik Kanepe',              group='Mobilya', cat='Koltuk & Kanepe',  desc='link',     mat='wicker-alu',   designer='Junpei ve Iori Tamaki', outdoor=True),
    dict(i=7,  title='Elythia Ash Uzanma Koltuğu',               group='Mobilya', cat='Koltuk & Kanepe',  desc='elythia',  mat='teak',         designer='Junpei ve Iori Tamaki', outdoor=True),
    dict(i=8,  title='Savio Noche Yuvarlak Yemek Masası',        group='Mobilya', cat='Masa',             desc='savio',    mat='sandstone',    designer=None, outdoor=True),
    dict(i=9,  title='Sestri Nightfall Uzun Yönetmen Sandalyesi',group='Mobilya', cat='Sandalye & Tabure',desc='sestri',   mat='teak-alu-tex', designer=None, outdoor=True),
    dict(i=10, title='Caleo Natural Yemek Masası',               group='Mobilya', cat='Masa',             desc='caleo',    mat='teak',         designer=None, outdoor=True),
    dict(i=11, title='Lorvain Nightfall 6 Kişilik Yemek Masası', group='Mobilya', cat='Masa',             desc='lorvain',  mat='sinter-alu',   designer=None, outdoor=True),
    dict(i=12, title='Savio Ash Yemek Masası',                   group='Mobilya', cat='Masa',             desc='savio',    mat='sandstone',    designer=None, outdoor=True),
    dict(i=13, title='Caleo Ash Yemek Masası',                   group='Mobilya', cat='Masa',             desc='caleo',    mat='teak',         designer=None, outdoor=True),
    dict(i=14, title='Savio Noche Yemek Masası',                 group='Mobilya', cat='Masa',             desc='savio',    mat='sandstone',    designer=None, outdoor=True),
    dict(i=15, title='Thara Ash Yüksek Sırtlı Berjer',           group='Mobilya', cat='Koltuk & Kanepe',  desc='thara',    mat='teak',         designer='Adam Court', outdoor=True),
    dict(i=16, title='Miura Bisque Tekli Koltuk',                group='Mobilya', cat='Koltuk & Kanepe',  desc='miura',    mat='rope-alu',     designer=None, outdoor=True),
    dict(i=17, title='Lyora Lume Tekli Koltuk',                  group='Mobilya', cat='Koltuk & Kanepe',  desc='lyora',    mat='teak',         designer=None, outdoor=True),
    dict(i=18, title='Alvo Bisque Sağ Uzanma Koltuğu Modülü',    group='Mobilya', cat='Koltuk & Kanepe',  desc='alvo',     mat='rope-alu',     designer=None, outdoor=True),
    dict(i=19, title='Alvo Bisque Tekli Koltuk',                 group='Mobilya', cat='Koltuk & Kanepe',  desc='alvo',     mat='rope-alu',     designer=None, outdoor=True),
    # mat=None: Archello sayfasında Take-Out Mini için malzeme bilgisi YOK (yalnızca indirmeye kapalı
    # bir "LF-Take-Out-Materials.pdf" var). Uydurulmuş bir malzeme spec'i yazmak yerine alan boş bırakıldı.
    dict(i=20, title='Take-Out Mini Bank',                       group='Dış Mekan & Peyzaj', cat='Bahçe Mobilyası', desc='take-out', mat=None, designer='Rodrigo Torres', outdoor=True),
    dict(i=21, title='Tara Outdoor Yemek Masaları',              group='Mobilya', cat='Masa',             desc='tara-outdoor', mat='concrete', designer='Sebastian Herkner', outdoor=True),
    dict(i=22, title='Tara Outdoor Dış Mekan Orta ve Yan Sehpalar', group='Mobilya', cat='Masa',          desc='tara-outdoor', mat='concrete', designer='Sebastian Herkner', outdoor=True),
    dict(i=23, title='Tara Orta ve Yan Sehpalar',                group='Mobilya', cat='Masa',             desc='tara',     mat='concrete-glass', designer='Sebastian Herkner', outdoor=False),
    dict(i=24, title='Tara Yemek Masaları',                      group='Mobilya', cat='Masa',             desc='tara',     mat='concrete-glass', designer='Sebastian Herkner', outdoor=False),
    dict(i=25, title='Tone Ofis Koltuğu',                        group='Mobilya', cat='Ofis Mobilyası',   desc='tone',     mat='mesh',         designer=None, outdoor=False),
    dict(i=26, title='Soleva Şezlong',                           group='Dış Mekan & Peyzaj', cat='Bahçe Mobilyası', desc='soleva', mat='alu-batyline', designer='Vincent Van Duysen', outdoor=True),
]

# Ölçü etiketi (İngilizce) -> Türkçe.
DIM_LABELS = {
    'height': 'Yükseklik', 'width': 'Genişlik', 'depth': 'Derinlik',
    'seat height': 'Oturum Yüksekliği', 'seat depth': 'Oturum Derinliği',
    'armrest height': 'Kolçak Yüksekliği', 'backrest height': 'Sırtlık Yüksekliği',
    'weight': 'Ağırlık', 'diameter': 'Çap', 'length': 'Uzunluk',
}

# Yeni açılacak marka profilleri (SNOC zaten var, bkz. offices id=775).
BRANDS = {
    'flexform': dict(
        name='Flexform', website='https://www.flexform.it', loc='Meda, İtalya',
        cats='Mobilya',
        about="""Flexform, yüksek zanaat değeriyle takdir edilen kanepe ve mobilya üretiminde köklü bir uzmanlık kültürüne sahip İtalyan sanayi kuruluşudur. Elli yılı aşkın süredir aynı ailenin yönetiminde olan marka, aşırılıktan uzak duran, devrimden çok reformu benimseyen ve uzun soluklu düşünülmüş istikrarlı bir kurumsal yaklaşımı sürdürmüştür.

Marka, tasarım iş birliği kültürüne doğal biçimde yakındır; bu yaklaşım, önde gelen tasarımcılar ve yaratıcı isimlerle kurduğu üstün ortaklıklar tarihinde açıkça görülür. Yaygın ve verimli bir uluslararası satış ve dağıtım yapısıyla desteklenen Flexform, reklam, araştırma ve inovasyon alanlarında da tutarlı yatırımlar yapar.

Marka kimliği ve başarısı, kurumsal misyonunun merkezinde yer alan ortak değerler üzerine kuruludur: Made in Italy, zamansız zarafet, konfor, kalite, tasarım tutarlılığı, çağdaşlık, güzellik ve dayanıklılık. Bu stratejik model, Flexform'u nitelikli mobilyanın büyük ve tarihî Made in Italy markalarından biri olarak küresel ölçekte tanınır kılmıştır."""),

    'teknion': dict(
        name='Teknion', website='https://www.teknion.com', loc='Toronto, Kanada',
        cats='Mobilya',
        about="""Teknion; orta ve üst segment ofis sistemleri ile ilgili mobilya ürünlerinin tasarımı, üretimi ve pazarlaması alanında faaliyet gösteren uluslararası bir markadır. Entegre ürün portföyü; sistem mobilyaları, hareketli mobilyalar, mimari duvar sistemleri, oturma birimleri, depolama ve dosyalama çözümleri, bağımsız gövde mobilyaları ve aksesuarları kapsayan çok sayıda ürün ailesinden oluşur.

1980'lerin başında tek bir ürün hattıyla (Teknion Office System) faaliyete başlayan marka, bugün panel tabanlı, bağımsız ve masa sistemleri dâhil olmak üzere farklı kurgular sunar. Oturma ürünleri istiflenebilir, lounge ve genel kullanım tiplerinden görev, ahşap ve yönetici koltuklarına uzanır. Toplantı, eğitim, kafe ve yemek alanları için tasarlanmış masalar ile tamamlayıcı depolama ve çalışma araçları da portföyün parçasıdır.

Teknion, 2003'ten bu yana sürdürülebilir kalkınmayı stratejik bir odak olarak benimsemiştir; çevresel girişimleri ve ürün tasarımındaki yenilikçiliği çok sayıda uluslararası ödülle tanınmıştır. Genel merkezi Toronto'da bulunan markanın ABD merkezi Mount Laurel (New Jersey), Avrupa merkezi ise Londra'dadır."""),

    'moltenic': dict(
        name='Molteni&C', website='https://www.molteni.it', loc='Giussano, İtalya',
        cats='Mobilya',
        about="""Molteni&C, İtalyan üretimiyle üst segment mobilya sektörünün lider bağımsız sanayi gruplarından biri olan Molteni Group'un çatısı altındadır. Grup; dünyanın en saygın mimarlık ofisleri ve tasarımcılarıyla kurduğu iş birliklerinin yanı sıra araştırma ve teknolojik inovasyona sürekli yatırım yaparak ürünlerine zamana direnen içkin bir kalite kazandırır.

1934 yılında Angelo ve Giuseppina Molteni tarafından bir zanaat atölyesi olarak kurulan şirket, 1950'lerde kimliğini dönüştürerek endüstriyel tasarım dönemini başlattı. Grup, 2012'den bu yana Gio Ponti arşivinin değerlendirilmesi üzerine çalışmakta olup 2015'te Molteni Müzesi'ni açtı; 2022'de ise yerleşkesini genişleterek Molteni Pavilion'u hizmete sundu.

Bünyesinde Molteni&C (iç ve dış mekân mobilyası, mutfaklar ve özel üretim çözümler), UniFor (çalışma alanı çözümleri) ve Citterio (bölme duvarlar ve ofis mobilyası) markalarını barındıran grup; bugün 100'ü aşkın ülkede, 700'den fazla satış noktası ve 100 tek marka mağazasıyla faaliyet göstermektedir."""),

    'landscape-forms': dict(
        name='Landscape Forms', website='https://www.landscapeforms.com', loc='Kalamazoo, ABD',
        cats='Dış Mekan & Peyzaj',
        about="""Landscape Forms; yüksek tasarım değerine sahip kent mobilyası, aydınlatma, strüktür ve özel çevre çözümlerinden oluşan entegre koleksiyonlar alanında sektörün öncü markasıdır.

Elli yılı aşkın süredir tasarımcıların ve diğer paydaşların dış mekânlarda bir aidiyet duygusu yaratmasına yardımcı olan kent mobilyaları ve aksesuarlar üretmektedir. Marka bunu; entegre ürün koleksiyonları, öncü teknoloji ve güçlü tasarım anlayışıyla gerçekleştirir.

Uluslararası tasarımcılarla ortaklık kurarak sıra dışı ürünler geliştiren Landscape Forms, kendi ekibini yüksek başarıya teşvik eder ve müşteri sadakati ile sektör liderliği kazandıran bir standartta çalışır. Markanın yaklaşımı sade bir ilkeye dayanır: tasarım, insan ve operasyonel mükemmellik yaptığı her işin merkezindedir."""),
}
