// Basit sabit pencereli hız sınırlama: brute-force (login), hesap/e-posta numaralandırma
// (forgot-password) ve spam (signup/contact) saldırılarına karşı D1 üzerinde uygulama seviyesi
// bir güvenlik ağı. Cloudflare'in kendi WAF/Rate Limiting kurallarının yerini tutmaz, onunla
// birlikte ikinci bir savunma katmanı olarak çalışır.

function windowKey(scope, identifier, windowMs) {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  return `${scope}:${identifier}:${windowStart}`;
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

// true dönerse istek kabul edilir, false dönerse limit aşılmıştır (429 döndürülmeli).
export async function checkRateLimit(env, scope, identifier, limit, windowMs) {
  const key = windowKey(scope, identifier, windowMs);
  const now = Date.now();
  // gerçek bulgu: burada eskiden ayrı bir INSERT + SELECT (2 D1 round-trip) yapılıyordu — login/
  // signup/forgot-password/contact/upload/comment/badge-request/saved-item/claim/correction/
  // submission gibi rate-limitli her yazma ucunun HER isteğinde 2 D1 çağrısı anlamına geliyordu.
  // SQLite'ın (D1'in temeli) desteklediği RETURNING ifadesiyle tek sorguya indirilir.
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET count = count + 1
     RETURNING count`
  ).bind(key, now + windowMs).first();
  // Fırsatçı temizlik: her ~100 istekte bir, süresi dolmuş eski satırları sil (ayrı bir cron
  // gerektirmemesi için burada, ağırlığa yaymak amacıyla yalnızca olasılıksal olarak çalışır).
  if (Math.random() < 0.01) {
    env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now).run().catch(() => {});
  }
  return !row || row.count <= limit;
}
