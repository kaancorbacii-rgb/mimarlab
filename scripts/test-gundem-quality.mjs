#!/usr/bin/env node
// GÜNDEM İÇERİK KALİTESİ — REGRESYON TESTİ (kullanıcı isteği, 2026-09-13 madde 11).
//
// NEDEN AYRI DOSYA: scripts/test-gundem.mjs hattın TAMAMINI (feed ayrıştırma, mükerrer, kaynak
// yapılandırması, cron sağlığı, dispatcher) sınar ve 107 testle zaten büyük. Bu dosya YALNIZCA
// "başlık/çeviri/özet üretim kalitesi" katmanını sınar: kaynak metnin hazırlanması, prompt
// değişmezleri, fact-consistency kapıları ve 20 gerçek dünya örneğinde önce/sonra davranışı.
// İkisi de preflight-check.sh'ten çalışır; biri kırmızıysa deploy HİÇ BAŞLAMAZ.
//
// TEST KOŞUCUSU YOK, BAĞIMLILIK YOK: depo kuralı (bkz. test-gundem.mjs dosya başı) — node:assert.
//
// =============================================================================================
// 20 ÖRNEKLİK KORPUS — NE OLDUĞU VE NE OLMADIĞI
// =============================================================================================
// Her örnek, o yayıncının feed'inin GERÇEK ŞEKLİNE göre kurulmuş bir kaynak metni (başlık +
// açıklama, yayıncı boilerplate'i dahil) ve İKİ aday çıktı taşır:
//   * `bad`  — eski promptun ürettiği türden çıktı (birebir çeviri, ilk cümle özeti, çevrilmemiş
//              İngilizce terim, kaynakta olmayan sayı/isim, mekanik tekrar...)
//   * `good` — yeni üretim standardına uyan çıktı.
// Test, kalite kapısının `bad`'i BEKLENEN nedenle reddettiğini ve `good`'u kabul ettiğini doğrular.
//
// SINIR (açıkça): bu korpus production D1'den ÇEKİLMİŞ satırlar DEĞİLDİR — bu dosya ağ erişimi
// olmayan bir ortamda da çalışmak zorundadır (preflight offline çalışır). Canlı içerikle önce/sonra
// karşılaştırması scripts/gundem-retitle-backfill.mjs --dry-run ile yapılır; o betik gerçek
// satırları ve GERÇEK modeli kullanır.

import assert from 'node:assert/strict';

import { buildSourceText, stripBoilerplate, truncateAtSentence, sourceAdequacy, splitSentences } from '../src/lib/gundemSourceText.js';
import {
  validateAiOutput, SUMMARY_MIN_ACCEPT, SUMMARY_MIN_ACCEPT_THIN, SUMMARY_MAX_ACCEPT,
  TITLE_MIN_ACCEPT_WORDS, TITLE_MAX_ACCEPT_WORDS, wordCount, isSingleParagraph, looksTurkish,
  titleKey, contentHash, normalizeSourceUrl,
} from '../src/lib/gundemQuality.js';
import {
  checkNumbers, unsupportedNames, leftoverEnglishTerm, mechanicalRepetition, repeatedNgram,
  coversSourceTail, titleMatchesSummary, runFactConsistency, NAME_REJECT_THRESHOLD,
} from '../src/lib/gundemFactCheck.js';
import {
  GUNDEM_SYSTEM_PROMPT, GUNDEM_AI_MAX_TOKENS, generateGundemSummary,
  _buildUserTextForTests as buildUserText, _retryHintsForTests as RETRY_HINTS, AiProviderError,
} from '../src/lib/gundemAi.js';
import { runGundemIngestion } from '../src/lib/gundemIngest.js';

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, message: err.message });
    console.error(`  FAIL ${name}\n       ${err.message.split('\n')[0]}`);
  }
}
function section(title) { console.log(`\n${title}`); }

// =================================================================================================
section('1) Kaynak metnin hazırlanması (gundemSourceText.js)');
// =================================================================================================

await test('WordPress kuyruğu ("The post ... appeared first on ...") atılır', () => {
  const out = stripBoilerplate(
    'Heatherwick Studio has completed a timber pavilion in Seoul. The post Heatherwick completes pavilion appeared first on Dezeen.'
  );
  assert.ok(!/appeared first on/i.test(out), out);
  assert.ok(/Heatherwick Studio has completed/.test(out));
});

await test('Türkçe kuyruklar ve arayüz metni atılır (devamını oku / paylaş / çerez)', () => {
  const out = stripBoilerplate(
    'Yapı, Kadıköy’de 1930’lardan kalma bir sinema binasının yeniden işlevlendirilmesiyle elde edildi. Devamını oku. Paylaş: Çerez politikamızı kabul ederek devam edin.'
  );
  assert.ok(/Kadıköy/.test(out));
  assert.ok(!/Devamını oku/i.test(out), out);
  assert.ok(!/Paylaş/i.test(out), out);
  assert.ok(!/[Çç]erez/.test(out), out);
});

await test('İlgili haber blokları ve reklam etiketi atılır', () => {
  const out = stripBoilerplate('Yeni müze binası açıldı. Related story: OMA unveils masterplan. Advertisement.');
  assert.ok(!/Related story/i.test(out), out);
  assert.ok(!/Advertisement/i.test(out), out);
});

