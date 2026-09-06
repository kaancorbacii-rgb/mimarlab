// Otomatik tamamlama uçlarının paylaşılan iki aşamalı arama yardımcısı — bkz.
// migrations/0079_search_fold_columns.sql'in başındaki kök neden/tasarım açıklaması.
//
// Kısaca: eşleştirme artık Worker'da (tüm satırları çekip JS'te foldTr ile filtreleyerek) değil,
// SQLite içinde, foldTr()'nin birebir SQL karşılığını hesaplayan indexli bir generated column
// üzerinde yapılıyor.
//   1. AŞAMA (indexli): önek araması. `fold >= q AND fold < q || char(1114111)` — B-tree aralık
//      taraması, tam tarama YOK. Otomatik tamamlamada baskın durum.
//   2. AŞAMA (yalnızca gerekirse): substring geri düşüşü `fold LIKE '%q%'`. Baştan joker içeren bir
//      desen hiçbir B-tree ile indexlenemez, bu yüzden burada tarama kaçınılmaz — ama filtre SQL'de
//      olduğundan Worker'a tüm tablo yerine en fazla `limit` satır taşınır ve mevcut alfabetik sıra
//      (ORDER BY) korunur.
// BİLİNÇLİ DAVRANIŞ DEĞİŞİKLİĞİ — eski davranışla BİREBİR AYNI DEĞİLDİR, bu fark ölçülüp
// kabul edilmiştir (yerelde 120 sorgu/uç kombinasyonuyla doğrulandı):
//   * Eşleşme sayısı <= limit ise sonuç kümesi ESKİSİYLE AYNIDIR (hiçbir kayıt düşmez).
//   * Eşleşme sayısı > limit ise ÖNEK eşleşmeleri önceliklidir. Eskiden liste düz alfabetikti;
//     bu, "sa" yazınca 'Akbank Akademi Yaşam Merkezi'ni (eşleşme kelime ORTASINDA) 'SALT' ve
//     'Sabiha Gökçen Havalimanı'nın (gerçek önek eşleşmesi) ÖNÜNE koyuyordu — otomatik tamamlama
//     için yanlış sıralama. Yeni sıra hem daha alakalı hem de index'lenebilir olan sıradır.
//   * Dönen hiçbir kayıt eskiden eşleşmeyecek bir kayıt DEĞİLDİR (yanlış pozitif yok).
//
// keyOf: SATIR KİMLİĞİ döndürmelidir (ad değil) — amacı, aynı satırın iki aşamada birden
// listelenmesini önlemektir; aynı ada sahip FARKLI iki kaydı (bu depoda mümkün, bkz. proje notu:
// kayıtlar çıplak isimle anahtarlanıyor) birbirine karıştırıp birini düşürmemelidir.

