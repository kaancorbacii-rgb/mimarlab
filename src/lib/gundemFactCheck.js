// GÜNDEM — FACT-CONSISTENCY CHECK (kullanıcı isteği, 2026-09-13 madde 5).
//
// SORU: "üretilen başlık ve özet kaynak metne karşı kontrol edilmeli — kaynakta olmayan bilgi var
// mı, yanlış tarih/şehir/isim var mı, başlık özetle uyumlu mu?"
//
// NEDEN AYRI BİR DOSYA: gundemQuality.js'teki kapılar BİÇİMSEL (uzunluk, tek paragraf, dil,
// clickbait) ve tamamı ucuz dize işlemi. Buradaki kapılar İÇERİK düzeyinde ve her biri kendi
// yanlış-pozitif riskini taşıyor; ayrı dosyada her kapının gerekçesi ve EŞİĞİ tek tek okunabilir
// kalıyor. validateAiOutput bu dosyadan TEK bir fonksiyon çağırır.
//
// =============================================================================================
// TASARIM İLKESİ — YANLIŞ POZİTİF MALİYETİ
// =============================================================================================
// Bu hatta bir içeriğin reddedilmesi "o içerik hiç yayınlanmaz" demektir (retry hakkı bitince
// güvenli fallback = atlama). Yani aşırı hassas bir doğruluk kapısı, koruduğu şeyden daha fazlasını
// keser — bu depoda bir kez YAŞANMIŞ bir hatadır (bkz. gundemQuality.js#titleOverlapsSource'un
// "4 karakter eşiği OMA/BIG/SOM'u eliyordu" notu). Bu yüzden:
//
//   * SAYI kapısı SERTTİR (eşik 1): bir sayı ya kaynakta vardır ya yoktur; uydurulmuş bir
//     metrekare/tarih/yüzde en ciddi halüsinasyon türüdür ve ölçümü tartışmasızdır.
//   * ÖZEL AD kapısı YUMUŞAKTIR (eşik 2): çeviri özel adları yerelleştirir (Venice → Venedik),
//     Türkçe çeviri ada yeni kelimeler ekler (Design Museum → Tasarım Müzesi). Tek bir
//     desteklenmeyen ad dizisi reddetmek için YETERLİ DEĞİLDİR.
//   * Geri kalan kapılar (leftover English, mekanik tekrar, kapsama) DÜZELTİLEBİLİR kusurlardır:
//     ilk denemede yakalanırsa modele ne yanlış yaptığı söylenip yeniden üretilir.

import { foldTr } from './textMatch.js';

// -----------------------------------------------------------------------------------------------
// 1. SAYI TUTARLILIĞI
// -----------------------------------------------------------------------------------------------
// Çıktıdaki her sayı kaynakta da geçmeli. Normalizasyon: binlik/ondalık ayraçları atılır
// ("1.200" ve "1,200" ve "1200" aynı sayıdır), sayının başındaki/sonundaki ek ("2026'da",
// "19'uncu") ayıklanır.
function numberSet(text) {
  const out = new Set();
  const m = String(text || '').match(/\d[\d.,]*/g) || [];
  for (const raw of m) {
    const norm = raw.replace(/[.,]/g, '').replace(/^0+(?=\d)/, '');
    if (norm) out.add(norm);
  }
  return out;
}

// Kaynakta YAZIYLA geçen sayılar da "kaynakta var" sayılır: İngilizce kaynakta "two towers",
// Türkçe kaynakta "iki kule" yazıyorsa modelin "2 kule" yazması halüsinasyon DEĞİLDİR.
//
// SIRA SAYILARI DA BURADA (ölçüm gerekçesi): kaynak "the nineteenth century" ya da "a dozen
// schools" yazdığında doğru Türkçe karşılık "19. yüzyıl" / "12 okul" olur — yani RAKAM. Sıra
// sayıları listede olmasa bu doğru çeviriler "kaynakta olmayan sayı" sayılıp elenirdi.
const WORD_NUMBERS = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8',
  nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14',
  fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
  twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70',
  eighty: '80', ninety: '90', hundred: '100', thousand: '1000', million: '1000000',
  dozen: '12', dozens: '12',
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6', seventh: '7',
  eighth: '8', ninth: '9', tenth: '10', eleventh: '11', twelfth: '12', thirteenth: '13',
  fifteenth: '15', sixteenth: '16', seventeenth: '17', eighteenth: '18', nineteenth: '19',
  twentieth: '20',
  bir: '1', iki: '2', uc: '3', dort: '4', bes: '5', alti: '6', yedi: '7', sekiz: '8',
  dokuz: '9', on: '10', yirmi: '20', otuz: '30', kirk: '40', elli: '50', altmis: '60',
  yetmis: '70', seksen: '80', doksan: '90', yuz: '100', bin: '1000', milyon: '1000000',
  birinci: '1', ikinci: '2', ucuncu: '3', dorduncu: '4', besinci: '5', altinci: '6',
  yedinci: '7', sekizinci: '8', dokuzuncu: '9', onuncu: '10', onbes: '15', yirminci: '20',
};