await test('Markup artığı, çözülmemiş varlık ve çıplak URL atılır', () => {
  const out = stripBoilerplate('Cephe <b>tuğla</b> kaplama &#8230; https://www.dezeen.com/2026/09/x/ ile tamamlandı');
  assert.ok(!/<b>|&#8230;|https?:\/\//.test(out), out);
  assert.ok(/tuğla/.test(out));
});

await test('AYNI metnin ikinci kopyası (og:description) hiç eklenmez', () => {
  const feed = 'MVRDV has won a competition to design a new cultural centre in Rotterdam, with construction due to start next year.';
  const og = 'MVRDV has won a competition to design a new cultural centre in Rotterdam.';
  const built = buildSourceText([feed, og]);
  assert.equal(built.dropped, 1, 'örtüşen parça atılmalıydı');
  assert.equal((built.text.match(/MVRDV/g) || []).length, 1, built.text);
});

await test('FARKLI bilgi taşıyan og:description EKLENİR (kapı körü körüne atmıyor)', () => {
  const feed = 'MVRDV has won a competition in Rotterdam.';
  const og = 'Jüri kararında yapının enerji performansı ve avlu kurgusu belirleyici oldu.';
  const built = buildSourceText([feed, og]);
  assert.equal(built.dropped, 0);
  assert.ok(/avlu/.test(built.text));
});

await test('Kırpma CÜMLE sınırında yapılır — kelimenin ortasından kesilmez', () => {
  const long = 'Birinci cümle burada bitiyor. İkinci cümle biraz daha uzun ve burada bitiyor. Üçüncü cümle kırpma sınırının ötesinde kalıyor ve kesilmesi gerekiyor.';
  const cut = truncateAtSentence(long, 70);
  assert.ok(cut.endsWith('.'), cut);
  assert.ok(!/\bkır$|\bcüm$/.test(cut), cut);
});

await test('Aynı cümle iki kez geçerse bir kez kalır', () => {
  const built = buildSourceText(['Yapı 2024 yılında tamamlandı. Cephede yerel taş kullanıldı. Yapı 2024 yılında tamamlandı.']);
  assert.equal((built.text.match(/2024 yılında tamamlandı/g) || []).length, 1, built.text);
});

await test('sourceAdequacy: empty / thin / normal / rich sınıfları', () => {
  assert.equal(sourceAdequacy(4), 'empty');
  assert.equal(sourceAdequacy(30), 'thin');
  assert.equal(sourceAdequacy(60), 'normal');
  assert.equal(sourceAdequacy(140), 'rich');
});

await test('Boş/anlamsız girdi patlamaz, adequacy empty döner', () => {
  const built = buildSourceText([null, '', '   ']);
  assert.equal(built.text, '');
  assert.equal(built.adequacy, 'empty');
  assert.deepEqual(splitSentences(''), []);
});

// =================================================================================================
section('2) Fact-consistency kapıları (gundemFactCheck.js)');
// =================================================================================================

await test('Kaynakta OLMAYAN sayı yakalanır (uydurma metrekare/tarih)', () => {
  const r = checkNumbers('Yapı 1975 yılında 4.500 metrekare alanda tamamlandı', 'The building was completed in 1975.');
  assert.equal(r.ok, false);
  assert.deepEqual(r.unsupported, ['4500']);
});

await test('Kaynaktaki sayı biçimi farklı yazılsa bile kabul edilir (1.200 = 1,200 = 1200)', () => {
  assert.equal(checkNumbers('1.200 metrekare', 'a 1,200-square-metre building').ok, true);
});

await test('Kaynakta YAZIYLA geçen sayı rakamla yazılabilir (two towers -> 2 kule)', () => {
  assert.equal(checkNumbers('2 kule inşa edilecek', 'The scheme includes two towers.').ok, true);
});

await test('Yayın yılı çıktıda geçebilir (kaynak gövdesinde yazmasa da)', () => {
  assert.equal(checkNumbers('2026 yılında açıldı', 'The centre opened this week.', { publishedYears: [2026] }).ok, true);
  assert.equal(checkNumbers('2019 yılında açıldı', 'The centre opened this week.', { publishedYears: [2026] }).ok, false);
});

await test('Türkçeleşen şehir adı halüsinasyon SAYILMAZ (Seoul -> Seul, Copenhagen -> Kopenhag)', () => {
  assert.deepEqual(unsupportedNames('Merkez Seul kentinde açıldı ve Kopenhag ofisi tasarladı', 'A centre in Seoul designed by a Copenhagen studio'), []);
});

await test('Çevirinin ÜRETTİĞİ büyük harfli kelimeler ad kapısına takılmaz (Tasarım Müzesi)', () => {
  assert.deepEqual(unsupportedNames('Sergi Londra Tasarım Müzesi’nde açıldı', 'The exhibition opened at the Design Museum in London'), []);
});

await test('Türkçe çekim eki eklenmiş ad kaynakta aranırken soyulur (Hadid’in, OMA’nın)', () => {
  assert.deepEqual(unsupportedNames('Yapı Zaha Hadid Architects’in tasarımı, OMA’nın önerisiyle birlikte değerlendirildi', 'Zaha Hadid Architects and OMA submitted proposals'), []);
});

await test('Kaynakta OLMAYAN özel adlar yakalanır ve eşik 2 uygulanır', () => {
  const one = unsupportedNames('Yapı Norman Foster imzasını taşıyor', 'A pavilion by a London studio');
  assert.equal(one.length, 1, JSON.stringify(one));
  const two = unsupportedNames('Yapı Norman Foster imzasını taşıyor ve Renzo Piano danışmanlık verdi', 'A pavilion by a London studio');
  assert.ok(two.length >= NAME_REJECT_THRESHOLD, JSON.stringify(two));
});

await test('Çevrilmeden kalmış İngilizce cins isim yakalanır (küçük harfli)', () => {
  assert.equal(leftoverEnglishTerm('Yapının facade tasarımı yenilendi'), 'facade');
  assert.equal(leftoverEnglishTerm('Karma kullanımlı housing projesi onaylandı'), 'housing');
  assert.equal(leftoverEnglishTerm('Kentsel dokuya saygılı bir cephe tasarımı'), null);
});

await test('ÖZEL AD içindeki büyük harfli İngilizce kelime kapıya takılmaz (Design Museum)', () => {
  assert.equal(leftoverEnglishTerm('Sergi Design Museum’da açıldı'), null);
  assert.equal(leftoverEnglishTerm('Serpentine Pavilion 2026 tasarımcısı açıklandı'), null);
});

await test('Mekanik cümle başlangıcı tekrarı yakalanır', () => {
  assert.ok(mechanicalRepetition('Bu proje Rotterdam’da yer alıyor. Bu proje ahşap taşıyıcı sistemle kuruldu.'));
  assert.equal(mechanicalRepetition('Proje Rotterdam’da yer alıyor. Ahşap taşıyıcı sistem cepheyle bütünleşiyor.'), null);
});

await test('Tekrar eden 5 kelimelik dizi yakalanır', () => {
  assert.ok(repeatedNgram('cephede yerel taş ve ahşap kullanıldı, avluda cephede yerel taş ve ahşap kullanıldı'));
  assert.equal(repeatedNgram('cephede yerel taş ve ahşap kullanıldı, avluda su öğesi yer alıyor'), null);
});

await test('Özet kaynağın yalnızca başını anlatıyorsa yakalanır (Türkçe kaynak)', () => {
  const source = [
    'Kadıköy’deki tarihi sinema binası yeniden işlevlendirildi.',
    Array.from({ length: 60 }, (_, i) => `dolgu${i}`).join(' '),
    'Yenileme sürecinde özgün alçı bezemeler restore edildi, fuayeye yeni bir kütüphane programı eklendi ve salon akustiği bütünüyle yenilendi.',
  ].join(' ');
  assert.equal(coversSourceTail('Kadıköy’deki tarihi sinema binası yeniden işlevlendirildi ve yapı yeniden kullanıma açıldı.', source), false);
  assert.equal(coversSourceTail('Kadıköy’deki sinema binasının yenilenmesinde özgün alçı bezemeler restore edildi ve salon akustiği yenilendi.', source), true);
});

await test('Kısa kaynakta kapsama kapısı karar vermez (yanlış pozitif üretmez)', () => {
  assert.equal(coversSourceTail('Kısa bir özet', 'Kısa bir kaynak metni burada bitiyor.'), true);
});

await test('Başlık–özet uyumsuzluğu yakalanır, uyumlu olan geçer', () => {
  assert.equal(titleMatchesSummary(
    'Rotterdam’da yeni kültür merkezi yarışmasını MVRDV kazandı',
    'Jüri, kentin liman bölgesindeki kültür yapısı için düzenlenen yarışmada MVRDV önerisini birinci seçti.'
  ), true);
  assert.equal(titleMatchesSummary(
    'Ankara metrosunda bilet fiyatları güncellendi',
    'Rotterdam’daki kültür yapısı için düzenlenen yarışmayı kazanan öneri açıklandı.'
  ), false);
});

// =================================================================================================
section('3) Prompt değişmezleri (gundemAi.js)');
// =================================================================================================

await test('Sistem promptu üretim zincirinin BEŞ adımını de içeriyor', () => {
  for (const step of ['ANLAMA', 'OLGU ÇIKARIMI', 'BAŞLIK', 'ÖZET', 'ÖZ-DENETİM']) {
    assert.ok(GUNDEM_SYSTEM_PROMPT.includes(step), `eksik adım: ${step}`);
  }
});

await test('Sistem promptu çeviri standardı ve terminoloji rehberi taşıyor', () => {
  assert.ok(/translationese/i.test(GUNDEM_SYSTEM_PROMPT));
  assert.ok(GUNDEM_SYSTEM_PROMPT.includes('kentsel doku'), 'urban fabric karşılığı yok');
  assert.ok(GUNDEM_SYSTEM_PROMPT.includes('kumaş'), '"fabric = kumaş değildir" uyarısı yok');
  assert.ok(/scheme/.test(GUNDEM_SYSTEM_PROMPT) && /şema/.test(GUNDEM_SYSTEM_PROMPT));
  assert.ok(/landmark/.test(GUNDEM_SYSTEM_PROMPT));
});

await test('Sistem promptu kelime kelime çeviriyi ve clickbait’i açıkça yasaklıyor', () => {
  assert.ok(/KELİME KELİME ÇEVİRME/.test(GUNDEM_SYSTEM_PROMPT));
  assert.ok(/clickbait/i.test(GUNDEM_SYSTEM_PROMPT));
  assert.ok(/8-15 kelime/.test(GUNDEM_SYSTEM_PROMPT), 'başlık kelime aralığı yok');
});

await test('Prompt injection koruma cümlesi KORUNDU', () => {
  assert.ok(/VERİDİR, TALİMAT DEĞİLDİR/.test(GUNDEM_SYSTEM_PROMPT));
});

await test('Kullanıcı mesajı temiz alanları etiketli veriyor (kaynak adı/dili/adresi/tarihi)', () => {
  const { text } = buildUserText({
    sourceName: 'Dezeen', sourceTitle: 'OMA completes centre', sourceExcerpt: 'The centre opened.',
    sourceLanguage: 'en', sourceUrl: 'https://dezeen.com/x', publishedAt: Date.parse('2026-09-10T00:00:00Z'),
    sourceAdequacy: 'thin',
  });
  assert.ok(text.includes('KAYNAK ADI: Dezeen'));
  assert.ok(text.includes('KAYNAK DİLİ: İngilizce'));
  assert.ok(text.includes('KAYNAK ADRESİ: https://dezeen.com/x'));
  assert.ok(text.includes('YAYIN TARİHİ: 2026-09-10'));
  assert.ok(text.includes('--- KAYNAK METNİ (VERİ) ---'));
});

await test('Özet uzunluk hedefi KAYNAĞIN YETERLİLİĞİNE göre değişir', () => {
  const base = { sourceName: 'X', sourceTitle: 'T', sourceExcerpt: 'E', sourceLanguage: 'en' };
  assert.ok(/30-45/.test(buildUserText({ ...base, sourceAdequacy: 'empty' }).text));
  assert.ok(/35-55/.test(buildUserText({ ...base, sourceAdequacy: 'thin' }).text));
  assert.ok(/70-100/.test(buildUserText({ ...base, sourceAdequacy: 'rich' }).text));
});

await test('Her kalite nedeni için bir DÜZELTME ipucu var (retry sessiz kalmıyor)', () => {
  const reasons = [
    'summary_too_short', 'summary_too_long', 'title_too_few_words', 'title_too_many_words',
    'fact_number_not_in_source', 'fact_name_not_in_source', 'title_leftover_english',
    'summary_leftover_english', 'summary_mechanical_repetition', 'summary_repetitive',
    'title_summary_mismatch', 'summary_covers_only_opening', 'ai_quality_self_reject',
  ];
  for (const r of reasons) assert.ok(RETRY_HINTS[r], `ipucu yok: ${r}`);
});

await test('Retry ipucu kullanıcı mesajına TALİMAT olarak ekleniyor', () => {
  const { text } = buildUserText({
    sourceName: 'X', sourceTitle: 'T', sourceExcerpt: 'E', sourceLanguage: 'en',
    sourceAdequacy: 'normal', retryReason: 'fact_number_not_in_source',
  });
  assert.ok(text.includes('--- DÜZELTME'));
  assert.ok(/BULUNMAYAN bir sayı/.test(text));
});

await test('Token tavanı source_facts için yükseltildi ama sınırsız değil', () => {
  assert.ok(GUNDEM_AI_MAX_TOKENS >= 1000 && GUNDEM_AI_MAX_TOKENS <= 1500, String(GUNDEM_AI_MAX_TOKENS));
});

// =================================================================================================
section('4) 20 ÖRNEKLİK KORPUS — eski tip çıktı reddedilir, yeni tip çıktı kabul edilir');
// =================================================================================================

// Her örnek: kaynağın feed'inde GERÇEKTEN göründüğü şekle (başlık + boilerplate'li açıklama) göre
// kurulmuş bir girdi + eski/yeni aday çıktı. `expect` alanı, eski tip çıktının HANGİ kapıya
// takılması gerektiğini söyler — kapı adını sabitlemek, ileride bir kapı sessizce devre dışı
// kalırsa testin bunu yakalamasını sağlar.
const CORPUS = [
  {
    id: 1, source: 'Dezeen', language: 'en',
    sourceTitle: 'Heatherwick Studio completes timber pavilion at Seoul botanic garden',
    sourceExcerpt: 'Heatherwick Studio has completed a timber pavilion at a botanic garden in Seoul, using laminated larch beams that fan out from a central core. The studio said the structure was designed to be dismantled and rebuilt elsewhere. The post Heatherwick Studio completes timber pavilion appeared first on Dezeen.',
    bad: {
      title: 'Heatherwick Studio Seul botanik bahçesinde timber pavilion tamamladı',
      summary: 'Heatherwick Studio, Seul’deki bir botanik bahçesinde ahşap bir pavilion tamamladı. Yapı merkezi bir çekirdekten yayılan lamine larch kirişler kullanıyor ve stüdyo yapının sökülüp başka bir yerde yeniden kurulabilecek şekilde tasarlandığını belirtti. Proje bahçenin ziyaretçi güzergâhında yer alıyor ve ahşap yapı kültürünün güncel bir örneği olarak sunuluyor.',
    },
    expect: 'title_leftover_english',
    good: {
      title: 'Heatherwick Studio, Seul botanik bahçesine sökülebilir ahşap pavyon tasarladı',
      summary: 'Heatherwick Studio’nun Seul’deki botanik bahçesi için tasarladığı pavyon tamamlandı. Yapının taşıyıcı kurgusu, merkezi bir çekirdekten yelpaze biçiminde açılan lamine melez ahşabı kirişlere dayanıyor. Ofis, pavyonun sökülüp başka bir yerde yeniden kurulabilecek biçimde ele alındığını belirtiyor; böylece geçici bir yapı olmasına karşın malzemenin ömrü uzatılmış oluyor. Ahşabın hem taşıyıcı hem de biçimlendirici öğe olarak kullanılması tasarımın belirleyici yaklaşımı.',
    },
  },
  {
    id: 2, source: 'ArchDaily', language: 'en',
    sourceTitle: 'The Legacy of Collective Construction in Florence Since 1436',
    sourceExcerpt: 'Since the completion of Brunelleschi’s dome in 1436, Florence has carried a tradition of collective building practice in which masons, carpenters and engineers worked as a single organisation. Contemporary restoration workshops in the city still follow the same division of labour.',
    bad: {
      title: 'Floransa’daki 1436’dan Kolektif İnşaatın Mirası',
      summary: 'Brunelleschi’nin kubbesinin 1436’da tamamlanmasından bu yana Floransa kolektif bir yapı pratiği geleneği taşıyor. Bu gelenekte duvarcılar, marangozlar ve mühendisler tek bir organizasyon olarak çalışıyordu. Bu yapı kültürü kentin kimliğini belirledi ve bugün de sürüyor. Bu gelenek çağdaş restorasyon atölyelerinde yaşamaya devam ediyor.',
    },
    expect: 'summary_mechanical_repetition',
    good: {
      title: 'Floransa’da Kolektif İnşaat Geleneğinin Mimari Mirası',
      summary: 'Brunelleschi’nin kubbesinin 1436’da tamamlanmasından bu yana Floransa, duvarcı, marangoz ve mühendislerin tek bir örgütlenme içinde çalıştığı bir yapı kültürünü sürdürüyor. Yazı, bu iş bölümünün kentin inşaat pratiğini nasıl biçimlendirdiğini ele alıyor ve günümüzdeki restorasyon atölyelerinin hâlâ aynı örgütlenmeyi izlediğini aktarıyor. Böylece kolektif üretim biçimi, tek bir yapının değil süreklilik kazanmış bir zanaat geleneğinin mirası olarak tanımlanıyor.',
    },
  },
  {
    id: 3, source: 'Arkitera', language: 'tr',
    sourceTitle: 'Kadıköy’deki tarihi sinema binası kültür merkezine dönüştürüldü',
    sourceExcerpt: 'Kadıköy’de 1938 yılında inşa edilen sinema binası, yeniden işlevlendirme projesiyle kültür merkezine dönüştürüldü. Yapı uzun süre kullanım dışı kalmış, son yıllarda çevresindeki ticari yoğunluk nedeniyle yıkım tartışmalarının içinde yer almıştı. Yenileme sürecinde özgün alçı bezemeler restore edildi, fuaye alanına kütüphane programı eklendi ve gişe hacmi bilgilendirme birimine dönüştürüldü. Salon akustiği yeniden düzenlendi, yapının cephesindeki özgün doğramalar korunarak onarıldı. Proje kapsamında bodrum katı atölyelere ayrıldı ve teknik altyapı bütünüyle yenilendi. Devamını oku.',
    bad: {
      title: 'Kadıköy’deki tarihi sinema binası kültür merkezine dönüştürüldü',
      summary: 'Kadıköy’de 1938 yılında inşa edilen sinema binası yeniden işlevlendirme projesiyle kültür merkezine dönüştürüldü ve yapı böylece yeniden kullanıma açıldı. Yapı uzun süre kullanım dışı kalmış, çevresindeki ticari yoğunluk nedeniyle yıkım tartışmalarının içinde yer almıştı. Dönüşüm ilçenin kültürel yaşamı açısından önemli bir adım olarak değerlendiriliyor, binanın yeni kimliği kamuoyunda ilgiyle karşılanıyor ve süreç mimarlık ortamında da ilgiyle izleniyor.',
    },
    expect: 'summary_covers_only_opening',
    good: {
      title: 'Kadıköy’de 1938 tarihli sinema binası kültür merkezi olarak yeniden açıldı',
      summary: 'Kadıköy’de 1938’de inşa edilen ve uzun süre kullanım dışı kalan sinema binası, yeniden işlevlendirme projesiyle kültür merkezine dönüştürüldü. Yenilemede özgün alçı bezemeler restore edildi, cephedeki doğramalar korunarak onarıldı. Fuayeye kütüphane programı eklendi, gişe hacmi bilgilendirme birimine çevrildi, salonun akustiği yeniden düzenlendi ve bodrum katı atölyelere ayrıldı. Teknik altyapının bütünüyle yenilenmesiyle yapı, özgün mimari öğeleri korunarak çok programlı bir kültür yapısına dönüştü.',
    },
  },
  {
    id: 4, source: 'Dezeen', language: 'en',
    sourceTitle: 'MVRDV wins competition for Rotterdam cultural centre',
    sourceExcerpt: 'MVRDV has won an open competition to design a cultural centre on Rotterdam’s harbour front, beating four shortlisted teams. The jury praised the stepped massing and the public route running through the building.',
    bad: {
      title: 'MVRDV Rotterdam kültür merkezi yarışmasını kazandı',
      summary: 'MVRDV, Rotterdam’ın liman kıyısında yer alacak kültür merkezi için düzenlenen açık yarışmayı kazandı ve kısa listedeki dört ekibi geride bıraktı. Jüri, kademeli kütle kurgusunu ve yapının içinden geçen 850 metre uzunluğundaki kamusal güzergâhı öne çıkardı. Merkezin 2029 yılında tamamlanması bekleniyor.',
    },
    expect: 'fact_number_not_in_source',
    good: {
      title: 'Rotterdam liman kıyısındaki kültür merkezi yarışmasını MVRDV kazandı',
      summary: 'MVRDV, Rotterdam’ın liman kıyısında yapılacak kültür merkezi için düzenlenen açık yarışmada birinci seçildi ve kısa listeye kalan dört ekibi geride bıraktı. Jürinin değerlendirmesinde kademelenen kütle kurgusu ile yapının içinden geçen kamusal güzergâh belirleyici oldu. Böylece merkez, yalnızca bir kültür yapısı değil kıyı ile kent dokusu arasında geçiş kuran bir bağlantı öğesi olarak tanımlanıyor.',
    },
  },
  {
    id: 5, source: 'Architizer', language: 'en',
    sourceTitle: 'Why adaptive reuse is becoming the default for European housing',
    sourceExcerpt: 'Architects across Europe increasingly treat adaptive reuse as the starting point for housing projects rather than an exception, driven by embodied carbon regulations and rising construction costs.',
    bad: {
      title: 'Neden adaptive reuse Avrupa housing projelerinde varsayılan hale geliyor',
      summary: 'Avrupa’daki mimarlar, adaptive reuse yaklaşımını konut projelerinde bir istisna olarak değil başlangıç noktası olarak görmeye başladı. Gömülü karbon düzenlemeleri ve yükselen inşaat maliyetleri bu eğilimi güçlendiriyor. Yazı, mevcut yapı stokunun yeniden değerlendirilmesinin sektörde yaygın bir tutum haline geldiğini aktarıyor.',
    },
    expect: 'title_leftover_english',
    good: {
      title: 'Avrupa’da konut üretiminde yeniden işlevlendirme neden varsayılan yaklaşıma dönüşüyor',
      summary: 'Yazı, Avrupa’daki mimarlık pratiğinde yeniden işlevlendirmenin konut projelerinde istisna olmaktan çıkıp başlangıç noktası haline geldiğini ele alıyor. Bu yönelimi güçlendiren iki etken öne çıkarılıyor: gömülü karbonu sınırlayan düzenlemeler ve artan inşaat maliyetleri. Mevcut yapı stokunun yıkılıp yeniden yapılması yerine dönüştürülmesi, hem düzenleyici çerçeve hem de ekonomik koşullar nedeniyle yaygın bir tutum olarak tanımlanıyor.',
    },
  },
  {
    id: 6, source: 'Mimdap', language: 'tr',
    sourceTitle: 'Mimarlar Odası, imar affı düzenlemesine karşı görüş bildirdi',
    sourceExcerpt: 'Mimarlar Odası, gündemdeki imar affı düzenlemesine ilişkin yazılı görüşünde, yapı güvenliği denetimini zayıflatacak maddelerin geri çekilmesini istedi. Açıklamada deprem bölgelerinde yapı stokunun niteliğine ilişkin veri paylaşıldı. Oda, düzenlemenin kentsel planlama ilkeleriyle çelişen hükümler taşıdığını da belirtti.',
    bad: {
      title: 'Mimarlar Odası imar affı düzenlemesine karşı görüş bildirdi',
      summary: 'Mimarlar Odası, gündemdeki imar affı düzenlemesine ilişkin yazılı bir görüş bildirdi ve düzenlemeye karşı çıktı. Açıklama kamuoyunda geniş yer buldu ve tartışmanın önümüzdeki günlerde süreceği belirtiliyor.',
    },
    expect: 'summary_too_short',
    good: {
      title: 'Mimarlar Odası imar affı düzenlemesinde yapı güvenliği maddelerinin geri çekilmesini istedi',
      summary: 'Mimarlar Odası, gündemdeki imar affı düzenlemesine ilişkin yazılı görüşünde yapı güvenliği denetimini zayıflatacak maddelerin geri çekilmesi çağrısı yaptı. Açıklamada deprem bölgelerindeki yapı stokunun niteliğine ilişkin veriler paylaşıldı ve düzenlemenin kentsel planlama ilkeleriyle çelişen hükümler taşıdığı belirtildi. Oda görüşü, affın yapı denetimi ve planlama mevzuatı üzerindeki etkisini merkeze alıyor.',
    },
  },
  {
    id: 7, source: 'The Architects’ Journal', language: 'en',
    sourceTitle: 'Council refuses permission for 24-storey tower in Leeds',
    sourceExcerpt: 'Leeds City Council has refused planning permission for a 24-storey residential tower, citing the impact on the setting of a listed mill nearby and a shortfall in affordable homes.',
    bad: {
      title: 'Konsey Leeds’de 24 katlı tower için planning permission reddetti',
      summary: 'Leeds Şehir Konseyi, 24 katlı bir konut kulesi için planning permission talebini reddetti. Karar gerekçesinde yakındaki listed mill yapısının çevresine etkisi ve uygun fiyatlı konut sayısındaki eksiklik gösterildi. Proje geliştiricisinin karara itiraz edip etmeyeceği henüz bilinmiyor.',
    },
    expect: 'title_leftover_english',
    good: {
      title: 'Leeds Belediyesi 24 katlı konut kulesine imar izni vermedi',
      summary: 'Leeds Belediyesi, kentte yapılması planlanan 24 katlı konut kulesinin imar iznini reddetti. Kararın gerekçesinde iki başlık öne çıkıyor: yakındaki tescilli değirmen yapısının çevresel bütünlüğü üzerindeki etki ve projede öngörülen erişilebilir konut sayısının yetersizliği. Böylece yükseklik tartışması, koruma alanı ile konut politikası arasındaki dengeye bağlanmış oluyor.',
    },
  },
  {
    id: 8, source: 'Archiproducts', language: 'en',
    sourceTitle: 'Maison&Objet 2026 is set to open in Paris',
    sourceExcerpt: 'The Maison&Objet fair returns to Paris Nord Villepinte in January, with a programme focused on craft production and material reuse. Around 2,000 exhibitors are expected.',
    bad: {
      title: 'Maison&Objet 2026 Paris’te açılıyor',
      summary: 'Maison&Objet fuarı ocak ayında Paris Nord Villepinte’e dönüyor ve programı zanaat üretimi ile malzemenin yeniden kullanımına odaklanıyor. Fuarda yaklaşık 3.000 katılımcının yer alması bekleniyor. Etkinlik, tasarım sektörünün yıla giriş takvimindeki ilk büyük buluşması olarak değerlendiriliyor.',
    },
    expect: 'fact_number_not_in_source',
    good: {
      title: 'Maison&Objet 2026, zanaat ve malzeme yeniden kullanımı temasıyla Paris’te açılıyor',
      summary: 'Maison&Objet fuarı ocak ayında Paris Nord Villepinte’te yeniden düzenleniyor. Bu yılın programı zanaat üretimi ve malzemenin yeniden kullanımı başlıkları çevresinde kurgulandı; fuarda yaklaşık 2.000 katılımcının yer alması bekleniyor. Tasarım üreticilerini bir araya getiren etkinlik, ürün tanıtımının yanında üretim biçimlerine ilişkin tartışmaya da alan açıyor.',
    },
  },
  {
    id: 9, source: 'Bigumigu', language: 'tr',
    sourceTitle: 'İstanbul’da terk edilmiş su deposu sergi mekânına dönüştü',
    sourceExcerpt: 'İstanbul’un Beyoğlu ilçesindeki terk edilmiş su deposu, geçici bir sergi mekânına dönüştürüldü. Tasarım ekibi mevcut betonarme kabuğa dokunmadan içeriye taşınabilir bir çelik iskele yerleştirdi. Aydınlatma tasarımı deponun tonozlu üst örtüsünü vurgulayacak biçimde kurgulandı. Mekân üç ay boyunca ziyarete açık olacak.',
    bad: {
      title: 'Su deposu dönüştürüldü',
      summary: 'İstanbul Beyoğlu’ndaki terk edilmiş su deposu geçici bir sergi mekânına dönüştürüldü. Tasarım ekibi mevcut betonarme kabuğa dokunmadan içeriye taşınabilir bir çelik iskele yerleştirdi ve aydınlatma deponun tonozlu üst örtüsünü vurgulayacak biçimde kurgulandı. Mekân üç ay boyunca ziyarete açık olacak ve kent hafızası açısından dikkat çekici bir örnek sunuyor.',
    },
    expect: 'title_too_few_words',
    good: {
      title: 'Beyoğlu’ndaki terk edilmiş su deposu geçici sergi mekânına dönüştürüldü',
      summary: 'Beyoğlu’ndaki kullanım dışı su deposu, üç ay boyunca ziyarete açık kalacak geçici bir sergi mekânına dönüştürüldü. Tasarım ekibi mevcut betonarme kabuğa müdahale etmeden iç hacme taşınabilir bir çelik iskele yerleştirdi; böylece yapının özgün dokusu korunurken sergi kurgusu bağımsız bir katman olarak çözüldü. Aydınlatma, deponun tonozlu üst örtüsünü öne çıkaracak biçimde tasarlandı.',
    },
  },
  {
    id: 10, source: 'Mimarizm', language: 'tr',
    sourceTitle: 'Ulusal Mimarlık Ödülleri’nde bu yıl 14 proje ödül aldı',
    sourceExcerpt: 'Ulusal Mimarlık Ödülleri kapsamında bu yıl 14 proje ödüle değer görüldü. Seçici kurul, yapı ölçeğindeki işlerin yanında koruma ve kamusal alan projelerini de değerlendirdi. Ödüller Ankara’da düzenlenen törenle sahiplerine verildi.',
    bad: {
      title: 'Ulusal Mimarlık Ödülleri’nde 16 proje ödül aldı',
      summary: 'Ulusal Mimarlık Ödülleri kapsamında bu yıl 16 proje ödüle değer görüldü. Seçici kurul yapı ölçeğindeki işlerin yanında koruma ve kamusal alan projelerini de değerlendirdi ve ödüller Ankara’da düzenlenen törenle sahiplerine verildi. Ödüller mimarlık ortamında yılın öne çıkan işlerini görünür kılıyor.',
    },
    expect: 'fact_number_not_in_source',
    good: {
      title: 'Ulusal Mimarlık Ödülleri’nde 14 proje ödüle değer görüldü',
      summary: 'Bu yılın Ulusal Mimarlık Ödülleri’nde 14 proje ödüle değer görüldü. Seçici kurul değerlendirmesini yapı ölçeğindeki işlerle sınırlamadı; koruma ve kamusal alan projeleri de ödül kapsamına girdi. Ödüller Ankara’da düzenlenen törenle sahiplerine sunuldu. Böylece ödül programı, tek yapı üretiminin yanında koruma pratiği ve kamusal mekân tasarımını da kapsayan geniş bir çerçeve sunuyor.',
    },
  },
  {
    id: 11, source: 'The Architect’s Newspaper', language: 'en',
    sourceTitle: 'SOM unveils mass timber office tower for Chicago',
    sourceExcerpt: 'SOM has unveiled designs for a mass timber office tower in Chicago’s West Loop, with a glulam frame and a concrete core. The building would rise 18 storeys.',
    bad: {
      title: 'SOM Chicago için mass timber office tower tanıttı',
      summary: 'SOM, Chicago’nun West Loop bölgesinde yapılacak ahşap ofis kulesinin tasarımını tanıttı. Yapı glulam bir iskelet ve betonarme bir çekirdek kullanıyor ve 18 kat yükselecek. Tasarım, kent merkezinde ahşap taşıyıcı sistemin ofis ölçeğinde kullanımına örnek oluşturuyor.',
    },
    expect: 'title_leftover_english',
    good: {
      title: 'SOM, Chicago West Loop için 18 katlı ahşap taşıyıcılı ofis kulesi tasarladı',
      summary: 'SOM, Chicago’nun West Loop bölgesi için tasarladığı ofis kulesini tanıttı. Yapının taşıyıcı sistemi lamine ahşap iskelet ile betonarme çekirdeğin birlikte çalışmasına dayanıyor ve kule 18 kat yükselecek. Ahşabın bu ölçekte bir ofis yapısında taşıyıcı olarak kullanılması, tasarımın belirleyici özelliği olarak öne çıkıyor.',
    },
  },
  {
    id: 12, source: 'Dezeen', language: 'en',
    sourceTitle: 'Studio Ossidiana wins Dutch pavilion commission',
    sourceExcerpt: 'Studio Ossidiana has been selected to design the Dutch pavilion, with a proposal built around ceramic screens and a water garden.',
    bad: {
      title: 'Studio Ossidiana Hollanda pavyonu işini kazandı',
      summary: 'Studio Ossidiana Hollanda pavyonunu tasarlamak üzere seçildi. Önerisi seramik paravanlar ve bir su bahçesi çevresinde kurgulanıyor.',
    },
    expect: 'summary_too_short',
    good: {
      title: 'Hollanda pavyonunu Studio Ossidiana tasarlayacak',
      summary: 'Studio Ossidiana, Hollanda pavyonunu tasarlamak üzere seçildi. Ofisin önerisi seramik paravanlar ile bir su bahçesi çevresinde kurgulanıyor; bu iki öğe hem mekânı bölen hem de iklimsel bir eşik oluşturan tasarım araçları olarak öne çıkıyor.',
    },
  },
  {
    id: 13, source: 'ArchDaily', language: 'en',
    sourceTitle: 'How architects are rethinking the public realm in dense cities',
    sourceExcerpt: 'From Bogotá to Rotterdam, architects are rethinking the public realm in dense cities, treating streets and rooftops as continuous public space rather than leftover area.',
    bad: {
      title: 'Mimarlar yoğun kentlerde public realm’i nasıl yeniden düşünüyor',
      summary: 'Bogotá’dan Rotterdam’a mimarlar yoğun kentlerde public realm’i yeniden düşünüyor; sokakları ve çatıları artık alan olarak değil sürekli bir kamusal mekân olarak ele alıyor. Yazı bu yaklaşımın farklı kentlerdeki örneklerini karşılaştırıyor ve tasarım araçlarını tartışıyor.',
    },
    expect: 'title_leftover_english',
    good: {
      title: 'Yoğun kentlerde kamusal alan mimarlar tarafından nasıl yeniden tanımlanıyor',
      summary: 'Yazı, Bogotá’dan Rotterdam’a uzanan örneklerle yoğun kentlerde kamusal alanın yeniden tanımlanışını ele alıyor. Mimarlar sokakları ve çatıları artık yapıdan arta kalan alanlar olarak değil, sürekli bir kamusal mekânın parçaları olarak kurguluyor. Bu bakış, kamusal alanı tek tek meydanlarla sınırlı görmek yerine kent dokusu içinde yayılan bir ağ olarak düşünmeyi öneriyor.',
    },
  },
  {
    id: 14, source: 'Arkitera', language: 'tr',
    sourceTitle: 'Beyazıt Meydanı düzenlemesi için yeni bir yarışma açıldı',
    sourceExcerpt: 'Beyazıt Meydanı ve çevresinin düzenlenmesi için iki kademeli ulusal mimarlık yarışması açıldı. Şartname, meydanın arkeolojik katmanlarının korunmasını ve yaya erişiminin güçlendirilmesini şart koşuyor. Başvurular şubat ayında kapanacak, kolokyum mart ayında yapılacak.',
    bad: {
      title: 'Beyazıt Meydanı yarışması',
      summary: 'Beyazıt Meydanı ve çevresinin düzenlenmesi için iki kademeli ulusal mimarlık yarışması açıldı. Şartname meydanın arkeolojik katmanlarının korunmasını ve yaya erişiminin güçlendirilmesini şart koşuyor. Başvurular şubat ayında kapanacak ve kolokyum mart ayında yapılacak.',
    },
    expect: 'title_too_few_words',
    good: {
      title: 'Beyazıt Meydanı ve çevresi için iki kademeli ulusal mimarlık yarışması açıldı',
      summary: 'Beyazıt Meydanı ile çevresinin düzenlenmesi amacıyla iki kademeli ulusal mimarlık yarışması açıldı. Şartname iki koşulu öne çıkarıyor: meydanın arkeolojik katmanlarının korunması ve yaya erişiminin güçlendirilmesi. Takvime göre başvurular şubat ayında kapanacak, kolokyum ise mart ayında yapılacak. Yarışma, kentin en yoğun tarihi odaklarından birinin kamusal kurgusunu yeniden ele almayı amaçlıyor.',
    },
  },
  {
    id: 15, source: 'Dezeen', language: 'en',
    sourceTitle: 'Kengo Kuma completes museum extension in Kyoto',
    sourceExcerpt: 'Kengo Kuma and Associates has completed an extension to a ceramics museum in Kyoto, wrapping the new volume in a lattice of cedar battens.',
    bad: {
      title: 'Kengo Kuma Kyoto’da müze eki tamamladı',
      summary: 'Kengo Kuma and Associates, Kyoto’daki bir seramik müzesinin ek yapısını tamamladı. Yeni kütle sedir çıtalardan oluşan bir kafesle sarıldı. Tadao Ando’nun daha önce aynı yapıda gerçekleştirdiği düzenleme de korunarak sürdürüldü ve müzenin bahçesi Sou Fujimoto tarafından yeniden düzenlendi.',
    },
    expect: 'fact_name_not_in_source',
    good: {
      title: 'Kengo Kuma, Kyoto’daki seramik müzesinin ek yapısını sedir kafesle tamamladı',
      summary: 'Kengo Kuma and Associates, Kyoto’daki seramik müzesi için tasarladığı ek yapıyı tamamladı. Yeni kütle, sedir çıtalardan oluşan bir kafesle sarılarak mevcut yapının ölçeğine uyum sağlıyor. Ahşap kafes hem cephenin belirleyici öğesi hem de gün ışığını süzen bir katman olarak çalışıyor.',
    },
  },
  {
    id: 16, source: 'Architizer', language: 'en',
    sourceTitle: 'Ten housing schemes that rethink the courtyard',
    sourceExcerpt: 'This roundup gathers ten housing schemes in which the courtyard is used as the organising device, from Copenhagen to Mexico City.',
    bad: {
      title: 'Avluyu yeniden düşünen on housing scheme',
      summary: 'Bu derleme, avlunun düzenleyici öğe olarak kullanıldığı on konut projesini bir araya getiriyor. Örnekler Kopenhag’dan Mexico City’ye uzanıyor ve avlunun konut kurgusundaki rolünü farklı iklim ve yoğunluk koşullarında gösteriyor. Seçkide avlunun bazen ortak bir bahçe bazen de iklimsel bir eşik olarak ele alındığı aktarılıyor ve projelerin yoğunluk değerleri karşılaştırılıyor.',
    },
    expect: 'title_leftover_english',
    good: {
      title: 'Avluyu düzenleyici öğe olarak kuran on konut projesi bir arada',
      summary: 'Derleme, avlunun tasarımın düzenleyici öğesi olarak kullanıldığı on konut projesini bir araya getiriyor. Kopenhag’dan Mexico City’ye uzanan örnekler, avlunun farklı iklim ve yoğunluk koşullarında nasıl farklı roller üstlendiğini gösteriyor. Böylece avlu, biçimsel bir tercih olmaktan çok konut kurgusunun omurgasını belirleyen bir araç olarak ele alınıyor.',
    },
  },
  {
    id: 17, source: 'Arkitera', language: 'tr',
    sourceTitle: 'Deprem bölgesinde kalıcı konut teslimleri sürüyor',
    sourceExcerpt: 'Deprem bölgesinde kalıcı konut teslimleri sürüyor. Yetkililer bu yıl içinde teslim edilen konut sayısının artırılacağını açıkladı. Uzmanlar ise yerleşim kararlarının zemin etütleriyle birlikte değerlendirilmesi gerektiğini vurguluyor. Bölgedeki bazı köylerde yapım süreci hâlâ başlamadı.',
    bad: {
      title: 'Deprem bölgesinde 250 bin kalıcı konut teslim edildi',
      summary: 'Deprem bölgesinde kalıcı konut teslimleri sürüyor ve yetkililer bu yıl içinde teslim edilen konut sayısının artırılacağını açıkladı. Uzmanlar yerleşim kararlarının zemin etütleriyle birlikte değerlendirilmesi gerektiğini vurguluyor. Bölgedeki bazı köylerde yapım süreci hâlâ başlamadı ve sürecin takvimi tartışılıyor.',
    },
    expect: 'fact_number_not_in_source',
    good: {
      title: 'Deprem bölgesinde kalıcı konut teslimleri sürüyor, bazı köylerde yapım başlamadı',
      summary: 'Deprem bölgesinde kalıcı konut teslimleri devam ediyor; yetkililer yıl içinde teslim edilecek konut sayısının artırılacağını açıkladı. Uzmanlar ise yerleşim kararlarının zemin etütleriyle birlikte ele alınması gerektiğini vurguluyor. Öte yandan bölgedeki bazı köylerde yapım sürecinin henüz başlamadığı aktarılıyor; bu da teslim takvimi ile yerleşim planlaması arasındaki farkı gündemde tutuyor.',
    },
  },
  {
    id: 18, source: 'The Architects’ Journal', language: 'en',
    sourceTitle: 'Practice profile: the studio rebuilding schools in timber',
    sourceExcerpt: 'A profile of the practice that has rebuilt a dozen schools in cross-laminated timber, describing how repeatable structural grids shortened programmes.',
    bad: {
      title: 'Practice profili: okulları timber ile yeniden inşa eden studio',
      summary: 'Okulları çapraz lamine ahşapla yeniden inşa eden ofisin profili, tekrarlanabilir taşıyıcı ızgaraların yapım sürelerini nasıl kısalttığını anlatıyor. Ofis bugüne kadar bir düzine okul projesini bu yöntemle tamamladı ve yaklaşımını kamu yapıları için ölçeklenebilir bir model olarak sunuyor.',
    },
    expect: 'title_leftover_english',
    good: {
      title: 'Okulları çapraz lamine ahşapla yeniden inşa eden ofisin çalışma yöntemi',
      summary: 'Profil yazısı, okul yapılarını çapraz lamine ahşapla yeniden inşa eden ofisin çalışma biçimini ele alıyor. Ofisin bugüne kadar bir düzine okulu bu yöntemle tamamladığı, tekrarlanabilir taşıyıcı ızgaralar sayesinde yapım sürelerinin kısaldığı aktarılıyor. Böylece ahşap yapı, tek bir projeye özgü bir tercih değil kamu yapıları için ölçeklenebilir bir üretim modeli olarak tanımlanıyor.',
    },
  },
  {
    id: 19, source: 'Dezeen', language: 'en',
    sourceTitle: 'Snøhetta reveals plans for Oslo waterfront library',
    sourceExcerpt: 'Snøhetta has revealed plans for a library on the Oslo waterfront, with a stepped roof that doubles as a public terrace and a reading room facing the fjord.',
    bad: {
      title: 'Snøhetta Oslo waterfront kütüphanesi için planları açıkladı',
      summary: 'Snøhetta Oslo kıyısında yapılacak kütüphanenin planlarını açıkladı. Kademeli çatı aynı zamanda kamusal bir teras olarak kullanılacak ve okuma salonu fiyorda bakacak biçimde konumlandırıldı. Yapı kentin kıyı hattındaki kültür yapıları dizisine eklenecek ve kıyı yürüyüş güzergâhıyla doğrudan ilişki kuracak biçimde ele alındı.',
    },
    expect: 'title_leftover_english',
    good: {
      title: 'Snøhetta’nın Oslo kıyısı için tasarladığı kütüphanenin planları açıklandı',
      summary: 'Snøhetta, Oslo kıyısında yapılacak kütüphanenin tasarımını kamuya açıkladı. Yapının kademelenen çatısı aynı zamanda kamusal bir teras olarak kullanılacak; okuma salonu ise fiyorda bakacak biçimde konumlandırıldı. Çatının hem örtü hem kamusal zemin olarak çalışması, tasarımın kıyı hattıyla kurduğu ilişkinin ana aracı olarak öne çıkıyor.',
    },
  },
  {
    id: 20, source: 'Mimdap', language: 'tr',
    sourceTitle: 'Kentsel dönüşümde yoğunluk artışı tartışılıyor',
    sourceExcerpt: 'Kentsel dönüşüm uygulamalarında imar haklarının artırılması, planlama çevrelerinde tartışma yaratıyor. Uzmanlar yoğunluk artışının altyapı kapasitesiyle birlikte değerlendirilmesi gerektiğini söylüyor. Bazı belediyeler dönüşüm alanlarında açık alan oranını yükseltme kararı aldı.',
    bad: {
      title: 'Kentsel dönüşümde yoğunluk artışı tartışılıyor',
      summary: 'Kentsel dönüşüm uygulamalarında imar haklarının artırılması planlama çevrelerinde tartışma yaratıyor. Uzmanlar yoğunluk artışının urban fabric ve altyapı kapasitesiyle birlikte değerlendirilmesi gerektiğini söylüyor. Bazı belediyeler dönüşüm alanlarında açık alan oranını yükseltme kararı aldı ve bu karar tartışmanın seyrini etkiliyor.',
    },
    expect: 'summary_leftover_english',
    good: {
      title: 'Kentsel dönüşümde imar hakkı artışı planlama çevrelerinde tartışma yaratıyor',
      summary: 'Kentsel dönüşüm uygulamalarında imar haklarının artırılması planlama çevrelerinde tartışılıyor. Uzmanlar, yoğunluk artışının kentsel doku ve altyapı kapasitesiyle birlikte ele alınmadığında sorun ürettiğini vurguluyor. Bazı belediyelerin dönüşüm alanlarında açık alan oranını yükseltme kararı alması ise tartışmanın yönünü etkiliyor; böylece yoğunluk yalnızca parsel ölçeğinde değil altyapı ve kamusal alan dengesiyle birlikte değerlendiriliyor.',
    },
  },
];

assert.ok(CORPUS.length >= 20, `korpus en az 20 örnek taşımalı, şu an ${CORPUS.length}`);

function ctxFor(item) {
  const built = buildSourceText([item.sourceExcerpt]);
  return {
    sourceTitle: item.sourceTitle,
    sourceExcerpt: built.text,
    sourceName: item.source,
    sourceLanguage: item.language,
    sourceAdequacy: built.adequacy,
    publishedYears: [2026],
    fallbackCategory: 'haber',
  };
}

for (const item of CORPUS) {
  await test(`Örnek ${String(item.id).padStart(2, '0')} [${item.source}] ESKİ tip çıktı reddedilir -> ${item.expect}`, () => {
    const r = validateAiOutput({ ...item.bad, category: 'haber', entities: [] }, ctxFor(item));
    assert.equal(r.ok, false, 'eski tip çıktı kabul edildi');
    assert.equal(r.reason, item.expect, `beklenen ${item.expect}, gelen ${r.reason}`);
  });

  await test(`Örnek ${String(item.id).padStart(2, '0')} [${item.source}] YENİ tip çıktı KABUL edilir`, () => {
    const r = validateAiOutput({ ...item.good, category: 'haber', entities: [] }, ctxFor(item));
    assert.equal(r.ok, true, `yeni tip çıktı reddedildi: ${r.reason}${r.detail ? ` (${r.detail})` : ''}`);
    // Kullanıcı isteği madde 11'deki kontrol listesi — her kabul edilen çıktı için tek tek.
    assert.ok(r.title && r.title.trim(), 'title_tr boş');
    assert.ok(r.summary && r.summary.trim(), 'summary_tr boş');
    assert.ok(isSingleParagraph(r.summary), 'summary_tr tek paragraf değil');
    assert.ok(looksTurkish(r.summary), 'summary_tr Türkçe görünmüyor');
    const w = wordCount(r.summary);
    const floor = ctxFor(item).sourceAdequacy === 'thin' ? SUMMARY_MIN_ACCEPT_THIN : SUMMARY_MIN_ACCEPT;
    assert.ok(w >= floor && w <= SUMMARY_MAX_ACCEPT, `özet uzunluğu bant dışı: ${w}`);
    const tw = wordCount(r.title);
    assert.ok(tw >= TITLE_MIN_ACCEPT_WORDS && tw <= TITLE_MAX_ACCEPT_WORDS, `başlık kelime sayısı bant dışı: ${tw}`);
    assert.equal(leftoverEnglishTerm(`${r.title} ${r.summary}`), null, 'çevrilmemiş İngilizce terim kaldı');
    assert.equal(checkNumbers(`${r.title} ${r.summary}`, `${item.sourceTitle} ${item.sourceExcerpt}`, { publishedYears: [2026] }).ok, true, 'kaynakta olmayan sayı');
  });
}

// =================================================================================================
section('5) Güvenli fallback ve mevcut sistemin korunması');
// =================================================================================================

await test('Model geçersiz JSON dönerse AiProviderError yükselir (çağıran fallback’e düşer)', async () => {
  const env = { AI: { run: async () => ({ response: 'bu bir JSON değil' }) } };
  await assert.rejects(
    () => generateGundemSummary(env, { sourceName: 'X', sourceTitle: 'T', sourceExcerpt: 'E', sourceLanguage: 'en', sourceAdequacy: 'thin' }),
    (err) => err instanceof AiProviderError && err.code === 'invalid_json'
  );
});

await test('Kota hatası quotaExceeded olarak yükselir (tur durur, sonsuz retry yok)', async () => {
  const env = { AI: { run: async () => { const e = new Error('daily quota exceeded'); throw e; } } };
  await assert.rejects(
    () => generateGundemSummary(env, { sourceName: 'X', sourceTitle: 'T', sourceExcerpt: 'E', sourceLanguage: 'en', sourceAdequacy: 'thin' }),
    (err) => err instanceof AiProviderError && err.quotaExceeded === true
  );
});

await test('MÜKERRER anahtarları DEĞİŞMEDİ (dedupe sistemi bozulmuyor)', async () => {
  // Bu üç değer mükerrer kontrolünün 1., 3. ve 4. basamağıdır ve kalite değişikliklerinden
  // ETKİLENMEMELİDİR — hepsi kaynağın KENDİ dilindeki ham veriden üretilir.
  assert.equal(
    normalizeSourceUrl('https://www.dezeen.com/2026/09/x/?utm_source=rss#top'),
    'https://dezeen.com/2026/09/x'
  );
  assert.equal(titleKey('OMA completes new cultural centre in Seoul'), 'centre completes cultural oma seoul');
  const h1 = await contentHash('OMA completes centre', 'The centre opened this week.');
  const h2 = await contentHash('OMA completes centre', 'The centre opened this week.');
  assert.equal(h1, h2);
  assert.equal(h1.length, 32);
});

await test('runFactConsistency temiz çıktıda ok:true döner ve tek desteklenmeyen adı yalnızca raporlar', () => {
  const r = runFactConsistency(
    { title: 'Seul’de yeni kültür merkezi açıldı', summary: 'Seul’de açılan kültür merkezi Norman Foster imzasını taşıyor ve kent merkezindeki meydana bakıyor.' },
    { sourceTitle: 'A new cultural centre opened in Seoul', sourceText: 'The centre faces the central square.', sourceLanguage: 'en' }
  );
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.softNames, ['Norman Foster']);
});

