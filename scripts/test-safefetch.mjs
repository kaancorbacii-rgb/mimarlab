#!/usr/bin/env node
// SSRF KORUMASI BİRİM TESTLERİ (hardening denetimi, 2026-09-07).
//
// scripts/test-gundem.mjs ile AYNI desen: test koşucusu/npm bağımlılığı yok, Node'un kendi
// `node:assert`'ü ve tek çalıştırılabilir ESM dosyası. preflight-check.sh buradan çağırır, yani
// bu testlerden biri düşerse deploy HİÇ BAŞLAMAZ.
//
// =================================================================================================
// BU DOSYA NEDEN VAR — KAPATILAN İKİ GERÇEK BYPASS
// =================================================================================================
// 1) IPv4-EŞLEMELİ IPv6 (asıl bulgu, canlı kodda açıktı):
//        http://[::ffff:a9fe:a9fe]/  -> 169.254.169.254 (bulut metadata uç noktası)
//        http://[::ffff:127.0.0.1]/  -> loopback
//    Sebep: assertSafeUrl'e gelen hostname `new URL()`'in SERİLEŞTİRDİĞİ biçimdir. WHATWG host
//    ayrıştırıcısı IPv6'yı her zaman en kısa onaltılığa yeniden yazar, bu yüzden eski koddaki
//    "sondaki noktalı-dörtlüyü regex'le yakala" dalı ÖLÜ KODDU; "::" ile başlayan adreslerde
//    `split(':')[0]` boş dize döndüğü için onaltılık dal da hiç ateşlenmiyordu.
// 2) SONDAKİ NOKTA: "http://LOCALHOST./" -> hostname "localhost." — ne eşitlik ne son-ek
//    kontrolüne takılıyordu, oysa DNS'te aynı isimdir.
//
// =================================================================================================
// ALTERNATİF IPv4 YAZIMLARI NEDEN AYRICA ELE ALINMIYOR
// =================================================================================================
// 2130706433 / 0x7f000001 / 0177.0.0.1 / 127.1 gibi biçimlerin hepsini `new URL()` daha
// assertSafeUrl'e girmeden noktalı-dörtlüye NORMALIZE eder. Bu, workerd üzerinde `wrangler dev` ile
// GERÇEK runtime'da doğrulandı (Node ile birebir aynı çıktı). Yine de aşağıda test ediliyorlar:
// koruma runtime'ın bu davranışına bağlı olduğu için, davranış bir gün değişirse test bunu yakalar.
//
// KALAN BİLİNEN RİSK — DNS REBINDING: hostname çekim anında farklı bir IP'ye çözülürse burada
// tespit edilemez; `fetch()` DNS çözümlemesini gizler ve Workers ayrı bir DNS API'si sunmaz.
// Bu, src/lib/safeFetch.js dosya başında da yazan, KABUL EDİLMİŞ bir kalıntı risktir.

import assert from 'node:assert/strict';
import { assertSafeUrl, UnsafeUrlError } from '../src/lib/safeFetch.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, message: err.message });
    console.error(`  FAIL ${name}`);
  }
}

function isBlocked(url) {
  try { assertSafeUrl(url); return false; }
  catch (err) { return err instanceof UnsafeUrlError; }
}

