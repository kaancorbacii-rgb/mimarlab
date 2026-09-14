#!/usr/bin/env node
// KULLANICI BİLDİRİMİ, 2026-09-14 (yetki atanan bir kullanıcıdan gelen e-posta): "Örneğin profil
// görsellerimizi güncelleyemedik, sisteme yüklüyoruz lakin kaydet dediğimizde halen eski foto
// görünüyor."
//
// KÖK NEDEN. Hesabım > Profili Düzenle'nin Kaydet'i İKİ yazma yapar:
//   1) PATCH /api/profile      -> users satırı (yeni fotoğraf BURADA doğru kaydediliyordu),
//   2) POST/PATCH /api/architects -> kişi (architect_submissions + canonical architects) kaydı.
// İkinci yazım photo_url olarak HER ZAMAN `architectSyncState.photoUrl`'ü, yani panel AÇILDIĞINDA
// okunmuş ESKİ değeri gönderiyordu. Yani kullanıcı fotoğrafı yükleyip kaydettiğinde herkese açık
// kişi profiline ESKİ fotoğraf geri yazılıyor, görünen görsel hiç değişmiyordu.
//
// İKİNCİ, DAHA SESSİZ KUSUR: `photo_url: architectSyncState.photoUrl || null`. photo_url NULLABLE
// bir alandır (bkz. src/lib/submissionTypes.js#nullableStringFields): alan gövdede YOKSA "dokunma",
// '' ise "temizle". Gönderilen `null` sunucuda '' olarak normalize olduğundan, durum nesnesi boşken
// (kişi kaydı okunamadan Kaydet'e basıldığında) bu yazım canonical satırdaki fotoğrafı SİLİYORDU.
//
// BU DOSYANIN KİLİTLEDİĞİ SÖZLEŞMELER:
//   1) Kaydet'te yüklenen yeni fotoğrafın URL'i kişi yazımına PARAMETRE olarak taşınır.
//   2) Taşınan değer durum nesnesine de yazılır (panel kapanmadan ikinci Kaydet yine tazesini yollar).
//   3) photo_url ancak BİLİNEN bir değer varken gönderilir — boşken alan HİÇ gönderilmez.
//   4) kisi-ekle.html / firma-ekle.html'in AYNI deseni (yeni yükleme mevcut URL'i EZER) bozulmaz.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const authModal = read('js/components/auth-modal.js');
const kisiEkle = read('kisi-ekle.html');
const firmaEkle = read('firma-ekle.html');
const submissionTypes = read('src/lib/submissionTypes.js');
const canonicalSync = read('src/lib/canonicalSync.js');

console.log('\nHesabım > Profili Düzenle — yüklenen fotoğraf kişi kaydına da gider');

test('submitArchitectSyncIfNeeded yüklenen fotoğrafı PARAMETRE olarak alıyor', () => {
  assert.match(
    authModal,
    /async function submitArchitectSyncIfNeeded\([^)]*portfolioUrls = null, uploadedPhotoUrl = null\)/,
    'fonksiyon imzasında uploadedPhotoUrl yok — yeni fotoğraf kişi yazımına hiç ulaşmıyor',
  );
});

test('Kaydet, aynı turda yüklenen URL\'i (patch.photo_url) o parametreye veriyor', () => {
  assert.ok(
    authModal.includes('submitArchitectSyncIfNeeded(name, dob, school, profession, position, awards, about, socialLinks, portfolioUrls, patch.photo_url || null)'),
    'çağrı yeni fotoğrafı geçirmiyor',
  );
  // Yükleme, çağrıdan ÖNCE yapılmalı — `patch.photo_url` ancak o zaman dolu olur.
  const upload = authModal.indexOf("patch.photo_url = upData.url;");
  const call = authModal.indexOf('await submitArchitectSyncIfNeeded(name, dob, school, profession');
  assert.ok(upload > 0 && call > upload, 'fotoğraf yüklemesi kişi yazımından sonra kalmış');
});

test('yeni URL durum nesnesine de yazılıyor (ikinci Kaydet de tazesini yollar)', () => {
  assert.ok(
    authModal.includes('if (uploadedPhotoUrl) architectSyncState.photoUrl = uploadedPhotoUrl;'),
    'architectSyncState.photoUrl tazelenmiyor — panel kapanmadan ikinci Kaydet eski URL\'i geri yazar',
  );
});

test('photo_url yalnızca BİLİNEN bir değer varken gönderiliyor (boşken alan hiç yok)', () => {
  assert.ok(
    authModal.includes("...(architectSyncState.photoUrl ? { photo_url: architectSyncState.photoUrl } : {}),"),
    'photo_url koşulsuz gönderiliyor',
  );
  assert.ok(
    !authModal.includes('photo_url: architectSyncState.photoUrl || null'),
    'eski `|| null` yazımı geri gelmiş — boş değer canonical fotoğrafı SİLER',
  );
});

console.log('\nnullable photo_url sözleşmesi — "yok" ile "temizle" ayrı kalmalı');

test('photo_url gerçekten nullableStringFields\'ta ve sync null\'ı atlıyor', () => {
  assert.match(submissionTypes, /nullableStringFields: \['photo_url'\]/, 'photo_url nullable değil');
  assert.ok(
    canonicalSync.includes("if (row.photo_url != null) { sets.push('photo_url = ?'); vals.push(row.photo_url || null); }"),
    'syncArchitect null = "dokunma" ayrımını yapmıyor',
  );
});

console.log('\nformlardaki AYNI desen — yeni yükleme mevcut URL\'i EZER');

test('kisi-ekle.html ve firma-ekle.html yeni yüklemeyi mevcut URL\'in üzerine yazıyor', () => {
  assert.ok(kisiEkle.includes('if(selectedFiles.length) photoUrl = (await uploadFiles(selectedFiles))[0];'), 'kisi-ekle fotoğraf üzerine yazmıyor');
  assert.ok(firmaEkle.includes('if(selectedFiles.length) logoUrl = (await uploadFiles(selectedFiles))[0];'), 'firma-ekle logo üzerine yazmıyor');
  assert.ok(firmaEkle.includes('if(selectedCoverFiles.length) coverUrl = (await uploadFiles(selectedCoverFiles))[0];'), 'firma-ekle kapak üzerine yazmıyor');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
