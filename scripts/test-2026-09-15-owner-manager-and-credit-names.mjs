#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-15 (dört madde) — bu dosya dördünün de sözleşmesini kilitler:
//
//   1. "bir kullanıcı siteye yeni bir kişi veya firma eklerse otomatik olarak o kişi ve firma
//      profilinin yöneticisi olsun ve hesabım sayfasındaki kutularda kişi ve firma profili
//      gözüksün."
//      Kişi tarafı zaten çalışıyordu (kendi gönderisi Hesabım'daki Kişi Bilgileri kutusunu besliyor
//      ve kendi taslağını düzenleyebiliyordu); EKSİK OLAN FİRMA TARAFIYDI — kullanıcı kendi eklediği
//      firmayı Hesabım'da hiç göremiyor, künyesini düzenleyemiyordu. Yetkinin kaynağı
//      offices/architects.claimed_by_user_id (gönderinin owner_user_id'si, admin'de NULL).
//
//   2. "Proje sayfasındaki mimar filtresinde projelerin mimar künyesinde yazan tüm isimler
//      görülmeli." — project_designers yalnızca sitede KAYDI OLAN mimar/firmaları taşıyabildiğinden
//      (CHECK kısıtı) serbest metin adlar filtreye hiç düşmüyordu; artık künyedeki ham adlar
//      projects.designer_names_raw / office_names_raw'da da duruyor ve okuma tarafı ikisini
//      birleştiriyor.
//
//   3. "proje ekle sayfasında firma seçim kısmına manuel olarak da sitede kayıtlı olmasa dahi firma
//      ismi girilebilsin." — office-picker.js'e allowCustom seçeneği. (O turda seçenek YALNIZCA
//      proje-ekle'de açılmıştı; 2026-09-15 yedinci turda kullanıcı isteğiyle kisi-ekle ve Hesabım
//      kişi formunda da açıldı — bkz. aşağıdaki madde 3 testi.)
//
//   4. "hesabım, koleksiyonum ve aktivitelerim sayfalarındaki marka butonlarını kaldır."
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shapeProjectItem, buildFilterGroups, DESIGNER_SEP } from '../src/lib/projectPool.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(title) { console.log(`\n${title}`); }
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const claimedProfiles = read('src/lib/claimedProfiles.js');
const submissions = read('src/routes/submissions.js');
const claims = read('src/routes/claims.js');
const authModal = read('js/components/auth-modal.js');
const canonicalSync = read('src/lib/canonicalSync.js');
const projectPool = read('src/lib/projectPool.js');
const officePicker = read('office-picker.js');
const projeEkle = read('proje-ekle.html');

section('madde 1 — kaydı ekleyen, o kaydın yöneticisidir');

test('sunucu: firma ve kişi için "kaydı ben açtım" yetki kapıları var', () => {
  assert.match(claimedProfiles, /export async function fetchOwnCreatedOfficeRows/, 'firma sahipliği okuyucusu yok');
  assert.match(claimedProfiles, /export async function canEditOfficeAsCreator/, 'firma yetki kapısı yok');
  assert.match(claimedProfiles, /export async function canEditArchitectAsCreator/, 'kişi yetki kapısı yok');
  // Kaynak claimed_by_user_id olmalı — ad eşleşmesi DEĞİL (bkz. 2026-09-14 ikinci tur madde 3).
  const officeFn = claimedProfiles.slice(claimedProfiles.indexOf('export async function canEditOfficeAsCreator'));
  assert.ok(/claimed_by_user_id = \?1/.test(officeFn.slice(0, 600)), 'firma kapısı claimed_by_user_id okumuyor');
  assert.ok(!/name_fold/.test(officeFn.slice(0, 600)), 'ad eşleşmesi geri gelmiş');
});