// SQLite'ta LIKE'ın joker karakterleri % ve _ — kullanıcı bunları yazarsa desen anlamı kaymasın diye
// kaçışlanır (ESCAPE '\' ile birlikte kullanılır). Ters eğik çizginin kendisi de kaçışlanmalı.
function escapeLike(q) {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Önek aralığının üst sınırı: q ile başlayan HER dize, q + U+10FFFF'ten küçüktür (UTF-8 bayt sırası
// kod noktası sırasıyla aynıdır ve U+10FFFF Unicode'un en büyük kod noktasıdır) — bu yüzden
// `fold >= q AND fold < upper` tam olarak "q ile başlayanlar" kümesini verir ve index'i kullanır.
// char(1114111) doğrudan SQL'de de üretilebilirdi; burada JS tarafında üretmek sorguyu sadeleştirir.
const MAX_CODEPOINT = String.fromCodePoint(0x10ffff);

// buildSql(whereExtra, orderLimit) -> tam SQL dizesi; çağıran, sorgunun geri kalanını (SELECT/FROM/
// JOIN) kendisi kurar ve `fold` kolonunun nitelenmiş adını (ör. "a.name_fold") verir.
//
// runQuery(sql, params) -> Promise<rows>. Çağıran env.DB'yi kapatarak geçirir.
//
// Dönen değer: en fazla `limit` satır, 1. aşama sonuçları önce.
export async function foldedPrefixThenSubstring({ runQuery, sqlFor, foldColumn, q, limit, keyOf }) {
  const prefixRows = await runQuery(
    sqlFor(`AND ${foldColumn} >= ? AND ${foldColumn} < ?`, limit),
    [q, q + MAX_CODEPOINT]
  );
  if (prefixRows.length >= limit) return prefixRows.slice(0, limit);

  // 2. aşama — 1. aşama listeyi dolduramadı, substring eşleşmelerini de ara. Zaten bulunanlar
  // tekrar edilmesin diye anahtara göre tekilleştirilir (aynı satır iki aşamada da eşleşebilir).
  const seen = new Set(prefixRows.map(keyOf));
  const substringRows = await runQuery(
    sqlFor(`AND ${foldColumn} LIKE ? ESCAPE '\\'`, limit),
    [`%${escapeLike(q)}%`]
  );
  const merged = prefixRows.slice();
  for (const row of substringRows) {
    if (merged.length >= limit) break;
    if (seen.has(keyOf(row))) continue;
    seen.add(keyOf(row));
    merged.push(row);
  }
  return merged;
}

// ---------------------------------------------------------------------------------------------
// ÇOK ALANLI / ÇOK KELİMELİ VARYANT (performans denetimi, 2026-09-06 madde 2)
//
// foldedPrefixThenSubstring TEK bir fold kolonu ve TEK bir sorgu dizesi varsayar; bu, adı tek bir
// alanda arayan otomatik tamamlama uçları için yeterliydi. /api/public/search-suggest ise
// legacyContent.js#fuzzyMatch semantiğini taşır ve ondan iki noktada ayrılır:
//   * ÇOK ALAN — bir proje BAŞLIĞIYLA ya da KONUMUYLA eşleşebilir; bir ürün başlık, kategori ya da
//     marka adıyla. Alanlar arasında ilişki VEYA'dır.
//   * ÇOK KELİME — "sefik mimarlik" sorgusu, kelimelerin TEK BİR alanın içinde (herhangi bir sırada,
//     aralarında başka kelimeler olabilir) hepsinin geçmesini ister. Alan içindeki ilişki VE'dir.
// Yani koşul: (alan1 TÜM kelimeleri içerir) VEYA (alan2 TÜM kelimeleri içerir) VEYA ...
//
// FOLD KOLONU OLMAYAN ALANLAR: foldColumns girdisi bir kolon ADI değil, herhangi bir SQL İFADESİ
// olabilir — indexli generated kolonu olan alanlar (name_fold/title_fold/brand_fold) doğrudan
// verilir, olmayanlar (projects.location, products.category) foldSqlExpr() ile satır içinde
// hesaplanır. BU BİR ÖDÜN DEĞİLDİR: VIRTUAL generated kolon da her okumada aynı ifadeyi hesaplar,
// ve 2. aşamanın `LIKE '%q%'` deseni zaten hiçbir B-tree ile indexlenemez (bkz. migration 0079
// başındaki "dürüst sınır" notu). Yani yeni bir migration eklemek bu sorguda ölçülebilir hiçbir
// şey kazandırmazdı; kazanç, filtrenin SQLite'ın İÇİNDE kalması ve Worker'a tüm tablo yerine en
// fazla `limit` satır taşınmasıdır.
//
// SQL İFADE DERİNLİĞİ: terim sayısı alan × kelime kadar büyür. D1 çok terimli mantıksal ifadeleri
// bir noktadan sonra reddettiğinden (bkz. proje notu: SQLite ifade-ağacı derinlik sınırı) kelime
// sayısı SQL_MAX_WORDS ile sınırlanır; sınırın üstündeki kelimeler ÇAĞIRAN tarafından JS'te
// (dönen en fazla `limit` satır üzerinde) uygulanmalıdır — bu yüzden fonksiyon, SQL'de fiilen
// kullanılan kelimeleri de döndürür.
const SQL_MAX_WORDS = 8;

// src/lib/textMatch.js#foldTr'nin BİREBİR SQL karşılığı — migration 0079'daki generated column
// ifadesiyle adım adım aynıdır (önce Türkçe'ye özel büyük harfler elle indirilir, çünkü SQLite'ın
// lower()'ı İ/I/Ş/Ğ/Ü/Ö/Ç bilmez; sonra lower(); sonra aksan katlaması). Üçü (JS foldTr, 0079'un
// kolonları, bu ifade) BİRLİKTE değişmelidir.
export function foldSqlExpr(column) {
  return `replace(replace(replace(replace(replace(replace(
    lower(replace(replace(replace(replace(replace(replace(replace(${column},'İ','i'),'I','ı'),'Ş','ş'),'Ğ','ğ'),'Ü','ü'),'Ö','ö'),'Ç','ç')),
  'ı','i'),'ş','s'),'ç','c'),'ğ','g'),'ü','u'),'ö','o')`;
}

// foldedPrefixThenSubstring ile AYNI iki aşamalı yapı ve AYNI garanti: dönen hiçbir satır eskiden
// eşleşmeyecek bir satır DEĞİLDİR (yanlış pozitif yok) ve eşleşme sayısı <= limit ise küme eskisiyle
// aynıdır. 1. aşamanın öneki TÜM sorgu dizesidir (q) — çok kelimeli bir sorguda bir alan q ile
// BAŞLIYORSA o alan zaten tüm kelimeleri içerir, yani 1. aşama her zaman fuzzyMatch'in bir ALT
// kümesidir; eksik kalan gerçek eşleşmeleri 2. aşama toplar.
//
// indexedFoldColumns 1. AŞAMADA kullanılacak alanların ALT KÜMESİDİR ve YALNIZCA gerçekten index'i
// olan generated kolonlar buraya konmalıdır. YERELDE EXPLAIN İLE ÖLÇÜLDÜ: SQLite'ın MULTI-INDEX OR
// optimizasyonu ancak OR'un TÜM dalları indexlenebilirse devreye girer —
//   (title_fold>? AND title_fold<?) OR (brand_fold>? AND brand_fold<?)
//     -> MULTI-INDEX OR / SEARCH ... USING INDEX idx_products_title_fold + idx_products_brand_fold
// ama araya indexsiz bir ifade (ör. foldSqlExpr('location')) girdiği anda plan tüm tabloyu tarayan
// tek bir SCAN'e düşer ve 1. aşamanın tek varlık nedeni ortadan kalkar. Bu yüzden indexsiz alanlar
// yalnızca 2. aşamaya (zaten kaçınılmaz olarak tarayan substring geri düşüşüne) bırakılır —
// RECALL'DAN HİÇBİR ŞEY KAYBEDİLMEZ, çünkü 2. aşama tüm alanları kapsar.
export async function foldedMultiFieldSearch({ runQuery, sqlFor, foldColumns, indexedFoldColumns, q, words, limit, keyOf }) {
  const sqlWords = words.slice(0, SQL_MAX_WORDS);
  const prefixCols = indexedFoldColumns || foldColumns;
  const prefixCond = `AND (${prefixCols.map(c => `(${c} >= ? AND ${c} < ?)`).join(' OR ')})`;
  const prefixParams = [];
  prefixCols.forEach(() => prefixParams.push(q, q + MAX_CODEPOINT));
  const prefixRows = await runQuery(sqlFor(prefixCond, limit), prefixParams);
  if (prefixRows.length >= limit) return { rows: prefixRows.slice(0, limit), sqlWords };

  const seen = new Set(prefixRows.map(keyOf));
  const subCond = `AND (${foldColumns
    .map(c => `(${sqlWords.map(() => `${c} LIKE ? ESCAPE '\\'`).join(' AND ')})`)
    .join(' OR ')})`;
  const subParams = [];
  foldColumns.forEach(() => sqlWords.forEach(w => subParams.push(`%${escapeLike(w)}%`)));
  const subRows = await runQuery(sqlFor(subCond, limit), subParams);

  const merged = prefixRows.slice();
  for (const row of subRows) {
    if (merged.length >= limit) break;
    if (seen.has(keyOf(row))) continue;
    seen.add(keyOf(row));
    merged.push(row);
  }
  return { rows: merged, sqlWords };
}

export { escapeLike, MAX_CODEPOINT, SQL_MAX_WORDS };
