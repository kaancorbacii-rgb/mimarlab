#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-14 — HESAP ÜYELİĞİ İLE KİŞİ PROFİLİNİN AYRILMASI
// "Bundan sonra kullanıcıların siteye üye oldukları bilgilerle kişi popuplarındaki bilgileri
//  ayırıyoruz, birbirleriyle entegre olmayacaklar."
//
// Bu dosya o turun ON maddesinden test edilebilir olanların SÖZLEŞMESİNİ kilitler:
//   1. Üye Ol formunda doğum yılı / üniversite / meslek kutuları YOK; Ad Soyad'dan SONRA
//      "Kullanıcı Adı" kutusu var (hem popup formu hem statik uye-ol.html kopyası).
//   2. Hesabım'da Firma Bilgileri kutusu Kişi Bilgileri kutusundan ÖNCE geliyor.
//   3. "Profil Bilgileri" başlığı "Kişi Bilgileri" oldu ve kutunun satırları artık hesabın `users`
//      satırından DEĞİL, atanan kişi kaydından okunuyor.
//   4. İki kutudaki düzenleme düğmesinin adı "Bilgileri Düzenle".
//   5. Başlık satırı: ad soyad -> @kullanıcı adı -> e-posta; altında YALNIZCA ad soyad + kullanıcı
//      adını kaydeden "Profili Düzenle" düğmesi.
//   6. Geri dolum (migrations/0119): "Kaan Çorbacı" -> kaancorbaci; çakışmalar ".2" ile ayrılır;
//      slug üretilemeyen hesap bile kullanıcı adsız KALMAZ.
//   7. Ayrım: hesap alanları ile kişi künyesi arasındaki ÜÇ köprünün hiçbiri kaynakta yok.
//   8. Giriş kutusu e-posta VEYA kullanıcı adı kabul ediyor (istemci `identifier` gönderiyor).
//
// AYNI GÜNÜN İKİNCİ TURU (6 madde) da burada kilitlenir:
//   1. Kişi Bilgileri kutusunun "Bilgileri Düzenle" düğmesi pop-up açmaz; firma düğmesi gibi
//      kisi-ekle/düzenle sayfasına gider (?claim= / ?edit= / boş form).
//   2. Hesap ad soyadı ARTIK TEKİL DEĞİL; tekil olan yalnızca kullanıcı adı.
//   3. Hesabın ad soyadı ile kişi künyesinin adı arasında HİÇBİR bağ yok (sunucuda sahiplik/atama,
//      istemcide ad tercihi ve hesap-adından-otomatik-doldurma kaldırıldı).
//   4. Hesap kimliği pop-up'ında Şifre Değiştir + Hesabımı Sil (varsayılan KAPALI).
//   5. Üye Ol formundaki kullanıcı adı açıklaması kaldırıldı.
//
// Giriş/kayıt/kullanıcı adı kurallarının UÇTAN UCA (gerçek rota + D1) testi ayrı dosyada:
// scripts/test-2026-09-11-signup-name.mjs (aynı turda genişletildi).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const authModal = read('js/components/auth-modal.js');
const uyeOl = read('uye-ol.html');
const girisYap = read('giris-yap.html');
const authRoute = read('src/routes/auth.js');
const schema = read('schema.sql');

section('madde 1 — Üye Ol: kullanıcı adı VAR; doğum yılı / üniversite / meslek YOK');

test('popup formunda Kullanıcı Adı kutusu Ad Soyad\'dan SONRA geliyor', () => {
  const nameIdx = authModal.indexOf('id="am-signup-name"');
  const userIdx = authModal.indexOf('id="am-signup-username"');
  const mailIdx = authModal.indexOf('id="am-signup-email"');
  assert.ok(nameIdx > -1 && userIdx > -1 && mailIdx > -1, 'alanlardan biri yok');
  assert.ok(nameIdx < userIdx && userIdx < mailIdx, 'sıra Ad Soyad -> Kullanıcı Adı -> E-posta değil');
});

test('popup formunda kaldırılan üç kutunun izi kalmadı', () => {
  for (const id of ['am-signup-dob', 'am-signup-school', 'am-signup-profession']) {
    assert.ok(!authModal.includes(`id="${id}"`), `${id} hâlâ formda`);
    assert.ok(!authModal.includes(`getElementById('${id}')`), `${id} hâlâ okunuyor (ReferenceError riski)`);
  }
});

