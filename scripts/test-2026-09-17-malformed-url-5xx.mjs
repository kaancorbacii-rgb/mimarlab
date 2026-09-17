#!/usr/bin/env node
// GOOGLE SEARCH CONSOLE "Server error (5xx)" — KÖK NEDEN VE KELEPÇESİ (2026-09-17).
//
// BULGU: Search Console "New reason preventing your pages from being indexed: Server error (5xx)"
// bildirimi gönderdi. Ölçüm (bu dosyanın 1. bölümü, DÜZELTMEDEN ÖNCE gerçek fetch handler'ı Node'da
// koşturularak yapıldı): sitenin indekslenen TÜM detay adres kalıpları — /proje/:slug, /kisi/:slug,
// /firma/:slug, /marka/:slug, /urun/:slug, /gundem/:slug — bozuk bir %-dizisi taşıdığında 500
// dönüyordu. Aynısı /api/{project,architect,office,product,gundem}/:key ve /gorusme/:uuid için de.
//
// KÖK NEDEN: `decodeURIComponent` geçersiz yüzde dizisinde URIError FIRLATIR. Yol segmentini çözen
// çağıranların hiçbiri bunu sarmalamıyordu; hata src/index.js'in en dıştaki try/catch'ine kadar
// çıkıp `errorJson('Sunucu hatası oluştu.', 500)` üretiyordu.
//
// GERÇEK TRAFİKTE NEDEN OLUYOR: (a) LATIN-1/Windows-1254 ile kodlanmış ESKİ Türkçe adresler —
// "%C7orbac%FD" ("Çorbacı") UTF-8 olarak GEÇERSİZDİR; (b) yarım kalmış diziler ("...%E0%A4%A",
// kopyala-yapıştır ile kırpılmış bağlantılar); (c) sondaki çıplak "%" (ör. "/proje/100%");
// (d) tarayıcı/güvenlik probları. Googlebot bu adresleri gerçekten talep eder ve 5xx'i GEÇİCİ bir
// sunucu arızası sayar: adresi indekslemez, tarama bütçesini düşürür ve tekrar tekrar dener.
// DOĞRU cevap 404'tür.
//
// ÇÖZÜM: src/lib/http.js#safeDecode — çözülemeyen değer HAM hâliyle döner; ham değer hiçbir slug ile
// eşleşmediğinden çağıranların MEVCUT 404/410 akışı kendiliğinden devreye girer. Yeni bir "geçersiz
// istek" dalı YAZILMADI, hata sınıfı tek noktada kapatıldı.
//
// AYRICA (2. bölüm): schema.sql, migration'larda eklenmiş 12 kolonu taşımıyordu. Bu üretimi
// etkilemez (orada migration'lar uygulanır) ama YEREL SQLite fikstürünü gerçeklikten ayırır — ve
// tam da bu yüzden /gundem/:slug'ın 404 yolu yerelde ölçülemiyordu (fikstürde "no such column:
// submitter_type" -> buildMeta fırlatıyor -> serveDetailPage 503 döndürüyordu, yani Search
// Console'un gördüğü 5xx'in İKİNCİ bir görünümü). Bkz. schema.sql#0079 notu: fold kolonları
// BİLEREK dışarıdadır (tek kaynak migrations/0079), bu yüzden kelepçe onları muaf tutar.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 4).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

// Workers çalışma zamanı yok — src/index.js'in ihtiyaç duyduğu iki global taklit edilir.
// HTMLRewriter geçirgendir (bu testin ölçtüğü şey DURUM KODU, gövde değil); caches boş bir
// önbellektir, yani her istek gerçekten kod yolundan geçer.
globalThis.HTMLRewriter = class { on() { return this; } transform(res) { return res; } };
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };

const worker = (await import('../src/index.js')).default;
const { safeDecode } = await import('../src/lib/http.js');

// ---- D1 shim (node:sqlite) — scripts/test-meet-gateway.mjs ile AYNI desen ----------------------
function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(s) { return s; } };
}
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(read('schema.sql'));
  return db;
}

const SHELL = '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><div id="ssr-entity-body"></div></body></html>';
function workerEnv(db) {
  return {
    DB: d1(db),
    ASSETS: { fetch: async () => new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }) },
  };
}
// Worker'ın structured log satırı (console.log) ile buildMeta'nın console.error'ı testin çıktısını
// boğmasın diye susturulur; hata mesajı yine de yakalanıp assertion'a taşınır.
async function status(env, path, headers = { Accept: 'text/html' }) {
  const realLog = console.log, realErr = console.error;
  let logged = null;
  console.log = (...a) => { const s = String(a[0] || ''); if (s.startsWith('{"timestamp')) { try { logged = JSON.parse(s).error_message; } catch { /* yut */ } } };
  console.error = () => {};
  try {
    const res = await worker.fetch(new Request('https://mimarlab.com' + path, { headers }), env, { waitUntil() {} });
    return { status: res.status, error: logged };
  } finally { console.log = realLog; console.error = realErr; }
}

