// Faz 4B — Payload Minimization: liste/kart görünümlerindeki null/undefined/boş string/boş array/
// boş obje alanları JSON'dan tamamen çıkarır. Yalnızca LİSTE/KART öğelerine (kisi.html/firma.html/
// urun.html/proje.html'in kart render fonksiyonları) uygulanır — sayfalama meta verisi (total/page/
// totalPages/filters) bu fonksiyondan HİÇ geçirilmez, istemci bunların her zaman mevcut olmasını
// bekler.
//
// Güvenlik notu: budama öncesi js/components/*.js + kisi.html/firma.html/urun.html/proje.html'deki
// TÜM tüketim noktaları tek tek grep'lendi — hepsi zaten güvenli erişim kalıbı kullanıyor (`a.dob ?`,
// `o.badges || []`, `config.getStaticBadges() || []`, `(candidate.designer || [])`, `item.discipline
// && item.discipline.length` vb.). TEK istisna proje.html'deki kart "kaydet" butonuydu
// (`p.images[0]` — `p.images &&` koruması olmadan) — bu ayrıca düzeltildi (bkz. proje.html satır
// ~1161), aksi halde images boş dizi olduğunda bu satır TypeError fırlatıp tüm sayfa render'ını
// kırardı.
export function serializePublicEntity(value) {
  if (Array.isArray(value)) return value.map(serializePublicEntity);
  if (value === null || typeof value !== 'object') return value;

  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const v = serializePublicEntity(raw);
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[key] = v;
  }
  return out;
}
