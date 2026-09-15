#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-15 (onuncu tur), üç madde:
//
//  1. "Ana menüde giriş yapan kullanıcı isminin yanına koyduğun icon yerine ekte ilettiğim iconu
//     koy arka planı olmayan şekilde beyaz renkte koy. Mobil ve tablet görünümünde de yan çekmece
//     menüde ismin yanında yine bu icon olsun."
//  2. "Danışmanlık Al sayfasında ödemeye sonra yapacağım butonunu kaldır, ödemeler şimdilik kapalı
//     olsun önemli değil. Rozet al sayfasında da ödemeye ilerlensin ama onda da şimdilik ödemeler
//     kapalı olsun."
//  3. "Bir kullanıcı siteye bir proje eklediği zaman bu proje, proje sayfasında 1. sıraya yerleşsin."
//
// Kelepçelenen şeyler — hepsi SESSİZCE bozulabilecek türden:
//
//   1. İKON SABİT BİR RENK TAŞIMAMALI. `fill="none"` + currentColor olmasaydı, koyu düğmede doğru
//      görünen ikon açık zeminli mobil çekmecede beyaz üstüne beyaz çizilirdi.
//   2. ÖDEME EKRANI ÇIKIŞSIZ KALMAMALI. "Daha sonra ödeyeceğim" kaldırıldığına göre, hiçbir ödeme
//      yöntemi açık değilken kalan tek düğme akışı kapatabilmeli — yoksa kullanıcı randevu özetini
//      hiç görmez.
//   3. ROZETTE KAPI YALNIZCA ARAYÜZDE OLMAMALI. Pasif bir düğme kapı değildir: elle hazırlanmış bir
//      POST hâlâ checkout başlatabilirdi (kart yolu 2026-09-08'de yalnızca UI'dan kaldırılmıştı).
//   4. YENİ PROJENİN 1. SIRASI BİR TESADÜFE DAYANMAMALI. created_at "şimdi" olsa bile sıralama
//      anahtarı METİNDİR ve admin akışlarının ISO damgası ('T') boşluklu created_at'ten ('  ')
//      BÜYÜKTÜR — aynı gün içinde yeni proje ikinci sıraya düşüyordu. Aşağıdaki sıralama testi
//      gerçek SQLite üzerinde, ORDER BY'ı KAYNAKTAN okuyarak çalışır.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
// Statik import: `test()` sarmalayıcısı senkrondur, async bir gövdedeki assert hatası sessizce
// "geçti" sayılırdı.
import { badgePaymentOptions, BADGE_SALES_OPEN } from '../src/routes/badges.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(title) { console.log(`\n${title}`); }
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const authNav = read('auth-nav.js');
const cnsModal = read('js/components/consultation-modal.js');
const infoModal = read('js/components/info-modal.js');
const badgesRoute = read('src/routes/badges.js');
const paymentsRoute = read('src/routes/payments.js');
const canonicalSync = read('src/lib/canonicalSync.js');
const projectPool = read('src/lib/projectPool.js');
const projectRoute = read('src/routes/project.js');

// ---------------------------------------------------------------------------------------------
section('1) hesap ikonu: ad yanında, arka plansız, currentColor');

test('ICON_PERSON arka plansız ve rengini taşıyıcısından alır', () => {
  const m = authNav.match(/const ICON_PERSON = '([^']*)'/);
  assert.ok(m, 'ICON_PERSON tanımlı değil');
  const svg = m[1];
  assert.match(svg, /fill="none"/, 'ikon dolu çizilmemeli (arka planı olmayacak)');
  assert.match(svg, /stroke="currentColor"/, 'renk currentColor olmalı — sabit bir renk iki yüzeyden birinde görünmez olurdu');
  assert.ok(!/fill="(?!none)/.test(svg) && !/#[0-9a-fA-F]{3,6}/.test(svg), 'ikonda sabit renk/dolgu var');
  // Ekteki görsel: daire (baş) + omuz yayı.
  assert.match(svg, /<circle /, 'baş (daire) yok');
  assert.match(svg, /<path /, 'omuz yayı yok');
});

test('.nav-avatar-icon kuralı arka plan YAZMAZ (yalnızca yerleşim)', () => {
  const rule = authNav.match(/\.nav-avatar-icon\{[^}]*\}/);
  assert.ok(rule, '.nav-avatar-icon kuralı yok');
  assert.ok(!/background/.test(rule[0]), 'ikonun arka planı olmamalı');
});

