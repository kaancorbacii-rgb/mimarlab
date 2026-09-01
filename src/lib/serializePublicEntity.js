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
// performance audit (2026-09-01, P1) — kart ızgaralarına gömülen `images` dizisi.
// Ölçüm: /api/architect/emre-arolat 47,3 KB'lık yanıtın 37,5 KB'ı (%79), /api/office/eaa-emre-arolat-
// architecture 45,3 KB'ın 36,1 KB'ı (%80) YALNIZCA relatedProjects[].images idi — 36-39 projenin
// TAM galerileri (proje başına ~12-15 URL). Bu ızgaraları çizen İSTEMCİ KODUNUN TAMAMI yalnızca
// `images[0]`'ı okuyor (tek tek doğrulandı: js/components/office-modal.js#401/758/797/813/831,
// js/components/architect-modal.js#352/700/711/769/780 — hepsi `p.images && p.images[0]` deseni),
// yani kalan tüm URL'ler hem ağda hem de her pop-up açılışında JSON.parse maliyetinde saf israftı.
// serializePublicEntity zaten BOŞ diziyi yükten tamamen çıkardığı için görselsiz kayıtlarda alan
// hiç görünmez — istemcinin `p.images &&` koruması bu durumu zaten karşılıyor (davranış değişmedi).
// shapeProjectItem'daki `coverOnly` seçeneğiyle AYNI ilke, yalnızca farklı bir çağrı yolu için.
export function coverImage(images) {
  return Array.isArray(images) ? images.slice(0, 1) : [];
}

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
