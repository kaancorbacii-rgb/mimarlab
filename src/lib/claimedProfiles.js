// "Bu kayıt bir üyeye atanmış mı?" — kişi/firma/marka/proje/ürün pop-up'larındaki
// "Kamuya açık kaynaklardan derlenmiştir, doğrulanmamıştır." uyarısının TEK kaynağı.
//
// NEDEN (kullanıcı isteği, 2026-09-08 madde 5): o uyarı, sitedeki kayıtların çoğunun kamuya açık
// kaynaklardan derlenmiş, kimsenin doğrulamadığı içerik olmasından geliyor. Bir profil bir üyeye
// atandığı (onaylı profile_claims) andan itibaren bu doğru DEĞİLDİR — künyeyi artık profilin
// sahibi yönetiyor. Uyarı yalnızca o profilin kendi pop-up'ından değil, o profile ait proje ve
// ürün pop-up'larından da kalkar.
//
// Eşleştirme profile_claims.profile_key (= profilin ADI) üzerinden yapılır — bu tablo bu depoda
// her yerde çıplak isimle anahtarlanıyor (bkz. proje notu: "Duplicate name key limitation"),
// profile_type ayrımı burada KASITLI olarak yapılmaz: aynı adı taşıyan bir kişi ve bir firma
// zaten aynı gerçek varlıktır (kurumsal hesaplar), ikisinden birinin sahiplenilmiş olması bu
// uyarıyı kaldırmak için yeterlidir.
//
// TEK SORGU: çağıranlar (project/product) künyedeki TÜM isimleri tek bir IN(...) listesiyle sorar.
// Düz IN(...) kullanılır, `A OR B` zinciri DEĞİL — bkz. proje notu: SQLite ifade-ağacı derinlik
// sınırı 100 (100+ terimli OR zincirleri D1 tarafından her zaman reddedilir).
export async function anyProfileClaimed(env, names) {
  const unique = [...new Set((names || []).map(n => (n || '').trim()).filter(Boolean))];
  if (!unique.length) return false;
  // Künye çok uzun olsa bile tek ifadede kalsın diye üst sınır — 100'den fazla künye adı taşıyan
  // bir kayıt bu depoda yok, sınır yalnızca bozuk/uç veriye karşı bir emniyet supabıdır.
  const keys = unique.slice(0, 100);
  const row = await env.DB.prepare(
    `SELECT 1 FROM profile_claims
      WHERE status = 'approved' AND profile_key IN (${keys.map(() => '?').join(', ')}) LIMIT 1`
  ).bind(...keys).first();
  return !!row;
}