// =================================================================================================
section('6) UÇTAN UCA — publish flow yeni katmanlarla bozulmadan çalışıyor');
// =================================================================================================

// Gerçek runGundemIngestion, sahte env (D1 + AI + fetch) ile çalıştırılır. Amaç: prompt/kapı
// değişikliklerinden sonra hattın GERÇEKTEN yayın yapabildiğini kanıtlamak — birim testleri
// kapıların davranışını doğrular ama "hat hâlâ bir satır yazıyor mu?" sorusunu cevaplamaz
// (bu depoda tam olarak bu boşlukta bir kez SIFIR içerik üreten bir regresyon yaşandı, bkz.
// gundemIngest.js#ctx.ingestMode notu).
const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[Snohetta reveals plans for Oslo waterfront library]]></title>
    <link>https://www.dezeen.com/2026/09/12/snohetta-oslo-library/</link>
    <pubDate>Fri, 12 Sep 2026 09:00:00 +0000</pubDate>
    <description><![CDATA[<p>Snohetta has revealed plans for a library on the Oslo waterfront, with a stepped roof that doubles as a public terrace and a reading room facing the fjord.</p>The post Snohetta reveals plans appeared first on Dezeen.]]></description>
    <enclosure url="https://static.dezeen.com/uploads/2026/09/oslo.jpg" type="image/jpeg" />
  </item>
