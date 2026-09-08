#!/usr/bin/env node
// FİRMA/MARKA ÜYELİK LİSTESİ — İKİ YÜZEYİN ORTAK BİRLEŞTİRİCİSİ (kullanıcı isteği, 2026-09-08:
// "Bir kişi bir firma veya markaya admin tarafından dahi olsa görevlendiriliyorsa kişi ekle/düzenle
// sayfasında da profilini düzenle sayfasında olduğu gibi firma ve marka bilgileri gözüksün").
//
// Regresyon: "MİMARLAB Robotu" — iki onaylı profile_claims('office') satırı + office_founders bağı,
// ama kişi kaydının `office` metni NULL. Profili Düzenle (auth-modal.js) talepleri okuduğu için iki
// firma gösteriyor, kisi-ekle.html yalnızca kaydın `office` metnini okuduğu için kutu BOŞ açılıyordu.
// Kaydet'e basılsa canonicalSync#syncOfficeFounderLink form metninde olmayan bağı da silecekti.
//
// Test koşucusu/npm bağımlılığı yok (scripts/test-2026-09-08-round.mjs ile aynı desen). office-picker.js
// tarayıcı IIFE'si olduğundan node:vm ile sahte bir `window` altında yüklenir; DOM'a yalnızca
// createOfficePicker çağrısında dokunur, o çağrılmaz.
//
// KAPSAM:
//   1. dört kaynağın birleşimi (kayıt metni, kanonik founders, officeLinks, talepler)
//   2. reddedilmiş talepler ve unregistered founders DIŞARIDA
//   3. Türkçe casefold tekilleştirme ve sıra (kayıt metninin ilk adı = birincil firma korunur)
//   4. kaynak sözleşmesi: kisi-ekle.html'in ÜÇ ön-doldurma yolu ve auth-modal.js#prefillFirmaSelect
//      aynı yardımcıyı çağırıyor (biri sapınca iki sayfa yine ayrışır)

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 4).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

const root = new URL('../', import.meta.url);
const pickerSrc = readFileSync(new URL('office-picker.js', root), 'utf8');
const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.runInNewContext(pickerSrc, sandbox, { filename: 'office-picker.js' });
// vm bağlamının Array prototipi ana alandan farklı — assert/strict deepEqual bunu "not reference-equal"
// diye reddeder; sonuç ana alana kopyalanır (davranış değişmez).
const mergeRaw = sandbox.window.mergeOfficeMembershipNames;
const merge = (src) => Array.from(mergeRaw(src));

section('1) dört kaynağın birleşimi');
test('yardımcı window\'a yazılıyor (kisi-ekle.html inline script ve auth-modal.js global olarak çağırır)', () => {
  assert.equal(typeof mergeRaw, 'function');
  assert.equal(typeof sandbox.window.createOfficePicker, 'function');
});
test('MİMARLAB Robotu senaryosu: office metni NULL, talepler + founders bağı → iki firma', () => {
  const names = merge({
    officeTexts: [null, undefined, ''],
    offices: [{ name: 'Deneme Firması', loc: 'İstanbul' }],
    officeLinks: [{ name: 'Deneme Firması', slug: 'deneme-firmasi', role: 'Ekip Üyesi', canEdit: false }],
    claims: [
      { profile_type: 'office', profile_key: 'Deneme Firması', status: 'approved', officePosition: 'Yönetici' },
      { profile_type: 'office', profile_key: 'MİMARLAB', status: 'approved', officePosition: 'Ekip Üyesi' },
    ],
  });
  assert.deepEqual(names, ['Deneme Firması', 'MİMARLAB']);
});
test('yalnızca kayıt metni (virgüllü) → bölünür, kırpılır', () => {
  assert.deepEqual(merge({ officeTexts: [' A Mimarlık ,B Tasarım Studio, '] }), ['A Mimarlık', 'B Tasarım Studio']);
});
test('boş/eksik kaynaklar → boş liste, hata yok', () => {
  assert.deepEqual(merge({}), []);
  assert.deepEqual(merge(undefined), []);
  assert.deepEqual(merge({ officeTexts: null, offices: null, officeLinks: null, claims: null }), []);
});

