// MİMARLAB görsel arama — SÖZLÜKSEL VARLIK KİMLİK EŞLEŞTİRME (Aşama A / Tier 1).
//
// PROBLEM
// Vision modeli bir fotoğrafa bakıp "bu Galata Kulesi" ya da "bu bir VitrA lavabo" diyebilir.
// Bu cevabı SONUÇ olarak kabul etmek YASAK (brief 7/26: model kendi bilgisinden bir MİMARLAB
// kaydı uyduramaz). Ama bu cevabı bir ARAMA ANAHTARI olarak kullanmak tam da istenen şeydir:
// modelin ürettiği ad, D1'deki GERÇEK başlıklara karşı eşleştirilir ve YALNIZCA gerçekten var olan
// bir kayıt eşleşirse sonuç üretilir. Yani modelin halüsinasyonu bir kayda dönüşemez; olsa olsa
// hiçbir şeyle eşleşmez ve sessizce düşer.
//
// NEDEN DÜZ SUBSTRING/LIKE YETMEZ
//   * "Galata Tower"     -> "Galata Kulesi"      (dil farkı)
//   * "Sümela Monastery" -> "Sümela Manastırı"   (dil + Türkçe iyelik eki)
//   * "Hagia Sophia"     -> "Ayasofya Camii"     (tamamen farklı yazım)
//   * "Galata Kulesi"    -> "Galata Apartmanı"   (YANLIŞ eşleşme; engellenmeli)
// Bu yüzden üç mekanizma birlikte çalışır:
//   1) TÜRKÇE İYELİK/İZAFET EKİ SADELEŞTİRME — "kulesi"->"kule", "camii"->"cami",
//      "manastırı"->"manastir", "sarayı"->"saray", "müzesi"->"muze".
//   2) EN->TR MİMARİ SÖZLÜK — tower->kule, mosque->cami, monastery->manastir, ...
//      (yalnızca YAPI TÜRÜ kelimeleri; özel adlar ASLA çevrilmez).
//   3) IDF AĞIRLIKLI ÖRTÜŞME — "galata" 12 başlıkta geçiyorsa düşük, "sumela" 1 başlıkta geçiyorsa
//      çok yüksek ağırlık alır. Böylece ayırt edici olan kelime kararı verir, jenerik olan değil.
//      Düz Jaccard bunu yapamaz: {galata,kule} vs {galata,apartman} ile {galata,kule} vs
//      {galata,kule} arasındaki farkı ölçemez.
//
// ÇIKTI SKORU [0,1] — 1.0 yalnızca IDF ağırlıklı TAM örtüşmede çıkar. Skorun tek başına eşiği
// geçmesi "aynı varlık" demek DEĞİLDİR; src/routes/visualSearch.js bunu anlamsal benzerlik,
// taksonomi ve coğrafya sinyalleriyle birlikte değerlendirir (brief 12).

import { foldTr } from './textMatch.js';

// Hiçbir ayırt ediciliği olmayan kelimeler — IDF zaten bunları bastırır ama sözlüğe hiç girmemeleri
// hem belleği hem de yanlış eşleşme yüzeyini küçültür.
const STOPWORDS = new Set([
  've', 'ile', 'the', 'of', 'and', 'in', 'at', 'for', 'a', 'an', 'de', 'da', 'di', 'le', 'la',
  'bir', 'icin', 'projesi', 'proje', 'project', 'yapisi', 'binasi', 'bina', 'building',
  'yeni', 'eski', 'new', 'old',
]);

// EN -> TR yapı türü sözlüğü. YALNIZCA tür/işlev kelimeleri; hiçbir özel ad burada olamaz.
// Değerler ZATEN sadeleştirilmiş (eksiz) biçimdedir.
const TERM_ALIASES = {
  tower: 'kule', mosque: 'cami', masjid: 'cami', monastery: 'manastir', palace: 'saray',
  museum: 'muze', bridge: 'kopru', church: 'kilise', cathedral: 'katedral', castle: 'kale',
  fortress: 'kale', school: 'okul', college: 'lise', university: 'universite',
  library: 'kutuphane', station: 'gar', airport: 'havalimani', hotel: 'otel', house: 'ev',
  home: 'ev', villa: 'villa', apartment: 'apartman', residence: 'konut', housing: 'konut',
  office: 'ofis', factory: 'fabrika', hospital: 'hastane', theatre: 'tiyatro', theater: 'tiyatro',
  stadium: 'stadyum', tomb: 'turbe', mausoleum: 'turbe', bath: 'hamam', hammam: 'hamam',
  caravanserai: 'han', inn: 'han', fountain: 'cesme', cistern: 'sarnic', aqueduct: 'sukemeri',
  market: 'carsi', bazaar: 'carsi', mall: 'avm', park: 'park', square: 'meydan',
  center: 'merkez', centre: 'merkez', campus: 'kampus', terminal: 'terminal', port: 'liman',
  synagogue: 'sinagog', chapel: 'sapel', gate: 'kapi', wall: 'sur', lighthouse: 'fener',
  // Ürün tarafı — marka/model adları DEĞİL, ürün TÜRÜ kelimeleri.
  chair: 'sandalye', armchair: 'koltuk', sofa: 'kanepe', table: 'masa', lamp: 'lamba',
  pendant: 'sarkit', basin: 'lavabo', sink: 'lavabo', faucet: 'armatur', tap: 'armatur',
  tile: 'karo', shelf: 'raf', cabinet: 'dolap', bed: 'yatak', desk: 'masa', stool: 'tabure',
  mirror: 'ayna', rug: 'hali', carpet: 'hali', door: 'kapi', window: 'pencere',
};

