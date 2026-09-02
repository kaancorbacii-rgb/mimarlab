// MİMARLAB hibrit arama motoru.
//
// Boru hattı (bkz. brief 4):
//   Sorgu -> (deterministik ayrıştırma + gerekirse LLM) -> plan
//        -> [yapılandırılmış D1 filtreleri | tam eşleşme | kavram genişletmesi | varlık ilişkileri]
//        -> aday havuzu -> tekilleştirme -> skorlama -> ilk N
//
// TEMEL İLKE (brief "TEMEL PRENSİP"): LLM burada HİÇBİR sonuç üretmez. Bu dosya yalnızca gerçek
// D1 havuzları (fetchActiveProjectPoolCached / architects / offices / products) üzerinde çalışır.
// LLM'in tek çıktısı bir PLAN'dır (searchPlan) ve o plan da kullanılmadan önce normalizePlan()
// tarafından gerçek alan değerlerine karşı beyaz listeden geçirilir.
//
// SKORLAMA deterministiktir ve her sinyal ayrı ayrı döndürülür (bkz. scoreOf -> signals): aynı
// sorgu her zaman aynı sırayı üretir ve bir sonucun NEDEN üstte olduğu debug modunda okunabilir.
// Bilinçli olarak yüzde/"%87 eşleşme" gibi sahte bir güven değeri üretilmez (bu depoda daha önce
// alınmış bir karar, bkz. computeFacets yorumu).

import { foldTr } from './textMatch.js';
import { expandQuery, textOverlapScore, tokenize, stemTr, editDistance, textTokens,
         termInTokens, matchesTextGroups, DISCIPLINE_VALUES, CATEGORY_VALUES } from './searchConcepts.js';
import ilIlceJs from '../../il-ilce-data.js';
import projectTaxonomyJs from '../../project-taxonomy.js';

const { parseLocationFull, IL_LIST } = ilIlceJs;
const { PROJECT_GROUP_OPTIONS } = projectTaxonomyJs;
export const IL_NAMES = IL_LIST || [];

export const RESULTS_PER_TYPE = 24; // brief 7: "İlk 24 sonucu döndür"

// ---------------------------------------------------------------------------------------------
// PLAN — sorgunun yapılandırılmış hâli. Her alan GERÇEK bir D1 alanına karşılık gelir.
// ---------------------------------------------------------------------------------------------
export function emptyPlan() {
  return {
    entity: null,          // 'project'|'architect'|'office'|'product'|'brand'|null (=hepsi)
    city: null, district: null,
    yearFrom: null, yearTo: null,
    discipline: [], category: [], type: [],
    name: null,            // kişi/firma/marka adı — ilişki aramasının girişi
    keywords: [],          // ham sorgu terimleri (tam eşleşme kanalı)
    expand: [],            // kavram genişletmesi (semantik kanal, skorlama sinyali)
    textGroups: [],        // ZORUNLU metin filtreleri (malzeme/üslup — D1'de kolonu yok)
    residual: [],          // YAPILANDIRILMIŞ bir filtreye dönüşMEYEN terimler (kişi/firma/marka adı adayı)
    concepts: [],          // hangi kavram neden eşleşti (observability)
  };
}

