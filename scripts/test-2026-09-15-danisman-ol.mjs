#!/usr/bin/env node
// DANIŞMAN OL + ÖDEME SEÇENEKLERİ — BİRİM TESTLERİ
// (kullanıcı isteği, 2026-09-15 ikinci tur:
//  1) "Talebi Gönder butonunun ismini 'Ödeme Sayfasına İlerle' yap ve bu butona tıklayınca ödeme
//     ekranı açılsın. 2 tane ödeme seçeneği çıksın 1- Havele / Eft  2- Kart ile Ödeme (Henüz aktif
//     değil.)"
//  2) "Danışman Ol sayfasını tasarla ... kişiler kaç dakikalık görüşme verebileceklerini (30, 45
//     veya 60dk), bu görüşme saatlerinin kaç TL olduğunu ve hangi tarihlerde müsait olduklarını
//     seçsinler. Ayrıca hangi alanda danışmanlık verdiklerini vs. bilgi olarak yazsınlar.")
//
// Kelepçelenen şeyler — hepsi SESSİZCE bozulabilecek türden:
//
//   1. KART ÖDEMESİ ARAYÜZDE PASİF AMA SUNUCUDA DA KAPALI. Yalnızca düğmeyi pasifleştirmek bir
//      kapı DEĞİLDİR: elle hazırlanmış bir POST hâlâ checkout başlatabilirdi.
//   2. BAŞVURU KENDİ KENDİNİ ONAYLAYAMAZ. Başvuru ucu status'u asla 'approved' yapmamalı; onay
//      yalnızca admin ucundan gelir. Aksi halde randevu kapısının hiçbir anlamı kalmaz.
//   3. BAŞKASININ PROFİLİ İÇİN BAŞVURULAMAZ. Sahiplik sunucuda, istemcinin gönderdiği slug'a
//      bakılmadan doğrulanır.
//   4. TEKLİF DOĞRULAMASI TEK KAYNAKTAN. Süre 30/45/60 dışında olamaz, gün/saat boş olamaz;
//      form ile sunucu aynı kuralı paylaşmalı (seçenekler sunucudan çizilir).
//   5. SÜRE RANDEVUYA YAZILIR. Danışman süresini sonradan değiştirdiğinde geçmiş randevuların
//      Meet penceresi kaymamalı.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const consultationsSrc = read('src/routes/consultations.js');
const consultantsSrc = read('src/lib/consultants.js');
const meetSrc = read('src/lib/consultationMeet.js');
const modal = read('js/components/consultation-modal.js');
const page = read('danisman-ol.html');
const adminSrc = read('src/routes/admin.js');
const migration = read('migrations/0121_consultants.sql');
const schema = read('schema.sql');

const {
  normalizeConsultantOffer, parseConsultantRow, CONSULTANT_DURATIONS,
  CONSULTANT_TIME_SLOTS, DEFAULT_OFFER, publicOffer,
} = await import(new URL('src/lib/consultants.js', root));
const { IYZICO_ENABLED, isAllowedSlot } = await import(new URL('src/routes/consultations.js', root));
const { consultationDurationMin, meetingWindow } = await import(new URL('src/lib/consultationMeet.js', root));

console.log('\n1 — Ödeme: "Ödeme Sayfasına İlerle" + iki seçenek, kart pasif');

await test('düğmenin adı "Ödeme Sayfasına İlerle" (iki yerde de)', () => {
  assert.match(modal, /id="cns-pay-confirm-btn">Ödeme Sayfasına İlerle</);
  assert.match(modal, /const CONFIRM_BTN_LABEL = 'Ödeme Sayfasına İlerle';/);
  // Eski etiket hiçbir yerde kalmamalı — kalsaydı buton bir yoldan sonra eski adına dönerdi
  // (CONFIRM_BTN_LABEL, istek gönderildikten sonra düğmeyi geri yazıyor).
  assert.ok(!/>Talebi Gönder</.test(modal), 'eski "Talebi Gönder" etiketi hâlâ duruyor');
});

await test('düğme ödeme ekranını açar (akış: talep -> ödeme)', () => {
  // Talep açıldıktan HEMEN sonra ödeme ekranı gösterilir; "Daha sonra ödeyeceğim" ile atlanabilir.
  assert.match(modal, /showPaymentScreen\(\)/);
  assert.match(modal, /id="cns-screen-payment"/);
});

