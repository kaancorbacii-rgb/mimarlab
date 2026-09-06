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
  // GÜNDEM KILL SWITCH (kullanıcı isteği, 2026-09-06 madde 17). '1' = otomasyon açık (varsayılan),
  // başka her değer = KAPALI: cron çalışır ama hiçbir kaynağa gidilmez ve hiçbir içerik yayınlanmaz
  // (bkz. src/lib/gundemIngest.js#runGundemIngestion'ın ilk kapısı). Yeni bir yapılandırma
  // mekanizması kurulmadı — admin panelinin Site Ayarları sekmesi (PATCH /api/admin/settings)
  // DEFAULT_SETTINGS'in anahtarları üzerinde jenerik çalıştığından bu satır tek başına anahtarı
  // yönetilebilir kılar. Yayındaki içerik kill switch'ten ETKİLENMEZ (kapatmak sayfayı boşaltmaz,
  // yalnızca yeni içerik akışını durdurur) — bilinçli: acil durumda "akışı durdur" ile "sayfayı
  // kaldır" farklı kararlardır.
  gundem_automation_enabled: '1',
};

export async function getSiteSettings(env) {
  // bkz. src/index.js#maybeServeMaintenancePage — bu fonksiyon HEMEN HEMEN HER sayfa isteğinde
  // (bakım modu kontrolü) çalışır, bu yüzden env.FACET_CACHE.get()/put() src/lib/publicCache.js#
  // getCachedFingerprint'teki AYNI try/catch korumasına sahip olmalı: KV geçici olarak başarısız
  // olursa (ör. ağ hatası) sessizce D1'den taze okumaya düşer. Önceden bu koruma YOKTU — bir KV
  // hatası src/index.js'teki genel try/catch'e kadar yükselip TÜM site genelinde her sayfayı
  // "Sunucu hatası oluştu" 500'üne düşürebilirdi (gerçek bulgu, denetim: bu fonksiyon site genelinde
  // tek noktadan çağrılan en sık D1/KV erişimlerinden biri).
  if (env.FACET_CACHE) {
    try {
      const cached = await env.FACET_CACHE.get(KV_KEY, 'json');
      if (cached) return { ...DEFAULT_SETTINGS, ...cached };
    } catch { /* KV kullanılamıyorsa aşağıdaki taze D1 okumasına düş */ }
  }
  const { results } = await env.DB.prepare(`SELECT key, value FROM site_settings`).all();
  const out = {};
  for (const row of results) out[row.key] = row.value;
  if (env.FACET_CACHE && await reserveKvWrite(env)) {
    try {
      await env.FACET_CACHE.put(KV_KEY, JSON.stringify(out), { expirationTtl: KV_TTL_SECONDS });
    } catch { /* yazma başarısız olursa bir sonraki istek yine D1'den taze okur */ }
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
