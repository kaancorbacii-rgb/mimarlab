// GET /api/geocode/search ve /api/geocode/reverse — proje-ekle.html'in "Haritada konum ara" ve
// ters-jeokodlama (bkz. reverseGeocodeAndFillLocation) çağrılarının sunucu tarafı proxy'si.
//
// Neden gerekli: nominatim.openstreetmap.org, bazı CDN önbellek düğümlerinde
// Access-Control-Allow-Origin başlığını TUTARSIZ biçimde dönüyor (gerçek bulgu: `curl` ile
// tekrarlanan testlerde "bostancı" gibi belirli sorgular için bu başlık hiç yoktu, başka
// sorgularda vardı — Nominatim'in paylaşılan Varnish katmanı yanıtı Origin'e göre değil yalnızca
// accept-language/Accept-Encoding'e göre önbelleğe alıyor). Tarayıcıdan doğrudan çağrıldığında bu,
// fetch()'in sessizce (TypeError, ayırt edilemeyen bir CORS hatası) reddedilmesine yol açıyor —
// kullanıcı arama kutusuna yazıp Ara'ya bassa/Enter'a bassa da SONUÇ HİÇ ÇIKMIYORDU, kod da bunu
// mevcut `catch{}` bloğunda sessizce yutuyordu. Sunucu-sunucu çağrısı CORS'a hiç tabi değildir,
// ayrıca Nominatim'in kullanım politikasının istediği tanımlayıcı User-Agent'ı da (tarayıcı bunu
// ASLA değiştiremez) burada doğru şekilde ayarlayabiliyoruz.
import { json, errorJson } from '../lib/http.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';

const NOMINATIM_USER_AGENT = 'MimarLab/1.0 (https://mimarlab.com)';
const GEOCODE_TIMEOUT_MS = 8000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('geocode_timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function handleGeocodeRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);

  let target;
  if (url.pathname === '/api/geocode/search') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
    if (!q) return errorJson('q parametresi gerekli.');
    target = `https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=tr&countrycodes=tr&q=${encodeURIComponent(q)}`;
  } else if (url.pathname === '/api/geocode/reverse') {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return errorJson('lat/lon parametresi geçersiz.');
    target = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=tr&zoom=14`;
  } else {
    return errorJson('Bulunamadı', 404);
  }

  // Maliyet/kötüye kullanım koruması + Nominatim'in kullanım politikasına (makul istek hacmi)
  // saygı: bu uç anahtarsız/ücretsiz üçüncü taraf servisi proxy'lediğinden mevcut hiçbir arama
  // ucunda olmayan bir rate limit burada gerekli — bkz. src/routes/ai.js'teki AYNI desen. D1'e
  // yazan bu kontrol ile Nominatim'e giden dış istek BİLEREK PARALEL başlatılır — art arda (önce
  // D1 sonra ağ) çalıştırılsaydı toplam gecikme ikisinin TOPLAMI olurdu; gerçek bulgu (kullanıcı
  // geri bildirimi): önceki sıralı sürüm "arama çok geç çalışıyor" hissi veriyordu. Limit
  // gerçekten aşılırsa zaten başlatılmış Nominatim isteğinin sonucu kullanılmadan atılır (nadir
  // bir durumda israf edilen tek bir dış istek, kabul edilebilir bir bedel) — asıl kazanç normal/
  // limit-içi isteklerde gecikmeyi ikisinin TOPLAMI değil MAKSİMUMU yapmak.
  const rateLimitPromise = checkRateLimit(env, 'geocode', clientIp(request), 30, 5 * 60 * 1000);
  const fetchPromise = withTimeout(fetch(target, { headers: { 'User-Agent': NOMINATIM_USER_AGENT } }), GEOCODE_TIMEOUT_MS);

  if (!(await rateLimitPromise)) {
    fetchPromise.catch(() => {}); // sonucu kullanılmayacak isteğin unhandled rejection üretmesini önle
    return errorJson('Çok fazla konum araması yapıldı. Lütfen birkaç dakika sonra tekrar dene.', 429, { 'Retry-After': '300' });
  }

  try {
    const res = await fetchPromise;
    if (!res.ok) return errorJson('Konum servisi şu anda yanıt vermiyor.', 502);
    const data = await res.json();
    // Aynı sorgu kısa süre içinde (farklı kullanıcılardan ya da aynı kullanıcının tekrar
    // aramasından) tekrar edilirse Nominatim'e tekrar gitmeyip Cloudflare edge'inden dönsün diye
    // kısa süreli genel önbellek — Nominatim'in kullanım politikası da zaten sonuçların makul
    // süre önbelleklenmesini teşvik ediyor.
    return json(data, 200, { 'Cache-Control': 'public, max-age=300' });
  } catch (err) {
    console.error('geocode.js proxy failed', err);
    return errorJson('Konum servisine ulaşılamadı.', 502);
  }
}