test('ikon HER İKİ yüzeyde de ismin yanında: üst menü düğmesi + mobil çekmece', () => {
  const btn = authNav.match(/<button class="nav-avatar"[\s\S]*?<\/button>/);
  assert.ok(btn && btn[0].includes('${ICON_PERSON}'), 'üst menü düğmesinde ikon yok');
  const drawer = authNav.match(/<div class="nav-mobile-account-name">[\s\S]*?<\/div>/);
  assert.ok(drawer && drawer[0].includes('${ICON_PERSON}'), 'mobil çekmecede ikon yok');
  // Ad metni kendi kapsayıcısında olmalı: kırpma (ellipsis) ikonu yemesin.
  assert.match(authNav, /\.nav-mobile-account-name-text\{[^}]*text-overflow:ellipsis/);
});

// ---------------------------------------------------------------------------------------------
section('2a) Danışmanlık Al: "Daha sonra ödeyeceğim" kaldırıldı');

test('düğme, stili ve dinleyicisi kodda HİÇ kalmadı', () => {
  for (const needle of ['cns-pm-later', 'cns-pay-later', 'pmLaterBtn', '>Daha sonra ödeyeceğim<']) {
    assert.ok(!cnsModal.includes(needle), `"${needle}" hâlâ duruyor`);
  }
});

test('ödeme ekranı çıkışsız kalmaz: yöntem yokken düğme "Tamam" ve etkin', () => {
  // renderPayment'in "hiç aktif yöntem yok" dalı — bugünkü durum (kart ürün kararıyla kapalı,
  // havale sırlar tanımlı değilse kapalı) HER ZAMAN buraya düşer.
  const branch = cnsModal.match(/\} else \{[\s\S]*?pmMethod = null;[\s\S]*?\}/);
  assert.ok(branch, 'renderPayment\'in yöntemsiz dalı bulunamadı');
  assert.match(branch[0], /pmSubmitBtn\.disabled = false;/, 'tek kalan düğme pasif bırakılmamalı');
  assert.match(branch[0], /pmSubmitBtn\.textContent = 'Tamam';/, 'düğme "Tamam" olmalı');
  // ... ve tıklanınca onay ekranına geçmeli (talep zaten açıldı, bu bir iptal değil).
  assert.match(cnsModal, /if \(!pmMethod\) \{ if \(state\.requestId\) showSuccessScreen\(\); return; \}/);
});

// ---------------------------------------------------------------------------------------------
section('2b) Rozet Al: ödeme adımına ilerlenir, ödemeler kapalı');

test('"Ödeme Sayfasına İlerle" düğmesi ve ödeme adımı var', () => {
  assert.match(infoModal, /id="im-pay-next"[^>]*>Ödeme Sayfasına İlerle</);
  assert.match(infoModal, /id="im-payment-section"/);
  assert.match(infoModal, /id="im-pay-methods"/);
  // Adım geçişi: ödeme açıkken kademe/hedef bölümleri kapanır (tek ekranda iki adım karışmasın).
  const step = infoModal.match(/function showPaymentStep\(on\) \{[\s\S]*?\n    \}/);
  assert.ok(step, 'showPaymentStep yok');
  assert.match(step[0], /im-target-section[\s\S]*display = on \? 'none' : ''/);
  assert.match(step[0], /im-tier-section[\s\S]*display = on \? 'none' : ''/);
});

test('yöntemler SUNUCUDAN çizilir, sayfada "açık mı" kararı yok', () => {
  assert.match(infoModal, /fetch\('\/api\/badges\/options'\)/);
  assert.match(badgesRoute, /export function badgePaymentOptions\(\)/);
  assert.match(badgesRoute, /segments\[2\] === 'options'[\s\S]*?json\(badgePaymentOptions\(\)\)/);
  // Uç oturum kapısından ÖNCE cevaplanmalı — Rozet Al giriş yapılmadan da görüntülenebiliyor.
  const optionsAt = badgesRoute.indexOf("segments[2] === 'options'");
  const sessionAt = badgesRoute.indexOf('await getSessionUser(request, env)');
  assert.ok(optionsAt !== -1 && sessionAt !== -1 && optionsAt < sessionAt, 'options ucu oturum kapısının ARKASINDA');
});