// =================================================================================================
// ENGELLENMESİ ŞART OLANLAR
// =================================================================================================
const MUST_BLOCK = {
  'loopback (noktalı-dörtlü)': ['http://127.0.0.1/', 'http://127.255.255.254/', 'http://127.0.0.1./'],
  // Hepsi `new URL()` tarafından 127.0.0.1'e normalize edilir — bkz. dosya başı notu.
  'loopback (alternatif IPv4 yazımları)': [
    'http://2130706433/', 'http://127.1/', 'http://0177.0.0.1/', 'http://0x7f000001/',
    'http://017700000001/', 'http://0x7f.0x0.0x0.0x1/',
  ],
  'RFC1918 özel ağlar': [
    'http://10.0.0.1/', 'http://10.255.255.255/', 'http://172.16.0.1/', 'http://172.31.255.255/',
    'http://192.168.0.1/', 'http://192.168.1.1/', 'http://3232235777/',
  ],
  'link-local + bulut metadata': ['http://169.254.169.254/', 'http://169.254.0.1/'],
  'diğer ayrılmış IPv4 blokları': [
    'http://0.0.0.0/', 'http://0/', 'http://100.64.0.1/', 'http://192.0.0.1/',
    'http://198.18.0.1/', 'http://224.0.0.1/', 'http://240.0.0.1/', 'http://255.255.255.255/',
  ],
  'localhost isimleri': [
    'http://localhost/', 'http://LOCALHOST/', 'http://a.localhost/', 'http://printer.local/',
  ],
  // BULGU 2 — sondaki nokta DNS'te aynı ismi gösterir.
  'localhost isimleri (sondaki nokta)': [
    'http://localhost./', 'http://LOCALHOST./', 'http://a.localhost./', 'http://printer.local./',
    'http://localhost../',
  ],
  'IPv6 loopback / özel / link-local': [
    'http://[::1]/', 'http://[::]/', 'http://[0:0:0:0:0:0:0:1]/', 'http://[fd00::1]/',
    'http://[fc00::1]/', 'http://[fe80::1]/', 'http://[fe80::1%25eth0]/', 'http://[ff02::1]/',
    'http://[2001:db8::1]/',
  ],
  // BULGU 1 — asıl açık. Üç yazım da AYNI adresi gösterir ve üçü de engellenmelidir.
  'IPv6 IPv4-eşlemeli (::ffff:0:0/96)': [
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[0:0:0:0:0:ffff:127.0.0.1]/',
    'http://[::ffff:a9fe:a9fe]/', 'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:10.0.0.1]/', 'http://[::ffff:c0a8:101]/', 'http://[::ffff:192.168.1.1]/',
  ],
  'IPv6 IPv4-uyumlu (::/96)': ['http://[::127.0.0.1]/', 'http://[::a9fe:a9fe]/'],
  // NAT64: bir NAT64 çözümleyicisi bunu gerçek IPv4'e çevirir.
  'IPv6 NAT64 (64:ff9b::/96)': ['http://[64:ff9b::7f00:1]/', 'http://[64:ff9b::169.254.169.254]/'],
  'http(s) olmayan şemalar': [
    'ftp://example.com/', 'file:///etc/passwd', 'gopher://example.com/', 'data:text/html,x',
  ],
  'geçersiz URL': ['not-a-url', '', '///', 'http://'],
};

for (const [group, urls] of Object.entries(MUST_BLOCK)) {
  for (const url of urls) {
    test(`ENGELLE [${group}] ${url}`, () => {
      assert.equal(isBlocked(url), true, `${url} engellenmedi — SSRF açığı`);
    });
  }
}

// =================================================================================================
// İZİN VERİLMESİ ŞART OLANLAR — aşırı engelleme (false positive) regresyonu
// =================================================================================================
// Bu liste olmasaydı "her şeyi engelle" de testleri geçerdi ve Gündem/AI hattı sessizce ölürdü.
// Gerçek kaynak host'ları ve gerçek public IP'ler seçildi; 172.32/11.0/100.128 ise engellenen
// blokların HEMEN DIŞINDAKİ sınır komşularıdır (maske hatalarını yakalar).
const MUST_ALLOW = [
  'https://mimarlab.com/',
  'https://static.dezeen.com/uploads/2026/09/x.jpg',
  'https://images.adsttc.com/a.jpg',
  'https://www.arkitera.com/haber/x/',
  'https://8.8.8.8/', 'https://1.1.1.1/',
  'https://[2606:4700::1111]/', 'https://[2001:4860:4860::8888]/',
  'http://172.32.0.1/',   // 172.16.0.0/12'nin hemen dışı
  'http://11.0.0.1/',     // 10.0.0.0/8'in hemen dışı
  'http://100.128.0.1/',  // 100.64.0.0/10'un hemen dışı
  'http://126.255.255.255/', // 127.0.0.0/8'in hemen dışı
  'http://223.255.255.255/', // 224.0.0.0/4'ün hemen dışı
];

