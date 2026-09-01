import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { slugify } from '../lib/slugify.js';
import { cachedPublicJson, getCachedPool, getCachedFingerprint, invalidatePublicCache } from '../lib/publicCache.js';
import { entityFingerprint } from '../lib/entityStats.js';
import { foldedPrefixThenSubstring } from '../lib/searchFold.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { serializePublicEntity } from '../lib/serializePublicEntity.js';
import { purgeSsrDetailCache } from '../lib/ssrCache.js';
import { fetchAdjacentEntity } from '../lib/adjacentEntity.js';

// Faz 3 — statik data.js/projeler-data.js dizileri + *_submissions overlay yerine doğrudan
// canonical `architects`/`offices`/`projects` tablolarından okur (bkz. docs/architecture-roadmap.md
// Faz3 madde 1). Onaylı submission overlay'i artık request-time'da değil, scripts/
// merge-submissions-to-id-first.js tarafından merge-time'da BİR KEZ uygulanıp canonical satıra
// yazılmış durumda — bu yüzden burada ayrı bir overlay birleştirme adımı YOK, doğrudan kolon okuma.

// kisi.html'in listelediği mimar havuzu — handleArchitectListRoute'un içindeydi, GET
// /api/public/platform'un (bkz. src/routes/platform.js) "Mimar" sayacını AYNI kümeden okuyabilmesi
// için buraya çıkarıldı. Sayacı ayrı bir COUNT(*) ile hesaplamak, aşağıdaki 'Bilinmiyor'
// istisnası yüzünden sayfada listelenenden 1 fazla değer üretiyordu (canlıda doğrulandı: 916 / 915)
// — tek kaynak kuralı bu tür sessiz sapmaların TEK güvenilir çözümü.
export async function fetchArchitectPool(env) {
  return getCachedPool(env, 'architects', async () => {
    // "Bilinmiyor" (id 835) — proje künyelerinde mimarı bilinmeyen kayıtlar için placeholder,
    // gerçek bir mimar profili değil (bkz. kullanıcı isteği: kisi.html listesinden ve anasayfa
    // carousel'inden kaldırılsın ama satır SİLİNMESİN — hiçbir project_designers/office_founders
    // satırı ona bağlı değil, yalnızca bu liste havuzundan dışlanıyor). Bu iki yer de (kisi.html
    // + index.html mini-carousel) AYNI bu pool'u tüketiyor, başka hiçbir uç (mimar-detay, arama
    // autocomplete) etkilenmiyor.
    // directory_listed = 0 → kişi "Kişi sayfasında diğer profesyonellerle birlikte görünmek"
    // istemediğini söylemiş (bkz. migrations/0081, kisi-ekle.html#m-directory-listed). Profil
    // yaşamaya devam eder (popup, arama, autocomplete, künye bağları) — yalnızca bu dizin havuzunun
    // dışında kalır. Bu havuz aynı zamanda /api/public/platform'un "Mimar" sayacını da besliyor
    // (bkz. aşağıdaki dosya başı yorumu), yani sayaç da listelenenle aynı kalır.
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.slug, a.name, a.dob, a.photo_url, a.position, a.profession, o.name AS office_name, o.awards AS office_awards,
         (SELECT COUNT(*) FROM project_designers pd JOIN projects p ON p.id = pd.project_id
          WHERE pd.architect_id = a.id AND p.deleted_at IS NULL AND p.hidden_at IS NULL) AS project_count
       FROM architects a LEFT JOIN offices o ON o.id = a.office_id AND o.deleted_at IS NULL
       WHERE a.deleted_at IS NULL AND a.hidden_at IS NULL AND a.directory_listed = 1 AND a.name != 'Bilinmiyor' ORDER BY a.id DESC`
    ).all();

    return results.map(row => {
      const a = parseCanonicalRow('architects', row);
      let officeAwards = [];
      if (row.office_awards) { try { officeAwards = JSON.parse(row.office_awards) || []; } catch { officeAwards = []; } }
      // positionRaw: kisi.html kartında ofis yoksa gösterilen alt-etiket (eski data.js#a.status
      // fallback'inin karşılığı) — bucketed `position` (bkz. positionOf) filtre eşleştirme için,
      // ham metin ise kart altyazısı için ayrı tutulur.
      return { slug: a.slug, name: a.name, dob: a.dob, photo: a.photo_url, office: row.office_name || null, position: positionOf(a.position), positionRaw: a.position || null, professions: professionLabelList(a.profession), officeAwards, projectCount: row.project_count || 0, badges: [] };
    });
  });
}

async function findArchitect(env, key) {
  const row = await env.DB.prepare(
    `SELECT * FROM architects WHERE deleted_at IS NULL AND (name = ? OR slug = ? OR legacy_key = ?) LIMIT 1`
  ).bind(key, key, key).first();
  if (row) return row;
  // Yeniden adlandırma sonrası `slug` kolonu güncel tutulur (bkz. src/lib/officeFounderCascade.js),
  // ama birden fazla art arda yeniden adlandırma ya da eski bir bağlantı yine de üretilen slug'la
  // eşleşmeyebilir — bkz. eski #findByNameOrSlug'daki AYNI slugify-tarama fallback'i. Tablo küçük
  // olduğundan (yüzlerce satır) bu tam tarama ucuzdur.
  const { results } = await env.DB.prepare(`SELECT id, name FROM architects WHERE deleted_at IS NULL`).all();
  const match = results.find(r => slugify(r.name) === key);
  if (!match) return null;
  return env.DB.prepare(`SELECT * FROM architects WHERE id = ?`).bind(match.id).first();
}

// SQL LIKE yalnızca ASCII harfleri case-insensitive katlar — Türkçe İ/I/ı/i çiftlerini bilmediğinden
// D1 tarafında bu normalizasyon yapılamıyor (bkz. src/routes/office.js#trLower'daki AYNI gerekçe/
// gerçek bulgu). project.js/legacyContent.js'deki AYNI trLower ile birebir aynı — her dosyada
// yerel olarak tekrar tanımlanmış.
function trLower(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}

// trLower Türkçe BÜYÜK->küçük eşlemesini doğru yapar ama bu yüzden ASCII "I" (ör. Türkçe olmayan/
// ALL-CAPS yazılmış isimlerde) noktasız 'ı'ya döner — kullanıcı normal klavyeyle (düz 'i' ile)
// yazdığında eşleşme kaçırılabiliyordu (bkz. src/routes/project.js#foldTr'deki AYNI gerçek bulgu/
// gerekçe — SANKAI proje arama hatası). Sorgu VE hedef metin AYNI foldTr'den geçirilir.
function foldTr(s) {
  return trLower(s).replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
}

// src/routes/project.js#parseProjectDateYear ile AYNI serbest-metin project_date ayrıştırma
// mantığı — mimar popup'ındaki "Projeler" kartlarını en yeniden en eskiye sıralamak için burada
// da gerekiyor (bkz. kullanıcı isteği: Nevzat Sayın örneği, en son tasarlanan proje soldan başlasın).
function parseProjectDateYear(dateStr) {
  if (!dateStr) return null;
  const hasCenturyWordAnywhere = /yuzyil|\byy\b/.test(foldTr(dateStr));
  let best = null;
  for (const rawSegment of String(dateStr).split('/')) {
    const folded = foldTr(rawSegment);
    const isBC = /\bmo\b/.test(folded);
    const isCenturyFragment = hasCenturyWordAnywhere && /^\s*(ms\s*)?\d{1,2}\.\s*$/.test(folded);
    const isCentury = isCenturyFragment || /yuzyil|\byy\b/.test(folded);
    const nums = (rawSegment.match(/\d+/g) || []).map(n => parseInt(n, 10));
    if (!nums.length) continue;
    let year;
    if (isCentury) {
      const century = isBC ? Math.max(...nums) : Math.min(...nums);
      year = isBC ? -(century * 100) : (century - 1) * 100 + 1;
    } else {
      const magnitude = isBC ? Math.max(...nums) : Math.min(...nums);
      year = isBC ? -magnitude : magnitude;
    }
    if (best === null || year < best) best = year;
  }
  return best;
}

// GET /api/architects/search?q=...&office=<tam ofis adı> — proje-ekle.html/urun-ekle.html gibi
// formlardaki Mimar autocomplete kutularının canlı D1 sorgusu (bkz. kullanıcı isteği: "Admin
// panelinden yeni eklenen mimarlar Proje Ekle'deki öneri kutusunda görünmüyor" — eski hâli data.js'
// teki statik architects[] dizisini kullanıyordu, D1'e yeni eklenen kayıtları hiç görmüyordu).
// Türkçe harf duyarlılığı (İ/I/ı/i, Ş/ş ...) SQLite'ın lower()/LIKE'ı tarafından bilinmediğinden bu
// eşleştirme eskiden TÜM adaylar Worker'a çekilip JS'te foldTr ile yapılıyordu. 2026-09-01 denetimi
// bunu SQL'e taşıdı: foldTr'nin birebir SQL karşılığını hesaplayan indexli `name_fold` generated
// column'u (bkz. migrations/0079) + iki aşamalı önek/substring araması (bkz. src/lib/searchFold.js).
// office parametresi (q ile birlikte DEĞİL, onun yerine kullanılır) — urun-ekle.html'in "Marka"
// alanından bir firma seçildiğinde o firmanın bünyesindeki TÜM mimarları (architects.office_id
// eşleşmesi) döner; Legacy Bundle Elimination Faz 3'ten önce bu istemci tarafında data.js'in statik
// architects[] dizisi üzerinde `a.office === seçilenFirma` filtresiyle yapılıyordu (bkz. kullanıcı
// isteği).
export async function handleArchitectSearchRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const officeParam = (url.searchParams.get('office') || '').trim();
    const q = foldTr((url.searchParams.get('q') || '').trim());
    if (!q && !officeParam) return { items: [] };
    // D1 audit (2026-08-25) P1-6 — bkz. product.js#handleProductSearchRoute'taki AYNI gerekçe.
    // officeParam (tam isim eşleşmesi, tuş vuruşuyla değil seçimle set edilir) bu eşikten muaf —
    // yalnızca serbest metin `q` araması 2 karakter altında D1'e hiç gitmez.
    if (!officeParam && q.length < 2) return { items: [] };
    // production audit (2026-09-01, madde B): eşleştirme artık SQLite içinde, indexli name_fold
    // generated column'u üzerinde yapılıyor (bkz. migrations/0079 + src/lib/searchFold.js) —
    // önceden TÜM mimarlar Worker'a çekilip JS'te foldTr ile filtreleniyordu.
    // officeParam dalı (tam isim eşleşmesi, tuş vuruşuyla değil seçimle set edilir) substring
    // araması DEĞİL, bu yüzden kendi basit sorgusunu kullanır — o da artık SQL'de filtreleniyor.
    // kullanıcı isteği (2026-09-01 madde 4): "kişi sayfasında görünen tüm kullanıcılar mesleklerine
    // göre mimar, tasarımcı veya fotoğrafçı profili olarak ALGILANABİLSİN ve proje, ürün, firma
    // veya markalara eklenebilsinler". Bu uç ZATEN tüm kişi profillerini döndürüyordu (meslek
    // ayrımı yapmıyor) — eksik olan, öneri satırında kişinin ne olduğunun görünmesiydi: alt satır
    // yalnızca firma adıydı, firması olmayan bir Tasarımcı/Fotoğrafçı ise etiketsiz kalıyordu.
    // Artık firma ve meslek birlikte gösterilir, `profession` da ham olarak döner (çağıranların
    // kendi filtre/etiket ihtiyaçları için).
    // directory_listed BİLEREK filtrelenmiyor: /kisi dizininde görünmek istemeyen biri de künyelere
    // eklenebilmeye devam eder (bkz. migrations/0081 başlığı).
    const baseSelect = `SELECT a.id AS id, a.name AS name, a.profession AS profession, o.name AS office_name FROM architects a
       LEFT JOIN offices o ON o.id = a.office_id AND o.deleted_at IS NULL
       WHERE a.deleted_at IS NULL AND a.hidden_at IS NULL`;
    const toItem = (r) => {
      const professionLabel = professionLabelList(r.profession).join(', ');
      return { label: r.name, sub: [r.office_name, professionLabel].filter(Boolean).join(' · '), profession: professionLabel || null };
    };
    if (officeParam) {
      const { results } = await env.DB.prepare(
        `${baseSelect} AND o.name = ? ORDER BY a.name LIMIT 20`
      ).bind(officeParam).all();
      return { items: results.map(toItem) };
    }
    const rows = await foldedPrefixThenSubstring({
      runQuery: (sql, params) => env.DB.prepare(sql).bind(...params).all().then(r => r.results),
      sqlFor: (cond, limit) => `${baseSelect} ${cond} ORDER BY a.name LIMIT ${limit}`,
      foldColumn: 'a.name_fold',
      // keyOf = satır kimliği (ad DEĞİL): iki aşamanın AYNI satırı iki kez listelemesini önler,
      // ama aynı ada sahip FARKLI iki mimarı (bkz. proje notu: kayıtlar çıplak isimle anahtarlanıyor,
      // aynı adlı iki kayıt olabiliyor) birbirine karıştırıp birini düşürmez.
      q, limit: 20, keyOf: r => r.id,
    });
    const items = rows.map(toItem);
    return { items };
  });
}

// GET /api/architects/schools — uye-ol.html (kayıt formu) / kisi-ekle.html'deki "Üniversite"
// otomatik tamamlama kutusu için canonical D1'deki tüm mimarların KAYITLI OLDUĞU okulların
// tekilleştirilmiş listesini döner (bkz. kullanıcı isteği: Legacy Bundle Elimination Faz 3 —
// eskiden data.js'in statik architects[] dizisi üzerinde `[...new Set(architects.map(a=>a.school))]`
// ile istemci tarafında hesaplanıyordu). Sonuç istemci tarafında zaten yerel/senkron substring
// filtrelendiğinden (bkz. o sayfalardaki wireAutocomplete — canlı arama DEĞİL, tek seferlik tam
// liste + yerel filtre) burada sayfalama/arama parametresi yok, tek seferlik tam liste döner.
export async function handleArchitectSchoolsRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  return cachedPublicJson(request, env, url.pathname, async () => {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT school FROM architects WHERE deleted_at IS NULL AND school IS NOT NULL AND school != ''`
    ).all();
    const items = results.map(r => r.school).sort((a, b) => a.localeCompare(b, 'tr'));
    return { items };
  });
}

