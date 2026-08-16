// Admin panelinden yönetilen genel site ayarları (bakım modu, duyuru banner'ı, öne çıkan
// projeler, robots.txt override) — bkz. migrations/0051_site_settings_seo_overrides.sql. Bakım
// modu kontrolü HER sayfa isteğinde çalışacağından (bkz. src/index.js#fetch), her seferinde D1'e
// gitmemek için env.FACET_CACHE'te tek bir bloba önbelleklenir — facetCounts.js#getCachedFacetCounts
// ile AYNI KV-cache-with-D1-fallback deseni.
import { reserveKvWrite } from './kvQuota.js';

const KV_KEY = 'site_settings_v1';
// Workers KV'nin izin verdiği en düşük expirationTtl 60sn'dir (bkz. gerçek bulgu — 30sn ile KV PUT
// 400 döndürüp bakım modu kontrolünü de içine alan HER sayfa isteğini 500'e düşürüyordu, canlıda
// ciddi bir kesinti riski). Bakım modu/duyuru gibi ayarların yayılma gecikmesi bu yüzden en az 60sn.
const KV_TTL_SECONDS = 60;

export const DEFAULT_SETTINGS = {
  maintenance_mode: '0',
  announcement_enabled: '0',
  announcement_text: '',
  announcement_link: '',
  featured_project_slugs: '',
  robots_txt: '',
};

export async function getSiteSettings(env) {
  if (env.FACET_CACHE) {
    const cached = await env.FACET_CACHE.get(KV_KEY, 'json');
    if (cached) return { ...DEFAULT_SETTINGS, ...cached };
  }
  const { results } = await env.DB.prepare(`SELECT key, value FROM site_settings`).all();
  const out = {};
  for (const row of results) out[row.key] = row.value;
  if (env.FACET_CACHE && await reserveKvWrite(env)) {
    await env.FACET_CACHE.put(KV_KEY, JSON.stringify(out), { expirationTtl: KV_TTL_SECONDS });
  }
  return { ...DEFAULT_SETTINGS, ...out };
}

export async function setSiteSetting(env, key, value) {
  if (!(key in DEFAULT_SETTINGS)) throw new Error(`Bilinmeyen ayar: ${key}`);
  await env.DB.prepare(
    `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, String(value ?? ''), Date.now()).run();
  if (env.FACET_CACHE) await env.FACET_CACHE.delete(KV_KEY);
}
