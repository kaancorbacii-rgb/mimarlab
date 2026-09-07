// GÜNDEM -> MİMARLAB BİLGİ GRAFİĞİ EŞLEŞTİRMESİ (kullanıcı isteği, 2026-09-06 madde 12).
//
// =============================================================================================
// TEK KURAL: YENİ ENTITY UYDURULMAZ
// =============================================================================================
// AI, haber metninde gördüğü adları önerir (bkz. gundemAi.js#GUNDEM_SCHEMA.entities). Bu dosya o
// önerilerin YALNIZCA D1'de HÂLİHAZIRDA VAR OLAN bir kayda TAM olarak karşılık gelenlerini kabul
// eder. Eşleşme yoksa satır oluşturulmaz, yeni bir firma/kişi/proje/ürün ASLA yaratılmaz.
//
// NEDEN src/lib/entityMatch.js KULLANILMIYOR: o modül BULANIK (fuzzy) eşleştirme yapar — görsel
// aramada doğru araçtır, çünkü orada yanlış bir öneri kullanıcıya yalnızca alakasız bir sonuç
// gösterir. Burada yanlış bir eşleşme MİMARLAB'ın bilgi grafiğine SAHTE BİR KENAR yazar (ör.
// "Sakarya" haberini "Sakarya Mimarlık"a bağlamak) ve o kenar kalıcıdır. Bu yüzden burada
// yalnızca NORMALİZE EDİLMİŞ TAM EŞLEŞME kabul edilir — bulanıklık bilinçli olarak reddedildi.
//
// GÖRÜNTÜLEME: eşleşen entity'ler /gundem kartında tıklanabilir rozetler olarak gösterilir. Hiç
// eşleşme yoksa hiçbir şey gösterilmez — "ilk sürümde entity extraction yanlış sonuç veriyorsa
// zorla gösterme" (madde 28).

import { foldTr } from './textMatch.js';
import { officePath } from './officeUrl.js';