test('ödeme bugün KAPALI: iki yöntem de pasif, gönder düğmesi pasif', () => {
  assert.equal(BADGE_SALES_OPEN, false, 'rozet satışı açılmış');
  const opts = badgePaymentOptions();
  assert.equal(opts.salesOpen, false);
  assert.deepEqual(opts.methods.map(m => m.method).sort(), ['havale', 'iyzico']);
  assert.ok(opts.methods.every(m => m.enabled === false), 'kapalıyken hiçbir yöntem açık olamaz');
  assert.ok(opts.methods.every(m => m.note === 'Henüz aktif değil.'));
  // İstemci tarafı: düğme koşula bağlı DEĞİL, kural olarak pasif (ödeme akışı bilerek kurulmadı).
  assert.match(infoModal, /submit\.disabled = true;/);
});

test('KAPI SUNUCUDA: havale de kart da BADGE_SALES_OPEN\'a bağlı', () => {
  // Havale yolu zaten bağlıydı; kart yolu (payments.js#startCheckout) 2026-09-08'de yalnızca
  // UI'dan kaldırılmış, sunucuda açık kalmıştı.
  assert.match(badgesRoute, /if \(!BADGE_SALES_OPEN\) return errorJson\('Rozet satışı şu an açık değil\.', 403\)/);
  assert.match(paymentsRoute, /import \{[^}]*BADGE_SALES_OPEN[^}]*\} from '\.\/badges\.js'/);
  const checkout = paymentsRoute.match(/async function startCheckout\([\s\S]*?const body = await readJson\(request\)/);
  assert.ok(checkout, 'startCheckout bulunamadı');
  assert.match(checkout[0], /if \(!BADGE_SALES_OPEN\) \{[\s\S]*?403\)/, 'kart yolunda ürün kararı kapısı yok');
});

test('IBAN kutusu GERİ GELMEDİ (2026-09-08 kuralı)', () => {
  // Yalnızca GERÇEK bir IBAN yüzeyi aranır (kimlik/etiket/kopyala düğmesi) — dosyadaki yorumlar
  // kuralın KENDİSİNİ anlatmak için "IBAN" kelimesini geçirmeye devam ediyor.
  const view = infoModal.slice(infoModal.indexOf('function rozetAlTemplate'), infoModal.indexOf('function iadeEtTemplate'));
  for (const needle of ['id="im-pay-iban', 'iban-box', "IBAN'ı Kopyala", 'accountName', 'account.iban']) {
    assert.ok(!view.includes(needle), `Rozet Al ekranına IBAN geri gelmiş: "${needle}"`);
  }
});

// ---------------------------------------------------------------------------------------------
section('3) yeni proje /proje listesinin 1. sırasına oturur');

test('INSERT relisted_at damgalar (yayına giriyorsa ve admin tarihi yoksa)', () => {
  assert.match(canonicalSync, /const NOW_ISO_SQL = `strftime\('%Y-%m-%dT%H:%M:%fZ', 'now'\)`;/);
  assert.match(canonicalSync, /const relistNew = opts\.publish !== false && !publishDate;/);
  const insert = canonicalSync.match(/INSERT INTO projects \([^`]*`\s*\)\.bind\(/);
  assert.ok(insert, 'proje INSERT\'i bulunamadı');
  assert.match(insert[0], /relisted_at, source, legacy_key, claimed_by_user_id/, 'INSERT relisted_at yazmıyor');
  assert.match(insert[0], /\$\{relistNew \? NOW_ISO_SQL : 'NULL'\}/, 'damga koşullu değil');
});

test('kolon ve değer sayıları tutuyor (sessiz bir bind kayması olmasın)', () => {
  const m = canonicalSync.match(/INSERT INTO projects \(([^)]*)\)\s*\n\s*VALUES \(([^)]*)\)/);
  assert.ok(m, 'INSERT ayrıştırılamadı');
  const cols = m[1].split(',').length;
  const vals = m[2].split(',').length;
  assert.equal(cols, vals, `kolon (${cols}) ve değer (${vals}) sayısı ayrışmış`);
});

