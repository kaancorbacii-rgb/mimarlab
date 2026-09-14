#!/usr/bin/env node
// FİRMA/MARKA ÜYELİK LİSTESİ — İKİ YÜZEYİN ORTAK BİRLEŞTİRİCİSİ (kullanıcı isteği, 2026-09-08:
// "Bir kişi bir firma veya markaya admin tarafından dahi olsa görevlendiriliyorsa kişi ekle/düzenle
// sayfasında da profilini düzenle sayfasında olduğu gibi firma ve marka bilgileri gözüksün").
//
// Regresyon 1: "MİMARLAB Robotu" — office_founders bağı var ama kişi kaydının `office` metni NULL.
// kisi-ekle.html yalnızca kaydın `office` metnini okuduğu için kutu BOŞ açılıyordu; Kaydet'e basılsa
// canonicalSync#syncOfficeFounderLink form metninde olmayan bağı da silecekti.
//
// Regresyon 2 (kullanıcı bildirimi, 2026-09-14): "Birçok firmada Yönetici rolünde olan
// warchdb@gmail.com hesabıyla Kaan Çorbacı profilini düzenledim ve otomatik olarak o hesabın
// yönetici olduğu diğer 2 firma Kaan Çorbacı'nın profilinde gözükmeye başladı." Kök neden: bu
// birleştirici hesabın profile_claims('office') satırlarını da "görev" sayıyordu — oysa o satır
// yalnızca YETKİdir (bkz. src/routes/admin.js#normalizeOfficePosition). Artık KAYNAK DEĞİL.
//
// Test koşucusu/npm bağımlılığı yok (scripts/test-2026-09-08-round.mjs ile aynı desen). office-picker.js
// tarayıcı IIFE'si olduğundan node:vm ile sahte bir `window` altında yüklenir; DOM'a yalnızca
// createOfficePicker çağrısında dokunur, o çağrılmaz.
//
// KAPSAM:
//   1. ÜÇ YAPISAL kaynağın birleşimi (kayıt metni, kanonik founders, officeLinks)
//   2. profile_claims ve unregistered founders DIŞARIDA
//   3. Türkçe casefold tekilleştirme ve sıra (kayıt metninin ilk adı = birincil firma korunur)
//   4. kaynak sözleşmesi: kisi-ekle.html'in ÜÇ ön-doldurma yolu ve auth-modal.js#prefillFirmaSelect
//      aynı yardımcıyı çağırıyor (biri sapınca iki sayfa yine ayrışır)
//   5. Regresyon 2 — yönetici yetkisi kişinin firma listesine SIZMIYOR

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

section('1) üç yapısal kaynağın birleşimi');
test('yardımcı window\'a yazılıyor (kisi-ekle.html inline script ve auth-modal.js global olarak çağırır)', () => {
  assert.equal(typeof mergeRaw, 'function');
  assert.equal(typeof sandbox.window.createOfficePicker, 'function');
});
test('MİMARLAB Robotu senaryosu: office metni NULL, founders bağı → firma yine görünür', () => {
  const names = merge({
    officeTexts: [null, undefined, ''],
    offices: [{ name: 'Deneme Firması', loc: 'İstanbul' }],
    officeLinks: [{ name: 'MİMARLAB', slug: 'mimarlab', role: 'Ekip Lideri', canEdit: false }],
  });
  assert.deepEqual(names, ['Deneme Firması', 'MİMARLAB']);
});
test('yalnızca kayıt metni (virgüllü) → bölünür, kırpılır', () => {
  assert.deepEqual(merge({ officeTexts: [' A Mimarlık ,B Tasarım Studio, '] }), ['A Mimarlık', 'B Tasarım Studio']);
});
test('boş/eksik kaynaklar → boş liste, hata yok', () => {
  assert.deepEqual(merge({}), []);
  assert.deepEqual(merge(undefined), []);
  assert.deepEqual(merge({ officeTexts: null, offices: null, officeLinks: null }), []);
});

section('2) dışarıda kalanlar');
test('profile_claims HİÇBİR durumda listeye girmez (onaylı/beklemede/reddedilmiş)', () => {
  const names = merge({ claims: [
    { profile_type: 'office', profile_key: 'Onaylı Firma', status: 'approved' },
    { profile_type: 'office', profile_key: 'Bekleyen Firma', status: 'pending' },
    { profile_type: 'office', profile_key: 'Red Firma', status: 'rejected' },
    { profile_type: 'architect', profile_key: 'Bir Kişi', status: 'approved' },
  ] });
  assert.deepEqual(names, []);
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
    officeLinks: [{ name: 'mimarlab' }],
  });
  assert.deepEqual(names, ['MİMARLAB']);
});
test('kayıt metninin ilk adı listenin başında kalır (canonicalSync#syncArchitect birincil firmayı ilk addan alır)', () => {
  const names = merge({
    officeLinks: [{ name: 'Bağ Firma' }],
    offices: [{ name: 'Founders Firma' }],
    officeTexts: ['Birincil Firma, İkinci Firma'],
  });
  assert.deepEqual(names, ['Birincil Firma', 'İkinci Firma', 'Founders Firma', 'Bağ Firma']);
});

