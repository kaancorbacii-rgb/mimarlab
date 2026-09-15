#!/usr/bin/env node
// DANIŞMANLIK ÖDEME SEÇENEKLERİ — BİRİM TESTLERİ
// (kullanıcı isteği, 2026-09-13: "Danışmanlık Al ekranı için ödeme seçeneklerini geri getir".
//  Seçilen yöntemler: iyzico kart + havale/EFT. Seçilen akış: önce talep, sonra ödeme.)
//
// Bu turda kelepçelenen şeyler, hepsi SESSİZCE geri alınabilecek türden:
//
//   1. IBAN KAYNAK KODA GERİ SIZMASIN. 2026-09-08'de "IBAN bilgilerini siteden sil" denmişti.
//      Ödeme geri gelirken hesap bilgisi bilerek SIRLARA taşındı (src/lib/bankTransfer.js); biri
//      kolaylık olsun diye HTML/JS'e bir TR IBAN'ı yapıştırırsa bu test patlar.
//   2. "ÖDEMEYİ YAPTIM" BİR BEYANDIR. Sunucu havalede payment_status'u 'declared' yapar, ASLA
//      'paid'. 'paid' yalnızca iyzico'nun sunucu-sunucu doğrulamasından gelir.
//   3. ÖDEME TALEBİ OTOMATİK ONAYLAMAZ. Başarılı kart ödemesi bile status'u 'approved' yapmaz —
//      Meet odasının kurulduğu kapı admin onayıdır (bkz. src/lib/consultationMeet.js akışı).
//      Bu kapı sessizce kayarsa ödemesi geçen herkes kendiliğinden takvime düşerdi.
//   4. TUTAR İSTEMCİDEN ALINMAZ. Fiyat talebin D1'deki price_try'ından okunur.
//   5. İKİ ÖDEME UZAYI ÇAKIŞMAZ. Rozet ve danışmanlık AYNI iyzico callback'ini paylaşır; ayrım
//      conversationId önekiyle yapılır ve callback'in danışmanlık dalı rozet tablosuna YAZMAZ.
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

const consultations = read('src/routes/consultations.js');
const payments = read('src/routes/payments.js');
const bankTransfer = read('src/lib/bankTransfer.js');
const modal = read('js/components/consultation-modal.js');
const detailModal = read('js/components/consultation-detail-modal.js');
const migration = read('migrations/0117_consultation_payment.sql');
const schema = read('schema.sql');

console.log('\n1 — IBAN kaynak kodda DEĞİL, yalnızca sırlarda');

await test('hiçbir istemci/sunucu dosyasında gömülü TR IBAN yok', () => {
  // TR + 24 hane (boşluklu yazımlar dâhil). bankTransfer.js'in KENDİSİ de muaf değil: orada da
  // yalnızca env okuması ve biçim doğrulaması olmalı, örnek bir gerçek IBAN bile durmamalı.
  const ibanLike = /TR[\s]?\d{2}(?:[\s]?\d{4}){5}[\s]?\d{2}/;
  for (const [name, src] of [
    ['src/lib/bankTransfer.js', bankTransfer],
    ['src/routes/consultations.js', consultations],
    ['js/components/consultation-modal.js', modal],
    ['js/components/consultation-detail-modal.js', detailModal],
    ['satin-al.html', read('satin-al.html')],
    ['kisi.html', read('kisi.html')],
  ]) {
    assert.ok(!ibanLike.test(src), `${name} içinde gömülü bir IBAN var — hesap bilgisi YALNIZCA PAYMENT_IBAN sırrından okunmalı`);
  }
});

await test('hesap bilgisi üç sırdan okunur ve eksikse yöntem HİÇ sunulmaz', () => {
  assert.match(bankTransfer, /env\.PAYMENT_IBAN\b/);
  assert.match(bankTransfer, /env\.PAYMENT_IBAN_NAME/);
  assert.match(bankTransfer, /env\.PAYMENT_BANK_NAME/);
  // isBankTransferConfigured hem IBAN biçimini hem hesap adını şart koşar — yarı yapılandırılmış
  // "IBAN yok ama Ödemeyi Yaptım var" durumu oluşamaz.
  assert.match(bankTransfer, /export function isBankTransferConfigured[\s\S]*IBAN_RE\.test[\s\S]*PAYMENT_IBAN_NAME/);
  // Sunucu, havale isteğini de bu kapıdan geçirir (yalnızca arayüzü gizlemek YETMEZ).
  assert.match(consultations, /if \(!isBankTransferConfigured\(env\)\) return errorJson/);
});

console.log('\n2 — "Ödemeyi Yaptım" bir BEYANDIR, doğrulama değil');