test('önizlemeye giren kayıt damgalanmaz (1. sıra yalnızca yayınlanana)', () => {
  // opts.publish === false -> markInsertedAsPreview; o kayıt listede EN SONA düşer
  // ((preview_at IS NOT NULL) ASC) ve damgalanması anlamsız olurdu.
  assert.match(canonicalSync, /if \(opts\.publish === false\) await markInsertedAsPreview\(env, 'projects', projectId\);/);
});

test('önizlemeden çıkan kayıt AYNI biçimde damgalanır (dört tür de)', () => {
  const stamps = canonicalSync.match(/CASE WHEN preview_at IS NOT NULL THEN \$\{NOW_ISO_SQL\} ELSE relisted_at END/g) || [];
  assert.equal(stamps.length, 4, 'mimar/firma/proje/ürün damgalarından biri eski biçimde kalmış');
  assert.ok(!/THEN datetime\('now'\) ELSE relisted_at END/.test(canonicalSync), 'eski boşluklu damga kalmış');
});

// Gerçek sıralama — ORDER BY KAYNAKTAN okunur, kopyalanmaz.
function projectOrderBy() {
  const m = projectPool.match(/ORDER BY (\(p\.preview_at[^`]*?)`/);
  assert.ok(m, 'fetchActiveProjectPool ORDER BY bulunamadı');
  return m[1].trim().replace(/p\./g, '');
}

test('/proje ve tekil sayfa sorgusu AYNI sıralamayı kullanır', () => {
  const pool = projectOrderBy();
  const page = projectRoute.match(/ORDER BY \(preview_at IS NOT NULL\) ASC, COALESCE\(display_order, 0\) ASC, COALESCE\(relisted_at, publish_date, created_at\) DESC, id DESC/);
  assert.ok(page, 'project.js#fetchProjectPageRows sıralaması değişmiş');
  assert.equal(pool, page[0].replace('ORDER BY ', ''), 'iki sıralama ayrışmış');
});

test('AYNI GÜN ISO damgalı eski proje varken bile yeni proje 1. sırada', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE projects (
    id INTEGER PRIMARY KEY, title TEXT, display_order INTEGER, preview_at TEXT,
    relisted_at TEXT, publish_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  // 1) Sıralaması elle atanmış eski katalog satırı (migrations/0087 geri dolumu).
  db.exec(`INSERT INTO projects (title, display_order, created_at) VALUES ('eski katalog', 898, '2024-03-02 10:00:00')`);
  // 2) BUGÜN admin akışıyla öne çekilmiş eski bir proje — damga ISO (src/routes/admin.js#nowIso).
  db.exec(`INSERT INTO projects (title, relisted_at, created_at) VALUES ('yönetici ataması ile öne çekilen', strftime('%Y-%m-%dT%H:%M:%fZ','now'), '2023-01-01 09:00:00')`);
  // 3) Kullanıcının BUGÜN eklediği yeni proje — canonicalSync#syncProject'in INSERT'i.
  db.exec(`INSERT INTO projects (title, relisted_at) VALUES ('yeni proje', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

  const order = projectOrderBy();
  const rows = db.prepare(`SELECT title FROM projects ORDER BY ${order}`).all();
  assert.equal(rows[0].title, 'yeni proje', `1. sıra "${rows[0].title}" oldu`);

  // ... ve damga OLMASAYDI (düzeltme öncesi hâl) ikinci sıraya düşerdi: kök nedenin kendisi.
  db.exec(`UPDATE projects SET relisted_at = NULL WHERE title = 'yeni proje'`);
  const before = db.prepare(`SELECT title FROM projects ORDER BY ${order}`).all();
  assert.notEqual(before[0].title, 'yeni proje', 'kök neden artık üretilemiyor — test anlamını yitirmiş olabilir');
  db.close();
});

test('önizlemedeki kayıt canlıların ÜSTÜNE çıkamaz', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE projects (
    id INTEGER PRIMARY KEY, title TEXT, display_order INTEGER, preview_at TEXT,
    relisted_at TEXT, publish_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`INSERT INTO projects (title, created_at) VALUES ('canlı', '2024-03-02 10:00:00')`);
  db.exec(`INSERT INTO projects (title, preview_at) VALUES ('önizleme', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
  const rows = db.prepare(`SELECT title FROM projects ORDER BY ${projectOrderBy()}`).all();
  assert.equal(rows[0].title, 'canlı');
  db.close();
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
