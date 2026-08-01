// Kullanıcının verdiği rastgele bir URL'i (AI otomatik ekleme akışı, bkz. src/routes/ai.js) sunucu
// tarafında çekerken SSRF'e karşı savunma: sadece http(s), sadece genel (non-private/non-reserved)
// adresler, yönlendirmeler `redirect:"manual"` ile tek tek yakalanır ve HER hop aynı doğrulamadan
// geçer (bir yönlendirme zincirinin sonunda bir iç adrese düşülmesini engeller), azami 3 yönlendirme.
// Bilinen sınır: DNS rebinding (hostname çekim anında farklı bir IP'ye çözülürse) burada tespit
// edilemez — `fetch()` DNS çözümlemesini bizden gizler, Worker'ın kendisi ayrıca bir DNS API'si
// sunmuyor. Bu, kabul edilen bir kalıntı risktir.

import { AI_FETCH_TIMEOUT_MS, AI_MAX_REDIRECTS } from './aiConfig.js';

export class UnsafeUrlError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function parseIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some(p => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// IANA özel/ayrılmış IPv4 blokları — bulut metadata servisleri (169.254.169.254) dahil.
const IPV4_BLOCKED_RANGES = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32],
];

function isBlockedIPv4(host) {
  const target = parseIPv4(host);
  if (target === null) return false;
  return IPV4_BLOCKED_RANGES.some(([base, prefix]) => {
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (target & mask) === ((parseIPv4(base) ?? 0) & mask);
  });
}

function isBlockedIPv6(hostname) {
  let addr = hostname.toLowerCase();
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1);
  addr = addr.split('%')[0]; // zone id'yi at (ör. fe80::1%eth0)
  if (addr === '::1' || addr === '::') return true; // loopback / tanımsız adres
  const v4Match = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Match && (addr.startsWith('::ffff:') || addr.startsWith('::'))) {
    return isBlockedIPv4(v4Match[1]);
  }
  const firstGroup = addr.split(':')[0];
  if (/^[0-9a-f]{1,4}$/.test(firstGroup)) {
    const n = parseInt(firstGroup, 16);
    if ((n & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((n & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  }
  return false;
}

// URL'in http(s) olduğunu ve hostname'inin bilinen private/reserved/loopback aralıklarından biri
// OLMADIĞINI doğrular; aksi halde UnsafeUrlError fırlatır. Başarılıysa parse edilmiş URL'i döner.
export function assertSafeUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new UnsafeUrlError('invalid_url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeUrlError('invalid_protocol');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new UnsafeUrlError('blocked_host');
  }
  if (hostname.startsWith('[')) {
    if (isBlockedIPv6(hostname)) throw new UnsafeUrlError('blocked_host');
  } else if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    if (isBlockedIPv4(hostname)) throw new UnsafeUrlError('blocked_host');
  }
  return parsed;
}

// SSRF-güvenli fetch: her yönlendirme hop'unu assertSafeUrl'den geçirir (redirect:"manual" ile
// tarayıcının/Workers'ın kendiliğinden takip etmesini engelleyip Location header'ını elle okuruz),
// azami `maxRedirects` yönlendirmeye izin verir. Döndürdüğü `finalUrl`, gerçekte içeriğin geldiği
// (yönlendirme sonrası) adrestir — kaynak URL olarak bu saklanmalı.
export async function safeFetch(initialUrl, { maxRedirects = AI_MAX_REDIRECTS, timeoutMs = AI_FETCH_TIMEOUT_MS, headers } = {}) {
  let currentUrl = initialUrl;
  for (let hop = 0; ; hop++) {
    const parsed = assertSafeUrl(currentUrl);
    const response = await fetch(parsed.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MimarlabBot/1.0; +https://mimarlab.com)',
        ...headers,
      },
    });
    const isRedirect = response.status >= 300 && response.status < 400;
    const location = isRedirect ? response.headers.get('Location') : null;
    if (isRedirect && location) {
      if (hop >= maxRedirects) throw new UnsafeUrlError('too_many_redirects');
      currentUrl = new URL(location, parsed).href;
      continue;
    }
    return { response, finalUrl: parsed.href };
  }
}

// `Content-Length` header'ı yokluğunda ya da yalan söylediğinde bile gerçek akan veriyi
// `maxBytes`'ta keser — HTMLRewriter'a ya da `.arrayBuffer()`'a vermeden önce bu sarmalayıcıdan
// geçirmek, saldırganın kontrolündeki bir sayfanın/görselin Worker belleğini/CPU süresini tüketmesini
// engeller. Sınır aşılırsa akış hata verir (tüketen taraf try/catch ile yakalamalı).
export function limitResponseSize(response, maxBytes) {
  let total = 0;
  const limited = new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        controller.error(new Error('response_too_large'));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return new Response(response.body.pipeThrough(limited), response);
}