test('kayıt gövdesi yalnızca hesap alanlarını taşıyor', () => {
  const body = authModal.slice(authModal.indexOf('const payload = {', authModal.indexOf('am-signup-form')));
  const head = body.slice(0, body.indexOf('};'));
  assert.match(head, /\busername,/, 'username gönderilmiyor');
  assert.ok(!/\bdob:/.test(head) && !/\bschool:/.test(head) && !/\bprofession:/.test(head), 'kaldırılan alanlar hâlâ gönderiliyor');
});

test('statik uye-ol.html kopyası da aynı forma sahip', () => {
  assert.ok(uyeOl.includes('id="signup-username"'), 'kullanıcı adı kutusu yok');
  for (const id of ['signup-dob', 'signup-school', 'signup-profession']) {
    assert.ok(!uyeOl.includes(`id="${id}"`), `${id} hâlâ formda`);
    assert.ok(!uyeOl.includes(`getElementById('${id}')`), `${id} hâlâ okunuyor`);
  }
});

test('sunucu: kullanıcı adı ZORUNLU, doğum tarihi DEĞİL', () => {
  assert.match(authRoute, /if \(!usernameResult\.ok\) return errorJson\(usernameResult\.error\);/, 'kullanıcı adı doğrulanmıyor');
  assert.ok(!/return errorJson\('Doğum tarihi gerekli\.'\)/.test(authRoute), 'doğum tarihi hâlâ zorunlu');
});

section('madde 2/3/4 — Hesabım kutuları: sıra, başlık ve düğme adları');

test('Firma Bilgileri kutusu Kişi Bilgileri kutusundan ÖNCE', () => {
  const firm = authModal.indexOf('data-collapse="am-firm-collapse"');
  const person = authModal.indexOf('data-collapse="am-profile-collapse"');
  assert.ok(firm > -1 && person > -1, 'kutulardan biri yok');
  assert.ok(firm < person, 'sıra takas edilmemiş (Kişi Bilgileri hâlâ önce)');
});

test('başlıklar "Firma Bilgileri" ve "Kişi Bilgileri"', () => {
  assert.ok(authModal.includes('<h2>Kişi Bilgileri</h2>'), 'Kişi Bilgileri başlığı yok');
  assert.ok(authModal.includes('<h2>Firma Bilgileri</h2>'), 'Firma Bilgileri başlığı yok');
  assert.ok(!authModal.includes('<h2>Profil Bilgileri</h2>'), 'eski "Profil Bilgileri" başlığı duruyor');
});

test('iki kutunun düğmesi de "Bilgileri Düzenle"', () => {
  assert.match(authModal, /id="am-dash-edit-btn"[^>]*>Bilgileri Düzenle</, 'Kişi kutusu düğmesi değişmemiş');
  assert.match(authModal, /id="am-firm-edit-btn"[^>]*>Bilgileri Düzenle</, 'Firma kutusu düğmesi değişmemiş');
});