for (const url of MUST_ALLOW) {
  test(`İZİN VER ${url}`, () => {
    assert.equal(isBlocked(url), false, `${url} yanlışlıkla engellendi — aşırı engelleme regresyonu`);
  });
}

// =================================================================================================
// YÖNLENDİRME ZİNCİRİ — her hop yeniden doğrulanmalı
// =================================================================================================
// safeFetch redirect:"manual" ile her hop'u assertSafeUrl'den geçirir. Burada ağ olmadan, hop
// URL'sinin nasıl kurulduğunu (new URL(location, base)) ve sonucun engellendiğini doğruluyoruz —
// yani "public bir host, Location ile iç adrese yönlendirirse" senaryosu.
test('YÖNLENDİRME public -> loopback engellenir', () => {
  const hop = new URL('http://127.0.0.1/admin', new URL('https://evil.example.com/start')).href;
  assert.equal(isBlocked(hop), true, 'yönlendirme sonrası loopback engellenmedi');
});
test('YÖNLENDİRME public -> metadata (IPv4-eşlemeli IPv6) engellenir', () => {
  const hop = new URL('http://[::ffff:a9fe:a9fe]/latest/meta-data/', new URL('https://evil.example.com/start')).href;
  assert.equal(isBlocked(hop), true, 'yönlendirme sonrası metadata engellenmedi');
});
test('YÖNLENDİRME göreli Location public kalırsa izin verilir', () => {
  const hop = new URL('/gercek-makale', new URL('https://static.dezeen.com/start')).href;
  assert.equal(isBlocked(hop), false, 'meşru göreli yönlendirme engellendi');
});

// =================================================================================================
// RUNTIME SÖZLEŞMESİ — koruma `new URL()`'in normalizasyonuna GÜVENİYOR
// =================================================================================================
// Alternatif IPv4 yazımlarının engellenmesi, tamamen host ayrıştırıcısının onları noktalı-dörtlüye
// çevirmesine dayanıyor. Bu davranış bir gün değişirse yukarıdaki "alternatif IPv4 yazımları"
// testleri de düşer, ama sebebi belirsiz kalır — bu test sebebi DOĞRUDAN gösterir.
test('SÖZLEŞME new URL() alternatif IPv4 yazımlarını noktalı-dörtlüye normalize eder', () => {
  assert.equal(new URL('http://2130706433/').hostname, '127.0.0.1');
  assert.equal(new URL('http://0x7f000001/').hostname, '127.0.0.1');
  assert.equal(new URL('http://127.1/').hostname, '127.0.0.1');
  assert.equal(new URL('http://3232235777/').hostname, '192.168.1.1');
});
test('SÖZLEŞME new URL() IPv6 IPv4-eşlemeli biçimi onaltılığa yeniden yazar', () => {
  // Eski koddaki noktalı-dörtlü dalının neden ölü olduğunun kanıtı.
  assert.equal(new URL('http://[::ffff:127.0.0.1]/').hostname, '[::ffff:7f00:1]');
});
test('SÖZLEŞME new URL() sondaki noktayı korur', () => {
  assert.equal(new URL('http://LOCALHOST./').hostname, 'localhost.');
});

// =================================================================================================
console.log('');
if (failed) {
  console.error(`SSRF TESTLERİ BAŞARISIZ — ${passed} geçti, ${failed} başarısız.`);
  failures.forEach(f => console.error(`  - ${f.name}: ${f.message.split('\n')[0]}`));
  process.exit(1);
}
console.log(`SSRF testleri geçti — ${passed} test.`);