// Pozisyon filtre kovası — "Kurucu"/"Kurucu Ortak" tarihsel olarak tek "Kurucu" kovasında
// gruplanır (bkz. eski yorum: 485 "Kurucu Ortak" + 312 "Kurucu"), "İş arıyor"/"İş Arıyor" normalize
// edilip "İşsiz" olur. GERÇEK BULGU: eski sürüm burada tanınmayan HER değeri (ör. "Ortak",
// "Akademisyen", "Freelance", "Ekip Lideri") sessizce "Çalışan" kovasına düşürüyordu — bir mimarın
// profili "Ortak"/"Akademisyen" olarak düzenlense bile kisi.html filtresinde hâlâ "Çalışan" altında
// görünüyordu (bkz. kullanıcı isteği: Melkan Gürsel/Nur Urfalıoğlu). Artık tanınmayan her değer
// OLDUĞU GİBİ kendi kovasına döner — kisi-ekle.html#POZISYON_OPTIONS'a yeni bir değer eklendiğinde
// bile sessizce yanlış kovaya düşme riski kalmaz.
// architects.profession, 2026-09-01'den beri virgülle ayrılmış BİRDEN ÇOK ham Türkçe etiket
// taşıyabilir ("Mimar, Fotoğrafçı", bkz. migrations/0080_project_photographers.sql başlığı ve
// kisi-ekle.html#professionLabelList — BİLİNÇLİ kopya, iki taraf da AYNI biçimi okur). Tek meslekli
// eski satırlar bu biçimin geçerli bir örneği olduğundan veri taşıması gerekmedi.
export function professionLabelList(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

export function positionOf(position) {
  if (!position) return null;
  if (position === 'İş arıyor' || position === 'İş Arıyor') return 'İşsiz';
  if (position.startsWith('Kurucu')) return 'Kurucu';
  return position;
}

// GET /api/architects — kisi.html#render()'ın sayfalanmış sunucu karşılığı (bkz. kullanıcı isteği:
// "Bütün sayfaların verisini tek seferde DOM'a yükleme"). kisi.html#populateFilters()'ın dob/award/
// position sayaçlarını `filters` alanında birlikte döner — tablo küçük (~800 satır) olduğundan tam
// tarama ucuz (bkz. handleArchitectSearchRoute'daki AYNI gerekçe).
export async function handleArchitectListRoute(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);

  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const limit = Math.min(96, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 24));
    const sort = url.searchParams.get('sort') || '';
    // kullanıcı isteği (2026-09-01 madde 2): "Kişi sayfasındaki filtreleri de proje ve ürün
    // sayfalarındaki gibi çok seçmeli seçilebilecek şekilde düzenle" — her filtre grubu artık
    // getAll() ile ÇOKLU değer alır (?position=Kurucu&position=Ortak). Tek değerli eski linkler
    // (künyelerden, paylaşılan URL'lerden) tek elemanlı bir dizi olarak AYNI şekilde çalışır.
    // Grup İÇİ mantık OR, gruplar ARASI AND — proje.html/urun.html'deki desenle birebir aynı.
    const dobParams = url.searchParams.getAll('dob').filter(Boolean);
    const awardParams = url.searchParams.getAll('award').filter(Boolean);
    const positionParams = url.searchParams.getAll('position').filter(Boolean);
    const professionParams = url.searchParams.getAll('profession').filter(Boolean);
    const searchQuery = foldTr((url.searchParams.get('search') || '').trim());

    // Varsayılan sıralama artık "en popüler" (en çok projesi olan mimar önce) — bkz. kullanıcı
    // isteği: "Default Popularity-Based Sorting". ?sort=newest EXPLICIT olarak eski "son eklenen
    // ilk" (id DESC) davranışını korur — anasayfa Mimar carousel'i (bkz. index.html) artık bu
    // değeri açıkça göndererek kendi "son eklenen 6 mimar" beklentisini korur (aksi halde sort
    // parametresiz istekler artık popülerlik sıralı döneceğinden carousel sessizce bozulurdu).
    // Faz 4A — Projection Optimization: kart listesi yalnızca aşağıdaki alanları render eder (bkz.
    // aşağıdaki pool.map) — about/school/dept/profession/awards gibi yalnızca tekil profil
    // sayfasında (buildArchitectPayload, a.* ile ayrı okunur) gereken kolonlar bu listeye dahil
    // edilmiyor. project_count — idx_project_designers_architect indeksi üzerinden ucuz bir
    // correlated subquery (bkz. migrations/0022_id_first_entities.sql) — yalnızca DOĞRUDAN o mimara
    // atanmış projeler sayılır (ofisi üzerinden ilişkili olduğu projeler DEĞİL; mimar-detay.html'deki
    // relatedProjects'in aksine, popülerlik burada kişisel proje sayısını yansıtır).
    // gerçek bulgu: bu sorgu (JOIN + satır başı correlated subquery) ve aşağıdaki .map() dönüşümü
    // önceden HER istekte (filtre/sort/sayfa fark etmeksizin) yeniden çalışıyordu — sidebar sayaçları
    // (dob/award/position) TÜM havuzdan hesaplandığından project.js#fetchProjectListPageFromD1'deki
    // D1 LIMIT/OFFSET deseni burada uygulanamaz (bkz. publicCache.js#getCachedPool dosya başı
    // yorumu). Bunun yerine ham sorgu+şekillendirme sonucu (pool) KV'de önbelleklenir — farklı sayfa/
    // sort/filtre kombinasyonları (farklı TAM URL, farklı caches.default anahtarı) AYNI pool'u
    // paylaşır. Filtre/sıralama mantığı (aşağısı) DEĞİŞMEDİ, hâlâ her istekte JS'te çalışır.
    const pool = await fetchArchitectPool(env);

    function passes(a) {
      if (dobParams.length && !dobParams.includes(String(a.dob))) return false;
      if (awardParams.length && !awardParams.some(w => a.officeAwards.includes(w))) return false;
      if (positionParams.length && !positionParams.includes(a.position)) return false;
      // (a.professions || []) — bkz. aşağıdaki professionCounts'taki AYNI gerekçe: deploy anında
      // KV'de duran ESKİ havuz (bu alan eklenmeden önce yazılmış) bu alanı taşımaz.
      if (professionParams.length && !professionParams.some(p => (a.professions || []).includes(p))) return false;
      if (searchQuery && !foldTr(a.name).includes(searchQuery)) return false;
      return true;
    }

    const filtered = pool.filter(passes);

    // sort boşsa (varsayılan) ya da 'popular' ise en çok projesi olan mimar önce gelir, eşitlikte
    // isim A-Z (bkz. yukarıdaki "Varsayılan sıralama" notu). 'newest' — id DESC — anasayfa
    // carousel'inin AÇIKÇA istediği eski varsayılan davranış.
    filtered.sort((x, y) => {
      switch (sort) {
        case 'name_asc': return x.name.localeCompare(y.name, 'tr');
        case 'year_desc': return (y.dob || 0) - (x.dob || 0);
        case 'year_asc': return (x.dob || 9999) - (y.dob || 9999);
        case 'newest': return 0; // pool zaten id DESC ile geldi, ek bir JS sıralaması gerekmiyor
        case 'popular':
        default:
          return (y.projectCount - x.projectCount) || x.name.localeCompare(y.name, 'tr');
      }
    });

    // kisi.html#populateFilters — sayaçlar aktif filtrelerden BAĞIMSIZ, tüm havuz üzerinden
    // (proje.html'deki bağımlı/faceted sayaçların aksine; kisi.html'de zaten hiç öyle çalışmıyordu).
    // kullanıcı isteği (2026-09-01 madde 1): "0 kişi sayısında olan filtreler en az 1 kişi bu
    // filtreye eklenene kadar gözükmesin" — sayaçlar VERİDEN türetildiğinden (sabit bir seçenek
    // listesinden değil) sıfırlık bir kova burada hiç oluşmaz, dolayısıyla kisi.html'de de hiç
    // çizilmez. kisi-ekle.html#MESLEK_OPTIONS'taki bir meslek ilk kişisini alır almaz kendiliğinden
    // filtre olarak belirir; sıralaması kisi.html#PROFESSION_ORDER ile o formdaki sırayla eşlenir.
    const dobCounts = {}, awardCounts = {}, positionCounts = {}, professionCounts = {};
    pool.forEach(a => {
      if (a.dob) dobCounts[a.dob] = (dobCounts[a.dob] || 0) + 1;
      a.officeAwards.forEach(award => { awardCounts[award] = (awardCounts[award] || 0) + 1; });
      if (a.position) positionCounts[a.position] = (positionCounts[a.position] || 0) + 1;
      // (a.professions || []) — GERÇEK BULGU (yerelde 500 ile yaşandı): havuz KV'de 30 dakikaya
      // kadar önbelleklenir (bkz. publicCache.js#POOL_CACHE_TTL_SECONDS), yani deploy anında
      // BU ALANIN HENÜZ OLMADIĞI eski bir havuz nesnesi hâlâ okunuyor olabilir. Çıplak
      // a.professions.forEach, o pencerede TÜM /api/architects isteklerini 500'e düşürürdü —
      // yani kişi listesi manuel bir KV temizliği yapılana kadar tamamen çöker. Bu geri düşüş,
      // aynı pencerede yalnızca meslek sayaçlarının boş kalmasına (kendiliğinden düzelir) yol açar.
      (a.professions || []).forEach(p => { professionCounts[p] = (professionCounts[p] || 0) + 1; });
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (Math.min(page, totalPages) - 1) * limit;
    const items = filtered.slice(start, start + limit).map(({ officeAwards, projectCount, professions, ...rest }) => rest);

    return {
      items: serializePublicEntity(items), total, page: Math.min(page, totalPages), totalPages,
      filters: {
        dob: Object.keys(dobCounts).sort((x, y) => y - x).map(v => ({ value: v, count: dobCounts[v] })),
        award: Object.keys(awardCounts).sort((x, y) => awardCounts[y] - awardCounts[x] || x.localeCompare(y, 'tr')).map(v => ({ value: v, count: awardCounts[v] })),
        position: positionCounts,
        profession: professionCounts,
      },
    };
  }, () => architectListFingerprint(env));
}

