#!/usr/bin/env python3
"""67 bağlantılık partinin KÜRATÖRLÜK katmanı: aile gruplaması, kategori ve Türkçe metinler.

Kazıma (scrape-batch67.py) ham veriyi verir; hangi bağlantının hangi ANA ÜRÜNE ait olduğu, ürünün
MİMARLAB kategorisi ve İngilizce kaynakların Türkçesi burada ELLE belirlenir. Otomatik ad benzerliği
ile gruplamak DENENMEDİ, çünkü bu partide ad benzerliği yanıltıcı: "Madrigal" ile "Madrigal Chester"
aynı aile ama "Ithaca" ile "Ithaca Light" da öyle; buna karşılık "Assist Operasyonel"/"Assist
Yönetici" iki ayrı koltuk tipidir ve "Synergy Masa"/"Synergy Depolama"/"Synergy Tabure" üç ayrı
ürün TİPİdir — hepsi tek bir kurala sığmıyor.

Üç sözlük dışa açılır:
  BRANDS        — YALNIZCA yeni açılacak marka profilleri. Koleksiyon (offices.id=717) ve Bürotime
                  (id=771) ZATEN KAYITLI, onlara dokunulmaz; bu partide tek yeni marka Casa.
  DESCRIPTIONS  — Casa'nın İngilizce sayfalarının Türkçe karşılığı (bkz. aşağıdaki çeviri notu).
  FAMILIES      — 67 bağlantı -> 61 ana ürün.

Çeviri notu (Casa)
------------------
Casa'nın /en/ sayfaları İngilizce; metinler birebir değil, TÜRK MOBİLYA SEKTÖRÜ terminolojisiyle
çevrildi: sofa->kanepe, modular->modüler, armrest->kolçak, backrest->sırt, seat cushion->oturum
minderi, throw pillow->kırlent, daybed->uzanma koltuğu, upholstery->döşeme, springing->süspansiyon,
piping->biye, feet->ayak. Pazarlama abartısı ("supremely comfortable", "true standouts in the world
furniture scene") Türkçede olduğu gibi bırakılmadı; kurumsal ve ölçülü bir dile çekildi.
Ürün adları ÇEVRİLMEZ (Albalonga, Porto Conte...) — bunlar İtalyan yer adlarıdır.

Casa teknik tablosunun ETİKETLERİ kaynakta İKİ DİLLİ: 13 sayfa İngilizce ("structure", "springing"),
2 sayfa (Albalonga, Vivara) zaten Türkçe ("kasa", "oturum"). CASA_SPEC_TR ikisini de tek biçime
indirir; sözlükte olmayan bir değer AYNEN bırakılır (uydurmaktansa kaynak metni göstermek yeğdir).
"""

# ----------------------------------------------------------------------------------------------
# 1) Yeni marka profilleri
# ----------------------------------------------------------------------------------------------
BRANDS = {
    'casa': {
        'name': 'Casa',
        'loc': 'Ankara',
        'cats': 'Mobilya',
        'website': 'https://www.casa.com.tr',
        'about': (
            'Casa, 1972’de Ankara’da kurulan ve bugün Akyurt’taki üretim tesisiyle Türkiye’nin '
            'köklü mobilya üreticileri arasında yer alan bir markadır. Kanepe, koltuk, yemek ve '
            'çalışma grupları ile tamamlayıcı mobilyalardan oluşan koleksiyonlarını; İtalyan '
            'tasarımcı Mauro Lipparini’nin imzasını taşıyan Allover, Italia, Mare Nostrum ve Life '
            'Style serileri altında topluyor.\n\n'
            'Markanın üretim anlayışı, geleneksel döşeme ustalığını endüstriyel hassasiyetle bir '
            'araya getirmesiyle öne çıkar: masif ahşap ve metal karkaslar, farklı yoğunluklarda '
            'deforme olmayan poliüretan süngerler, zig-zag yay ve elastik kolan süspansiyon '
            'sistemleri ile koleksiyondan seçilebilen geniş kumaş ve hakiki deri seçenekleri. '
            'Modüler kanepe sistemleri, simetrik ve asimetrik kurgulara izin veren köşe, orta ve '
            'uzanma modülleriyle farklı mekân senaryolarına uyarlanabiliyor.\n\n'
            'Casa, Ankara’daki merkezinin yanı sıra İtalya’nın Meda kentindeki Casa International '
            'ofisiyle tasarım ve ihracat faaliyetlerini yürütür; ürünleri konut projelerinin yanı '
            'sıra otel, ofis ve ağırlama mekânlarında kullanılır.'
        ),
    },
}

