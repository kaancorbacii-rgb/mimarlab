import { errorJson } from '../lib/http.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';

// POST /api/csp-report — src/index.js'teki Reporting-Endpoints header'ının hedefi (bkz. o
// dosyadaki "report-to csp-endpoint" yorumu). Tarayıcı, CSP Report-Only ihlali algıladığında
// buraya bir Reporting API payload'ı (application/reports+json, Report nesnelerinin JSON dizisi)
// POST eder. Hiçbir veritabanına/KV'ye YAZMAZ — yalnızca console.log'a basar (wrangler tail veya
// Cloudflare dashboard'daki canlı loglardan izlenebilir, bkz. kullanıcı isteği: "hiçbir hassas
// veri veya kişisel bilgi depolamasın"). Bu yüzden IP/User-Agent/cookie/referrer gibi alanlar
// BİLEREK okunmuyor bile — yalnızca ihlalin NEREDE (sayfa/kaynak) ve HANGİ direktifte olduğunu
// gösteren, sorgu dizesi/parça (fragment) temizlenmiş URL'ler loglanıyor (token/oturum sızıntısı
// riskini engellemek için, bkz. XSS escaping convention'daki AYNI "savunmacı ol" ilkesi).

// URL'nin yalnızca origin+path'ini bırakır — sorgu dizesi/fragment (token/session id taşıyabilir)
// hiçbir zaman loglanmaz. Geçersiz/eksik URL'lerde sessizce null döner.
function sanitizeUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}

// Hem yeni Reporting API şeklini ({type, body:{...}}) hem CSP3'ün eski report-uri şeklini
// ({"csp-report": {...}}) kabul eder — report-to kullansak da bazı eski tarayıcı sürümleri ikinci
// şekli gönderebilir; ikisi de aynı minimal, PII'siz alan setine indirgenir.
function extractViolation(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const body = entry.body || entry['csp-report'] || entry;
  if (!body || typeof body !== 'object') return null;
  return {
    type: entry.type || 'csp-violation',
    disposition: body.disposition || null,
    violatedDirective: body.effectiveDirective || body.violatedDirective || body['effective-directive'] || body['violated-directive'] || null,
    documentUrl: sanitizeUrl(body.documentURL || body['document-uri']),
    blockedUrl: sanitizeUrl(body.blockedURL || body['blocked-uri']),
    sourceFile: sanitizeUrl(body.sourceFile || body['source-file']),
    lineNumber: Number.isFinite(body.lineNumber) ? body.lineNumber : (Number.isFinite(body['line-number']) ? body['line-number'] : null),
  };
}

// denetim bulgusu (2026-08-14): tek public/yazma ucu bu — diğer HEPSİ (contact/comment/login/
// signup/upload/badge-request/saved-item/claim/correction/submission) checkRateLimit ile korunurken
// bu route'un HİÇ rate limiti yoktu; kimliksiz, "fire and forget" bir uç olduğundan sınırsız
// boyutlu bir dizi + tekrarlanan istekle Workers Logs hacmi/maliyeti şişirilebilir, ayrıca gerçek
// CSP ihlal sinyali spam'e boğulabilir. Diğer public formlarla AYNI IP bazlı sabit pencere.
const MAX_ENTRIES_PER_REQUEST = 50;

export async function handleCspReportRoute(request, env) {
  if (request.method !== 'POST') return errorJson('Bulunamadı', 404);

  if (!(await checkRateLimit(env, 'csp-report', clientIp(request), 30, 5 * 60 * 1000))) {
    return new Response(null, { status: 429, headers: { 'Retry-After': '300' } });
  }

  try {
    const payload = await request.json();
    const entries = (Array.isArray(payload) ? payload : [payload]).slice(0, MAX_ENTRIES_PER_REQUEST);
    for (const entry of entries) {
      const violation = extractViolation(entry);
      if (violation) console.log('[csp-report]', JSON.stringify(violation));
    }
  } catch {
    // Bozuk/boş payload — Reporting API "fire and forget"tir, sessizce yut ve yine de 204 dön.
  }

  return new Response(null, { status: 204 });
}