// Faz 4B — Conditional Requests: yukarıdaki tam liste sorgusundan (JOIN + JS filtre/sırala/sayfala)
// çok daha ucuz bir "içerik değişti mi" özeti — bkz. src/lib/publicCache.js#cachedPublicJson
// listFingerprint parametresi.
// D1 audit (2026-08-25) P0-3 — bkz. project.js#projectListFingerprint'teki AYNI gerekçe.
// production audit (2026-09-01, madde A): buradaki ÇIPLAK `SELECT COUNT(*), MAX(updated_at) ...`
// artık src/lib/entityStats.js#entityFingerprint üzerinden okunuyor — değer yazma yolunda (SQLite
// trigger'ları, bkz. migrations/0078_entity_stats.sql) bakımı yapılan entity_stats tablosundan TEK
// satırlık bir PRIMARY KEY aramasıyla geliyor, yani kayıt sayısından bağımsız. entityFingerprint,
// entity_stats yoksa ESKİ tam-tarama sorgusuna kendisi düşer (davranış aynı kalır). Dış katman
// (getCachedFingerprint'in 60sn'lik KV önbelleği + invalidatePublicCache temizliği) DEĞİŞMEDİ.
function architectListFingerprint(env) {
  return getCachedFingerprint(env, 'architects', () => entityFingerprint(env, 'architects'));
}

