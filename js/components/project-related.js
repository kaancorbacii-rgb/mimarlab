// ArchitectProjects ("Mimarın/Firmanın Diğer Projeleri") + RelatedProjects ("İlgili Projeler").
// proje-detay.html'in eski istemci-taraf tam-dizi taramasının (sameDesigner/relatedScore, statik
// projects[] üzerinde) yerini alır — artık proje.html'de bellekte TÜM projelerin bir kopyası
// olmadığından (Faz 3 sayfalama migrasyonu, bkz. proje.html dosya başı yorumu) her ikisi de mevcut
// /api/projects liste ucunu (bkz. src/routes/project.js#handleProjectListRoute) filtre param'larıyla
// çağırır — yeni bir backend ucu GEREKMEZ:
//   - ArchitectProjects: item.designerDetails'teki her isim zaten 'architect'/'office' olarak
//     sınıflandırılmış (bkz. src/routes/project.js#fetchDesignerDetails) — bu yüzden proje-detay.html'in
//     aksine hangi filtre grubuna (designer/designerOffice) gideceğini tahmin etmeye GEREK YOK.
//   - RelatedProjects: ağırlıklı yüzde skorlaması (bkz. kullanıcı isteği ve RelatedProjects
//     içindeki WEIGHT sabiti — Tip %30, Tip Grubu %40, Yıl Yakınlığı %30) — mimar/tip/kategori/
//     şehir/genel puan filtreleriyle geniş bir aday havuzu toplanır, ardından her adayın skoru
//     kaynak projeyle YALNIZCA bu 3 alan karşılaştırılarak hesaplanır (hangi sorgunun adayı
//     getirdiğinden bağımsız); son liste her mount()'ta ağırlıklı-rastgele karıştırılır (bkz.
//     weightedSample) — popup her açıldığında birebir aynı sıralama/liste çıkmaz.
const ArchitectProjects = (function () {
  const DEFAULT_IDS = { section: 'pm-same-designer-section', grid: 'pm-same-designer-grid' };
  // mountSeq: project-comments.js#mountSeq ile AYNI desen/gerekçe — proje popup'ı hızla
  // değiştirildiğinde önceki projenin yavaş kalan sayfalanmış /api/projects isteği, artık ekranda
  // olan YENİ projenin "Diğer Projeleri" bölümünü ezmesin diye.
  let mountSeq = 0;

  function cardHtml(p) {
    const img = p.images && p.images[0];
    const srcset = img ? cdnSrcset(img, [300, 450, 600]) : '';
    return `<a class="related-card" href="/proje/${encodeURIComponent(p.slug)}">
      <div class="related-card-photo">
        ${img ? `<img src="${escapeAttr(cdnImg(img, 450))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="300px"` : ''} alt="${escapeAttr(p.title)}" loading="lazy" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(p.title)}">${escapeHtml(initials(p.title))}</div>`}
      </div>
      <div class="related-card-title"><span class="related-card-title-clamp">${escapeHtml(p.title)}</span></div>
    </a>`;
  }

  // /api/projects sayfalanmış bir uç (bkz. src/routes/project.js#handleProjectListRoute, limit
  // sunucuda 96'ya sabitlenir) — tek bir limit=8 isteği yerine Mimar Sinan gibi çok projesi olan
  // mimar/firmaların TÜM projelerini kaçırmamak için (bkz. kullanıcı isteği: "eksiksiz listelenmesin")
  // dönen totalPages tükenene kadar sayfa sayfa (96'şar) çekilip birleştirilir.
  async function fetchByDesigner(name, type, buildStatus) {
    const key = type === 'architect' ? 'designer' : 'designerOffice';
    const items = [];
    let page = 1;
    let totalPages = 1;
    try {
      do {
        const res = await fetch(`/api/projects?${key}=${encodeURIComponent(name)}&buildStatus=${encodeURIComponent(buildStatus)}&limit=96&page=${page}`);
        if (!res.ok) break;
        const data = await res.json();
        items.push(...(data.items || []));
        totalPages = data.totalPages || 1;
        page++;
      } while (page <= totalPages);
    } catch { /* şimdiye kadar toplanan kısmi sonuçla devam edilir */ }
    return items;
  }

  async function mount(item, ids) {
    const mySeq = ++mountSeq;
    const mergedIds = Object.assign({}, DEFAULT_IDS, ids || {});
    const section = document.getElementById(mergedIds.section);
    const designers = item.designerDetails || [];
    // buildStatus: kaynak projeyle AYNI kategori (bkz. gatherCandidateQueries'teki AYNI gerekçe).
    const buildStatus = item.buildStatus === 'concept' ? 'concept' : 'built';
    const lists = await Promise.all(designers.map(d => fetchByDesigner(d.name, d.type, buildStatus)));
    if (mySeq !== mountSeq) return { slugs: new Set() };
    const seen = new Set([item.slug]);
    const merged = [];
    lists.flat().forEach(p => { if (!seen.has(p.slug)) { seen.add(p.slug); merged.push(p); } });
    if (!merged.length) { section.style.display = 'none'; return { slugs: new Set() }; }
    section.style.display = '';
    // Sabit bir üst sınır YOK (kullanıcı isteği: "TÜM projelerinin eksiksiz listelenmesi") —
    // .related-grid-scroll zaten yatay kaydırmalı bir satır (bkz. proje.html), liste ne kadar
    // uzarsa uzasın taşma olmadan kaydırılarak gezilebilir.
    document.getElementById(mergedIds.grid).innerHTML = merged.map(cardHtml).join('');
    return { slugs: new Set(merged.map(p => p.slug)) };
  }

  return { mount };
})();

