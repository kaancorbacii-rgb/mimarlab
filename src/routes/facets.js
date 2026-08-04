import { errorJson, json } from '../lib/http.js';
import { getCachedFacetCounts } from '../lib/facetCounts.js';

const SUPPORTED = new Set(['projects', 'products']);

// GET /api/facets/:listType — sidebar filtre sayaçlarının hızlı, filtresiz (global) anlık görüntüsü
// (bkz. src/lib/facetCounts.js dosya başı kapsam notu — yalnızca projects/products). Dependent/
// faceted (aktif filtreye bağlı) sayım hâlâ src/routes/project.js#handleProjectFiltersRoute'un
// canlı taramasında yapılır; bu uç yalnızca "hiç filtre seçili değil" durumundaki ilk render için.
export async function handleFacetsRoute(request, env, url, listType) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  if (!SUPPORTED.has(listType)) return errorJson('Geçersiz liste tipi.');
  const out = await getCachedFacetCounts(env, listType);
  return json({ facets: out });
}
