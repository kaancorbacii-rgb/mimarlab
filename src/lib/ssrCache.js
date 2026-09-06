import { slugify } from './slugify.js';
import { cacheKeyFor } from './publicCache.js';
import { purgeGlobalUrls } from './globalPurge.js';

// src/index.js#serveDetailPage bu sürümü SSR HTML önbelleğinin (caches.default) anahtarına ekler
// (bkz. o dosyadaki withVersionedCacheKey/SSR_CACHE_VERSION yorumu) — koda gömülü *-detay.html
// şablonlarından biri değiştiğinde bu değer artırılır. Tek kaynak burada tutulur ki purgeSsrDetailCache
// (aşağıda) index.js'in kullandığıyla AYNI anahtarı üretsin.
// v101 (production audit, 2026-09-01): proje/mimar/firma/urun/marka.html şablonlarının HEPSİ
// değişti — site genelindeki iç bağlantılar *.html'den kanonik temiz yollara çevrildi (nav/footer/
// drawer'ın 307/301 hop'u kalktı), urun.html kartlarına gerçek <a href="/urun/:slug"> başlık
// bağlantısı eklendi ve firma/marka.html'den ölü icons.duckduckgo.com preconnect'i kaldırıldı.
// Bu değerin artırılmaması, /proje|mimar|firma|urun/:slug SSR sayfalarının edge'de s-maxage
// boyunca ESKİ (hâlâ .html bağlantılı) HTML'i sunmasına yol açardı.
// v102 (kullanıcı isteği, 2026-09-01): "Mimar" dizini "Kişi" olarak yeniden adlandırıldı —
// kisi.html'in SSR kabuğundaki <h1>/breadcrumb metni ("Mimarlar" -> "Kişiler") ve
// src/lib/seo.js#CATALOG_CRUMB.architect.label (breadcrumb JSON-LD) değişti; ikisi de SSR HTML'ine
// gömülü olduğundan sürüm artırılmazsa /kisi/:slug sayfaları s-maxage boyunca eski metni sunardı.
// v103 (kullanıcı isteği, 2026-09-01): kişi dizininin URL'i de değişti — /mimar -> /kisi,
// /mimar/:slug -> /kisi/:slug. SSR HTML'ine gömülü canonical/og:url ve breadcrumb JSON-LD bağlantıları
// yeni yolu taşıdığından (bkz. src/lib/seo.js#architectMetaFromRecord) sürüm artırılmazsa edge,
// s-maxage boyunca ESKİ canonical'ı (artık 301'lenen /mimar/:slug) gösteren HTML sunardı.
// v104 (kullanıcı isteği, 2026-09-01 madde 1-2): kisi.html'in filtre kenar çubuğu tekil <select>'ler
// yerine çok seçmeli akordeon kutucuklarına (#filter-groups) dönüştü ve yeni bir "Meslek" grubu
// eklendi. Hem markup hem CSS hem de sayfanın satır içi JS'i SSR HTML'ine gömülü olduğundan, sürüm
// artırılmazsa /kisi/:slug ile açılan sayfalar s-maxage boyunca ESKİ filtre kabuğunu sunardı.
// v105 (kullanıcı isteği, 2026-09-01 madde 1): firma.html ve marka.html'in filtre kenar çubukları da
// kisi.html'inkiyle AYNI çok seçmeli akordeona (#filter-groups) dönüştü; ayrıca hesabim düzeni
// değişti. Markup/CSS/satır içi JS SSR HTML'ine gömülü olduğundan, sürüm artırılmazsa /firma/:slug
// ve /urun/:slug sayfaları s-maxage boyunca ESKİ filtre kabuğunu sunardı (v104'ün birebir aynısı).
// v106 (kullanıcı isteği, 2026-09-01 madde 2): kisi.html'in satır içi JS'indeki PROFESSION_ORDER
// dizisine "Mühendis" eklendi — /kisi/:slug SSR kabuğunun İÇİNDEKİ bu dizi "Meslek" filtresinin
// sıralamasını belirler, sürüm artırılmazsa o sayfalardan girenlerde yeni seçenek s-maxage boyunca
// yanlış sırada (listenin sonunda) görünürdü.
// v107 (görsel performans optimizasyonu, 2026-09-01): #ssr-entity-body'deki <img src>, orijinal
// yerine 400 px'lik R2 türevini gösteriyor (bkz. src/index.js#bodyHandler). SSR HTML'i edge'de
// önbelleklendiğinden sürüm artırılmazsa daha önce ziyaret edilmiş detay sayfaları eski (tam boy
// görselli) gövdeyi servis etmeye devam ederdi.
// v108 (SEO denetimi, 2026-09-03): /kisi/:slug ve /firma/:slug SSR gövdesine, o kişinin/firmanın
// GERÇEK projelerine giden crawlable bir "Projeler" satırı eklendi (bkz. src/lib/seo.js#
// fetchDesignerProjects). Sürüm artırılmazsa daha önce ziyaret edilmiş profil sayfaları s-maxage
// boyunca bu bağlantıları TAŞIMAYAN eski gövdeyi sunmaya devam eder — yani düzeltmenin tek amacı
// olan iç bağlantı grafiği Googlebot'a görünmezdi.
// v109 (SEO denetimi, 2026-09-03): /proje/:slug JSON-LD'sindeki `creator` düğümleri ve
// /urun/:slug'daki `brand` düğümü artık `url` taşıyor (bkz. src/lib/seo.js#buildProjectMeta /
// productMetaFromRecord) — böylece Google, projenin yaratıcısını/ürünün markasını sitedeki
// GERÇEK /kisi/:slug ve /firma/:slug sayfalarıyla AYNI varlık olarak birleştirebilir. JSON-LD
// bloğu SSR HTML'inin İÇİNE enjekte edildiğinden (bkz. src/index.js#injectMeta), sürüm
// artırılmazsa daha önce ziyaret edilmiş detay sayfaları s-maxage boyunca url'siz eski
// JSON-LD'yi sunmaya devam eder — yani düzeltme Googlebot'a hiç görünmezdi (v107/v108'deki
// AYNI tuzak). AYNI sürüm, canlıdaki 188 projenin (project_designers'a bağlanamamış serbest
// metin künyeler) SSR gövdesindeki artık DOLU olan "Mimar / Firma" satırını + meta
// description'daki "... imzalı." cümlesini de kapsıyor (bkz. seo.js#fetchUnlinkedProjectCredits).
// v110 (kullanıcı isteği, 2026-09-04): kisi.html/firma.html/marka.html kabuklarına YENİ bir script
// etiketi eklendi — js/components/project-group-filter.js ("Projeler" başlığındaki grup filtresi
// çentiği). Etiketin kendisi SSR HTML'ine gömülü olduğundan, sürüm artırılmazsa daha önce ziyaret
// edilmiş /kisi/:slug ve /firma/:slug sayfaları s-maxage boyunca bu script'i HİÇ yüklemeyen eski
// kabuğu sunar — pop-up açılır ama çentik hiç görünmezdi (v104/v105'teki AYNI tuzak).
// v111 (kullanıcı isteği, 2026-09-04 madde 2): proje.html kabuğuna da project-group-filter.js
// script etiketi eklendi — proje pop-up'ındaki "Firmanın Diğer Projeleri" bölümü artık aynı grup
// filtresini kullanıyor. v110'daki AYNI tuzak, bu kez /proje/:slug için: sürüm artırılmazsa daha
// önce ziyaret edilmiş proje sayfaları s-maxage boyunca bu script'i hiç yüklemeyen eski kabuğu
// sunar ve çentik o sayfalarda görünmezdi.
// v112 (kullanıcı isteği, 2026-09-04): kisi.html'in FILTER_GROUPS dizisi değişti — yeni bir
// "Üniversite" grubu eklendi ve sıra Pozisyon/Doğum Yılı/Üniversite/Meslek/Ödül olarak
// güncellendi. Bu dizi sayfanın SATIR İÇİ JS'inde, yani SSR HTML'inin İÇİNDE duruyor (v104/v106
// ile AYNI tuzak): sürüm artırılmazsa /kisi/:slug ile açılan sayfalar s-maxage boyunca eski
// grup listesini/sırasını sunardı.
// v113 (kullanıcı isteği, 2026-09-04): kisi/firma/marka/proje/urun/en-iyi-100/arama.html kabuklarına
// js/analytics-beacon.js script etiketi eklendi (Profil İstatistikleri görüntülenme sayacı) ve
// arama.html'in satır içi JS'ine arama-gösterimi çağrısı girdi. v110/v111'deki AYNI tuzak: sürüm
// artırılmazsa daha önce ziyaret edilmiş detay sayfaları s-maxage boyunca bu script'i hiç
// yüklemeyen eski kabuğu sunar ve o ziyaretler HİÇ sayılmazdı.
// v114 (denetim/temizlik, 2026-09-04): proje.html ve urun.html kabuklarından <script
// src="add-choice.js"> etiketi KALDIRILDI — o dosya bir no-op IIFE'ye dönüşmüştü (içi boş) ama
// üç sayfada hâlâ ayrı bir HTTP isteği doğuruyordu; dosya silindi. Sürüm artırılmazsa daha önce
// ziyaret edilmiş /proje/:slug ve /urun/:slug sayfaları s-maxage boyunca eski kabuğu sunmaya devam
// eder ve artık var olmayan add-choice.js için 404 üreten bir istek atardı (v110–v113 ile AYNI tuzak).
// v115 (kullanıcı isteği, 2026-09-04): urun.html kabuğuna da project-group-filter.js script
// etiketi eklendi — ürün pop-up'ındaki "Firmanın Diğer Ürünleri" bölümü artık marka pop-up'ındaki
// "Ürünler" ile AYNI kategori filtresini kullanıyor. v110/v111'deki AYNI tuzak, bu kez /urun/:slug
// için: sürüm artırılmazsa daha önce ziyaret edilmiş ürün sayfaları s-maxage boyunca bu script'i
// hiç yüklemeyen eski kabuğu sunar ve çentik o sayfalarda görünmezdi.
// v116 (kullanıcı isteği, 2026-09-05 madde 5): proje.html ve en-iyi-100.html kabuklarına
// js/components/hotspot-tagger.js script etiketi eklendi — büyütülmüş proje görselindeki
// "Ürün Etiketle" formu bu dosyada. v110/v111/v113/v115'teki AYNI tuzak, yine /proje/:slug için:
// sürüm artırılmazsa daha önce ziyaret edilmiş proje sayfaları s-maxage boyunca bu script'i hiç
// yüklemeyen eski kabuğu sunar; buton görünür ama basıldığında (HotspotTagger tanımsız olduğundan,
// bkz. gallery.js'teki typeof koruması) işaretleme modu sessizce hiçbir şey yapmazdı.
// v117 (kullanıcı isteği, 2026-09-05: "her popupın SEO verisi popupın içinden alınsın"): dört
// detay tipinin de SSR gövdesi + JSON-LD'si popup künyesiyle hizalandı (bkz. src/lib/seo.js#
// "POPUP KÜNYE SÖZLEŞMESİ") — kişide Doğum Tarihi/Üniversite/Meslek/Ödüller, projede Tür/Tip/Grup
// üç ayrı eksen + Fotoğraf + Kullanılan Ürünler/Markalar, üründe Versiyonlar/Tasarımcı/Yıl,
// markada Ürün Kategorisi + Ürünler + Markanın Kullanıldığı Projeler. Bu içerik ÖNBELLEKLENEN
// HTML'in İÇİNDE (#ssr-entity-body + <head> JSON-LD) durduğundan, sürüm artırılmazsa daha önce
// ziyaret edilmiş detay sayfaları s-maxage boyunca eski, eksik künyeyi sunmaya devam ederdi.
// v118 (kullanıcı isteği, 2026-09-06 madde 9): kisi.html/firma.html/marka.html kabuklarındaki
// Filtreler kenar çubuğunun CSS'i ve işaretlemesi proje.html/urun.html'inkiyle birebir eşitlendi
// (.grid-sidebar padding/gap kaldırıldı, .sidebar-head alt çizgi aldı, "Ekle" butonu artık bir
// .sidebar-add sarmalayıcısının içinde). v110/v111/v113/v115/v116'daki AYNI tuzak, bu kez /kisi/:key,
// /firma/:key ve /marka/:key için: bu üç dosya yalnızca liste sayfası DEĞİL, aynı zamanda o detay
// yollarının SSR kabuğudur — sürüm artırılmazsa daha önce ziyaret edilmiş profil sayfaları s-maxage
// boyunca ESKİ stil/işaretleme ile servis edilir ve yeni .sidebar-add sarmalayıcısı olmayan kabukta
// filtre kutusu (yeni CSS + eski HTML karışımıyla) bozuk görünürdü.
// v119 (kullanıcı isteği, 2026-09-06 madde 2): saf markaların kanonik URL'i /firma/:slug'tan
// /marka/:slug'a taşındı (bkz. src/lib/officeUrl.js). Bu üç şeyi birden değiştirir ve üçü de
// önbelleklenmiş SSR gövdesine gömülüdür: (a) /marka/:slug artık marka.html kabuğunu servis eden
// YENİ bir detay yolu (kabuktaki detay-yolu regex'leri /firma/ → /marka/ olarak güncellendi),
// (b) canonical/og:url etiketleri, (c) marka.html/firma.html kart bağlantıları (`o.brand` bayrağına
// göre önek). v110-v118'deki AYNI tuzak: sürüm artırılmazsa daha önce ziyaret edilmiş marka
// sayfaları s-maxage boyunca ESKİ kabukla (yanlış regex → popup hiç açılmaz) servis edilirdi.
// v120 (kullanıcı isteği, 2026-09-07): Gündem SSR kartının İŞARETLEMESİ değişti — ayrı "Kaynağa
// git" satırı kaldırıldı, kaynak adı meta satırında bağlantı oldu, başlık liste dışında bağlantı
// değil. v110-v119'un AYNI tuzağı: gövde önbelleğe GÖMÜLÜ olduğundan, sürüm artırılmazsa /gundem'i
// daha önce açmış ziyaretçiler s-maxage boyunca ESKİ kart işaretlemesini görmeye devam ederdi
// (canlıda doğrulandı: arşivleme sonrası SSR hâlâ 9 kart ve "Kaynağa git" metnini gösteriyordu).
export const SSR_CACHE_VERSION = 'v120';

