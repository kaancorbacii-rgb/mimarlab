#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-15 (üçüncü tur) — iki maddenin kalıcı sözleşmesi:
//
//   1. "Mobilde hesabım sayfasındaki 'Hoş Geldin, Kaan Çorbacı' yazısının puntosunu biraz küçült."
//      Başlık TAM ad soyadı taşıdığından masaüstündeki 26px telefonda taşıyordu; mobil kural
//      eklendi, masaüstü ölçüsü DEĞİŞMEDİ. İki yüzey (Hesabım modali + hesabim.html) aynı ölçüyü
//      kullanır, ayrışırlarsa bu test kırmızıya döner.
//
//   2. "admin panelinden bir firmaya bir kullanıcıyı yönetici olarak atadığı zaman o kullanıcının
//      hesabım sayfasında kişi bilgileri bölümünde görülen diğer kişi sayfalarında da profili
//      düzenle butonu görünsün. Yönetici bu butona tıklayarak firmadaki tüm kişilerin popuplarını
//      düzenleyebilsin."
//      Düğme, firma pop-up'ındaki "Düzenle" ile AYNI yolu açar (kisi-ekle?claim=<slug>); yeni bir
//      düzenleme yolu açılmaz. Sunucu kapısı (verifyClaimedProfileKey'in ÜÇÜNCÜ yolu +
//      canEditArchitectViaOfficeMembership) bu düğmenin dayanağıdır — o kapı kalkarsa düğme
//      kullanıcıyı 403'e götürürdü, bu yüzden burada birlikte kilitlenirler.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const section = (t) => console.log(`\n${t}`);
const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

const authModal = read('js/components/auth-modal.js');
const hesabim = read('hesabim.html');
const submissions = read('src/routes/submissions.js');
const claimedProfiles = read('src/lib/claimedProfiles.js');

// Bir CSS kuralını, İÇİNDE bulunduğu media bloğuyla birlikte arar: `@media (max-width:720px)`
// bloğunun gövdesini (ilk kapanan eşleşmeye kadar değil, iç içe süslü parantezleri sayarak) çıkarır.
function mobileBlocks(src, query) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf(query, from);
    if (at < 0) return out;
    const open = src.indexOf('{', at);
    let depth = 0, i = open;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) break; }
    }
    out.push(src.slice(open + 1, i));
    from = i;
  }
}

section('madde 1 — "Hoş Geldin, ..." başlığı mobilde küçülür');

