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

function isBlockedIPv4Int(target) {
  if (target === null) return false;
  return IPV4_BLOCKED_RANGES.some(([base, prefix]) => {
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (target & mask) === ((parseIPv4(base) ?? 0) & mask);
  });
}

function isBlockedIPv4(host) {
  return isBlockedIPv4Int(parseIPv4(host));
}

// =============================================================================================
// IPv6 — NEDEN GERÇEK BİR AYRIŞTIRICI, NEDEN METİN DESENİ DEĞİL (hardening denetimi, 2026-09-07)
// =============================================================================================
// Buradaki eski sürüm adresin METNİNE bakıyordu: sondaki noktalı-dörtlüyü regex'le arıyor,
// aralık kontrolü için de yalnızca İLK gruba bakıyordu. İkisi de canlıda BYPASS edilebiliyordu ve
// sebebi ortak: bu fonksiyona gelen hostname, `new URL()`'in SERİLEŞTİRDİĞİ biçimdir — yazdığımız
// biçim değil. WHATWG URL host ayrıştırıcısı IPv6'yı her zaman en kısa onaltılık gösterime yeniden
// yazar (workerd üzerinde `wrangler dev` ile GERÇEK runtime'da doğrulandı, Node ile birebir aynı):
//     [::ffff:127.0.0.1]           -> [::ffff:7f00:1]
//     [0:0:0:0:0:ffff:127.0.0.1]   -> [::ffff:7f00:1]
//     [::ffff:a9fe:a9fe]           -> [::ffff:a9fe:a9fe]   (= 169.254.169.254, bulut metadata!)
// Yani noktalı-dörtlü ASLA fonksiyona ulaşmıyordu — o dal ÖLÜ KODDU. Kalan onaltılık dal da
// çalışmıyordu: "::" ile başlayan bir adreste `addr.split(':')[0]` BOŞ dizedir, dolayısıyla
// fc00::/7 ve fe80::/10 kontrolleri de hiç ateşlenmiyordu. Sonuç: IPv4-eşlemeli IPv6 ile hem
// loopback'e hem de metadata uç noktasına erişim SSRF korumasından geçiyordu.
//
// Bu yüzden düzeltme deseni genişletmek DEĞİL: adres artık 8 adet 16-bitlik gruba AYRIŞTIRILIYOR
// (sayısal gösterim), aralık kontrolü bu sayılar üzerinde yapılıyor ve IPv4 gömen aralıklarda
// gömülü adres ÇIKARILIP zaten var olan IPv4 tablosuna devrediliyor. Böylece IPv4 tarafına
// eklenen her yeni blok IPv6 tarafında da kendiliğinden geçerli olur; iki liste ayrışamaz.

// Bir IPv6 literal'ini 8 x 16-bit gruba ayrıştırır ("::" sıkıştırması ve sondaki noktalı-dörtlü
// biçimi dahil). Geçerli bir IPv6 değilse null döner.
function parseIPv6(input) {
  let addr = String(input || '').toLowerCase();
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1);
  addr = addr.split('%')[0]; // zone id'yi at (ör. fe80::1%eth0)
  if (!addr) return null;

  // Sondaki noktalı-dörtlü ("::ffff:127.0.0.1") iki 16-bit gruba çevrilir. `new URL()` bu biçimi
  // zaten onaltılığa yeniden yazıyor, ama bu ayrıştırıcı URL'den GEÇMEMİŞ bir girdiyle de
  // (ör. doğrudan birim testi) doğru çalışmalı.
  const v4Tail = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  let tailGroups = [];
  if (v4Tail) {
    const v4 = parseIPv4(v4Tail[1]);
    if (v4 === null) return null;
    tailGroups = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    addr = addr.slice(0, addr.length - v4Tail[1].length - 1) + ':';
    if (addr.endsWith('::')) addr = addr.slice(0, -1); // "::" sıkıştırmasını bozma
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null; // "::" en fazla bir kez geçebilir
  const toGroups = (s) => {
    if (!s) return [];
    const parts = s.split(':');
    const out = [];
    for (const p of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
      out.push(parseInt(p, 16));
    }
    return out;
  };
  const head = toGroups(halves[0].replace(/:$/, ''));
  if (head === null) return null;
  if (halves.length === 1) {
    const all = [...head, ...tailGroups];
    return all.length === 8 ? all : null;
  }
  const tail = toGroups(halves[1].replace(/^:/, '').replace(/:$/, ''));
  if (tail === null) return null;
  const explicit = [...head, ...tail, ...tailGroups];
  if (explicit.length > 8) return null;
  const zeros = new Array(8 - explicit.length).fill(0);
  return [...head, ...zeros, ...tail, ...tailGroups];
}