test('Kişi Bilgileri satırları artık hesap alanlarından DOLDURULMUYOR', () => {
  const loadUser = authModal.slice(authModal.indexOf('async function loadUser(opts)'));
  const body = loadUser.slice(0, loadUser.indexOf('\n    }'));
  for (const id of ['am-fact-profession', 'am-fact-position', 'am-fact-school', 'am-fact-dob']) {
    assert.ok(!body.includes(id), `${id} hâlâ loadUser içinde (hesaptan) yazılıyor`);
  }
  // Tek kaynak: kişi kaydı (amPersonRecord) -> renderPersonInfo
  assert.match(authModal, /function renderPersonInfo\(\) \{/, 'renderPersonInfo yok');
  assert.match(authModal, /let amPersonRecord = null;/, 'kişi künyesi durumu yok');
  const rp = authModal.slice(authModal.indexOf('function renderPersonInfo()'));
  assert.ok(!/accountUser\.(profession|school|dob|position)/.test(rp.slice(0, 1200)), 'kutu hâlâ hesap alanlarını okuyor');
});

test('"Üyelik" satırı kutudan çıktı, başlık satırına taşındı', () => {
  assert.ok(!authModal.includes('id="am-fact-joined"'), 'Üyelik satırı Kişi Bilgileri kutusunda kalmış');
  assert.ok(authModal.includes('id="am-dash-member"'), 'üyelik bilgisi başlıkta yok');
});

section('madde 5 — başlık satırı ve hesap kimliği pop-up\'ı');

test('başlık: ad soyad -> @kullanıcı adı -> e-posta -> Profili Düzenle', () => {
  const head = authModal.slice(authModal.indexOf('<div class="dash-head dash-head-account">'));
  const block = head.slice(0, head.indexOf('</div>\n      </div>'));
  const t = block.indexOf('id="am-dash-title"');
  const u = block.indexOf('id="am-dash-username"');
  const e = block.indexOf('id="am-dash-sub"');
  const b = block.indexOf('id="am-account-edit-btn"');
  assert.ok(t > -1 && u > -1 && e > -1 && b > -1, 'başlık satırının parçalarından biri yok');
  assert.ok(t < u && u < e && e < b, 'sıra ad soyad -> kullanıcı adı -> e-posta -> düğme değil');
  assert.match(authModal, /'Hoş Geldin, ' \+ \(accountUser\.name \|\| ''\)/, 'başlık ad soyadın TAMAMINI göstermiyor');
  assert.match(authModal, /accountUser\.username \? '@' \+ accountUser\.username : ''/, 'kullanıcı adı satırı yazılmıyor');
});

test('hesap kimliği pop-up\'ı YALNIZCA ad soyad + kullanıcı adı gönderiyor', () => {
  const save = authModal.slice(authModal.indexOf("on('am-account-save-btn', 'click'"));
  const body = save.slice(0, save.indexOf('    });'));
  assert.match(body, /JSON\.stringify\(\{ name, username \}\)/, 'başka alanlar da gönderiliyor olabilir');
  // Kişi uçlarına (POST/PATCH /api/architects) HİÇ yazmamalı — yorum metinlerinde "architects"
  // geçebilir, bu yüzden aranan şey bir fetch çağrısıdır.
  assert.ok(!/fetch\(['\`][^'\`]*\/api\/architects/.test(body), 'hesap pop-up\'ı kişi kaydına da yazıyor (ayrım bozuldu)');
});

test('kişi künyesi pop-up\'ının Kaydet\'i hesap satırına HİÇ yazmıyor', () => {
  const save = authModal.slice(authModal.indexOf("on('am-dash-save-btn', 'click'"));
  const body = save.slice(0, save.indexOf("\n    on('am-avatar-upload-btn'"));
  // 2026-09-15 madde 2'ye kadar tek bir istisna vardı: yüklenen fotoğraf hesabın avatarına da
  // yazılırdı. Hesapların profil fotoğrafı kalkınca o yazım da kaldırıldı — bu Kaydet artık
  // YALNIZCA kişi künyesine (POST/PATCH /api/architects) yazar.
  assert.ok(!body.includes("fetch('/api/profile'"), 'kişi pop-up\'ı yine hesap satırına yazıyor (ayrım bozuldu)');
  assert.ok(!/JSON\.stringify\(\{ photo_url/.test(body), 'hesaba fotoğraf yazımı geri gelmiş');
  // Fotoğraf kişi kaydına gitmeye DEVAM etmeli (kişi pop-up'ındaki görsel oradan gelir).
  assert.ok(
    body.includes('patch.photo_url = upData.url;') &&
    body.includes('submitArchitectSyncIfNeeded(name, dob, school, profession, position, awards, about, socialLinks, portfolioUrls, patch.photo_url || null)'),
    'yüklenen fotoğraf kişi kaydına da taşınmıyor',
  );
});

// 2026-09-15 madde 2 — hesap profil fotoğrafı KALDIRILDI (kişi künyesinin fotoğrafı AYRI ve durur).
section('2026-09-15 madde 2 — hesapların profil fotoğrafı yok');

test('sunucu: PATCH /api/profile photo_url\'ü kabul etmiyor', () => {
  const routes = read('src/routes/auth.js');
  assert.ok(
    !/const fields = \[[^\]]*'photo_url'/.test(routes),
    'photo_url yazılabilir alanlar listesine geri gelmiş',
  );
  assert.ok(
    !/if \(!user\.photo_url && photoUrl\)/.test(routes),
    'sosyal giriş yine sağlayıcının fotoğrafını hesaba yazıyor',
  );
  assert.ok(
    !/INSERT INTO users \([^)]*photo_url/.test(routes),
    'yeni hesap satırı yine photo_url ile açılıyor',
  );
});

test('istemci: hesap avatarı hiçbir yüzeyde çizilmiyor', () => {
  assert.ok(!/id="am-dash-avatar"/.test(authModal), 'Hesabım başlığındaki avatar geri gelmiş');
  assert.ok(!/accountUser\.photoUrl/.test(authModal), 'hesabın fotoğrafı yine okunuyor');
  const nav = read('auth-nav.js');
  assert.ok(!/user\.photoUrl/.test(nav), 'üst menü/çekmece yine hesabın fotoğrafını çiziyor');
  assert.ok(!/nav-avatar-circle|nav-mobile-account-avatar/.test(nav), 'avatar dairesi geri gelmiş');
  const hesabim = read('hesabim.html');
  assert.ok(!/id="avatar-upload-btn"|id="dash-avatar"/.test(hesabim), 'Hesabım sayfasında avatar/yükleme kutusu duruyor');
});

test('kişi künyesinin fotoğrafı DURUYOR (kişi pop-up\'ı etkilenmedi)', () => {
  assert.ok(/id="am-avatar-upload-btn"/.test(authModal), 'kişi formundaki fotoğraf yükleme kaybolmuş');
  assert.ok(read('kisi-ekle.html').includes('photo_url: photoUrl'), 'kisi-ekle fotoğrafı göndermiyor');
  assert.ok(
    read('src/lib/canonicalSync.js').includes("if (row.photo_url != null) { sets.push('photo_url = ?'); vals.push(row.photo_url || null); }"),
    'kişi kaydının fotoğraf yazımı bozulmuş',
  );
});

// 2026-09-15 madde 1 — "Kişi sayfasında diğer profesyonellerle birlikte görünmek istiyor musunuz?"
section('2026-09-15 madde 1 — dizin sorusu iki formdan da kaldırıldı');

test('kisi-ekle.html ve Hesabım pop-up\'ında soru/radyo grubu yok', () => {
  const kisiEkle = read('kisi-ekle.html');
  assert.ok(!/name="directory_listed"/.test(kisiEkle), 'kisi-ekle\'de radyo grubu duruyor');
  assert.ok(!/listing-consent-q/.test(kisiEkle), 'soru kutusu markup\'ı duruyor');
  assert.ok(!/name="am-directory-listed"/.test(authModal), 'pop-up\'ta radyo grubu duruyor');
});

test('hiçbir form directory_listed GÖNDERMİYOR (mevcut tercihler korunur)', () => {
  assert.ok(!/directory_listed:/.test(read('kisi-ekle.html')), 'kisi-ekle alanı yine gönderiyor');
  assert.ok(!/directory_listed: picked/.test(authModal), 'pop-up alanı yine gönderiyor');
  // Sunucu tarafı DEĞİŞMEDİ: kolon ve /kisi dizin süzgeci yerinde.
  assert.match(read('src/routes/architect.js'), /a\.directory_listed = 1/, 'dizin süzgeci kaldırılmış');
});

section('madde 6 — geri dolum: ad soyaddan kullanıcı adı (migrations/0119)');

test('schema.sql kolonu TEKİL olarak taşıyor', () => {
  assert.match(schema, /username TEXT UNIQUE,/, 'schema.sql güncellenmemiş (taze/test DB kolonsuz kalır)');
});

test('geri dolum SQL\'i gerçek SQLite üzerinde doğru kullanıcı adları üretiyor', () => {
  // Migration ÖNCESİ şemayı taklit et: kolonu schema.sql'den düşür.
  const pre = schema.replace(/\n  username TEXT UNIQUE,/, '');
  assert.ok(!pre.includes('username TEXT UNIQUE'), 'taklit şema hâlâ kolonu taşıyor');
  const db = new DatabaseSync(':memory:');
  db.exec(pre);
  const ins = db.prepare("INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES (?,?,?,?,'user',?)");
  ins.run('u1', 'a@a.com', 'h', 'Kaan Çorbacı', 1000);
  ins.run('u2', 'b@b.com', 'h', 'Ayşe Yılmaz', 1001);
  ins.run('u3', 'c@c.com', 'h', 'Kaan Corbacı', 1002);   // aynı slug -> ".2"
  ins.run('u4', 'd@d.com', 'h', 'Ş. İ.', 1003);          // slug üretilemez -> güvenlik ağı
  ins.run('u5', 'e@e.com', 'h', "Ali'Veli-Öz", 1004);
  db.exec(read('migrations/0119_users_username.sql'));
  const name = (id) => db.prepare('SELECT username FROM users WHERE id = ?').get(id).username;
  assert.equal(name('u1'), 'kaancorbaci', 'örnekteki dönüşüm ("Kaan Çorbacı" -> @kaancorbaci) bozuk');
  assert.equal(name('u2'), 'ayseyilmaz');
  assert.equal(name('u3'), 'kaancorbaci.2', 'çakışma ekiyle ayrılmıyor');
  assert.equal(name('u5'), 'alivelioz', 'kesme/tire/Türkçe harf temizliği bozuk');
  assert.match(name('u4'), /^uye[0-9a-f]{8}$/, 'slug üretilemeyen hesap kullanıcı adsız kalmış');
  // Tekil indeks ve geçici tablonun temizliği
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_users_username'").get(), 'tekil indeks kurulmamış');
  assert.ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='_username_backfill'").get(), 'geçici tablo bırakılmış');
  // İkinci kez çalıştırılan geri dolum (kolon varmış gibi) dolu adları EZMEZ: UPDATE'ler
  // "username IS NULL" koşullu — burada aynı UPDATE'leri tekrar uygulayıp değişmediğini görüyoruz.
  const before = name('u1');
  db.exec("UPDATE users SET username = 'uye' || lower(hex(randomblob(4))) WHERE username IS NULL;");
  assert.equal(name('u1'), before, 'geri dolum dolu bir kullanıcı adını ezdi');
});

section('madde 7 — ayrım: üç köprünün hiçbiri kaynakta yok');

test('istemci: syncClaimedArchitectData kaldırıldı', () => {
  assert.ok(!/async function syncClaimedArchitectData/.test(authModal), 'istemci köprüsü geri gelmiş');
  assert.ok(!/syncClaimedArchitectData\(items\)/.test(authModal), 'çağrı geri gelmiş');
});

test('sunucu: iki köprü de kaldırıldı', () => {
  assert.ok(!/await fillUserFromArchitectProfile\(/.test(read('src/routes/admin.js')), 'admin atama köprüsü geri gelmiş');
  assert.ok(!/await syncOwnArchitectToAccount\(/.test(read('src/routes/submissions.js')), 'gönderi köprüsü geri gelmiş');
  assert.ok(!/export async function fillUserFromArchitectProfile/.test(read('src/lib/claimedProfiles.js')), 'kopyalama fonksiyonu geri gelmiş');
});

section('madde 8 — giriş: e-posta VEYA kullanıcı adı');

test('istemci kutusu metin tipinde ve `identifier` gönderiyor', () => {
  assert.ok(authModal.includes('<label for="am-login-email">E-posta veya Kullanıcı Adı</label>'), 'etiket güncellenmemiş');
  assert.ok(!/id="am-login-email"[^>]*type="email"/.test(authModal), 'kutu hâlâ type="email" (kullanıcı adı yazılamaz)');
  assert.match(authModal, /identifier: document\.getElementById\('am-login-email'\)\.value/, 'identifier gönderilmiyor');
  assert.ok(girisYap.includes("identifier: document.getElementById('login-email').value"), 'statik giris-yap.html kopyası güncellenmemiş');
});

test('sunucu "@" ile e-posta/kullanıcı adı ayrımı yapıyor ve iki indeksi de kullanıyor', () => {
  assert.match(authRoute, /const identifier = \(body\.identifier \|\| body\.email \|\| ''\)\.trim\(\);/, 'kimlik alanı okunmuyor');
  assert.match(authRoute, /const isEmail = identifier\.includes\('@'\);/, '"@" ayrımı yok');
  assert.match(authRoute, /SELECT \* FROM users WHERE username = \?/, 'kullanıcı adı sorgusu yok');
  // Yorumda geçmesi serbest; asıl aranan, HAZIRLANMIŞ bir sorgunun OR kullanmaması.
  assert.ok(!/prepare\('SELECT \* FROM users WHERE email = \? OR username = \?'\)/.test(authRoute), 'OR sorgusu tablo taramasına düşürür');
});

section('ikinci tur madde 1 — Kişi kutusunun düğmesi kisi-ekle/düzenle sayfasına gider');

test('düğme bir BAĞLANTI (pop-up açan buton değil) ve pop-up kancası kaldırıldı', () => {
  assert.match(authModal, /<a class="dash-edit-btn dash-edit-btn-sm" id="am-dash-edit-btn" href="\/kisi-ekle">/, 'düğme hâlâ <button> ya da href yok');
  assert.ok(!/on\('am-dash-edit-btn', 'click', openAmProfileEditPopup\)/.test(authModal), 'düğme hâlâ kişi pop-up\'ını açıyor');
});

test('hedef: atanmış profil -> ?claim=, kendi gönderisi -> ?edit=, hiçbiri -> boş form', () => {
  const fn = authModal.slice(authModal.indexOf('function renderPersonEditBtn()'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.match(body, /amPersonClaim && \(amPersonClaim\.slug \|\| amPersonClaim\.profile_key\)/, 'atanmış profil anahtarı okunmuyor');
  assert.match(body, /\?claim=\$\{encodeURIComponent\(claimKey\)\}/, '?claim= yolu yok');
  assert.match(body, /\?edit=\$\{encodeURIComponent\(architectSyncState\.editId\)\}&stype=architects/, '?edit= yolu yok');
  assert.match(body, /btn\.href = CLAIM_EDIT_PAGE\.architect;/, 'kayıt yokken boş forma gitmiyor');
  // FİRMA düğmesiyle AYNI sayfa ailesi: /kisi-ekle (firma: /firma-ekle | /marka-ekle)
  assert.match(authModal, /CLAIM_EDIT_PAGE = \{ architect: '\/kisi-ekle'/, 'kişi düzenleme sayfası tek kaynaktan gelmiyor');
});

section('ikinci tur madde 2 — hesap ad soyadı tekil DEĞİL, kullanıcı adı tekil');

test('sunucu: ad tekillik kontrolü yok, kullanıcı adı tekillik kontrolü var', () => {
  assert.ok(!/(export async function|await) findUserByFoldedName/.test(authRoute), 'ad tekillik kontrolü duruyor');
  assert.match(authRoute, /if \(await isUsernameTaken\(env, usernameResult\.value\)\)/, 'kayıt kullanıcı adı tekilliğini kontrol etmiyor');
  assert.match(authRoute, /if \(await isUsernameTaken\(env, result\.value, userId\)\)/, 'profil güncelleme kullanıcı adı tekilliğini kontrol etmiyor');
  assert.ok(!/DUPLICATE_USER_NAME_ERROR/.test(authRoute), 'eski ad çakışma hatası duruyor');
});

test('şema: username TEKİL, name değil', () => {
  assert.match(schema, /username TEXT UNIQUE,/);
  assert.match(schema, /name TEXT NOT NULL,/);
  assert.ok(!/name TEXT NOT NULL UNIQUE/.test(schema), 'ad tekil yapılmış');
});

section('ikinci tur madde 3 — hesap adı ile kişi künyesi arasında bağ YOK');

test('sunucu: sahiplik ad eşleşmesiyle DEĞİL claimed_by_user_id ile çözülür', () => {
  const claimed = read('src/lib/claimedProfiles.js');
  assert.match(claimed, /claimed_by_user_id = \?/, 'sahiplik sinyali yok');
  assert.ok(!/name_fold = \?`\)\.bind\(foldTr\(user\.name\)\)/.test(claimed), 'ad eşleşmesi geri gelmiş');
});

test('sunucu: "bu kayıt kullanıcının kendisi mi" yalnızca onaylı atamaya bakar', () => {
  const subs = read('src/routes/submissions.js');
  const fn = subs.slice(subs.indexOf('async function isOwnArchitectRecord'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /profile_type = 'architect' AND profile_key = \? AND status = 'approved'/, 'atama kontrolü yok');
  assert.ok(!/foldTr\(selfMatchName\)/.test(body), 'ad karşılaştırması geri gelmiş');
});

test('sunucu: kendi-kendine-yayın (ad doğrulamalı moderasyon atlama) kaldırıldı', () => {
  const subs = read('src/routes/submissions.js');
  assert.ok(!/const isSelfDirectoryListing =/.test(subs), 'bayrak geri gelmiş');
  assert.match(subs, /const status = \(user\.role === 'admin' \|\| isOwnerProfileEdit\) \? 'approved' : 'pending';/, 'durum kuralı beklenenden farklı');
  assert.ok(!/selfDirectoryListing: true/.test(authModal), 'istemci bayrağı hâlâ gönderiyor');
});

test('istemci: kişi gönderisi seçimi ve kisi-ekle ön-doldurması hesap adına bakmıyor', () => {
  assert.ok(!/foldTrAm\(\(accountUser && accountUser\.name\)/.test(authModal), 'kendi gönderisi seçimi hâlâ ada bakıyor');
  const kisiEkle = read('kisi-ekle.html');
  assert.ok(!/async function maybeAutoFillFromAccount/.test(kisiEkle), 'hesaptan otomatik doldurma geri gelmiş');
  assert.ok(!/trLower\(user\.name\) === n/.test(kisiEkle), 'isOwnAccountProfile hâlâ hesap adını karşılaştırıyor');
});

section('ikinci tur madde 4/5 — hesap pop-up\'ı ve Üye Ol açıklaması');

test('Şifre Değiştir + Hesabımı Sil hesap pop-up\'ının İÇİNDE ve varsayılan KAPALI', () => {
  const start = authModal.indexOf('id="am-account-edit-overlay"');
  const end = authModal.indexOf('id="am-profile-edit-overlay"');
  assert.ok(start > -1 && end > start, 'pop-up\'lardan biri yok ya da sıra bozuk');
  const popup = authModal.slice(start, end);
  assert.ok(popup.includes('data-collapse="am-pw-collapse" aria-expanded="false"'), 'Şifre Değiştir hesap pop-up\'ında değil ya da açık başlıyor');
  assert.ok(popup.includes('data-collapse="am-delete-collapse" aria-expanded="false"'), 'Hesabımı Sil hesap pop-up\'ında değil ya da açık başlıyor');
  assert.ok(popup.includes('<div class="dash-collapse-body" id="am-pw-collapse" hidden>'), 'şifre gövdesi hidden başlamıyor');
  assert.ok(popup.includes('<div class="dash-collapse-body" id="am-delete-collapse" hidden>'), 'silme gövdesi hidden başlamıyor');
  // Kişi künyesi pop-up'ında ARTIK YOK (tek kopya kalmalı — id çakışması olmasın).
  const personPopup = authModal.slice(end);
  assert.ok(!personPopup.includes('id="am-pw-collapse"'), 'şifre bölümü kişi pop-up\'ında da duruyor (id çakışması)');
  assert.ok(!personPopup.includes('id="am-delete-collapse"'), 'silme bölümü kişi pop-up\'ında da duruyor (id çakışması)');
});

test('pop-up her açılışta iki bölümü de kapatıyor', () => {
  const fn = authModal.slice(authModal.indexOf('function openAmAccountEditPopup()'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.match(body, /\['am-pw-collapse', 'am-delete-collapse'\]\.forEach/, 'açılışta kapatma yok');
  assert.match(body, /body\.hidden = true/, 'gövde kapatılmıyor');
});

test('Üye Ol formundaki kullanıcı adı açıklaması silindi', () => {
  const form = authModal.slice(authModal.indexOf('id="am-signup-form"'), authModal.indexOf('id="am-signup-password"'));
  assert.ok(!form.includes('auth-hint'), 'açıklama hâlâ Üye Ol formunda');
  const uyeOlForm = uyeOl.slice(uyeOl.indexOf('id="signup-form"'), uyeOl.indexOf('id="signup-password"'));
  assert.ok(!uyeOlForm.includes('olarak görünür'), 'açıklama statik uye-ol.html kopyasında duruyor');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