section('4) kaynak sözleşmesi — iki yüzey aynı yardımcıyı çağırıyor');
const kisiEkle = readFileSync(new URL('kisi-ekle.html', root), 'utf8');
const authModal = readFileSync(new URL('js/components/auth-modal.js', root), 'utf8');
test('kisi-ekle.html: applyOfficeMemberships mergeOfficeMembershipNames\'i çağırıyor', () => {
  assert.match(kisiEkle, /function applyOfficeMemberships\(/);
  assert.match(kisiEkle, /mergeOfficeMembershipNames\(\{ officeTexts, offices, officeLinks: account\.officeLinks \}\)/);
});
test('kisi-ekle.html: üç ön-doldurma yolu da applyOfficeMemberships\'ten geçiyor, #m-office\'e doğrudan yazan eski satır kalmadı', () => {
  const calls = kisiEkle.match(/await applyOfficeMemberships\(/g) || [];
  assert.equal(calls.length, 3, `applyOfficeMemberships çağrı sayısı ${calls.length}, 3 bekleniyordu`);
  assert.doesNotMatch(kisiEkle, /getElementById\('m-office'\)\.value = (merged|item)\.office/);
});
test('kisi-ekle.html: hesap kaynakları yalnızca kişinin KENDİ profilinde eklenir (own kapısı) ve ?edit= yolunda editId ölçüt değil', () => {
  assert.match(kisiEkle, /own: mineMatched \|\| await isOwnAccountProfile\(nameInput\.value\)/);
  assert.match(kisiEkle, /own: await isOwnAccountProfile\(item\.name\)/);
  assert.match(kisiEkle, /const account = own \? await fetchMyMembershipSources\(\) : \{ officeLinks: \[\] \};/);
});
test('kisi-ekle.html: /api/architect/:key yanıtının üst düzey `offices` dizisi okunuyor (item.office yalnızca birincil firma)', () => {
  assert.match(kisiEkle, /canonicalOffices = canonicalData\.offices \|\| \[\]/);
  assert.match(kisiEkle, /return data\.offices \|\| \[\];/);
});
test('auth-modal.js#prefillFirmaSelect: aynı yardımcı, kutuya talep DEĞİL yalnızca officeLinks gidiyor', () => {
  assert.match(authModal, /mergeOfficeMembershipNames\(\{ officeTexts: \[arch && arch\.office\], officeLinks: myOfficeLinks \}\)/);
});
test('office-picker.js js/components/lazy-modals.js\'te auth-modal.js\'in deps listesinde (yardımcı modülden ÖNCE yüklenir)', () => {
  const lazy = readFileSync(new URL('js/components/lazy-modals.js', root), 'utf8');
  assert.match(lazy, /deps: \[[^\]]*'office-picker\.js'[^\]]*\]/);
  assert.match(kisiEkle, /<script src="office-picker\.js"><\/script>/);
});

section('5) regresyon — yönetici yetkisi kişinin firma listesine SIZMIYOR (2026-09-14)');
test('n firmanın yöneticisi olan hesap, YAPISAL bağı olmayan firmaları kutuya taşımaz', () => {
  // warchdb@gmail.com: MİMARLAB + Foster + Partners + Renzo Piano Building Workshop için onaylı
  // profile_claims('office'); Kaan Çorbacı kaydının GERÇEK bağı yalnızca MİMARLAB.
  const names = merge({
    officeTexts: ['MİMARLAB'],
    offices: [{ name: 'MİMARLAB' }],
    officeLinks: [{ name: 'MİMARLAB', slug: 'mimarlab', role: 'Kurucu', canEdit: true }],
    claims: [
      { profile_type: 'office', profile_key: 'MİMARLAB', status: 'approved', officePosition: 'Yönetici' },
      { profile_type: 'office', profile_key: 'Foster + Partners', status: 'approved', officePosition: 'Yönetici' },
      { profile_type: 'office', profile_key: 'Renzo Piano Building Workshop', status: 'approved', officePosition: 'Yönetici' },
    ],
  });
  assert.deepEqual(names, ['MİMARLAB']);
});
test('yönetici, bağı hiç olmayan bir kişiyi düzenlerken kutu BOŞ açılır (kendi firmaları sızmaz)', () => {
  const names = merge({
    officeTexts: [null],
    offices: [],
    officeLinks: [],
    claims: [
      { profile_type: 'office', profile_key: 'Foster + Partners', status: 'approved', officePosition: 'Yönetici' },
      { profile_type: 'office', profile_key: 'Renzo Piano Building Workshop', status: 'pending' },
    ],
  });
  assert.deepEqual(names, []);
});
test('office-picker.js: claims filtresi koddan tamamen kalktı (sessizce geri gelmesin)', () => {
  const picker = readFileSync(new URL('office-picker.js', root), 'utf8');
  assert.doesNotMatch(picker, /s\.claims/);
  assert.doesNotMatch(picker, /c\.profile_key/);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(`- ${f.name}: ${f.message.split('\n')[0]}`); process.exit(1); }