await test("havale dalı payment_status'u 'declared' yazar, 'paid' YAZMAZ", () => {
  const havaleBranch = consultations.slice(
    consultations.indexOf("if (method === 'havale')"),
    consultations.indexOf("if (method !== 'iyzico')"),
  );
  assert.ok(havaleBranch.length > 100, 'havale dalı bulunamadı');
  assert.match(havaleBranch, /payment_status = 'declared'/);
  assert.ok(!/payment_status = 'paid'/.test(havaleBranch), "havale dalı ASLA 'paid' yazmamalı");
});

await test("'paid' yalnızca iyzico callback'inin doğruladığı yoldan yazılır", () => {
  const paidWrites = [...consultations.matchAll(/payment_status = 'paid'/g)];
  assert.equal(paidWrites.length, 1, "tam olarak tek bir 'paid' yazımı olmalı (settleConsultationPayment)");
  const settle = consultations.slice(consultations.indexOf('export async function settleConsultationPayment'));
  assert.match(settle, /payment_status = 'paid'/);
  // İdempotency: koşullu UPDATE olmadan çift callback ikinci bir bildirim gönderirdi.
  assert.match(settle, /WHERE id = \? AND payment_status != 'paid'/);
});

console.log('\n3 — ödeme, talebi OTOMATİK onaylamaz (Meet kapısı admin\'de kalır)');

await test('ödeme yollarının hiçbiri consultation_requests.status\'u approved yapmaz', () => {
  // Ödeme bölümünün tamamı taranır: burada status'a yapılan TEK yazım olmamalı.
  const paySection = consultations.slice(consultations.indexOf('async function startConsultationPayment'));
  assert.ok(!/SET[^;]*\bstatus\s*=\s*'approved'/.test(paySection), 'ödeme yolu talebi kendiliğinden onaylıyor');
  assert.ok(!/createMeetForConsultation/.test(paySection), 'ödeme yolu doğrudan Meet oluşturuyor — kapı admin onayı olmalı');
});

await test('ödeme yolu, başarısız kartta randevuyu iptal etmez', () => {
  const paySection = consultations.slice(
    consultations.indexOf('async function startConsultationPayment'),
    consultations.indexOf('export async function settleConsultationPayment'),
  );
  // Rozet akışından bilinçli FARK: orada satır ödemenin kendisidir, burada satır RANDEVUDUR.
  assert.ok(!/status\s*=\s*'rejected'/.test(paySection), 'kart denemesi randevuyu reddediyor');
  assert.ok(!/status\s*=\s*'cancelled'/.test(paySection), 'kart denemesi randevuyu iptal ediyor');
});

console.log('\n4 — tutar ve yetki sunucuda');

await test('tutar D1 satırından okunur, istemci gövdesinden ALINMAZ', () => {
  assert.match(consultations, /const price = Number\(row\.price_try \|\| CONSULTATION_PRICE_TRY\);/);
  assert.ok(!/body\.price|body\.priceTry|body\.amount/.test(consultations), 'tutar istemci gövdesinden okunuyor');
});

await test('ödeme yalnızca talebin SAHİBİ tarafından başlatılabilir', () => {
  assert.match(consultations, /if \(!row \|\| row\.user_id !== user\.id\) return errorJson/);
});

await test('ödenmiş talep ikinci kez ödetilmez', () => {
  assert.match(consultations, /if \(row\.payment_status === 'paid'\) return errorJson/);
  assert.match(consultations, /function isPayableStatus[\s\S]*payment_status !== 'paid'/);
});

console.log('\n5 — rozet ve danışmanlık ödeme uzayları çakışmaz');

await test('callback, danışmanlık dalını conversationId önekiyle ayırır', () => {
  assert.match(consultations, /export const CONSULTATION_CONVERSATION_PREFIX = 'cns_';/);
  assert.match(payments, /conversationId\.startsWith\(CONSULTATION_CONVERSATION_PREFIX\)/);
  // Danışmanlık dalı badge_requests'e DOKUNMAZ ve kendi yönlendirmesini yapar.
  const branch = payments.slice(
    payments.indexOf('if (conversationId.startsWith(CONSULTATION_CONVERSATION_PREFIX))'),
    payments.indexOf('const row = await env.DB.prepare('),
  );
  assert.ok(!/badge_requests/.test(branch), 'danışmanlık dalı rozet tablosuna yazıyor');
  assert.match(branch, /consultation_payment=\$\{paid \? 'success' : 'failed'\}/);
});

