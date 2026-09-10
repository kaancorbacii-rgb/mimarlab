// Unicode NFC normalizasyonu regresyon testi (kullanıcı isteği, 2026-09-10: "doçem yazınca
// çıkmıyor ama docem yazınca çıkıyor — kökten çöz").
//
// KÖK NEDEN ve tasarım için bkz. src/lib/textMatch.js dosya başı. Kısaca: "ç" ekranda aynı görünen
// iki Unicode gösterimle yazılabilir (birleşik U+00E7 / ayrışık 'c'+U+0327) ve foldTr yalnızca
// birleşiği tanıyordu; ayrışık yazılan sorgu D1'deki hiçbir fold değeriyle eşleşmiyordu.
//
// BU TESTİN ASIL DEĞERİ İKİNCİ BÖLÜMDE: name_fold/title_fold/brand_fold generated kolonları
// (migrations/0079) ve src/lib/searchFold.js#foldSqlExpr, JS foldTr ile BİREBİR aynı çıktıyı
// üretmek ZORUNDA — bazı uçlar `name_fold = ?` EŞİTLİĞİ kurar (bkz. claimedProfiles.js,
// product.js?brand=). foldTr'ye eklenen NFC/birleşme-işareti adımı zaten NFC olan girdide no-op
// olmalı; bu test onu sabitler, yani biri katlamaya "bir küçük normalizasyon daha" eklerse
// kolonlarla sessizce ayrışmadan ÖNCE burada patlar.
import { foldTr, toNfc, normalizeSearchParams, deepNormalizeNfc } from '../src/lib/textMatch.js';

let failed = 0;
function ok(cond, label) {
  if (cond) console.log('  ok ' + label);
  else { console.log('  FAIL ' + label); failed++; }
}

console.log('1) bildirilen hata: ayrışık yazılan Türkçe harf');
ok(foldTr('doçem'.normalize('NFD')) === 'docem', 'NFD "doçem" -> docem');
ok(foldTr('doçem') === 'docem', 'NFC "doçem" -> docem');
ok(foldTr('DOÇEM İçe Dönük Çocuklar Okulu'.normalize('NFD')) === 'docem ice donuk cocuklar okulu',
   'NFD tam başlık -> beklenen fold');
for (const w of ['dönük', 'şişli', 'ığdır', 'güneş', 'çocuklar', 'İçe', 'ÇOCUKLAR', 'Ağaoğlu', 'Öztürk']) {
  ok(foldTr(w.normalize('NFD')) === foldTr(w.normalize('NFC')), `NFD == NFC: ${w}`);
}
// Unicode'da birleşik karşılığı OLMAYAN dizi (ör. 'z' + U+0327): NFC birleştiremez, bu yüzden
// katlama NFC'DEN SONRA kalan işareti ayrıca atar — aksi halde böyle bir sorgu yine hiçbir şey
// bulamazdı. Bu adım BİLEREK yalnızca katlama çıktısındadır, saklanan metne dokunmaz.
ok(foldTr('z\u0327ose') === 'zose', 'birleşemeyen işaret (z+U+0327) katlamada atılır');

console.log('2) fold kolonu sözleşmesi — NFC girdide çıktı BİT BİT değişmemeli');
// Kaldırılan yerel kopyaların (src/routes/{public,project,architect,office,product}.js,
// src/lib/{canonicalSync,officeFounderCascade,claimedProfiles}.js) BİREBİR eski hâli.
const oldTrLower = (s) => (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
const oldFoldTr = (s) => oldTrLower(s).replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
// Canlı D1'den alınmış gerçek örnekler: Türkçe harfler, şapkalılar, ALL-CAPS, ASCII 'I',
// noktalama ve yabancı aksanlar (bkz. searchFold.js#ACCENT_FOLD'un gerekçesindeki kayıtlar).
const LIVE_SAMPLES = [
  'DOÇEM İçe Dönük Çocuklar Okulu', 'Celâleddin Çelik', 'İbrahim Kâmil Ağa',
  'Lâpseki Hükümet Konağı', 'Yapay Zekâ Müzesi', 'José Bruguera', 'èdoc architects',
  'R.A.F. Studio', 'SANKAI', 'BİRİM Design', 'Nevzat Sayın', 'Autoban', 'Şefik Mimarlık',
  'Sabiha Gökçen Havalimanı', 'Akbank Akademi Yaşam Merkezi', 'Uğur Böceği Anaokulu',
];
for (const s of LIVE_SAMPLES) {
  ok(foldTr(s) === oldFoldTr(s), `eski foldTr ile birebir aynı: ${JSON.stringify(s)}`);
}

console.log('3) sınırlar — sorgu dizesi ve JSON gövdesi');
const decomposed = new URLSearchParams();
decomposed.set('q', 'doçem'.normalize('NFD'));
ok(normalizeSearchParams(decomposed) === true && decomposed.get('q') === 'doçem',
   'normalizeSearchParams ayrışık q\'yu düzeltir');
// Temiz URL'ye DOKUNULMAMALI: yalnızca iterasyon yüzünden yeniden serileştirmek
// (`?a+b` -> `?a%20b`) publicCache'in URL tabanlı anahtarlarını ıskalatırdı.
const clean = new URLSearchParams('a=1&a=2&b=3');
ok(normalizeSearchParams(clean) === false && clean.toString() === 'a=1&a=2&b=3',
   'temiz sorgu dizesi bit bit korunur');
// set() yerine yeniden kurma: çok seçmeli filtreler tek değere düşmemeli.
const multi = new URLSearchParams();
multi.append('discipline', 'Mimari');
multi.append('discipline', 'İç Mekan'.normalize('NFD'));
ok(normalizeSearchParams(multi) === true
   && multi.getAll('discipline').join('|') === 'Mimari|İç Mekan',
   'çok değerli filtre anahtarı korunur');

const body = deepNormalizeNfc({
  title: 'Doçem'.normalize('NFD'),
  tags: ['Şişli'.normalize('NFD'), 'x'],
  nested: { ['Öz'.normalize('NFD')]: 'Ağ'.normalize('NFD') },
  count: 3, flag: false, empty: null,
});
ok(body.title === 'Doçem', 'gövdedeki dize NFC');
ok(body.tags[0] === 'Şişli' && body.tags[1] === 'x', 'dizi elemanları NFC');
ok(body.nested['Öz'] === 'Ağ', 'nesne ANAHTARI da NFC');
ok(body.count === 3 && body.flag === false && body.empty === null, 'dize olmayanlar aynen geçer');
ok(toNfc(12) === 12 && toNfc(null) === null && toNfc(undefined) === undefined,
   'toNfc dize olmayanı olduğu gibi döndürür');

console.log(failed === 0 ? 'TÜMÜ GEÇTİ' : `${failed} TEST BAŞARISIZ`);
process.exit(failed ? 1 : 0);
