// ArchitectProjects ("Mimarın/Firmanın Diğer Projeleri") + RelatedProjects ("İlgili Projeler").
// proje-detay.html'in eski istemci-taraf tam-dizi taramasının (sameDesigner/relatedScore, statik
// projects[] üzerinde) yerini alır — artık proje.html'de bellekte TÜM projelerin bir kopyası
// olmadığından (Faz 3 sayfalama migrasyonu, bkz. proje.html dosya başı yorumu) her ikisi de mevcut
// /api/projects liste ucunu (bkz. src/routes/project.js#handleProjectListRoute) filtre param'larıyla
// çağırır — yeni bir backend ucu GEREKMEZ:
//   - ArchitectProjects: item.designerDetails'teki her isim zaten 'architect'/'office' olarak
//     sınıflandırılmış (bkz. src/routes/project.js#fetchDesignerDetails) — bu yüzden proje-detay.html'in
//     aksine hangi filtre grubuna (designer/designerOffice) gideceğini tahmin etmeye GEREK YOK.
//   - RelatedProjects: eski relatedScore (3=Tür+Tip, 2=Tip, 1=Tür) sıralaması, aynı isimli iki
//     filtre grubunu (type/category) AYNI istekte birlikte (score 3), sonra ayrı ayrı (score 2/1)
//     göndermenin doğal sonucudur — handleProjectFiltersRoute/handleProjectListRoute farklı grupları
//     AND, aynı grup içindeki değerleri OR'lar (bkz. o dosyadaki passesFilters), yani
//     category+type birlikte istek = "sameType && sameCategory" ile MATEMATİKSEL OLARAK ÖZDEŞ.
const ArchitectProjects = (function () {
  const DEFAULT_IDS = { section: 'pm-same-designer-section', grid: 'pm-same-designer-grid' };

  function cardHtml(p) {
    const img = p.images && p.images[0];
    return `<a class="related-card" href="/projeler/${encodeURIComponent(p.slug)}">
      ${img ? `<img src="${escapeAttr(img)}" alt="${escapeAttr(p.title)}" loading="eager" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(p.title)}">${escapeHtml(initials(p.title))}</div>`}
      <div class="related-card-title">${escapeHtml(p.title)}</div>
    </a>`;
  }

  async function fetchByDesigner(name, type) {
    const key = type === 'architect' ? 'designer' : 'designerOffice';
    try {
      const res = await fetch(`/api/projects?${key}=${encodeURIComponent(name)}&limit=8`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.items || [];
    } catch { return []; }
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
    document.getElementById(mergedIds.grid).innerHTML = merged.slice(0, 8).map(cardHtml).join('');
    return { slugs: new Set(merged.map(p => p.slug)) };
  }

  return { mount };
})();

const RelatedProjects = (function () {
  const DEFAULT_IDS = { section: 'pm-related-section', grid: 'pm-related-grid' };

  function cardHtml(p) {
    const img = p.images && p.images[0];
    return `<a class="related-card" href="/projeler/${encodeURIComponent(p.slug)}">
      ${img ? `<img src="${escapeAttr(img)}" alt="${escapeAttr(p.title)}" loading="eager" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(p.title)}">${escapeHtml(initials(p.title))}</div>`}
      <div class="related-card-title">${escapeHtml(p.title)}</div>
    </a>`;
  }

  function buildQuery(item, { category, type }) {
    const params = new URLSearchParams();
    if (category) (item.category || []).forEach(c => params.append('category', c));
    if (type) (item.type || []).forEach(t => params.append('type', t));
    params.set('limit', '12');
    return params.toString();
  }

  async function fetchScored(item, opts) {
    const qs = buildQuery(item, opts);
    try {
      const res = await fetch(`/api/projects?${qs}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.items || [];
    } catch { return []; }
  }

  async function mount(item, excludeSlugs, ids) {
    const mergedIds = Object.assign({}, DEFAULT_IDS, ids || {});
    const section = document.getElementById(mergedIds.section);
    const exclude = new Set(excludeSlugs || []);
    exclude.add(item.slug);

    const hasCategory = !!(item.category && item.category.length);
    const hasType = !!(item.type && item.type.length);
    const [scoreThree, scoreTwo, scoreOne] = await Promise.all([
      (hasCategory && hasType) ? fetchScored(item, { category: true, type: true }) : Promise.resolve([]),
      hasType ? fetchScored(item, { type: true }) : Promise.resolve([]),
      hasCategory ? fetchScored(item, { category: true }) : Promise.resolve([]),
    ]);

    const seen = new Set(exclude);
    const merged = [];
    [scoreThree, scoreTwo, scoreOne].forEach(list => {
      list.forEach(p => { if (!seen.has(p.slug)) { seen.add(p.slug); merged.push(p); } });
    });

    if (!merged.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    document.getElementById(mergedIds.grid).innerHTML = merged.slice(0, 6).map(cardHtml).join('');
  }

  return { mount };
})();