await test('TC/GSM doğrulaması iki akışta da TEK kaynaktan gelir', () => {
  // Kopyalanmış ikinci bir checksum, iki akışın sessizce ayrışacağı yerdir.
  const buyer = read('src/lib/iyzicoBuyer.js');
  assert.match(buyer, /export function isValidTcKimlik/);
  assert.match(buyer, /export function normalizeGsm/);
  for (const [name, src] of [['payments.js', payments], ['consultations.js', consultations]]) {
    assert.match(src, /from '\.\.\/lib\/iyzicoBuyer\.js'/, `${name} paylaşılan lib'i import etmeli`);
    assert.ok(!/^function isValidTcKimlik/m.test(src), `${name} kendi TC checksum kopyasını taşıyor`);
  }
});

console.log('\n6 — şema ve arayüz');

await test('migration ve schema.sql aynı dört kolonu tanımlar', () => {
  for (const col of ['payment_status', 'payment_token', 'payment_id', 'paid_at']) {
    assert.match(migration, new RegExp(`ADD COLUMN ${col}\\b`), `migration'da ${col} yok`);
  }
  const table = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS consultation_requests'));
  const body = table.slice(0, table.indexOf(');'));
  for (const col of ['payment_status', 'payment_token', 'payment_id', 'paid_at']) {
    assert.ok(body.includes(col), `schema.sql#consultation_requests içinde ${col} yok`);
  }
});

await test('modal dört ekranlı: book -> pay -> payment -> success', () => {
  assert.match(modal, /id="cns-screen-payment"/);
  assert.match(modal, /paymentScreen\.style\.display = name === 'payment'/);
  // "önce talep, sonra ödeme": ödeme ekranına ancak talep AÇILDIKTAN sonra (state.requestId
  // dolduktan sonra) geçilir.
  // Pencere 2026-09-15'te genişletildi: aradaki gerekçe yorumu uzadı, iddia (talep AÇILDIKTAN
  // sonra ödeme ekranı) değişmedi.
  assert.match(modal, /state\.requestId = data\.id;[\s\S]{0,1400}showPaymentScreen\(\)/);
});

await test('yöntemlerin SEÇİLEBİLİRLİĞİNE sunucu karar verir (görünürlük ayrı soru)', () => {
  // 2026-09-15: iki seçenek de HER ZAMAN çizilir (kullanıcı isteği), ama hangisinin SEÇİLEBİLİR
  // olduğu hâlâ yalnızca sunucunun bayraklarından belirlenir — istemci kendi kararını vermez.
  assert.match(modal, /enabled: !!p\.bankTransfer/);
  assert.match(modal, /enabled: !!p\.iyzico/);
  assert.match(modal, /function availableMethods\(\) \{\s*\n\s*return methodEntries\(\)\.filter\(e => e\.enabled\)/);
  // Ödeme ekranı artık KOŞULSUZ açılır; aktif yöntem yoksa gönder düğmesi kapalı kalır.
  assert.match(modal, /if \(state\.payment\) \{\s*\n\s*showPaymentScreen\(\);/);
  assert.match(modal, /pmSubmitBtn\.disabled = true;\s*\n\s*pmSubmitBtn\.textContent = 'Ödeme şu anda alınamıyor';/);
});

await test('"Daha sonra öde" diyen kullanıcı ödemeyi detay ekranından tamamlayabilir', () => {
  assert.match(modal, /openPayment\(opts\) \{ ensurePopup\(\)\.openPayment\(opts\); \}/);
  assert.match(detailModal, /id="cnd-pay-btn"/);
  assert.match(detailModal, /ConsultationModal\.openPayment\(\{/);
  // canPay sunucudan gelir — istemci "ödenebilir mi"ye kendi karar vermez.
  assert.match(detailModal, /if \(!data\.canPay \|\| !data\.payment\) return '';/);
  assert.match(consultations, /canPay: isBuyer && isPayableStatus\(row\)/);
});

await test('havale hesabı yalnızca ALICIYA ve yalnızca ödenebilir durumda döner', () => {
  // paymentOptions artık talebin KENDİ fiyatını alır (fiyat danışman başına — 2026-09-15).
  assert.match(consultations, /payment: isBuyer && isPayableStatus\(row\)\s*\n\s*\? \{ \.\.\.paymentOptions\(env, row\.price_try\), account: getBankTransferAccount\(env\)/);
});

await test('onay metni artık "onaylanmıştır" demez (talep pending\'dir)', () => {
  // Ödemesiz akış için yazılmış eski metin, hiç gerçekleşmeyecek bir onayı vaat ediyordu.
  const success = modal.slice(modal.indexOf('function showSuccessScreen'));
  assert.ok(!/görüşmeniz onaylanmıştır/.test(success), 'eski "onaylanmıştır" metni geri gelmiş');
  assert.match(success, /randevu talebin alındı/);
});

console.log(`\n${failed ? 'BAŞARISIZ' : 'TAMAM'} — ${passed} geçti, ${failed} kaldı`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
