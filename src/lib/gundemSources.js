// GÜNDEM KAYNAK YAPILANDIRMASI — sistemin TEK kaynak listesi (kullanıcı isteği, 2026-09-06 madde 5:
// "Kaynakları hard-code edilmiş dağınık fetch kodlarıyla yönetme").
//
// Buradaki her satır 2026-09-06'da GERÇEKTEN ölçülerek eklendi/elendi: feed HTTP durumu, item
// sayısı, robots.txt, görsel alanının feed'de bulunup bulunmadığı ve (görsel feed'de yoksa) makale
// sayfasının og:image metadata'sına erişilip erişilemediği tek tek denendi. Ölçüm sonuçları
// aşağıda her kaynağın kendi yorumunda; ELENEN kaynaklar da dosyanın SONUNDA gerekçesiyle listeli
// (aynı kaynağı ileride biri tekrar denemesin diye — bu depodaki "durumu varsayma, buraya bak"
// kuralı).
//
// =============================================================================================
// UYULAN SINIRLAR (kullanıcı isteği madde 5 + 6)
// =============================================================================================
// 1. YALNIZCA RSS/Atom. Hiçbir kaynağın liste/kategori sayfası kazınmaz.
// 2. Makale sayfasına yapılan TEK istek türü, feed'de görsel yoksa yapılan `imageStrategy:'og'`
//    çağrısıdır ve o çağrı da SAYFA GÖVDESİNİ DEĞİL, yalnızca <head> içindeki og:image/
//    og:description/canonical etiketlerini okur (bkz. src/lib/gundemFeed.js#extractPageMeta) —
//    yani yayıncının ÜÇÜNCÜ TARAFLAR İÇİN yayımladığı önizleme metadata'sı. Gövde alınmaz,
//    saklanmaz, yayımlanmaz.
// 3. Anti-bot/CAPTCHA/erişim kısıtı AŞILMAZ. User-Agent bu depodaki dürüst MimarlabBot dizesidir
//    (bkz. src/lib/safeFetch.js) — proxy/UA rotasyonu yok. 403/challenge dönen kaynak SİSTEME
//    ALINMAZ (aşağıdaki ELENENLER listesi bunun sonucudur).
// 4. Görsel R2'ye KOPYALANMAZ; kaynağın kendi CDN'inden <img src> ile gösterilir. Bu yüzden her
//    kaynağın görsel host'u burada AÇIKÇA beyan edilir ve src/index.js'teki CSP img-src listesi
//    doğrudan bu beyandan üretilir (bkz. GUNDEM_IMAGE_HOSTS) — yapılandırmada olmayan bir host'tan
//    görsel çekilmesi tarayıcı tarafından da engellenir, tek yönlü bir güvenlik değil.
//
// =============================================================================================
// ALAN SÖZLÜĞÜ
// =============================================================================================
//  id               kararlı anahtar (gundem_items.source_id) — DEĞİŞTİRİLMEZ, mükerrer kontrolü buna bağlı
//  name             kartta görünen kaynak adı
//  domain           kaynağın ana alan adı (kartta ve source_domain kolonunda)
//  feedUrl          RSS/Atom adresi
//  type             'rss' | 'atom' (gundemFeed.js ikisini de aynı ayrıştırıcıyla okur)
//  enabled          false ise tur sırasında hiç DOKUNULMAZ (ağ isteği bile yapılmaz)
//  defaultCategory  AI'nin kategori önerisi whitelist dışına düşerse/emin olmazsa kullanılan değer
//  categoryHints    feed'in kendi <category> etiketlerinden kategori türetme kuralları (AI'den ÖNCE)
//  fetchIntervalMin kaynağın ne sıklıkla YENİDEN okunacağı (cron 2 SAATTE BİR çalışır; bu değer
//                   kaynak-başına ek seyreltme sağlar — bkz. gundem_source_health.last_run_at).
//                   120 = her turda okunur; 360 = üç turda bir (az yayımlayan kaynaklar).
//  maxItemsPerRun   tek turda bu kaynaktan alınacak azami YENİ içerik
//  imageStrategy    'feed'  → görsel yalnızca feed alanlarından (enclosure/media:*/gövdedeki ilk <img>)
//                   'og'    → feed'de görsel yoksa makale <head>'inden og:image okunur
//  imageHosts       bu kaynağın görsellerinin geldiği host'lar (CSP img-src'ye giren TEK liste)
//  language         kaynak dili ('en' | 'tr') — AI'ye "çeviri değil, özgün Türkçe özet" derken bağlam
//  priority         tur içinde işlenme sırası (küçük olan önce) — bütçe biterse önce düşük öncelik düşer