// normalizePlan — HEM LLM çıktısı HEM istemciden gelen previousFilters buradan geçer. Beyaz liste
// dışındaki hiçbir değer plana giremez; "AI'ın uydurduğu bir alan gerçek bir D1 filtresi gibi
// davranmasın" kuralı (brief 2 ve 6) tek noktada burada uygulanır.
export function normalizePlan(raw, rawQuery) {
  const p = emptyPlan();
  const r = (raw && typeof raw === 'object') ? raw : {};
  const ENTITIES = ['project', 'architect', 'office', 'product', 'brand'];
  if (typeof r.entity === 'string' && ENTITIES.includes(r.entity)) p.entity = r.entity;
  if (typeof r.city === 'string' && IL_NAMES.includes(r.city)) p.city = r.city;
  if (typeof r.district === 'string' && r.district.trim()) p.district = r.district.trim().slice(0, 60);
  if (Number.isFinite(r.yearFrom)) p.yearFrom = Math.trunc(r.yearFrom);
  if (Number.isFinite(r.yearTo)) p.yearTo = Math.trunc(r.yearTo);
  if (Array.isArray(r.discipline)) p.discipline = r.discipline.filter(d => DISCIPLINE_VALUES.includes(d));
  if (Array.isArray(r.category)) p.category = r.category.filter(c => CATEGORY_VALUES.includes(c));
  if (Array.isArray(r.type)) p.type = r.type.filter(t => PROJECT_GROUP_OPTIONS.includes(t));
  if (typeof r.name === 'string' && r.name.trim()) p.name = r.name.trim().slice(0, 120);
  if (Array.isArray(r.keywords)) {
    p.keywords = r.keywords.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim().slice(0, 60)).slice(0, 8);
  }
  if (Array.isArray(r.expand)) {
    p.expand = r.expand.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim().slice(0, 60)).slice(0, 24);
  }
  if (Array.isArray(r.textGroups)) {
    p.textGroups = r.textGroups.filter(g => Array.isArray(g) && g.length).slice(0, 6)
      .map(g => g.filter(t => typeof t === 'string').slice(0, 12));
  }
  if (Array.isArray(r.residual)) {
    p.residual = r.residual.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim().slice(0, 60)).slice(0, 8);
  }
  if (Array.isArray(r.concepts)) p.concepts = r.concepts.slice(0, 24);
  if (!p.keywords.length && rawQuery) p.keywords = tokenize(rawQuery).slice(0, 8);
  return p;
}

// ---------------------------------------------------------------------------------------------
// DETERMİNİSTİK AYRIŞTIRICI (brief 3: "Her sorguda gereksiz AI/vector sorgusu çalıştırma")
// LLM'e hiç dokunmadan şehir/ilçe/yıl/tipoloji/disiplin çıkarır. Bunun yakaladığı sinyaller,
// LLM başarısız olsa bile aramanın çalışmaya devam etmesini sağlar (brief 13: fallback).
// ---------------------------------------------------------------------------------------------
const IL_FOLDED = IL_NAMES.map(n => ({ name: n, folded: foldTr(n) }));