// Türkçe iyelik/izafet ekleri — UZUNDAN KISAYA denenir (ilk eşleşen uygulanır).
// KURAL: kök en az 4 harf kalmalı; aksi halde "kale" -> "kal" gibi anlam bozan sadeleştirmeler
// olurdu. Bu bir tam biçimbilimsel çözümleyici DEĞİL, eşleştirme için kasıtlı olarak kaba bir
// normalleştirmedir — iki taraf da AYNI kaba işlemden geçtiği için tutarlıdır.
const SUFFIXES = ['lerinin', 'larinin', 'lerine', 'larina', 'leri', 'lari',
  'nin', 'nun', 'si', 'su', 'in', 'un', 'i', 'u'];

function stem(token) {
  // 5 harf sınırı ÖLÇÜMLE seçildi: "camii"(5) -> "cami" eşleşmesi bu sistemin en sık ihtiyacı
  // (Ayasofya Camii, Süleymaniye Camii, Selimiye Camii ...), 6'da bu kaçıyordu.
  if (token.length < 5) return token;
  for (const suf of SUFFIXES) {
    if (token.length - suf.length >= 4 && token.endsWith(suf)) return token.slice(0, -suf.length);
  }
  return token;
}

// Bir metni karşılaştırılabilir token kümesine çevirir: Türkçe katla -> ayır -> stopword at ->
// EN sözlüğünden çevir -> ek sadeleştir.
export function normalizeTokens(text) {
  const folded = foldTr(String(text || ''));
  const raw = folded.split(/[^a-z0-9]+/).filter(Boolean);
  const out = [];
  for (const t of raw) {
    if (t.length < 3) continue;
    if (STOPWORDS.has(t)) continue;
    const aliased = TERM_ALIASES[t] || t;
    const s = stem(aliased);
    if (s.length < 3 || STOPWORDS.has(s)) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Bir varlık listesinden IDF'li ters dizin kurar.
 * @param {Array<object>} items
 * @param {(item:object)=>string} nameOf   eşleştirilecek ad(lar); ürünlerde "marka + başlık"
 * @returns {{entries: Array, postings: Map<string, number[]>, idf: Map<string, number>}}
 */
export function buildNameIndex(items, nameOf) {
  const entries = [];
  const df = new Map();
  const postings = new Map();
  for (let i = 0; i < items.length; i++) {
    const tokens = normalizeTokens(nameOf(items[i]));
    entries.push({ item: items[i], tokens });
    for (const t of tokens) {
      df.set(t, (df.get(t) || 0) + 1);
      let list = postings.get(t);
      if (!list) { list = []; postings.set(t, list); }
      list.push(i);
    }
  }
  const N = Math.max(1, entries.length);
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log((N + 1) / (d + 0.5)));
  // Her girdinin kendi toplam IDF ağırlığı (kapsama paydası) önceden hesaplanır.
  for (const e of entries) {
    e.weight = e.tokens.reduce((sum, t) => sum + (idf.get(t) || 0), 0);
  }
  return { entries, postings, idf, N };
}

// Bir tokenın "ayırt edici" sayılması için gereken en düşük IDF. N=1715 için:
//   df=1   -> idf 7,0     df=10 -> idf 5,1     df=100 -> idf 2,8     df=500 -> idf 1,2
// 3.0 eşiği, ~100 başlıkta geçen jenerik bir kelimenin ("konut", "cami", "merkez") TEK BAŞINA
// kimlik iddiası kurmasını engeller; "sumela"/"ayasofya" gibi 1-3 başlıkta geçenler kolayca geçer.
const DISTINCTIVE_IDF = 3.0;

// Bir tokenın kaç girdide geçtiğinde "tarama açısından işe yaramaz" sayılacağı. "konut" 400
// projede geçiyorsa postings üzerinden 400 aday açmak boşuna iş — o token yine SKORA katılır
// (paylaşılan tokenlar arasında sayılır), sadece ADAY AÇMAZ.
const MAX_POSTING_FANOUT = 120;

/**
 * Serbest metin bir "kimlik tahminini" dizindeki varlıklarla eşleştirir.
 *
 * SKOR = sqrt(kapsama × isabet), yani:
 *   kapsama = paylaşılan IDF / varlık adının toplam IDF'i   ("adın ne kadarını açıkladık")
 *   isabet  = paylaşılan IDF / tahminin toplam IDF'i        ("tahminin ne kadarı tuttu")
 * Geometrik ortalama, iki taraftan biri zayıfsa skoru bastırır: "Galata" tek başına
 * "Galata Kulesi"ni %100 kapsamaz (isabet 1, kapsama ~0,45 -> 0,67) ve "Galata Kulesi" tahmini
 * "Galata Apartmanı"nı açıklayamaz (kapsama ~0,5, isabet ~0,5 -> 0,5).
 *
 * SÖZLÜKTE OLMAYAN TAHMİN TOKENLARI PAYDAYA GİRMEZ: "Sumela Monastery"deki "monastery" TR sözlüğe
 * çevrilir ("manastir") ve varsa sayılır; hiçbir MİMARLAB başlığında geçmeyen bir kelime ise
 * (ör. "photograph") tahmin hakkında hiçbir ayrım bilgisi taşımadığından isabet paydasını
 * haksızca şişirmemesi için atılır.
 *
 * @returns {Array<{item: object, score: number, shared: string[]}>} skora göre azalan
 */
export function matchName(index, guess, limit) {
  const gTokens = normalizeTokens(guess);
  if (!gTokens.length) return [];
  const { entries, postings, idf } = index;

  // Tahmin tokenlarını yalnızca sözlükte VAR OLANLARLA sınırla (bkz. yukarıdaki gerekçe).
  const known = gTokens.filter(t => idf.has(t));
  if (!known.length) return [];
  const guessWeight = known.reduce((s, t) => s + idf.get(t), 0);
  if (guessWeight <= 0) return [];

  const candidates = new Set();
  for (const t of known) {
    const list = postings.get(t);
    if (!list || list.length > MAX_POSTING_FANOUT) continue;
    for (const i of list) candidates.add(i);
  }
  if (!candidates.size) return [];

  const knownSet = new Set(known);
  const out = [];
  for (const i of candidates) {
    const e = entries[i];
    if (!e.weight) continue;
    let sharedWeight = 0;
    let bestIdf = 0;
    const shared = [];
    for (const t of e.tokens) {
      if (!knownSet.has(t)) continue;
      const w = idf.get(t) || 0;
      sharedWeight += w;
      if (w > bestIdf) bestIdf = w;
      shared.push(t);
    }
    if (!shared.length) continue;
    // AYIRT EDİCİ TOKEN ZORUNLU: yalnızca jenerik kelimeler paylaşılıyorsa ("cami" + "merkez")
    // bu bir kimlik eşleşmesi değil, tür benzerliğidir — anlamsal katmanın işi.
    if (bestIdf < DISTINCTIVE_IDF) continue;
    const coverage = sharedWeight / e.weight;
    const precision = sharedWeight / guessWeight;
    const score = Math.sqrt(coverage * precision);
    out.push({ item: e.item, score, shared });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit || 20);
}

/**
 * Birden çok tahmini (vision'ın sıralı kimlik listesi + OCR metinleri) tek bir slug->skor
 * haritasında birleştirir. Aynı varlık birden çok tahminden gelirse EN YÜKSEK skoru alır
 * (toplama YAPILMAZ: iki zayıf tahminin toplamı güçlü bir kimlik iddiası değildir).
 *
 * @param {Array<{text: string, weight: number}>} guesses  weight ∈ [0,1] — tahminin güveni
 */
export function matchNames(index, guesses, keyOf, limit) {
  const best = new Map();
  for (const g of guesses) {
    if (!g || !g.text) continue;
    const w = Math.max(0, Math.min(1, Number(g.weight) || 0));
    if (!w) continue;
    for (const m of matchName(index, g.text, limit || 20)) {
      const key = keyOf(m.item);
      const score = m.score * w;
      const prev = best.get(key);
      if (!prev || score > prev.score) best.set(key, { item: m.item, score, shared: m.shared, via: g.text });
    }
  }
  return best;
}
