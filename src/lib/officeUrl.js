// officeUrl.js — bir `offices` satırının KANONİK URL ÖNEKİNİN tek kaynağı (kullanıcı isteği,
// 2026-09-06 madde 2: "Marka sayfasında yüklü olan 81 markanın — Autoban ve +Murat Tabanlıoğlu
// hariç — ve bundan sonra yüklenecek markaların URL'leri firma değil marka olmalı").
//
// KURAL, office-kind.js'in ZATEN var olan ayrımıdır, yeni bir sınıflandırma DEĞİL:
//   isPureBrandOffice(cats, productCount) === true  → /marka/:slug   (yalnızca üretici olan kayıtlar)
//   aksi halde                                       → /firma/:slug   (Autoban, +MURAT TABANLIOĞLU gibi
//                                                                     hem mimarlık yapan hem ürün
//                                                                     tasarlayan kayıtlar dahil)
// Yani "marka sayfasında görünen" (isBrandOffice) değil, "YALNIZCA marka olan" (isPureBrandOffice)
// kayıtlar önek değiştirir — kullanıcının saydığı iki istisna tam olarak bu ikisidir.
//
// ESKİ URL'LER KIRILMAZ: /firma/:slug ile gelen bir istek, kayıt saf markaysa 301 ile /marka/:slug'a
// yönlendirilir (bkz. src/index.js#serveDetailPage); tersi de geçerlidir. İstemci tarafında aynı
// düzeltmeyi popup'ın kendisi replaceState ile yapar (bkz. js/components/office-modal.js#
// syncCanonicalBasePath), böylece hangi bağlantıdan girilirse girilsin adres çubuğunda kanonik URL
// kalır.
import officeKindJs from '../../office-kind.js';

const { isPureBrandOffice } = officeKindJs;

export const OFFICE_PREFIX = '/firma/';
export const BRAND_PREFIX = '/marka/';

// offices.cats ÜÇ biçimde gelebilir: parseCanonicalRow'dan geçmiş dizi/düz string, ya da HAM D1
// değeri ('"Mimarlık · İç Mimarlık"' gibi JSON'a sarılmış string). officeCatList ilk ikisini
// çözüyor ama ham JSON'u çözmüyor (tırnaklar kategori adının parçası sayılırdı, bkz.
// src/routes/office.js#relatedOffices'teki AYNI gerçek bulgu) — bu yüzden ham değer burada
// normalize edilir.
export function normalizeOfficeCats(cats) {
  if (Array.isArray(cats)) return cats;
  if (typeof cats !== 'string') return '';
  const trimmed = cats.trim();
  if (!trimmed.startsWith('"') && !trimmed.startsWith('[')) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    return typeof parsed === 'string' ? parsed : '';
  } catch {
    return trimmed;
  }
}

export function isBrandUrlOffice(cats, productCount) {
  return isPureBrandOffice(normalizeOfficeCats(cats), productCount || 0);
}

export function officePathPrefix(cats, productCount) {
  return isBrandUrlOffice(cats, productCount) ? BRAND_PREFIX : OFFICE_PREFIX;
}

export function officePath(slug, cats, productCount) {
  return `${officePathPrefix(cats, productCount)}${encodeURIComponent(slug)}`;
}
