// MİMARLAB arama — Türkçe mimarlık kavram sözlüğü ve sorgu normalizasyonu.
//
// NEDEN VECTORIZE DEĞİL: brief "semantic search" istiyor ve ilk akla gelen çözüm Cloudflare
// Vectorize. Vectorize Workers ÜCRETLİ planına bağlıdır; kullanıcı ücretli bir Cloudflare servisini
// açmayı açıkça yasakladı (ve bu depoda daha önce "Images Transformed" binding'i beklenmedik ~$16/ay
// faturaya yol açtığı için kaldırılmıştı, bkz. wrangler.jsonc). Bu yüzden anlamsal genişletme
// BURADA, deterministik ve ücretsiz bir eş anlamlılar/kavram haritasıyla yapılır. Alan dardır
// (Türkçe mimarlık terminolojisi), yani elle küratörlü bir sözlük bu alanda embedding'e yakın
// pratik fayda verir ve embedding'in aksine SEBEBİ AÇIKLANABİLİR (bkz. searchEngine.js debug
// çıktısı). Vectorize'a geçiş yolu açık bırakıldı: expandQuery()'nin çıktısı zaten
// "kavram -> alan değerleri + metin terimleri" biçiminde, bir vektör kanalı bu çıktının yanına
// EK bir aday kaynağı olarak eklenebilir.
//
// EN ÖNEMLİ KURAL: bu dosya ASLA yeni bir D1 alanı UYDURMAZ. Bir kavram yalnızca GERÇEKTEN var olan
// bir sütun değerine (projects.discipline / category / type) eşlenir; eşlenemeyenler yalnızca
// METİN genişletmesi olarak (title/description üzerinde aranmak üzere) döner. "mermer", "taş cephe"
// gibi malzeme terimlerinin D1'de bir kolonu YOKTUR — bu yüzden bunlar bilinçli olarak yalnızca
// metin terimidir, sahte bir `material` filtresi üretilmez.

import { foldTr } from './textMatch.js';

// ---------------------------------------------------------------------------------------------
// Gerçek taksonomi değerleri (project-taxonomy.js + src/routes/ai.js ile birebir aynı olmalı).
// ---------------------------------------------------------------------------------------------
export const DISCIPLINE_VALUES = ['Mimari', 'İç Mekan', 'Peyzaj ve Kentsel Tasarım', 'Restorasyon'];
export const CATEGORY_VALUES = ['Konaklama', 'Ticari', 'Kültürel', 'Dini', 'Eğitim', 'Kamu', 'Altyapı'];

