// Quiz aday havuzu — src/lib/duelPool.js İLE AYNI desen (dar SELECT + getCachedPool), ama Quiz'in
// soru tipleri (mimar/şehir/dönem/yapı türü, bkz. kullanıcı isteği) için gereken ek alanları taşır:
// discipline (Tür), period (Dönem), şehir (parseLocationFull ile çözümlenmiş) ve mimarın slug'ı
// ("Mimarı İncele" linki için). Yalnızca bu alanlardan EN AZ BİRİ dolu olan projeler havuza girer —
// her soru tipi kendi ihtiyacı olan alanı ayrıca boş mu diye süzer (bkz. src/routes/quiz.js).
import { parseCanonicalRow } from './canonicalRead.js';
import { DESIGNER_JOIN_SQL, OFFICE_NAMES_SQL, designerNamesFrom, officeNamesFrom, DESIGNER_SEP } from './projectPool.js';
import { getCachedPool } from './publicCache.js';
import ilIlceJs from '../../il-ilce-data.js';

const { parseLocationFull } = ilIlceJs;

async function fetchQuizPoolFresh(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.slug, p.title, p.discipline, p.period, p.location, p.images,
            GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names, ${OFFICE_NAMES_SQL},
            GROUP_CONCAT(ar.slug, '${DESIGNER_SEP}') AS architect_slugs
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
    const designer = designerNamesFrom(row.designer_names).filter(d => !officeNames.includes(d));
    const architectSlugs = row.architect_slugs ? row.architect_slugs.split(DESIGNER_SEP).filter(Boolean) : [];
    const loc = p.location ? parseLocationFull(p.location) : null;
    items.push({
      id: row.id,
      slug: p.slug,
      title: p.title,
      image,
      discipline: (p.discipline && p.discipline[0]) || null,
      period: (p.period && p.period[0]) || null,
      city: (loc && loc.city) || null,
      architect: designer[0] || officeNames[0] || null,
      architectSlug: architectSlugs[0] || null,
    });
  }
  return items;
}

// 'quiz:pool' — publicCache.js#POOL_CACHE_KINDS'e eklendi, diğer havuzlarla AYNI 30dk TTL/aktif
// invalidation'ı paylaşır.
export async function fetchQuizPool(env) {
  return getCachedPool(env, 'quiz:pool', () => fetchQuizPoolFresh(env));
}
