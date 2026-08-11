import { errorJson } from '../lib/http.js';
import { getCachedFacetCounts } from '../lib/facetCounts.js';
import { cachedPublicJson } from '../lib/publicCache.js';

const SUPPORTED = new Set(['projects', 'products']);

// GET /api/facets/:listType — sidebar filtre sayaçlarının hızlı, filtresiz (global) anlık görüntüsü
// (bkz. src/lib/facetCounts.js dosya başı kapsam notu — yalnızca projects/products). Dependent/
// faceted (aktif filtreye bağlı) sayım hâlâ src/routes/project.js#handleProjectFiltersRoute'un
// canlı taramasında yapılır; bu uç yalnızca "hiç filtre seçili değil" durumundaki ilk render için.
// gerçek bulgu: bu uç önceden edge Cache API katmanını (bkz. publicCache.js) tamamen atlıyordu —
// altındaki getCachedFacetCounts KV'nin kendi 300s TTL'i D1'i koruyordu ama proje.html/urun.html
// kenar çubuğu her sayfa yüklemesinde yine de Worker+KV'ye gidiyordu. publicCache.js#CACHEABLE_PATHS'e
// eklenen '/api/facets/projects' ve '/api/facets/products' ile artık admin/gönderi onayı yazma
// yollarının zaten tetiklediği invalidatePublicCache() BU uca da otomatik uygulanıyor (facetCounts.js#
// bumpFacetCounts ile AYNI yazma yollarından çağrılıyor, ayrı bir invalidation eklemeye gerek yok).
export async function handleFacetsRoute(request, env, url, listType) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  if (!SUPPORTED.has(listType)) return errorJson('Geçersiz liste tipi.');
  return cachedPublicJson(request, env, url.pathname, async () => ({ facets: await getCachedFacetCounts(env, listType) }));
}