// Normalize: Türkçe katlama + noktalama/çoklu boşluk temizliği + yaygın hukuki eklerin atılması.
// "OMA" ile "oma", "Zaha Hadid Architects" ile "ZAHA HADID ARCHITECTS" aynı anahtara düşer;
// "Foster + Partners" ile "Foster and Partners" DÜŞMEZ (bu bilinçli — belirsizlik reddedilir).
const LEGAL_SUFFIX_RE = /\b(a\.?s|ltd|sti|inc|llc|gmbh|bv|srl|sarl|plc|co|company|arch|mimarlik|architects?)\b/g;
export function normalizeEntityName(name) {
  return foldTr(String(name || ''))
    .replace(/[^a-z0-9\s+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Hukuki ek/jenerik kuyruk atılmış ikinci bir anahtar — "OMA" ile "OMA Architects" gibi çiftleri
// yakalar. Tek başına KULLANILMAZ: yalnızca birincil anahtar tutmadığında ve sonuç TEK bir kayda
// işaret ettiğinde devreye girer (bkz. buildEntityIndex'teki ambiguous işaretlemesi).
function looseEntityName(name) {
  return normalizeEntityName(name).replace(LEGAL_SUFFIX_RE, ' ').replace(/\s+/g, ' ').trim();
}

// ÇOK JENERİK ADLAR — bir haber metninde tesadüfen geçmesi çok olası olduğu için asla eşleştirilmez.
// (Gerçek risk: D1'de "Studio", "Atölye", "Design" gibi kısa/jenerik adlı kayıtlar bulunabiliyor.)
const GENERIC_NAMES = new Set([
  'studio', 'atolye', 'design', 'tasarim', 'mimarlik', 'architects', 'architecture', 'office',
  'yapi', 'proje', 'group', 'grup', 'lab', 'workshop', 'atelier', 'house', 'ev', 'a', 'the',
]);

// Bir adın eşleştirilmeye ADAY olup olmadığı. Çok kısa (3 karakterin altı) adlar da elenir —
// "AB", "MM" gibi kısaltmalar bir metinde tesadüfen çok kolay geçer.
function isMatchableName(normalized) {
  if (!normalized || normalized.length < 3) return false;
  if (GENERIC_NAMES.has(normalized)) return false;
  return true;
}

// Havuzlardan (KV önbellekli, ek D1 maliyeti YOK — bkz. publicCache.js#getCachedPool) tek bir
// arama dizini kurar. Aynı normalize ada birden fazla kayıt düşerse o anahtar BELİRSİZ işaretlenir
// ve hiçbir zaman eşleşmez (bkz. proje notu: architects/offices her yerde çıplak isimle
// anahtarlanıyor ve yinelenen adlar gerçek bir sorun — belirsizliği eşleştirmemek doğru davranış).
export function buildGundemEntityIndex({ offices = [], architects = [], projects = [], products = [] }) {
  const exact = new Map();   // normalize ad -> kayıt | 'ambiguous'
  const loose = new Map();   // ek-atılmış ad  -> kayıt | 'ambiguous'

  const add = (map, key, record) => {
    if (!isMatchableName(key)) return;
    if (map.has(key)) { map.set(key, 'ambiguous'); return; }
    map.set(key, record);
  };

  for (const o of offices) {
    if (!o || !o.name || !o.slug) continue;
    const record = {
      type: 'office',
      key: o.slug,
      name: o.name,
      // Saf marka mı firma mı — kanonik önekin tek kaynağı (bkz. officeUrl.js).
      href: officePath(o.slug, o.cats, o.productCount),
    };
    add(exact, normalizeEntityName(o.name), record);
    add(loose, looseEntityName(o.name), record);
  }
  for (const a of architects) {
    if (!a || !a.name || !a.slug) continue;
    const record = { type: 'architect', key: a.slug, name: a.name, href: `/kisi/${encodeURIComponent(a.slug)}` };
    add(exact, normalizeEntityName(a.name), record);
    add(loose, looseEntityName(a.name), record);
  }
  for (const p of products) {
    if (!p || !p.title || !p.slug) continue;
    const record = { type: 'product', key: p.slug, name: p.title, href: `/urun/${encodeURIComponent(p.slug)}` };
    add(exact, normalizeEntityName(p.title), record);
  }
  for (const p of projects) {
    if (!p || !p.title || !p.slug) continue;
    // Proje adları için ek bir eşik: 6 karakterin altındaki proje adları ("Y Evi" gibi) bir haber
    // metninde tesadüfen geçmeye çok açık.
    const key = normalizeEntityName(p.title);
    if (key.length < 6) continue;
    add(exact, key, { type: 'project', key: p.slug, name: p.title, href: `/proje/${encodeURIComponent(p.slug)}` });
  }
  return { exact, loose };
}

// AI'nin önerdiği adları dizine karşı çözer. Dönen her öğe GERÇEK bir D1 kaydına işaret eder.
// `kind` (AI'nin tahmin ettiği tür) BİLEREK yok sayılır: eşleşen kaydın GERÇEK türü kullanılır —
// AI "office" dese de kayıt bir kişiyse doğru olan kayıttır, AI değil.
export function resolveGundemEntities(index, suggestions, { limit = 4 } = {}) {
  if (!index || !Array.isArray(suggestions)) return [];
  const out = [];
  const seen = new Set();
  for (const s of suggestions) {
    if (out.length >= limit) break;
    const rawName = s && typeof s.name === 'string' ? s.name.trim() : '';
    if (!rawName) continue;
    const exactKey = normalizeEntityName(rawName);
    let record = index.exact.get(exactKey);
    if (record === 'ambiguous') continue;
    if (!record) {
      const looseKey = looseEntityName(rawName);
      // Gevşek eşleşme yalnızca birincil anahtardan FARKLIYSA denenir — aksi halde aynı aramayı
      // tekrarlamış oluruz ve "ambiguous" bilgisi kaybolur.
      if (looseKey && looseKey !== exactKey) {
        const looseHit = index.loose.get(looseKey);
        if (looseHit && looseHit !== 'ambiguous') record = looseHit;
      }
    }
    if (!record) continue;
    const dedupeKey = `${record.type}:${record.key}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(record);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// METİN TARAMASI — AI önerisinin TAMAMLAYICISI (kullanıcı isteği, 2026-09-07: "Foster + Partners'ı
// etiketlediğin gibi ilgili olan TÜM gönderilere etiketlemeler yap").
//
// NEDEN GEREKLİ — ölçüm: canlıdaki 205 yayının yalnızca 10'unda etiket vardı. Sebep, eşleştirmenin
// AI'nin `entities` önerisine bağlı olması: model çoğu özette hiç ad önermiyor, önerdiğinde de
// bazen metinde geçmeyen bir ad uyduruyor. Yani darboğaz EŞLEŞTİRME değil, ÖNERİ aşamasıydı.
//
// BU TARAMA DAHA GÜVENLİ, DAHA ZAYIF DEĞİL: hâlâ TEK kural geçerli — yalnızca D1'de VAR OLAN bir
// kaydın adı, başlık/özet metninde TAM KELİME olarak geçiyorsa eşleşir. Bulanık eşleştirme yok,
// yeni entity yaratılmıyor. AI'den farkı, adı UYDURAMAMASI: taranan metin zaten yayınlanan metnin
// kendisidir.
//
// TAM KELİME ŞARTI: metin de dizin anahtarlarıyla AYNI fonksiyondan (normalizeEntityName) geçirilir
// ve arama boşlukla çevrelenmiş olarak yapılır. Aksi halde "OMA" adı "ROMA" içinde eşleşirdi —
// gerçek bir risk, çünkü dizinde üç harfli kayıtlar var.
// TEK KELİMELİK ADLAR TARAMADA KABUL EDİLMEZ — ölçülmüş karar, temkin değil. İlk kuru çalıştırmada
// 47 aday kenarın 26'sı tek kelimelik ÜRÜN adlarından geliyordu ve neredeyse tamamı çöptü:
// "Koleksiyon" Türkçe'nin kendi kelimesiyle, "Plan"/"Point"/"Frame"/"Grid"/"Levels"/"Luce"/"Casa"
// sıradan kelimelerle, "York" ise "New York" ifadesinin İÇİNDEKİ kelimeyle eşleşiyordu. Bu kenarlar
// KALICIDIR ve yanlış firmanın profilinde alakasız bir haber gösterirler — bu dosyanın başındaki
// "sahte kenar yazma" kuralının tam olarak yasakladığı şey.
//
// İSTİSNA: KISALTMALAR. "OMA", "MVRDV", "BIG" gerçek ve sık geçen ofis adlarıdır. Bunlar yalnızca
// kanonik kayıtta BÜYÜK HARFLİ bir kısaltma iseler VE metinde de aynı büyük harfli biçimde
// geçiyorlarsa kabul edilir — "oma" küçük harfle geçen bir kelimeyle eşleşemez.
//
// ÜRÜNLER TARAMA DIŞIDIR: ürün adları model adlarıdır ("Sol", "Linea", "Karma") ve bir haber
// metninde tesadüfen geçme olasılıkları en yüksek olan kümedir. Ürün etiketi yine AI önerisiyle
// gelebilir — orada modelin bağlamı vardır ("X markasının Y koltuğu").
const ACRONYM_RE = /^[A-Z0-9]{2,6}$/;

function isScannableRecord(record, key) {
  if (!record || record === 'ambiguous') return false;
  if (record.type === 'product') return false;
  if (key.includes(' ')) return true;
  return ACRONYM_RE.test(String(record.name || '').trim());
}

export function scanTextForEntities(index, text, { limit = 4 } = {}) {
  if (!index || !text) return [];
  const raw = String(text);
  // TÜRKÇE KESME İŞARETİ EKİ ATILIR — gerçek bulgu (kuru çalıştırma, 2026-09-07): normalizeEntityName
  // noktalamayı BOŞLUĞA çevirdiği için "Urfa'da mimarlık" metni "urfa da mimarlik" oluyordu ve
  // dizindeki "DA Mimarlık" adlı firmayla TAM KELİME eşleşiyordu. Aynı tuzak "Peru'da mimarlık"ta
  // da tetiklendi. Türkçede kesme işareti özel ada gelen GRAMER ekini ayırır; o ek bir ad parçası
  // değildir, atılmalıdır. Bu ayrıca DOĞRU eşleşmeleri de kurtarır: "Mimar Sinan'ın 140 yılı"
  // -> "Mimar Sinan 140 yılı" ve "Mimar Sinan" kaydıyla eşleşir (eki boşluğa çevirmek onu
  // "mimar sinan in" yapıp eşleşmeyi bozardı).
  // Hem düz (') hem tipografik (’) kesme işareti; ek en fazla birkaç harftir.
  const deSuffixed = raw.replace(/['\u2019][a-zçğıöşüA-ZÇĞİÖŞÜ]{1,4}\b/g, '');
  const haystack = ` ${normalizeEntityName(deSuffixed)} `;
  if (haystack.length < 5) return [];
  const out = [];
  const seen = new Set();
  // Uzun adlar önce: "Zaha Hadid Architects" ile "Zaha Hadid" ikisi de dizindeyse, daha AZ belirsiz
  // olan uzun ad kazanmalı.
  const keys = [...index.exact.keys()].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (out.length >= limit) break;
    const record = index.exact.get(key);
    if (!isScannableRecord(record, key)) continue;
    if (!haystack.includes(` ${key} `)) continue;
    // Kısaltmalar için ek kapı: metinde de BÜYÜK HARFLİ geçmeli. normalizeEntityName her şeyi
    // küçülttüğü için bu kontrol HAM metinde, kelime sınırlarıyla yapılır.
    if (!key.includes(' ')) {
      const acronym = String(record.name || '').trim();
      const wordRe = new RegExp(`(^|[^A-Za-z0-9])${acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`);
      if (!wordRe.test(raw)) continue;
    }
    const dedupeKey = `${record.type}:${record.key}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(record);
  }
  return out;
}

// AI önerileri + metin taraması, ÖNERİLER ÖNCELİKLİ olacak şekilde birleştirilir. AI bir adı
// önerdiyse o gerçekten öne çıkan öznedir; tarama ise metinde geçen diğer kayıtları toplar.
export function resolveGundemEntitiesWithScan(index, suggestions, text, { limit = 4 } = {}) {
  const fromAi = resolveGundemEntities(index, suggestions, { limit });
  if (fromAi.length >= limit) return fromAi;
  const seen = new Set(fromAi.map(e => `${e.type}:${e.key}`));
  const out = fromAi.slice();
  for (const rec of scanTextForEntities(index, text, { limit })) {
    if (out.length >= limit) break;
    const k = `${rec.type}:${rec.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(rec);
  }
  return out;
}
