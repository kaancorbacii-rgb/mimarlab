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
// 1. RSS/Atom ÖNCELİKLİDİR. HTML liste sayfası YALNIZCA kaynağın RSS'i yoksa ya da robots.txt'si
//    feed'i kapatmışsa kullanılır ve o durumda gerekçe kaynağın kendi yorumunda yazılıdır
//    (bugün tek örnek: mimdap — feed'leri robots'ta `Disallow: */feed/`).
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
//  feedUrl          RSS/Atom adresi ya da (type:'html' ise) liste sayfası adresi
//  extraListUrls    (ops.) AYNI kaynağın ek liste sayfaları: [{url, category}] — ayrı kaynak kaydı
//                   açmadan çok kategorili siteleri tek kayıtta toplar
//  type             'rss' | 'atom' (gundemFeed.js ikisini de aynı ayrıştırıcıyla okur) |
//                   'html' (liste sayfası; çıkarıcı src/lib/gundemHtmlList.js'te kaynak id'sine kayıtlı)
//  enabled          false ise tur sırasında hiç DOKUNULMAZ (ağ isteği bile yapılmaz)
//  defaultCategory  AI'nin kategori önerisi whitelist dışına düşerse/emin olmazsa kullanılan değer
//  categoryHints    feed'in kendi <category> etiketlerinden kategori türetme kuralları (AI'den ÖNCE)
//  fetchIntervalMin kaynağın ne sıklıkla YENİDEN okunacağı (cron 3 SAATTE BİR çalışır — kullanıcı
//                   isteği 2026-09-07; bu değer kaynak-başına ek seyreltme sağlar, bkz.
//                   gundem_source_health.last_run_at). 180 = her turda okunur; 360 = iki turda bir.
//  maxItemsPerRun   tek turda bu kaynaktan alınacak azami YENİ içerik
//  imageStrategy    'feed'  → görsel yalnızca feed alanlarından (enclosure/media:*/gövdedeki ilk <img>)
//                   'og'    → feed'de görsel yoksa makale <head>'inden og:image okunur
//  imageHosts       bu kaynağın görsellerinin geldiği host'lar (CSP img-src'ye giren TEK liste)
//  language         kaynak dili ('en' | 'tr') — AI'ye "çeviri değil, özgün Türkçe özet" derken bağlam
//  priority         tur içinde işlenme sırası (küçük olan önce) — bütçe biterse önce düşük öncelik düşer