# ----------------------------------------------------------------------------------------------
# 2) Casa teknik tablosu — etiket ve değer sözlüğü
# ----------------------------------------------------------------------------------------------
CASA_SPEC_TR = {
    # etiketler (İngilizce sayfalar)
    'structure': 'Karkas',
    'wooden structure': 'Ahşap Karkas',
    'springing': 'Süspansiyon',
    'seat padding': 'Oturum Dolgusu',
    'back padding': 'Sırt Dolgusu',
    'arm padding': 'Kolçak Dolgusu',
    'arm & back padding': 'Kolçak ve Sırt Dolgusu',
    'seat & back padding': 'Oturum ve Sırt Dolgusu',
    'seat and back padding': 'Oturum ve Sırt Dolgusu',
    'back cushion': 'Sırt Minderi',
    'upholstery': 'Döşeme',
    'piping': 'Biye',
    'feet': 'Ayak',
    'metal feet': 'Metal Ayak',
    'metal base': 'Metal Kaide',
    'wooden frame & feet': 'Ahşap Karkas ve Ayak',
    'shelf': 'Raf',
    # etiketler (zaten Türkçe gelen 2 sayfa — yalnızca büyük/küçük harf düzeltilir)
    'kasa': 'Kasa',
    'oturum': 'Oturum',
    'sırt minderi': 'Sırt Minderi',
    'alt kabuk': 'Alt Kabuk',
    'döner metal ayak': 'Döner Metal Ayak',
    'döşeme': 'Döşeme',
}