const PREFIX_BY_TYPE = {
  project: '/proje/',
  architect: '/kisi/',
  // office: İKİ önek — bir kayıt saf markaysa kanonik URL /marka/:slug, değilse /firma/:slug (bkz.
  // src/lib/officeUrl.js, kullanıcı isteği 2026-09-06 madde 2). Hangisinin önbellekte olduğu
  // purge anında bilinemez (kayıt az önce marka olmaktan çıkmış da olabilir), bu yüzden İKİSİ de
  // temizlenir — yoksa bayat bir SSR gövdesi s-maxage boyunca yaşamaya devam ederdi. Dizi biçimini
  // aşağıdaki döngü zaten destekliyor.
  office: ['/firma/', '/marka/'],
  product: '/urun/',
  // Gündem (kullanıcı isteği, 2026-09-07 madde 5): admin bir içeriği düzenlediğinde/arşivlediğinde
  // o kaydın SSR sayfası da temizlenmeli — liste purge'ü (gundemCache.js) tekil sayfaya DOKUNMAZ.
  gundem: '/gundem/',
};

// D1 audit (2026-08-25) P0-1 — publicCache.js#CACHEABLE_DETAIL_PREFIXES ile BİREBİR aynı 4 yol.
// purgeSsrDetailCache zaten her içerik-mutasyon noktasında (type, key) ile çağrılıyor (bkz. aşağıdaki
// export'un tüm çağıranları — admin.js, submissions.js, legacyContent.js, officeFounderCascade.js,
// canonicalSync.js, architect.js/product.js kendi profil güncellemeleri) — SSR HTML sayfa cache'i
// (caches.default) İLE AYNI anda, aynı (type, key) çiftiyle yeni JSON detay cache girdisini de
// temizlemek için bu haritayı ayrı bir çağıran zinciri kurmadan burada kullanmak yeterli.
const API_DETAIL_PREFIX_BY_TYPE = {
  project: '/api/project/',
  architect: '/api/architect/',
  office: '/api/office/',
  product: '/api/product/',
  gundem: '/api/gundem/',
};

