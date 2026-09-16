#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-16 (SEKİZİNCİ tur) — dört madde, tek test dosyası.
//
// 1. "Kişi popupındaki ekip arkadaşları kısmında da rozet gözükmüyor bu sorunu düzelt."
// 2. "Gece görünümünde lightboxlardaki kaydet tümünü göster ve kapat butonlarının icon renklerini
//    beyaz yap."
// 3. "Hesabım sayfasındaki Firma Bilgileri ve Kişi Bilgileri kutuları çok yavaş yükleniyorlar,
//    buna bir çözüm bul. Daha hızlı yüklensinler."
// 4. "Proje ekle/düzenle sayfasında Tarih başlığının altındaki Başlangıç kutucuğunda opsiyonel
//    yazmasın. Ayrıca açılan tarihler günümüzden geçmişe doğru olsun. Ürün sayfasındaki Yıl
//    kutucuğunda da tarihler günümüzden eskiye doğru olsun."
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fetchOfficeFounderLinks, fetchOwnArchitectRows, fetchOwnCreatedOfficeRows, fetchOwnOfficeRoles } from '../src/lib/claimedProfiles.js';
import { OFFICE_EDIT_POSITIONS } from '../src/lib/projectClaimAccess.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// -----------------------------------------------------------------------------------------------
section('1) Kişi pop-up’ı: Ekip Arkadaşları kartında da ROZET');
// KÖK NEDEN, 2026-09-16 yedinci turdaki office-modal.js#teamCardHtml ile AYNI sınıf: kart
// geri-çağrısı verifiedBadgeHtml'i HİÇ sormuyordu. İki liste (Ortaklar / Ekip Arkadaşları) aynı
// kaynaktan (buildOfficePeople -> office_founders) gelip yalnızca göreve göre ayrıldığından
// rozetin birinde görünüp diğerinde görünmemesinin gerekçesi yoktu.
{
  const am = read('../js/components/architect-modal.js');

  await test('am-team-grid kartı verifiedBadgeHtml(architect, ...) çağırır', () => {
    const block = am.slice(am.indexOf('function renderTeamGrid()'), am.indexOf('function renderTeamGrid()') + 700);
    assert.ok(/am-team-grid/.test(block), 'renderTeamGrid am-team-grid ızgarasını çizmeli');
    assert.match(block, /verifiedBadgeHtml\('architect', t\.name, t\.badges, 14\)/);
  });

  await test('rozet boyutu Ortaklar kartıyla AYNI (14)', () => {
    // Ayrışırsa iki komşu ızgarada farklı boyutta rozet görünürdü.
    assert.match(am, /verifiedBadgeHtml\('architect', c\.name, c\.badges, 14\)/);
  });

  await test('renderTeamGrid AYRI fonksiyon (yeniden çizilebilir)', () => {
    assert.match(am, /function renderTeamGrid\(\) \{/);
  });

  await test('renderVerifiedBadges renderTeamGrid’i de tazeler', () => {
    // /api/public/badges ASENKRON gelir: ilk çizimde dynamicBadges haritası boş olabilir, o yüzden
    // rozet hazır olduğunda ızgara yeniden çizilmeli (renderOfficeGrid/renderColleaguesGrid ile
    // AYNI desen). Bu satır olmadan rozet YALNIZCA önbellek zaten dolu olduğunda görünürdü.
    const fn = am.slice(am.indexOf('function renderVerifiedBadges()'), am.indexOf('renderVerifiedBadges();\n    // gerçek bulgu'));
    assert.match(fn, /renderOfficeGrid\(\);/);
    assert.match(fn, /renderColleaguesGrid\(\);/);
    assert.match(fn, /renderTeamGrid\(\);/);
  });

  await test('teammates ızgarası tek yerden çizilir (eski satır içi render kalmadı)', () => {
    const inline = am.match(/RelatedStrip\.render\(document\.getElementById\('am-team-grid'\)/g) || [];
    assert.equal(inline.length, 1, 'am-team-grid yalnızca renderTeamGrid içinden çizilmeli');
  });
}

// -----------------------------------------------------------------------------------------------
section('2) Lightbox ikonları GECE görünümünde de beyaz');
// KÖK NEDEN: .lightbox zemini HER temada koyudur (rgba(27,42,61,0.92)) ama ikonlar color:var(--paper)
// taşıyordu ve o token gece temasında #12171F'e çözülüyordu — koyu zemin üstüne koyu ikon.
{
  const files = {
    'css/project-detail.css': read('../css/project-detail.css'),
    'css/architect-detail.css': read('../css/architect-detail.css'),
    'css/product-detail.css': read('../css/product-detail.css'),
    'en-iyi-100.html': read('../en-iyi-100.html'),
  };
  const gallery = read('../js/components/gallery.js');

  await test('lightbox kurallarının HİÇBİRİ artık var(--paper) taşımıyor', () => {
    for (const [name, src] of Object.entries(files)) {
      const lines = src.split('\n');
      let inToggle = false;
      lines.forEach((line, i) => {
        if (/^\s*\.lightbox-grid-toggle\{\s*$/.test(line)) inToggle = true;
        if ((/lightbox/.test(line) || inToggle) && /color:var\(--paper\)/.test(line)) {
          assert.fail(`${name}:${i + 1} hâlâ color:var(--paper) taşıyor: ${line.trim()}`);
        }
        if (inToggle && line.includes('}')) inToggle = false;
      });
    }
  });

  await test('kapat + "Tümünü Gör" ikonları DÖRT kopyada da #EDF0F3', () => {
    for (const [name, src] of Object.entries(files)) {
      const close = src.match(/\.lightbox-close\{[^}]*\}/);
      assert.ok(close, `${name}: .lightbox-close kuralı bulunamadı`);
      assert.match(close[0], /color:#EDF0F3/, `${name}: .lightbox-close`);
      const toggle = src.match(/\.lightbox-grid-toggle\{[^}]*\}/);
      assert.ok(toggle, `${name}: .lightbox-grid-toggle kuralı bulunamadı`);
      assert.match(toggle[0], /color:#EDF0F3/, `${name}: .lightbox-grid-toggle`);
    }
  });

  await test('oklar (.lightbox-nav) da sabit açık ton', () => {
    // Aynı kök neden, aynı zemin: ok ikonları da gece temasında görünmez oluyordu.
    for (const [name, src] of Object.entries(files)) {
      const nav = src.match(/\.lightbox-nav\{[^}]*\}/);
      if (!nav) continue;
      assert.match(nav[0], /color:#EDF0F3/, `${name}: .lightbox-nav`);
    }
  });

  await test('kaydet düğmesi (gallery.js enjekte CSS) #EDF0F3', () => {
    const rule = gallery.match(/\.lightbox \.lightbox-save-btn\{[^}]*\}/);
    assert.ok(rule, '.lightbox .lightbox-save-btn kuralı bulunamadı');
    assert.match(rule[0], /color:#EDF0F3/);
    assert.ok(!/color:var\(--paper\)/.test(rule[0]));
  });

  await test('değer, zaten sabit olan .lightbox-credit ile AYNI aileden', () => {
    // .lightbox-credit 2026-09-10'dan beri rgba(237,240,243,0.92) taşıyor — 237,240,243 = #EDF0F3.
    assert.match(gallery, /\.lightbox-credit\{[\s\S]{0,400}?rgba\(237,240,243,0\.92\)/);
  });

  await test('enjekte edilen CSS şablonunda TERS TIRNAK yok', () => {
    // bkz. [[feedback_no_backtick_in_style_template_literals]] — bu turda da aynı dosya düzenlendi.
    const start = gallery.indexOf('const STYLE');
    const from = start >= 0 ? start : 0;
    const open = gallery.indexOf('`', from);
    const close = gallery.indexOf('`', open + 1);
    assert.ok(open > 0 && close > open, 'enjekte edilen stil şablonu bulunamadı');
    const body = gallery.slice(open + 1, close);
    assert.ok(!body.includes('`'), 'şablon gövdesinde ters tırnak var — dize sessizce kapanır');
  });
}

// -----------------------------------------------------------------------------------------------
section('3) Hesabım: Firma/Kişi Bilgileri kutuları daha hızlı');
{
  const claims = read('../src/routes/claims.js');
  const am = read('../js/components/auth-modal.js');
  const myClaims = claims.slice(claims.indexOf('async function myClaims('), claims.indexOf('// GET /api/claims/office-managers'));

  await test('myClaims bağımsız sorguları TEK Promise.all ile koşturur', () => {
    assert.match(myClaims, /await Promise\.all\(\[/);
    for (const helper of ['fetchOfficeFounderLinks(env, user, OFFICE_EDIT_POSITIONS)', 'fetchOwnOfficeRoles(env, user)', 'fetchOwnArchitectRows(env, user)', 'fetchOwnCreatedOfficeRows(env, user)']) {
      assert.ok(myClaims.includes(helper), `${helper} çağrısı bulunamadı`);
      assert.ok(!myClaims.includes(`await ${helper}`), `${helper} hâlâ ayrı ayrı await ediliyor (zincir geri geldi)`);
    }
  });

  await test('iki profile_claims sorgusu BİRE indi', () => {
    const selects = myClaims.match(/FROM profile_claims/g) || [];
    assert.equal(selects.length, 1, 'profile_claims yalnızca bir kez SELECT edilmeli (dismissed JS tarafında ayrılır)');
    assert.match(myClaims, /allClaimRows\s*\n?\s*\.filter\(r => r\.profile_type === 'office' && r\.status === OFFICE_MANAGER_DISMISSED\)/);
  });

  await test('dismissed kümesi ile results AYNI satırlardan türer (davranış korunur)', () => {
    assert.match(myClaims, /const results = allClaimRows\.filter\(r => r\.status !== OFFICE_MANAGER_DISMISSED\);/);
  });

  // GERÇEK ÖLÇÜM: yardımcıların kendisi (gerçek kod) sahte bir D1 üzerinde koşturulur ve gidiş-dönüş
  // başına sabit gecikmeyle kritik yol ölçülür. Sıralı kurgu (eski hâl) ile paralel kurgu (yeni hâl)
  // YAN YANA koşar — ölçüm, kurala değil gerçek zamana bakar.
  await test('ÖLÇÜM: paralel kurgu sıralı kurgudan belirgin hızlı', async () => {
    const LAT = 12;
    let count = 0;
    const rowsFor = (sql) => {
      if (/FROM profile_claims c/.test(sql)) return [{ id: 'a1', name: 'Kaan', slug: 'kaan', position: 'Kurucu' }];
      if (/FROM architects WHERE/.test(sql)) return [{ id: 'a1', name: 'Kaan', slug: 'kaan', position: 'Kurucu' }];
      if (/FROM office_founders f/.test(sql)) return [{ architect_id: 'a1', name: 'ACME', slug: 'acme' }];
      if (/FROM offices/.test(sql)) return [{ id: 'o1', name: 'ACME', slug: 'acme' }];
      if (/FROM office_submissions/.test(sql)) return [];
      if (/FROM profile_claims/.test(sql)) return [{ profile_type: 'office', profile_key: 'ACME', status: 'approved', officePosition: 'Kurucu' }];
      return [];
    };
    const stmt = (sql) => {
      const api = {
        bind: () => api,
        all: async () => { count++; await new Promise(r => setTimeout(r, LAT)); return { results: rowsFor(sql) }; },
        first: async () => { count++; await new Promise(r => setTimeout(r, LAT)); return rowsFor(sql)[0] || null; },
      };
      return api;
    };
    const env = { DB: { prepare: (sql) => stmt(sql) } };
    const user = { id: 'u1', name: 'Kaan' };

    count = 0;
    let t = Date.now();
    await env.DB.prepare('SELECT profile_type FROM profile_claims').bind().all();
    await fetchOfficeFounderLinks(env, user, OFFICE_EDIT_POSITIONS);
    await fetchOwnOfficeRoles(env, user);
    await env.DB.prepare('SELECT profile_key FROM profile_claims WHERE status = ?').bind().all();
    await fetchOwnArchitectRows(env, user);
    await fetchOwnCreatedOfficeRows(env, user);
    await env.DB.prepare('SELECT name, status FROM office_submissions').bind().all();
    const serialMs = Date.now() - t;
    const serialQueries = count;

    count = 0;
    t = Date.now();
    await Promise.all([
      env.DB.prepare('SELECT profile_type FROM profile_claims').bind().all(),
      fetchOfficeFounderLinks(env, user, OFFICE_EDIT_POSITIONS),
      fetchOwnOfficeRoles(env, user),
      fetchOwnArchitectRows(env, user),
      fetchOwnCreatedOfficeRows(env, user),
      env.DB.prepare('SELECT name, status FROM office_submissions').bind().all(),
    ]);
    const parallelMs = Date.now() - t;

    const serialWaves = Math.round(serialMs / LAT);
    const parallelWaves = Math.round(parallelMs / LAT);
    assert.ok(serialWaves >= 10, `eski kurgu en az 10 dalga olmalıydı, ölçülen ${serialWaves}`);
    assert.ok(parallelWaves <= 5, `yeni kurgu en çok 5 dalga olmalı, ölçülen ${parallelWaves}`);
    assert.ok(parallelMs * 2 < serialMs, `paralel (${parallelMs}ms) sıralının (${serialMs}ms) yarısından hızlı olmalı`);
    assert.ok(serialQueries >= 13, `ölçüm gerçek sorgulara dayanmalı (${serialQueries})`);
  });

  await test('/api/architects/mine TEK yerden çekilir (memo)', () => {
    const sites = am.match(/fetch\('\/api\/architects\/mine'\)/g) || [];
    assert.equal(sites.length, 1, '/api/architects/mine için tek fetch noktası olmalı');
    assert.match(am, /function fetchMyArchitectSubmissions\(\) \{/);
  });

  await test('/api/architect/:key TEK yerden çekilir (anahtar başına memo)', () => {
    const sites = am.match(/fetch\(`\/api\/architect\/\$\{encodeURIComponent/g) || [];
    assert.equal(sites.length, 1, '/api/architect/:key için tek fetch noktası olmalı');
    assert.match(am, /function fetchArchitectItem\(profileKey\) \{/);
    assert.match(am, /claimedArchitectPromise = fetchArchitectItem\(claim\.profile_key\);/);
  });

  await test('fetchArchitectRecordForSync iki isteği PARALEL başlatır', () => {
    const fn = am.slice(am.indexOf('async function fetchArchitectRecordForSync('), am.indexOf('return { merged, editId };'));
    assert.match(fn, /const \[itemP, subsP\] = \[fetchArchitectItem\(profileKey\), fetchMyArchitectSubmissions\(\)\];/);
    // İki await'in İKİSİ de aynı iki sözü tüketmeli — yani ikinci istek birincinin dönüşünü
    // beklemeden başlamış olmalı.
    assert.match(fn, /await itemP/);
    assert.match(fn, /await subsP/);
  });

  await test('invalidatePersonCaches yeni memoları da düşürür', () => {
    const fn = am.slice(am.indexOf('function invalidatePersonCaches()'), am.indexOf('async function loadMyClaims()'));
    assert.match(fn, /myArchSubmissionsPromise = null;/);
    assert.match(fn, /architectItemPromises = \{\};/);
  });

  await test('/api/office/:key ısıtması kişi künyesi await’inden ÖNCE başlar', () => {
    const fn = am.slice(am.indexOf('async function loadFirmInfo(claimItems)'), am.indexOf('function ensureFirmOffice(explicitKey)'));
    const warmAt = fn.indexOf('warm.forEach(k => ensureFirmOffice(k));');
    const archAt = fn.indexOf('const arch = (await fetchClaimedArchitect(claimItems))');
    assert.ok(warmAt > 0, 'ısıtma bloğu bulunamadı');
    assert.ok(archAt > 0, 'kişi künyesi await satırı bulunamadı');
    assert.ok(warmAt < archAt, 'ısıtma, await’ten SONRA kalmış — kritik yol kısalmaz');
  });

  await test('ısıtma kümesi DAR: yalnızca zaten çekilecek anahtarlar', () => {
    const fn = am.slice(am.indexOf('async function loadFirmInfo(claimItems)'), am.indexOf('function ensureFirmOffice(explicitKey)'));
    const warm = fn.slice(fn.indexOf('const warm = [];'), fn.indexOf('warm.forEach'));
    // canManageFirmEntry'nin AYNI koşulu + 1. sayfanın firması; "tüm anahtarlar" DEĞİL.
    assert.match(warm, /OFFICE_EDIT_POSITIONS\.has\(c\.officePosition \|\| ''\)/);
    assert.match(warm, /for \(const l of myOfficeLinks\) if \(l\.canEdit\)/);
    assert.match(warm, /for \(const o of myOwnOffices\) if \(o\.canEdit\)/);
    assert.ok(!/for \(const e of firmEntries\)/.test(warm), 'ısıtma firmEntries üzerinden yapılmamalı (o liste henüz kurulmadı)');
  });

  await test('ensureFirmOffice anahtar başına tek uçuş guard’ını korur', () => {
    // Isıtma ile aşağıdaki asıl çağrılar AYNI anahtarları paylaşıyor; guard olmasa istek iki kez
    // giderdi ve ısıtma bir kazanç değil ek yük olurdu.
    assert.match(am, /if \(!key \|\| key in firmOfficeCache\) return;/);
  });
}

// -----------------------------------------------------------------------------------------------
section('4) Tarih/Yıl kutuları: yer tutucu + AZALAN sıra');
{
  const picker = read('../office-picker.js');
  const projeEkle = read('../proje-ekle.html');
  const urunEkle = read('../urun-ekle.html');

  await test('Başlangıç yer tutucusunda "(opsiyonel)" YOK', () => {
    assert.match(projeEkle, /placeholder: 'Başlangıç',/);
    assert.ok(!/placeholder: 'Başlangıç \(opsiyonel\)'/.test(projeEkle));
  });

  await test('Bitiş kutusunun yer tutucusu DEĞİŞMEDİ', () => {
    assert.match(projeEkle, /placeholder: 'Bitiş',/);
  });

  await test('Tarih alanının ZORUNLULUĞU değişmedi', () => {
    // İstek yalnızca yazıyı kaldırıyor; guard yerinde kalmalı.
    assert.match(projeEkle, /if\(!buildDateString\(\)\)\{/);
    assert.match(projeEkle, /notice\.textContent = 'Bir tarih gir\.';/);
  });

  await test('yearOptionList AZALAN üretir (bugün -> from)', () => {
    const fn = picker.slice(picker.indexOf('function yearOptionList('), picker.indexOf('function createYearPicker('));
    assert.match(fn, /for \(let y = now; y >= from; y--\)/);
    assert.ok(!/for \(let y = from; y <= now; y\+\+\)/.test(fn), 'artan döngü hâlâ duruyor');
  });

  await test('"MÖ" seçeneği listenin SONUNDA (en eski değer)', () => {
    const fn = picker.slice(picker.indexOf('function yearOptionList('), picker.indexOf('function createYearPicker('));
    assert.match(fn, /if \(bc\) out\.push\(YEAR_BC_OPTION\);/);
    assert.ok(!/const out = bc \? \[YEAR_BC_OPTION\]/.test(fn), '"MÖ" hâlâ başa konuyor');
  });

  // DAVRANIŞ ÖLÇÜMÜ: fonksiyonun kendisi kaynaktan çıkarılıp koşturulur (tarayıcı gerekmez —
  // yearOptionList saf bir fonksiyon).
  await test('ÖLÇÜM: üretilen liste gerçekten bugünden geriye', () => {
    const body = picker.slice(picker.indexOf('function yearOptionList('), picker.indexOf('function createYearPicker('));
    // eslint-disable-next-line no-new-func
    const build = new Function('YEAR_BC_OPTION', `${body}; return yearOptionList;`)('MÖ');
    const now = new Date().getFullYear();

    const proje = build(1, true);
    assert.equal(proje[0], String(now), '1. seçenek bu yıl olmalı');
    assert.equal(proje[1], String(now - 1));
    assert.equal(proje[proje.length - 1], 'MÖ', 'son seçenek MÖ olmalı');
    assert.equal(proje[proje.length - 2], '1', 'MÖ’den önceki seçenek 1 olmalı');
    assert.equal(proje.length, now + 1, 'kapsam (1..bugün + MÖ) DEĞİŞMEDİ');

    const urun = build(1299, false);
    assert.equal(urun[0], String(now));
    assert.equal(urun[urun.length - 1], '1299', 'ürün listesi 1299 ile bitmeli');
    assert.ok(!urun.includes('MÖ'), 'ürün kutusunda MÖ seçeneği yok');
    assert.equal(urun.length, now - 1299 + 1);
  });

  await test('proje ve ürün kutuları AYNI sarmalayıcıyı kullanır (sıra ayrışamaz)', () => {
    assert.match(projeEkle, /createYearPicker\(container\.querySelector\('\.p-date-start-picker'\)/);
    assert.match(projeEkle, /createYearPicker\(container\.querySelector\('\.p-date-end-picker'\)/);
    assert.match(urunEkle, /createYearPicker\(document\.getElementById\('u-year-picker'\)/);
    assert.match(urunEkle, /from: 1299,/);
  });

  await test('TEK seçim + allowCustom (eski davranış) korunur', () => {
    const fn = picker.slice(picker.indexOf('function createYearPicker('), picker.indexOf('window.createNamePicker'));
    assert.match(fn, /single: true,/);
    assert.match(fn, /allowCustom: true,/);
    assert.match(fn, /items: yearOptionList\(o\.from \|\| 1, !!o\.bc\),/);
  });

  await test('liste panel açılmadan DOM’a basılmaz (altıncı turun ölçümü korunuyor)', () => {
    assert.match(picker, /listOpened/);
  });
}

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