CASA_VALUE_TR = {
    'wooden frame': 'Ahşap karkas',
    'metal and wooden frame': 'Metal ve ahşap karkas',
    'wooden and metal frame': 'Ahşap ve metal karkas',
    'black metal and wooden frame': 'Siyah metal ve ahşap karkas',
    'wooden frame & metal base': 'Ahşap karkas ve metal kaide',
    'elastic belts': 'Elastik kolan',
    'zig-zag spring systems': 'Zig-zag yay sistemi',
    'available in fabrics and leathers of the collection':
        'Koleksiyondaki kumaş ve deri seçenekleriyle',
    'corresponding to covering': 'Döşeme kumaşıyla aynı',
    'copper-M1, brass-M2, titanium-M3, anthracite bronzed steel-M4':
        'M1 bakır, M2 pirinç, M3 titanyum, M4 antrasit bronz çelik',
    'copper-M1, brass-M2, titanium-M3, anthracite bronzed steel-M4 (Bonamico I)':
        'M1 bakır, M2 pirinç, M3 titanyum, M4 antrasit bronz çelik (Bonamico I)',
    'solid wood in stains walnut, palissandro, carbon oak, smoked oak (Bonamico II)':
        'Ceviz, palisander, karbon meşe ve füme meşe renklerinde masif ahşap (Bonamico II)',
    'walnut, smoked oak, carbon oak': 'Ceviz, füme meşe, karbon meşe',
    'walnut, smoked oak, carbon stained oak, sucupira, palissandro, cenere':
        'Ceviz, füme meşe, karbon meşe, sucupira, palisander, cenere',
    'solid wood stained walnut,carbon, smoked': 'Ceviz, karbon ve füme renklerinde masif ahşap',
    'solid wood stained walnut, palissandro,carbon, smoked oak':
        'Ceviz, palisander, karbon ve füme meşe renklerinde masif ahşap',
    'polyurethane foam covered with thermo fiber lining':
        'Termo elyaf ile kaplanmış poliüretan sünger',
    'non-deformable polyurethane D35 HR, covered with thermo fiber lining':
        'Termo elyaf ile kaplanmış, deforme olmayan D35 HR poliüretan sünger',
    '100% cotton cover filled with micro fibrefill':
        'Mikro elyaf dolgulu %100 pamuk kılıf',
    'non-deformable polyurethane soft (D35 HR) coated with quilted 100% cotton cover filled with micro fibrefill':
        'Mikro elyaf dolgulu, kapitone %100 pamuk kılıfla kaplanmış, deforme olmayan yumuşak '
        '(D35 HR) poliüretan sünger',
    'non-deformable polyurethane soft (D35 HR) D25':
        'Deforme olmayan yumuşak (D35 HR) ve D25 poliüretan sünger',
    'non-deformable polyurethane soft (D35 HR) and D25':
        'Deforme olmayan yumuşak (D35 HR) ve D25 poliüretan sünger',
    'non-deformable polyurethane soft (D35 HR) and D28':
        'Deforme olmayan yumuşak (D35 HR) ve D28 poliüretan sünger',
    'non-deformable polyurethane (D35 HR) and D28':
        'Deforme olmayan (D35 HR) ve D28 poliüretan sünger',
    'non-deformable polyurethane (D35 HR) D28 and D25':
        'Deforme olmayan (D35 HR), D28 ve D25 poliüretan sünger',
    'non-deformable polyurethane soft (D35 HR, D28) D25':
        'Deforme olmayan yumuşak (D35 HR, D28) ve D25 poliüretan sünger',
    'non-deformable polyurethane of varied densities (HR Soft; HLB; D28)':
        'Farklı yoğunluklarda deforme olmayan poliüretan sünger (HR Soft, HLB, D28)',
    'non-deformable polyurethane of varied densities (HR soft; HLB; D28)':
        'Farklı yoğunluklarda deforme olmayan poliüretan sünger (HR Soft, HLB, D28)',
    'non-deformable polyurethane D35 HR soft': 'Deforme olmayan yumuşak D35 HR poliüretan sünger',
    'non-deformable polyurethane D25 soft': 'Deforme olmayan yumuşak D25 poliüretan sünger',
    'non-deformable polyurethane (D35 HR)': 'Deforme olmayan D35 HR poliüretan sünger',
    'non-deformable polyurethane (D25 HR)': 'Deforme olmayan D25 HR poliüretan sünger',
    'fiberglass': 'Fiberglas',
    'fiberglass üzeri deri yada lake': 'Fiberglas üzeri deri ya da lake',
    'micro fibrefill ile kaplanmış D35 HR sünger': 'Mikro elyaf ile kaplanmış D35 HR sünger',
    'M1 bakır, M2 bronz, M3 titanyum, M4 antrasit': 'M1 bakır, M2 bronz, M3 titanyum, M4 antrasit',
    'kumaş veya deri': 'Kumaş veya deri',
}