</channel></rss>`;

const GOOD_AI = {
  confident: true,
  isProject: false,
  source_facts: ['Snohetta Oslo kıyısında kütüphane tasarladı', 'Kademeli çatı kamusal teras olarak kullanılacak'],
  title: 'Snohetta’nın Oslo kıyısı için tasarladığı kütüphanenin planları açıklandı',
  summary: 'Snohetta, Oslo kıyısında yapılacak kütüphanenin tasarımını kamuya açıkladı. Yapının kademelenen çatısı aynı zamanda kamusal bir teras olarak kullanılacak; okuma salonu ise fiyorda bakacak biçimde konumlandırıldı. Çatının hem örtü hem kamusal zemin olarak çalışması, tasarımın kıyı hattıyla kurduğu ilişkinin ana aracı olarak öne çıkıyor.',
  category: 'haber',
  entities: [],
  quality_ok: true,
};

function fakeEnv({ aiResponses }) {
  const writes = [];
  const calls = [];
  const statement = (sql, params = []) => ({
    bind: (...p) => statement(sql, p),
    async all() {
      calls.push(sql);
      if (/FROM gundem_source_health/.test(sql)) return { results: [] };
      return { results: [] };
    },
    async first() {
      calls.push(sql);
      if (/COUNT\(\*\) AS c FROM gundem_items/.test(sql)) return { c: 0 };
      if (/FROM site_settings/.test(sql)) return null;
      if (/FROM gundem_items WHERE slug/.test(sql)) return null;
      return null;
    },
    async run() { writes.push({ sql, params }); return { success: true }; },
  });
  const aiQueue = [...aiResponses];
  return {
    env: {
      DB: {
        prepare: sql => statement(sql),
        async batch(sts) { const out = []; for (const st of sts) out.push(await st.run()); return out; },
      },
      AI: {
        async run(model) {
          // Embedding modeli ayrı: anlamsal mükerrer kapısı bu vektörü ister.
          if (/bge-m3/.test(model)) return { data: [Array.from({ length: 1024 }, () => 0.01)] };
          const next = aiQueue.shift();
          if (!next) throw new Error('beklenmeyen ek AI çağrısı');
          return { response: next };
        },
      },
      ENVIRONMENT: 'test',
    },
    writes, calls,
  };
}

const noDeps = {
  fetchOfficePool: async () => [],
  fetchArchitectPool: async () => [],
  fetchProductPool: async () => [],
  fetchProjectPool: async () => [],
};

const realFetch = globalThis.fetch;
function stubFetch() {
  globalThis.fetch = async (url) => new Response(FEED_XML, {
    status: 200, headers: { 'Content-Type': 'application/rss+xml' },
  });
}
function restoreFetch() { globalThis.fetch = realFetch; }

await test('Tek kaynaklı tur: temizlenmiş metinle tek AI çağrısı, bir satır YAYINLANIR', async () => {
  stubFetch();
  try {
    const { env, writes } = fakeEnv({ aiResponses: [GOOD_AI] });
    const stats = await runGundemIngestion(env, noDeps, {
      onlySources: ['dezeen-architecture'],
      ignoreSourceSchedule: true,
      maxItemsPerRun: 1,
      maxItemsPerSource: 1,
      runBudgetMs: 30000,
    });
    assert.equal(stats.published, 1, `yayın yok: ${JSON.stringify(stats.skipped)}`);
    assert.equal(stats.aiCalls, 1, 'ilk denemede geçmeliydi');
    const insert = writes.find(w => /INSERT OR IGNORE INTO gundem_items/.test(w.sql));
    assert.ok(insert, 'gundem_items INSERT yok');
    assert.equal(insert.params[2], GOOD_AI.title, 'başlık D1’e yazılmadı');
    assert.equal(insert.params[4], GOOD_AI.summary, 'özet D1’e yazılmadı');
    // source_facts / quality_ok D1'e YAZILMAZ (madde 9: internal validation alanı).
    assert.ok(!insert.params.some(p => typeof p === 'string' && /source_facts/.test(p)));
    assert.ok(!insert.params.some(p => Array.isArray(p)));
  } finally { restoreFetch(); }
});

await test('Model kendi öz-denetiminden geçmezse BİR KEZ yeniden üretilir', async () => {
  stubFetch();
  try {
    const doubted = { ...GOOD_AI, quality_ok: false };
    const { env } = fakeEnv({ aiResponses: [doubted, GOOD_AI] });
    const stats = await runGundemIngestion(env, noDeps, {
      onlySources: ['dezeen-architecture'], ignoreSourceSchedule: true,
      maxItemsPerRun: 1, maxItemsPerSource: 1, runBudgetMs: 30000,
    });
    assert.equal(stats.aiCalls, 2, 'öz-denetim reddi yeniden deneme tetiklemedi');
    assert.equal(stats.published, 1, JSON.stringify(stats.skipped));
  } finally { restoreFetch(); }
});

await test('Kalite kapısına takılan çıktı ikinci denemede de düzelmezse YAYINLANMAZ (güvenli fallback)', async () => {
  stubFetch();
  try {
    const bad = { ...GOOD_AI, summary: 'Çok kısa bir özet.' };
    const { env, writes } = fakeEnv({ aiResponses: [bad, bad] });
    const stats = await runGundemIngestion(env, noDeps, {
      onlySources: ['dezeen-architecture'], ignoreSourceSchedule: true,
      maxItemsPerRun: 1, maxItemsPerSource: 1, runBudgetMs: 30000,
    });
    assert.equal(stats.published, 0);
    assert.equal(stats.skipped.summary_too_short, 1, JSON.stringify(stats.skipped));
    assert.ok(!writes.some(w => /INSERT OR IGNORE INTO gundem_items/.test(w.sql)), 'reddedilen içerik yazıldı');
  } finally { restoreFetch(); }
});

await test('Yayıncı boilerplate’i modele GİTMEZ (uçtan uca doğrulama)', async () => {
  stubFetch();
  try {
    const seen = [];
    const { env } = fakeEnv({ aiResponses: [GOOD_AI] });
    const origRun = env.AI.run.bind(env.AI);
    env.AI.run = async (model, opts) => {
      if (!/bge-m3/.test(model)) seen.push(opts.messages[1].content);
      return origRun(model, opts);
    };
    await runGundemIngestion(env, noDeps, {
      onlySources: ['dezeen-architecture'], ignoreSourceSchedule: true,
      maxItemsPerRun: 1, maxItemsPerSource: 1, runBudgetMs: 30000,
    });
    assert.equal(seen.length, 1);
    assert.ok(!/appeared first on/i.test(seen[0]), 'boilerplate modele gitti');
    assert.ok(/stepped roof/.test(seen[0]), 'gerçek kaynak metni modele gitmedi');
    assert.ok(/KAYNAK ADRESİ:/.test(seen[0]), 'kaynak adresi verilmedi');
  } finally { restoreFetch(); }
});

// =================================================================================================
console.log('');
if (failed) {
  console.error(`GÜNDEM KALİTE TESTLERİ BAŞARISIZ — ${passed} geçti, ${failed} başarısız.`);
  failures.forEach(f => console.error(`  - ${f.name}: ${f.message.split('\n')[0]}`));
  process.exit(1);
}
console.log(`Gündem kalite testleri geçti — ${passed} test.`);