test('yetki iptal edilebilir kalıyor (Yetkili Kullanıcılar > X)', () => {
  const officeFn = claimedProfiles.slice(claimedProfiles.indexOf('export async function canEditOfficeAsCreator'), claimedProfiles.indexOf('export async function canEditOfficeAsCreator') + 600);
  assert.ok(/isOfficeManagerRevoked/.test(officeFn), 'iptal kaydı bu kapıda okunmuyor');
  const listFn = claimedProfiles.slice(claimedProfiles.indexOf('export async function fetchOwnCreatedOfficeRows'), claimedProfiles.indexOf('export async function canEditArchitectAsCreator'));
  assert.ok(/revokedOfficeKeysForUser/.test(listFn), 'liste iptal edilmiş yetkileri süzmüyor');
});

test('kişi kapısı BAŞKASINA ATANMIŞ profili dışlıyor', () => {
  const fn = claimedProfiles.slice(claimedProfiles.indexOf('export async function canEditArchitectAsCreator'), claimedProfiles.indexOf('export async function canEditOfficeAsCreator'));
  assert.ok(/isArchitectOwnedByAnotherUser/.test(fn), 'admin ataması bu kapının üzerinde değil');
});

test('düzenleme kapısı (verifyClaimedProfileKey) iki yolu da tanıyor', () => {
  const fn = submissions.slice(submissions.indexOf('async function verifyClaimedProfileKey'), submissions.indexOf('async function verifyClaimedSlug'));
  assert.ok(/canEditOfficeAsCreator\(env, user, currentName\)/.test(fn), 'firma yolu bağlanmamış');
  assert.ok(/canEditArchitectAsCreator\(env, user, currentName\)/.test(fn), 'kişi yolu bağlanmamış');
  // admin bypass'ı ve mevcut üç yol yerinde kalmalı
  assert.ok(/canEditOfficeViaFounderLink/.test(fn) && /canEditArchitectViaOfficeMembership/.test(fn), 'mevcut yetki yolları kaybolmuş');
});

test('firmayı yönetilebilir firmalar kümesine de ekliyor', () => {
  const start = claimedProfiles.indexOf('async function fetchUserEditableOfficeRows');
  const fn = claimedProfiles.slice(start, claimedProfiles.indexOf('\n}', claimedProfiles.indexOf('return [...byId.values()]', start)));
  assert.ok(/fetchOwnCreatedOfficeRows\(env, user\)/.test(fn), 'kendi eklediği firmalar yönetilebilir kümede yok');
});

test('/api/claims/mine ownOffices döndürüyor (officeLinks AYRI kalıyor)', () => {
  assert.match(claims, /ownOffices: \[/, 'ownOffices alanı yok');
  assert.match(claims, /office_submissions\s*\n?\s*WHERE owner_user_id = \? AND status = 'pending'/, 'onay bekleyen kendi gönderisi kutuya girmiyor');
  // officeLinks kişi künyesinin firma kutusunu besliyor — kendi eklediği firma oraya SIZMAMALI.
  const merge = authModal.slice(authModal.indexOf('mergeOfficeMembershipNames({'), authModal.indexOf('mergeOfficeMembershipNames({') + 200);
  assert.ok(!/myOwnOffices/.test(merge), 'kendi eklediği firma kişi künyesinin Firma kutusuna sızıyor');
});

test('Hesabım kutusu ownOffices kaynağını ve yetkisini okuyor', () => {
  assert.match(authModal, /myOwnOffices = \(d && d\.ownOffices\) \|\| \[\]/, 'istemci ownOffices okumuyor');
  assert.match(authModal, /for \(const o of myOwnOffices\)/, 'kutu dördüncü kaynağı çizmiyor');
  assert.match(authModal, /ownerCanEdit: !!o\.canEdit/, 'yetki bayrağı taşınmıyor');
  assert.ok(/canManageFirmEntry[\s\S]{0,320}entry\.ownerCanEdit/.test(authModal), 'Kişi Bilgileri sayfaları bu yetkiyi tanımıyor');
  assert.ok(/firmInfoOwnerCanEdit/.test(authModal), '"Bilgileri Düzenle" butonu bu yetkiyi tanımıyor');
});

section('madde 2 — künyedeki TÜM adlar filtrelerde');

test('migration + schema kolonları taşıyor', () => {
  const mig = read('migrations/0120_project_designer_names_raw.sql');
  assert.match(mig, /ALTER TABLE projects ADD COLUMN designer_names_raw TEXT/);
  assert.match(mig, /ALTER TABLE projects ADD COLUMN office_names_raw TEXT/);
  // Geri dolum, detay künyesinin kullandığı AYNI iki eşleşme yolunu kullanmalı.
  assert.ok(/claimed_slug = projects\.slug/.test(mig) && /'submission:' \|\| ps\.id\) = projects\.legacy_key/.test(mig), 'geri dolum eşleşmesi eksik');
  const schema = read('schema.sql');
  assert.ok(/ALTER TABLE projects ADD COLUMN designer_names_raw TEXT;/.test(schema), 'schema.sql güncellenmemiş (taze/test DB kolonsuz kalır)');
});