# ----------------------------------------------------------------------------------------------
# 3) Casa ürün metinleri — Türkçe
# ----------------------------------------------------------------------------------------------
DESCRIPTIONS = {
    'albalonga': (
        'Adını, Aeneas’ın oğlu Ascanius tarafından kurulduğuna inanılan efsanevi Alba Longa '
        'kentinden alan Albalonga, bu adın içindeki “beyazlık” (alba) ve “uzunluk” (longa) '
        'kavramlarını sakin ve uzayan hatlarıyla mobilyaya taşır.\n\n'
        'Modüler bir kanepe sistemi olan Albalonga’yı tanımlayan iki yumuşak hacim vardır: '
        'oturum ve kolçak-sırt birimi. Her ikisi de tek parça kütleler hâlinde kurgulanmış, '
        'aralarında oluşan ince ve içe çekilmiş bir hat bu iki bileşeni kesintisiz biçimde '
        'birbirine bağlamıştır.\n\n'
        'Gereksiz süslemeden arındırılmış kompakt yapısı, kanepeye zahmetsiz bir zarafet ve '
        'yüksek oturum konforu kazandırır; serbestçe konumlandırılabilen küçük kırlentleri ise '
        'gündelik ve rahat bir yaşam kurgusuna olanak tanır.'
    ),
    'albarella': (
        'Albarella kanepe koleksiyonu, keskin ve net hatlarıyla öne çıkan geometrik formlardan '
        'oluşur. Casa International’ın bu donanımlı kanepe sistemi, estetik bütünlüğü ve '
        'simetrisiyle dikkat çekerken, aradığını bilen kullanıcılar için geniş bir seçenek '
        'yelpazesi sunar.\n\n'
        'Modüler kanepenin kolçakları; raf ve depolama üniteleriyle birlikte oturum alanına, '
        'sırt minderlerine ve hareketli kırlentlere tümüyle esnek ve bağımsız biçimde entegre '
        'olabilir. Böylece hem düz hem açılı; simetrik ve asimetrik pek çok kompozisyon '
        'kurulabilir. Kanepenin rafları, hacimleri sayesinde hem dekoratif hem gündelik '
        'objelerin yerleşimine uygundur.\n\n'
        'Albarella’nın güçlü gövdesi, ustalıkla işlenmiş sağlam malzemelerden üretilir. Hafif '
        'metal ayaklarından opsiyonel entegre raflarına kadar her parçası hem işlevsel hem '
        'dayanıklıdır.'
    ),
    'augusta': (
        'Adını taşıdığı Sicilya körfezi gibi, Augusta kanepeler de hem kucaklayan ve içe dönük '
        'hem de açılan ve geniş kompozisyonlarla tanımlanır. Soyutlanmış heykelsi formları, '
        'yüzyıl ortası modernizmine özgü doğal ve eğrisel jestleri güçlü hatlarla birleştirir.\n\n'
        'Organik bir karaktere sahip olan Augusta’nın gövdesi iki temel figürden oluşur: oturum '
        'platformu ve sırt. Bu iki bileşen kusursuz bir uyumla birleşerek bütünlüklü bir hacim '
        'oluşturur. Kanepe ve modülleri, kendine özgü biçimlenişiyle zeminden yükselen bir '
        'hafiflik hissi verir.\n\n'
        'Kanepe elemanları, biçim ve hacim tutarlılığını koruyan soğuk kalıplanmış poliüretan '
        'sünger ile üretilir. Işık ve gölge içinde yumuşakça akan net eğrileri ilk bakışta '
        'tanınır; segmentli hacimler ise ergonomiyi gözeten çok sayıda yerleşim kurgusuna '
        'olanak tanır.'
    ),
    'bisentina': (
        'Genel formunu Latisana’dan alan Bisentina; stili, konforu ve işlevselliği bir araya '
        'getirir. Gövdeyle bütünleşen kolçakları, sırt ve oturum bölümleri ile hareketli '
        'kırlentleri üst düzey bir oturum konforu sağlar.\n\n'
        'İster standart bir ikili kanepe ister karmaşık bir modüler kurgu olsun; Bisentina, '
        'klasik estetiğin konforlu bir yorumu olarak öne çıkar. Özenli tasarımında ahşap gövde '
        'alçak ayaklarla desteklenir ve kanepe zemine yakın konumlanır.'
    ),
    'bonamico': (
        'Bonamico’nun dingin tasarımı, zarif kolçak ve sırt bölümüyle çevrelenen geniş oturum '
        'alanı sayesinde bütünlüklü bir his yaratır. Ürün; zarif metal ayaklı ve doğal ahşap '
        'çerçeveli sırt yapısı olmak üzere iki farklı alternatif sunar.\n\n'
        'Çağdaş bir üslupla tasarlanmış klasik bir karşılama alanı koltuğu olan Bonamico, dengeli '
        'oranlarıyla küçük konut mekânlarına olduğu kadar geniş ağırlama alanlarına da kolaylıkla '
        'uyum sağlar.'
    ),
    'cordovado': (
        '“Italia” koleksiyonunun her parçasında olduğu gibi Cordovado da olağanüstü el işçiliğiyle '
        'dikkat çeker ve Casa’nın usta döşeme geleneğini sürdürür.\n\n'
        'Cordovado’nun net hatları, Casa International’ın köklü kanepe geleneğine çağdaş bir '
        'yaklaşım katar. Oturum minderleri, sırt minderleri ve geniş kolçakları üst düzey konfor '
        'için mikro elyaf ile doldurulan modüler yapısı; koleksiyondaki tüm doğal deri ve kumaş '
        'seçenekleriyle birlikte pek çok farklı ölçü alternatifi sunar.'
    ),
    'corleone': (
        'Corleone, tasarımındaki soylu karakterle güçlü bir ifade gücü ve zamansız izler taşıyan '
        'çağdaş bir zarafet ortaya koyar. Ürünün kendine özgü tasarımı; zarif döküm alüminyum '
        'platformu, yatay hatlarının geometrik uyumu ve konforlu yumuşak minderleriyle '
        'tamamlanır.\n\n'
        'Corleone’nin tasarımında teknoloji ile Casa’nın üstün döşeme ustalığı güçlü bir uyum '
        'içinde bir araya gelir.'
    ),
    'ithaca': (
        'Sonsuz sayıda iç mekân kurgusuna olanak tanıyan Ithaca; modüler yapısı, uzanma koltuğu '
        'seçenekleri ve dairesel modülleriyle “Allover” tasarım felsefesini yansıtan sıcak ve '
        'davetkâr bir ev arayışını karşılar.\n\n'
        'Yüksek ve alçak kolçak yapısının bir arada kullanılabilmesi, Ithaca’nın modüler '
        'kurgusunu zenginleştirir. Dairesel ve düz formlardaki geniş uzanma modülleriyle çok '
        'çeşitli kombinasyonlar oluşturulabilir.'
    ),
    'ithaca-light': (
        'Ithaca koleksiyonu içinde üç farklı klasik kanepe ölçüsüyle sadeleştirilen Ithaca Light, '
        'yalın görünümünü masif metal ayaklarıyla güçlendirir.\n\n'
        'Ithaca Light’ın sade hatları; konforlu oturum alanları, yumuşak kırlentleri ve zengin '
        'işçilik detaylarıyla üst düzey bir kullanım konforu sunar.'
    ),
    'latisana': (
        '“Italia” koleksiyonunun karakteristik özelliğini taşıyan Latisana, inceliği sadelikle '
        'birleştirir.\n\n'
        'Latisana’nın zarif ve yalın görünümü kapitone dikişlerle zengin bir detaya dönüşürken; '
        'güçlü ve zarif metal ayaklarla tamamlanan ince hatları, bulut hissi veren bir oturum '
        'konforuyla buluşur.'
    ),
    'porto-conte': (
        'Yüzeylerindeki yumuşak dışbükeylikler ve hacimlerindeki süreklilikle güçlenen net '
        'geometrisiyle Porto Conte kanepe; adını aldığı, kuzeybatı Sardinya’daki ve yüzyıllardır '
        'değerli mercanların çıkarıldığı körfez gibi bir korunma ve sığınma hissi verir.\n\n'
        'Porto Conte, kapitone işçiliğinin hafif ve dolaysız bir yeniden yorumu; klasik '
        'Chesterfield’in çağdaş bir okumasıdır. Gündelik ve rahat duruşu onu hem genç '
        'kullanıcılar hem de tasarımın kalıcı karakterini bilen daha olgun kullanıcılar için '
        'uygun kılar. Saf ve dolaysız biçimlerinde gereksiz hiçbir öge bulunmaz.\n\n'
        'Ürün ailesi; yan, köşe ve orta modüller ile puflardan oluşur ve kompakt kurgulardan '
        'geniş kompozisyonlara kadar çok çeşitli yerleşimlere olanak tanır. Kolçak, sırt ile '
        'kesintisiz biçimde devam eder.'
    ),
    'positano': (
        'Olağanüstü modülerliği ve esnekliği sayesinde Positano’nun tüm bileşenleri; düz veya '
        'köşe takımlar, simetrik ya da asimetrik kanepe grupları, yüksek veya alçak kolçak '
        'alternatifleri, yuvarlatılmış hatlar ve çok katmanlı platformlarla sayısız dekorasyon '
        'seçeneği sunar. Oturum minderlerini ve sırtlıkları doğal ahşap gövdenin çevresinde '
        'kolayca hareket ettirerek istediğiniz oturum kurgusunu oluşturabilirsiniz.\n\n'
        'Mauro Lipparini tasarımı Positano; Elle Decoration EDIDA 2015 ödüllerinde “Best of the '
        'Year 2015” Yaşam/Konut kanepe kategorisinde birincilik ve Oturma Birimi kategorisinde en '
        'iyi tasarım ödülünü kazanmıştır.\n\n'
        'Konforlu minderleri ve mermer tepsisi doğal ahşap gövde çevresinde kolayca hareket '
        'ederek farklı oturum düzenlerine olanak tanır. Ceviz, meşe, gül ağacı, sucupira ve '
        'akçaağaç gibi farklı doğal kaplama seçenekleriyle sunulan ahşap gövde, masif çelik '
        'ayaklar üzerinde yükselir.'
    ),
    'tisan': (
        'İki farklı kanepe ölçüsüyle sadeleştirilen Tisan’ın zarif ve yalın görünümü, '
        'koleksiyondan seçilebilen farklı renklerdeki hareketli kırlentlerle zenginleşir.\n\n'
        'Tisan’ın özenli tasarımı, klasik estetiğin konforlu bir örneğidir; güçlü doğal ahşap '
        'ayaklarla desteklenir.'
    ),
    'torreano': (
        'Torreano serisinin sade ve doğal tasarımı, yumuşak ve hacimli oturum minderleriyle '
        'birleşerek sıcak ve davetkâr bir konfor hissi verir. Kanepe, uzanma ve köşe modülleri '
        'dâhil tüm bileşenlerinin farklı ölçülerde sunulması, Torreano’yu her yaşam alanına uyumlu '
        'kılar.\n\n'
        'Ahşap gövdeyle bütünleşen geniş hacimli kolçak yapısı ve zeminden yükselen güçlü '
        'ayakları, Torreano’nun tasarımına dikkat çekici bir görkem katar.'
    ),
    'vivara': (
        'Napoli Körfezi’nin Capri, Ischia, Amalfi ve Positano gibi mücevherleri arasında yer alan '
        'küçük Vivara adası; el değmemiş bitki örtüsü ve berrak sularıyla korunan bir doğal '
        'rezervdir. Vivara kanepe de aynı saf ve etkileyici biçim arayışını yansıtır.\n\n'
        'Casa International koleksiyonlarının imzası hâline gelen Positano platform sistemi, bu '
        'yıl Vivara ile evrilir. Özgün ahşap platformun özünü korurken, parlak lake yüzeyle '
        'sunulan yatay çevre panelleri eklenmiştir. Sistemi taşıyan yeni geliştirilmiş metal '
        'karkas, yapıya elastik kolan entegrasyonuna olanak tanıyarak yüksek bir oturum konforu '
        'sağlar.\n\n'
        'Platformun yatay uzantıları yalnızca kolçak-sırt biriminin dolgun yapısal minderlerine '
        'değil, entegre aksesuarlara da yer açar: işlevsel birer tamamlayıcı olarak kurgulanan '
        'doğal deri raflar, kanepenin yanına ya da arkasına konumlandırılabilir.'
    ),
}