test('Hesabım modali: mobil kural var ve masaüstü 26px korunuyor', () => {
  const blocks = mobileBlocks(authModal, '@media (max-width:720px)');
  assert.ok(blocks.length, '720px media bloğu bulunamadı');
  assert.ok(blocks.some(b => /#am-panel \.dash-head h1\{font-size:20px;\}/.test(b)),
    'mobil başlık kuralı 720px bloğunun İÇİNDE değil');
  assert.match(authModal, /#am-panel \.dash-head h1\{[^}]*font-size:26px;/, 'masaüstü ölçüsü değişmiş');
});

test('hesabim.html: AYNI mobil ölçü (iki yüzey ayrışmıyor)', () => {
  const blocks = mobileBlocks(hesabim, '@media (max-width:720px)');
  assert.ok(blocks.some(b => /\.dash-head h1\{font-size:20px;\}/.test(b)),
    'mobil başlık kuralı 720px bloğunun İÇİNDE değil');
  assert.match(hesabim, /\.dash-head h1\{[^}]*font-size:26px;/, 'masaüstü ölçüsü değişmiş');
});

test('başlık hâlâ TAM ad soyadı yazıyor (punto isteği metni değiştirmiyordu)', () => {
  assert.match(authModal, /am-dash-title'\)\.textContent = 'Hoş Geldin, ' \+ \(accountUser\.name \|\| ''\)/);
});

section('madde 2 — firma kişisi sayfasında "Profili Düzenle"');

test('firma kişisinde düğme kisi-ekle?claim=<slug> açıyor', () => {
  assert.match(authModal, /editBtn\.href = `\$\{CLAIM_EDIT_PAGE\.architect\}\?claim=\$\{encodeURIComponent\(personSlug\)\}`/);
});

// KULLANICI İSTEĞİ, 2026-09-15 dördüncü tur: "Hesabım sayfasındaki kişi bilgileri kutusundaki tüm
// bilgilerin üstündeki butonların ismi Bilgileri Düzenle olsun." Üçüncü turda firma sayfalarına
// "Profili Düzenle" yazılmıştı; kutu sayfa değiştirdikçe düğmenin adı da değişiyordu.
test('etiket HER sayfada "Bilgileri Düzenle" — tek yerde yazılıyor', () => {
  assert.match(authModal, /if \(editBtn\) editBtn\.textContent = 'Bilgileri Düzenle';/);
  assert.ok(!/editBtn\.textContent = 'Profili Düzenle'/.test(authModal),
    'kişi kutusunun düğmesi yeniden sayfaya göre ad değiştiriyor');
  // Kutunun HTML'indeki başlangıç etiketi de aynı olmalı (ilk çizimde yanıp sönmesin).
  assert.match(authModal, /id="am-dash-edit-btn" href="\/kisi-ekle">Bilgileri Düzenle<\/a>/);
});

test('sitede kaydı olmayan ad (slug yok) için düğme GİZLİ', () => {
  assert.match(authModal, /const personSlug = \(rec && rec\.slug\) \|\| '';/);
  assert.match(authModal, /editBtn\.style\.display = personSlug \? '' : 'none';/);
});

test('kendi künyesinde eski davranış korunuyor', () => {
  assert.match(authModal, /if \(isSelf\) \{\s*\n\s*if \(editBtn\) editBtn\.style\.display = '';\s*\n\s*renderPersonEditBtn\(\);/);
  // Eski koşulsuz gizleme (isSelf değilse düğme yok) geri gelmemeli.
  assert.ok(!/editBtn\.style\.display = isSelf \? '' : 'none';/.test(authModal),
    'düğme yeniden yalnızca kendi künyesine kilitlenmiş');
});

test('sayfalar yalnızca YETKİLİ olunan firmaların kişilerinden geliyor', () => {
  // buildPersonEntries canManageFirmEntry'den geçmeyen firmayı atlar — düğmenin dayanağı bu.
  assert.match(authModal, /for \(const entry of firmEntries\) \{\s*\n\s*if \(!canManageFirmEntry\(entry\)\) continue;/);
  assert.match(authModal, /const OFFICE_EDIT_POSITIONS = new Set\(\['Kurucu', 'Kurucu Ortak', 'Ortak', 'Ekip Lideri', 'Yönetici'\]\)/);
});

section('sunucu kapısı — düğmenin dayanağı');

test('verifyClaimedProfileKey firma yetkilisine kişi düzenlemesi açıyor', () => {
  assert.match(submissions, /typeKey === 'architects' && await canEditArchitectViaOfficeMembership\(env, user, currentName, OFFICE_EDIT_POSITIONS, opts\)/);
  // Düzenleme yolları DELEGATED_ACCESS ile çağırır (profil başka hesaba ait olsa da düzenlenebilir);
  // YIKICI yol (delete) bayrağı GEÇMEZ — o sınır bu turda da duruyor.
  assert.match(submissions, /const DELEGATED_ACCESS = Object\.freeze\(\{ includeOwnedByOthers: true \}\)/);
  assert.match(submissions, /action === 'delete' \? \{\} : DELEGATED_ACCESS/);
});

test('yetki kaynağı firmanın Kurucular/Ekip listesi (office_founders + künye metni)', () => {
  assert.match(claimedProfiles, /FROM office_founders WHERE architect_id = \? AND office_id IN/);
  assert.match(claimedProfiles, /SELECT founders, team FROM office_submissions/);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
