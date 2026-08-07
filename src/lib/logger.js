// Faz 4D — yapılandırılmış (JSON) istek logu. `observability.enabled: true` (bkz. wrangler.jsonc)
// sayesinde console.log çıktısı Cloudflare Dashboard'daki Workers Logs'ta ve `wrangler tail`de
// filtrelenebilir/sorgulanabilir hale gelir. Her istek için TEK satır basılır (başarı da, hata da) —
// ayrı bir log satırı yerine error_message alanı doldurulur, böylece bir isteğin tüm yaşam döngüsü
// tek bir JSON objesinde kalır.

export function logRequest({ request, url, env, requestId, startedAt, status, errorMessage }) {
  const entry = {
    timestamp: new Date().toISOString(),
    request_id: requestId,
    method: request.method,
    endpoint: url.pathname,
    status,
    duration_ms: Math.round(performance.now() - startedAt),
    worker_version: env.CF_VERSION_METADATA?.id ?? null,
    environment: env.ENVIRONMENT ?? null,
    user_agent: request.headers.get('User-Agent') || null,
    cf_ray_id: request.headers.get('cf-ray') || null,
    error_message: errorMessage ?? null,
  };
  if (errorMessage) console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}