# ----------------------------------------------------------------------------------------------
# 4) Aileler — 67 bağlantı -> 61 ana ürün
# ----------------------------------------------------------------------------------------------
KOL = 'https://www.koleksiyondesign.com/tr/urunler/oturma-gruplari/kanepeler/'
CASA = 'https://www.casa.com.tr/en/'
BUR = 'https://www.burotime.com/kurumsal/urunler/'

# Koleksiyon: 28 bağlantı -> 27 aile (madrigal + madrigal-chester tek ailede birleşir).
# Her sayfa, kaynağın `allVariants` bloğundaki MODÜLLERİ (TIP 1, 150 SOFA, 3'LÜ...) versiyon
# olarak açar; modülü olmayan sayfa tek versiyonlu kalır ve popup'ta seçici gizlenir.
_KOL_SIMPLE = [
    ('chora', 'Chora'), ('play', 'Play'), ('bean', 'Bean'), ('gazel', 'Gazel'),
    ('roma', 'Roma'), ('obelix', 'Obelix'), ('almond', 'Almond'), ('duende', 'Duende'),
    ('capella', 'Capella'), ('odette', 'Odette'), ('line', 'Line'), ('diner', 'Diner'),
    ('savio', 'Savio'), ('oscar', 'Oscar'), ('laura', 'Laura'), ('alona', 'Alona'),
    ('dilim', 'Dilim'), ('evora', 'Evora'), ('serhas', 'Serhas'), ('serdivan', 'Serdivan'),
    ('ikaros', 'Ikaros'), ('vienna', 'Vienna'), ('tellasmar', 'Tellasmar'), ('tulip', 'Tulip'),
    ('simplissimo', 'Simplissimo'),
]