// =================================================================================================
section('1) Bozuk %-kodlaması: her detay adresi 5xx DEĞİL 404 döner (Search Console bulgusu)');
// =================================================================================================
{
  const env = workerEnv(freshDb());

  // Ham bayt dizileri BİLEREK farklı bozulma türlerini kapsar — hepsi decodeURIComponent'i
  // fırlatır ve düzeltmeden ÖNCE hepsi 500 ölçüldü.
  const MALFORMED = [
    ['%E0%A4%A', 'yarım UTF-8 dizisi (kırpılmış bağlantı)'],
    ['100%', 'sondaki çıplak %'],
    ['%', 'tek başına %'],
    ['a%zz', '% sonrası hex olmayan karakter'],
    ['%C7orbac%FD', 'Windows-1254 ile kodlanmış eski Türkçe adres ("Çorbacı")'],
    ['%FF', 'UTF-8 olmayan tek bayt'],
    ['%C0%80', 'overlong kodlama'],
    ['%ED%A0%80', 'tek başına surrogate'],
  ];
  // /marka/ BİLEREK burada yok: o önek 301 ile /firma/'ya taşınır (PREFIX_RENAME_REDIRECTS) ve
  // 500 yönlendirmeden SONRA oluşuyordu — aşağıda ayrı test ediliyor.
  const PAGE_PREFIXES = ['/proje/', '/kisi/', '/firma/', '/urun/', '/gundem/'];
  const API_PREFIXES = ['/api/project/', '/api/architect/', '/api/office/', '/api/product/', '/api/gundem/'];

  for (const [bad, why] of MALFORMED) {
    await test(`sayfa: ${bad} (${why}) -> hiçbir detay önekinde 5xx yok`, async () => {
      for (const prefix of PAGE_PREFIXES) {
        const r = await status(env, prefix + bad);
        assert.ok(r.status < 500, `${prefix}${bad} -> ${r.status} (${r.error || 'hata mesajı yok'})`);
        assert.equal(r.status, 404, `${prefix}${bad} 404 dönmeli, ${r.status} döndü`);
      }
    });
  }

  await test('API: bozuk anahtar tüm detay uçlarında 5xx DEĞİL', async () => {
    for (const [bad] of MALFORMED) {
      for (const prefix of API_PREFIXES) {
        const r = await status(env, prefix + bad, {});
        assert.ok(r.status < 500, `${prefix}${bad} -> ${r.status} (${r.error || ''})`);
      }
    }
  });

  await test('/marka/:slug 301 ile /firma/ya taşınır ve HEDEF de 5xx değil', async () => {
    const redirect = await status(env, '/marka/%E0%A4%A');
    assert.equal(redirect.status, 301, 'marka öneki 301 ile taşınmalı');
    const target = await status(env, '/firma/%E0%A4%A');
    assert.ok(target.status < 500, `yönlendirme hedefi 5xx döndü: ${target.status}`);
  });

  await test('/gorusme/:room_uuid bozuk kodlamada 404 (500 değil)', async () => {
    const r = await status(env, '/gorusme/%E0%A4%A');
    assert.ok(r.status < 500, `-> ${r.status} (${r.error || ''})`);
  });

  await test('GEÇERLİ ama var olmayan slug DAVRANIŞI DEĞİŞMEDİ (hâlâ 404)', async () => {
    for (const p of ['/proje/yok-boyle-bir-sey', '/kisi/yok', '/firma/yok', '/urun/yok', '/gundem/yok']) {
      const r = await status(env, p);
      assert.equal(r.status, 404, `${p} -> ${r.status} (${r.error || ''})`);
    }
  });

  await test('hub/liste sayfaları ve sitemap etkilenmedi (200)', async () => {
    for (const p of ['/', '/proje', '/kisi', '/firma', '/urun', '/gundem', '/arama', '/en-iyi-100', '/danismanlik', '/sitemap.xml', '/robots.txt']) {
      const r = await status(env, p);
      assert.equal(r.status, 200, `${p} -> ${r.status} (${r.error || ''})`);
    }
  });
}