function sourceNumberSet(sourceText, extraYears) {
  const set = numberSet(sourceText);
  const folded = foldTr(sourceText);
  for (const [word, digits] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`).test(folded)) set.add(digits);
  }
  for (const y of extraYears || []) if (y) set.add(String(y));
  return set;
}

// "İlk", "tek", "yüzde" gibi sayısal OLMAYAN bağlamlardan gelen tek haneli değerler için ayrı bir
// muafiyet YOK — çünkü model bunları yazıyla yazar ("ilk", "tek"), rakamla yazdıysa kaynakta bir
// karşılığı olmalıdır.
export function checkNumbers(outputText, sourceText, { publishedYears } = {}) {
  const src = sourceNumberSet(sourceText, publishedYears);
  const unsupported = [];
  for (const n of numberSet(outputText)) if (!src.has(n)) unsupported.push(n);
  return { ok: unsupported.length === 0, unsupported };
}

// -----------------------------------------------------------------------------------------------
// 2. ÖZEL AD TUTARLILIĞI
// -----------------------------------------------------------------------------------------------
// TÜRKÇELEŞEN YER/ULUS ADLARI. Doğru bir çeviri kaynakla tek bir harf paylaşmayabilir
// ("Copenhagen" → "Kopenhag"); bu eşleme olmadan doğru çeviriler "kaynakta yok" diye elenir.
// Liste mimarlık yayıncılığında GERÇEKTEN geçen adlarla sınırlı — eksiksiz bir atlas değil.
const TR_EXONYMS = {
  londra: ['london'], seul: ['seoul'], kopenhag: ['copenhagen'], viyana: ['vienna', 'wien'],
  milano: ['milan', 'milano'], roma: ['rome', 'roma'], atina: ['athens'], moskova: ['moscow'],
  pekin: ['beijing', 'peking'], lizbon: ['lisbon', 'lisboa'], prag: ['prague', 'praha'],
  varsova: ['warsaw', 'warszawa'], bukres: ['bucharest'], selanik: ['thessaloniki', 'salonica'],
  kahire: ['cairo'], sanghay: ['shanghai'], cenevre: ['geneva', 'genève'], zurih: ['zurich'],
  munih: ['munich', 'münchen'], koln: ['cologne', 'köln'], floransa: ['florence', 'firenze'],
  venedik: ['venice', 'venezia'], napoli: ['naples', 'napoli'], bruksel: ['brussels', 'bruxelles'],
  kudus: ['jerusalem'], sam: ['damascus'], bagdat: ['baghdad'], tahran: ['tehran'],
  singapur: ['singapore'], tokyo: ['tokyo'], newyork: ['new york'], sidney: ['sydney'],
  hollanda: ['netherlands', 'dutch', 'holland'], hollandali: ['netherlands', 'dutch'],
  ingiltere: ['england', 'english', 'britain', 'british', 'uk'],
  almanya: ['germany', 'german'], alman: ['germany', 'german'],
  fransa: ['france', 'french'], fransiz: ['france', 'french'],
  italya: ['italy', 'italian'], italyan: ['italy', 'italian'],
  ispanya: ['spain', 'spanish'], ispanyol: ['spain', 'spanish'],
  japonya: ['japan', 'japanese'], japon: ['japan', 'japanese'],
  cin: ['china', 'chinese'], hindistan: ['india', 'indian'], rusya: ['russia', 'russian'],
  danimarka: ['denmark', 'danish'], danimarkali: ['denmark', 'danish'],
  isvec: ['sweden', 'swedish'], norvec: ['norway', 'norwegian'],
  finlandiya: ['finland', 'finnish'], isvicre: ['switzerland', 'swiss'],
  avusturya: ['austria', 'austrian'], belcika: ['belgium', 'belgian'],
  portekiz: ['portugal', 'portuguese'], yunanistan: ['greece', 'greek'],
  misir: ['egypt', 'egyptian'], kore: ['korea', 'korean'], guneykore: ['south korea'],
  meksika: ['mexico', 'mexican'], brezilya: ['brazil', 'brazilian'],
  arjantin: ['argentina'], sili: ['chile'], kanada: ['canada', 'canadian'],
  avustralya: ['australia', 'australian'], yenizelanda: ['new zealand'],
  suudiarabistan: ['saudi'], katar: ['qatar'], dubai: ['dubai'],
  birlesikaraperimlikleri: ['uae', 'emirates'], abd: ['us', 'usa', 'united states', 'american', 'america'],
  amerikan: ['american', 'america', 'us', 'usa'], birlesikkrallik: ['uk', 'united kingdom', 'britain'],
  turkiye: ['turkey', 'türkiye', 'turkish'], turk: ['turkey', 'turkish'],
  istanbul: ['istanbul'], izmir: ['izmir'], ankara: ['ankara'],
  avrupa: ['europe', 'european'], avrupali: ['europe', 'european'],
  asya: ['asia', 'asian'], afrika: ['africa', 'african'], kuzeyamerika: ['north america'],
};

// TERS EŞLEME (İngilizce → Türkçe). titleOverlapsSource'un "kaynaktaki çapa çıktıda var mı?"
// kapısı için gerekli: kaynak "Europe" yazıyor, doğru çeviri "Avrupa" yazıyor ve iki metin tek
// bir harf paylaşmıyor. Tablo TEK KAYNAKTAN üretilir, iki liste ayrışamaz.
const EN_TO_TR = (() => {
  const map = new Map();
  for (const [tr, alts] of Object.entries(TR_EXONYMS)) {
    for (const alt of alts) {
      const key = alt.replace(/[^a-z0-9]/g, '');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(tr);
    }
  }
  return map;
})();

// TÜRKÇE ÇEVİRİNİN ÜRETTİĞİ BÜYÜK HARFLİ KELİMELER. Bunlar kaynakta ASLA bulunmaz çünkü çevirinin
// kendisi tarafından üretilirler ("Design Museum" → "Tasarım Müzesi", "Venice Biennale" →
// "Venedik Bienali"). Ad kapısında sayılmazlar.
const TRANSLATION_CAPITALS = new Set([
  'muzesi', 'muze', 'bienali', 'bienal', 'odulleri', 'odulu', 'merkezi', 'merkez', 'meydani',
  'caddesi', 'sokagi', 'parki', 'bahcesi', 'havalimani', 'bolgesi', 'adasi', 'kulesi', 'kopru',
  'koprusu', 'camii', 'cami', 'kilisesi', 'sarayi', 'kutuphanesi', 'fuari', 'festivali',
  'yarismasi', 'sergisi', 'universitesi', 'universite', 'belediyesi', 'bakanligi', 'vakfi',
  'dernegi', 'odasi', 'enstitusu', 'akademisi', 'okulu', 'hastanesi', 'oteli', 'stadyumu',
  'terminali', 'istasyonu', 'limani', 'galerisi', 'pavyonu', 'pavilyonu', 'konagi', 'evi',
  'yapisi', 'binasi', 'projesi', 'tasarim', 'tasarimi', 'mimarlik', 'mimarligi', 'mimarlar',
  'kent', 'kenti', 'sehir', 'sehri', 'devlet', 'cumhuriyeti', 'cumhuriyet', 'krallik', 'krallgi',
  'avrupa', 'asya', 'afrika', 'amerika', 'akdeniz', 'ege', 'karadeniz', 'anadolu', 'balkanlar',
  'dogu', 'bati', 'kuzey', 'guney', 'ortadogu', 'uzakdogu', 'dunya', 'birlesmis', 'milletler',
  'ulusal', 'uluslararasi', 'kraliyet', 'ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran',
  'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik', 'pazartesi', 'sali', 'carsamba',
  'persembe', 'cuma', 'cumartesi', 'pazar',
]);

// KAYNAK METNİN TOKEN KÜMESİ. Eskiden ham dize üzerinde `sourceFold.includes(bare)` yapılıyordu;
// bu SESSİZ BİR YANLIŞ NEGATİF kaynağıydı — GERÇEK BULGU (bu dosyanın regresyon testi):
// uydurulmuş "Tadao Ando" adı, kaynaktaki "Kuma and Associates" ifadesinin içindeki "and"
// parçasına ek soyma yoluyla eşleşiyor ve halüsinasyon kapıdan geçiyordu. Karşılaştırma artık
// KELİME düzeyinde yapılır.
function sourceTokens(sourceText) {
  return new Set(
    foldTr(sourceText || '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  );
}

// Bir kelimenin kaynakta geçip geçmediği. Türkçe ÇEKİM EKLERİ yüzünden tam eşitlik aranamaz
// ("Hadid'in", "Seul'de", "OMA'nın") — kesme işareti ve sonrası atılır, ardından kaynağın
// kelimeleriyle ÖN EK ilişkisi aranır. Ön ek eşleşmesinde kısa taraf EN AZ 4 HARF olmalı:
// 3 harfte "and" ⊂ "ando" gibi tesadüfi eşleşmeler halüsinasyonu görünmez kılıyordu.
const PREFIX_MIN_LEN = 4;

function tokenSupported(token, srcTokens) {
  const bare = foldTr(token).replace(/['’].*$/, '').replace(/[^a-z0-9]/g, '');
  if (bare.length < 3) return true; // çok kısa: karar verilemez, engelleme
  if (srcTokens.has(bare)) return true;
  for (const s of srcTokens) {
    if (s.length >= PREFIX_MIN_LEN && bare.startsWith(s)) return true;
    if (bare.length >= PREFIX_MIN_LEN && s.startsWith(bare)) return true;
  }
  const exonym = TR_EXONYMS[bare];
  if (exonym) {
    for (const alt of exonym) {
      const parts = alt.split(/\s+/);
      if (parts.every(part => srcTokens.has(part.replace(/[^a-z0-9]/g, '')))) return true;
    }
  }
  return false;
}

// Cümle başındaki kelime her dilde büyük harfle başlar — özel ad sinyali DEĞİLDİR ve atlanır.
// Aynı şey başlığın ilk kelimesi için de geçerli.
function capitalizedSequences(text) {
  const sequences = [];
  for (const sentence of String(text || '').split(/(?<=[.!?…])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    let run = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i].replace(/^[("'“‘]+|[)"'”’,;:.!?]+$/g, '');
      const isCap = /^[A-ZÇĞİÖŞÜ]/.test(w) && w.length > 1;
      // i === 0: cümlenin ilk kelimesi — büyük harfli olması bilgi taşımaz.
      if (isCap && i > 0) { run.push(w); continue; }
      if (run.length) { sequences.push(run); run = []; }
    }
    if (run.length) sequences.push(run);
  }
  return sequences;
}

// Kaynakta desteklenmeyen özel ad dizileri. Çeviri tarafından ÜRETİLEN büyük harfli kelimeler
// (TRANSLATION_CAPITALS) dizinin içinden atılır; dizide kalan kelimelerin HİÇBİRİ kaynakta yoksa
// dizi "desteklenmeyen" sayılır.
export function unsupportedNames(outputText, sourceText) {
  const srcTokens = sourceTokens(sourceText);
  const out = [];
  for (const seq of capitalizedSequences(outputText)) {
    const real = seq.filter(w => !TRANSLATION_CAPITALS.has(foldTr(w).replace(/[^a-z0-9]/g, '')));
    if (!real.length) continue;
    if (real.some(w => tokenSupported(w, srcTokens))) continue;
    out.push(real.join(' '));
  }
  return [...new Set(out)];
}

// -----------------------------------------------------------------------------------------------
// 3. ÇEVRİLMEDEN KALAN İNGİLİZCE MİMARLIK TERİMLERİ (madde 1: "Başlıkta gereksiz İngilizce
//    bırakma", madde 6: "İngilizce/Türkçe karışık anlamsız ifadeler")
// -----------------------------------------------------------------------------------------------
// BÜYÜK/KÜÇÜK HARF DUYARLI, bilerek: "Serpentine Pavilion" ya da "Design Museum" bir ÖZEL ADDIR ve
// özgün halinde kalması DOĞRUDUR (madde 1: "Özel isimleri doğru koru"). Aynı kelimenin KÜÇÜK
// harfli hali ise çevrilmemiş bir cins isimdir — aradığımız kusur tam olarak bu.
const LEFTOVER_EN_TERMS = new RegExp(
  '\\b(?:' + [
    'facade', 'facades', 'façade', 'housing', 'mixed-use', 'mixed use', 'public realm',
    'adaptive reuse', 'heritage', 'scheme', 'schemes', 'landmark', 'landmarks', 'intervention',
    'interventions', 'masterplan', 'master plan', 'refurbishment', 'retrofit', 'cladding',
    'courtyard', 'dwelling', 'dwellings', 'streetscape', 'skyline', 'storey', 'storeys',
    'listed building', 'planning permission', 'urban fabric',
    'building', 'buildings', 'architect', 'architects', 'architecture', 'architectural',
    'design', 'designed', 'designs', 'project', 'projects', 'interior', 'interiors',
    'construction', 'renovation', 'exhibition', 'competition', 'award', 'awards',
    'completed', 'features', 'located', 'unveiled', 'practice',
    'timber', 'pavilion', 'tower', 'museum', 'library', 'gallery', 'waterfront',
    'rooftop', 'extension', 'refurb', 'developer', 'client',
  ].join('|') + ')\\b'
);

export function leftoverEnglishTerm(text) {
  const m = LEFTOVER_EN_TERMS.exec(String(text || ''));
  return m ? m[0] : null;
}

// -----------------------------------------------------------------------------------------------
// 3b. TÜRKÇE OLMAYAN YAZI SİSTEMİ / YABANCI DİL ARTIĞI
// -----------------------------------------------------------------------------------------------
// CANLI BULGU (yeniden üretim turu, 2026-09-13 — yayındaki metinlerde ölçüldü): model, Türkçe bir
// cümlenin ORTASINA başka bir dilden tek bir kelime/karakter bırakabiliyor. Gerçek örnekler:
//   • "1436'da Floransa'da completed Santa Maria del Fiore kubbesi" (yayında duruyordu)
//   • "Mimari tarihinde önemli bir 章 olan..." ve "artık 主要 olarak..." (Çince karakter)
//   • "İnşaat nächsten yıl başlayacak." (Almanca)
// Bunlar okuyucuya doğrudan "makine çevirisi" olarak görünür — kullanıcının "daha doğru bir
// Türkçe" isteğinin tam olarak şikâyet ettiği kusur. LEFTOVER_EN_TERMS bunları yakalamıyordu:
// o liste İngilizce MİMARLIK terimlerine göre kurulu.
//
// İKİ AYRI KURAL:
//   (a) YAZI SİSTEMİ — Çince/Japonca/Korece/Kiril/Yunan/İbrani/Arap harfleri. Türkçe bir mimarlık
//       özetinde bunlar HİÇBİR koşulda meşru değildir (özel adlar da Latin harfleriyle yazılır:
//       kaynak metinler İngilizce/Türkçe). Tartışmasız hata.
//   (b) YABANCI İŞLEV KELİMESİ — Almanca/Fransızca/İtalyanca/İspanyolca bağlaç ve yardımcı
//       fiiller. İngilizce kelimeler bu listede YOKTUR; onları LEFTOVER_EN_TERMS zaten kapsıyor.
//
// (b) LİSTESİ NEDEN BU KADAR DAR — GERÇEK BULGU (bu değişikliğin ilk hâli, kalite korpusunda
// yakalandı): listeye İngilizce işlev kelimeleri de konmuştu ve "Kengo Kuma and Associates"
// KUSURSUZ bir özeti reddettirdi; aynı desen "Allies and Morrison" ve "Design By Them" gibi
// gerçek ofis adlarını da eleyecekti. Yani bir ÖZEL ADIN İÇİNDE geçebilen hiçbir kelime bu
// listeye giremez. Kural: yalnızca bir mimarlık ofisi/proje adının parçası olması pratikte
// imkânsız olan bağlaç/yardımcı fiiller.
const FOREIGN_SCRIPT_RE = /[\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

const FOREIGN_WORD_RE = new RegExp(
  '(?<![A-Za-zÇĞİÖŞÜçğıöşü])(?:' + [
    // Almanca
    'nächste', 'nächsten', 'wurde', 'werden', 'nicht', 'dass', 'jedoch', 'zwischen',
    // Fransızca
    'avec', 'pour', 'dans', 'être', 'sont', 'mais', 'cette', 'ainsi',
    // İspanyolca / İtalyanca
    'como', 'pero', 'della', 'nella', 'sono', 'anche',
  ].join('|') + ')(?![A-Za-zÇĞİÖŞÜçğıöşü-])'
);

// MELEZ ÖNEK — "self-yönetim", "multi-fonksiyonlu": İngilizce önek + Türkçe gövde. Ayrı bir desen,
// çünkü yukarıdaki kelime deseninin sonundaki "harf gelmesin" koşulu tam da bu birleşimi kaçırır
// (önekten SONRA zaten harf gelir).
const HYBRID_PREFIX_RE = /(?<![A-Za-zÇĞİÖŞÜçğıöşü])(?:self|multi|cross|non|pre|post|sub)-(?=[a-zçğıöşü])/;

// Dönen değer: bulunan yabancı parça (hata detayı için) ya da null.
export function foreignLanguageLeftover(text) {
  const s = String(text || '');
  const script = FOREIGN_SCRIPT_RE.exec(s);
  if (script) return script[0];
  const word = FOREIGN_WORD_RE.exec(s);
  if (word) return word[0];
  const hybrid = HYBRID_PREFIX_RE.exec(s);
  return hybrid ? hybrid[0] : null;
}

// -----------------------------------------------------------------------------------------------
// 4. MEKANİK TEKRAR (madde 2: "'Bu proje...', 'Bu yapı...' gibi art arda başlayan mekanik
//    cümlelerden kaçınacak"; madde 6: "tekrar eden ifadeler")
// -----------------------------------------------------------------------------------------------
// İKİ KURAL, bilerek:
//   (a) İlk kelime ÜÇ ya da daha fazla cümlede aynıysa mekaniktir. "Bu gelenekte...", "Bu yapı
//       kültürü...", "Bu gelenek..." — GERÇEK BULGU (regresyon testi): bu üç cümle İLK İKİ
//       kelimesiyle birbirinden farklıdır ve yalnızca iki kelimeye bakan kural onları kaçırıyordu,
//       oysa kullanıcının şikâyet ettiği kusur tam olarak budur.
//   (b) İlk iki kelime İKİ cümlede aynıysa mekaniktir; ikinci kelime GÖVDESİYLE karşılaştırılır
//       ("Bu gelenekte" ile "Bu gelenek" aynı kalıptır).
const MECHANICAL_FIRST_WORD_LIMIT = 3;
const MECHANICAL_PAIR_LIMIT = 2;

export function mechanicalRepetition(summary) {
  const sentences = String(summary || '').split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
  const firstWords = new Map();
  const pairs = new Map();
  for (const s of sentences) {
    const words = foldTr(s).replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const w0 = words[0];
    if (w0.length >= 2) {
      firstWords.set(w0, (firstWords.get(w0) || 0) + 1);
      if (firstWords.get(w0) >= MECHANICAL_FIRST_WORD_LIMIT) return w0;
    }
    if (words.length >= 2) {
      const key = `${w0} ${words[1].slice(0, 4)}`;
      if (key.length < 4) continue;
      pairs.set(key, (pairs.get(key) || 0) + 1);
      if (pairs.get(key) >= MECHANICAL_PAIR_LIMIT) return key;
    }
  }
  return null;
}

// Aynı 5 kelimelik dizinin iki kez geçmesi — modelin kendini tekrar ettiğinin en net işareti.
export function repeatedNgram(text, n = 5) {
  const words = foldTr(text || '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const seen = new Set();
  for (let i = 0; i + n <= words.length; i++) {
    const gram = words.slice(i, i + n).join(' ');
    if (seen.has(gram)) return gram;
    seen.add(gram);
  }
  return null;
}

// -----------------------------------------------------------------------------------------------
// 5. KAPSAMA — "özet kaynağın yalnızca ilk cümlesini mi yeniden yazdı?" (madde 2 ve madde 6)
// -----------------------------------------------------------------------------------------------
// YALNIZCA TÜRKÇE KAYNAKLARDA UYGULANIR. İngilizce kaynakta özet ile kaynak metin AYRI DİLDEDİR;
// kelime örtüşmesi yalnızca özel ad/sayı üzerinden olur ve bir "kapsama" ölçüsü olarak güvenilmez
// — orada bu kapı yanlış pozitif üretirdi. Türkçe kaynakta (Arkitera, Mimdap, Mimarizm, Bigumigu)
// ise özet kaynakla aynı dildedir ve ölçü anlamlıdır.
//
// ÖLÇÜ: kaynağın SON %45'indeki ayırt edici kelimelerden en az biri özette geçmeli. Geçmiyorsa
// özet metnin yalnızca başını görmüş demektir.
const COVERAGE_TAIL_RATIO = 0.45;
// EŞİK 60 KELİME (ölçüm, 2026-09-13): Türkçe kaynakların feed açıklamaları tipik olarak 40-90
// kelime. 90'lık bir eşik kapıyı pratikte HİÇ çalıştırmıyordu (yani ölü koddu); 60, "kaynakta
// gerçekten ikinci bir bilgi kümesi var" demek için yeterli, 40'ın altındaki tek paragraflık
// excerpt'lerde ise kapı hâlâ sessiz kalır.
const COVERAGE_MIN_SOURCE_WORDS = 60;

export function coversSourceTail(summary, sourceText) {
  const words = String(sourceText || '').split(/\s+/).filter(Boolean);
  if (words.length < COVERAGE_MIN_SOURCE_WORDS) return true; // ölçü anlamsız
  const tail = words.slice(Math.floor(words.length * (1 - COVERAGE_TAIL_RATIO))).join(' ');
  const headFold = foldTr(words.slice(0, Math.floor(words.length * (1 - COVERAGE_TAIL_RATIO))).join(' '));
  const summaryFold = foldTr(summary || '');
  const tailTokens = [...new Set(
    foldTr(tail).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 5)
  )]
    // Kuyrukta geçen ama BAŞTA DA geçen kelime ayırt edici değildir — özette bulunması kuyruğu
    // gördüğünü kanıtlamaz.
    .filter(w => !headFold.includes(w));
  if (tailTokens.length < 4) return true; // kuyrukta ayırt edici içerik yok
  return tailTokens.some(t => summaryFold.includes(t));
}

// -----------------------------------------------------------------------------------------------
// 6. BAŞLIK–ÖZET UYUMU (madde 5: "Başlık özetle uyumlu mu?")
// -----------------------------------------------------------------------------------------------
// Başlığın ayırt edici kelimelerinden en az biri özette geçmeli. Başlıkta 3'ten az ayırt edici
// kelime varsa (ör. yalnızca özel adlardan oluşan kısa bir başlık) ölçü uygulanmaz.
const TITLE_SUMMARY_MIN_TOKENS = 3;

export function titleMatchesSummary(title, summary) {
  const tokens = [...new Set(
    foldTr(title || '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4)
  )];
  if (tokens.length < TITLE_SUMMARY_MIN_TOKENS) return true;
  const summaryFold = foldTr(summary || '');
  // Çekim eki farkı: başlıkta "yapısı", özette "yapı" olabilir — ön ek eşleşmesi yeterlidir.
  return tokens.some(t => summaryFold.includes(t) || summaryFold.includes(t.slice(0, Math.max(4, t.length - 2))));
}

// -----------------------------------------------------------------------------------------------
// 7. KAYNAK ÇAPALARI — "çeviriden SAĞ ÇIKMASI beklenen" ayırt edici öğeler
// -----------------------------------------------------------------------------------------------
// gundemQuality.js#titleOverlapsSource "bu gerçekten AYNI haber mi?" sorusunu çıktı ile kaynak
// arasındaki KELİME ÖRTÜŞMESİYLE ölçüyor. Ölçünün sessiz bir yanlış pozitifi var: İngilizce bir
// görüş/derleme yazısında hiç özel ad ya da sayı geçmiyorsa (ör. "Why adaptive reuse is becoming
// the default for European housing"), KUSURSUZ bir Türkçe çeviri kaynakla tek bir kelime bile
// paylaşmaz ve içerik `title_unrelated` ile elenir — kapı, koruduğu şeyden fazlasını keser.
//
// ÇÖZÜM: ölçüyü tersine çevir. Kaynakta çeviriden sağ çıkması BEKLENEN öğeler (özel adlar,
// kısaltmalar, sayılar) "çapa"dır. Çapa varsa en az biri çıktıda görünmeli; kaynakta hiç çapa
// yoksa bu kapı bir şey söyleyemez ve içeriği ENGELLEMEZ (aynı dosyadaki "kaynak hiç metin
// vermemişse kapı sessizdir" ilkesiyle birebir aynı mantık).
export function sourceAnchors(sourceTitle, sourceExcerpt) {
  const anchors = new Set();
  const text = `${sourceTitle || ''}. ${sourceExcerpt || ''}`;
  // Sayılar: yıl/metrekare/kat sayısı çeviride aynen kalır.
  for (const n of String(text).match(/\d[\d.,]*/g) || []) {
    const norm = n.replace(/[.,]$/, '');
    if (norm.replace(/[.,]/g, '').length >= 2) anchors.add(foldTr(norm).replace(/[.,]/g, ''));
  }
  // TAMAMI BÜYÜK harfli kısaltmalar (OMA, BIG, SOM, KPF) — cümle başında olsalar bile ayırt edici.
  for (const abbr of String(text).match(/\b[A-ZÇĞİÖŞÜ]{2,6}\b/g) || []) anchors.add(foldTr(abbr));
  // Cümle başı OLMAYAN büyük harfli kelimeler — özel ad sinyali.
  for (const seq of capitalizedSequences(text)) {
    for (const w of seq) {
      const f = foldTr(w).replace(/[^a-z0-9]/g, '');
      if (f.length >= 4 && !TRANSLATION_CAPITALS.has(f)) anchors.add(f);
    }
  }
  return [...anchors];
}

// Çıktı, kaynak çapalarından en az birini taşıyor mu? Türkçeleşen adlar (Europe → Avrupa,
// Seoul → Seul) ters exonym tablosu üzerinden karşılanır.
export function outputCoversAnchors(outputText, anchors) {
  const out = foldTr(outputText || '').replace(/[^a-z0-9\s]/g, ' ');
  const outTokens = new Set(out.split(/\s+/).filter(Boolean));
  for (const anchor of anchors) {
    if (outTokens.has(anchor)) return true;
    // Çekim eki: çıktıda "Seul'de" -> token "seulde", çapa "seul"
    for (const t of outTokens) {
      if (t.length >= anchor.length && anchor.length >= PREFIX_MIN_LEN && t.startsWith(anchor)) return true;
    }
    for (const tr of EN_TO_TR.get(anchor) || []) {
      for (const t of outTokens) if (t === tr || (t.startsWith(tr) && tr.length >= PREFIX_MIN_LEN)) return true;
    }
  }
  return false;
}

// -----------------------------------------------------------------------------------------------
// TOPLU DEĞERLENDİRME
// -----------------------------------------------------------------------------------------------
// İlk başarısız kapının nedenini döner (retry ipucu buna göre seçilir, bkz. gundemAi.js).
// ctx:
//   sourceText        temizlenmiş kaynak metin (bkz. gundemSourceText.js)
//   sourceTitle       kaynağın kendi başlığı
//   sourceName        yayıncı adı (çıktıda geçmesi meşrudur, haystack'e katılır)
//   sourceLanguage    'tr' | 'en'
//   publishedYears    kaynağın yayın tarihinden gelen yıl(lar) — çıktıda geçmesi meşru
export const NAME_REJECT_THRESHOLD = 2;

export function runFactConsistency({ title, summary }, ctx = {}) {
  const haystack = `${ctx.sourceTitle || ''} ${ctx.sourceText || ''} ${ctx.sourceName || ''}`;
  const output = `${title} ${summary}`;

  const numbers = checkNumbers(output, haystack, { publishedYears: ctx.publishedYears });
  if (!numbers.ok) {
    return { ok: false, reason: 'fact_number_not_in_source', detail: numbers.unsupported.join(', ') };
  }

  const names = unsupportedNames(output, haystack);
  if (names.length >= NAME_REJECT_THRESHOLD) {
    return { ok: false, reason: 'fact_name_not_in_source', detail: names.join(' | ') };
  }

  const leftoverTitle = leftoverEnglishTerm(title);
  if (leftoverTitle) return { ok: false, reason: 'title_leftover_english', detail: leftoverTitle };
  const leftoverSummary = leftoverEnglishTerm(summary);
  if (leftoverSummary) return { ok: false, reason: 'summary_leftover_english', detail: leftoverSummary };

  const foreignTitle = foreignLanguageLeftover(title);
  if (foreignTitle) return { ok: false, reason: 'title_foreign_leftover', detail: foreignTitle };
  const foreignSummary = foreignLanguageLeftover(summary);
  if (foreignSummary) return { ok: false, reason: 'summary_foreign_leftover', detail: foreignSummary };

  const mechanical = mechanicalRepetition(summary);
  if (mechanical) return { ok: false, reason: 'summary_mechanical_repetition', detail: mechanical };

  const gram = repeatedNgram(summary);
  if (gram) return { ok: false, reason: 'summary_repetitive', detail: gram };

  if (!titleMatchesSummary(title, summary)) {
    return { ok: false, reason: 'title_summary_mismatch' };
  }

  if (ctx.sourceLanguage === 'tr' && !coversSourceTail(summary, ctx.sourceText)) {
    return { ok: false, reason: 'summary_covers_only_opening' };
  }

  // Yalnızca gözlem: reddetmeye yetmeyen tek bir desteklenmeyen ad dizisi log'a taşınır.
  return { ok: true, softNames: names };
}