// GET /api/architect/:key — mimar-detay.html'nin TEK istekte aldığı birleşik yanıt. Dönen şekil:
// { item, office, colleagues, relatedProjects, hidden } — eski overlay tabanlı sürümle BİREBİR aynı.
export async function handleArchitectRoute(request, env, url, rawKey) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const key = decodeURIComponent(rawKey || '');
  if (!key) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, () => buildArchitectPayload(env, key));
}

// Mimar Ekle formundaki Firma alanına yazılıp offices tablosunda karşılığı bulunamadığı için
// office_id/office_founders'a hiç bağlanamamış (bkz. src/lib/canonicalSync.js#syncArchitect —
// eşleşmeyen isim officeId=null bırakılır) firma adını/adlarını kurtarır — src/routes/office.js#
// fetchRawFounderNames ile AYNI desen. architect_submissions.office, founders'ın aksine JSON dizi
// değil virgülle ayrılmış DÜZ TEK bir string (bkz. src/lib/submissionTypes.js#architects.fields),
// bu yüzden canonicalSync.js#syncArchitect'teki AYNI split(',') burada da uygulanmalı — aksi halde
// "GEOMIM, GEO_ID" gibi çok firmalı bir giriş, hiçbir canonical isimle eşleşmeyen TEK bir sahte
// "unregistered" firma olarak (gerçek bulgu: her iki firma da zaten kayıtlıyken bile) render edilir.
async function fetchRawOfficeNames(env, a) {
  const submissionId = (a.legacy_key || '').startsWith('submission:') ? a.legacy_key.slice('submission:'.length) : '';
  const row = await env.DB.prepare(
    `SELECT office FROM architect_submissions WHERE claimed_profile_key = ?1 OR claimed_profile_key = ?2 OR id = ?3 ORDER BY updated_at DESC LIMIT 1`
  ).bind(a.name, a.legacy_key || '', submissionId).first();
  if (!row || !row.office) return [];
  return row.office.split(',').map(s => s.trim()).filter(Boolean);
}

