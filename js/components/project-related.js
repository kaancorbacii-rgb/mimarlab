// ArchitectProjects ("Mimarın/Firmanın Diğer Yapıları") + RelatedProjects ("İlgili Yapılar").
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

  function cardHtml(p) {
    const img = p.images && p.images[0];
    const srcset = img ? cdnSrcset(img, [300, 450, 600]) : '';
    return `<a class="related-card" href="/yapi/${encodeURIComponent(p.slug)}">
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
    const mergedIds = Object.assign({}, DEFAULT_IDS, ids || {});
    const section = document.getElementById(mergedIds.section);
    const designers = item.designerDetails || [];
    // buildStatus: kaynak projeyle AYNI kategori (bkz. gatherCandidateQueries'teki AYNI gerekçe).
    const buildStatus = item.buildStatus === 'concept' ? 'concept' : 'built';
    const lists = await Promise.all(designers.map(d => fetchByDesigner(d.name, d.type, buildStatus)));
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
  // Ağırlıklı yüzde skorlaması (bkz. kullanıcı isteği): Tip Uyum %30 (proje.html'deki "Tip" =
  // category[] alanı kesişim oranı), Tip Grubu Uyum %40 (proje.html'deki "Tip Grubu" = type[] alanı
  // kesişim oranı), Yıl Yakınlığı/Eşleşmesi %30 — üçü toplamda 0-100 aralığında tek bir skor verir.
  // Mimar/ofis, şehir/ülke, puan artık SKORA girmiyor (kullanıcı isteğiyle 3 faktöre daraltıldı) —
  // ama aday havuzunu zenginleştirmek için ilgili /api/projects sorguları hâlâ gatherCandidateQueries
  // içinde kalır (bkz. aşağısı).
  const WEIGHT = { CATEGORY: 30, TYPE: 40, YEAR: 30 };
  const YEAR_FULL_ZERO_WINDOW = 10; // bu yıl farkı VE ÜZERİ -> yıl yakınlığı puanı 0
  const RESULT_COUNT = 15;

  function cardHtml(p) {
    const img = p.images && p.images[0];
    const srcset = img ? cdnSrcset(img, [300, 450, 600]) : '';
    return `<a class="related-card" href="/yapi/${encodeURIComponent(p.slug)}">
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

  // Kural 1 (ZORUNLU, bkz. kullanıcı isteği): aday havuzu kaynak projeyle AYNI "Tür"e (discipline —
  // Mimari/İç Mekan/Peyzaj ve Kentsel Tasarım/Restorasyon) sahip olmayan hiçbir projeyi içeremez.
  // Bu filtre hem sorgu seviyesinde (gatherCandidateQueries'teki discipline param'ı, server
  // passesFilters — bkz. src/routes/project.js#buildFilterGroups) hem istemci tarafında (mount()
  // candidates.set öncesi) uygulanır. Kaynak projede discipline verisi YOKSA (eski/eksik kayıt)
  // filtre uygulanamaz — geriye dönük davranış korunur, bölüm tamamen boş kalmaz.
  function hasSameDiscipline(source, candidate) {
    const sourceDisciplines = source.discipline || [];
    if (!sourceDisciplines.length) return true;
    return (candidate.discipline || []).some(d => sourceDisciplines.includes(d));
  }

  // Kaynağın alan listesindeki KAÇ değerin adayda da bulunduğunun oranı (kaynak temelli, Jaccard
  // değil) — kaynağın tek kategorisi/tipi varsa ve aday da onu taşıyorsa tam ağırlık, kaynağın
  // birden çok değeri varsa kısmi eşleşme kısmi ağırlık alır. Kaynakta alan boşsa (ör. type[] hiç
  // girilmemiş) o faktör 0 katkı yapar — cezalandırma değil, sadece o sinyalin yokluğu.
  function matchFraction(sourceArr, candArr) {
    const source = new Set(sourceArr || []);
    if (!source.size) return 0;
    const cand = new Set(candArr || []);
    let hits = 0;
    source.forEach(v => { if (cand.has(v)) hits++; });
    return hits / source.size;
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
    const categoryFrac = matchFraction(source.category, candidate.category);
    const typeFrac = matchFraction(source.type, candidate.type);
    const yearFrac = yearProximity(source.date, candidate.date);
    return categoryFrac * WEIGHT.CATEGORY + typeFrac * WEIGHT.TYPE + yearFrac * WEIGHT.YEAR;
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

  // Kural 1 — 'discipline' zaten desteklenen bir /api/projects filtre param'ı (bkz.
  // src/routes/project.js#buildFilterGroups 'Tür'), her aday sorgusuna eklenerek havuzun
  // KAYNAĞINDA (client-side hasSameDiscipline() beklemeden) farklı türdeki projeler elenir. Çoklu
  // discipline değeri OR mantığıyla eşleşir (bkz. passesFilters#vals.some).
  function gatherCandidateQueries(item) {
    const queries = [];
    // buildStatus: aday havuzu kaynak projeyle AYNI kategoride kalmalı (bkz. kullanıcı isteği,
    // migrations/0037_project_build_status.sql) — aksi halde bir konsept/öğrenci projesinin
    // "İlgili Yapılar"ı arasına inşa edilmiş eserler (ya da tersi) karışırdı.
    const buildStatusParam = ['buildStatus', item.buildStatus === 'concept' ? 'concept' : 'built'];
    const disciplineParams = (item.discipline || []).map(d => ['discipline', d]);
    const withDiscipline = params => {
      const withBuildStatus = [...params, buildStatusParam];
      return disciplineParams.length ? [...withBuildStatus, ...disciplineParams] : withBuildStatus;
    };
    (item.designerDetails || []).forEach(d => {
      if (d.unregistered) return;
      queries.push(fetchByParams(withDiscipline([[d.type === 'architect' ? 'designer' : 'designerOffice', d.name]]), 12));
    });
    (item.type || []).forEach(t => queries.push(fetchByParams(withDiscipline([['type', t]]), 16)));
    (item.category || []).forEach(c => queries.push(fetchByParams(withDiscipline([['category', c]]), 16)));
    const topLevelLocation = locationParts(item.location);
    const rawCity = (typeof parseLocationFull === 'function') ? parseLocationFull(item.location).city : null;
    if (rawCity) queries.push(fetchByParams(withDiscipline([['location', rawCity]]), 16));
    queries.push(fetchByParams(withDiscipline([['sort', 'rating_desc']]), 16)); // genel havuz — boşluk doldurma
    if (disciplineParams.length) queries.push(fetchByParams([...disciplineParams, buildStatusParam], 24)); // Tür'e özel geniş havuz
    return { queries, topLevelLocation };
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
  // — "Diğer Yapıları" ile ÇAKIŞMAYAN bir seçki için o bölümün slug'larını bekler, ama BU fonksiyonun
  // kendi /api/projects sorguları (gatherCandidateQueries) o bekleyişten BAĞIMSIZ hemen ateşlenir
  // (bkz. gerçek bulgu: eskiden RelatedProjects, ArchitectProjects'in TÜM sayfalarını bitirmesini
  // bekledikten SONRA kendi isteklerine başlıyordu — çok projeli bir mimar için bu, "İlgili Yapılar"ı
  // gereksiz yere geciktiriyordu). Yalnızca dışlama+render adımı excludeSlugsPromise'i bekler.
  async function mount(item, excludeSlugsPromise, ids) {
    const mergedIds = Object.assign({}, DEFAULT_IDS, ids || {});
    const section = document.getElementById(mergedIds.section);

    const { queries } = gatherCandidateQueries(item);
    const listsPromise = Promise.all(queries);
    const [lists, excludeSlugs] = await Promise.all([listsPromise, excludeSlugsPromise]);

    const exclude = new Set(excludeSlugs || []);
    exclude.add(item.slug);

    // Kural 1 KESİN — sorgular zaten discipline'a göre daraltılmıştı (bkz. gatherCandidateQueries),
    // ama burada da kontrol edilir: farklı türdeki hiçbir proje (ör. mimari altında iç mekan) bu
    // filtreyi atlayıp havuza giremez.
    const candidates = new Map();
    lists.flat().forEach(p => { if (!exclude.has(p.slug) && !candidates.has(p.slug) && hasSameDiscipline(item, p)) candidates.set(p.slug, p); });

    const scored = Array.from(candidates.values())
      .map(p => ({ p, score: scoreCandidate(item, p) }))
      .filter(({ score }) => score > -Infinity);

    const merged = weightedSample(scored, RESULT_COUNT);

    if (!merged.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    document.getElementById(mergedIds.grid).innerHTML = merged.map(cardHtml).join('');
  }

  return { mount };
})();