// ---------------------------------------------------------------------------------------------
// KAVRAM SÖZLÜĞÜ
// Her giriş: { terms: kullanıcının yazabileceği ifadeler, type/category/discipline: GERÇEK alan
// değerleri, expand: metin araması için ek terimler }.
// terms foldTr'lenmiş karşılaştırılır, yani "İş Merkezi" ~ "is merkezi" ~ "IS MERKEZI".
// ---------------------------------------------------------------------------------------------
const CONCEPTS = [
  // --- Yapı tipolojileri (projects.type = PROJECT_GROUP_OPTIONS) ---
  { terms: ['ofis', 'ofisler', 'iş merkezi', 'is merkezi', 'plaza', 'office', 'çalışma binası', 'business center'],
    type: ['Ofis / İş Merkezi'], category: ['Ticari'], expand: ['ofis', 'iş merkezi', 'plaza', 'office'] },
  { terms: ['konut', 'konutlar', 'ev', 'evler', 'villa', 'villalar', 'residence', 'rezidans', 'yalı', 'apartman', 'daire'],
    type: ['Konut', 'Toplu Konut'], expand: ['konut', 'ev', 'villa', 'rezidans', 'apartman'] },
  { terms: ['toplu konut', 'siteler', 'housing', 'mass housing'],
    type: ['Toplu Konut'], expand: ['toplu konut', 'site'] },
  { terms: ['otel', 'oteller', 'hotel', 'konaklama', 'butik otel', 'resort', 'tatil köyü'],
    type: ['Turizm / Otel'], category: ['Konaklama'], expand: ['otel', 'hotel', 'resort', 'konaklama'] },
  { terms: ['avm', 'alışveriş merkezi', 'alisveris merkezi', 'shopping mall', 'mall'],
    type: ['AVM'], category: ['Ticari'], expand: ['avm', 'alışveriş merkezi'] },
  { terms: ['mağaza', 'magaza', 'dükkan', 'showroom', 'perakende', 'store', 'retail'],
    type: ['Mağaza / Ticaret'], category: ['Ticari'], expand: ['mağaza', 'showroom', 'perakende'] },
  { terms: ['kafe', 'restoran', 'lokanta', 'cafe', 'restaurant', 'bar', 'yeme içme'],
    type: ['Kafe / Restoran'], category: ['Ticari'], expand: ['kafe', 'restoran', 'lokanta'] },
  { terms: ['banka', 'şube', 'bank'], type: ['Banka'], category: ['Ticari'], expand: ['banka'] },
  { terms: ['okul', 'okullar', 'ilkokul', 'lise', 'anaokulu', 'school', 'eğitim yapısı', 'eğitim yapıları'],
    type: ['Okul'], category: ['Eğitim'], expand: ['okul', 'lise', 'anaokulu'] },
  { terms: ['üniversite', 'universite', 'kampüs', 'kampus', 'yükseköğretim', 'fakülte', 'campus'],
    type: ['Yükseköğretim'], category: ['Eğitim'], expand: ['üniversite', 'kampüs', 'fakülte'] },
  { terms: ['hastane', 'sağlık', 'saglik', 'klinik', 'poliklinik', 'hospital', 'sağlık yapısı'],
    type: ['Sağlık'], expand: ['hastane', 'klinik', 'sağlık'] },
  { terms: ['müze', 'muze', 'museum'], type: ['Müze'], category: ['Kültürel'], expand: ['müze', 'museum'] },
  { terms: ['kültür merkezi', 'kultur merkezi', 'kültür yapısı', 'kültür yapıları', 'kulturel yapi', 'kültürel yapılar'],
    type: ['Kültür Merkezi', 'Müze', 'Kütüphane', 'Sergi Alanı', 'Performans / Etkinlik'], category: ['Kültürel'],
    expand: ['kültür merkezi', 'kültür', 'sanat merkezi'] },
  { terms: ['kütüphane', 'kutuphane', 'library'], type: ['Kütüphane'], category: ['Kültürel'], expand: ['kütüphane'] },
  { terms: ['sergi', 'galeri', 'sergi alanı', 'gallery'], type: ['Sergi Alanı'], category: ['Kültürel'], expand: ['sergi', 'galeri'] },
  { terms: ['tiyatro', 'opera', 'konser salonu', 'performans', 'sahne'],
    type: ['Performans / Etkinlik'], category: ['Kültürel'], expand: ['tiyatro', 'opera', 'konser'] },
  { terms: ['cami', 'camiler', 'mescit', 'mosque'], type: ['Cami'], category: ['Dini'], expand: ['cami', 'mescit'] },
  { terms: ['kilise', 'sinagog', 'dini yapı', 'dini yapılar', 'ibadethane'],
    type: ['Diğer Dini Yapılar', 'Cami'], category: ['Dini'], expand: ['kilise', 'sinagog', 'dini yapı'] },
  { terms: ['türbe', 'turbe', 'mezar', 'anıt mezar', 'kümbet'], type: ['Mezar / Türbe'], expand: ['türbe', 'mezar'] },
  { terms: ['han', 'kervansaray', 'bedesten'], type: ['Han / Kervansaray'], expand: ['han', 'kervansaray'] },
  { terms: ['kale', 'sur', 'hisar', 'castle'], type: ['Kale / Sur'], expand: ['kale', 'sur', 'hisar'] },
  { terms: ['spor', 'stadyum', 'stat', 'spor salonu', 'arena', 'stadium'], type: ['Spor'], expand: ['spor', 'stadyum', 'arena'] },
  { terms: ['havalimanı', 'havaalanı', 'terminal', 'istasyon', 'gar', 'metro', 'ulaşım', 'airport'],
    type: ['Ulaşım', 'Terminal / İstasyon'], expand: ['havalimanı', 'terminal', 'istasyon', 'metro'] },
  { terms: ['fabrika', 'sanayi', 'üretim tesisi', 'endüstriyel', 'factory'],
    type: ['Sanayi / Üretim'], expand: ['fabrika', 'sanayi', 'üretim'] },
  { terms: ['depo', 'lojistik', 'antrepo', 'warehouse'], type: ['Depo / Lojistik'], expand: ['depo', 'lojistik'] },
  { terms: ['karma kullanım', 'karma kullanim', 'mixed use', 'mixed-use'], type: ['Karma Kullanım'], expand: ['karma kullanım'] },
  { terms: ['park', 'peyzaj', 'rekreasyon', 'bahçe', 'yeşil alan', 'landscape'],
    type: ['Rekreasyon / Park'], discipline: ['Peyzaj ve Kentsel Tasarım'], expand: ['park', 'peyzaj', 'bahçe'] },
  { terms: ['meydan', 'çarşı', 'carsi', 'pazar', 'square'], type: ['Meydan / Pazar / Çarşı'], expand: ['meydan', 'çarşı', 'pazar'] },
  { terms: ['kentsel tasarım', 'kentsel tasarim', 'masterplan', 'imar', 'kent planlama'],
    type: ['Kentsel Tasarım'], discipline: ['Peyzaj ve Kentsel Tasarım'], expand: ['kentsel tasarım', 'masterplan'] },
  { terms: ['kule', 'gökdelen', 'gokdelen', 'tower', 'skyscraper'], type: ['Kule'], expand: ['kule', 'gökdelen'] },
  { terms: ['yurt', 'konukevi', 'öğrenci yurdu'], type: ['Yurt / Konukevi'], expand: ['yurt', 'konukevi'] },
  { terms: ['köprü', 'kopru', 'baraj', 'altyapı', 'viyadük', 'tünel'],
    type: ['Altyapı / Teknik Yapı', 'Su Yapısı'], category: ['Altyapı'], expand: ['köprü', 'baraj', 'tünel'] },
  { terms: ['anıt', 'simge yapı', 'landmark', 'monument'], type: ['Anıt / Simge Yapı'], expand: ['anıt', 'simge'] },
  { terms: ['arkeolojik', 'ören yeri', 'antik kent'], type: ['Arkeolojik Alan'], expand: ['arkeolojik', 'antik'] },
  { terms: ['kamu binası', 'idari yapı', 'belediye', 'adliye', 'valilik'],
    type: ['Kamu / İdari Yapı'], category: ['Kamu'], expand: ['kamu', 'idari', 'belediye'] },

  // --- Disiplin (projects.discipline) ---
  { terms: ['iç mekan', 'ic mekan', 'iç mimari', 'interior', 'iç tasarım'],
    discipline: ['İç Mekan'], expand: ['iç mekan', 'iç mimari'] },
  { terms: ['restorasyon', 'restore', 'koruma', 'rölöve', 'yeniden işlevlendirme', 'adaptive reuse', 'restoration'],
    discipline: ['Restorasyon'], expand: ['restorasyon', 'koruma', 'yeniden işlevlendirme'] },

  // --- MALZEME ve ÜSLUP: D1'de KOLONU YOK, bilerek yalnızca metin genişletmesi ---
  // (bkz. dosya başı: sahte bir `material` filtresi üretilmez, bunlar title/description/specs
  // metninde aranır ve skorlamada "metin sinyali" olarak sayılır.)
  { terms: ['mermer', 'marble'], textOnly: true, expand: ['mermer', 'marble', 'doğal taş'] },
  { terms: ['taş', 'tas', 'doğal taş', 'dogal tas', 'taş cephe', 'taş kaplama', 'stone'],
    textOnly: true, expand: ['taş', 'doğal taş', 'taş cephe', 'taş kaplama', 'stone', 'mermer', 'traverten', 'granit', 'bazalt'] },
  { terms: ['ahşap', 'ahsap', 'wood', 'timber', 'ahşap cephe'],
    textOnly: true, expand: ['ahşap', 'wood', 'timber', 'lamine ahşap', 'ceviz', 'meşe'] },
  { terms: ['beton', 'brüt beton', 'brut beton', 'concrete'], textOnly: true, expand: ['beton', 'brüt beton', 'concrete'] },
  { terms: ['tuğla', 'tugla', 'brick'], textOnly: true, expand: ['tuğla', 'brick'] },
  { terms: ['cam', 'glass', 'cam cephe', 'giydirme cephe', 'curtain wall'],
    textOnly: true, expand: ['cam', 'glass', 'cam cephe', 'giydirme cephe'] },
  { terms: ['çelik', 'celik', 'steel', 'metal'], textOnly: true, expand: ['çelik', 'steel', 'metal'] },
  { terms: ['seramik', 'porselen', 'karo', 'fayans'], textOnly: true, expand: ['seramik', 'porselen', 'karo'] },
  { terms: ['modern', 'çağdaş', 'cagdas', 'contemporary', 'minimal', 'minimalist'],
    textOnly: true, expand: ['modern', 'çağdaş', 'contemporary', 'minimal'] },
  { terms: ['osmanlı', 'osmanli', 'selçuklu', 'selcuklu', 'tarihi', 'geleneksel', 'klasik'],
    textOnly: true, expand: ['osmanlı', 'selçuklu', 'tarihi', 'geleneksel'] },
  { terms: ['sürdürülebilir', 'surdurulebilir', 'yeşil bina', 'leed', 'breeam', 'ekolojik'],
    textOnly: true, expand: ['sürdürülebilir', 'yeşil bina', 'leed', 'ekolojik'] },
];

