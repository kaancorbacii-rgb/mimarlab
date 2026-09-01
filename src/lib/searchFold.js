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

export { escapeLike, MAX_CODEPOINT };