test('syncProject künye yazımıyla AYNI batch\'te ham adları tazeliyor', () => {
  assert.ok(
    canonicalSync.includes("UPDATE projects SET designer_names_raw = ?, office_names_raw = ? WHERE id = ?"),
    'ham adlar hiç yazılmıyor',
  );
  // DELETE + INSERT ile aynı batch: künye baştan yazıldığında iki kaynak ayrışmamalı.
  const del = canonicalSync.indexOf('DELETE FROM project_designers WHERE project_id = ?');
  const raw = canonicalSync.indexOf('UPDATE projects SET designer_names_raw');
  const run = canonicalSync.indexOf('if (statements.length) await env.DB.batch(statements);', del);
  assert.ok(del > 0 && raw > del && run > raw, 'ham ad yazımı künye batch\'inin dışında kalmış');
});

test('havuz sorguları kolonları seçiyor', () => {
  assert.ok(/p\.designer_names_raw, p\.office_names_raw/.test(projectPool), 'havuz sorgusu kolonları seçmiyor');
  assert.ok(/p\.designer_names_raw, p\.office_names_raw/.test(read('src/routes/project.js')), 'sayfa sorgusu kolonları seçmiyor');
});

test('shapeProjectItem eşleşen + ham adları birleştiriyor (gerçek çağrı)', () => {
  const SEP = DESIGNER_SEP;
  const item = shapeProjectItem({
    slug: 'x', title: 'X', images: '[]',
    designer_names: ['Nevzat Sayın', 'Kayıtlı Mimarlık'].join(SEP),
    office_names: 'Kayıtlı Mimarlık',
    designer_names_raw: JSON.stringify(['nevzat sayın', 'Kayıtsız Mimar']),
    office_names_raw: JSON.stringify(['Kayıtlı Mimarlık', 'Kayıtsız Mimarlık Ofisi']),
  }, { coverOnly: true });
  // Türkçe katlamalı tekilleştirme: "nevzat sayın" ikinci kez eklenmez, canonical yazım kazanır.
  assert.deepEqual(item.designer, ['Nevzat Sayın', 'Kayıtlı Mimarlık', 'Kayıtsız Mimar', 'Kayıtsız Mimarlık Ofisi']);
  assert.deepEqual(item.officeNames, ['Kayıtlı Mimarlık', 'Kayıtsız Mimarlık Ofisi']);

  // Mimar filtresi = designer eksi officeNames -> kayıtsız FİRMA adı Mimar filtresine SIZMAZ,
  // kayıtsız MİMAR adı ise artık görünür (isteğin ta kendisi).
  const groups = buildFilterGroups(new Map());
  const designerGroup = groups.find(g => g.key === 'designer');
  const officeGroup = groups.find(g => g.key === 'designerOffice');
  assert.deepEqual(designerGroup.field(item), ['Nevzat Sayın', 'Kayıtsız Mimar']);
  assert.deepEqual(officeGroup.field(item), ['Kayıtlı Mimarlık', 'Kayıtsız Mimarlık Ofisi']);
});