// architect/office temiz URL'leri isimden slugify edilir (bkz. src/index.js#CLEAN_URL_REDIRECTS
// slugifyValue:true) — project/product zaten kendi slug/anahtarını (ör. "m-<submissionId>")
// kullanır, ayrıca slugify edilmez.
const SLUGIFY_TYPES = new Set(['architect', 'office']);

// Admin panelinden (ya da admin'in kendi gönderisinin anında yayına girmesiyle) bir proje/mimar/
// firma/ürün değiştiğinde, o kaydın SSR HTML önbelleğini (bkz. src/index.js#serveDetailPage)
// hemen temizlemeye çalışır. invalidatePublicCache (bkz. publicCache.js) yalnızca istemcinin
// çalışma zamanında okuduğu /api/public/* JSON uçlarını temizler — SSR katmanına gömülü <title>/
// og:image/JSON-LD gibi meta etiketler bundan etkilenmiyordu (gerçek bulgu: admin bir projenin
// kapak görselini değiştirdikten hemen sonra paylaşım önizlemesi/SEO meta'sı s-maxage=3600 boyunca
// eski kalabiliyordu). caches.default PoP-başınadır (bkz. publicCache.js#invalidatePublicCache'teki
// aynı sınırlama) — bu yalnızca YAZMA isteğini işleyen edge node'un kendi girdisini temizler, tam
// bir garanti değildir; bu yüzden src/index.js'teki SSR_PAGE_CACHE_HEADERS s-maxage'ı da kısa
// tutulur, bu purge sadece en yaygın durumda (aynı PoP'a düşen sonraki istek) anlık bir düzeltme
// sağlar. rawKey boşsa ya da tip tanınmıyorsa sessizce hiçbir şey yapmaz.
// env (opsiyonel, 2026-09-01 madde E): verilirse bu kaydın SSR sayfası + JSON detay ucu
// Cloudflare purge-by-URL API'siyle TÜM PoP'larda da temizlenir (bkz. src/lib/globalPurge.js).
// Verilmeyen/secret'sız çağrılarda davranış ESKİSİYLE BİREBİR aynı — yalnızca yerel PoP.
export async function purgeSsrDetailCache(type, rawKey, env) {
  const prefixes = PREFIX_BY_TYPE[type];
  if (!prefixes || !rawKey) return;
  const slug = SLUGIFY_TYPES.has(type) ? slugify(rawKey) : rawKey;
  if (!slug) return;
  const globalUrls = [];
  for (const prefix of Array.isArray(prefixes) ? prefixes : [prefixes]) {
    try {
      const keyUrl = new URL(`https://mimarlab.com${prefix}${encodeURIComponent(slug)}`);
      keyUrl.searchParams.set('__cv', SSR_CACHE_VERSION);
      await caches.default.delete(new Request(keyUrl));
      // Zone-geneli purge, gerçek (kullanıcının gördüğü) URL'yi hedefler — __cv yalnızca Worker'ın
      // KENDİ cache anahtarına eklediği bir sürüm parametresidir, tarayıcı/Cloudflare edge'i
      // sayfayı çıplak yoluyla saklar.
      globalUrls.push(`https://mimarlab.com${prefix}${encodeURIComponent(slug)}`);
    } catch { /* caches API bazı ortamlarda (ör. yerel wrangler dev) kullanılamayabilir */ }
  }
  // D1 audit (2026-08-25) P0-1 — /api/project|architect|office|product/:key JSON detay cache'i
  // (bkz. publicCache.js#cachedPublicJson'daki yeni isDetailPath dalı) yukarıdaki SSR HTML
  // girdisiyle AYNI anahtar biçimini (slugify edilmiş architect/office adı, ham project/product
  // slug'ı) paylaşır — cacheKeyFor() publicCache.js'ten içe aktarılır ki iki dosyanın anahtar
  // üretimi zamanla birbirinden SAPMASIN. __cv sürüm parametresi YOK — JSON detay cache'i
  // SSR_CACHE_VERSION'dan bağımsız (yalnızca SSR şablonu değiştiğinde artan bir sürüm, JSON yanıt
  // şeklini etkilemez).
  const apiPrefix = API_DETAIL_PREFIX_BY_TYPE[type];
  if (apiPrefix) {
    try {
      await caches.default.delete(cacheKeyFor(`${apiPrefix}${encodeURIComponent(slug)}`));
    } catch { /* caches API bazı ortamlarda (ör. yerel wrangler dev) kullanılamayabilir */ }
    globalUrls.push(`https://mimarlab.com${apiPrefix}${encodeURIComponent(slug)}`);
  }
  if (env) await purgeGlobalUrls(env, globalUrls);
}