// Puan bazlı deterministik öneri skorlaması (bkz. kullanıcı isteği). Adaylar hâlâ /api/projects'e
// birkaç geniş sorgu (mimar/tip/kategori/şehir + genel havuz) atılarak toplanır — Faz 3 sayfalama
// migrasyonundan beri istemcide TÜM projelerin bir kopyası olmadığından tam tablo taraması mümkün
// değil (bkz. dosya başı yorum) — ama asıl puanlama, hangi sorgunun adayı getirdiğine bakılmaksızın
// kaynak projeyle adayın TÜM alanları karşılaştırılarak hesaplanır, böylece aday birden çok kritere
// uysa bile (örn. hem aynı mimar hem aynı şehir) puanı eksiksiz toplanır.
const RelatedProjects = (function () {
  const DEFAULT_IDS = { section: 'pm-related-section', grid: 'pm-related-grid' };
  // mountSeq: ArchitectProjects#mountSeq ile AYNI desen/gerekçe (bkz. yukarısı).
  let mountSeq = 0;
  // Kural 2 (bkz. kullanıcı isteği: "Selçuklu Kongre Merkezi Kültürel tipte bir projeye Dini tipte
  // olan bir cami önerilmiş... Önce aynı tip olmalı"): hasSameCategory (Tip) ve hasSameDiscipline
  // (Tür) BİRİNCİL öncelik sırasıdır — havuz önce bu iki kritere TAM uyan adaylarla doldurulur.
  // ANCAK artık sert bir filtre DEĞİL (bkz. kullanıcı isteği, gerçek bulgu: "bu kritere göre bazı
  // projelerde hiç eşleşen aday kalmıyor, bölüm boş/eksik kalıyordu — tam eşleşme olmasa bile
  // benzer örnekler vererek İlgili Projeler sayısı her zaman en az 15 olsun, kategoriye uymasa bile
  // aynı türden farklı projeler önerilsin"): havuz ÜÇ seviyeye ayrılır — strictPool (Tür+Tip tam
  // eşleşen), disciplinePool (yalnızca Tür eşleşen, Tip farklı) ve fallbackPool (ne Tür ne Tip
  // eşleşen) — strictPool RESULT_COUNT'u karşılamazsa mount() sırasıyla disciplinePool'dan, o da
  // yetmezse fallbackPool'dan tamamlar (bkz. mount()'taki üç aşamalı sampleTier çağrısı ve
  // gatherCandidateQueries'teki withDisciplineFilters/withBuildStatusOnly sorguları — sunucu
  // tarafında discipline+category filtreleri AND'lendiğinden, "aynı Tür farklı Tip" adayların
  // sorgu sonucuna hiç girebilmesi için category kısıtı BİLEREK dışarıda bırakılan ayrı bir sorgu
  // gerekir, bkz. src/routes/project.js#passesFilters).
  // Sıralama sinyali: Yıl Yakınlığı (bkz. kullanıcı isteği: "sonra yakın yıllarda olmalı") —
  // weightedSample zaten var olan rastgelelik davranışını (her açılışta farklı sıralama) korumak
  // için bu skoru kullanmaya devam eder. Aynı mimara/firmaya ait projeler ayrıca hiç bu bölüme
  // girmez (bkz. kullanıcı isteği: "aynı mimara ait başka proje bu kısımda olmamalı") — bu,
  // mount()'a geçirilen excludeSlugsPromise (ArchitectProjects'in gösterdiği TÜM slug'lar) ile sağlanır.
  const YEAR_FULL_ZERO_WINDOW = 10; // bu yıl farkı VE ÜZERİ -> yıl yakınlığı puanı 0
  const RESULT_COUNT = 15;

  function cardHtml(p) {
    const img = p.images && p.images[0];
    const srcset = img ? cdnSrcset(img, [300, 450, 600]) : '';
    return `<a class="related-card" href="/proje/${encodeURIComponent(p.slug)}">
      <div class="related-card-photo">
        ${img ? `<img src="${escapeAttr(cdnImg(img, 450))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="300px"` : ''} alt="${escapeAttr(p.title)}" loading="lazy" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(p.title)}">${escapeHtml(initials(p.title))}</div>`}
      </div>
      <div class="related-card-title"><span class="related-card-title-clamp">${escapeHtml(p.title)}</span></div>
    </a>`;
  }

  function extractYear(dateStr) {
    const m = /(\d{4})/.exec(dateStr || '');
    return m ? parseInt(m[1], 10) : null;
  }

  // parseLocationFull (il-ilce-data.js) tek bir {city,district} çifti döner; o dosyadaki IL_ILCE
  // tablosu yurt dışı ülkeleri de "il" seviyesinde anahtar olarak tuttuğundan (bkz. il-ilce-data.js),
  // info.city aslında "il/ülke" seviyesi, info.district ise "ilçe/yurt dışı şehir" seviyesidir. Bu
  // yardımcı, IL_LIST (Türkiye illeri) ile karşılaştırıp bunu gerçek {city,country} çiftine çevirir.
  function locationParts(location) {
    if (typeof parseLocationFull !== 'function') return { city: null, country: null };
    const info = parseLocationFull(location);
    if (!info.city) return { city: null, country: null };
    const isDomestic = typeof IL_LIST !== 'undefined' && IL_LIST.includes(info.city);
    return isDomestic
      ? { city: info.district || info.city, country: 'Türkiye' }
      : { city: info.district || null, country: info.city };
  }

  // Kural 1 (bkz. kullanıcı isteği: "en üst katman tür olsun... restorasyonsa önerilenlerin de
  // hepsi restorasyon olsun"): strict havuz kaynak projeyle AYNI "Tür"e (discipline — Mimari/İç
  // Mekan/Peyzaj ve Kentsel Tasarım/Restorasyon) sahip projelerle önce doldurulur (bkz. mount()'taki
  // iki aşamalı sampleTier — bu artık bir sert filtre değil, ÖNCELİK sırası, bkz. dosya başı yorum).
  // Bir proje BİRDEN ÇOK discipline taşıyabilir (ör. ["Mimari","Restorasyon"]) — gerçek bulgu: eski
  // "some" (HERHANGİ BİR ortak değer yeter) mantığı, kaynak ["Mimari","Restorasyon"] olduğunda salt
  // "Mimari" (restorasyon bileşeni SIFIR) adayları da "Mimari" ortak olduğu için geçiriyordu
  // (Santralistanbul Enerji Müzesi'nde 15 öneriden 12'si restorasyon içermiyordu). "every" — kaynağın
  // TÜM discipline etiketleri adayda da bulunmalı (aday FAZLADAN etiket taşıyabilir, sorun değil) —
  // bunu düzeltir: restorasyon içeren bir kaynak SADECE restorasyon içeren adayları strict havuza alır
  // (yeterli sayıda yoksa geri kalan yer fallback havuzdan tamamlanır). Kaynak projede discipline
  // verisi YOKSA (eski/eksik kayıt) bu ayrım uygulanamaz, TÜM adaylar strict sayılır.
  function hasSameDiscipline(source, candidate) {
    const sourceDisciplines = source.discipline || [];
    if (!sourceDisciplines.length) return true;
    const candSet = new Set(candidate.discipline || []);
    return sourceDisciplines.every(d => candSet.has(d));
  }

  // Kural 2 (bkz. yukarısı ve kullanıcı isteği: "aynı tip olsun") — hasSameDiscipline ile BİREBİR
  // aynı "every" deseni, ama "Tip" (category[]) alanı üzerinde. Kaynakta category verisi YOKSA bu
  // ayrım uygulanamaz, TÜM adaylar strict sayılır.
  function hasSameCategory(source, candidate) {
    const sourceCategories = source.category || [];
    if (!sourceCategories.length) return true;
    const candSet = new Set(candidate.category || []);
    return sourceCategories.every(c => candSet.has(c));
  }

  function yearProximity(sourceDate, candDate) {
    const sourceYear = extractYear(sourceDate);
    const candYear = extractYear(candDate);
    if (sourceYear == null || candYear == null) return 0;
    const diff = Math.abs(sourceYear - candYear);
    if (diff >= YEAR_FULL_ZERO_WINDOW) return 0;
    return 1 - diff / YEAR_FULL_ZERO_WINDOW;
  }

  function scoreCandidate(source, candidate) {
    if (candidate.slug === source.slug) return -Infinity;
    return yearProximity(source.date, candidate.date) * 100;
  }

  async function fetchByParams(paramList, limit) {
    const params = new URLSearchParams();
    paramList.forEach(([k, v]) => params.append(k, v));
    params.set('limit', String(limit));
    try {
      const res = await fetch(`/api/projects?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.items || [];
    } catch { return []; }
  }

  // Kural 1 & 2 — 'discipline' ve 'category' zaten desteklenen /api/projects filtre param'ları
  // (bkz. src/routes/project.js#buildFilterGroups 'Tür'/'Tip'), her aday sorgusuna eklenerek
  // havuzun KAYNAĞINDA (client-side hasSameDiscipline()/hasSameCategory() beklemeden) farklı
  // türde/tipte projeler elenir. Çoklu değer OR mantığıyla eşleşir (bkz. passesFilters#vals.some) —
  // AMA discipline ve category AYRI filtre grupları oldukları için birbirleriyle AND'lenir (bkz.
  // src/routes/project.js#passesFilters "FILTER_GROUPS.every"). GERÇEK BULGU: withFilters ESKİDEN
  // HER sorguya hem disciplineParams HEM categoryParams'ı BİRLİKTE ekliyordu — bu da sunucu
  // tarafında "aynı Tür ama farklı Tip" adaylarını (kullanıcı isteği: "aynı kategoriye uyan olmasa
  // bile aynı türden farklı projeler öner") client'taki hasSameDiscipline/hasSameCategory ayrımına
  // HİÇ ULAŞTIRMADAN eliyordu — çünkü candidate zaten sorgu sonucunda yoktu. Bu yüzden aşağıda ÜÇ
  // ayrı filtre seviyesi kullanılır: withStrictFilters (Tür+Tip birlikte — en iyi eşleşme),
  // withDisciplineFilters (yalnızca Tür — Tip serbest, "aynı türden farklı projeler" havuzu) ve
  // withBuildStatusOnly (ne Tür ne Tip — yalnızca buildStatus, mount()'taki RESULT_COUNT
  // garantisini besleyen genel/geniş havuz).
  function gatherCandidateQueries(item) {
    const queries = [];
    // buildStatus: aday havuzu kaynak projeyle AYNI kategoride kalmalı (bkz. kullanıcı isteği,
    // migrations/0037_project_build_status.sql) — aksi halde bir konsept/öğrenci projesinin
    // "İlgili Projeler"ı arasına inşa edilmiş eserler (ya da tersi) karışırdı.
    const buildStatusParam = ['buildStatus', item.buildStatus === 'concept' ? 'concept' : 'built'];
    const disciplineParams = (item.discipline || []).map(d => ['discipline', d]);
    const categoryParams = (item.category || []).map(c => ['category', c]);
    const withStrictFilters = params => [...params, buildStatusParam, ...disciplineParams, ...categoryParams];
    const withDisciplineFilters = params => [...params, buildStatusParam, ...disciplineParams];
    const withBuildStatusOnly = params => [...params, buildStatusParam];
    (item.designerDetails || []).forEach(d => {
      if (d.unregistered) return;
      queries.push(fetchByParams(withStrictFilters([[d.type === 'architect' ? 'designer' : 'designerOffice', d.name]]), 12));
    });
    (item.type || []).forEach(t => queries.push(fetchByParams(withStrictFilters([['type', t]]), 32)));
    const topLevelLocation = locationParts(item.location);
    const rawCity = (typeof parseLocationFull === 'function') ? parseLocationFull(item.location).city : null;
    if (rawCity) queries.push(fetchByParams(withStrictFilters([['location', rawCity]]), 32));
    // Kural 3 (bkz. yukarısı, mount()'taki loadSeenSlugs) — bu sorgular proje-BAĞIMSIZ (sort=
    // rating_desc / discipline+category'ye göre id DESC), yani AYNI Tip'teki her proje için neredeyse
    // birebir aynı sonucu döner. Limitler eskiden 16/24'tü — bu, "seen" havuzunun hızla tükenip her
    // yeni proje pop-up'ının aynı dar kümeye geri dönmesine yol açıyordu (gerçek bulgu: iki farklı
    // Dini proje arasında %60 çakışma). Limitleri büyütmek (sunucu üst sınırı 96, bkz.
    // src/routes/project.js#handleProjectListRoute) "seen" filtresine rotasyon yapacak gerçek bir
    // havuz sağlar.
    queries.push(fetchByParams(withStrictFilters([['sort', 'rating_desc']]), 40)); // Tür+Tip'e uyan genel havuz
    if (disciplineParams.length || categoryParams.length) queries.push(fetchByParams([...disciplineParams, ...categoryParams, buildStatusParam], 80)); // Tür+Tip'e özel geniş havuz
    // "aynı türden farklı projeler öner" havuzu (kullanıcı isteği) — category BİLEREK dışarıda
    // bırakılır ki sunucu tarafındaki AND birleşimi (yukarıdaki dosya başı not) farklı Tip'teki
    // aynı-Tür adayları elemesin; disciplinePool bunları mount()'ta ikinci öncelik olarak kullanır.
    if (disciplineParams.length) queries.push(fetchByParams(withDisciplineFilters([['sort', 'rating_desc']]), 80));
    // Kural 4 (kullanıcı isteği: "ilgili proje sayısı her zaman en az 15 olsun") — ne Tür ne Tip
    // kısıtı taşımayan, yalnızca buildStatus'a bağlı geniş bir genel havuz: strictPool+disciplinePool
    // niş bir kaynak proje için RESULT_COUNT'u dolduramazsa mount()'taki fallbackPool bu sorgudan
    // beslenir, böylece bölüm neredeyse hiçbir zaman 15'in altında kalmaz (bkz. mount()).
    queries.push(fetchByParams(withBuildStatusOnly([['sort', 'rating_desc']]), 96));
    return { queries, topLevelLocation };
  }

  // Kural 3 (bkz. kullanıcı isteği: "Bir projeden diğerine geçerken aynı önerileri görmeyelim") —
  // weightedSample TEK bir mount() çağrısı içindeki havuzu karıştırır ama havuzun kendisi (özellikle
  // dar bir Tip/Tür kombinasyonunda) birçok farklı proje için neredeyse AYNI aday kümesinden gelir;
  // bu yüzden art arda açılan farklı proje pop-up'ları görsel olarak "hep aynı önerileri gösteriyor"
  // hissi verebiliyordu. SEEN_SSKEY altında sessionStorage'a (sekme kapanınca temizlenir, kalıcı
  // değil) bu TARAYICI OTURUMUNDA daha önce "İlgili Projeler"de gösterilmiş slug'lar biriktirilir;
  // her mount() önce HİÇ gösterilmemiş adaylardan seçim yapar, yalnızca havuz onları tüketirse
  // (ör. çok dar bir kategori) daha önce görülmüş adaylarla tamamlar — böylece tekrar sıfıra
  // inmeden rotasyon sağlanır. SEEN_MAX: sınırsız büyümesin diye en eski girişler FIFO düşürülür —
  // bu da eski adayların bir süre sonra tekrar "taze" sayılıp havuza dönmesini sağlar.
  const SEEN_SSKEY = 'mimarlab.relatedProjectsSeen';
  const SEEN_MAX = 150;

  function loadSeenSlugs() {
    try {
      const raw = sessionStorage.getItem(SEEN_SSKEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  }

  function rememberSeenSlugs(seen, newSlugs) {
    newSlugs.forEach(s => seen.delete(s)); // en sona taşınacak, FIFO sırasını güncel tutar
    newSlugs.forEach(s => seen.add(s));
    try {
      sessionStorage.setItem(SEEN_SSKEY, JSON.stringify(Array.from(seen).slice(-SEEN_MAX)));
    } catch { /* sessionStorage kapalı/dolu olabilir - oturum-içi rotasyon sessizce devre dışı kalır */ }
  }

  // D1'de ORDER BY RANDOM() KULLANILMAZ (bkz. kullanıcı isteği: büyük veri kümelerinde yük riski) —
  // rastgelelik tamamen istemcide, zaten çekilmiş aday havuzu üzerinde çalışır. Ağırlıklı örnekleme
  // (rulet çarkı): yüksek puanlı adaylar havuzda daha ağır bastığından genelde seçilir, ama HER
  // mount() çağrısında (= her popup açılışında/geçişinde) Math.random() yeniden çalıştığından hangi
  // adayların seçildiği ve sırası değişir (bkz. kullanıcı isteği: "her açıldığında farklı öneriler").
  // +1: puanı 0 olan (yalnızca genel havuzdan gelen) adaylar da sıfır olmayan bir şansa sahip olsun.
  function weightedSample(scored, n) {
    const pool = scored.slice();
    const picked = [];
    for (let i = 0; i < n && pool.length; i++) {
      const total = pool.reduce((s, c) => s + (c.score + 1), 0);
      let r = Math.random() * total, idx = 0;
      for (; idx < pool.length - 1; idx++) { r -= (pool[idx].score + 1); if (r <= 0) break; }
      picked.push(pool.splice(idx, 1)[0]);
    }
    return picked.map(({ p }) => p);
  }

  // excludeSlugsPromise: bir Promise<Set<string>> (bkz. js/components/project-modal.js#armDeferredSections)
  // — "Diğer Projeleri" ile ÇAKIŞMAYAN bir seçki için o bölümün slug'larını bekler, ama BU fonksiyonun
  // kendi /api/projects sorguları (gatherCandidateQueries) o bekleyişten BAĞIMSIZ hemen ateşlenir
  // (bkz. gerçek bulgu: eskiden RelatedProjects, ArchitectProjects'in TÜM sayfalarını bitirmesini
  // bekledikten SONRA kendi isteklerine başlıyordu — çok projeli bir mimar için bu, "İlgili Projeler"ı
  // gereksiz yere geciktiriyordu). Yalnızca dışlama+render adımı excludeSlugsPromise'i bekler.
  async function mount(item, excludeSlugsPromise, ids) {
    const mySeq = ++mountSeq;
    const mergedIds = Object.assign({}, DEFAULT_IDS, ids || {});
    const section = document.getElementById(mergedIds.section);

    const { queries } = gatherCandidateQueries(item);
    const listsPromise = Promise.all(queries);
    const [lists, excludeSlugs] = await Promise.all([listsPromise, excludeSlugsPromise]);
    if (mySeq !== mountSeq) return;

    const exclude = new Set(excludeSlugs || []);
    exclude.add(item.slug);

    // Kural 1 & 2 artık BİRİNCİL öncelik, sert filtre DEĞİL (bkz. dosya başı yorum, kullanıcı isteği:
    // "aynı kategoriye uyan olmasa bile aynı türden farklı projeler öner... ilgili proje sayısı her
    // zaman en az 15 olsun") — havuz ÜÇ seviyeye ayrılır: strictPool (Tür+Tip TAM eşleşen — en iyi
    // eşleşme), disciplinePool (Tür aynı ama Tip FARKLI — "aynı türden farklı projeler") ve
    // fallbackPool (ne Tür ne Tip eşleşen, yalnızca aynı buildStatus'ta ve aynı mimara ait OLMAYAN
    // "benzer" adaylar — RESULT_COUNT'u dolduramayan niş projeler için son çare). exclude Seti zaten
    // "aynı mimara ait" projeleri dışarıda tutar (bkz. dosya başı mount() yorumu —
    // excludeSlugsPromise, ArchitectProjects'in gösterdiği TÜM slug'lar).
    const strictPool = new Map();
    const disciplinePool = new Map();
    const fallbackPool = new Map();
    lists.flat().forEach(p => {
      if (exclude.has(p.slug) || strictPool.has(p.slug) || disciplinePool.has(p.slug) || fallbackPool.has(p.slug)) return;
      const sameDiscipline = hasSameDiscipline(item, p);
      const sameCategory = hasSameCategory(item, p);
      const tier = sameDiscipline && sameCategory ? strictPool : sameDiscipline ? disciplinePool : fallbackPool;
      tier.set(p.slug, p);
    });

    // Kural 3 — önce bu oturumda hiç gösterilmemiş adaylardan seç, havuz yetmezse (ör. dar bir
    // Tip/Tür kombinasyonu) daha önce görülmüş adaylarla tamamla (bkz. yukarısı, loadSeenSlugs).
    const seen = loadSeenSlugs();
    function sampleTier(pool, n) {
      const scored = Array.from(pool.values())
        .map(p => ({ p, score: scoreCandidate(item, p) }))
        .filter(({ score }) => score > -Infinity);
      const fresh = scored.filter(({ p }) => !seen.has(p.slug));
      const stale = scored.filter(({ p }) => seen.has(p.slug));
      let picked = weightedSample(fresh, n);
      if (picked.length < n) picked = picked.concat(weightedSample(stale, n - picked.length));
      return picked;
    }

    // Önce strictPool (Tür+Tip tam eşleşen), sonra disciplinePool (Tür aynı, Tip farklı — kullanıcı
    // isteği: "aynı kategoriye uyan olmasa bile aynı türden farklı projeler öner") tüketilir;
    // RESULT_COUNT'a ulaşmak için hâlâ yetmezse geri kalan yer fallbackPool'dan tamamlanır —
    // böylece bölüm, kaynak proje ne kadar niş olursa olsun neredeyse her zaman en az 15 kartla dolu
    // görünür (kullanıcı isteği: "ilgili proje sayısı her zaman en az 15 olsun"), yalnızca sitede o
    // buildStatus'ta/hariç tutulanlar dışında GERÇEKTEN 15'ten az proje varsa daha az kart gösterir.
    let merged = sampleTier(strictPool, RESULT_COUNT);
    if (merged.length < RESULT_COUNT) merged = merged.concat(sampleTier(disciplinePool, RESULT_COUNT - merged.length));
    if (merged.length < RESULT_COUNT) merged = merged.concat(sampleTier(fallbackPool, RESULT_COUNT - merged.length));

    if (!merged.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    document.getElementById(mergedIds.grid).innerHTML = merged.map(cardHtml).join('');
    rememberSeenSlugs(seen, merged.map(p => p.slug));
  }

  return { mount };
})();