await test('İKİ seçenek de çizilir; sıra Havale -> Kart', () => {
  assert.match(modal, /const PM_ORDER = \['havale', 'iyzico'\];/);
  assert.match(modal, /havale: \{ name: 'Havale \/ EFT'/);
  assert.match(modal, /iyzico: \{ name: 'Kart ile Ödeme'/);
  // methodEntries TÜM yöntemleri döner (filtrelemez) — çizim entries üzerinden yapılır.
  assert.match(modal, /const entries = methodEntries\(\);/);
  assert.match(modal, /pmMethodsEl\.innerHTML = entries\.map/);
});

await test('kart "Henüz aktif değil." etiketiyle PASİF çizilir ve seçilemez', () => {
  assert.match(modal, /'Henüz aktif değil\.'/);
  assert.match(modal, /cns-method-disabled/);
  assert.match(modal, /disabled aria-disabled="true"/);
  // Pasif seçeneğe dinleyici BAĞLANMAZ.
  assert.match(modal, /if \(el\.disabled\) return;/);
});

await test('SUNUCU da kapalı: IYZICO_ENABLED false ve iyzico yöntemi reddediliyor', () => {
  assert.equal(IYZICO_ENABLED, false, 'kart ödemesi sunucuda açık — kullanıcı "henüz aktif değil" dedi');
  // Arayüzü gizlemek tek başına kapı değildir: uç de reddetmeli.
  assert.match(consultationsSrc, /if \(!IYZICO_ENABLED\) \{[\s\S]*?Kart ile ödeme henüz aktif değil/);
  // Bayrak yanıtla birlikte gider ki istemci "pasif çiz" kararını sunucudan alsın.
  assert.match(consultationsSrc, /iyzico: IYZICO_ENABLED && isIyzicoConfigured\(env\)/);
  assert.match(consultationsSrc, /iyzicoComingSoon: !IYZICO_ENABLED/);
});

console.log('\n2 — Başvuru kendi kendini onaylayamaz, başkasının profiline başvurulamaz');

await test("başvuru ucu status'u ASLA 'approved' yapmaz", () => {
  // Tek istisna: ZATEN onaylı bir danışmanın kendi teklifini güncellemesi (onayı düşürmemek için).
  assert.match(consultationsSrc, /const nextStatus = existing && existing\.status === 'approved' \? 'approved' : 'pending';/);
  // Onay kapısı admin ucundadır.
  assert.match(adminSrc, /handleConsultantApplicationsAdmin/);
  assert.match(adminSrc, /UPDATE consultants SET status = \?/);
});

await test('sahiplik SUNUCUDA doğrulanır (istemcinin slug\'ına güvenilmez)', () => {
  assert.match(consultationsSrc, /const candidates = await fetchUserConsultantCandidates\(env, user\);[\s\S]*?const candidate = candidates\.find\(c => c\.slug === slug\);[\s\S]*?if \(!candidate\)/);
  // Sahiplik tanımı YENİDEN YAZILMAZ — sitenin mevcut tanımından okunur.
  assert.match(consultantsSrc, /fetchOwnArchitectRows/);
});

await test('randevu kapısı yalnızca ONAYLI satırı tanır', () => {
  assert.match(consultantsSrc, /WHERE architect_slug = \? AND status = 'approved'/);
  // Üç randevu yolu da kapıdan geçer.
  const gates = consultationsSrc.match(/fetchApprovedConsultant\(env, /g) || [];
  assert.ok(gates.length >= 3, `randevu yollarının hepsi kapıdan geçmiyor (${gates.length} çağrı)`);
  // Eski kod sabiti bir KAPI olarak kalmamalı.
  assert.ok(!/ALLOWED_HOST_SLUGS\.has\(/.test(consultationsSrc), 'eski sabit-Set kapısı hâlâ kullanılıyor');
});

console.log('\n3 — Teklif doğrulaması tek kaynakta');

await test('süre yalnızca 30/45/60 olabilir', () => {
  assert.deepEqual(CONSULTANT_DURATIONS, [30, 45, 60]);
  for (const d of [30, 45, 60]) {
    const r = normalizeConsultantOffer({ durationMin: d, priceTry: 100, weekdays: [1], times: ['18:00'], expertise: 'x'.repeat(40) });
    assert.ok(r.ok, `${d} dk reddedildi`);
  }
  for (const bad of [20, 50, 90, 0, null, '45x']) {
    assert.equal(normalizeConsultantOffer({ durationMin: bad, priceTry: 100, weekdays: [1], times: ['18:00'], expertise: 'x'.repeat(40) }).ok, false, `${bad} kabul edildi`);
  }
  // SQL tarafındaki kopya da aynı listeyi tutmalı.
  assert.match(migration, /CHECK \(duration_min IN \(30, 45, 60\)\)/);
  assert.match(schema, /CHECK \(duration_min IN \(30, 45, 60\)\)/);
});

await test('gün/saat/uzmanlık boş bırakılamaz, ücret negatif olamaz', () => {
  const base = { durationMin: 45, priceTry: 500, weekdays: [1], times: ['18:00'], expertise: 'x'.repeat(40) };
  assert.equal(normalizeConsultantOffer({ ...base, weekdays: [] }).ok, false);
  assert.equal(normalizeConsultantOffer({ ...base, times: [] }).ok, false);
  assert.equal(normalizeConsultantOffer({ ...base, expertise: 'kısa' }).ok, false);
  assert.equal(normalizeConsultantOffer({ ...base, priceTry: -5 }).ok, false);
  // 0 TL serbest (ücretsiz danışmanlık).
  assert.equal(normalizeConsultantOffer({ ...base, priceTry: 0 }).ok, true);
  // Listede olmayan saat sessizce elenir; hepsi elenirse hata.
  assert.equal(normalizeConsultantOffer({ ...base, times: ['03:33'] }).ok, false);
});

await test('form seçenekleri SUNUCUDAN çizilir (sayfada ikinci bir kopya yok)', () => {
  const pageCode = page.replace(/<!--[\s\S]*?-->/g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  assert.match(page, /options\.durations/);
  assert.match(page, /options\.times/);
  assert.match(page, /options\.weekdays/);
  // Süre/saat listeleri sayfaya gömülmemeli.
  assert.ok(!/\[\s*30\s*,\s*45\s*,\s*60\s*\]/.test(pageCode), 'süre listesi sayfaya gömülmüş');
  for (const t of CONSULTANT_TIME_SLOTS) {
    assert.ok(!pageCode.includes(`'${t}'`), `saat '${t}' sayfaya gömülmüş`);
  }
  assert.match(consultationsSrc, /function consultantFormOptions\(\)/);
});

await test('sayfa dört alanı da topluyor (süre, ücret, gün+saat, uzmanlık)', () => {
  assert.match(page, /id="duration-row"/);
  assert.match(page, /id="f-price"/);
  assert.match(page, /id="weekday-row"/);
  assert.match(page, /id="time-row"/);
  assert.match(page, /id="f-expertise"/);
  // "hali hazırda kişi profilleri varsa bunu seçebilsinler ve bilgiler otomatik doldurulsun"
  assert.match(page, /id="who-grid"/);
  assert.match(page, /function fillFromApplication\(\)/);
  // Kişi kaydı yoksa kullanıcı /kisi-ekle'ye yönlendirilir (yapısal zorunluluk).
  assert.match(page, /href="\/kisi-ekle"/);
});

console.log('\n4 — Süre randevuya yazılır (geçmiş randevular kaymaz)');

await test('rezervasyon süre ve ücreti TALEBE yazar (istemciden almaz)', () => {
  assert.match(consultationsSrc, /INSERT INTO consultation_requests[\s\S]*?duration_min/);
  assert.match(consultationsSrc, /consultant\.priceTry, consultant\.durationMin/);
  assert.match(migration, /ALTER TABLE consultation_requests ADD COLUMN duration_min INTEGER NOT NULL DEFAULT 45/);
});

await test('Meet penceresi ve etkinlik süresi TALEBİN kolonundan okunur', () => {
  // Üç kullanım da tek yardımcıdan geçmeli (biri unutulursa 30 dk'lık görüşme 45 dk'lık etkinlik açar).
  assert.ok(!/CONSULTATION_DURATION_MIN \* 60 \* 1000/.test(meetSrc), 'pencere hâlâ sabit süreyi kullanıyor');
  const uses = meetSrc.match(/consultationDurationMin\(row\)/g) || [];
  assert.ok(uses.length >= 3, `süre yardımcısı her yerde kullanılmıyor (${uses.length})`);
  // Gerçek hesap: 30 dakikalık bir randevunun penceresi 30 dakika olmalı.
  const row = { requested_date: '2099-01-07', requested_time: '18:00', duration_min: 30 };
  const win = meetingWindow(row, Date.parse('2099-01-07T15:00:00Z'));
  assert.equal((win.endsAt - win.startsAt) / 60000, 30);
  assert.equal(consultationDurationMin({}), DEFAULT_OFFER.durationMin, 'kolon yoksa varsayılana düşmeli');
});

console.log('\n5 — Slot kontrolü danışmanın KENDİ gün/saatlerine bakar');

await test('isAllowedSlot danışmanın teklifini kullanır', () => {
  const far = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
  // Danışmanın seçtiği güne kadar ilerle (Salı = getUTCDay 2).
  while (far.getUTCDay() !== 2) far.setUTCDate(far.getUTCDate() + 1);
  const iso = far.toISOString().slice(0, 10);
  const tuesdayOnly = { weekdays: [2], times: ['10:00'] };
  assert.equal(isAllowedSlot(tuesdayOnly, iso, '10:00'), true, 'danışmanın kendi günü/saati reddedildi');
  assert.equal(isAllowedSlot(tuesdayOnly, iso, '18:00'), false, 'teklifte olmayan saat kabul edildi');
  // Varsayılan teklif Salı'yı kapsamaz — yani kontrol GERÇEKTEN parametreye bakıyor.
  assert.equal(isAllowedSlot(DEFAULT_OFFER, iso, '18:00'), false, 'varsayılan teklif Salı\'yı kabul etti');
});

await test('publicOffer üç uçta da AYNI şekli döner', () => {
  const shape = publicOffer(parseConsultantRow({
    architect_slug: 's', duration_min: 60, price_try: 2000, weekdays: '[0,6]', times: '["09:00"]', status: 'approved',
  }));
  assert.deepEqual(Object.keys(shape).sort(), ['durationMin', 'priceTry', 'times', 'timezone', 'weekdays']);
  assert.equal(shape.durationMin, 60);
  assert.deepEqual(shape.weekdays, [0, 6]);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) {
  console.error('\nBAŞARISIZ:');
  failures.forEach(f => console.error(`  - ${f.name}: ${f.message}`));
  process.exit(1);
}