// Önceki/Sonraki Mimar — bkz. src/routes/project.js#fetchAdjacentProject'teki AYNI dairesel/sıralı
// id-tabanlı desen (kullanıcı isteği: proje.html'deki gezinme yapısının birebir aynısı mimar/firma/
// ürün pop-up'larına da eklensin).
async function fetchAdjacentArchitect(env, id) {
  const { prev, next } = await fetchAdjacentEntity(env, 'architects', id, { titleCol: 'name', imageCol: 'photo_url' });
  return { prevItem: prev, nextItem: next };
}

async function buildArchitectPayload(env, key) {
  const row = await findArchitect(env, key);
  // bkz. gerçek bulgu: eski "eşleşme yoksa ilk kaydı döndür" fallback'i, silinmiş/eşleşmeyen bir key
  // için sessizce BAŞKA bir mimarın (her zaman en düşük id'li, silinmemiş satır) profilini
  // döndürüyordu — ör. architects id 1-6 silindiğinde /mimar/gokhan-avcioglu id 7'nin (Seyhan
  // Özdemir Sarper) verisini gösteriyordu. src/routes/project.js#handleProjectDetailRoute'un
  // AYNI durumdaki "item: null, hidden: false" dönüşüyle tutarlı hale getirildi — istemci
  // (mimar-detay.html) bunu zaten "bulunamadı" olarak ele alıp kisi.html'e yönlendiriyor.
  if (!row) return { item: null, hidden: false };
  // gerçek bulgu (denetim raporu): findArchitect yalnızca deleted_at IS NULL filtreliyor, hidden_at'a
  // hiç bakmıyor — bu uç gizlenmiş bir mimarın TAM verisini `hidden:true` bayrağıyla birlikte ama
  // item NULL'lanmadan döndürüyordu. Client-side (architect-modal.js) bayrağı kontrol edip
  // "bulunamadı" gösteriyor, ama /api/architect/:key'i doğrudan çağıran biri tam veriyi alabiliyordu
  // — src/routes/project.js#handleProjectDetailRoute'un AYNI durumda zaten yaptığı gibi item burada
  // da null'lanır.
  if (row.hidden_at) return { item: null, hidden: true };
  const a = parseCanonicalRow('architects', row);

  const officeRow = a.office_id
    ? await env.DB.prepare(`SELECT * FROM offices WHERE id = ? AND deleted_at IS NULL AND hidden_at IS NULL`).bind(a.office_id).first()
    : null;
  const office = officeRow ? parseCanonicalRow('offices', officeRow) : null;

  // Mimarın kurucu/ortak olduğu TÜM firmalar — yalnızca kendi office_id'siyle bağlı olduğu firma
  // değil, office_founders join tablosundaki TÜM bağlantılar (bkz. gerçek bulgu: Han Tümertekin'in
  // profilinde "Pozisyon: Kurucu" yazmasına rağmen office_id'si boş olduğundan, yalnızca office_id
  // okunsaydı Tümertekin Architects hiç görünmezdi — firma tarafında Kurucular listesine eklenerek
  // office_founders'a bağlanmış olsa bile). Tekilleştirilmiş, office_id'deki varsa önce o sırayla.
  const { results: founderOfficeRows } = await env.DB.prepare(
    `SELECT o.* FROM office_founders f JOIN offices o ON o.id = f.office_id
     WHERE f.architect_id = ? AND o.deleted_at IS NULL AND o.hidden_at IS NULL`
  ).bind(a.id).all();
  const officesById = new Map();
  if (office) officesById.set(office.id, office);
  for (const row of founderOfficeRows) {
    const parsed = parseCanonicalRow('offices', row);
    if (!officesById.has(parsed.id)) officesById.set(parsed.id, parsed);
  }
  const offices = [...officesById.values()];

  const rawOfficeNames = await fetchRawOfficeNames(env, a);
  const knownOfficeNames = new Set(offices.map(o => trLower(o.name)));
  const unregisteredOffices = [];
  for (const name of rawOfficeNames) {
    if (!name || knownOfficeNames.has(trLower(name))) continue;
    knownOfficeNames.add(trLower(name));
    unregisteredOffices.push({ name, unregistered: true });
  }

  // Diğer Mimarlar — kullanıcı isteği: "Diğer Mimarlar" bölümünde benzer yaştaki mimarlar öneri
  // olarak gösterilsin, her açılışta farklı isimler çıksın. dob (doğum yılı) metin olarak saklanır,
  // bazı satırlarda tam tarih de olabileceğinden (bkz. auth-modal.js#am-fact-dob'daki AYNI
  // .slice(0,4) kalıbı) ilk 4 karakter yıl olarak alınır. a.dob boşsa bölüm hiç sorgulanmaz.
  const dobYear = a.dob ? parseInt(String(a.dob).slice(0, 4), 10) : null;
  const AGE_RANGE_YEARS = 5;

  const [colleaguesRes, relatedRes, similarAgeRes, designerProductsRes, usedProductsRes, preferredBrandsRes, photographedRes] = await Promise.all([
    office
      ? env.DB.prepare(
          `SELECT ar.* FROM office_founders f JOIN architects ar ON ar.id = f.architect_id
           WHERE f.office_id = ? AND ar.deleted_at IS NULL AND ar.hidden_at IS NULL AND ar.id != ?`
        ).bind(office.id, a.id).all()
      : Promise.resolve({ results: [] }),
    env.DB.prepare(
      `SELECT DISTINCT p.* FROM project_designers pd JOIN projects p ON p.id = pd.project_id
       WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND (pd.architect_id = ? OR pd.office_id = ?)`
    ).bind(a.id, office ? office.id : -1).all(),
    // D1 audit (2026-08-25) P1-4 — bkz. src/routes/office.js#relatedOffices'teki AYNI gerekçe:
    // ORDER BY RANDOM() D1'de canlıda doğrulanmış bir "SCAN + TEMP B-TREE" maliyeti üretiyordu
    // (bu sorgunun WHERE koşulu da — ABS(...) ifadesi — indexlenemez). Sıralama artık D1'de değil,
    // aşağıdaki Fisher-Yates ile Worker belleğinde yapılıyor; LIMIT 50 makul bir üst sınır.
    Number.isFinite(dobYear) ? env.DB.prepare(
      `SELECT slug, name, dob, photo_url FROM architects
       WHERE deleted_at IS NULL AND hidden_at IS NULL AND id != ? AND dob IS NOT NULL AND dob != ''
         AND ABS(CAST(SUBSTR(dob, 1, 4) AS INTEGER) - ?) <= ?
       LIMIT 50`
    ).bind(a.id, dobYear, AGE_RANGE_YEARS).all() : Promise.resolve({ results: [] }),
    // Tasarımcı künyesi bu mimarla eşleşen ürünler (bkz. kullanıcı isteği: "ürünler mimar
    // profillerinde de projeler gibi Ürünler (N) başlığı altında gözüksün", ardından: "birden fazla
    // tasarımcı virgülle ayrılabilsin") — products.designer serbest metin, structured bir junction
    // tablosu yok (bkz. src/lib/cascadeDelete.js#split(',') ile AYNI "virgülle ayrılmış serbest metin"
    // deseni). LIKE burada yalnızca ucuz bir ön-filtre (indekslenemeyen designer sütununda tam tablo
    // taramasını, isme sahip OLMAYAN satırları erkenden eleyerek daraltır) — asıl eşleşme aşağıda JS
    // tarafında virgülle bölünüp TAM (case-insensitive) karşılaştırılır, "Emre Aro" gibi bir alt-dize
    // yanlışlıkla "Emre Arolat" ile eşleşmesin diye.
    env.DB.prepare(
      `SELECT * FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL AND designer LIKE ? COLLATE NOCASE
       ORDER BY title COLLATE NOCASE`
    ).bind(`%${a.name}%`).all(),
    // "Kullandığı Ürünler" (kullanıcı isteği, 2026-08-31) — yukarıdaki relatedProducts'tan TAMAMEN
    // AYRI bir küme: o, mimarın TASARLADIĞI ürünler (products.designer serbest metin eşleşmesi);
    // bu ise mimarın PROJELERİNDE kullanılan (başkalarının tasarladığı) ürünler. Proje kümesi
    // relatedRes ile BİREBİR aynı koşulu kullanır (mimarın kendi projeleri + firmasının projeleri),
    // böylece popup'taki "Projeler" bölümüyle tutarlı kalır. Zincir: project_designers → projects →
    // project_products → products (bkz. src/routes/office.js#projectProductsRes'in AYNI deseni).
    env.DB.prepare(
      `SELECT DISTINCT pr.slug, pr.title, pr.brand_name_raw, pr.category, pr.kind, pr.images
       FROM project_designers pd
       JOIN projects p ON p.id = pd.project_id AND p.deleted_at IS NULL AND p.hidden_at IS NULL
       JOIN project_products pp ON pp.project_id = p.id
       JOIN products pr ON pr.id = pp.product_id AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL
       WHERE pd.architect_id = ?1 OR pd.office_id = ?2
       ORDER BY pr.title COLLATE NOCASE`
    ).bind(a.id, office ? office.id : -1).all(),
    // "Tercih Ettiği Markalar" — yukarıdaki zincirin bir halka devamı (ürün → markası). Marka
    // eşleşmesi src/routes/office.js#relatedBrandsRes ile BİREBİR AYNI kuraldır: önce
    // brand_office_id, o boşsa marka adı (toplu/legacy eklenen ürünlerde brand_office_id boş kalır).
    env.DB.prepare(
      `SELECT b.slug, b.name, b.loc, b.logo_url, COUNT(DISTINCT pr.id) AS used_count
       FROM project_designers pd
       JOIN projects p ON p.id = pd.project_id AND p.deleted_at IS NULL AND p.hidden_at IS NULL
       JOIN project_products pp ON pp.project_id = p.id
       JOIN products pr ON pr.id = pp.product_id AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL
       JOIN offices b ON b.deleted_at IS NULL AND b.hidden_at IS NULL
         AND (b.id = pr.brand_office_id OR (pr.brand_office_id IS NULL AND b.name = pr.brand_name_raw COLLATE NOCASE))
       WHERE pd.architect_id = ?1 OR pd.office_id = ?2
       GROUP BY b.id
       ORDER BY used_count DESC, b.name COLLATE NOCASE`
    ).bind(a.id, office ? office.id : -1).all(),
    // "Fotoğrafladığı Projeler" (kullanıcı isteği, 2026-09-01 madde 6: "kişinin popupında
    // Fotoğraflarım kısmı olsun — aynı mimar profillerindeki projelerim kısmı gibi"). Yukarıdaki
    // relatedRes'in (mimar olarak TASARLADIĞI projeler) fotoğrafçı karşılığı: project_photographers
    // → projects (bkz. migrations/0080_project_photographers.sql). Kişi profili tektir; bir kişi hem
    // mimar hem fotoğrafçı olabildiğinden iki bölüm AYNI popup'ta yan yana durur, biri boşsa o bölüm
    // hiç gösterilmez (bkz. js/components/architect-modal.js#am-photographed-section).
    env.DB.prepare(
      `SELECT p.* FROM project_photographers pp JOIN projects p ON p.id = pp.project_id
       WHERE pp.architect_id = ? AND p.deleted_at IS NULL AND p.hidden_at IS NULL`
    ).bind(a.id).all(),
  ]);

  // Meslektaşlar/ilgili projeler: role/photo/awards gibi alanlar artık canonical satırın kendisinden
  // gelir (overlay merge-time'da zaten uygulandı) — eski request-time overlay hesaplaması gerekmiyor.
  const colleagues = colleaguesRes.results.map(x => ({ name: x.name, role: x.position, photo: x.photo_url, badges: [] }));
  // En yeniden en eskiye sırala (bkz. src/routes/project.js#date_desc AYNI "tarihi çözülemeyen
  // sona düşer" davranışı) — kullanıcı isteği: popup'taki proje kartları soldan sağa en son
  // tasarlanandan en eskiye doğru dizilsin.
  // Fotoğrafladığı Projeler (bkz. photographedRes) BİREBİR aynı şekil/sıralamayı kullandığından
  // (aynı kart bileşeni, aynı "en yeni önce" kuralı) blok ortak bir yardımcıya alındı.
  const shapeProjectsNewestFirst = rows => rows
    .map(p => {
      const parsed = parseCanonicalRow('projects', p);
      return { slug: parsed.slug, title: parsed.title, images: parsed.images, category: parsed.category, lat: parsed.lat, lng: parsed.lng, _year: parseProjectDateYear(p.project_date) };
    })
    .sort((a, b) => {
      if (a._year == null && b._year == null) return 0;
      if (a._year == null) return 1;
      if (b._year == null) return -1;
      return b._year - a._year;
    })
    .map(({ _year, ...rest }) => rest);
  const relatedProjects = shapeProjectsNewestFirst(relatedRes.results);
  const photographedProjects = shapeProjectsNewestFirst(photographedRes.results);
  // D1 audit (2026-08-25) P1-4 — bkz. yukarıdaki similarAgeRes sorgusundaki AYNI gerekçe: en fazla
  // 50 aday burada karıştırılıp ilk 9'u alınır (D1'de ORDER BY RANDOM() KALDIRILDI). 9 — kullanıcı
  // isteği (2026-08-31), tüm öneri şeritlerinin ORTAK üst sınırı (bkz. js/components/project-related.js
  // #RESULT_COUNT).
  const shuffledArchitects = [...similarAgeRes.results];
  for (let i = shuffledArchitects.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledArchitects[i], shuffledArchitects[j]] = [shuffledArchitects[j], shuffledArchitects[i]];
  }
  const relatedArchitects = shuffledArchitects.slice(0, 9).map(r => ({ slug: r.slug, name: r.name, dob: r.dob, photo: r.photo_url }));
  const architectNameLower = a.name.trim().toLowerCase();
  const relatedProducts = designerProductsRes.results
    .filter(p => (p.designer || '').split(',').some(seg => seg.trim().toLowerCase() === architectNameLower))
    .map(p => parseCanonicalRow('products', p))
    .filter(p => p.kind !== 'material')
    .map(p => ({ slug: p.slug, title: p.title, images: p.images, category: p.category }));

  // Kullandığı Ürünler / Tercih Ettiği Markalar — kart alt satırında ürünlerde MARKA, markalarda
  // KONUM gösterilir (bkz. js/components/architect-modal.js#renderItem).
  const usedProducts = usedProductsRes.results.map(p => {
    const parsed = parseCanonicalRow('products', p);
    return { slug: parsed.slug, title: parsed.title, images: parsed.images, category: parsed.category, brand: parsed.brand_name_raw, kind: parsed.kind };
  });
  const preferredBrands = preferredBrandsRes.results.map(b => ({ slug: b.slug, name: b.name, loc: b.loc, logo: b.logo_url, usedCount: b.used_count || 0 }));

  const item = {
    name: a.name, slug: a.slug, dob: a.dob, school: a.school, dept: a.dept, profession: a.profession,
    role: a.position, awards: a.awards, about: a.about, photo: a.photo_url, office: office ? office.name : null,
    social_links: a.social_links || [],
    // kisi-ekle.html#prefillForClaim bu değeri "Kişi sayfasında ... görünmek istiyor musunuz?"
    // sorusuna geri yazar (bkz. setDirectoryListed) — aksi halde profilini ikinci kez düzenleyen
    // biri, formun varsayılanı "Evet" olduğu için önceki "Hayır" tercihini sessizce geri alırdı.
    directory_listed: a.directory_listed,
    badges: [],
  };
  // bkz. src/routes/office.js#buildOfficePayload'daki AYNI _claimKey gerekçesi — renderProfileEditButton'ın
  // "claim=" linki HER ZAMAN orijinal statik anahtarı (legacy_key) kullanmalı, a.name bir yeniden
  // adlandırmadan sonra değişmiş olabilir. Aksi halde kisi-ekle.html'in ?claim= prefill'i eski
  // claimed_profile_key ile eşleşmez, PATCH yerine POST'a düşer ve mükerrer bir architect_submissions/
  // canonical satır oluşur (gerçek bulgu: bu, ofis tarafında zaten önlenmişken mimar tarafında eksikti).
  const isSubmissionMarker = typeof a.legacy_key === 'string' && a.legacy_key.startsWith('submission:');
  if (a.legacy_key && !isSubmissionMarker && a.legacy_key !== a.name) item._claimKey = a.legacy_key;

  const adjacent = await fetchAdjacentArchitect(env, a.id);

  return {
    item,
    office: office ? { name: office.name, loc: office.loc, cats: office.cats, yil: office.yil, logo: office.logo_url, badges: [] } : null,
    offices: [
      ...offices.map(o => ({ name: o.name, loc: o.loc, cats: o.cats, yil: o.yil, logo: o.logo_url, badges: [] })),
      ...unregisteredOffices,
    ],
    colleagues,
    relatedProjects,
    photographedProjects,
    relatedArchitects,
    relatedProducts,
    usedProducts,
    preferredBrands,
    prevItem: adjacent.prevItem,
    nextItem: adjacent.nextItem,
    hidden: !!a.hidden_at,
  };
}