FAMILIES = [
    {'key': f'kol-{slug}', 'brand': 'koleksiyon', 'title': title, 'cat': 'Koltuk & Kanepe',
     'module_axis': 'Modül',
     'pages': [{'url': f'{KOL}{slug}-kanepeler/'}]}
    for slug, title in _KOL_SIMPLE
]

FAMILIES += [
    # Koleksiyon'un çalışma masası "Poema" ürünü D1'de ZATEN KAYITLI (products.id=226,
    # source_url .../masalar/calisma-masalari/poema/). Bu sayfa AYNI ADI taşıyan ama farklı bir
    # ürün olan KANEPE'dir; adı ayrıştırılmazsa mükerrer kontrolü (brand|||title) onu var sayıp
    # atlar ve kanepe hiç eklenmez. Bkz. batch67-build-payload.py#build.
    {'key': 'kol-poema', 'brand': 'koleksiyon', 'title': 'Poema Kanepe', 'cat': 'Koltuk & Kanepe',
     'module_axis': 'Modül', 'pages': [{'url': f'{KOL}poema-kanepeler/'}]},

    {'key': 'kol-madrigal', 'brand': 'koleksiyon', 'title': 'Madrigal', 'cat': 'Koltuk & Kanepe',
     'axis': 'Model', 'module_axis': 'Modül',
     'pages': [{'url': f'{KOL}madrigal-kanepeler/', 'model': 'Madrigal'},
               {'url': f'{KOL}madrigal-chester-kanepeler/', 'model': 'Madrigal Chester'}]},
]

