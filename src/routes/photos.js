// GET /api/photos — /fotograf sayfasının (kullanıcı isteği, 2026-09-17: "Ekteki görseldeki ve
// https://co-architecture.com/photos bu linkteki şekilde ... yükleme sırasına göre en son
// yüklenenden ilk yüklenene doğru sıralanacağı bir sayfa") veri ucu.
//
// Havuz src/lib/photoPool.js#fetchPhotoPool'dan gelir (KV-önbellekli, proje eklendiğinde/
// düzenlendiğinde/gizlendiğinde invalidatePublicCache() ile tazelenir) — bu uç yalnızca o havuzu
// mekan filtresine göre süzer, sayfalar ve sayfa başına "Project posted by X" bilgisini zenginleştirir.
import { errorJson } from '../lib/http.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { fetchPhotoPool } from '../lib/photoPool.js';
import { fetchOwnerByline } from '../lib/ownerByline.js';
import photoSpaceTaxonomyJs from '../../photo-space-taxonomy.js';

const { PHOTO_SPACE_OPTIONS } = photoSpaceTaxonomyJs;

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 120;

export async function handlePhotosRoute(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const pool = await fetchPhotoPool(env);
    // Mekan filtresi — yalnızca sabit listedeki (photo-space-taxonomy.js) bir değer kabul edilir,
    // aksi halde (yazım hatası/uydurma değer) filtre SESSİZCE yok sayılır ve TÜM havuz döner —
    // "geçersiz filtre" sebebiyle boş bir sayfa göstermek yerine güvenli/geniş sonuca düşülür.
    const space = (url.searchParams.get('space') || '').trim();
    const filtered = space && PHOTO_SPACE_OPTIONS.includes(space)
      ? pool.filter(p => p.spaces.includes(space))
      : pool;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const page = filtered.slice(offset, offset + limit);

    // "Project posted by X" (kullanıcı isteği: ekteki 2. görseldeki lightbox künyesi) — bkz.
    // src/lib/ownerByline.js: 2026-09-09'da ANA proje popup'ından kaldırılmış bir alan, bu YENİ
    // sayfa için YENİDEN kullanılıyor (farklı bağlam, aynı fonksiyon). Sayfa başına en fazla
    // `limit` benzersiz proje olabileceğinden (genelde çok daha az — bir projenin 10-20 görseli
    // aynı sahibi paylaşır) TEKİL ownerUserId'ler için ayrı ayrı çözülür, N+1 riski küçüktür.
    const ownerIds = [...new Set(page.map(p => p.ownerUserId).filter(Boolean))];
    const bylineById = new Map();
    await Promise.all(ownerIds.map(async (id) => { bylineById.set(id, await fetchOwnerByline(env, id)); }));

    const items = page.map(p => {
      const byline = p.ownerUserId ? bylineById.get(p.ownerUserId) : null;
      return {
        url: p.url,
        projectSlug: p.projectSlug,
        projectTitle: p.projectTitle,
        projectLocation: p.projectLocation,
        spaces: p.spaces,
        // claimed_by_user_id yoksa (legacy_static/admin kökenli proje, bkz. canonicalSync.js#
        // resolveClaimedByUserId) "MİMARLAB" — src/routes/comments.js#listComments'teki admin
        // fallback'iyle AYNI isim, "kim paylaştı" sorusunun sahipsiz kayıtlardaki cevabı.
        ownerName: (byline && byline.ownerName) || 'MİMARLAB',
        ownerPhoto: (byline && byline.ownerPhoto) || null,
      };
    });
    return { items, total: filtered.length, hasMore: offset + limit < filtered.length, spaces: PHOTO_SPACE_OPTIONS };
  });
}