export const GUNDEM_SOURCES = [
  {
    // ÖLÇÜM (2026-09-06): https://www.archdaily.com/rss/ → 301 → https://feeds.feedburner.com/Archdaily,
    // 200, 24 item. Yönlendirme zincirini kısaltmak için feedburner adresi doğrudan yazıldı.
    // robots.txt: "User-agent: * / Allow: /" (yalnızca dil alt yolları ve *_ptid kapalı).
    // Görsel: her item'da <enclosure url="https://images.adsttc.com/...">.
    id: 'archdaily',
    name: 'ArchDaily',
    domain: 'archdaily.com',
    feedUrl: 'https://feeds.feedburner.com/Archdaily',
    type: 'rss',
    enabled: true,
    defaultCategory: 'haber',
    categoryHints: [],
    fetchIntervalMin: 120,
    maxItemsPerRun: 6,
    imageStrategy: 'feed',
    imageHosts: ['images.adsttc.com'],
    language: 'en',
    priority: 1,
  },
  {
    // ÖLÇÜM (2026-09-06): 200, 50 item. robots.txt yalnızca /wp-admin/ kapalı.
    // Görsel: <enclosure url="http(s)://static.dezeen.com/...">. Feed http:// ile veriyor, kart
    // her zaman https'e yükseltilir (bkz. gundemFeed.js#normalizeImageUrl).
    id: 'dezeen',
    name: 'Dezeen',
    domain: 'dezeen.com',
    feedUrl: 'https://www.dezeen.com/feed/',
    type: 'rss',
    enabled: true,
    defaultCategory: 'haber',
    // Dezeen kategorilerini kendi <category> etiketlerinden okur — AI'ye sormadan önce.
    categoryHints: [
      { match: /^(competitions?)$/i, category: 'yarisma' },
      { match: /^(jobs?|dezeen jobs)$/i, category: 'kariyer' },
      { match: /^(exhibitions?|events?|dezeen events guide|design events)$/i, category: 'etkinlik' },
      { match: /^(opinion|interviews?|comment)$/i, category: 'gorus' },
    ],
    fetchIntervalMin: 120,
    maxItemsPerRun: 6,
    imageStrategy: 'feed',
    imageHosts: ['static.dezeen.com'],
    language: 'en',
    priority: 1,
  },
  {
    // ÖLÇÜM (2026-09-06): 200, 120 item. robots.txt yalnızca /wp-admin/ kapalı.
    // Görsel: feed'de YOK (ne enclosure ne media:* ne gövde <img>) — makale sayfası 200 dönüyor ve
    // og:image veriyor (test: /proje/1-odul-mugla-... → www.arkitera.com/wp-content/uploads/...).
    // TEK Türkçe kaynak: yerel gündem için kritik, bu yüzden 'og' stratejisi burada gerekli ve haklı.
    id: 'arkitera',
    name: 'Arkitera',
    domain: 'arkitera.com',
    feedUrl: 'https://www.arkitera.com/feed/',
    type: 'rss',
    enabled: true,
    defaultCategory: 'haber',
    categoryHints: [
      { match: /^yarışma$/i, category: 'yarisma' },
      { match: /^(etkinlik|sergi|söyleşi|konferans)$/i, category: 'etkinlik' },
      { match: /^(görüş|söyleşi|röportaj|yazı)$/i, category: 'gorus' },
      { match: /^(iş ilanı|kariyer|ilan)$/i, category: 'kariyer' },
    ],
    fetchIntervalMin: 120,
    maxItemsPerRun: 6,
    imageStrategy: 'og',
    imageHosts: ['www.arkitera.com', 'arkitera.com'],
    language: 'tr',
    priority: 0, // Türkçe kaynak önce işlenir — tur bütçesi biterse en son o düşsün.
  },
  {
    // ÖLÇÜM (2026-09-06): 200, 50 item. robots.txt: Crawl-Delay 20 + /ajax_* kapalı; /rss/ açık.
    // Crawl-Delay'e uyum: bu kaynağa tur başına TEK istek (feed) yapılır, makale sayfasına hiç
    // gidilmez (imageStrategy 'feed'), yani 20sn'lik gecikme sınırı zaten hiç zorlanmıyor.
    // Görsel: <media:content url='https://worldarchitecture.org/cdnimgfiles/...' medium="image"/>.
    // KAPALI (ölçüm, 2026-09-06): feed teknik olarak SAĞLAM (200, 50 item, media:content görselleri
    // kalite kapısından geçiyor) ama İÇERİĞİ BAYAT — en yeni girdi 2026-04-05, yani beş aydan eski.
    // maxItemAgeDays=21 filtresi feed'in TAMAMINI eliyor: kaynak her 120 dakikada bir çekilir,
    // her seferinde 50 item ayrıştırılır ve SIFIR içerik üretir. Etkin bırakmak saf bir israf
    // (kendi Crawl-Delay:20 isteğine rağmen düzenli istek atmak dahil) olurdu.
    // Yayıncı feed'ini tazelerse tek yapılacak enabled:true — diğer her şey (görsel stratejisi,
    // host beyanı, kategori ipuçları) doğrulanmış durumda.
    id: 'worldarchitecture',
    name: 'World Architecture Community',
    domain: 'worldarchitecture.org',
    feedUrl: 'https://worldarchitecture.org/rss/',
    type: 'rss',
    enabled: false,
    disabledReason: 'Feed teknik olarak sağlam ama içeriği bayat: en yeni girdi 2026-04-05 (ölçüm 2026-09-06). 21 günlük tazelik filtresi feed\'in tamamını eliyor, kaynak sıfır içerik üretiyor.',
    defaultCategory: 'haber',
    categoryHints: [
      { match: /competition/i, category: 'yarisma' },
      { match: /(award|exhibition|event)/i, category: 'etkinlik' },
    ],
    fetchIntervalMin: 120,
    maxItemsPerRun: 4,
    imageStrategy: 'feed',
    imageHosts: ['worldarchitecture.org'],
    language: 'en',
    priority: 2,
  },
  {
    // ÖLÇÜM (2026-09-06): 200, 25 item. Görsel feed'de yok; makale sayfası 200 + og:image
    // (competitions.archi/wp-content/uploads/...). robots.txt: "User-agent: * / Allow: /" +
    // Content-Signal "search=yes, ai-train=no, use=reference".
    //
    // Content-Signal UYUMU (bu kaynak, archpaper ve yapi.com.tr'de aynı Cloudflare şablonu var):
    //   * ai-train=no  → UYULUYOR. Bu sistem hiçbir model EĞİTMEZ/fine-tune ETMEZ; içerik yalnızca
    //     tek seferlik bir özetleme çağrısının girdisidir ve hiçbir yerde eğitim verisi olarak
    //     saklanmaz.
    //   * use=reference → TAM OLARAK bu sistemin modeli: içerik kaynak gösterilerek REFERANS
    //     verilir (kaynak adı + tarih + "Kaynağa git →" bağlantısı her kartta zorunlu), tam metin
    //     yeniden yayımlanmaz.
    //   * ai-input belirtilmemiş → sinyal "ne izin verir ne yasaklar". Belirsizlik lehine değil
    //     aleyhine karar verildi: bu kaynaklardan makale GÖVDESİ hiç alınmıyor, AI'ye yalnızca
    //     feed'in kendi kamuya açık özeti/başlığı veriliyor.
    id: 'competitions-archi',
    name: 'competitions.archi',
    domain: 'competitions.archi',
    feedUrl: 'https://competitions.archi/feed/',
    type: 'rss',
    enabled: true,
    // Bu kaynak tamamen yarışma duyurusu yayımlar — AI'nin kategori önerisine gerek yok.
    defaultCategory: 'yarisma',
    categoryHints: [],
    fetchIntervalMin: 360,
    maxItemsPerRun: 4,
    imageStrategy: 'og',
    imageHosts: ['competitions.archi'],
    language: 'en',
    priority: 3,
  },
  {
    // ÖLÇÜM (2026-09-06): 200, 10 item. Görsel feed'de yok; makale sayfası 200 + og:image
    // (cdn.ca.emap.com). robots.txt: "User-agent: * / Disallow: /wp-admin" — geri kalan açık;
    // uzun bir AI-crawler engel listesi var ama hiçbiri genel erişimi kapatmıyor.
    // Ağırlıklı olarak deneme/eleştiri yayımladığı için varsayılan kategori 'gorus'.
    id: 'architectural-review',
    name: 'The Architectural Review',
    domain: 'architectural-review.com',
    feedUrl: 'https://www.architectural-review.com/feed',
    type: 'rss',
    enabled: true,
    defaultCategory: 'gorus',
    categoryHints: [
      { match: /(competition|awards?)/i, category: 'yarisma' },
      { match: /(exhibition|event)/i, category: 'etkinlik' },
    ],
    fetchIntervalMin: 360,
    maxItemsPerRun: 4,
    imageStrategy: 'og',
    imageHosts: ['cdn.ca.emap.com'],
    language: 'en',
    priority: 3,
  },

  // ===========================================================================================
  // ELENEN KAYNAKLAR — enabled:false. Hiç ağ isteği yapılmaz; buradaki gerekçe, aynı kaynağın
  // ileride tekrar tekrar denenmemesi içindir (ölçümler 2026-09-06).
  // ===========================================================================================
  {
    // Feed 200 + 10 item DÖNÜYOR, ama makale sayfası MimarlabBot'a 403 veriyor ve feed'de hiç
    // görsel alanı yok → görselsiz içerik bu sayfada yayınlanamaz (görsel zorunlu). 403'ü aşmak
    // (UA değiştirmek) kullanıcı isteğinde AÇIKÇA yasak. Kaynak, feed'ine görsel eklerse ya da
    // makale sayfası erişilebilir olursa enabled:true yapmak yeterlidir.
    id: 'archpaper',
    name: "The Architect's Newspaper",
    domain: 'archpaper.com',
    feedUrl: 'https://www.archpaper.com/feed/',
    type: 'rss',
    enabled: false,
    disabledReason: 'Feed görsel taşımıyor; makale sayfası bot erişimine 403 veriyor (2026-09-06 ölçümü). Görselsiz içerik yayınlanmıyor.',
    defaultCategory: 'haber',
    categoryHints: [],
    fetchIntervalMin: 180,
    maxItemsPerRun: 3,
    imageStrategy: 'og',
    imageHosts: [],
    language: 'en',
    priority: 4,
  },
  {
    // archpaper ile BİREBİR aynı durum: feed 200 + 50 item, ama item'lar yalnızca başlık/link/
    // description taşıyor ve makale sayfası 403. Türkçe bir kaynak olduğu için tekrar denemeye
    // değer — erişim açılırsa imageStrategy:'og' ile doğrudan çalışır.
    id: 'yapi-com-tr',
    name: 'Yapı.com.tr',
    domain: 'yapi.com.tr',
    feedUrl: 'https://www.yapi.com.tr/rss',
    type: 'rss',
    enabled: false,
    disabledReason: 'Feed görsel taşımıyor; makale sayfası bot erişimine 403 veriyor (2026-09-06 ölçümü).',
    defaultCategory: 'haber',
    categoryHints: [],
    fetchIntervalMin: 120,
    maxItemsPerRun: 4,
    imageStrategy: 'og',
    imageHosts: [],
    language: 'tr',
    priority: 4,
  },
  {
    // TLS el sıkışması bu ağdan hiç tamamlanamadı (curl exit 35, üç denemenin üçünde de) —
    // robots.txt bile okunamadı. "Kaynak erişilemiyorsa o kaynağı atla" kuralı gereği kapalı;
    // erişim doğrulanmadan (robots.txt + feed + görsel alanı) açılmamalı.
    id: 'designboom',
    name: 'designboom',
    domain: 'designboom.com',
    feedUrl: 'https://www.designboom.com/architecture/feed/',
    type: 'rss',
    enabled: false,
    disabledReason: 'Feed ve robots.txt bu ortamdan hiç okunamadı (TLS handshake hatası, 3/3 deneme, 2026-09-06). Erişim ve şartlar doğrulanmadan açılmamalı.',
    defaultCategory: 'haber',
    categoryHints: [],
    fetchIntervalMin: 120,
    maxItemsPerRun: 4,
    imageStrategy: 'feed',
    imageHosts: [],
    language: 'en',
    priority: 4,
  },
  // HİÇ EKLENMEYENLER (satır bile açılmadı — feed'leri bot korumasının arkasında):
  //   * Archinect (archinect.com/feed/1/news) → 403, Cloudflare "Just a moment..." challenge.
  //   * Domus (domusweb.it/en/news.rss)       → 403 "Access Denied".
  //   * mimarizm.com (/rss)                   → 403.
  //   * world-architects.com (/pages/rss)     → 403.
  //   * Archello                              → RSS/Atom feed'i YOK (/rss 404).
  // Dördünde de engel BİLİNÇLİ bir erişim kısıtıdır; aşmak kullanıcı isteğinde açıkça yasaklandı.
];

// Tur sırasında gerçekten işlenecek kaynaklar.
export function activeGundemSources() {
  return GUNDEM_SOURCES.filter(s => s.enabled).sort((a, b) => a.priority - b.priority);
}

export function gundemSourceById(id) {
  return GUNDEM_SOURCES.find(s => s.id === id) || null;
}

// CSP img-src'nin TEK kaynağı (bkz. src/index.js#CONTENT_SECURITY_POLICY). Yalnızca ETKİN
// kaynakların host'ları döner — kapalı bir kaynağın host'u CSP'yi gereksiz yere genişletmez.
// Bir kaynak eklenip host'u buraya yazılmazsa görsel tarayıcıda engellenir ve kart görselsiz kalır;
// bu SESSİZ bir bozulma olurdu, o yüzden ingest tarafı da AYNI listeye karşı doğrulama yapar
// (bkz. src/lib/gundemQuality.js#isAllowedImageHost) ve host'u tanımadığı içeriği hiç yayınlamaz.
export const GUNDEM_IMAGE_HOSTS = [...new Set(
  GUNDEM_SOURCES.filter(s => s.enabled).flatMap(s => s.imageHosts)
)].sort();