# Casa: 15 bağlantı -> 14 aile (Ithaca + Ithaca Light tek ailede).
_CASA_SIMPLE = [
    ('albalonga', 'Albalonga', 'albalonga'),
    ('albarella-sofa', 'Albarella', 'albarella'),
    ('augusta', 'Augusta', 'augusta'),
    ('bisentina-sofa', 'Bisentina', 'bisentina'),
    ('bonamico-sofa', 'Bonamico', 'bonamico'),
    ('cordovado-sofa', 'Cordovado', 'cordovado'),
    ('corleone', 'Corleone', 'corleone'),
    ('latisana-sofa', 'Latisana', 'latisana'),
    ('porto-conte', 'Porto Conte', 'porto-conte'),
    ('positano-sofa-2', 'Positano', 'positano'),
    ('tisan-sofa', 'Tisan', 'tisan'),
    ('torreano-sofa', 'Torreano', 'torreano'),
    ('vivara', 'Vivara', 'vivara'),
]
FAMILIES += [
    {'key': f'casa-{key}', 'brand': 'casa', 'title': title, 'cat': 'Koltuk & Kanepe',
     'desc': key, 'pages': [{'url': f'{CASA}{slug}/'}]}
    for slug, title, key in _CASA_SIMPLE
]
FAMILIES += [
    {'key': 'casa-ithaca', 'brand': 'casa', 'title': 'Ithaca', 'cat': 'Koltuk & Kanepe',
     'desc': 'ithaca', 'axis': 'Model',
     'pages': [{'url': f'{CASA}ithaca-sofa/', 'model': 'Ithaca', 'desc': 'ithaca'},
               {'url': f'{CASA}ithaca-light-sofa/', 'model': 'Ithaca Light', 'desc': 'ithaca-light'}]},
]