// Aranacak ifadeleri uzundan kısaya sırala — "iş merkezi" ifadesi, içindeki tek başına "merkez"
// kelimesinden ÖNCE denenmeli, yoksa çok kelimeli kavramlar hiç eşleşmez.
const CONCEPT_INDEX = CONCEPTS
  .flatMap(c => c.terms.map(t => ({ term: foldTr(t), concept: c })))
  .sort((a, b) => b.term.length - a.term.length);

// ---------------------------------------------------------------------------------------------
// Yazım hatası toleransı — Levenshtein mesafesi. Sadece 5+ harfli terimlerde ve mesafe<=1
// (7+ harfte <=2) uygulanır: kısa kelimelerde 1 harflik tolerans "ev"->"el" gibi tamamen farklı
// kelimeleri eşleştirip aramayı gürültüye boğardı.
// ---------------------------------------------------------------------------------------------
export function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function fuzzyEqual(a, b) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  const tol = Math.min(a.length, b.length) >= 7 ? 2 : 1;
  return editDistance(a, b) <= tol;
}

// Türkçe çoğul/hâl eklerinin kaba ama güvenli bir kırpması. Sözlükte hem tekil hem çoğul biçimleri
// zaten yazdık; bu yalnızca yazmadığımız çekimler ("ofisleri", "otellerde") için bir emniyet ağı.
const SUFFIXES = ['lerinde', 'larında', 'lerini', 'larını', 'lerde', 'larda', 'leri', 'ları', 'ler', 'lar', 'nin', 'nın', 'in', 'ın', 'de', 'da', 'te', 'ta', 'i', 'ı'];
export function stemTr(w) {
  for (const s of SUFFIXES) {
    if (w.length > s.length + 3 && w.endsWith(s)) return w.slice(0, -s.length);
  }
  return w;
}

