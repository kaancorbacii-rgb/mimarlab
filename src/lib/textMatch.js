// Türkçe büyük/küçük harf + aksan-bağımsız metin eşleştirme — src/routes/legacyContent.js,
// public.js, project.js, architect.js, office.js, product.js içinde altı ayrı yerde birebir aynı
// şekilde tanımlıydı (bkz. denetim bulgusu, MİMARLAB AI çalışması). O kopyalar artık bu dosyayı
// import ediyor (2026-09-10 Unicode normalizasyon düzeltmesi) — tek bir kaynak olmadan aşağıdaki
// NFC adımını altı yere birden eklemek gerekirdi ve bir sonraki kopyalamada yine unutulurdu.

// UNICODE NORMALİZASYONU (kullanıcı isteği, 2026-09-10: "doçem yazınca çıkmıyor, docem yazınca
// çıkıyor" — kökten çözülsün).
//
// KÖK NEDEN: "ç" harfinin İKİ ayrı Unicode gösterimi vardır ve ekranda İKİSİ DE BİREBİR AYNI görünür:
//   * NFC (birleşik):   U+00E7                       -> "doçem"
//   * NFD (ayrışık):    U+0063 U+0327 (c + çengel)   -> "doçem"
// foldTr yalnızca U+00E7'yi tanıyordu; ayrışık hâlde gelen sorguda 'c' ile birleşme çengeli AYRI iki
// kod noktası olduğundan hiçbir replace() eşleşmiyor, sorgu "doçem" olarak kalıyor ve
// veritabanındaki "docem" ile HİÇBİR ZAMAN eşleşmiyordu. Kullanıcı ekranda doğru yazdığını gördüğü
// için de sorun "Türkçe karakterle arama çalışmıyor" gibi görünüyordu. Canlıda doğrulandı
// (2026-09-10): /api/public/search-suggest?q=doc%CC%A7em -> 0 sonuç, ?q=do%C3%A7em -> 1 sonuç.
//
// NFD metin macOS dosya adlarından kopyala-yapıştırda, bazı klavye/IME'lerde, PDF ve web sayfası
// alıntılarında ve eski sistemlerden gelen dışa aktarımlarda düzenli olarak ortaya çıkar.
//
// ÇÖZÜM İKİ KATMANLI:
//   1. toNfc — SINIRLARDA (URL sorgu dizesi ve JSON gövdeleri, bkz. src/index.js ve src/lib/http.js)
//      uygulanır. KAYIPSIZDIR: NFC salt kanonik BİRLEŞTİRME yapar, hiçbir karakter atılmaz, metnin
//      anlamı değişmez — bu yüzden VERİTABANINA YAZILAN metinde de güvenle kullanılabilir.
//   2. foldTr — eşleştirme tarafında ek olarak, NFC'den SONRA da birleşememiş artık birleşme
//      işaretlerini (ör. 'k' + U+0327 gibi Unicode'da birleşik karşılığı olmayan diziler) atar.
//      Bu ADIM KAYIPLIDIR ve bilerek YALNIZCA katlama çıktısındadır — saklanan metne dokunmaz.
//
// KOLON SÖZLEŞMESİ KORUNUR: name_fold/title_fold/brand_fold generated kolonları (migration 0079) ve
// src/lib/searchFold.js#foldSqlExpr, foldTr ile BİREBİR aynı çıktıyı üretmek ZORUNDA (bazı uçlar
// `name_fold = ?` EŞİTLİĞİ kurar). Bu değişiklik o sözleşmeyi BOZMAZ: NFC girdide her iki adım da
// no-op'tur, yani zaten NFC olan her metin için foldTr'nin çıktısı BİT BİT AYNI kalır. Canlı D1'de
// doğrulandı (2026-09-10): projects.title/location, architects.name, offices.name, products.title
// kolonlarında birleşme işareti içeren SIFIR satır var, yani mevcut hiçbir eşitlik etkilenmiyor.
const COMBINING_MARKS = /[̀-ͯ]/;
const COMBINING_MARKS_G = /[̀-ͯ]/g;

// Kanonik birleştirme (NFC). Birleşme işareti İÇERMEYEN dizelerde normalize() hiç çağrılmaz —
// bu yol her istekte, her alanda çalıştığı için (bkz. src/lib/http.js#readJson'ın derin gezinmesi,
// gövdede megabaytlık base64 görsel verisi olabilir) tek bir regex taramasıyla erken çıkılır.
export function toNfc(s) {
  if (typeof s !== 'string' || !COMBINING_MARKS.test(s)) return s;
  return s.normalize('NFC');
}