# Bürotime: 24 bağlantı -> 20 aile. Modüller `technicalDrawings` etiketlerinden gelir
# (ör. "Üçlü Kanepe" / "İkili Kanepe"), ölçüleri de o bloktaki H/W/L başlıklarından.
_BUR_SIMPLE = [
    ('fab', 'Fab', 'Koltuk & Kanepe'),
    ('ark', 'Ark', 'Koltuk & Kanepe'),
    ('maya', 'Maya', 'Koltuk & Kanepe'),
    ('days', 'Days', 'Koltuk & Kanepe'),
    ('moby', 'Moby', 'Sandalye & Tabure'),
    ('bliss-sehpa', 'Bliss', 'Masa'),
    ('nova', 'Nova', 'Koltuk & Kanepe'),
    ('fin', 'Fin', 'Koltuk & Kanepe'),
    ('loria-tabure', 'Loria', 'Sandalye & Tabure'),
    ('opera-yonetici', 'Opera', 'Ofis Mobilyası'),
    ('bold-yonetici', 'Bold', 'Ofis Mobilyası'),
    ('gama', 'Gama', 'Ofis Mobilyası'),
    ('surf', 'Surf', 'Sandalye & Tabure'),
    ('agent', 'Agent', 'Ofis Mobilyası'),
    ('armada', 'Armada', 'Ofis Mobilyası'),
    ('arte', 'Arte', 'Masa'),
    ('bacca', 'Bacca', 'Vazo & Obje'),
]
FAMILIES += [
    {'key': f'bur-{slug}', 'brand': 'burotime', 'title': title, 'cat': cat,
     'module_axis': 'Modül', 'pages': [{'url': f'{BUR}{slug}'}]}
    for slug, title, cat in _BUR_SIMPLE
]

FAMILIES += [
    # Synergy: TEK bir çalışma/eğitim alanı sistemi; masa, depolama ve tabure onun ürün TİPLERİ.
    {'key': 'bur-synergy', 'brand': 'burotime', 'title': 'Synergy', 'cat': 'Ofis Mobilyası',
     'axis': 'Tip', 'module_axis': 'Modül',
     'pages': [{'url': f'{BUR}synergy-masa', 'model': 'Masa'},
               {'url': f'{BUR}synergy-depolama', 'model': 'Depolama'},
               {'url': f'{BUR}synergy-tabure', 'model': 'Tabure'}]},

    # Hey!: iki sayfa da "Bekleme" tipinde ve AYNI modül listesini paylaşıyor; ayıran şey
    # görselleri ve kurgusu (bekleme birimi / kanepe).
    {'key': 'bur-hey', 'brand': 'burotime', 'title': 'Hey!', 'cat': 'Koltuk & Kanepe',
     'axis': 'Kullanım', 'module_axis': 'Modül',
     'pages': [{'url': f'{BUR}hey', 'model': 'Bekleme Ünitesi'},
               {'url': f'{BUR}hey-kanepe', 'model': 'Kanepe'}]},

    # Assist: kullanıcı isteğindeki örnek ad "Assist Çalışma Masası Ailesi" idi; kaynaktaki iki
    # ürün de MASA DEĞİL KOLTUK (productType: "Çalışma Koltuğu" / "Yönetici Koltuğu"), bu yüzden
    # aile "Assist" adıyla ve koltuk kategorisinde açıldı.
    {'key': 'bur-assist', 'brand': 'burotime', 'title': 'Assist', 'cat': 'Ofis Mobilyası',
     'axis': 'Kullanım', 'module_axis': 'Modül',
     'pages': [{'url': f'{BUR}assist-operasyonel', 'model': 'Operasyonel'},
               {'url': f'{BUR}assist-yonetici', 'model': 'Yönetici'}]},
]

# D1'de ZATEN VAR OLAN ve bu partiyle ZENGİNLEŞTİRİLECEK satırlar (yeni satır açılmaz, mevcut
# satır güncellenir): products.id -> aile anahtarı. Kaynak bağlantıları birebir aynı ürünü
# gösteriyor ama mevcut satırlarda versiyon yok, görsel/spec sayısı düşük.
UPDATE_EXISTING = {
    119: 'kol-odette',    # .../en/products/seating/sofas/odette-sofas/
    205: 'kol-dilim',     # .../tr/urunler/oturma-gruplari/kanepeler/dilim-kanepeler
    227: 'kol-ikaros',    # .../tr/urunler/oturma-gruplari/kanepeler/ikaros/
}