export function deterministicParse(query) {
  const plan = emptyPlan();
  const q = String(query || '');
  const folded = ' ' + foldTr(q) + ' ';

  // Şehir — en uzun il adı önce ("Afyonkarahisar" içindeki "Afyon" yanlış eşleşmesin).
  for (const il of [...IL_FOLDED].sort((a, b) => b.folded.length - a.folded.length)) {
    if (folded.includes(' ' + il.folded)) { plan.city = il.name; break; }
  }

  // Yıl ifadeleri. Sıra önemli: "son N yıl" ve aralık, tek yıl kalıbından ÖNCE denenir.
  const now = new Date().getUTCFullYear();
  let m;
  if ((m = /son\s+(\d{1,3})\s*(yıl|yil|sene)/i.exec(q))) {
    plan.yearFrom = now - parseInt(m[1], 10);
    plan.yearTo = now;
  } else if ((m = /(\d{4})\s*[-–—]\s*(\d{4})/.exec(q))) {
    plan.yearFrom = Math.min(+m[1], +m[2]);
    plan.yearTo = Math.max(+m[1], +m[2]);
  } else if ((m = /(\d{4})\s*(sonrası|sonrasi|ve sonrası|den sonra|dan sonra|'den sonra|itibaren)/i.exec(q))) {
    plan.yearFrom = +m[1];
  } else if ((m = /(\d{4})\s*(öncesi|oncesi|den önce|dan önce|'den önce)/i.exec(q))) {
    plan.yearTo = +m[1] - 1;
  } else if ((m = /\b(19|20)(\d{2})\b/.exec(q))) {
    const y = parseInt(m[0], 10);
    plan.yearFrom = y; plan.yearTo = y;
  }

  // Kavram sözlüğü — tipoloji/disiplin/kategori + semantik genişletme.
  const ex = expandQuery(q);
  plan.type = ex.type;
  plan.category = ex.category;
  plan.discipline = ex.discipline;
  plan.expand = ex.expand;
  plan.textGroups = ex.textGroups;
  plan.concepts = ex.matched;

  // Varlık türü niyeti — açık ifadeler ("ürün", "firma", "mimar") varsa daralt.
  if (/\bürün|urun|malzeme\b/i.test(q)) plan.entity = 'product';
  else if (/\bmarka\b/i.test(q)) plan.entity = 'brand';
  else if (/\bfirma|ofis(i|in)?\s*(mimarlık)?\b/i.test(q) && /firma/i.test(q)) plan.entity = 'office';

  plan.keywords = tokenize(q).slice(0, 8);

  // residual — GERÇEK BULGU (üretim verisiyle test): "İstanbul'da ofis projeleri" sorgusu 454 FİRMA
  // döndürüyordu, çünkü "istanbul" terimi hem şehir filtresine dönüşüyor HEM de firma metninde
  // (loc alanı) aranmaya devam ediyordu; loc'unda İstanbul yazan her firma eşleşiyordu. Aynı şekilde
  // "ofis" terimi hem tipoloji filtresi hem serbest metin aramasıydı.
  // Bu yüzden kişi/firma/marka kanalları artık YALNIZCA "residual" terimleri kullanır: yapılandırılmış
  // bir filtreye (şehir) ya da bir kavrama (tipoloji/malzeme) dönüşmüş terimler çıkarılır. Geriye
  // kalan, gerçekten "bu bir isim olabilir" diyebileceğimiz terimlerdir ("Vitra", "Emre Arolat").
  const consumed = new Set();
  if (plan.city) foldTr(plan.city).split(/\s+/).forEach(w => consumed.add(w));
  for (const c of plan.concepts) String(c.via || '').split(/[\s~]+/).forEach(w => w && consumed.add(w));
  for (const t of plan.expand) foldTr(t).split(/\s+/).forEach(w => consumed.add(w));
  plan.residual = plan.keywords.filter(k => {
    const f = foldTr(k);
    if (/^\d+$/.test(f)) return false;
    if (consumed.has(f) || consumed.has(stemTr(f))) return false;
    // Ek almış ya da yanlış yazılmış biçimler de tüketilmiş sayılır: "istanbulda" -> "istanbul",
    // "projleri" -> (stopword değil ama hiçbir şeye eşleşmez). Aksi halde şehir adı hem filtreye
    // dönüşüp hem de firma adı araması olarak kalıyordu (bkz. "İstanbulda ofis projleri" testi).
    for (const c of consumed) {
      if (c.length >= 4 && (f.startsWith(c) || c.startsWith(f))) return false;
      if (c.length >= 5 && f.length >= 5 && editDistance(c, f) <= 1) return false;
    }
    return true;
  });
  return plan;
}

// mergePlans — deterministik taban + LLM deltası. Deterministik ayrıştırıcı bir alanı BULDUYSA o
// kazanır: gerçek bir il adını/yıl kalıbını regex ile bulmak, küçük bir LLM'in aynı alanı tahmin
// etmesinden daha güvenilirdir. LLM yalnızca deterministik katmanın BOŞ bıraktığı alanları doldurur
// (özellikle `name` ve serbest kavramlar).
export function mergePlans(base, delta) {
  if (!delta) return base;
  const pick = (a, b) => (a != null && a !== '' ? a : b);
  const pickArr = (a, b) => (a && a.length ? a : (b || []));
  return {
    entity: pick(base.entity, delta.entity),
    city: pick(base.city, delta.city),
    district: pick(base.district, delta.district),
    yearFrom: base.yearFrom != null ? base.yearFrom : delta.yearFrom,
    yearTo: base.yearTo != null ? base.yearTo : delta.yearTo,
    discipline: pickArr(base.discipline, delta.discipline),
    category: pickArr(base.category, delta.category),
    type: pickArr(base.type, delta.type),
    name: pick(base.name, delta.name),
    keywords: pickArr(base.keywords, delta.keywords),
    expand: [...new Set([...(base.expand || []), ...(delta.expand || [])])],
    textGroups: (base.textGroups && base.textGroups.length) ? base.textGroups : (delta.textGroups || []),
    residual: (base.residual && base.residual.length) ? base.residual : (delta.residual || []),
    concepts: base.concepts || [],
  };
}

// ---------------------------------------------------------------------------------------------
// EŞLEŞTİRME + SKORLAMA
// ---------------------------------------------------------------------------------------------
function yearOf(dateStr, parseYear) { return parseYear ? parseYear(dateStr) : null; }

// Yapılandırılmış filtreler KESİN'dir (brief 4: "D1 kesin filtreleri uygulamalı"): şehir/yıl
// tutmuyorsa kayıt havuza HİÇ girmez. Tipoloji (type/category/discipline) ise KESİN DEĞİL, bir
// SİNYALDİR — çünkü bunlar kavram sözlüğünden gelen bir TAHMİNDİR ve tek bir eksik etiket ("ofis"
// projesi type'ı boş bırakılmış bir kayıt) doğru sonucu tamamen eleyebilirdi.
function passesHardFilters(p, plan, parseYear) {
  if (plan.city) {
    const { city } = parseLocationFull(p.location || '');
    if (city !== plan.city) return false;
  }
  if (plan.district) {
    const loc = foldTr(`${p.location || ''} ${p.locationDetail || ''}`);
    if (!loc.includes(foldTr(plan.district))) return false;
  }
  if (plan.yearFrom != null || plan.yearTo != null) {
    const y = yearOf(p.date, parseYear);
    if (y == null) return false;
    if (plan.yearFrom != null && y < plan.yearFrom) return false;
    if (plan.yearTo != null && y > plan.yearTo) return false;
  }
  return true;
}

// Bir isim sorgudaki kişi/firma adıyla eşleşiyor mu (Türkçe katlamalı, yazım hatası toleranslı).
export function nameMatches(candidate, wanted) {
  if (!wanted) return false;
  const c = foldTr(candidate || ''), w = foldTr(wanted);
  if (!c || !w) return false;
  if (c.includes(w) || w.includes(c)) return true;
  // Kelime bazlı: "Cengiz Bektas" ~ "Bektaş Cengiz" ve tek harf hatası.
  const cw = c.split(/\s+/).filter(Boolean), ww = w.split(/\s+/).filter(Boolean);
  if (!ww.length) return false;
  return ww.every(x => cw.some(y => y === x || (x.length >= 5 && y.length >= 5 && editDistance(x, y) <= 1)));
}

// Sorgu terimlerinin metinle örtüşmesi — kök ve yazım hatası toleranslı.
// Kelime sınırı tabanlı (bkz. searchConcepts.js#termInTokens'taki gerçek bulgu notu).
function keywordScore(text, keywords) {
  if (!keywords.length) return 0;
  const hay = foldTr(text || '');
  if (!hay) return 0;
  const tokens = textTokens(text);
  let hit = 0;
  for (const k of keywords) if (termInTokens(k, tokens, hay)) hit++;
  return hit / keywords.length;
}

// scoreOf — brief 7'deki sinyaller. Ağırlıklar sabit ve okunabilir; sıralama deterministiktir.
function scoreOf(signals) {
  return (
    signals.exact * 5.0 +          // tam eşleşme (başlık/isim)
    signals.structured * 3.0 +     // yapılandırılmış filtre isabeti (tipoloji/şehir/yıl)
    signals.semantic * 2.0 +       // kavram genişletmesi isabeti
    signals.keyword * 1.5 +        // ham terim örtüşmesi
    signals.relation * 2.5 +       // varlık ilişkisi üzerinden gelmiş
    signals.completeness * 0.5     // veri doluluğu (görsel/açıklama/künye)
  );
}

function completenessOf(p) {
  let s = 0;
  if (p.images && p.images.length) s += 0.4; else if (p.image) s += 0.4;
  if (p.description && p.description.length > 80) s += 0.3;
  if ((p.designer && p.designer.length) || (p.officeNames && p.officeNames.length) || p.brand) s += 0.3;
  return Math.min(1, s);
}

// ---------------------------------------------------------------------------------------------
// PROJE KANALI
// relatedSlugs: ilişki kanalından gelen proje slug'ları (ör. bir markanın ürünlerinin kullanıldığı
// projeler) — bunlar metin/tipoloji hiç tutmasa bile havuza girer ve relation sinyali alır.
// ---------------------------------------------------------------------------------------------
export function searchProjectPool(pool, plan, parseYear, relatedSlugs) {
  const related = relatedSlugs || new Set();
  const wantsAnyText = plan.keywords.length || plan.expand.length || plan.name;
  const out = [];

  for (const p of pool) {
    if (!passesHardFilters(p, plan, parseYear)) continue;

    const isRelated = related.has(p.slug);
    const titleText = p.title || '';
    const bodyText = `${p.title || ''} ${p.description || ''} ${(p.type || []).join(' ')} ${(p.category || []).join(' ')} ${(p.discipline || []).join(' ')} ${p.location || ''} ${p.locationDetail || ''}`;
    const creditText = [...(p.designer || []), ...(p.officeNames || [])].join(' ');

    // Yapılandırılmış sinyal: kavramdan gelen tipoloji/kategori/disiplin gerçekten tutuyor mu?
    let structuredHits = 0, structuredWanted = 0;
    if (plan.type.length) { structuredWanted++; if (plan.type.some(t => (p.type || []).includes(t))) structuredHits++; }
    if (plan.category.length) { structuredWanted++; if (plan.category.some(c => (p.category || []).includes(c))) structuredHits++; }
    if (plan.discipline.length) { structuredWanted++; if (plan.discipline.some(d => (p.discipline || []).includes(d))) structuredHits++; }
    const structured = structuredWanted ? structuredHits / structuredWanted : 0;

    // İsim hem KÜNYEDE hem METİNDE aranır. Yalnızca künyeye bakmak, marka/ürün adı içeren
    // sorgularda ("Vitra") o markadan söz eden projeleri tamamen kaçırıyordu; künye zaten yalnızca
    // mimar/firma taşır, marka adı orada hiç geçmez.
    const nameHit = plan.name
      ? ((nameMatches(creditText, plan.name) || foldTr(bodyText).includes(foldTr(plan.name))) ? 1 : 0)
      : 0;
    const semantic = textOverlapScore(bodyText, plan.expand);
    const keyword = keywordScore(bodyText, plan.keywords);
    const exact = plan.keywords.length && foldTr(titleText).includes(foldTr(plan.keywords.join(' '))) ? 1
      : (nameHit ? 1 : (keywordScore(titleText, plan.keywords) >= 0.999 ? 1 : 0));

    // ---- KABUL KURALI ----
    // GERÇEK BULGU (1698 satırlık üretim havuzuyla test): "herhangi bir zayıf sinyal varsa kabul et"
    // kuralı aramayı işe yaramaz hâle getiriyordu — "Ofis / İş Merkezi" 1660, "taş cepheli konutlar"
    // 1620 sonuç döndürüyordu. Kabul artık kademeli:

    // 1) ZORUNLU metin filtreleri (malzeme/üslup). Bunların D1'de kolonu yok, bu yüzden bir SİNYAL
    //    değil ELEME ölçütüdür: "mermer kullanılan oteller" -> otel tipolojisi TEK BAŞINA yetmez.
    if (plan.textGroups.length && !isRelated && !matchesTextGroups(bodyText, plan.textGroups)) continue;

    // 2) İsim aranıyorsa tutmalı (ilişki kanalından gelmediyse).
    if (plan.name && !nameHit && !isRelated) continue;

    // 3) Sorgu bir TİPOLOJİ ima ediyorsa (kavram sözlüğü type/category/discipline üretti), kaydın ya
    //    o tipolojide olması ya da BAŞLIĞININ o kavramı içermesi gerekir. Başlık istisnası bilinçli:
    //    "X Ofisi" adlı ama `type` alanı boş bırakılmış kayıtlar (veri eksikliği) elenmesin.
    const typologyWanted = plan.type.length || plan.category.length || plan.discipline.length;
    if (typologyWanted && !isRelated && !nameHit) {
      const titleTokens = textTokens(titleText);
      const titleHay = foldTr(titleText);
      const titleHasConcept = plan.expand.some(t => termInTokens(t, titleTokens, titleHay));
      // GERÇEK BULGU: burada eskiden "structuredHits > 0" yeterliydi, ama structuredHits KATEGORİ
      // eşleşmesini de sayıyordu. "ofis" kavramı category=['Ticari'] de ürettiğinden, Ticari olan
      // HER Kafe/Restoran ve Mağaza projesi "ofis" sorgusuna sızıyordu (facet: Kafe/Restoran 87,
      // Mağaza 84). Kategori tipolojiden çok daha kaba bir kova olduğu için onun yerine GEÇEMEZ:
      // plan bir TİP istiyorsa eşleşmenin de tip düzeyinde olması gerekir.
      const typeOk = plan.type.length
        ? plan.type.some(t => (p.type || []).includes(t))
        : (plan.category.some(c => (p.category || []).includes(c))
           || plan.discipline.some(d => (p.discipline || []).includes(d)));
      if (!typeOk && !titleHasConcept) continue;
    }

    // 4) Tipoloji de isim de yoksa (ör. "sankai", "mermer") ham terimlerin ÇOĞU tutmalı — tek bir
    //    terimin rastgele eşleşmesi yetmez.
    if (!typologyWanted && !plan.name && !isRelated && plan.textGroups.length === 0) {
      if (!wantsAnyText) { /* filtre-yalnız sorgu: sert filtreler zaten eledi */ }
      else if (keyword < 0.6 && semantic < 0.6 && !exact) continue;
    }

    const signals = {
      exact, structured, semantic, keyword,
      relation: isRelated ? 1 : 0,
      completeness: completenessOf(p),
    };
    out.push({ item: p, score: scoreOf(signals), signals });
  }

  out.sort((a, b) => (b.score - a.score) || String(a.item.slug).localeCompare(String(b.item.slug)));
  return out;
}

// ---------------------------------------------------------------------------------------------
// KİŞİ / FİRMA / ÜRÜN / MARKA KANALLARI
// ---------------------------------------------------------------------------------------------
// genericSearch — kişi/firma/marka/ürün kanalı.
// terms olarak plan.keywords DEĞİL plan.residual kullanılır (bkz. deterministicParse#residual
// gerçek bulgu notu). allowSemantic yalnızca ÜRÜN kanalında açıktır: malzeme/üslup terimlerinin
// doğal evi ürün kataloğudur ("mermer" -> mermer ürünleri anlamlı), oysa aynı terimle bütün
// firmaları döndürmek gürültüdür.
function genericSearch(pool, plan, opts) {
  const textOf = opts.textOf, nameOf = opts.nameOf;
  const terms = (plan.residual && plan.residual.length) ? plan.residual : [];
  const expand = opts.allowSemantic ? plan.expand : [];
  const wanted = plan.name;
  const out = [];
  // Ne bir isim ne de kalan bir terim var (ör. "İstanbul'da ofis projeleri") — bu sorgu bu kanalı
  // İSTEMİYOR. Yalnızca semantik izinli kanallar (ürün) devam edebilir.
  if (!wanted && !terms.length && !expand.length && !(opts.allowSemantic && plan.textGroups.length)) return out;
  for (const it of pool) {
    const nm = nameOf(it);
    const body = textOf(it);
    // identity — "ad" sayılan metin. Ürünlerde MARKA da kimliğin parçasıdır: "Vitra" sorgusunda
    // ürün başlıkları markayı içermez ("Lavabo"), marka alanı içerir; yalnızca title'a bakmak
    // 17 Vitra ürününü tamamen kaçırıyordu (gerçek bulgu, üretim verisiyle test).
    const identity = opts.identityOf ? opts.identityOf(it) : nm;
    const nameHit = wanted ? (nameMatches(identity, wanted) ? 1 : 0) : 0;
    const exactName = terms.length && nameMatches(identity, terms.join(' ')) ? 1 : 0;
    // Terimler KİMLİĞE karşı aranır; adres/kategori metni tek başına kabul için yeterli DEĞİLDİR.
    const nameScore = keywordScore(identity, terms);
    const keyword = keywordScore(body, terms);
    // Malzeme/üslup grupları ürün kanalında bir ELEME değil bir EŞLEŞME ölçütüdür: "mermer"
    // sorgusunda mermer ürünleri dönmeli.
    const groupHit = (opts.allowSemantic && plan.textGroups.length && matchesTextGroups(body, plan.textGroups)) ? 1 : 0;
    const semantic = Math.max(textOverlapScore(body, expand), groupHit);
    if (!nameHit && !exactName && nameScore < 0.6 && !groupHit && semantic < 0.5) continue;
    if (wanted && !nameHit && !exactName) continue;
    const signals = {
      exact: Math.max(nameHit, exactName),
      structured: opts.structured ? opts.structured(it, plan) : 0,
      semantic, keyword, relation: 0,
      completeness: completenessOf(it),
    };
    out.push({ item: it, score: scoreOf(signals), signals });
  }
  out.sort((a, b) => (b.score - a.score) || String(a.item.slug || '').localeCompare(String(b.item.slug || '')));
  return out;
}

export function searchArchitects(pool, plan) {
  return genericSearch(pool, plan, {
    nameOf: a => a.name,
    textOf: a => `${a.name || ''} ${a.office || ''} ${a.positionRaw || ''} ${(a.professions || []).join(' ')}`,
  });
}

export function searchOffices(pool, plan) {
  return genericSearch(pool, plan, {
    nameOf: o => o.name,
    textOf: o => `${o.name || ''} ${o.loc || ''} ${o.cats || ''}`,
    // Firma/marka için şehir sinyali: loc alanı serbest metindir, bu yüzden SERT filtre değil
    // (bkz. passesHardFilters yalnızca projelerde) — yanlış biçimde yazılmış bir loc yüzünden
    // doğru firmayı tamamen elemek, sıralamada geriye almaktan daha kötü olurdu.
    structured: (o, plan2) => (plan2.city && foldTr(o.loc || '').includes(foldTr(plan2.city))) ? 1 : 0,
  });
}

export function searchProducts(pool, plan) {
  return genericSearch(pool, plan, {
    nameOf: p => p.title,
    identityOf: p => `${p.title || ''} ${p.brand || ''}`,
    textOf: p => `${p.title || ''} ${p.brand || ''} ${p.category || ''} ${p.group || ''} ${(p.designers || []).join(' ')}`,
    allowSemantic: true,
  });
}

// ---------------------------------------------------------------------------------------------
// VARLIK GRAFI (brief 10)
// Tek bir D1 sorgusuyla proje<->ürün kenarını iki yönde de çözer.
//   projectSlugs -> o projelerde kullanılan ürünler
//   productSlugs/brandName -> o ürünlerin kullanıldığı projeler
// ---------------------------------------------------------------------------------------------
export async function relatedProductsForProjects(env, projectSlugs) {
  if (!projectSlugs.length) return [];
  const ph = projectSlugs.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT pr.slug, pr.title, pr.brand_name_raw AS brand, pr.category, pr.images
       FROM project_products pp
       JOIN projects p ON p.id = pp.project_id
       JOIN products pr ON pr.id = pp.product_id
      WHERE p.slug IN (${ph}) AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL
      LIMIT 200`
  ).bind(...projectSlugs).all();
  return results;
}

export async function relatedProjectsForBrandOrProduct(env, { brandName, productSlugs }) {
  const clauses = [], binds = [];
  if (brandName) {
    clauses.push(`(pr.brand_name_raw = ? COLLATE NOCASE OR o.name = ? COLLATE NOCASE)`);
    binds.push(brandName, brandName);
  }
  if (productSlugs && productSlugs.length) {
    clauses.push(`pr.slug IN (${productSlugs.map(() => '?').join(',')})`);
    binds.push(...productSlugs);
  }
  if (!clauses.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT p.slug
       FROM project_products pp
       JOIN products pr ON pr.id = pp.product_id
       LEFT JOIN offices o ON o.id = pr.brand_office_id
       JOIN projects p ON p.id = pp.project_id
      WHERE (${clauses.join(' OR ')})
        AND p.deleted_at IS NULL AND p.hidden_at IS NULL
        AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL
      LIMIT 300`
  ).bind(...binds).all();
  return results.map(r => r.slug);
}

// ---------------------------------------------------------------------------------------------
// FACET'LER — yalnızca GERÇEK sayımlar (yüzde/skor yok).
// ---------------------------------------------------------------------------------------------
export function computeFacets(items, parseYear) {
  const cities = new Map(), categories = new Map(), disciplines = new Map(), types = new Map();
  let minYear = null, maxYear = null;
  for (const p of items) {
    const { city } = parseLocationFull(p.location || '');
    if (city) cities.set(city, (cities.get(city) || 0) + 1);
    for (const c of (p.category || [])) categories.set(c, (categories.get(c) || 0) + 1);
    for (const d of (p.discipline || [])) disciplines.set(d, (disciplines.get(d) || 0) + 1);
    for (const t of (p.type || [])) types.set(t, (types.get(t) || 0) + 1);
    const y = yearOf(p.date, parseYear);
    if (y != null) {
      if (minYear == null || y < minYear) minYear = y;
      if (maxYear == null || y > maxYear) maxYear = y;
    }
  }
  const topN = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([value, count]) => ({ value, count }));
  return {
    cities: topN(cities, 6),
    categories: topN(categories, 5),
    discipline: topN(disciplines, 4),
    types: topN(types, 6),
    yearRange: (minYear != null && maxYear != null) ? { from: minYear, to: maxYear } : null,
  };
}

// Bölge -> il eşlemesi. "Anadolu yakasında olanları göster" gibi bağlamsal daraltmalar (brief 11)
// il bazında ifade edilemez; İstanbul özelinde ilçe listesiyle çözülür.
export const ISTANBUL_ANATOLIAN = ['Kadıköy', 'Üsküdar', 'Ataşehir', 'Maltepe', 'Kartal', 'Pendik',
  'Tuzla', 'Sancaktepe', 'Sultanbeyli', 'Çekmeköy', 'Ümraniye', 'Beykoz', 'Şile', 'Adalar'];
export const ISTANBUL_EUROPEAN = ['Beşiktaş', 'Şişli', 'Beyoğlu', 'Fatih', 'Bakırköy', 'Beylikdüzü',
  'Esenyurt', 'Başakşehir', 'Bahçelievler', 'Zeytinburnu', 'Kağıthane', 'Sarıyer', 'Eyüpsultan',
  'Güngören', 'Bağcılar', 'Küçükçekmece', 'Büyükçekmece', 'Avcılar', 'Esenler', 'Sultangazi',
  'Gaziosmanpaşa', 'Arnavutköy', 'Çatalca', 'Silivri', 'Bayrampaşa'];

export function sideOfIstanbul(query) {
  const f = foldTr(query || '');
  if (f.includes('anadolu yaka')) return ISTANBUL_ANATOLIAN;
  if (f.includes('avrupa yaka')) return ISTANBUL_EUROPEAN;
  return null;
}