export const GUNDEM_SOURCES = [
  // ===========================================================================================
  // ARKITERA — kullanıcının verdiği üç kategori (haber / etkinlik / yarışma).
  // ÖLÇÜM (2026-09-07): üç kategori feed'i de 200, 120 item. robots.txt yalnızca /wp-admin/ kapalı.
  // Görsel feed'de YOK; makale sayfası 200 + og:image veriyor -> imageStrategy 'og'.
  // Kategori feed'leri kullanıldığı için kategori AI'ye sorulmadan KESİN biliniyor.
  // ===========================================================================================
  {
    id: 'arkitera-haber',
    name: 'Arkitera',
    domain: 'arkitera.com',
    feedUrl: 'https://www.arkitera.com/kategori/haber/feed/',
    type: 'rss',
    enabled: true,
    defaultCategory: 'haber',
    categoryHints: [],
    fetchIntervalMin: 180,
    maxItemsPerRun: 6,
    imageStrategy: 'og',
    imageHosts: ['www.arkitera.com', 'arkitera.com'],
    language: 'tr',
    priority: 0, // Türkçe kaynaklar önce işlenir — tur bütçesi biterse en son onlar düşsün.
  },
  {
    id: 'arkitera-etkinlik',
    name: 'Arkitera',
    domain: 'arkitera.com',
    feedUrl: 'https://www.arkitera.com/kategori/etkinlik/feed/',
    type: 'rss',
    enabled: true,
    defaultCategory: 'etkinlik',
    categoryHints: [],
    fetchIntervalMin: 180,
    maxItemsPerRun: 4,
    imageStrategy: 'og',
    imageHosts: ['www.arkitera.com', 'arkitera.com'],
    language: 'tr',
    priority: 0,
  },
  {
    id: 'arkitera-yarisma',
    name: 'Arkitera',
    domain: 'arkitera.com',
    feedUrl: 'https://www.arkitera.com/kategori/yarisma/feed/',
    type: 'rss',
    enabled: true,
    defaultCategory: 'yarisma',
    categoryHints: [],
    fetchIntervalMin: 180,
    maxItemsPerRun: 4,
    imageStrategy: 'og',
    imageHosts: ['www.arkitera.com', 'arkitera.com'],
    language: 'tr',
    priority: 0,
  },

  // ===========================================================================================
  // MİMDAP — kullanıcının verdiği altı kategori. TEK HTML KAYNAĞI.
  //
  // NEDEN HTML (RSS varken): mimdap.org'un kategori feed'leri teknik olarak ÇALIŞIYOR (200, 10
  // item) ama sitenin robots.txt'si AÇIKÇA `Disallow: */feed/` diyor. Feed'i kullanmak robots'u
  // çiğnemek olurdu. Kategori SAYFALARI ise robots'ta kapalı DEĞİL (yalnızca /wp-admin/, /wp-json/
  // vb. kapalı) ve kullanıcının verdiği adresler zaten bunlar — bu yüzden HTML'den okunur.
  // Çıkarıcı: src/lib/gundemHtmlList.js#extractMimdap (şablon değişirse 0 item döner, uydurmaz).
  // Görsel: <img data-src="https://mimdap.org/wp-content/uploads/..."> — liste sayfasında hazır,
  // makale sayfasına AYRICA gidilmesine gerek yok.
  // ===========================================================================================
  {
    id: 'mimdap',
    name: 'Mimdap',
    domain: 'mimdap.org',
    feedUrl: 'https://mimdap.org/kategori/haberler/',
    type: 'html',
    enabled: true,
    defaultCategory: 'haber',
    categoryHints: [],
    fetchIntervalMin: 180,
    maxItemsPerRun: 5,
    imageStrategy: 'feed',
    imageHosts: ['mimdap.org', 'www.mimdap.org'],
    language: 'tr',
    priority: 0,
    // extraListUrls — AYNI kaynağın diğer kategori sayfaları. Ayrı kaynak kaydı açmak yerine tek
    // kayıt altında toplanır: hepsi aynı site, aynı çıkarıcı, aynı görsel host'u ve aynı sağlık
    // sayacı. Kategori, sayfanın kendi yoluna göre atanır (bkz. listUrlCategory).
    extraListUrls: [
      { url: 'https://mimdap.org/kategori/mimarlik-gundemi/', category: 'haber' },
      { url: 'https://mimdap.org/kategori/ic-mekan/', category: 'haber' },
      { url: 'https://mimdap.org/kategori/yarismalar/', category: 'yarisma' },
      { url: 'https://mimdap.org/kategori/etkinlikler/', category: 'etkinlik' },
      { url: 'https://mimdap.org/kategori/mimarlik-dunyasindan/', category: 'haber' },
    ],
  },

  // ===========================================================================================
  // DEZEEN — kullanıcının verdiği dört bölüm. Bölüm feed'lerinin dördü de 200 + 50 item (ölçüm
  // 2026-09-07). robots.txt yalnızca /wp-admin/ kapalı. Görsel feed'de <enclosure> ile hazır.
  // Bölümler arası çakışma (aynı yazının iki bölümde görünmesi) mükerrer kontrolünün 1. basamağı
  // (source_url) tarafından zaten yakalanır.
  // ===========================================================================================
  {
    id: 'dezeen-architecture',
    name: 'Dezeen',
    domain: 'dezeen.com',
    feedUrl: 'https://www.dezeen.com/architecture/feed/',
    type: 'rss',
    enabled: true,
    defaultCategory: 'haber',
    categoryHints: [
      { match: /^(competitions?)$/i, category: 'yarisma' },
      { match: /^(jobs?|dezeen jobs)$/i, category: 'kariyer' },
      { match: /^(exhibitions?|events?|dezeen events guide|design events)$/i, category: 'etkinlik' },
      { match: /^(opinion|interviews?|comment)$/i, category: 'gorus' },
    ],
    fetchIntervalMin: 180,
    maxItemsPerRun: 5,
    imageStrategy: 'feed',
    imageHosts: ['static.dezeen.com'],
    language: 'en',
    priority: 1,
  },
  {
    id: 'dezeen-interiors',
    name: 'Dezeen',
    domain: 'dezeen.com',
    feedUrl: 'https://www.dezeen.com/interiors/feed/',
    type: 'rss',
    enabled: true,
    defaultCategory: 'haber',
    categoryHints: [
      { match: /^(exhibitions?|events?)$/i, category: 'etkinlik' },
      { match: /^(opinion|interviews?)$/i, category: 'gorus' },
    ],
    fetchIntervalMin: 180,
    maxItemsPerRun: 4,
    imageStrategy: 'feed',
    imageHosts: ['static.dezeen.com'],
    language: 'en',
    priority: 2,
  },
  {
    id: 'dezeen-design',
    name: 'Dezeen',
    domain: 'dezeen.com',
    feedUrl: 'https://www.dezeen.com/design/feed/',
    type: 'rss',
    enabled: true,
    defaultCategory: 'haber',
    categoryHints: [
      { match: /^(exhibitions?|events?)$/i, category: 'etkinlik' },
      { match: /^(opinion|interviews?)$/i, category: 'gorus' },
    ],
    fetchIntervalMin: 180,
    maxItemsPerRun: 4,
    imageStrategy: 'feed',
    imageHosts: ['static.dezeen.com'],
    language: 'en',
    priority: 2,
  },
  {
    id: 'dezeen-technology',
    name: 'Dezeen',
    domain: 'dezeen.com',
    feedUrl: 'https://www.dezeen.com/technology/feed/',
    type: 'rss',
    enabled: true,
    defaultCategory: 'haber',
    categoryHints: [
      { match: /^(exhibitions?|events?)$/i, category: 'etkinlik' },
      { match: /^(opinion|interviews?)$/i, category: 'gorus' },
    ],
    fetchIntervalMin: 180,
    maxItemsPerRun: 3,
    imageStrategy: 'feed',
    imageHosts: ['static.dezeen.com'],
    language: 'en',
    priority: 3,
  },

  // ===========================================================================================
  // ARCHDAILY — kullanıcı /articles adresini verdi.
  //
  // ÖNEMLİ ÖLÇÜM (2026-09-07): https://www.archdaily.com/articles/feed, ana feed ile BİREBİR AYNI
  // içeriği döndürüyor (ilk 6 başlık birebir aynı, proje yayınları dahil) — ArchDaily'nin
  // "yalnızca makaleler" diye ayrı bir feed'i YOK. Bu yüzden proje yayınlarını feed SEÇİMİYLE
  // ayıklamak mümkün değil; ayıklama içerik sınıflandırmasıyla yapılır (bkz.
  // gundemQuality.js#looksLikeProjectPublication + AI'nin isProject alanı, kullanıcı isteği madde 4).
  // ===========================================================================================
  {
    id: 'archdaily',
    name: 'ArchDaily',
    domain: 'archdaily.com',
    feedUrl: 'https://feeds.feedburner.com/Archdaily',
    type: 'rss',
    enabled: true,
    defaultCategory: 'haber',
    categoryHints: [],
    fetchIntervalMin: 180,
    maxItemsPerRun: 5,
    imageStrategy: 'feed',
    imageHosts: ['images.adsttc.com'],
    language: 'en',
    priority: 1,
  },

  // ===========================================================================================
  // KAPALI KAYNAKLAR — enabled:false. Hiç ağ isteği yapılmaz; gerekçeler ileride aynı kaynağın
  // tekrar tekrar denenmemesi için burada durur.
  // ===========================================================================================
  {
    // KULLANICI İSTEDİ AMA KAPALI BIRAKILDI — KARAR SİZİN (2026-09-07 ölçümü):
    //   * RSS YOK: /rss 403 veriyor, /haberler/feed ise RSS değil HTML sayfası döndürüyor.
    //     Yani tek yol kategori sayfalarının HTML'ini kazımak.
    //   * robots.txt bizim UA'mızı (MimarlabBot) engellemiyor (`User-agent: * / Allow: /`) VE
    //     Content-Signal `use=reference` bizim modelimize (kaynak göstererek kısa özet) uyuyor.
    //   * ANCAK site, YAPAY ZEKA tarayıcılarını TEK TEK isimle engelliyor: ClaudeBot, GPTBot,
    //     CCBot, Google-Extended, Applebot-Extended, Amazonbot, Bytespider, meta-externalagent.
    //     Bu sistem içeriği bir dil modeline veriyor (özet üretimi) — yayıncının bu konudaki
    //     itirazı isim isim yazılmış durumda. Teknik olarak "izinli" olmakla yayıncının açık
    //     iradesine uygun davranmak burada ayrışıyor.
    // Bu ikisi arasındaki tercih editoryal/hukuki bir karardır ve sizindir; kapatmak yerine
    // enabled:true yapmak tek satırlık iştir ve kaynak yapılandırması hazır bekliyor.
    id: 'mimarizm',
    name: 'Mimarizm',
    domain: 'mimarizm.com',
    feedUrl: 'https://www.mimarizm.com/haberler',
    type: 'html',
    enabled: false,
    disabledReason: 'RSS yok (kategori HTML kazınması gerekir) ve site ClaudeBot/GPTBot/CCBot/Google-Extended dahil tüm AI tarayıcılarını isimle engelliyor — AI ile içerik işlenmesine açık itiraz. Karar kullanıcıya bırakıldı (2026-09-07).',
    defaultCategory: 'haber',
    categoryHints: [],
    fetchIntervalMin: 180,
    maxItemsPerRun: 4,
    imageStrategy: 'og',
    imageHosts: [],
    language: 'tr',
    priority: 4,
  },
  {
    // Feed 200 + 10 item DÖNÜYOR, ama makale sayfası MimarlabBot'a 403 veriyor ve feed'de hiç
    // görsel alanı yok → görselsiz içerik bu sayfada yayınlanamaz (görsel zorunlu).
    id: 'archpaper',
    name: "The Architect's Newspaper",
    domain: 'archpaper.com',
    feedUrl: 'https://www.archpaper.com/feed/',
    type: 'rss',
    enabled: false,
    disabledReason: 'Feed görsel taşımıyor; makale sayfası bot erişimine 403 veriyor (2026-09-06 ölçümü).',
    defaultCategory: 'haber',
    categoryHints: [],
    fetchIntervalMin: 360,
    maxItemsPerRun: 3,
    imageStrategy: 'og',
    imageHosts: [],
    language: 'en',
    priority: 4,
  },
  {
    id: 'yapi-com-tr',
    name: 'Yapı.com.tr',
    domain: 'yapi.com.tr',
    feedUrl: 'https://www.yapi.com.tr/rss',
    type: 'rss',
    enabled: false,
    disabledReason: 'Feed görsel taşımıyor; makale sayfası bot erişimine 403 veriyor (2026-09-06 ölçümü).',
    defaultCategory: 'haber',
    categoryHints: [],
    fetchIntervalMin: 360,
    maxItemsPerRun: 4,
    imageStrategy: 'og',
    imageHosts: [],
    language: 'tr',
    priority: 4,
  },
  {
    id: 'designboom',
    name: 'designboom',
    domain: 'designboom.com',
    feedUrl: 'https://www.designboom.com/architecture/feed/',
    type: 'rss',
    enabled: false,
    disabledReason: 'Feed ve robots.txt bu ortamdan hiç okunamadı (TLS handshake hatası, 3/3 deneme, 2026-09-06).',
    defaultCategory: 'haber',
    categoryHints: [],
    fetchIntervalMin: 360,
    maxItemsPerRun: 4,
    imageStrategy: 'feed',
    imageHosts: [],
    language: 'en',
    priority: 4,
  },
  {
    id: 'worldarchitecture',
    name: 'World Architecture Community',
    domain: 'worldarchitecture.org',
    feedUrl: 'https://worldarchitecture.org/rss/',
    type: 'rss',
    enabled: false,
    disabledReason: 'Feed teknik olarak saglam ama icerigi bayat: en yeni girdi 2026-04-05 (olcum 2026-09-06). 21 gunluk tazelik filtresi feed\'in tamamini eliyor.',
    defaultCategory: 'haber',
    categoryHints: [],
    fetchIntervalMin: 360,
    maxItemsPerRun: 4,
    imageStrategy: 'feed',
    imageHosts: [],
    language: 'en',
    priority: 4,
  },
  {
    id: 'architectural-review',
    name: 'The Architectural Review',
    domain: 'architectural-review.com',
    feedUrl: 'https://www.architectural-review.com/feed',
    type: 'rss',
    enabled: false,
    disabledReason: 'Kullanicinin 2026-09-07 kaynak listesinde YOK — liste o istekle yeniden tanimlandi. Teknik olarak calisiyor (200, 10 item, og:image), geri acmak icin enabled:true yeterli.',
    defaultCategory: 'gorus',
    categoryHints: [],
    fetchIntervalMin: 360,
    maxItemsPerRun: 3,
    imageStrategy: 'og',
    imageHosts: ['cdn.ca.emap.com'],
    language: 'en',
    priority: 4,
  },
  {
    id: 'competitions-archi',
    name: 'competitions.archi',
    domain: 'competitions.archi',
    feedUrl: 'https://competitions.archi/feed/',
    type: 'rss',
    enabled: false,
    disabledReason: 'Kullanicinin 2026-09-07 kaynak listesinde YOK — liste o istekle yeniden tanimlandi. Teknik olarak calisiyor (200, 25 item, og:image), geri acmak icin enabled:true yeterli.',
    defaultCategory: 'yarisma',
    categoryHints: [],
    fetchIntervalMin: 360,
    maxItemsPerRun: 4,
    imageStrategy: 'og',
    imageHosts: ['competitions.archi'],
    language: 'en',
    priority: 4,
  },
  // HİÇ EKLENMEYENLER (feed'leri bot korumasının arkasında):
  //   * Archinect (403 Cloudflare challenge) · Domus (403) · world-architects.com (403)
  //   * Archello (RSS/Atom feed'i YOK)
  // Engelleri aşmak kullanıcı isteğinde açıkça yasaklandı.
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
