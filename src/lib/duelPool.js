// Düello aday havuzu — src/lib/projectPool.js#fetchActiveProjectPool İLE AYNI filtre (deleted_at/
// hidden_at IS NULL, build_status='built') ama ayrı, dar bir SELECT: yalnızca eşleşme/kart için
// gereken alanlar + p.id. fetchActiveProjectPool'un shapeProjectItem'ı sayısal id'yi dışa hiç
// vermiyor (liste kartları/facet sayaçları onu hiç kullanmaz) — düello ise project_duel_stats/
// duel_matches FK'leri için buna ihtiyaç duyar. Paylaşılan shapeProjectItem'ı bunun için değiştirmek
// yerine (o fonksiyonun diğer tüketicilerini etkileme riski taşır) kendi kendine yeten, dar bir
// sorgu tercih edildi — yine de DESIGNER_JOIN_SQL/OFFICE_NAMES_SQL/designerNamesFrom/officeNamesFrom
// aynı dosyadan içe aktarılıp TEKRAR YAZILMAZ.
import { parseCanonicalRow } from './canonicalRead.js';
import { DESIGNER_JOIN_SQL, OFFICE_NAMES_SQL, designerNamesFrom, officeNamesFrom, DESIGNER_SEP } from './projectPool.js';
import { getCachedPool } from './publicCache.js';

// Yalnızca en az bir görseli olan projeler dahil edilir (kullanıcı isteği madde 5: "yeterli
// görseli olan projeler") — düello kartları görsel ağırlıklı olmak zorunda.
async function fetchDuelPoolFresh(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.slug, p.title, p.category, p.type, p.location, p.images,
            GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names, ${OFFICE_NAMES_SQL}
     FROM projects p ${DESIGNER_JOIN_SQL}
     WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND p.build_status = 'built'
     GROUP BY p.id`
  ).all();
  const items = [];
  for (const row of results) {
    const p = parseCanonicalRow('projects', row);
    const image = (p.images && p.images[0]) || null;
    if (!image) continue;
    const officeNames = officeNamesFrom(row.office_names);
    items.push({
      id: row.id, slug: p.slug, title: p.title, category: p.category || [], type: p.type || [],
      location: p.location, image,
      designer: designerNamesFrom(row.designer_names).filter(d => !officeNames.includes(d)),
      officeNames,
    });
  }
  return items;
}

// 'duel:pool' — publicCache.js#POOL_CACHE_KINDS'e eklendi, diğer 5 havuzla AYNI 30dk TTL/aktif
// invalidation'ı paylaşır (bkz. o dosyadaki yorum).
export async function fetchDuelPool(env) {
  return getCachedPool(env, 'duel:pool', () => fetchDuelPoolFresh(env));
}