export function trLower(s) {
  return toNfc(s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}

export function foldTr(s) {
  return trLower(s).replace(COMBINING_MARKS_G, '').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
}

// KİŞİ ADI BAŞ HARFİ (kullanıcı isteği, 2026-09-10 dokuzuncu tur madde 1: "Kişi sayfasında kişi
// isim ve soyismi otomatik olarak büyük harfle başlasın. örneğin kaan çorbacı yazılsa bile Kaan
// Çorbacı olsun.").
//
// NEDEN YAZMA ANINDA, GÖSTERİM ANINDA DEĞİL: `architects.name` bu depoda yalnızca bir etiket değil,
// AYNI ZAMANDA ANAHTAR — profile_claims.profile_key, office_founders eşleşmesi, künye adları ve
// rozet JOIN'leri hep bu değeri kullanır (bkz. [[project_duplicate_name_key_limitation]]). Gösterim
// anında büyütmek, kişi pop-up'ının başlığı ile firma pop-up'ındaki kurucu kartını / proje künyesini
// ayrıştırırdı. Bu yüzden normalizasyon gönderi kaydedilirken TEK noktada yapılır ve o andan sonra
// adı okuyan her yer aynı biçimi görür.
//
// İKİ KASITLI İSTİSNA:
//   1. ZATEN büyük harfle başlayan kelimeye HİÇ dokunulmaz — "MEHMET", "McDonald", "IND" gibi
//      yazımlar korunur. Yalnızca küçük harfle başlayanlar büyütülür, hiçbir harf küçültülmez.
//   2. Ad ortasındaki bağlaç/ön ekler ("de", "van", "bin"...) küçük kalır — canlı veride bunun
//      gerçek bir örneği var: "Eduardo de Nari" (architects #930), "Eduardo De Nari" olmamalı.
//      İlk kelime bu listede olsa bile büyütülür (ad hep büyük harfle başlar).
const NAME_PARTICLES = new Set([
  'de', 'del', 'della', 'di', 'da', 'dos', 'du', 'van', 'von', 'der', 'den', 'ter', 'ten',
  'bin', 'bint', 'ibn', 'el', 'al', 'la', 'le', 'les', 'y', 'e',
]);

// Türkçe'ye duyarlı baş harf büyütme: 'i' -> 'İ' (toLocaleUpperCase('tr') bunu doğru yapar ama
// çalışma ortamının ICU verisi olmadan derlenmiş olma ihtimaline karşı açıkça yazılır), 'ı' -> 'I'.
function upperFirstTr(ch) {
  if (ch === 'i') return 'İ';
  if (ch === 'ı') return 'I';
  return ch.toLocaleUpperCase('tr-TR');
}

function titleCaseWord(word, isFirst) {
  // Tireli adlar ("ali-can") her parçası ayrı bir ad gibi ele alınır.
  if (word.includes('-')) return word.split('-').map((part, i) => titleCaseWord(part, isFirst && i === 0)).join('-');
  if (!word) return word;
  const first = word[0];
  // Zaten büyük harfle (ya da harf olmayan bir karakterle) başlıyorsa dokunma.
  if (first !== trLower(first)) return word;
  if (!isFirst && NAME_PARTICLES.has(trLower(word))) return word;
  return upperFirstTr(first) + word.slice(1);
}

export function titleCasePersonName(name) {
  if (typeof name !== 'string') return name;
  const cleaned = toNfc(name).trim().replace(/\s+/g, ' ');
  if (!cleaned) return cleaned;
  return cleaned.split(' ').map((w, i) => titleCaseWord(w, i === 0)).join(' ');
}

// URLSearchParams'ın TÜM değerlerini NFC'ye çeker. Hiçbir değer birleşme işareti taşımıyorsa
// (ezici çoğunluk) hiçbir yazma yapılmaz ve `false` döner — URL dizesi bit bit olduğu gibi kalır
// (aksi halde yalnızca iterasyon yüzünden bile `?a+b` -> `?a%20b` gibi yeniden serileştirme olur ve
// publicCache'in URL tabanlı anahtarları boşuna ıskalardı).
//
// params.set() KULLANILMAZ: set(), o anahtarın DİĞER değerlerini de siler — çok seçmeli filtreler
// (bkz. proje/kişi/firma listelerinin `?discipline=a&discipline=b` biçimi) tek değere düşerdi.
// Bu yüzden değişiklik varsa tüm liste sırası korunarak baştan kurulur.
export function normalizeSearchParams(params) {
  const entries = [...params];
  const normalized = entries.map(([key, value]) => [toNfc(key), toNfc(value)]);
  if (normalized.every(([k, v], i) => k === entries[i][0] && v === entries[i][1])) return false;
  for (const [key] of entries) params.delete(key);
  for (const [key, value] of normalized) params.append(key, value);
  return true;
}

// JSON gövdesindeki her dizeyi NFC'ye çeker (nesne/dizi içinde derinlemesine). Nesne ANAHTARLARI da
// normalize edilir — aksi halde "başlık" alanı ayrışık bir anahtarla gelirse hiçbir okuyucu görmez.
export function deepNormalizeNfc(value) {
  if (typeof value === 'string') return toNfc(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = deepNormalizeNfc(value[i]);
    return value;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const key of Object.keys(value)) {
      const normalizedKey = toNfc(key);
      const normalizedValue = deepNormalizeNfc(value[key]);
      if (normalizedKey !== key) { delete value[key]; value[normalizedKey] = normalizedValue; }
      else value[key] = normalizedValue;
    }
  }
  return value;
}
