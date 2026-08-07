// ArchitectProjects ("Mimarın/Firmanın Diğer Projeleri") + RelatedProjects ("İlgili Projeler").
// proje-detay.html'in eski istemci-taraf tam-dizi taramasının (sameDesigner/relatedScore, statik
// projects[] üzerinde) yerini alır — artık proje.html'de bellekte TÜM projelerin bir kopyası
// olmadığından (Faz 3 sayfalama migrasyonu, bkz. proje.html dosya başı yorumu) her ikisi de mevcut
// /api/projects liste ucunu (bkz. src/routes/project.js#handleProjectListRoute) filtre param'larıyla
// çağırır — yeni bir backend ucu GEREKMEZ:
//   - ArchitectProjects: item.designerDetails'teki her isim zaten 'architect'/'office' olarak
//     sınıflandırılmış (bkz. src/routes/project.js#fetchDesignerDetails) — bu yüzden proje-detay.html'in
//     aksine hangi filtre grubuna (designer/designerOffice) gideceğini tahmin etmeye GEREK YOK.
//   - RelatedProjects: puan bazlı deterministik skorlama (bkz. kullanıcı isteği ve RelatedProjects
//     içindeki SCORE sabiti) — mimar/tip/kategori/şehir/ülke/yıl/puan filtreleriyle geniş bir aday
//     havuzu toplanır, ardından her adayın puanı kaynak projeyle TÜM alanları karşılaştırılarak
//     hesaplanır (hangi sorgunun adayı getirdiğinden bağımsız).
const ArchitectProjects = (function () {
  const DEFAULT_IDS = { section: 'pm-same-designer-section', grid: 'pm-same-designer-grid' };

  function cardHtml(p) {
    const img = p.images && p.images[0];
    const srcset = img ? cdnSrcset(img, [300, 450, 600]) : '';
    return `<a class="related-card" href="/projeler/${encodeURIComponent(p.slug)}">
      ${img ? `<img src="${escapeAttr(cdnImg(img, 450))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="300px"` : ''} alt="${escapeAttr(p.title)}" loading="eager" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(p.title)}">${escapeHtml(initials(p.title))}</div>`}
      <div class="related-card-title">${escapeHtml(p.title)}</div>
    </a>`;
  }

  // /api/projects sayfalanmış bir uç (bkz. src/routes/project.js#handleProjectListRoute, limit
  // sunucuda 96'ya sabitlenir) — tek bir limit=8 isteği yerine Mimar Sinan gibi çok projesi olan
  // mimar/firmaların TÜM projelerini kaçırmamak için (bkz. kullanıcı isteği: "eksiksiz listelenmesin")
  // dönen totalPages tükenene kadar sayfa sayfa (96'şar) çekilip birleştirilir.
  async function fetchByDesigner(name, type) {
    const key = type === 'architect' ? 'designer' : 'designerOffice';
    const items = [];
    let page = 1;
    let totalPages = 1;
    try {
      do {
        const res = await fetch(`/api/projects?${key}=${encodeURIComponent(name)}&limit=96&page=${page}`);
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
    const lists = await Promise.all(designers.map(d => fetchByDesigner(d.name, d.type)));
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
  // Öncelik sırası (bkz. kullanıcı isteği): 1) kategori 2) mimar/ofis 3) şehir/ülke 4) etiket
  // (veri modelinde ayrı bir "tags" alanı yok — bkz. grep sonucu — en yakın karşılığı "type").
  // YEAR/RATING düşük ağırlıklı ikincil sinyaller olarak kalır.
  const SCORE = { CATEGORY: 90, ARCHITECT: 70, CITY: 45, COUNTRY: 35, TYPE: 20, YEAR: 10, RATING: 8 };
  const YEAR_WINDOW = 5;
  const RATING_THRESHOLD = 4;
  const RESULT_COUNT = 12;

  function cardHtml(p) {
    const img = p.images && p.images[0];
    const srcset = img ? cdnSrcset(img, [300, 450, 600]) : '';
    return `<a class="related-card" href="/projeler/${encodeURIComponent(p.slug)}">
      ${img ? `<img src="${escapeAttr(cdnImg(img, 450))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="300px"` : ''} alt="${escapeAttr(p.title)}" loading="eager" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(p.title)}">${escapeHtml(initials(p.title))}</div>`}
      <div class="related-card-title">${escapeHtml(p.title)}</div>
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

  function scoreCandidate(source, candidate) {
    if (candidate.slug === source.slug) return -Infinity;
    let score = 0;

    const sourceDesigners = new Set((source.designerDetails || []).map(d => d.name));
    if ((candidate.designer || []).some(name => sourceDesigners.has(name))) score += SCORE.ARCHITECT;

    const sourceTypes = new Set(source.type || []);
    if ((candidate.type || []).some(t => sourceTypes.has(t))) score += SCORE.TYPE;

    const sourceCategories = new Set(source.category || []);
    if ((candidate.category || []).some(c => sourceCategories.has(c))) score += SCORE.CATEGORY;

    const sourceLoc = locationParts(source.location);
    const candLoc = locationParts(candidate.location);
    if (sourceLoc.city && sourceLoc.city === candLoc.city) score += SCORE.CITY;
    if (sourceLoc.country && sourceLoc.country === candLoc.country) score += SCORE.COUNTRY;

    const sourceYear = extractYear(source.date);
    const candYear = extractYear(candidate.date);
    if (sourceYear != null && candYear != null && Math.abs(sourceYear - candYear) <= YEAR_WINDOW) score += SCORE.YEAR;

    if ((candidate.rating || 0) >= RATING_THRESHOLD) score += SCORE.RATING;

    return score;
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

  function gatherCandidateQueries(item) {
    const queries = [];
    (item.designerDetails || []).forEach(d => {
      if (d.unregistered) return;
      queries.push(fetchByParams([[d.type === 'architect' ? 'designer' : 'designerOffice', d.name]], 12));
    });
    (item.type || []).forEach(t => queries.push(fetchByParams([['type', t]], 16)));
    (item.category || []).forEach(c => queries.push(fetchByParams([['category', c]], 16)));
    const topLevelLocation = locationParts(item.location);
    const rawCity = (typeof parseLocationFull === 'function') ? parseLocationFull(item.location).city : null;
    if (rawCity) queries.push(fetchByParams([['location', rawCity]], 16));
    queries.push(fetchByParams([['sort', 'rating_desc']], 16)); // genel havuz — boşluk doldurma + puan sinyali
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
  // — "Diğer Projeleri" ile ÇAKIŞMAYAN bir seçki için o bölümün slug'larını bekler, ama BU fonksiyonun
  // kendi /api/projects sorguları (gatherCandidateQueries) o bekleyişten BAĞIMSIZ hemen ateşlenir
  // (bkz. gerçek bulgu: eskiden RelatedProjects, ArchitectProjects'in TÜM sayfalarını bitirmesini
  // bekledikten SONRA kendi isteklerine başlıyordu — çok projeli bir mimar için bu, "İlgili Projeler"i
  // gereksiz yere geciktiriyordu). Yalnızca dışlama+render adımı excludeSlugsPromise'i bekler.
  async function mount(item, excludeSlugsPromise, ids) {
    const mergedIds = Object.assign({}, DEFAULT_IDS, ids || {});
    const section = document.getElementById(mergedIds.section);

    const { queries } = gatherCandidateQueries(item);
    const listsPromise = Promise.all(queries);
    const [lists, excludeSlugs] = await Promise.all([listsPromise, excludeSlugsPromise]);

    const exclude = new Set(excludeSlugs || []);
    exclude.add(item.slug);

    const candidates = new Map();
    lists.flat().forEach(p => { if (!exclude.has(p.slug) && !candidates.has(p.slug)) candidates.set(p.slug, p); });

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