const STOPWORDS = new Set(['ve', 'ile', 'için', 'icin', 'bir', 'bu', 'su', 'şu', 'o', 'da', 'de', 'ki',
  'olan', 'olarak', 'gibi', 'kadar', 'daha', 'en', 'çok', 'cok', 'az', 'var', 'yok', 'mi', 'mı',
  'projeleri', 'proje', 'projeler', 'yapı', 'yapi', 'yapılar', 'yapilar', 'bina', 'binalar',
  'göster', 'goster', 'bul', 'ara', 'listele', 'nedir', 'hangi', 'son', 'yapılmış', 'yapilmis',
  'kullanılan', 'kullanilan', 'kullanan', 'olanları', 'olanlar']);

// Yanlış yazılmış durak kelimeleri de eler: "projleri" ~ "projeleri". Aksi halde bir yazım hatası
// aramaya anlamsız bir terim sokuyordu ("İstanbulda ofis projleri" sorgusu 13 alakasız firma
// döndürüyordu — gerçek bulgu, üretim verisiyle test).
const STOPWORD_LIST = [...STOPWORDS];
function isStopwordish(w) {
  if (STOPWORDS.has(w)) return true;
  if (w.length < 5) return false;
  return STOPWORD_LIST.some(s => s.length >= 5 && editDistance(s, w) <= 1);
}

export function tokenize(query) {
  return foldTr(String(query || ''))
    .replace(/[^a-z0-9ğüşıöç\s-]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !isStopwordish(w));
}