// IANA özel/ayrılmış IPv6 blokları. IPv4 gömen aralıklar burada DEĞİL — onlar aşağıda gömülü
// adres çıkarılıp IPv4 tablosuna devredilir (tek liste, tek doğruluk kaynağı).
const IPV6_BLOCKED_RANGES = [
  ['::', 128],        // tanımsız adres
  ['::1', 128],       // loopback
  ['fc00::', 7],      // unique local
  ['fe80::', 10],     // link-local
  ['ff00::', 8],      // multicast
  ['2001:db8::', 32], // dokümantasyon
];

// IPv4 GÖMEN aralıklar: ::ffff:0:0/96 (IPv4-eşlemeli), ::/96 (IPv4-uyumlu, kullanımdan kalkmış ama
// hâlâ yönlendirilebilir) ve 64:ff9b::/96 (NAT64 — bir NAT64 çözümleyicisi bunu gerçek IPv4'e
// çevirir, yani [64:ff9b::7f00:1] gerçekten 127.0.0.1'e gider).
function embeddedIPv4(g) {
  const isZero = (from, to) => g.slice(from, to).every(x => x === 0);
  const v4 = (((g[6] << 16) >>> 0) | g[7]) >>> 0;
  if (isZero(0, 5) && g[5] === 0xffff) return v4;                    // ::ffff:0:0/96
  if (isZero(0, 6) && !(g[6] === 0 && g[7] <= 1)) return v4;         // ::/96 ("::" ve "::1" hariç
                                                                     // — onları tablo zaten yakalar)
  if (g[0] === 0x0064 && g[1] === 0xff9b && isZero(2, 6)) return v4; // 64:ff9b::/96
  return null;
}

function isBlockedIPv6(hostname) {
  const groups = parseIPv6(hostname);
  if (!groups) return false;
  const v4 = embeddedIPv4(groups);
  if (v4 !== null && isBlockedIPv4Int(v4)) return true;
  return IPV6_BLOCKED_RANGES.some(([base, prefix]) => {
    const baseGroups = parseIPv6(base);
    if (!baseGroups) return false;
    for (let i = 0; i < 8; i++) {
      const bits = Math.min(16, Math.max(0, prefix - i * 16));
      if (bits === 0) return true; // önek bitti, kalan gruplar serbest
      const mask = bits === 16 ? 0xffff : ((0xffff << (16 - bits)) & 0xffff);
      if ((groups[i] & mask) !== (baseGroups[i] & mask)) return false;
    }
    return true;
  });
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
  // SONDAKİ NOKTA (hardening denetimi, 2026-09-07). DNS'te "localhost." ile "localhost" AYNI
  // isimdir — nokta yalnızca adın tam nitelikli (FQDN) yazımıdır ve çözümleyici ikisini de aynı
  // adrese götürür. `new URL()` bu noktayı KORUR (workerd'de doğrulandı: "http://LOCALHOST./" ->
  // hostname "localhost."), dolayısıyla aşağıdaki eşitlik/son-ek kontrolleri eskiden ıskalıyordu:
  // "localhost." ne 'localhost'a eşitti ne de '.localhost'/'.local' ile bitiyordu. Aynı boşluk
  // "foo.local." için de geçerliydi. Karşılaştırmadan ÖNCE tek bir normalizasyon bunu kapatır.
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new UnsafeUrlError('blocked_host');
  }
  // IPv6 literal'i köşeli parantezle gelir; parseIPv6 parantezi kendisi soyar. Noktalı-dörtlü
  // kontrolü ise IPv4 tarafı için: `new URL()` 2130706433 / 0x7f000001 / 127.1 / 0177.0.0.1 gibi
  // TÜM alternatif IPv4 yazımlarını bu noktaya gelmeden noktalı-dörtlüye normalize eder (workerd'de
  // doğrulandı), bu yüzden burada ayrıca alternatif biçim denemeye GEREK YOKTUR.
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