section('2) dışarıda kalanlar');
test('reddedilmiş talep listeye GİRMEZ, beklemedeki GİRER', () => {
  const names = merge({ claims: [
    { profile_type: 'office', profile_key: 'Red Firma', status: 'rejected' },
    { profile_type: 'office', profile_key: 'Bekleyen Firma', status: 'pending' },
    { profile_type: 'architect', profile_key: 'Bir Kişi', status: 'approved' },
  ] });
  assert.deepEqual(names, ['Bekleyen Firma']);
});
test('kayıtsız (unregistered) founders adı GİRMEZ — picker yalnızca kayıtlı adları listeler', () => {
  const names = merge({ offices: [{ name: 'Kayıtlı Firma' }, { name: 'Serbest Metin Firma', unregistered: true }, null] });
  assert.deepEqual(names, ['Kayıtlı Firma']);
});

section('3) tekilleştirme ve sıra');
test('Türkçe casefold: "MİMARLAB" / "Mimarlab" / "mimarlab" tek ad, İLK yazım korunur', () => {
  const names = merge({
    officeTexts: ['MİMARLAB'],
    offices: [{ name: 'Mimarlab' }],
    claims: [{ profile_type: 'office', profile_key: 'mimarlab', status: 'approved' }],
  });
  assert.deepEqual(names, ['MİMARLAB']);
});
test('kayıt metninin ilk adı listenin başında kalır (canonicalSync#syncArchitect birincil firmayı ilk addan alır)', () => {
  const names = merge({
    claims: [{ profile_type: 'office', profile_key: 'Talep Firma', status: 'approved' }],
    officeLinks: [{ name: 'Bağ Firma' }],
    offices: [{ name: 'Founders Firma' }],
    officeTexts: ['Birincil Firma, İkinci Firma'],
  });
  assert.deepEqual(names, ['Birincil Firma', 'İkinci Firma', 'Founders Firma', 'Bağ Firma', 'Talep Firma']);
});

section('4) kaynak sözleşmesi — iki yüzey aynı yardımcıyı çağırıyor');
const kisiEkle = readFileSync(new URL('kisi-ekle.html', root), 'utf8');
const authModal = readFileSync(new URL('js/components/auth-modal.js', root), 'utf8');
test('kisi-ekle.html: applyOfficeMemberships mergeOfficeMembershipNames\'i çağırıyor', () => {
  assert.match(kisiEkle, /function applyOfficeMemberships\(/);
  assert.match(kisiEkle, /mergeOfficeMembershipNames\(\{ officeTexts, offices, officeLinks: account\.officeLinks, claims: account\.claims \}\)/);
});
test('kisi-ekle.html: üç ön-doldurma yolu da applyOfficeMemberships\'ten geçiyor, #m-office\'e doğrudan yazan eski satır kalmadı', () => {
  const calls = kisiEkle.match(/await applyOfficeMemberships\(/g) || [];
  assert.equal(calls.length, 3, `applyOfficeMemberships çağrı sayısı ${calls.length}, 3 bekleniyordu`);
  assert.doesNotMatch(kisiEkle, /getElementById\('m-office'\)\.value = (merged|item)\.office/);
});
test('kisi-ekle.html: hesap kaynakları yalnızca kişinin KENDİ profilinde eklenir (own kapısı) ve ?edit= yolunda editId ölçüt değil', () => {
  assert.match(kisiEkle, /own: mineMatched \|\| await isOwnAccountProfile\(nameInput\.value\)/);
  assert.match(kisiEkle, /own: await isOwnAccountProfile\(item\.name\)/);
  assert.match(kisiEkle, /const account = own \? await fetchMyMembershipSources\(\) : \{ claims: \[\], officeLinks: \[\] \};/);
});
test('kisi-ekle.html: /api/architect/:key yanıtının üst düzey `offices` dizisi okunuyor (item.office yalnızca birincil firma)', () => {
  assert.match(kisiEkle, /canonicalOffices = canonicalData\.offices \|\| \[\]/);
  assert.match(kisiEkle, /return data\.offices \|\| \[\];/);
});
test('auth-modal.js#prefillFirmaSelect: aynı yardımcı, officeLinks ÜÇÜNCÜ kaynak olarak veriliyor', () => {
  assert.match(authModal, /mergeOfficeMembershipNames\(\{ officeTexts: \[arch && arch\.office\], officeLinks: myOfficeLinks, claims \}\)/);
});
test('office-picker.js js/components/lazy-modals.js\'te auth-modal.js\'in deps listesinde (yardımcı modülden ÖNCE yüklenir)', () => {
  const lazy = readFileSync(new URL('js/components/lazy-modals.js', root), 'utf8');
  assert.match(lazy, /deps: \[[^\]]*'office-picker\.js'[^\]]*\]/);
  assert.match(kisiEkle, /<script src="office-picker\.js"><\/script>/);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(`- ${f.name}: ${f.message.split('\n')[0]}`); process.exit(1); }