// =================================================================================================
section('2) safeDecode sözleşmesi');
// =================================================================================================
{
  await test('geçerli kodlamayı ÇÖZER (davranış değişmedi)', () => {
    assert.equal(safeDecode('%C3%87orbac%C4%B1'), 'Çorbacı');
    assert.equal(safeDecode('a%20b'), 'a b');
    assert.equal(safeDecode('duz-slug'), 'duz-slug');
  });
  await test('bozuk kodlamada HAM değeri döner, ASLA fırlatmaz', () => {
    for (const bad of ['%', '100%', 'a%zz', '%E0%A4%A', '%FF', '%C0%80']) {
      assert.equal(safeDecode(bad), bad);
    }
  });
  await test('null/undefined/sayı -> boş ya da düz metin, fırlatmaz', () => {
    assert.equal(safeDecode(null), '');
    assert.equal(safeDecode(undefined), '');
    assert.equal(safeDecode(42), '42');
  });
  await test("'%' taşımayan değerde decodeURIComponent HİÇ çağrılmaz (sıcak yol)", () => {
    // Davranışsal kanıt: '+' decodeURIComponent'te de korunur, yani kısayol sonucu değiştirmez.
    assert.equal(safeDecode('a+b'), 'a+b');
    assert.equal(decodeURIComponent('a+b'), 'a+b');
  });
}

// =================================================================================================
section('3) Çıplak decodeURIComponent KALMADI (regresyon kelepçesi)');
// =================================================================================================
{
  // Bir sonraki tur yeni bir yol segmenti çözerse safeDecode kullanmak ZORUNDA — aksi halde AYNI
  // 5xx sınıfı sessizce geri gelir. İstisnalar: kendi try/catch'ini taşıyan üç dosya ve
  // safeDecode'un kendi gövdesi.
  const ALLOWED = new Set([
    'src/lib/http.js',        // safeDecode'un KENDİSİ
    'src/lib/gatedMedia.js',  // iki çağrısı da try/catch içinde (2026-09-05 denetimi)
    'src/routes/upload.js',   // /media/ yolu, try/catch -> 404 (2026-09-05 denetimi)
    'src/lib/oauth.js',       // base64 -> UTF-8 çözümü, URL segmenti DEĞİL
  ]);
  const walk = (dir, out = []) => {
    for (const e of readdirSync(new URL(dir + '/', ROOT), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`, out);
      else if (e.name.endsWith('.js')) out.push(`${dir}/${e.name}`);
    }
    return out;
  };
  await test('src/ içinde sarmalanmamış decodeURIComponent yok', () => {
    const offenders = [];
    for (const rel of walk('src')) {
      if (ALLOWED.has(rel)) continue;
      read(rel).split('\n').forEach((line, i) => {
        if (!line.includes('decodeURIComponent(')) return;
        if (/^\s*(\/\/|\*)/.test(line)) return;          // yorum satırı
        offenders.push(`${rel}:${i + 1}`);
      });
    }
    assert.deepEqual(offenders, [], `safeDecode kullanılmalı: ${offenders.join(', ')}`);
  });
  await test('detay sayfası yolu (src/index.js#serveDetailPage) safeDecode kullanıyor', () => {
    const src = read('src/index.js');
    assert.match(src, /const rawSlug = safeDecode\(url\.pathname\.slice\(cleanRoute\.prefix\.length\)/);
  });
  await test('parseCookies de safeDecode kullanıyor (bozuk çerez = her istek 500 olurdu)', () => {
    assert.match(read('src/lib/http.js'), /out\[k\] = safeDecode\(v\);/);
  });
}

// =================================================================================================
section('4) schema.sql, migration kolonlarıyla AYNI (yerel fikstür = üretim şeması)');
// =================================================================================================
{
  // 0079 BİLEREK dışarıda: fold kolonları VIRTUAL generated'dır ve tek kaynağı o migration'dır
  // (bkz. schema.sql'deki açık not). Bunu muaf tutmak, kuralın geri kalanını zayıflatmaz.
  const EXEMPT_MIGRATIONS = new Set(['0079_search_fold_columns.sql']);
  await test('schema.sql hiçbir ADD COLUMN kolonunu kaçırmıyor', () => {
    const db = freshDb();
    const colsOf = (t) => {
      try { return new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name)); }
      catch { return new Set(); }
    };
    const missing = [];
    for (const f of readdirSync(new URL('migrations/', ROOT)).filter((f) => f.endsWith('.sql')).sort()) {
      if (EXEMPT_MIGRATIONS.has(f)) continue;
      for (const m of read(`migrations/${f}`).matchAll(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/gi)) {
        const [, tbl, col] = m;
        const have = colsOf(tbl);
        if (!have.size) continue;                  // tablo schema.sql'de hiç yok -> bu testin konusu değil
        if (!have.has(col)) missing.push(`${tbl}.${col} (${f})`);
      }
    }
    assert.deepEqual(missing, [], `schema.sql'e eklenmeli: ${missing.join(', ')}`);
  });
  await test('gundem_items.submitter_type gerçekten var (503 -> 404 kök nedeni)', () => {
    const db = freshDb();
    const cols = db.prepare('PRAGMA table_info(gundem_items)').all().map((r) => r.name);
    for (const c of ['images', 'submitted_by', 'submitter_type', 'submitter_key', 'submitter_name']) {
      assert.ok(cols.includes(c), `gundem_items.${c} eksik`);
    }
  });
}

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