test('kolonlar NULL iken davranış ESKİSİYLE aynı', () => {
  const SEP = DESIGNER_SEP;
  const item = shapeProjectItem({
    slug: 'y', title: 'Y', images: '[]',
    designer_names: ['A', 'B'].join(SEP), office_names: 'B',
    designer_names_raw: null, office_names_raw: null,
  }, { coverOnly: true });
  assert.deepEqual(item.designer, ['A', 'B']);
  assert.deepEqual(item.officeNames, ['B']);
});

section('madde 3 — proje-ekle firma kutusuna elle isim girilebilir');

test('picker allowCustom seçeneğini destekliyor', () => {
  assert.match(officePicker, /options\.allowCustom/, 'allowCustom yok');
  assert.match(officePicker, /data-add="/, '"ekle" satırı çizilmiyor');
  // Enter da aynı satıra basmalı (kutu bir <form> içinde yaşıyor, gönderim engellenmeye devam eder).
  assert.ok(/if \(e\.key !== 'Enter'\) return;[\s\S]{0,400}addBtn\.click\(\)/.test(officePicker), 'Enter ile ekleme yok');
});

// KURAL DEĞİŞTİ (kullanıcı isteği, 2026-09-15 yedinci tur madde 3): "Kişi ekle/düzenle sayfasında
// da firma seç kısmında manuel olarak farklı bir firma ismi de yazılabilsin." Bu tur, kutunun
// kisi-ekle + Hesabım'da KAPALI tutulmasını doğruluyordu; o kapının gerekçesi ("serbest metin,
// firma talebi/üyelik zincirini karşılığı olmayan bir adla doldurur") canlı kodda doğrulandı ve
// geçerli DEĞİL: her iki zincir de eşleşmeyen adı atlıyor (claimedProfiles.js#
// ensurePendingOfficeClaims -> `if (!canonical) continue;`, canonicalSync.js#syncArchitect ->
// eşleşmeyen ad office_founders'a yazılmaz, conflict olarak loglanır). Test artık karşıt kuralı,
// yani kutunun ÜÇ yüzeyde de açık olduğunu kilitliyor — bir yüzeyin geride kalması, aynı formun
// nereden açıldığına göre farklı davranması demek olurdu.
test('serbest metin girişi üç yüzeyde de açık (proje-ekle, kisi-ekle, Hesabım)', () => {
  assert.match(projeEkle, /allowCustom: true/, 'proje-ekle allowCustom vermiyor');
  assert.match(read('kisi-ekle.html'), /allowCustom: true/, 'kisi-ekle firma kutusu kapalı kalmış');
  assert.match(authModal, /allowCustom: true/, 'Hesabım kişi formundaki firma kutusu kapalı kalmış');
});

section('madde 4 — hesabım / koleksiyonum / aktivitelerim: marka düğmesi yok');

test('hesap ekranlarında /marka bağlantısı ve "Marka" düğmesi kalmadı', () => {
  assert.ok(!/href="\/marka"/.test(authModal), '"Markalara göz at" düğmesi duruyor');
  assert.ok(!/'\/marka\/'/.test(authModal), 'Firma kutusu hâlâ /marka/ adresine bağlıyor');
  assert.ok(!/data-filter="brand"/.test(authModal), '"Marka" filtre düğmesi geri gelmiş');
  // Kullanıcıya GÖRÜNEN metinlerde marka kelimesi kalmamalı (yorumlar hariç).
  const visible = authModal.split('\n').filter(l => !/^\s*(\/\/|\*|<!--)/.test(l)).join('\n');
  assert.ok(!/>Marka</.test(visible), 'ekranda "Marka" etiketi duruyor');
  assert.ok(!/Markalara göz at/.test(visible), '"Markalara göz at" metni duruyor');
});

test('firma seçim listesindeki "Marka" rozeti kaldırıldı', () => {
  assert.ok(!/op-option-kind">Marka/.test(officePicker), 'seçenek satırında Marka rozeti duruyor');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