// ---------------------------------------------------------------------------------------------
// expandQuery — sorgudan kavramları çıkarır.
// Döndürür: { type[], category[], discipline[], expand[], matched[] }
// matched: hangi kavramın hangi ifadeyle eşleştiği (debug/observability için, bkz. brief 14).
// ---------------------------------------------------------------------------------------------
export function expandQuery(query) {
  const folded = ' ' + foldTr(String(query || '')) + ' ';
  // textGroups — D1'de KOLONU OLMAYAN kavramlar (mermer, ahşap, modern...). Bunlar bir SİNYAL
  // değil ZORUNLU metin filtresidir: "mermer kullanılan oteller" sorgusunda otel tipolojisi
  // yetmez, metinde mermer/marble/doğal taş grubundan EN AZ BİRİ de geçmelidir. Grup içi OR,
  // gruplar arası AND (gerçek bulgu: bu ayrım olmadan sorgu TÜM otelleri döndürüyordu, 622 kayıt).
  const out = { type: [], category: [], discipline: [], expand: [], textGroups: [], matched: [] };
  const seen = new Set();

  const add = (concept, via) => {
    if (seen.has(concept)) return;
    seen.add(concept);
    for (const v of (concept.type || [])) if (!out.type.includes(v)) out.type.push(v);
    for (const v of (concept.category || [])) if (!out.category.includes(v)) out.category.push(v);
    for (const v of (concept.discipline || [])) if (!out.discipline.includes(v)) out.discipline.push(v);
    for (const v of (concept.expand || [])) if (!out.expand.includes(v)) out.expand.push(v);
    if (concept.textOnly && (concept.expand || []).length) out.textGroups.push(concept.expand.slice());
    out.matched.push({ via, type: concept.type || [], category: concept.category || [], discipline: concept.discipline || [] });
  };

  // 1) Tam ifade eşleşmesi (kelime sınırıyla) — çok kelimeli kavramlar önce.
  for (const { term, concept } of CONCEPT_INDEX) {
    if (folded.includes(' ' + term + ' ')) add(concept, term);
  }

  // 2) Eşleşmeyen tekil kelimeler için kök + yazım hatası toleransı.
  const words = tokenize(query);
  for (const w of words) {
    const stem = stemTr(w);
    for (const { term, concept } of CONCEPT_INDEX) {
      if (seen.has(concept) || term.includes(' ')) continue;
      if (term === stem || fuzzyEqual(term, w) || fuzzyEqual(term, stem)) { add(concept, w + '~' + term); break; }
    }
  }
  return out;
}

// GERÇEK BULGU (gerçek üretim verisiyle test): ham `hay.includes(term)` alt-dize eşleşmesi aramayı
// kullanılamaz hâle getiriyordu — foldTr'de "taş"->"tas" olduğu için "tas" TASARIM/tasarım içinde
// geçiyor ve "taş cepheli konutlar" sorgusu 1698 projenin 1620'sini döndürüyordu; aynı şekilde
// "iş"->"is" neredeyse her metinde bulunuyordu. Bu yüzden eşleşme artık KELİME SINIRI tabanlıdır.
// Çok kelimeli terimler ("iş merkezi") kelimeye bölünemeyeceği için onlarda alt-dize eşleşmesi
// korunur — orada yanlış eşleşme riski yok, çünkü ifade zaten uzun ve ayırt edici.
export function textTokens(text) {
  return new Set(foldTr(text || '').split(/[^a-z0-9ğüşıöç]+/i).filter(Boolean));
}

// Bir terim metinde "kelime olarak" geçiyor mu?
export function termInTokens(term, tokens, hay) {
  const t = foldTr(term);
  if (!t) return false;
  if (t.includes(' ')) return hay.includes(t);       // çok kelimeli ifade
  if (tokens.has(t)) return true;
  const st = stemTr(t);
  if (tokens.has(st)) return true;
  for (const w of tokens) {
    // Türkçe eklerini yakalamak için önek eşleşmesi ("mermerden" -> "mermer"), ama yalnızca
    // 4+ harfli terimlerde: kısa terimlerde önek eşleşmesi tam da yukarıdaki hatayı geri getirirdi.
    if (t.length >= 4 && (w.startsWith(t) || (st.length >= 4 && w.startsWith(st)))) return true;
    if (t.length >= 5 && w.length >= 5 && editDistance(w, t) <= 1) return true;
  }
  return false;
}

// Bir metnin sorgu terimlerinden kaçını içerdiğini sayar (0..1). Skorlamada "metin sinyali".
export function textOverlapScore(text, terms) {
  if (!terms.length) return 0;
  const hay = foldTr(text || '');
  if (!hay) return 0;
  const tokens = textTokens(text);
  let hit = 0;
  for (const t of terms) if (termInTokens(t, tokens, hay)) hit++;
  return hit / terms.length;
}

// Zorunlu metin grupları: grup içi OR, gruplar arası AND (bkz. expandQuery#textGroups).
export function matchesTextGroups(text, groups) {
  if (!groups || !groups.length) return true;
  const hay = foldTr(text || '');
  const tokens = textTokens(text);
  return groups.every(g => g.some(t => termInTokens(t, tokens, hay)));
}