// src/lib/submissionTypes.js#SUBMISSION_TYPES anahtarlarını (offices/projects/products/materials/
// architects) yukarıdaki PREFIX_BY_TYPE anahtarlarına eşler — materials, products ile aynı /urun/
// modalını (urun.html + js/components/product-modal.js) paylaşır.
const SSR_TYPE_BY_SUBMISSION_TYPE = {
  projects: 'project', architects: 'architect', offices: 'office',
  products: 'product', materials: 'product',
};

// Bir <tip>_submissions satırından (claimed_slug/claimed_profile_key varsa statik kaydın kendi
// anahtarı, yoksa satırın kendi slug/name/id'si) purgeSsrDetailCache'e verilecek {type, key} çiftini
// çıkarır. Ürün/malzeme için satırın kendi id'sinden türeyen "m-<id>" anahtarı kullanılır (bkz.
// js/components/product-modal.js#fetchItem — üye gönderili kayıtlar için aynı desen). Eşlemede
// karşılığı olmayan tipler için null döner.
export function ssrPurgeTargetFor(typeKey, row) {
  const type = SSR_TYPE_BY_SUBMISSION_TYPE[typeKey];
  if (!type || !row) return null;
  if (typeKey === 'projects') return { type, key: row.claimed_slug || row.slug };
  if (typeKey === 'architects' || typeKey === 'offices') return { type, key: row.claimed_profile_key || row.name };
  if (typeKey === 'products' || typeKey === 'materials') return row.id ? { type, key: `m-${row.id}` } : null;
  return null;
}