// PATCH /api/profile/office — kullanıcının sahiplendiği (approved) mimar profilinin GÖRÜNEN
// firmasını (architects.office_id) değiştirir, ama yalnızca office_founders'ta zaten "ortak/kurucu"
// olarak bağlı olduğu firmalar arasında (bkz. buildArchitectPayload'daki AYNI office_founders
// sorgusu, mimar-detay sayfasındaki "kurucu/ortak olduğu firmalar" listesiyle birebir aynı kaynak).
// Rastgele bir firma adı YAZILAMAZ, yalnızca zaten bağlı olduğu firmalardan biri seçilebilir ya da
// boş bırakılıp firma bağlantısı kaldırılabilir. Not: js/components/auth-modal.js "Profili Düzenle"
// içindeki Firma kutusu bunu ÇAĞIRMIYOR — o kutu artık POST /api/claims ile "Bu firma sana mı ait?"
// kutusuyla AYNI profile_claims('office') admin-onay talebini oluşturuyor (bkz. kullanıcı isteği:
// "iki talep de admin panelinde onaya sunulsun"); bu route başka bir istemci ihtiyacı için canlı
// bırakıldı, mevcut mimar-detay davranışını (architects.office_id) etkilemeye devam ediyor.
export async function handleArchitectPrimaryOfficeRoute(request, env, url) {
  if (url.pathname !== '/api/profile/office' || request.method !== 'PATCH') return errorJson('Bulunamadı', 404);
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  const claim = await env.DB.prepare(
    `SELECT profile_key FROM profile_claims WHERE user_id = ? AND profile_type = 'architect' AND status = 'approved' LIMIT 1`
  ).bind(user.id).first();
  if (!claim) return errorJson('Önce bir mimar profili sahiplenmen gerekiyor.', 403);

  const architect = await findArchitect(env, claim.profile_key);
  if (!architect) return errorJson('Mimar profili bulunamadı.', 404);

  const body = await readJson(request);
  const officeName = (body.office || '').trim();

  if (!officeName) {
    await env.DB.prepare(`UPDATE architects SET office_id = NULL, updated_at = datetime('now') WHERE id = ?`).bind(architect.id).run();
  } else {
    const officeRow = await env.DB.prepare(
      `SELECT o.id FROM office_founders f JOIN offices o ON o.id = f.office_id
       WHERE f.architect_id = ? AND o.name = ? AND o.deleted_at IS NULL LIMIT 1`
    ).bind(architect.id, officeName).first();
    if (!officeRow) return errorJson('Yalnızca ortağı olduğun bir firmayı seçebilirsin.');
    await env.DB.prepare(`UPDATE architects SET office_id = ?, updated_at = datetime('now') WHERE id = ?`).bind(officeRow.id, architect.id).run();
  }

  await purgeSsrDetailCache('architect', architect.slug, env);
  if (architect.legacy_key && architect.legacy_key !== architect.slug) await purgeSsrDetailCache('architect', architect.legacy_key, env);
  // denetim bulgusu: bu route architects.office_id'yi değiştirip SSR detay önbelleğini temizliyordu
  // ama /api/architects liste havuzunun KV önbelleğini (bkz. publicCache.js#POOL_CACHE_KINDS)
  // temizlemiyordu — mimar listesindeki kart en fazla o havuzun TTL'i (30dk) kadar eski firma adını
  // göstermeye devam edebilirdi.
  await invalidatePublicCache(env);
  return json({ ok: true });
}
