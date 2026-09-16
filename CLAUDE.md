# MİMARLAB — Proje Notları

## Deploy

**Production'a HER ZAMAN `./deploy.sh` ile deploy edin — asla doğrudan `wrangler deploy` çalıştırmayın.**

`deploy.sh`, çıplak `wrangler deploy`'un yapmadığı üç kontrolü zorunlu kılar, deploy bunlardan biri başarısız olursa hiç başlamaz:

1. `miras/` klasörünün bu worktree'de gerçekten dolu olduğunu doğrular (boşsa deploy tüm miras görsellerini canlı asset manifest'inden siler). Bu kapının özgün gerekçesi `miras/`'ın gitignored olmasıydı; bugün klasör git'te İZLENİYOR (2887 dosya), ama kapı yerinde kalıyor — sparse/eksik bir checkout ya da kazara silinme aynı sonucu doğurur.
2. Başka hiçbir worktree'nin dalının, deploy edilecek daldan commit olarak ileride olmadığını doğrular (aksi halde eski/eksik bir dal canlıya çıkar).
3. Working tree'nin commit edilmemiş değişiklik içermediğini doğrular (`wrangler deploy` working tree'yi deploy eder, son commit'i değil — aksi halde hiçbir git commit'ine karşılık gelmeyen, izlenemeyen bir production versiyonu ortaya çıkar).

Doğrudan `wrangler deploy` bu üç kontrolü de atlar. 2026-08-23 remediation'ında tam olarak bu yolla — başka bir terminalden çıplak `wrangler deploy` çalıştırılarak — iki ek, commit'siz production deploy'u oluştu (bkz. commit `814c5aa7`, `deploy.sh`'taki working-tree guard'ı).

Deploy sonrası `deploy.sh` otomatik olarak `scripts/preflight-check.sh` (deploy öncesi), `scripts/health-check.sh` ve `scripts/smoke-test.sh` (deploy sonrası) çalıştırır — bunları ayrıca elle çalıştırmaya gerek yok, `deploy.sh` zaten zincirliyor.

### Uzak oturumdan / telefondan deploy

Claude Code'un **uzak** (web/telefon) oturumu izole bir konteynerde çalışır: Cloudflare kimlik bilgisi yoktur ve ağ politikası `api.cloudflare.com` ile `mimarlab.com` çıkışını reddeder (ölçüldü, 2026-09-12: CONNECT'e 403). Yani o oturumdan `./deploy.sh` çalıştırılamaz — yerel masaüstü oturumlarında çalışıyordu çünkü orada wrangler oturumu ve açık ağ vardı.

Bunun için `.github/workflows/deploy.yml` var: **`workflow_dispatch`** ile elle tetiklenir (GitHub web/mobil uygulamasında "Run workflow", ya da bir Claude oturumundan Actions API'si ile) ve runner **aynı `./deploy.sh`'i** çalıştırır — üç kapı, preflight, health-check ve smoke-test dahil. Çıplak `wrangler deploy` yolu bu kapsamda da kullanılmaz.

- Gereken tek kurulum: depo sırları **CLOUDFLARE_API_TOKEN** ve **CLOUDFLARE_ACCOUNT_ID** (GitHub → Settings → Secrets and variables → Actions). Gereken token izinleri workflow'un "sırlar tanımlı mı" adımında listelidir.
- Yalnızca `main` deploy edilebilir; eşzamanlı çalıştırmalar `concurrency` ile serileştirilir.
- **CI commit edileni yayınlar**, working tree'yi değil: yerelde duran ama commit edilmemiş bir asset canlı manifest'ten düşer. Yeni görselleri deploy'dan önce commit edin.

## Hesap üyeliği ile kişi profili AYRIDIR (2026-09-14)

Kullanıcı isteği: "kullanıcıların siteye üye oldukları bilgilerle kişi popuplarındaki bilgileri
ayırıyoruz, birbirleriyle entegre olmayacaklar."

- **Hesap (`users`)**: ad soyad, **kullanıcı adı** (`username`, @kaancorbaci), e-posta, şifre.
  (Avatar/profil fotoğrafı 2026-09-15'te kaldırıldı — bkz. aşağısı.)
  Hesabım başlığındaki "Profili Düzenle" YALNIZCA ad soyad + kullanıcı adını düzenler.
- **Kişi künyesi (`architects` / `architect_submissions`)**: doğum yılı, üniversite, meslek,
  pozisyon, ödüller, açıklama, sosyal medya, portfolyo. Hesabım'daki "Kişi Bilgileri" kutusu bunu
  admin'in atadığı onaylı `profile_claims('architect')` kaydından okur (atama yoksa kullanıcının
  kendi açtığı kişi kaydından); düzenleme kisi-ekle sayfasında yapılır (bkz. aşağısı).
- **Kaldırılan üç köprü** (geri gelirse ayrım sessizce bozulur; preflight bunu arıyor —
  `scripts/test-2026-09-14-account-person-split.mjs`):
  `src/lib/claimedProfiles.js#fillUserFromArchitectProfile`,
  `src/routes/submissions.js#syncOwnArchitectToAccount`,
  `js/components/auth-modal.js#syncClaimedArchitectData`.
- **İstisna KALMADI** (2026-09-15 madde 2): eskiden tek bilinçli istisna profil FOTOĞRAFIYDI (kişi
  formundan yüklenen görsel hesabın avatarına da yazılırdı). **Hesapların artık profil fotoğrafı
  yok** — bkz. aşağıdaki "Hesap profil fotoğrafı KALDIRILDI" başlığı.
- **Hesap ad soyadı TEKİL DEĞİL** (2026-09-14 ikinci tur): iki hesap aynı ad soyadı taşıyabilir;
  hesabın tek tekil tanıtıcısı `users.username`. Kişi dizini tekilliği (aynı adla yeni kişi
  paylaşımı) DEĞİŞMEDİ — o kapı `canonicalSync.js#isDuplicateCanonicalName`.
- **Hesap adı ile kişi künyesinin adı arasında HİÇBİR bağ yoktur**: sahiplik iki yoldan gelir —
  (a) admin ataması (`profile_claims('architect')`), (b) kaydı kendi hesabından açmış olmak
  (`architects.claimed_by_user_id`). Ad eşleşmesi (`name_fold = foldTr(user.name)`) her yerden
  kaldırıldı: `claimedProfiles.js#fetchOwnArchitectRows`, `submissions.js#isOwnArchitectRecord`,
  `kisi-ekle.html#isOwnAccountProfile` ve `maybeAutoFillFromAccount`. Ad eşleşmesi, hesap adları
  çoğalabildiği için artık bir SIZMA yolu olurdu (var olan bir kişinin adıyla üye olup onun firma
  bağlarını/görevlerini görmek).
- **Kendi-kendine-yayın kısayolu kaldırıldı**: yeni kişi kaydı (Hesabım'daki dizin akışı dahil)
  kisi-ekle.html ile AYNI admin moderasyon kuyruğuna girer — ad doğrulaması olmadan "bu kayıt
  benim" iddiasını doğrulamanın yolu yok.
- **Kişi künyesi Hesabım'dan DÜZENLENMEZ**: "Kişi Bilgileri" kutusundaki "Bilgileri Düzenle",
  firma düğmesiyle aynı desende `kisi-ekle` sayfasına gider (atanmış profil `?claim=<slug>`,
  kendi gönderisi `?edit=<id>&stype=architects`, kayıt yoksa boş form). Modal içindeki kişi formu
  yalnızca "Kişi sayfasında yer almak ister misin?" bildirimi/sorusundan açılır.
- **Şifre Değiştir + Hesabımı Sil** hesap kimliği pop-up'ındadır (başlıktaki "Profili Düzenle"),
  varsayılan kapalı; kişi formunda DEĞİL.
- **Kullanıcı adı kuralları TEK kaynakta**: `src/lib/username.js` (istemci kopyası
  `js/components/auth-modal.js#normalizeUsernameInput`, SQL kopyası
  `migrations/0119_users_username.sql`). Türkçe harfler ASCII'ye katlanır; giriş e-posta VEYA
  kullanıcı adıyla yapılabilir (`POST /api/auth/login`, ayrım "@" içeriyor mu).
- `migrations/0119_users_username.sql` mevcut TÜM hesaplara ad soyadlarından kullanıcı adı üretir
  ("Kaan Çorbacı" -> `kaancorbaci`, çakışmalar `.2`). **Bu migration KOD DEPLOY'undan ÖNCE
  uygulanmalıdır** (`.github/workflows/migrate.yml`): kolon yokken `getSessionUser`'ın SELECT'i
  hata verir.

## Gündem içeriklerini kaynaktan yeniden üretmek

Gündem kartlarındaki Türkçe **başlık ve özetler** kaynaktan yeniden üretilebilir:
`scripts/gundem-retitle-backfill.mjs`. Betik her satır için kaynağa geri gider, makalenin
`og:description`'ını **ve gövdesinden ilk paragrafları** (`src/lib/gundemArticleText.js`) alır,
güncel üretim zinciriyle (`src/lib/gundemAi.js`) başlık + özeti yeniden yazar ve kalite/
fact-consistency kapılarından geçirir.

- **Yalnızca** `title`, `summary`, `embedding`, `ai_generated_at`, `updated_at` yazılır. **Slug
  değişmez** (canlı `/gundem/<slug>` adresleri ve bülten bağlantıları kırılmaz); `published_at`,
  kaynak, görsel, kategori, mükerrer kayıtları ve admin durumu da değişmez.
- Varsayılan **dry-run**'dır; yazmak için `--apply`. Tam tarama için `--all` (yarıda kalırsa
  `--offset=N` ile sürdürülür).
- **Uzak (web/telefon) oturumdan çalıştırılamaz**: o konteynerden hem `api.cloudflare.com` hem de
  yayıncı siteleri (dezeen.com, archdaily.com...) ağ politikasıyla kapalıdır. Bunun için
  `.github/workflows/gundem-retitle.yml` var — `workflow_dispatch` ile tetiklenir, runner aynı
  betiği çalıştırır ve önce/sonra raporunu artifact olarak bırakır. Gereken sırlar deploy ile
  aynıdır (`CLOUDFLARE_API_TOKEN` — D1:Edit ve Workers AI:Edit izinleriyle —,
  `CLOUDFLARE_ACCOUNT_ID`).

## Proje künyesindeki "Kaynak" bağlantısı: agregatör YASAK (2026-09-14)

Kullanıcı isteği: "Hiçbir projenin kaynak kısmında arkitera, archello, archdaily, divisare gibi
linkler olmasın. Bu linkler varsa bunları sil ve mimarlık firmalarının websitelerinin linklerini
koy. Websiteleri yoksa da boş bırak. Zaten kişi veya firma kaydı olan bir fotoğrafçı varsa link
girme."

- **Tek kaynak**: `src/lib/aggregatorSources.js` — marka listesi (`AGGREGATOR_SOURCE_BRANDS`),
  süzgeç (`isAggregatorSourceUrl`) ve temizlik kararı (`planProjectSourceUrls`) orada. Eşleşme alan
  adı ETİKETİ üzerinden TAM yapılır, tam alan adı listesiyle değil — `archdaily.com.tr`,
  `plataformaarquitectura.cl` gibi yerel alan adları kendiliğinden kapsanır, `divisare-mimarlik.com`
  gibi gerçek bir firma adresi yanlışlıkla yakalanmaz.
- **Yazma kapısı**: `src/lib/canonicalSync.js#syncProject` — böyle bir adres `projects` tablosuna
  (`photo_credit_url` / `source_url`) HİÇ yazılmaz; hangi yoldan gelirse gelsin (üye gönderisi,
  admin düzenlemesi, AI akışı). Gönderi satırı (`project_submissions`) denetim izi olarak korunur.
- **Okuma kapıları**: `src/routes/project.js`, `src/lib/seo.js`, `src/lib/projectPool.js` +
  istemci kopyası `js/components/project-meta.js#isAggregatorSourceUrl`. D1'de kalmış eski bir değer
  künyede bağlantıya dönüşmez. İki kolondan biri agregatör, diğeri firmanın kendi sitesiyse
  firmanınki kullanılır (`firstUsableSourceUrl` — `a || b` bunu yapamazdı).
- **Mevcut veriyi temizleme**: `scripts/purge-aggregator-project-sources.mjs`, uzak (web/telefon)
  oturumdan ÇALIŞTIRILAMAZ (api.cloudflare.com kapalı) — bunun için
  `.github/workflows/purge-aggregator-project-sources.yml` var, `workflow_dispatch` ile tetiklenir.
  **Varsayılan dry-run**; yazmak için `apply=evet`. Betiğin kendi kararı yoktur, kuralı
  `planProjectSourceUrls`'ten okur.
- Testler: `scripts/test-2026-09-14-aggregator-source-links.mjs` (preflight'a bağlı). İstemci ile
  sunucudaki marka listeleri AYRIŞIRSA preflight kırmızı olur.

## Marka kavramı KALDIRILDI — her ofis kaydı FİRMA (2026-09-14)

Kullanıcı isteği: "Marka ve marka ekle sayfasını canlıdan kaldır. Hali hazırdaki markalar artık
firma olacak ama BİRİM Design markası hariç hepsi arşivde kalsın. Tüm markalar firmalar arasında
Üretim ve Satış hizmet alanı içerisinde olacak."

- **Tek karar noktası kapatıldı**: `office-kind.js#isPureBrandOffice` artık sabit `false` döndürüyor.
  Bu ayrımı 25'ten fazla dosya soruyordu (liste filtreleri, kanonik URL, arama, sitemap, analytics,
  takip, arşiv); hepsini sökmek yerine tek kaynak kapatıldı — her çağıran kendiliğinden "bu bir
  firmadır" davranışına geçti. `isBrandOffice` KORUNDU ve hâlâ anlamlı: "bu firma üretici mi".
- **Adresler 404 DEĞİL 301**: `/marka`, `/marka.html`, `/marka-ekle`, `/marka-ekle.html` tam
  eşleşmeyle, `/marka/:slug` önekle firma tarafına taşınır (`src/index.js`). `marka.html` ve
  `marka-ekle.html` silindi. `scripts/smoke-test.sh` üçünün de 301 döndüğünü deploy sonrası
  doğruluyor.
- **Hizmet alanı**: `OFFICE_SERVICE_CATS`'in 4. sırasında **'Üretim ve Satış'**. Bu seçilince
  firma-ekle.html'de kaldırılan marka-ekle'dekiyle aynı **Ürün Kategorisi** kutusu belirir
  (`office-kind.js#PRODUCT_CATS`, eski adıyla `BRAND_CATS`). Seçimler AYNI `cats` kolonuna yazılır —
  şema değişikliği yok, kaydetme/geri yükleme yolları değişmedi. Hizmet alanı geri alınırsa ürün
  kategorileri temizlenir (gizli veri sızmasın).
- **Mevcut veri**: `scripts/brands-to-offices.mjs` + `.github/workflows/brands-to-offices.yml`
  (`workflow_dispatch`, **varsayılan dry-run**, yazmak için `apply=evet`). Üretici kayıtların
  cats'ine 'Üretim ve Satış' ekler, BİRİM Design dışındakileri arşivde tutar (arşivleme canlı
  koddan — `runContentAction`), BİRİM Design'ı yayına alır.
- Testler: `scripts/test-2026-09-14-brand-removal-and-account-boxes.mjs` (preflight'a bağlı).

## Hesabım: Firma/Kişi kutuları dinamik (2026-09-14)

- Kullanıcının hiçbir bağı yoksa **iki kutu da hiç çizilmez** (`am-firm-section` /
  `am-person-section`, ikisi de `hidden` başlar). Firma kutusu `firmEntries`, kişi kutusu
  `personEntries` boş olmadığında açılır — kullanıcı içerik yüklediğinde ya da admin atama
  yaptığında kendiliğinden belirirler.
- **Kişi Bilgileri kutusu sayfalanır** (Firma kutusuyla aynı `renderDashPagination`): 1. sayfa
  kullanıcının kendi künyesi, sonraki sayfalar YETKİLİ olduğu firmaların kişileri (kurucu, kurucu
  ortak, ortak, ekip lideri). Kişiler `/api/office/:key`'in AYNI yanıtından okunur (ek uç/istek
  yok), bu yüzden firmadan çıkarılan biri kutudan da düşer. **"Bilgileri Düzenle" düğmesi HER
  sayfada aynı adı taşır** ve firma sayfalarında da görünür (kural 2026-09-15 üçüncü/dördüncü
  turda değişti — bkz. aşağıdaki başlık); sayfaya göre değişen tek şey düğmenin HEDEFİ.

## Hesap profil fotoğrafı KALDIRILDI (2026-09-15)

Kullanıcı isteği: "Kullanıcı profil fotoğrafı bölümünü kaldır. Kullanıcı hesapları için bundan
sonra profil fotoğrafı ekle kısmı olmayacak. Çekmece menüsünden, ana sayfadaki butondan ve hesabım
sayfasından da profil fotoğrafını kaldır. Kişi popupları kesinlikle bundan etkilenmesin."

- **KİŞİ künyesinin fotoğrafı AYRIDIR ve DURUR**: `architects.photo_url`, kisi-ekle.html ile
  Hesabım'daki "Kişi Bilgilerini Düzenle" formundan yüklenir, kişi pop-up'ında/sayfasında görünür.
  Bu değişiklik ona hiç dokunmaz (preflight bunu da arıyor —
  `scripts/test-2026-09-14-account-person-split.mjs`, "2026-09-15 madde 2" bölümü).
- **Yazma yolları kapatıldı**: `PATCH /api/profile` artık `photo_url` KABUL ETMEZ (alan
  `src/routes/auth.js#updateUserProfileFields`'in `fields` listesinde yok — admin'in üye düzenleme
  ekranı da aynı fonksiyondan geçer); sosyal giriş (Google/LinkedIn) sağlayıcının resmini ARTIK
  yazmaz (`upsertOAuthUser`); kişi formunun Kaydet'indeki "fotoğrafı hesabın avatarına da yaz"
  köprüsü kaldırıldı (`js/components/auth-modal.js`); hesabim.html'deki yükleme kutusu silindi.
- **Okuma/çizme yolları**: üst menüdeki hesap düğmesi, açılır menü başlığı ve mobil çekmecenin
  hesap bölümü (`auth-nav.js`) ile Hesabım başlığı (modal + hesabim.html) artık avatar dairesi
  ÇİZMEZ (baş harf dairesi de yok, düğme yalnızca adı taşır).
- **`users.photo_url` KOLONU DURUYOR** ve mevcut değerler SİLİNMEDİ (veri kaybı yok). Bu kolonu
  hâlâ okuyan içerik yüzeyleri bilinçli olarak değiştirilmedi: yorum avatarı (`src/routes/comments.js`
  — orada zaten kişi/firma künyesinin fotoğrafı önceliklidir), mesaj listesi (`messages.js`), firma
  ekip satırı (`office.js`), sahip künyesi (`ownerByline.js`), görüşme odası (`consultations.js`).
  Yeni değer yazılmadığı için bunlar zamanla baş harf yedeğine düşer.

## Kişi formundaki dizin sorusu KALDIRILDI (2026-09-15)

Kullanıcı isteği: "Kişi ekle/düzenle sayfasındaki 'Kişi sayfasında diğer profesyonellerle birlikte
görünmek istiyor musunuz?' kutusunu kaldır."

- Kutu **iki formdan da** çıkarıldı: `kisi-ekle.html` (`.listing-consent`) ve Hesabım modalindeki
  "Kişi Bilgilerini Düzenle" (`.am-listing-consent`).
- **`architects.directory_listed` kolonu ve /kisi dizin süzgeci DEĞİŞMEDİ**
  (`src/routes/architect.js`). Formlar alanı artık HİÇ GÖNDERMEZ; alan nullable olduğundan
  (`src/lib/submissionTypes.js`) mevcut kayıtlar kaydedilmiş tercihlerini korur, yeni kayıtlar kolon
  varsayılanıyla (dizinde görünür) açılır — kaldırılan sorunun varsayılanı da "Evet"ti.
- **Davranış değişikliği**: modaldeki kişi formunun Kaydet'i artık KOŞULSUZ yayımlar — zorunlu
  alanlar (Ad Soyad, Meslek, Açıklama, Profil Fotoğrafı) ve Telif Beyanı her zaman aranır. Forma
  zaten yalnızca "Kişi sayfasında ... yer almak ister misin?" bildiriminden gelindiği için
  (`openDirectoryPrompt`) bu, o akışın "Evet" dalıyla aynı davranıştır.
- Bir profili dizinden çıkarmak artık yalnızca admin işidir (doğrudan D1).

## Kaydı ekleyen, o kaydın yöneticisidir (2026-09-15)

Kullanıcı isteği: "bir kullanıcı siteye yeni bir kişi veya firma eklerse otomatik olarak o kişi ve
firma profilinin yöneticisi olsun ve hesabım sayfasındaki kutularda kişi ve firma profili gözüksün."

- **Yetkinin kaynağı `claimed_by_user_id`** (gönderinin `owner_user_id`'si; `resolveClaimedByUserId`
  admin'in eklediklerinde NULL bırakır, yani bu kapı admin'e hiçbir şey açmaz). Ad eşleşmesi YOK —
  2026-09-14 ikinci tur madde 3'teki sızma gerekçesi aynen geçerli.
- **Sunucu kapıları** (`src/lib/claimedProfiles.js`): `fetchOwnCreatedOfficeRows`,
  `canEditOfficeAsCreator`, `canEditArchitectAsCreator`. `verifyClaimedProfileKey`'in 4. ve 5. yolu
  olarak bağlıdır; `fetchUserEditableOfficeRows` (a3) ve `/api/claims/status`'ın `delegatedEdit`'i de
  bunları okur, yani buton ile sunucu kapısı ayrışamaz.
- **İptal edilebilir**: Hesabım > Yetkili Kullanıcılar'daki X (profile_claims `revoked`) bu yolu da
  kapatır. Kişi tarafında ise BAŞKA bir hesaba onaylı atama varsa kapı kapalıdır (admin ataması,
  kaydı açmış olmanın üzerindedir).
- **Hesabım kutusu**: `/api/claims/mine` yeni bir **`ownOffices`** alanı döndürür — onaylanmış
  (canonical) kayıtlar `canEdit: true`, kullanıcının onay bekleyen kendi firma gönderisi ise
  durum satırıyla görünür (kutu, kayıt eklenir eklenmez belirsin diye). `officeLinks`'e KARIŞTIRILMAZ:
  o alan "bu kişi bu firmada görevli" demektir ve kişi künyesinin Firma kutusunu besler — bir firmayı
  siteye eklemiş olmak orada çalışmak anlamına gelmez.
- Kişi tarafı zaten çalışıyordu (kendi gönderisi kutuyu besliyor, `?edit=<id>` ile düzenleniyor);
  eklenen tek şey aynı kaydın canonical yoluna (`?claim=<slug>`) da yetki vermek.

## Proje künyesindeki TÜM adlar filtrelerde (2026-09-15)

Kullanıcı isteği: "Proje sayfasındaki mimar filtresinde projelerin mimar künyesinde yazan tüm
isimler görülmeli."

- **Kök neden**: `project_designers` şema gereği (CHECK) yalnızca sitede KAYDI OLAN mimar/firmalar
  için satır taşıyabilir; proje-ekle'ye yazılan eşleşmeyen adlar `resolveArchitectLink`/
  `resolveOfficeLink`'ten null dönüp sessizce atlanıyordu. Pop-up künyesi onları zaten gösteriyordu
  (`fetchRawDesignerNames`), liste/filtre göstermiyordu.
- **Çözüm**: `projects.designer_names_raw` / `projects.office_names_raw` (JSON dizi, bkz.
  `migrations/0120_project_designer_names_raw.sql` — **kod deploy'undan ÖNCE uygulanmalı**,
  havuz sorguları kolonları açıkça seçiyor). `products.brand_name_raw` ile aynı desen.
- `syncProject` bunları künye yazımıyla **AYNI batch'te** tazeler (ayrışmasınlar);
  `shapeProjectItem` eşleşen adlarla birleştirip `foldTr` ile tekilleştirir — canonical yazım kazanır.
  Ham FİRMA adları hem `designer`'a hem `officeNames`'e girer, böylece Mimar filtresi
  (`designer` eksi `officeNames`) firma adlarını almaz.
- `project_designers` DEĞİŞMEDİ: profil çipleri/bağlantıları hâlâ oradan gelir, bu kolonlar yalnızca
  "künyede ne yazıyordu" sorusunun cevabıdır.

## Hesabım: mobil başlık + firma yetkilisinin kişi düzenlemesi (2026-09-15, üçüncü tur)

Kullanıcı isteği: (1) "Mobilde hesabım sayfasındaki 'Hoş Geldin, Kaan Çorbacı' yazısının puntosunu
biraz küçült.", (2) "admin panelinden bir firmaya bir kullanıcıyı yönetici olarak atadığı zaman o
kullanıcının hesabım sayfasında kişi bilgileri bölümünde görülen diğer kişi sayfalarında da profili
düzenle butonu görünsün. Yönetici bu butona tıklayarak firmadaki tüm kişilerin popuplarını
düzenleyebilsin."

- **Başlık**: `.dash-head h1` 26px -> **mobilde (<=720px) 20px**; masaüstü ölçüsü değişmedi. Kural
  İKİ yüzeyde de var (Hesabım modali `js/components/auth-modal.js`, bağımsız sayfa `hesabim.html`).
- **Düğme firma sayfalarında da var**: "Kişi Bilgileri" kutusunun FİRMA sayfalarında düğme artık
  görünür ve `kisi-ekle?claim=<kişinin slug'ı>` açar — firma pop-up'ındaki "Düzenle" ile **aynı
  yol** (bkz. `js/components/claim-correction-box.js`). Yeni bir düzenleme yolu AÇILMADI; var olan
  yol Hesabım'dan da erişilebilir oldu.
- **Etiket TEK**: düğme her sayfada **"Bilgileri Düzenle"** yazar (kullanıcı isteği, dördüncü tur:
  "kişi bilgileri kutusundaki tüm bilgilerin üstündeki butonların ismi Bilgileri Düzenle olsun").
  Üçüncü turda firma sayfalarına kısa süre "Profili Düzenle" yazılmıştı; kutu sayfa değiştirdikçe
  düğmenin adı da değişiyordu. Etiket TEK yerde yazılır (`renderPersonPage`), dallar yalnızca
  hedefi ve görünürlüğü belirler.
- **Yetki istemcide yeniden hesaplanmaz**: kutunun firma sayfaları zaten yalnızca
  `canManageFirmEntry`den geçen firmaların kişilerinden oluşur (yönetici/kurucu/kurucu ortak/ortak/
  ekip lideri ya da kaydı siteye ekleyen). Sunucu AYNI kararı kendi kapısında tekrar verir:
  `src/routes/submissions.js#verifyClaimedProfileKey`in üçüncü yolu ->
  `claimedProfiles.js#canEditArchitectViaOfficeMembership` (düzenleme yolları `DELEGATED_ACCESS`
  ile çağırır, yani profil başka bir hesaba ait olsa da düzenlenebilir; **arşivle/sil** bayrağı
  geçmez, o sınır duruyor).
- **Sitede kaydı olmayan ad** (künyenin Kurucular/Ekip kutusuna serbest metin yazılmış, `slug` yok)
  için düğme gizlidir: `?claim=` canonical bir satır ister.
- Testler: `scripts/test-2026-09-15-account-title-and-firm-person-edit.mjs` (preflight'a bağlı).

## Filtrelerde Mimar / Firma ayrımı (2026-09-15, ikinci tur)

Kullanıcı isteği: "Proje sayfasındaki filtrelerde mimar kısmında sadece mimar künyesindeki isimler
yer alacak. Firma kısmında ise sadece mimarlık firması künyesindeki isimler yer alacak. Şu an
filtrelerde firma isimleri mimar kısmına karışmış gözüküyor."

- **Kök neden**: yukarıdaki "TÜM adlar filtrelerde" turu ham künye adlarını filtrelere soktu ve iki
  ad kümesini birden **Mimar** tarafına düşürdü: (1) 0030 öncesi **tek kutulu** gönderilerde mimar +
  firma adları `project_submissions.designer` içinde birlikte duruyor (`office` NULL, 0120 geri
  dolumu onu olduğu gibi kopyalar) — pop-up künyesi orada `isOfficeName()` sezgisiyle ayırıyordu,
  filtre ayırmıyordu; (2) firma adı **Mimar kutusuna** yazıldığında `resolveArchitectLink` yalnızca
  `architects`e baktığı için eşleşme bulunamıyor, ad `project_designers`'a hiç yazılamıyor ve ham
  listeye Mimar olarak düşüyor.
- **Karar sırası** (`src/lib/projectPool.js#officeNamesInDesignerBox`): (a) ad `project_designers`'ta
  MİMAR olarak bağlıysa asla taşınmaz, (b) sitede o adla bir `offices` kaydı varsa (arşivdekiler
  dahil, `fetchOfficeNameFolds`) firmadır, (c) yalnızca eski **birleşik** kutuda `isOfficeName()`
  sezgisi — modern gönderide kullanıcının hangi kutuya yazdığı kesin bilgi olduğundan sezgiye HİÇ
  başvurulmaz (bkz. 2026-08-19 "+MURAT TABANLIOĞLU" bulgusu).
- Taşınan ad `designer` listesinden ÇIKMAZ (künyenin tamamı; arama ve kart altyazısı onu okur),
  yalnızca `officeNames`e eklenir — Mimar filtresi zaten "designer eksi officeNames"tir ve bu
  çıkarma artık `foldTr` ile yapılır (yazım farkı sızıntıya yol açmasın).
- **Sınır**: `officeNameFolds` YALNIZCA filtre havuzuna (`fetchActiveProjectPool`) geçirilir; tekil
  proje/sayfa sorgularının yanıt şekli değişmedi.
- **facet_counts sürümlendi** (`FACET_SHAPE_VERSION`, `projects:v2`): sayaçlar D1'de kalıcıdır ve
  yalnızca bir içerik yazımında tazelenir — sürüm olmasaydı eski (firma adlarını Mimar altında
  taşıyan) satırlar filtresiz ilk sayfa yüklemesinde servis edilmeye devam ederdi.
- **Sayaçlar boşken uç KENDİNİ ONARIR** (gerçek bulgu, dördüncü tur — deploy #70'in sağlık kontrolü
  "/proje -> kabuk HIT ama `#ml-list-data` yok" ile KIRMIZI döndü): tablo boşken
  `/api/projects/filters` her istekte tam taramaya düşüyordu ve `/proje`'nin SSR verisi o ucu
  **`HUB_SSR_TIMEOUT_MS = 2000 ms`** ile çektiğinden (bkz. `src/index.js#HUB_SSR/loadHubListData`)
  soğuk havuzda `#ml-list-data` sayfaya HİÇ yazılmıyordu. Uç artık tablo boşsa sayaçları
  **`ctx.waitUntil`** ile bir kez yeniden hesaplayıp yazar (yanıtın gecikmesi değişmez, yazma yanıt
  sonrası da yaşar); `scripts/health-check.sh` de ölçümden önce ucu bir kez ısıtır. "İlk içerik
  yazımında dolar" varsayımı bu SSR yolunu hesaba katmıyordu.
- Testler: `scripts/test-2026-09-15-architect-office-filter-split.mjs` (preflight'a bağlı).

## proje-ekle: firma kutusuna elle isim (2026-09-15)

- `office-picker.js` yeni **`allowCustom`** seçeneği: arama kutusuna yazılan ve listede karşılığı
  olmayan ad "+ «...» ekle" satırıyla (ya da Enter'la) seçime katılır.
- **ARTIK ÜÇ YÜZEYDE DE AÇIK** (2026-09-15 yedinci tur — aşağıdaki başlık): kisi-ekle ve Hesabım'ın
  kişi formu bu turda kapalı bırakılmıştı; gerekçe ("serbest metin, `ensurePendingOfficeClaims`
  zincirini karşılığı olmayan bir adla doldurur") canlı kodda doğrulandı ve GEÇERSİZ çıktı: o
  fonksiyon `if (!canonical) continue;` ile eşleşmeyen ada talep satırı AÇMIYOR.
- Girilen ad künyeye yazıldığı gibi kaydedilir; firma kaydı olmadığından tıklanabilir bir profil
  çipi oluşmaz ama isim künyede ve /proje filtrelerinde görünür (yukarıdaki madde).

## Hesap ekranlarında marka kalıntıları (2026-09-15)

Kullanıcı isteği: "hesabım, koleksiyonum ve aktivitelerim sayfalarındaki marka butonlarını kaldır."

Filtre sekmeleri 2026-09-14'te zaten kaldırılmıştı; bu turda kalan kalıntılar temizlendi:
Koleksiyonum > Takip Ettiklerim boş durumundaki "Markalara göz at" düğmesi (artık Firmalara),
Hesabım > Firma Bilgileri kutusunun `/marka/:slug` bağlantısı (artık her zaman `/firma/`),
firma seçim listesindeki "Marka" rozeti (`office-picker.js`) ve kalan "firma/marka", "markalar"
metinleri. Sunucu `is_brand`/`is_pure_brand` göndermeye devam ediyor (başka çağıranları var),
hesap ekranlarında okunmuyor.

## Üst menüdeki hesap düğmesi + kullanıcı adı satırı (2026-09-15, beşinci tur)

Kullanıcı isteği: "Masaüstü görünümünde hesaba giriş yapınca ana menüdeki hesap ismi yazan butonu
... giriş yap butonu gibi koyu mavi yap ve üzerindeki isim yazısı beyaz olsun. Ayrıca ismin soluna
ortaya bir nokta işareti koy. Açılınca çıkan ekranda ismin altında kullanıcı adı, onun da altında
e-posta adresi olsun. Tablet ve mobil görünümde de açılan çekmecede isim soyisim ve e-posta
adresinin arasına kullanıcı adını yaz." + eki: "ana menüde çıkan ismin büyük harflerle yazılması ve
yanındaki sayfa başlıklarıyla aynı puntoda olması ... alt menüdeki ve yan çekmecede açılan isim ve
soyisim tamamen büyük harflerden oluşsun."

- **Hepsi TEK dosyada**: `auth-nav.js` — hem masaüstü `.nav-avatar` düğmesi/açılır menüsü hem mobil
  çekmecenin hesap bölümü (`nav-mobile-menu-foot`) oradan çizilir.
- **Düğme**: `background:var(--ink)` + `color:var(--paper-card)` (referans: her sayfanın KENDİ
  `<style>`'ındaki `.nav-rate:hover`, yani "Giriş Yap"ın dolu hâli), punto 13.5px -> **14.5px**
  (`.nav-link` ile aynı). Adın solunda `.nav-avatar-dot` — dekoratif, her zaman görünür; sağ üst
  köşedeki **turuncu** `.nav-avatar-alert` (bildirim/mesaj) ondan AYRI ve halkası artık `var(--ink)`
  (düğmenin arka planı).
- **BÜYÜK HARF, CSS ile DEĞİL JS ile** (`upperTr`): `text-transform:uppercase` tarayıcının Türkçe
  yerel verisine bağlıdır, "i" -> "I" üreten bir ortamda "İstanbul" -> "ISTANBUL" olurdu. Dönüşüm
  HTML kaçışından ÖNCE çağrılır (`escapeHtml(upperTr(x))`) — tersi "&amp;"yi "&AMP;"ye çevirirdi.
- **Kullanıcı adı satırı** ad ile e-posta ARASINDA, iki yüzeyde de. Kaynak `/api/auth/me`'nin
  `username` alanı (bkz. `src/lib/auth.js#publicUser`); "@" ön eki yalnızca ekranda eklenir (saklanan
  değerde yoktur, bkz. `src/lib/username.js`). Kolonu boş eski hesapta satır HİÇ çizilmez.
- **Üç satırın arası** (altıncı tur: "Çok birbirleri içerisine geçmişler."): aralık, satırlara tek
  tek margin vererek DEĞİL, kapsayıcıya (`.nav-avatar-menu-id` / `.nav-mobile-account-id`)
  `display:flex; flex-direction:column; gap` ile verilir — kullanıcı adı satırı KOŞULLU olduğundan
  margin, iki ve üç satırlı hâllerde farklı sonuç verirdi. `line-height:1.35` ayrıca açıldı: asıl
  sıkışıklığı, satırlar BÜYÜK HARF olduğu hâlde varsayılan satır yüksekliğinde kalmaları yaratıyordu.
- Testler: `scripts/test-2026-09-15-account-button-and-designer-picker.mjs` (preflight'a bağlı).

## proje-ekle: Mimar kutusu da çoklu seçim + elle giriş (2026-09-15, beşinci tur)

Kullanıcı isteği: "Proje ekle/düzenle sayfasında firma seçiminde yaptığın gibi mimar seçiminde de
siteye yüklü kişiler arasından çoklu seçim yapılabilsin, ayrıca manuel olarak elle de giriş
yapılabilsin. Aynı firma kutucuğunda yaptığın gibi."

- **`office-picker.js` genelleştirildi**: gövde artık `createNamePicker(mount, {optionsUrl, ...})`;
  iki sarmalayıcı aynı davranışı iki uca bağlar — `createOfficePicker` (`/api/offices/names`) ve
  **`createArchitectPicker`** (`/api/architects/names`). Ayrı bir dosya AÇILMADI: iki kopya, çoklu
  seçim/arama/elle ekleme/Türkçe katlamayla tekilleştirme davranışının ayrışacağı tek yer olurdu.
  Kaynak listesi artık URL başına önbelleklenir (`optionsPromises` Map'i).
- **Yeni uç `GET /api/architects/names`** (`src/routes/architect.js#handleArchitectNamesRoute`).
  `fetchArchitectPool` KULLANILMAZ: o havuz /kisi DİZİNİNİN havuzudur ve `directory_listed = 1` ile
  'Bilinmiyor'u dışarıda bırakır — künyeye eklenebilirlik dizinde görünmekten bağımsızdır
  (`/api/architects/search` de aynı gerekçeyle filtrelemez). Görünürlük kapısı arama ucuyla birebir
  aynı; adlar `foldTr` ile tekilleştirilir.
- **`#p-designer` gizli input olarak KALDI** (`#p-office` ile birebir aynı desen): gönderim ve tüm
  prefill yolları (düzenleme, ?claim=, AI, firma üyeleri, kendi firması) onun virgüllü değerini
  okumaya/yazmaya devam eder ve **yazan her nokta `syncDesignerPicker()` çağırır**. Test bunu
  dosyadaki HER yazma noktası için ayrı ayrı doğrular.
- `allowCustom: true` — sitede kaydı olmayan bir mimar adı da künyeye yazılabilir (eski serbest
  metin kutusunun kaybolmaması gereken tek yeteneği).

## Bir projede aynı ad künyeye İKİ KEZ yazılamaz (2026-09-15, beşinci tur)

Kullanıcı isteği: "Bazen kullanıcılar bir projede ekle/düzenle sayfasında ... mimar kısmında
isimlerini 2 kere yazabiliyorlar. Bunun önüne geç ... Türkçe ve İngilizce karakterler farklı olduğu
için yazılabilmiş ama bunu da engelle."

- **KÖK NEDEN** (canlıdaki "Messe Tekstil Showroom Ofisi"): künyede hem "Ayça Akkaya Kul" hem "Ayca
  Akkaya Kul" duruyordu. İlk yazım `architects`te eşleşip profil çipi oluyor, ASCII yazım hiçbir
  kayda bağlanamadığı için AYNI künyeye ikinci kez `unregistered` ham ad rozeti olarak ekleniyordu.
  Tekilleştirmelerin hepsi birebir metin ya da `toLowerCase()` karşılaştırmasıydı — ikisi de
  "ç"/"c", "ş"/"s", "ğ"/"g", "ı"/"i" ayrımını KORUR.
- **Tek anahtar `foldTr`** (sitenin her yerindeki "aynı ad" tanımı: `name_fold`, arama, filtre
  ayrımı). Ortak yardımcı: `src/lib/textMatch.js#dedupeNamesTr` — trim + `foldTr`, **İLK yazımı**
  korur.
- **DÖRT kapı**:
  1. Form kutusu — `office-picker.js` seçimi zaten `foldTr` ile tekilleştirir (çip, onay kutusu ve
     "+ «...» ekle" satırı dahil); `proje-ekle.html`'deki yerel karşılaştırmalar da artık
     `foldTrLocal` kullanır (`toLowerCase()`/`toLocaleLowerCase('tr')` DEĞİL).
  2. Gönderi yazımı — `src/lib/submissionTypes.js#nameArrayFields` (`designer`, `office`):
     `normalizeSubmission` bu iki alanı `dedupeNamesTr`'den geçirir, yani formdan geçmeyen yollar
     (admin paneli, ?claim= akışı, AI ile ekleme) da kapsanır.
  3. Canonical yazım — `src/lib/canonicalSync.js#syncProject` listeyi bir kez tekilleştirip ÜÇ
     tüketiciye birden verir: `project_designers` bağları, `designer_names_raw`/`office_names_raw`
     ve düzenleme yetkisi damgası. Bu kapı, bu değişiklikten ÖNCE kaydedilmiş mükerrer gönderileri
     de her yeniden senkronda temizler.
  4. Künye OKUMASI — `src/routes/project.js`'teki `knownNames` artık `foldTr` anahtarlı. Yazma
     kapıları yalnızca bundan sonrasını temizler; D1'de hâlihazırda duran mükerrer adlar bu kapı
     sayesinde ilk görüntülemede künyeden düşer.
- Testler: `scripts/test-2026-09-15-account-button-and-designer-picker.mjs` (preflight'a bağlı).


## Form seçim kutuları: dört form da aynı bileşende (2026-09-15, yedinci tur)

Kullanıcı isteği (dört madde, hepsi aynı cümleye dayanıyor — "aynı proje sayfasındaki gibi"):
firma-ekle'deki Kurucular/Ekip, urun-ekle'deki Firma/Tasarımcı ve proje-ekle'deki Fotoğrafçı
kutuları da siteye yüklü kayıtlardan **çoklu seçim** + listede yoksa **elle yazma** olsun;
kisi-ekle'nin firma kutusuna da elle isim girilebilsin.

- **ORTAK SÖZLEŞME**: her kutu, yerini aldığı görünür metin kutusunun kimliğini bir
  `type="hidden"` input olarak KORUR (`#o-founders`, `#o-team`, `#u-brand`, `#u-designer`,
  `#p-credit-text` — `#p-office`/`#p-designer` ile birebir aynı desen) ve **o input'a yazan HER
  nokta kutuyu senkronlar**. Böylece gönderim/prefill/AI yollarının hiçbiri değişmedi. Sözleşme
  bozulursa kullanıcının gördüğü çipler ile gönderilen değer sessizce ayrışır — preflight bunu
  dosya başına, her yazma noktası için ayrı ayrı arıyor
  (`scripts/test-2026-09-15-form-pickers.mjs`).
- **GİZLİ INPUT İKİ TUZAK GETİRİR, ikisi de kapatıldı**:
  1. Programatik `.value =` ATAMASI hiçbir olay tetiklemez — o input'u dinleyen mevcut kodlar
     sessizce çalışmaz olurdu (gerçek örnek: `urun-ekle.html#DuplicateNameCheck`, Firma kutusunu
     `input`/`blur` ile izliyor). `office-picker.js#pushToInput` artık her yazmada
     `new Event('input', {bubbles:true})` yayar.
  2. `type="hidden"` inputlar tarayıcının `required` doğrulamasından MUAFTIR. urun-ekle'deki Firma
     zorunluluğu bu yüzden submit handler'da elle kontrol edilir (proje-ekle'nin Fotoğrafçı
     guard'ıyla aynı desen). Sunucu tarafı karşılık: `submissionTypes.js#required`.
- **`office-picker.js` iki yetenek kazandı**:
  * `optionsUrls` (dizi) — kaynaklar TEK listede birleşir, `foldTr` ile tekilleşir. Kaynaklar ayrı
    ayrı önbelleklendiğinden (`optionsPromises` Map'i) aynı uç iki kutu için iki kez çekilmez.
    Sarmalayıcı: **`createPersonOrOfficePicker`** (kişi + firma).
  * `single` — seçimi TEK değerle sınırlar (radio, "+ ekle" satırı ve programatik `set` dahil).
- **urun-ekle'de Firma TEK seçimdir, Tasarımcı çoklu.** Bu bir tercih değil şema gereği: bir ürünün
  üreticisi tek kayıttır (`products.brand_office_id` TEK kolon) ve /urun marka filtresi, ürün
  pop-up'ının marka çipi, `products.brand_name_raw` üzerinden kurulan ürün→marka→proje zinciri
  (bkz. `project.js#fetchProjectProducts`) hep o tek değeri okur. Çoklu seçim "A, B" gibi hiçbir
  firmayla eşleşmeyen bir marka adı üretip ürünü markasız bırakırdı.
- **Fotoğrafçı kutusu TEK listedir** (kullanıcı isteği: "ayrı bir kutucuk olarak ayırma"): kişi +
  firma adları birlikte listelenir. Bu, sunucunun zaten yaptığı ayrımsızlığın forma yansımasıdır —
  künyedeki "Fotoğraf" satırı hem `architects` hem `offices` eşleşmelerini gösterir (bkz.
  `project.js#photographerDetails` + `photographerOffices`). "Kaynak'ı seçilen firmanın web
  sitesiyle doldur" davranışı korundu, yalnızca tetikleyicisi kutuya YENİ eklenen adlar oldu;
  prefill/AI yollarında susturulur ki kayıtlı `photo_credit_url` ezilmesin.
- **firma-ekle'de Kurucular + Ekip yan yana**: ayrı bir kural yazılmadı, ikisi sayfanın KENDİ
  `.form-row` ızgarasına alındı (`1fr 1fr`, `<=720px` tek sütun) — yani masaüstü ve tablette yan
  yana, mobilde alt alta.
- **Kaynak ipucundaki agregatör cümlesi silindi** (kullanıcı isteği). **Kuralın kendisi DURUYOR**:
  arkitera/archello/archdaily/divisare gibi bir adres canonical kayda hâlâ hiç yazılmaz
  (`canonicalSync.js` -> `aggregatorSources.js#dropAggregatorSourceUrl`). Kaldırılan yalnızca
  uyarı metniydi.
- **Ölü kod düştü**: proje-ekle ve firma-ekle'deki `wireAutocompleteLive` (+ yalnızca onun
  kullandığı `lastCommaSegment`/`replaceLastCommaSegment`) ile urun-ekle'deki
  `wireOfficeSuggest`/`loadOfficeNames`/`foldTrUrun` çağrısız kaldı ve silindi. urun-ekle'de
  `wireAutocompleteLive` KALDI — "Kullanılan Projeler" kutusu onu kullanmaya devam ediyor.

## DANIŞMANLIK sayfası — /danismanlik (2026-09-15, sekizinci tur)

Kullanıcı isteği: "DANIŞMANLIK diye bir sayfa tasarla. Aynı kişi sayfası gibi olsun, sol tarafta
filtreler ve filtrelerin en altında Danışman Ol butonu olsun. Sayfayı yayına al ama hiçbir menüye
ekleme. Danışman olarak Kaan Çorbacı'yı koy ve Kaan Çorbacı'nın profilindeki Danışmanlık Al
butonundaki bilgileri kullan."

- **Sayfa `danismanlik.html`** — kisi.html'in kabuğu (nav/breadcrumb/page-head/kenar çubuğu/sonuç
  barı/sayfalama/altbilgi + TÜM breakpoint'ler) birebir aynı. Kişi DETAY görünümüne ait iki blok
  alınmadı (`.ssr-entity` ve `pm-boot-loading` "boot veil"i): bu sayfanın iç içe bir `/danismanlik/:slug`
  yolu YOK, dolayısıyla `<head>`'deki prefetch/veil shim'i de yok.
- **Kart, kişi kartı DEĞİL**: bir portre değil bir TEKLİF taşıyor (tanıtım cümlesi, süre, uygun
  gün/saatler, ücret, "Danışmanlık Al"). Izgara bu yüzden 4 sabit sütun değil
  `auto-fill, minmax(340px, 1fr)` — tek danışmanda satırı doldurur, danışman çoğaldıkça sütunlanır.
- **KİMİN DANIŞMAN OLDUĞU SAYFADA YAZMAZ**: liste, randevu talebini kabul eden kapının
  (`src/routes/consultations.js#ALLOWED_HOST_SLUGS`) TA KENDİSİNDEN türetilir —
  `GET /api/consultants` (`handleConsultantsRoute` -> saf gövde `fetchConsultantList`). Sayfaya elle
  bir slug yazılsaydı kapı değiştiği gün sayfa çalışmayan bir kart gösterirdi.
  `directory_listed` kapısı bu sorguda BİLEREK YOK (`/api/architects/names`'teki AYNI gerekçe):
  danışman olmak, /kisi dizininde listelenmekten bağımsızdır.
- **Teklif bilgilerinin hepsi `offer` alanından gelir** ve o alan akışı DOĞRULAYAN sabitleri okur:
  `CONSULTATION_PRICE_TRY`, `ALLOWED_WEEKDAYS`, `ALLOWED_TIMES` (consultations.js) +
  `CONSULTATION_DURATION_MIN`, `CONSULTATION_TIMEZONE` (consultationMeet.js). Sayfada ücret/süre/
  saat/gün SABİTİ YOKTUR — preflight bunu ayrı ayrı arıyor.
- **Tanıtım cümlesinin tek kaynağı** `consultations.js#consultationIntro`. `consultation-modal.js#open`
  artık opsiyonel bir `intro` alır; danismanlik.html uçtan geleni geçirir, kişi pop-up'ındaki
  "Danışmanlık Al" HİÇBİR ŞEY geçirmez ve modalin kendi (birebir aynı) cümlesine düşer — yani o
  akışın davranışı DEĞİŞMEDİ. İki cümlenin ayrışmasını test kelepçeler.
- **"Danışmanlık Al" AYNI modaldir** (`ConsultationModal.open({hostSlug, hostName, intro})`); yeni
  bir randevu yolu AÇILMADI. Modül bu sayfada doğrudan `<script defer>` ile yüklenir (kişi
  sayfasında lazy-modals zincirinin `deferredDeps`'inden geliyordu).
- **"Danışman Ol"** kenar çubuğunun EN ALTINDA, "Kişi Ekle" ile aynı yuvada (`.sidebar-add`).
  Hedefi **`/iletisim`**: siteye kendi kendine danışman ekleyen bir akış YOKTUR ve olmamalıdır —
  randevu kapısı elle küratörlüdür.
- **HİÇBİR MENÜDE YOK** (kullanıcı isteği): `js/components/site-chrome.js`'e DOKUNULMADI; sitedeki
  hiçbir sayfa `/danismanlik`'a `<a href>` ile bağlanmıyor. Sayfa `noindex` DEĞİL, bu yüzden
  "indexlenebilir ama sitemap'te yok" çelişkisi oluşmasın diye `SITEMAP_STATIC_PAGES`'e eklendi —
  keşif yolu budur. `/danismanlik.html` -> `/danismanlik` 301.
- **Filtre/sıralama/sayfalama İSTEMCİDE**: havuz tanımı gereği avuç içi kadar olduğundan
  `/api/consultants` tüm listeyi tek istekte döner; sayaçlar da aynı havuzdan hesaplanır
  (kisi.html'deki "0 kişilik seçenek çizilmez" kuralı korunur). Temiz sayfalama adresi
  (`/danismanlik/sayfa-2`) BİLEREK YOK — sunucu tarafında ayrıca tanınmayı gerektirirdi
  (`PAGED_LIST_BASES`) ve bu havuzda ikinci sayfa pratikte hiç oluşmaz; sayfa `?page=N` kullanır.
- Testler: `scripts/test-2026-09-15-danismanlik-page.mjs` (preflight'a bağlı) + `smoke-test.sh` 13b
  (canlıda 200, kabukta filtreler + Danışman Ol, `/api/consultants` dolu, ana sayfada bağlantı YOK).

## Danışman kadrosu VERİTABANINA taşındı + Danışman Ol (2026-09-15, dokuzuncu tur)

Kullanıcı isteği (dört madde): (1) "Danışmanlık Al butonunda ... Talebi Gönder butonunun ismini
'Ödeme Sayfasına İlerle' yap ve bu butona tıklayınca ödeme ekranı açılsın. 2 tane ödeme seçeneği
çıksın 1- Havele / Eft 2- Kart ile Ödeme (Henüz aktif değil.)", (2) "Danışman Ol sayfasını tasarla
... hali hazırda kişi profilleri varsa bunu seçebilsinler ve bilgiler otomatik olarak doldurulsun.
Bu sayfada kişiler kaç dakikalık görüşme verebileceklerini (30, 45 veya 60dk), bu görüşme
saatlerinin kaç TL olduğunu ve hangi tarihlerde müsait olduklarını seçsinler. Ayrıca hangi alanda
danışmanlık verdiklerini vs. bilgi olarak yazsınlar.", (3) Google Meet entegrasyonu, (4) deploy.

- **KÖK DEĞİŞİKLİK — `consultants` tablosu** (`migrations/0121_consultants.sql`, **kod
  deploy'undan ÖNCE uygulanmalı**): "kim danışmandır" sorusunun cevabı artık kaynak kodda değil
  D1'de. Eskiden `consultations.js#ALLOWED_HOST_SLUGS` tek elemanlı bir Set'ti ve teklifin tamamı
  GLOBAL sabitti (`CONSULTATION_PRICE_TRY`, `CONSULTATION_DURATION_MIN`, `ALLOWED_WEEKDAYS`,
  `ALLOWED_TIMES`) — yani yeni danışman eklemek DEPLOY gerektiriyordu ve iki danışman farklı
  süre/ücret sunamıyordu. Migration mevcut tek danışmanı bugünkü teklifiyle tabloya taşır.
- **Sabitler SİLİNMEDİ, VARSAYILAN oldular**: `src/lib/consultants.js#DEFAULT_OFFER` tek kaynak;
  `consultations.js` ve `consultationMeet.js` değerlerini oradan okur. Satır okunamazsa teklifin
  ALANLARI varsayılana düşer — ama **kapı asla düşmez**: `fetchApprovedConsultant` yalnızca
  `status='approved'` döner.
- **Bağımlılık yönü**: `consultants.js` → `claimedProfiles.js`. `consultationMeet.js` ve
  `architect.js` ondan okur; `CONSULTATION_TIMEZONE`'un tanımı bu yüzden consultants.js'e taşındı
  (consultationMeet.js yeniden dışa aktarır). `architect.js` ↔ `consultations.js` arasında
  **döngü kurmayın** — `publicOffer`/`consultationIntro` bu yüzden lib'de durur.
- **Süre artık RANDEVUNUN KENDİSİNDE** (`consultation_requests.duration_min`, `price_try` ile aynı
  gerekçe): danışman süresini sonradan değiştirirse geçmiş randevuların Meet etkinliği ve odanın
  katılım penceresi geçmişe dönük KAYMAZ. Tek okuma noktası
  `consultationMeet.js#consultationDurationMin(row)`.
- **Kişi pop-up'ındaki "Danışmanlık Al" artık slug'a gömülü DEĞİL**: `/api/architect/:slug`
  onaylı danışmanlarda `consultant` alanı döner, `architect-modal.js` düğmeyi ona bakarak çizer ve
  teklifi modale geçirir. Takvim artık danışmanın KENDİ gün/saatleriyle çizilir
  (`consultation-modal.js#state.offer`; teklif gelmezse uygunluk yanıtındaki `offer` devralır).
- **Ödeme (madde 1)**: düğme "Ödeme Sayfasına İlerle" ve ödeme ekranı artık **koşulsuz** açılır
  (eskiden "sunucu en az bir yöntem sunuyorsa" idi — kart kapanınca o koşul ekranı tamamen
  atlardı). İki seçenek de HER ZAMAN çizilir; kart **"Henüz aktif değil."** etiketiyle pasiftir.
  **Kapı yalnızca arayüzde değil**: `consultations.js#IYZICO_ENABLED = false` ve
  `startConsultationPayment` 'iyzico' yöntemini 503 ile REDDEDER. Açmak için tek satır.
  Bu bayrak `isIyzicoConfigured`'dan AYRIDIR — bir ÜRÜN kararıdır, yapılandırma durumu değil.
- **`/danisman-ol`** (yeni, noindex, sitemap'te YOK — işlemsel başvuru sayfası): kullanıcının kendi
  kişi kayıtlarını listeler, seçilince bilgiler dolar; süre (30/45/60), ücret, gün+saat ve
  danışmanlık alanı toplanır. **Form seçenekleri SUNUCUDAN çizilir** (`consultantFormOptions`) —
  sayfada ikinci bir liste yok. Başvuru `pending` açılır; **onay yalnızca admin panelindeki
  "Danışman Başvuruları" sekmesinden** gelir. Onaylı bir danışmanın teklifini güncellemesi onayı
  DÜŞÜRMEZ.
- **KİŞİ KAYDI ŞARTTIR ve bu yapısaldır** (tercih değil): `consultation_requests.host_slug` bir
  `architects.slug`'dır, oda yetkisi `architects.claimed_by_user_id`'den kurulur, düğme kişi
  pop-up'ında yaşar. Kaydı olmayan başvuru sahibi `/kisi-ekle`'ye yönlendirilir — kişi formunun
  ikinci bir kopyasını bu sayfaya gömmek, bu deponun tam da kaçındığı "iki kaynak" tuzağı olurdu.
- **Google Meet (madde 3) — KOD ZATEN TAM, eksik olan SIRLAR.** Zincir uçtan uca yerinde: admin
  onayı → `createMeetForConsultation` → Google Calendar (conferenceData) → `meet_link` →
  alıcı VE danışmana bildirim (`/gorusme/:room_uuid`) → bildirime tıklayınca oda pop-up'ı →
  katılım penceresinde "Görüşmeye Katıl" Meet'i açar. Çalışması için `GOOGLE_REFRESH_TOKEN` (+
  CLIENT_ID/SECRET) ya da servis hesabı üçlüsü `wrangler secret put` ile tanımlı olmalı; admin
  panelinde "Danışmanlık Talepleri" sekmesindeki kutu eksikse uyarır ve tek seferlik
  yetkilendirmeyi başlatır (`src/routes/googleMeetAuth.js`). **7 GÜN TUZAĞI**: OAuth onay ekranı
  "Testing" durumundayken Google refresh token'ı 7 günde geçersiz kılar — "In production" olmalı.
- Testler: `scripts/test-2026-09-15-danisman-ol.mjs` (16 test) +
  `scripts/test-2026-09-15-danismanlik-page.mjs` (17 test), ikisi de preflight'a bağlı.
  `test-meet-gateway.mjs` fikstürüne `consultants` satırı eklendi (yeniden planlama kapısı artık
  oraya bakıyor).

## Hesap ikonu, kapalı ödemeler ve yeni projenin 1. sırası (2026-09-15, onuncu tur)

Kullanıcı isteği (üç madde): (1) "Ana menüde giriş yapan kullanıcı isminin yanına koyduğun icon
yerine ekte ilettiğim iconu koy arka planı olmayan şekilde beyaz renkte koy. Mobil ve tablet
görünümünde de yan çekmece menüde ismin yanında yine bu icon olsun.", (2) "Danışmanlık Al sayfasında
ödemeye sonra yapacağım butonunu kaldır, ödemeler şimdilik kapalı olsun önemli değil. Rozet al
sayfasında da ödemeye ilerlensin ama onda da şimdilik ödemeler kapalı olsun.", (3) "Bir kullanıcı
siteye bir proje eklediği zaman bu proje, proje sayfasında 1. sıraya yerleşsin."

- **İkon (madde 1)**: `auth-nav.js#ICON_PERSON` — 2026-09-15 beşinci turda konan 6px'lik dolu daire
  (`.nav-avatar-dot`) kaldırıldı. İkon `fill="none"` + `stroke="currentColor"`, yani ARKA PLANI YOK
  ve rengini taşıyıcısından alır: koyu mavi hesap düğmesinde beyaz (`var(--paper-card)`), açık
  zeminli mobil çekmecede ad satırının rengi. Sabit bir `#fff` yazılsaydı çekmecede beyaz üstüne
  beyaz olurdu. Çekmecede kırpma kuralları (`nowrap/ellipsis`) ad METNİNİN kapsayıcısına
  (`.nav-mobile-account-name-text`) taşındı — aynı kutuda kalsalardı uzun adlarda ellipsis ikonu da
  yiyebilirdi. Sağ üst köşedeki turuncu `.nav-avatar-alert` (bildirim/mesaj) BUNDAN AYRIDIR.
- **Danışmanlık (madde 2)**: `consultation-modal.js`'ten "Daha sonra ödeyeceğim" (`#cns-pm-later`)
  düğmesi, stili ve dinleyicisi tamamen çıktı. **Ekran çıkışsız KALMAZ**: hiçbir ödeme yöntemi açık
  değilken (bugünkü durum) kalan tek düğme pasif "Ödeme şu anda alınamıyor" DEĞİL, etkin **"Tamam"**
  olur ve onay ekranını gösterir. Talep o noktada `POST /api/consultations` ile ZATEN açılmıştır —
  bu bir iptal değil, yalnızca randevu özetini/"Görüşme Tarihini Değiştir"i taşıyan ekrana geçiştir.
  Bir yöntem açılırsa dal kendiliğinden devre dışı kalır ("Ödemeyi Yaptım"/"Ödemeye Geç").
- **Rozet (madde 2)**: Rozet Al pop-up'ı artık bir **ödeme adımına ilerler**
  (`info-modal.js#mountRozetAl` — "Ödeme Sayfasına İlerle" → `#im-payment-section`, hedef/kademe
  bölümleri kapanır, "Kademe seçimine dön" ile geri dönülür). 2026-09-08'de kaldırılan kutunun
  yerine gelen `#im-sales-closed` bu düğmeyle değişti.
  * **Yöntemler SUNUCUDAN çizilir**: `GET /api/badges/options` (`badges.js#badgePaymentOptions`,
    oturum İSTEMEZ — sayfa giriş yapılmadan da görüntülenebiliyor). Bugün ikisi de "Henüz aktif
    değil.", sayfada "açık mı" kararı YOK.
  * **KAPI SUNUCUDA**: `BADGE_SALES_OPEN` artık dışa aktarılıyor ve **`payments.js#startCheckout`**
    da onunla 403 döner — kart yolu 2026-09-08'de yalnızca UI'dan kaldırılmış, sunucuda AÇIK
    kalmıştı (havale yolu zaten kapalıydı).
  * **IBAN kutusu GERİ GELMEDİ** (2026-09-08 kuralı) ve **"Ödemeye Geç" düğmesi kural olarak
    pasiftir**: ödeme akışı (kart formu + `POST /api/payments/checkout`) bilerek kurulmadı. Satışı
    açmak TEK SATIRLIK bir bayrak değişikliği DEĞİLDİR — ikisi birlikte kurulmalı.
- **Yeni proje 1. sırada (madde 3) — KÖK NEDEN BİÇİM UYUŞMAZLIĞI**: sıralama anahtarı METİNDİR
  (`COALESCE(relisted_at, publish_date, created_at) DESC`) ve iki AYRI biçimde yazılıyordu —
  `src/routes/admin.js` (yönetici ataması, önizlemeden çıkarma, claim onayı)
  `new Date().toISOString()` ile `2026-09-15T09:00:00.000Z`, `canonicalSync.js` ve `created_at`
  varsayılanı ise `datetime('now')` ile `2026-09-15 18:00:00`. SQLite metni BAYT BAYT karşılaştırır,
  10. karakterde `'T'` (0x54) > `' '` (0x20): aynı gün ISO damgalı bir satır, saat farkı ne olursa
  olsun yeni projenin ÜSTÜNE çıkıyordu.
  * Tek biçim **ISO** seçildi (canlı veride zaten o var): `canonicalSync.js#NOW_ISO_SQL =
    strftime('%Y-%m-%dT%H:%M:%fZ','now')` — `toISOString` ile birebir aynı şekil/uzunluk. Dört türün
    (mimar/firma/proje/ürün) "önizlemeden çıkanı damgala" CASE'i de bu sabiti kullanır.
  * `syncProject`'in INSERT'i artık **`relisted_at`** yazar (`relistNew = opts.publish !== false &&
    !publishDate`). `display_order` INSERT'te hiç yazılmadığından "atanmamış" (0) kovasındadır,
    `preview_at` de NULL'dur — üç koşul birlikte 1. sırayı GARANTİ eder, tesadüfe bırakmaz.
  * **`publishDate` doluysa damgalanmaz**: yayın tarihini yalnızca admin yazabilir ve o tarih zaten
    "bu proje ne zaman yayınlandı" demektir; damga admin'in seçtiği sırayı ezerdi.
  * **Önizlemeye giren kayıt damgalanmaz** — `(preview_at IS NOT NULL) ASC` gereği listede zaten en
    sondadır; yayına çıkarken CASE onu damgalar.
- Testler: `scripts/test-2026-09-15-account-icon-payments-and-new-project-order.mjs` (17 test,
  preflight'a bağlı). Sıralama testi **gerçek SQLite** (`node:sqlite`) üzerinde çalışır ve ORDER
  BY'ı `projectPool.js` KAYNAĞINDAN okur; kök nedeni de ölçer (damga kaldırılınca yeni proje 1.
  sırayı KAYBETMELİ, aksi halde test anlamını yitirmiştir).

## Firmayı telif beyanıyla yayınlamak = yönetici ataması (2026-09-15, on birinci tur)

Kullanıcı isteği: "Admin hesabından bir firmanın düzenle sayfasına girip telif butonunu
işaretleyerek kaydedip yayınlayarak blurdan kurtarınca o firmaya ait kişiler ve projeler de blurdan
kalkarak yayınlanmış olsun. Yani sanki firmaya bir yönetici atanmış gibi tüm içerik otomatik olarak
yayınlansın."

- **KÖK NEDEN SEED'DİR, GRAF DEĞİL** (ölçüldü): yayın grafı (`admin.js#activateProfileGraph`) atama
  ile yayınlamada 2026-09-11'den beri AYNI, ama SEED'leri ayrışıyordu — atama
  (`activateClaimedProfile`) anahtarla eşleşen TÜM profilleri seed'liyor, yayınlama
  (`previewProfileIdsByKeys`) ise YALNIZCA profilin KENDİSİ o an ÖNİZLEMEDEYSE. Firma zaten canlıysa
  (graf eklenmeden önce yayına alınmış kayıtlar — bkz. `archiveSync.js`'in 62 satırlık canlı bulgusu)
  künyesindeki kişi/projeler önizlemede asılı kalıyor, admin'in elinde onları açacak düğme
  kalmıyordu. AYNI fikstürde ölçüm: atama -> hepsi LIVE, telif beyanlı kaydetme -> hepsi PREVIEW.
- **Çözüm**: `admin.js#publishGraphSeeds(env, type, keys, { includeLive })` — `{ ids, previewIds }`
  döner. `previewProfileIdsByKeys` onun önizleme süzgeçli sarmalayıcısı olarak KALDI (admin
  panelinin Arşiv > "Yayınla"sı ve Gizle/Göster anahtarı onu kullanır; o iki yolda "zaten canlı"
  dalı tanımı gereği hiç oluşmaz).
- **ÜÇ DARALTMA** (`submissions.js#adminOfficePublishSave` — tek kapı): yalnızca **admin**, yalnızca
  **firma** tipi, yalnızca **telif beyanlı** kaydetme (`keepPreview === false` dalı).
  * admin olmayan: her rutin düzenleme, firmanın tüm blurlu içeriğini yayına alan bir yetkiye
    dönerdi;
  * kişi tipi: kişi dalının grafı kişinin firmalarını + o firmaların ortaklarını + hepsinin
    projelerini kapsar, yani ZATEN CANLI bir mimarın rutin düzenlemesi çok daha geniş bir kümeyi
    açardı. Kişi eski (önizlemeden çıkış) kuralında KALDI.
- **PROMOSYON KAPISI** (`activateProfileGraph`'ın yeni `promoteOnlyIfActivated` opsiyonu): "yılca en
  yeni proje 1. sıraya" artık, seed genişletilmiş dalda, YALNIZCA parti gerçekten bir şeyi
  önizlemeden çıkardıysa çalışır — admin'in yazım hatası düzeltmesi gibi rutin bir kaydetmesi aylar
  önce yayınlanmış bir projeyi proje sayfasının 1. sırasına oturtmamalı. Varsayılan `false`, yani
  **ATAMA yolunun davranışı DEĞİŞMEDİ**: içeriğin tamamı zaten canlı olan bir firmada da promosyon
  çalışır (orada promosyon atamanın ta kendisidir). Profil başına bir kerelik damga
  (`projects_promoted_at`) her iki dalda da aynen geçerli.
- **ARŞİVDEKİ içerik geri gelmez** (atamada da gelmiyordu): `unpreviewByIds` yalnızca
  `preview_at IS NOT NULL` satırlara dokunur; `hidden_at` dolu + `preview_at` NULL (tam arşiv)
  bilinçli olarak kapsam dışıdır.
- Testler: `scripts/test-2026-09-15-office-publish-graph-live-seed.mjs` (9 test, preflight'a bağlı).
  İlk test iki yolu AYNI fikstürde yan yana koşturup sonuçları `deepEqual` ile karşılaştırır — yani
  ayrışma geri gelirse kelepçe orada kırılır. `test-2026-09-11-office-publish-cascade.mjs`'teki
  "ZATEN CANLI firmayı kaydetmek grafı tetiklemez" testi bu turda TERSİNE çevrildi (eski dar kural).

## İçeriği hiç olmayan blurlu profiller arşive alındı — FİRMA + KİŞİ (2026-09-15, on ikinci/on üçüncü tur)

Kullanıcı isteği: "Sitede hiç kurucusu, kurucu ortağı, ortağı, projesi, çektiği fotoğraflar bölümü
veya ürünü olmayan blurlu firmaları arşive al." + "Aynı şekilde blurlu kişileri de kontrol et."

- **"Boş" kararı TEK yerde, İKİ TİP için**: `src/lib/emptyProfileAudit.js#auditProfileContent`. Saf
  bir fonksiyondur, **hiçbir veriyi kendi okumaz** — pop-up'ları çizen CANLI kodun çıktısını
  (`office.js#buildOfficePayload` / `architect.js#buildArchitectPayload`) ve firma tarafında arşiv
  cascade'inin KENDİ toplayıcısının çıktısını (`officeArchiveCascade.js#collectOfficeArchiveTargets`)
  hazır alır. Betiğin kendi "bu profilin projesi var mı" sorgusu YOKTUR: olsaydı pop-up bir bölümü
  değiştirdiği gün betik "boş" demeye devam eder ve sitede içeriği GÖRÜNEN bir profili arşivlerdi
  (preflight bunu dosya taramasıyla da arıyor). **İki tip AYNI dosyada**: ayrı iki modül, "sahipli
  profile dokunma" gibi ORTAK kapıların birinde unutulacağı tek yer olurdu.
- **Bağımlılık yönü korundu**: bu depoda `src/lib -> src/routes` yönünde import HİÇ yok (ölçüldü).
  Kural lib'de saf kalır, `buildXPayload` çağrısını çağıran (betik/test) yapar.
- **FİRMA kapıları**: (1) Kurucular/Ortaklar, (2) Ekip, (3) Projeler, (4) Ürünler + Yapı
  Malzemeleri, (5) künyelerde fotoğrafçı olarak geçen ad, (6) arşiv cascade'inin
  götüreceği/koruyacağı herhangi bir kayıt, (7) SAHİPLİK.
- **KİŞİ kapıları**: (1) Firma (birincil firma + kurucu/ortak olduğu firmalar + künyeye serbest
  metin yazılmış firma adları — firma tarafındaki "Kurucular/Ortaklar"ın AYNADAKİ karşılığı),
  (2) Projeler, (3) **Fotoğrafladığı Projeler**, (4) Tasarladığı Ürünler, (5) **Portfolyo**
  (`migrations/0105`), (6) künyede fotoğrafçı adı, (7) **yapısal kenar**, (8) SAHİPLİK.
- **SAHİPLİK KAPISI (2026-09-15 on üçüncü tur, İKİ TİPTE de)** — `fetchOwnership`: bir profil bomboş
  görünse bile arşivlenmez, eğer (a) `claimed_by_user_id` doluysa (kaydı ekleyen üye — bkz. "Kaydı
  ekleyen, o kaydın yöneticisidir"), (b) `profile_claims`'te **approved VEYA pending** satırı varsa
  (admin ataması / bekleyen sahiplenme talebi), (c) kişi tarafında `consultants` satırı varsa
  (durumuna bakılmaksızın). Gerekçe: "içeriği yok" ile "sahibi yok" AYNI ŞEY DEĞİLDİR — henüz proje
  eklememiş yeni bir üyenin kaydı tam olarak bu durumdadır ve arşiv onu hem siteden hem üyenin
  Hesabım kutusundan düşürürdü; onaylı bir danışmanı arşivlemek ise /danismanlik kartını ve randevu
  kapısını kırardı.
- **KİŞİDE "pop-up'ın görmediği bağ" kapısı `fetchArchitectLinkIds`**: firma tarafında bu işi arşiv
  cascade'i yapıyor; kişiyi arşivlemek hiçbir şeyi beraberinde götürmediğinden
  (`legacyContent.js#archiveOfficeGraph`'ın `type !== 'offices'` kapısı) kişide öyle bir toplayıcı
  YOK. En somut vaka: `product_architects` satırı olan ama adı `products.designer` METNİNDE geçmeyen
  bir tasarımcı — "Tasarladığı Ürünler" o metinle süzüldüğü için (bkz. `architect.js#relatedProducts`)
  pop-up BOŞ görünür, oysa kayıt gerçek bir tasarım bağı taşır. Dört kenar tek taramada okunur
  (`office_founders`, `project_designers`, `project_photographers`, `product_architects`), görünürlük
  süzgeci BİLEREK yok.
- **Türetilmiş bölümler SAYILMAZ** (iki tipte de aynı gerekçe: profilin KENDİ projelerinden/firmasından
  türerler, yani asıl kapı zaten boşsa tanımı gereği boşturlar): firmada "Projelerde Kullanılan
  Ürünler/Firmalar", "Tercih Eden Firmalar/Mimarlar"; kişide "Ortaklar", "Ekip Arkadaşları",
  "Tercih Ettiği Firmalar", "Kullandığı Ürünler". Öneri şeritleri ("Şehirdeki Diğer Firmalar",
  "MİMARLAB'daki Diğer Kişiler") içerik değildir.
- **Fotoğrafçı bağı FİRMA tarafında ŞEMADA YOK**: `project_photographers` yalnızca `architect_id`
  tutar (bkz. `migrations/0080`). Firma karşılığı okuma anında ADDAN çözülür
  (`project.js#fetchPhotographerOfficeDetails`). `fetchPhotographerNameFolds` o eşleşmenin TERSİDİR
  ve AYNI iki kuralı kullanır (virgülle ayırma + `foldTr`); kişi tarafında YEDEK kapıdır (kenar
  tablosuna hiç bağlanmamış ad da korunur). Kapsam bilerek geniş: arşivdeki projelerin künyeleri de
  okunur — yalnızca DAHA AZ profil arşivlenir, güvenli yön.
- **Havuz**: yalnızca `hidden_at DOLU + preview_at DOLU` (blurlu). Yayındakine DOKUNULMAZ, tam
  arşivdeki zaten hedef durumdadır.
- **Yazma canlı koddan**: `runContentAction(env, user, { type: KIND, action:'archive', key:name })`
  — elle `UPDATE ... hidden_at` YAZILMAZ, aksi halde geri alınabilirliği sağlayan `*_submissions`
  taslağı hiç oluşmaz.
- **ELLE DIŞLAMA `--skip=` / workflow `skip`** (kullanıcı isteği, on üçüncü tur: kişi listesinden
  dört ad çıkarıldı — Arif Özden, Nur Urfalıoğlu, Alp Nuhoğlu, Serkan Ennaç): virgüllü liste, slug
  ya da ad kabul eder, eşleşme `foldTr` ile yapılır. **Dışlanan adlar KODA GÖMÜLMEZ** — kural değil,
  o TURA ait bir karardır; koda yazılsaydı sonraki tur sessizce yanlış olurdu. Dışlananlar log'da
  AYRI başlıkta raporlanır, `--expect` sayımına GİRMEZ ve karşılığı bulunamayan bir girdi (yazım
  hatası) UYARI satırıyla bildirilir — sessizce arşivlenmesin.
- **Çalıştırma**: `scripts/archive-empty-preview-profiles.mjs` +
  `.github/workflows/archive-empty-preview-profiles.yml` (`workflow_dispatch`; `type=architects|offices`,
  **varsayılan dry-run**, yazmak için `apply=evet`, `expect=N` sayım kapısı). Uzak (web/telefon)
  oturumdan ÇALIŞTIRILAMAZ — api.cloudflare.com kapalı.
  * **`audit_archived=evet` (DENETİM modu)**: arşivdeki (hidden_at DOLU + preview_at BOŞ) ama
    SAHİPLİ kayıtları listeler, hiçbir şey yazmaz. Sahiplik kapısı on üçüncü turda eklendiği için,
    **on ikinci turda arşivlenen 77 firmanın** yanlışlıkla bir üye kaydını düşürüp düşürmediğini
    denetlemenin yolu budur.
- Testler: `scripts/test-2026-09-15-archive-empty-preview-profiles.mjs` (35 test, preflight'a bağlı)
  — her kapı İKİ TİP için de tek tek kelepçelenir.

## Karusel slotları, form kutuları ve KIRIK PROFİL FOTOĞRAFI (2026-09-16, sekiz madde)

### 1. Ana sayfa karuselleri: proje/kişi/firma 9, ürün/gündem 6
Kullanıcı isteği: "Ana sayfadaki caroseldeki proje, kişi ve firma sayısını 9'a çıkar."
- Slot sabiti artık İKİ DEĞERLİ ve DÖRT dosyada birlikte yaşıyor: `index.html#PROJECT_CAROUSEL_SLOTS`
  (9) + `#SMALL_CAROUSEL_SLOTS` (6), `src/index.js#HOME_SLOTS`/`#HOME_SMALL_SLOTS` (gömülü veri),
  `src/lib/homeCarousels.js#HOME_SLOT_COUNTS` (admin seçiminin üst sınırı, KARUSEL BAŞINA) ve
  `admin.html#HOME_CAROUSEL_SLOTS`/`_SMALL` (önizleme). Tek sabit bırakılsaydı istenmeyen iki
  karusel (ürün, gündem) de sessizce 9'a çıkardı. Hizalamayı
  `scripts/test-2026-09-12-home-rails.mjs` + `-home-bento.mjs` kelepçeliyor.
- `parseFeaturedSlugs(raw, limit)` artık limit alır; `featuredSlugsFromSettings` limiti
  `slotCountFor(key)`'den okur. `pinnedSlugsFromUrl` anahtarı bilmediğinden ÜST sınırı (9) uygular.

### 2. proje-ekle > Ürün firması: tüm firmalar + arama
Kullanıcı isteği: "Ürün firması seç butonunda ürünü olmasa bile tüm firmalar listelensin. Listenin
en başında arama butonu olsun, aynı Firma başlığında firma seçermiş gibi olsun."
- **Kaynak değişti**: `/api/products/brands` (yalnızca ÜRÜNÜ OLAN markalar) -> `/api/offices/names`
  (firma+marka AYRIMSIZ tüm adlar). Kutu artık `office-picker.js#createOfficePicker`, `single: true`.
- **`allowCustom` KAPALI** (sayfadaki diğer üç kutunun aksine): bu kutunun tek işi sitede KAYITLI
  bir firma seçmek — 2026-09-04 madde 4'ten beri geçerli kural, karşılığı olmayan ad hiçbir ürüne
  bağlanamaz (`canonicalSync.js#resolveProjectProductLinks`).
- **Sözleşme korundu**: `#p-brand-select` `type="hidden"` input olarak KALDI. Dinleyici `change`
  DEĞİL **`input`** (gizli input `change` yaymaz; `office-picker.js#pushToInput` `input` yayar) ve
  "+ Ekle"nin sıfırlaması `brandPicker.set([])` üzerinden yapılır — doğrudan `.value = ''` kutunun
  etiketini/çipini eski firmada bırakırdı.
- Ürün menüsü (`/api/products/search?brand=`) DEĞİŞMEDİ: ürünü olmayan firmada "Bu firmanın kayıtlı
  ürünü yok" der ve yalnızca firma chip'i eklenir (zaten geçerli bir giriş).

### 3. kisi-ekle: Firmalar kutusu Sosyal Medya'nın üstüne alındı (yalnızca sıra; içerik aynı).

### 4. urun-ekle: Grup ZORUNLU, kategori grup seçilene kadar kapalı
- Grup menüsü eskiden yer tutucusuzdu ve İLK GRUBA KİLİTLİ açılıyordu — kullanıcı hiç dokunmadan
  bir grup seçmiş sayılıyordu. Artık `<option value="">Grup seç…</option>` + `required`.
- Grup boşken kategori `<select>` `disabled` ve "Önce grup seç" yazar. **Seçili kategoriler
  SİLİNMEZ** (chip listesi durur): düzenleme akışında grup geçici boşalırsa seçim kaybolmamalı.
- Submit guard'ı kategori guard'ından ÖNCE (`'Grup seç.'`).

### 5. Admin > Üyeler: satır numarası
- Liste sunucudan `created_at DESC` gelir, yani en ALTTAKİ satır en ESKİ üyedir -> numara =
  `all.length - i`. **Numara TAM listeden hesaplanır, filtrelenmişten DEĞİL** — aksi halde arama
  kutusuna yazınca aynı üye başka bir numara alır ve sayı "kaçıncı üye" olmaktan çıkardı.

### 6. Admin > Migrasyon Çakışmaları sekmesi kaldırıldı
- Sekme, bölüm, JS ve `pendingMigrationConflicts` nokta eşlemesi `admin.html`'den çıktı.
- **Sunucu ucu DURUYOR** (`src/routes/migrationConflicts.js`, GET/PATCH
  `/api/admin/migration-conflicts`) ve `smoke-test.sh` onun 401 döndüğünü doğrulamaya devam ediyor —
  kaldırılan tek şey ekrandı.

### 7. KIRIK PROFİL FOTOĞRAFI — İKİ kök neden (kişi VE firma pop-up'ında)
Kullanıcı isteği: "Bazen bir kişi profili açıldığında ... kişi fotoğrafı kırık olarak popup
açılıyor ama sayfayı yenileyince düzeliyor ... Aynı sorun firma popuplarında da var mı bak."
- **(a) ÇÖZÜM TABANI (asıl kök neden, kaynaktan doğrulandı).** D1'deki bazı görsel yolları köke
  göreli ve BAŞINDA EĞİK ÇİZGİ YOKTUR (`mimarlar/x.jpg`, `logos-thumb/y.jpg` — legacy_static).
  `safeUrl` bunları `document.baseURI`'ye göre çözüyordu. `<base href="/">` taşıyan sayfalarda
  (kisi/firma/proje/urun/gundem/pano/en-iyi-100) baseURI kök demekti ve doğru çalışıyordu — ama
  pop-up ana sayfadan ve /arama'dan da AYNI belgede açılıyor ve açılırken adres
  `history.pushState` ile `/kisi/<slug>`a dönüyor (bkz. `architect-modal.js`); `<base>` OLMAYAN o
  belgelerde `document.baseURI` de o anda `/kisi/<slug>` oluyor ve yol
  `/kisi/mimarlar/x.jpg`e çözülüp 404 veriyordu. **Sayfa yenilenince sunucu `<base href="/">`
  taşıyan belgeyi servis ettiği için sorun kendiliğinden "düzeliyordu"** — bildirilen davranış
  tam olarak bu.
  * Düzeltme: `safeUrl`'ün tabanı artık SABİT SİTE KÖKÜ (`SITE_ROOT = window.location.origin + '/'`).
    `<base href="/">` olan sayfalarda BİREBİR aynı sonucu verir; olmayanlarda kırılmayı kaldırır.
    YEDİ kopyanın hepsi güncellendi: `architect-modal.js`, `office-modal.js`, `product-modal.js`,
    `project-meta.js`, `social-links.js`, `auth-modal.js`, `auth-nav.js` (+ aynı modüllerdeki
    JSON-LD `image`/`logo` alanları).
  * **FİRMA tarafı**: logo `<img>`'i `cdnImg`'e HAM değeri verdiğinden src'si sağlamdı, ama
    BÜYÜTME yolu (`data-lightbox-src`) ham göreli değeri taşıyor ve `image-lightbox.js` onu
    doğrudan `imgEl.src`'ye atıyordu — aynı yanlış çözümleme. Lightbox artık `siteUrl()` ile
    köke göre çözer.
- **(b) GÖRÜNEN KUSUR.** Başlık avatarı, baş harfleri yazan renkli dairenin İÇİNE basılan ve kendi
  `onerror = () => img.remove()` yedeğini taşıyan bir `<img>`'dir; görsel düşünce geriye TEMİZ bir
  baş harf dairesi kalmalı. Ama `broken-image-fallback.js` `error`'ı BELGE ÜZERİNDE (capture)
  yakalayıp img'i alt metninden baş harf üreten bir kutuyla değiştiriyordu; `alt` boş olduğundan
  kutu **"—"** yazıyor ve dairenin yanında duruyordu — ekran görüntüsündeki "kırık fotoğraf" buydu.
  * Düzeltme: `hasOwnErrorHandler(img)` — kendi `onerror`'unu taşıyan (ya da
    `data-ml-fallback="off"`) görseller genel yedeğin DIŞINDA. Render noktası ne yapacağını zaten
    söylediyse karar onundur; yedek, hiçbir şey söylemeyen ~30 render noktası için duruyor. Hem
    canlı `error` dinleyicisi hem geç tarama (`sweep`/`verifyThenFallback`) aynı kapıdan geçer.

### 8. "İz Bırakan" rozetli firmada İş/Staj ilanları ve sahiplenme daveti YOK
Kullanıcı isteği: "Bir firmaya admin tarafından iz bırakan rozeti verilmişse o firmada İş / Staj
ilanları ve Bu firma sana mı ait? butonu olmasın."
- Rozet vefat etmiş mimarlar/kapanmış kurumlar için veriliyor (bkz. `badge-shared.js#BADGE_LABELS`)
  — böyle bir kayıtta ilan da sahiplenme daveti de anlamsız.
- İş/Staj: `office-modal.js#renderJobs` önce kutuyu GİZLER, `badgesReadyPromise`'i bekler
  (`/api/public/badges` asenkron gelir; beklenmezse kutu bir an görünüp kaybolurdu) ve rozet varsa
  hiç açmaz.
- "Bu firma sana mı ait?": `claim-correction-box.js`'te FİRMA dalı artık `hasIzBirakanBadge`'e
  bakıyor. **Diğer firma rozetleri kutuyu KAPATMAZ** — 2026-09-10'dan beri geçerli gerekçe aynen
  duruyor: firma rozeti admin tarafından da verilebiliyor, yani rozet tek başına "bu firmanın
  onaylı bir yetkilisi var" demek değil.
- **Sahibi/yetkilisi kutuyu KAYBETMEZ**: gizleme `!isProfileOwner && badged` koşuluna bağlı, yani
  Düzenle/Sil/Arşivle aksiyonları yerinde kalır.

Testler: `scripts/test-2026-09-16-carousels-pickers-and-broken-photos.mjs` (21 test, preflight'a
bağlı).

### 9. Yetkili Kullanıcılar çipleri: @kullanıcı adı + taşma kapatıldı (2026-09-16, ikinci tur)
Kullanıcı isteği: "Hesabım sayfasındaki Yetkili Kullanıcıların isimleri değil kullanıcı adları
yazsın, ayrıca yanlarında yönetici yazmasına gerek yok. Ekteki görseldeki gibi kutu dışına taşma
hiçbir görünümde olmasın."

- **Çip artık `@username` yazar**: `users.username` hesabın TEKİL tanıtıcısıdır (bkz. "Hesap
  üyeliği ile kişi profili AYRIDIR" — iki hesap aynı ad soyadı taşıyabilir, kullanıcı adı
  taşıyamaz), yani çip hangi hesabın yetkili olduğunu belirsizliğe yer bırakmadan gösterir.
  Kolonu boş eski hesapta ad soyada düşülür. Görev etiketi (`(Yönetici)`) ve `.am-mgr-chip-role`
  kuralı tamamen kalktı; `position` yanıtta DURUYOR, bu satır artık okumuyor.
- **`name` YANITTA KALDI ve X onu taşır**: yetkiyi kaldıran uç ad soyadla eşleştiriyor
  (`DELETE /api/claims/office-managers?name=…`). Ekranda görünen değer değişti, silme anahtarı
  değişmedi. E-posta/kullanıcı id'si hâlâ DÖNMEZ — test bunu anahtar kümesiyle kelepçeliyor.
- **TAŞMANIN KÖK NEDENİ `.profile-fact`in flex öğelerinin `min-width`iydi**, `.am-mgr-wrap`ın
  `flex-wrap`i değil: flex öğelerinin varsayılan `min-width:auto` (= max-content) değeri, değer
  sütununun içeriğinden dar olmasını ENGELLİYOR ve satırı kartın dışına itiyordu — sarılacak
  genişliği belirleyen kapsayıcı zaten içeriğe göre büyüdüğü için `flex-wrap` devreye bile
  giremiyordu. `min-width:0` (etiket + değer) + `overflow-wrap:anywhere` bunu kapatır.
  Kural İKİ yüzeyde de var: `js/components/auth-modal.js` (modal) ve `hesabim.html` (bağımsız
  sayfa) — ikincide çip yok ama kutu modeli birebir aynı, yani uzun bir değer orada da taşardı.
- **Tek uzun çip kutuyu genişletmez**: `.am-mgr-chip{max-width:100%; min-width:0}` +
  `.am-mgr-chip-name{overflow:hidden; text-overflow:ellipsis}` — metin kırpılır, X
  (`flex-shrink:0`) kırpılmaz.

## Görsel başına fotoğrafçı, "Fotoğraf bana ait" ve şifre göz işareti (2026-09-16, ikinci tur)

### 1. Lightbox'ta görsel başına fotoğrafçı
Kullanıcı isteği: "Proje ekle/düzenle sayfasında eğer fotoğrafçı kısmına birden fazla fotoğrafçı
yazıldıysa fotoğrafların üstüne tıklanınca açılan lightboxta hangi fotoğrafı hangi fotoğrafçının
çektiği seçilebilsin."

- **Yeni kolonlar** `projects.image_credits` / `project_submissions.imageCredits`
  (`migrations/0122_project_image_credits.sql` — **kod deploy'undan ÖNCE uygulanmalı**,
  `canonicalSync`'in INSERT'i kolonu açıkça sayıyor). Aynı DDL `schema.sql`'e de yansıtıldı: yerel
  testlerin bir kısmı (ör. `test-2026-09-14-aggregator-source-links.mjs`) GERÇEK SQLite fikstürünü
  o dosyadan kuruyor ve yansıtılmazsa preflight "no such column" ile kırmızı döner. Biçim `image_hotspots` ile BİREBİR aynı:
  görsel URL'sine göre anahtarlı JSON (`{ "<url>": "Ad" }`). **İndeks DEĞİL URL** — proje-ekle'de
  görseller sürükle-bırak ile sıralanabildiğinden indeks tabanlı eşleme her sıralamada sessizce
  yanlış fotoğrafçıyı gösterirdi (0076'nın AYNI gerekçesi).
- **`photo_credit_text` PARÇALANMADI**: o kolon PROJENİN künyesidir (virgüllü tüm adlar,
  `project_photographers` kenarını besler, arama/SEO gövdesi onu okur). Yeni kolon onun ALT
  KIRILIMI: "künyedeki hangi ad, hangi kareyi çekti".
- **EŞLEMESİ OLMAYAN KARE KÜNYENİN TAMAMINA DÜŞER** (`gallery.js#paintCredit`:
  `st.credits[url] || st.credit`) — kolonu hiç yazılmamış TÜM mevcut projelerin görünümünü
  değiştirmeyen tek davranış. Kısmen doldurulmuş bir projede seçilmemiş kareler de boş kalmaz.
- **GERÇEK DÜZELTME**: "© ..." etiketi eskiden `initDetailGallery`'de BİR kez yazılıp galeri
  boyunca sabit kalıyordu; artık `showLightboxImage` her karede `paintCredit`i çağırıyor. Durum
  `state`ten CANLI okunur (dinleyiciler yalnızca ilk çağrıda bağlanıyor — gömülü değer N. projede
  1. projenin künyesini yazardı).
- **Form**: menü YALNIZCA künyede iki ya da daha fazla ad varken çizilir (`renderPreviews`'te
  `showCredit`), seçenekler `#p-credit-text`ten türer (ikinci bir liste yok), seçim mediaItems
  öğesinde taşınır (sıralama onu da götürür), kırpma onu korur. **`<select>` bir `<button>`
  DEĞİL**: sürükleme (`pointerdown`) ve işaretleme editörü (`click`) korumaları
  `closest('button, select')` oldu — aksi halde menüye basmak kutucuğu sürüklüyor ve editörü
  açıyordu.
- **Künyeden çıkarılmış ad İKİ kapıda süzülür**: kutu değiştiğinde `pruneImageCredits`, kaydetme
  anında `collectImageCredits` (prefill sonrası kutu hiç dokunulmamış olabilir). Aksi halde
  lightbox sitede hiçbir yerde yazmayan bir adı gösterirdi.
- **Liste yükü şişmez**: `shapeProjectItem` alanı yalnızca gerçekten eşleme varsa ekler ve
  `coverOnly`de yalnızca kapağınkini taşır (`imageHotspots` ile AYNI kapsam). Kolon liste
  sorgularında hiç SELECT edilmiyor (kart yüzeyinde lightbox yok).

### 2. "Fotoğraf bana ait" — künye talebi + onay kuyruğu
Kullanıcı isteği: "Proje popuplarındaki lightboxta 'Fotoğraf bana ait' butonu olsun ve bu butona
tıklayınca görseldeki ismin değişmesi için firma yöneticilerine ve admine bildirim gitsin. Firma
yöneticileri veya admin bildirimi onaylarsa fotoğrafçı bilgisi lightboxa ve proje künyesine
eklensin."

- **`src/routes/photoClaims.js` + `project_photo_claims` tablosu**, `src/routes/hotspotTags.js` ve
  `migrations/0091`in KARDEŞİ: aynı uç isimleri (`/access`, POST, `/:id`, `/:id/decide`,
  `/pending`), aynı durum sözlüğü, aynı "admin onaya düşmez" kısayolu, aynı `photo-claim:<id>`
  bildirim→pop-up bağlantısı (`auth-modal.js#openPhotoClaimPrompt`). Ayrı dosya olmasının gerekçesi:
  etiketlenen şey bir ÜRÜN değil bir AD, karar verenler markanın sahibi değil PROJENİN FİRMA
  YÖNETİCİLERİ, yazma hedefi `image_hotspots` değil `photo_credit_text` + `image_credits`.
- **BİLDİRİM ALICILARI = KARAR KÜMESİ, tek fonksiyondan** (`officeManagerUserIds` + adminler).
  İki liste ayrı hesaplanırsa biri diğerinde olmayan kullanıcıya "onayına sunuldu" bildirimi gider
  ve o kişi butona bastığında 403 alırdı. Yöneticinin tanımı da TEK kaynaktan okunur
  (`claimedProfiles.js#fetchOfficeManagers` + `projectClaimAccess.js#OFFICE_EDIT_POSITIONS`) —
  yani "Hesabım > Yetkili Kullanıcılar" listesindeki kümeyle birebir aynı. **Projeyi ekleyen üye ve
  künyedeki MİMARLAR bilerek dışarıda** (kullanıcı isteği "firma yöneticilerine ve admine" diyor);
  eklenecekse tek yer `officeManagerUserIds`tır.
- **ONAY KUYRUĞU ATLATILAMAZ**: POST `status`'ü istemciden HİÇ okumaz, yalnızca role bakar
  (bkz. proje notu `[[project_submission_moderation_bypass_2026_09_05]]`). Karar TAMAMEN AYRI bir
  uçtur ve kendi yetki kontrolü var.
- **Onay ÜÇ yere yazar**: `projects.image_credits` (lightbox), `projects.photo_credit_text` (künye)
  ve varsa projenin `project_submissions` taslağı. Taslak ŞART: `canonicalSync#syncProject` bu iki
  alanı taslaktan BAŞTAN yazıyor, yani yalnızca canonical'a yazmak projenin bir sonraki
  kaydedilişinde SESSİZ VERİ KAYBI olurdu (hotspotTags.js tasarım notu 4 — AYNI tuzak). Ad sitede
  bir kişi kaydıyla eşleşiyorsa `project_photographers` kenarı da kurulur (`findOneByName` —
  canonicalSync ile AYNI kural, ayrışırsa aynı ad bir yolda çipe, diğerinde metne dönerdi).
- **`purgeSsrDetailCache` ŞART**: `invalidatePublicCache` yalnızca sabit liste yollarını temizler;
  `/api/project/:slug` `caches.default`ta s-maxage ile durur ve fingerprint TAŞIMAZ — onay veren
  kişi "onayladım ama görünmüyor" diye bakakalırdı (hotspotTags.js'teki AYNI gerçek bulgu).
- **Kapsam iki seçenek**: tek kare (`image_url` dolu) ya da projenin tamamı (`image_url` NULL =
  "künyeye ekle, kareye bağlama"). Kısmi UNIQUE indekste `COALESCE(image_url, '')` ŞART —
  SQLite'ta NULL'lar UNIQUE'i tetiklemez, proje geneli talepler sınırsız tekrarlanabilirdi.
- **Künyeye yazılacak ad DÜZENLENEBİLİR** ve hesap adıyla önden dolar: bir fotoğrafçı stüdyo adıyla
  anılmayı seçebilir — hesap adı ile künyede görünmek istenen ad AYNI ŞEY DEĞİLDİR (bkz. "Hesap
  üyeliği ile kişi profili AYRIDIR").
- İstemci: `js/components/photo-claim.js` (hotspot-tagger.js'in kardeşi), buton `gallery.js`'in alt
  çubuğunda "Ürün Etiketle"nin yanında — GİZLİ doğar, yalnızca `/api/photo-claims/access` "evet"
  derse açılır, kilitli (önizleme) projede gizlenir. `proje.html` + `en-iyi-100.html` kabuklarına
  script etiketi eklendi, `lazy-modals.js` deps'ine girdi ve **`SSR_CACHE_VERSION` v140** oldu
  (v116'daki AYNI tuzak).

### 3. Giriş ekranında şifre göz işareti
Kullanıcı isteği: "Giriş yap ekranında şifre kutucuğunun en sağında bir göz işareti olsun ve buna
tıklayınca şifre açık gözüksün."

- **TEK modül**: `js/components/password-reveal.js`. Giriş ekranı İKİ yerde yaşıyor (bağımsız sayfa
  `giris-yap.html` + pop-up `auth-modal.js#loginTemplate`); iki kopya yazılsaydı düğmenin
  ölçüsü/davranışı zamanla ayrışırdı.
- **input'un KENDİSİ değişmez**: id/name/required/DOM yeri korunur, yalnızca ETRAFINA bir
  `.pw-reveal-wrap` eklenir. Şart: formu gönderen kodlar input'a id ile ulaşıyor ve tarayıcının
  şifre yöneticisi de aynı düğüme bakıyor — input'u yeniden OLUŞTURMAK ikisini de bozardı.
  Genişliğe dokunulmaz, yerine sağ padding artar (uzun şifre düğmenin altına girmez).
- **Düğme `type="button"`** (varsayılan "submit" formu GÖNDERİRDİ) ve `wire()` aynı input'a iki kez
  takmaz (pop-up şablonunu her açılışta yeniden basabilir).
- **SIRALAMA TUZAĞI yapısal olarak kapalı**: bağımsız sayfa yalnızca `data-password-reveal`
  işaretini koyar, bağlama zamanı modülün kendi `sweep()`'i (DOMContentLoaded) — sayfanın satır içi
  script'i defer'li modülden ÖNCE koştuğu için orada yazılacak bir `PasswordReveal.wire()` çağrısı
  "not defined" ile patlardı. Pop-up modülü TEMBEL yükler (yüklenemezse giriş akışı bozulmaz).
- Kapsam BİLEREK yalnızca GİRİŞ ekranı: modül "sayfadaki her şifre kutusunu" kendiliğinden
  bağlamaz, çağıran hangi kutuyu istediğini açıkça söyler.

Testler: `scripts/test-2026-09-16-photo-credits-and-password-reveal.mjs` (49 test, preflight'a bağlı).

## Mobilde "Ürün Etiketle", "Fotoğraf bana ait"in kaldırılması ve "Fotoğraflarını Bul" (2026-09-16, üçüncü tur)

### 1. Mobilde lightbox'taki "Ürün Etiketle" SOL ÜST köşede
Kullanıcı isteği: "Mobil görünümde proje lightboxlarındaki ürün etiketle butonu sol üst köşede
olsun."

- **KÖK ZORLUK, CSS'in az bilinen bir kuralı**: alt çubuk (`.lightbox-bottombar`)
  `bottom:24px; left:50%; transform:translateX(-50%)` ile konumlanıyordu ve **TRANSFORM TAŞIYAN BİR
  ATA, `position:fixed` çocuklar için de kapsayıcı blok olur**. Yani çubuğun içindeki butona ne
  `fixed` ne `absolute` ile ekranın üst köşesi verilebiliyordu — ikisi de çubuğun kendi ~30px'lik
  kutusuna göre çözülüyordu.
- **Çözüm çubuğu YENİDEN KONUMLANDIRMAK**: çubuk artık `inset:0` ile lightbox'ın TAMAMINI kaplayan,
  **transformsuz** bir kapsayıcı; sayaç + buton hâlâ `align-items:flex-end; justify-content:center;
  padding:0 12px 24px` ile altta ortada (masaüstü görünümü DEĞİŞMEDİ). Artık çubuğun her çocuğu
  lightbox'ın herhangi bir köşesine konumlandırılabilir.
- **`pointer-events:none` ZORUNLU** (`> *` ile çocuklarda `auto`): çubuk tüm alanı kapladığı için
  aksi halde görselin üzerindeki işaretçi/etiketleme tıklamalarını ve "boşluğa tıkla, kapat"
  davranışını yutardı.
- Mobilde (`<=560px`) buton `position:absolute; top:12px; left:14px`. **SOL üst bilinçli seçim**:
  sağ üst köşe dolu (`.lightbox-close` + solunda `.lightbox-grid-toggle`). Buton flex satırından
  çıkınca sayaç altta tek başına ortalanmış kalır.
- **Kural gallery.js'te TEK yerde** — ürün pop-up'ının lightbox'ı da aynı sınıfları/`initDetailGallery`'yi
  kullanıyor, ama `tagging` geçmediği için orada buton hiç oluşmuyor.
- **TERS TIRNAK TUZAĞINA BU TURDA BİR KEZ DAHA DÜŞÜLDÜ**: enjekte edilen CSS şablonuna yazılan bir
  yorumda `` `fixed` `` kullanmak şablon dizesini kapatıp dosyayı sözdizimi hatasına düşürdü (bkz.
  proje notu `[[feedback_no_backtick_in_style_template_literals]]`). Test artık şablonun içinde ters
  tırnak OLMADIĞINI ayrıca arıyor.

### 2. Lightbox'taki "Fotoğraf bana ait" KALDIRILDI
Kullanıcı isteği: "Lightboxlardaki 'Fotoğraf Bana Ait' butonunu kaldır."

- Buton AYNI GÜN (ikinci tur madde 2) eklenmişti. **Akışın SUNUCU tarafı yaşıyor** —
  `src/routes/photoClaims.js` + `project_photo_claims` tablosu duruyor, yalnızca giriş noktası
  madde 3 oldu.
- Kaldırılanlar: `gallery.js`'teki buton/stil/state/dinleyici ve Escape·arka plan·ızgara kancaları,
  `project-gallery.js#photoClaim`, `js/components/photo-claim.js` (dosya SİLİNDİ),
  `proje.html`/`en-iyi-100.html` script etiketleri, `lazy-modals.js` bağımlılığı ve
  `GET /api/photo-claims/access` ucu (tek çağıranı butonun görünürlük sorusuydu).
- **Script etiketinin KALDIRILMASI da SSR sürümü gerektirir** (`SSR_CACHE_VERSION` v141) — v114'teki
  AYNI tuzak: artırılmazsa daha önce ziyaret edilmiş `/proje/:slug` sayfaları s-maxage boyunca eski
  kabuğu sunar ve artık var olmayan dosya için 404 üreten bir istek atar.
- `image_credits` (ikinci tur madde 1, görsel başına fotoğrafçı) **DEĞİŞMEDEN duruyor**: onu yazan
  proje-ekle akışı ve lightbox'ın `paintCredit`'i aynen çalışıyor. Onay akışı artık o kolona hiç
  dokunmuyor.

### 3. Kişi pop-up'ında "Fotoğraflarını Bul"
Kullanıcı isteği: "Kişi popuplarında Fotoğraflarım başlığının yanında 'Fotoğraflarını Bul' butonu
olsun ve buna tıklayınca sitedeki yüklü tüm projelerden kullanıcı bir projeyi seçebilsin. Bu seçim
seçilen projenin firmasını yöneticisine ve admine bildirim olarak gitsin. Firma yöneticisi veya
admin bu bildirime onay verirse proje künyesine fotoğrafçı otomatik olarak eklensin."

- **Düğme yeri**: "Fotoğrafladığı Projeler" başlığındaki `#am-find-photos-slot` yuvası
  (`architect-modal.js`), yuvayı `claim-correction-box.js#renderFindPhotosButton` doldurur —
  `renderAddProjectButton` ile BİREBİR aynı desen.
- **YETKİ TEK KAYNAK, İKİ UÇTA**: istemcide `isAuthorizedEditor()` (Düzenle + Proje Ekle ile AYNI
  fonksiyon, yani üçü ayrışamaz), sunucuda `submissions.js#verifyClaimedProfileKey` —
  o fonksiyon ve `DELEGATED_ACCESS` bu tur **export edildi** ve `photoClaims.js`'e IMPORT ediliyor.
  İkinci bir kopya yazılmadı. (Bu depoda routes→routes import yaygın, bkz. `admin.js`, `ai.js`.)
- **"Giriş yapmış herkes" DEĞİL** (hotspotTags.js'teki kapının aksine): orada etiketlenen şey
  herkese açık bir üründür; burada talep BAŞKA birinin kişi profilini bir künyeye yazmayı önerir.
- **DÜĞMENİN YAŞADIĞI BÖLÜM AÇILIR**: "Fotoğrafladığı Projeler" bölümü kişinin hiç fotoğrafı yoksa
  gizlidir — oysa düğmenin tam hedef kitlesi o kişidir. `renderFindPhotosButton` yetki çıktıktan
  SONRA bölümü de açar (`findPhotosSectionId`). Yetkisiz ziyaretçide bölüm eskisi gibi gizli kalır.
- **YUVA HER PROFİLDE SIFIRLANIR** (`architect-modal.js#renderItem`): düğme paylaşılan DOM'da
  yaşıyor ve yetki kararı ASENKRON geliyor; temizlenmezse yetkisiz bir profilde önceki profilin
  düğmesi görünür kalırdı — ve o düğme ESKİ kişinin anahtarını taşıdığı için YANLIŞ profil adına
  talep açardı.
- **AD İSTEMCİDEN GELMEZ**: sunucuya yalnızca kişi profilinin anahtarı gider, künyeye yazılacak ad
  canonical `architects.name`'den okunur (`photoClaims.js#resolveClaimArchitect`). Serbest metin
  kabul edilseydi herhangi bir üye istediği adı bir projenin künyesine önerebilirdi.
- **PROJE SEÇİCİSİ AYRI VE OTURUMA BAĞLI BİR UÇTAN**: `GET /api/photo-claims/projects?q=`
  (`listClaimableProjects`). **`/api/projects/search`'e DOKUNULMADI**: o uç herkese açık,
  önbellekli ve 2 karakterin altındaki sorguları bilinçli olarak D1'e hiç göndermiyor — yani
  "sorgusuz açılışta listeyi doldur" davranışı oraya eklenemezdi. Desen
  `hotspotTags.js#listTaggableProducts` ile aynı. Sıralama `/proje` listesinin anahtarıyla AYNI
  (`COALESCE(relisted_at, publish_date, created_at) DESC`), arama `title_fold LIKE` + `likePattern`.
- **ZATEN KÜNYEDE OLAN PROFİL için talep AÇILMAZ**: `applyPhotoClaim` o adı zaten atlıyor
  (`alreadyCredited`), yani kuyruğa hiçbir şeyi değiştirmeyecek bir satır düşer ve karar veren kişi
  "onayladım ama bir şey olmadı" derdi.
- **Talep bir KAREYE bağlanmaz**: `project_photo_claims.image_url` kolonu duruyor ama bu akış onu
  HİÇ YAZMAZ — kısmi UNIQUE indeks `COALESCE(image_url,'')` kullandığından kural kendiliğinden
  "kullanıcı başına proje başına tek bekleyen talep" hâline gelir. Yeni migration GEREKMEDİ.
- **ONAY ÜÇ YERE YAZAR**: `projects.photo_credit_text` (künye), `project_photographers` (künyedeki
  adın tıklanabilir profil çipi olması için — kenar kurulmazsa düz metin kalırdı; eşleşme
  `findOneByName` ile, canonicalSync ile AYNI kural) ve varsa projenin `project_submissions`
  taslağı (canonicalSync künyeyi taslaktan BAŞTAN yazdığından, yalnızca canonical'a yazmak bir
  sonraki kaydetmede SESSİZ VERİ KAYBI olurdu). Ardından `purgeSsrDetailCache` — `invalidatePublicCache`
  tek başına yetmez (`/api/project/:slug` fingerprint taşımaz).
- İstemci: `js/components/photo-finder.js` (silinen `photo-claim.js`'in yerine), `lazy-modals.js`'in
  **architect** modülü deps'inde (düğmeyi çizen `claim-correction-box.js`'in yanında). Onay
  pop-up'ı `auth-modal.js#openPhotoClaimPrompt` — artık projenin KAPAK görselini gösterir.

Testler: `scripts/test-2026-09-16-find-photos-and-mobile-tag-button.mjs` (37 test, preflight'a
bağlı). İkinci turun dosyasındaki "madde 2" blokları buraya TAŞINDI (o tur kaldırıldı); o dosyada
hâlâ geçerli olan madde 1 ve madde 3 kalıyor.

## "Fotoğraflarını Bul": iki adım + yetki daraldı; boş bölüm gizli (2026-09-16, dördüncü tur)

Kullanıcı isteği: "Fotoğraflarımı bul butonundan bir proje seçildiği zaman talep gönder butonu olsun
... bildirim onaylanmadan künyeye fotoğrafçı ismi eklenmesin. Kişi popupında sadece kişi popupının
yöneticisi ve admin bu butonu görebilsin." + "Bir kişinin fotoğrafladığı proje yoksa Fotoğrafladığı
projeler ve fotoğraflarını bul butonu gözükmesin."

### 1. İKİ ADIM: seç, sonra "Talep Gönder"
- `photo-finder.js`: satıra tıklamak artık YALNIZCA seçer (`aria-selected` + işaret dairesi),
  talebi alt çubuktaki **"Talep Gönder"** gönderir. Üçüncü turda satıra tıklamak DOĞRUDAN istek
  atıyordu — yanlış bir satıra dokunmak geri alınamaz bir talep açıyordu.
- Düğme seçim yapılana kadar PASİF; **aynı satıra tekrar tıklamak seçimi kaldırır** (yanlış dokunan
  kullanıcı formu kapatmak zorunda kalmasın).
- **Seçim durumu TEK yerden yazılır** (`setSelected`): satır işareti ile düğmenin etkinliği ayrı ayrı
  güncellenirse "seçili görünen satır + pasif düğme" gibi ayrışık bir hâl doğar.
- Gönderim sırasında liste + düğme kilitli; başarıda slug `submittedSlugs`'a girer ve o projede düğme
  yeniden pasif olur (mükerrer talep sunucuda da reddedilir, bu yalnızca boş bir hatadan korur).
  Hata hâlinde seçim GERİ YÜKLENİR. Profil değişiminde ikisi de sıfırlanır.
- **Onay şartı metne de yazıldı**: "ONAYLANMADAN künyeye hiçbir şey eklenmez" — davranış zaten
  böyleydi (onay kuyruğu), ama kullanıcı gönderdiği anda eklendiğini sanmamalı.
- Davranış gerçek tarayıcıda ölçüldü (Playwright + stub fetch): açılış → seçim → iptal → başka satır
  → tek POST → mükerrere kapalı → arama seçimi düşürür.

### 2. YETKİ DARALDI — yalnızca profilin KENDİ yöneticisi ve admin
- **İstemci**: `claim-correction-box.js#isProfileManager` — `isAuthorizedEditor`'ın
  **`claimDelegatedEdit` çıkarılmış** hâli. O bayrak "bir firmanın yetkilisiyim, künyesindeki BAŞKA
  kişilerin profillerini de düzenleyebilirim" demektir; bir firma yetkilisinin ekibindeki kişinin
  ADINA fotoğraf künyesi talebi açması istenmiyor. **Düzenle/Proje Ekle düğmeleri
  `isAuthorizedEditor`'da KALDI** — daraltma yalnızca bu düğme için.
- **Sunucu**: `photoClaims.js#architectManagerGate` — admin / onaylı `profile_claims('architect')` /
  kaydı siteye kendi ekleyen (`canEditArchitectAsCreator`). Üçüncü turda kullanılan
  `submissions.js#verifyClaimedProfileKey` **BİLEREK daha geniştir** (dördüncü yol olarak
  `canEditArchitectViaOfficeMembership` delegasyonunu da kabul eder), bu yüzden artık kullanılmıyor
  ve o fonksiyon/`DELEGATED_ACCESS` submissions.js'te yeniden PRIVATE oldu (dışa aktarılmış ölü bir
  yüzey bırakılmadı). Bu bir kopya DEĞİL, bilinçli olarak farklı (daha dar) bir kuraldır.
- Anahtar yine `canonicalRowExistsByKey` ile doğrulanır ve yetki **GÜNCEL canonical adla** sorulur
  (`resolveCanonicalName`): `profile_claims` ADLA anahtarlı, bir yeniden adlandırmadan sonra eski
  slug ile gelen istek aksi halde sessizce reddedilirdi.

### 3. Fotoğrafladığı projesi olmayan kişide bölüm ve düğme YOK
- Üçüncü turda `renderFindPhotosButton` bölümü AÇIYORDU (gerekçe: "düğmenin hedef kitlesi henüz
  künyede görünmeyen fotoğrafçıdır"). Kullanıcı kararı bunun TERSİ — o davranış geri alındı:
  `findPhotosSectionId` sözleşmesi kaldırıldı, bölümün görünürlüğü yalnızca
  `photographedData.length`'e bağlı ve düğme de `findPhotosEnabled: () => photographedData.length > 0`
  ile AYNI tek gerçeği okur, yani "bölüm gizli ama düğme var" durumu oluşamaz.
- **BİLİNEN SONUÇ**: hiç fotoğraf künyesi olmayan bir kişi profilinde düğme HİÇ görünmez — ilk
  künye kaydının başka bir yoldan (proje-ekle ya da admin) gelmesi gerekir.

### 4. Tablet/mobil pop-up sırası — DEĞİŞİKLİK GEREKMEDİ (ölçüldü)
Kullanıcı isteği: "Tablet ve mobil görünümde kişi ve firma popuplarında önce künye ve açıklama
bölümleri olsun, daha sonraki satırlarda projeler vs. bölümleri gelsin. En sonda açılır-kapanır
butonlar ve en altta önceki sonraki butonları olsun."

- İstenen sıra **zaten yürürlükteydi**. Gerçek Chromium'da, gerçek CSS dosyalarıyla (modal-shell'in
  enjekte ettiği CSS + `entity-detail.css` + `architect-detail.css`/`office-detail.css`) 700px ve
  820px'te ölçüldü:
  * kişi: `am-identity` → `am-social-links` → `am-detail-info` (künye + açıklama) → `am-office-pair`
    → ... → `am-related-architects-section` → `claim-info-card`/`correction-info-card` (order:98) →
    `am-prevnext` (99) → `am-source-disclaimer` (100).
  * firma: `om-cover` → `om-identity` → `om-social-links` → `om-detail-info` → bölümler →
    `om-jobs-card`/`claim`/`correction` (98) → `om-prevnext` (99) → disclaimer (100).
- **MEKANİZMA**: `<=860px`'te `.modal-shell-left/.modal-shell-right` `display:contents` olur, tüm
  çocuklar TEK dikey flex akışına katılır ve sıra `order` ile kurulur (98/99/100). Sol panel
  künye+açıklamayı, sağ panel bölümleri taşıdığından DOM sırası gerisini hâlleder.
- **TEK fark**: "önceki/sonraki en altta" isteğine karşın en altta `source-disclaimer` (order:100)
  var — o tek satırlık kaynak ibaresi 2026-09-07'de "Önceki/Sonraki'den HEMEN SONRA" olacak şekilde
  yine kullanıcı isteğiyle konmuştu. Önceki/Sonraki en alttaki BUTON çiftidir; ibare bir dipnot
  olduğundan yerinde bırakıldı.

Testler: `scripts/test-2026-09-16-find-photos-and-mobile-tag-button.mjs` (44 test, preflight'a
bağlı) — üçüncü turun (g) ve (a) maddeleri bu turda TERSİNE çevrildiği için o iki kelepçe
güncellendi.

## Mobil yerleşim düzeltmeleri + künye talebinde ADMIN KISAYOLU KALDIRILDI (2026-09-16, beşinci tur)

Kullanıcı isteği (üç madde): (1) "Mobil görünümde fotoğraflarını bul butonu kötü bir şekilde
duruyor. Mobilde bunu sol kenara yapıştır ve başlıkla arasını biraz aç. Ayrıca bu butona tıklayıp
bir proje seçince admin ve firma yöneticisine bildirim gitsin. Bildirimi onaylanmadan fotoğrafçı
kişisi proje künyesine eklenmesin. Ancak admin ya da firma yöneticisi bildirimi onaylarsa künyeye
eklensin.", (2) "mobil görünümde lightboxlardaki fotoğrafçı etiketi butonun üzerine geliyor.
Fotoğrafçı ismini tam fotoğrafın altında al. Ayrıca ürün etiketle butonu da X ve tümünü göre
butonuyla aynı hizada olsun.", (3) "proje ekle/düzenle sayfasında mobil görünümde Projede Kullanılan
Ürünler kutusunda iki kutucuğu yan yana değil alt alta koy."

### 1. ADMIN KISAYOLU KALDIRILDI — her künye talebi onaya düşer
- **KÖK NEDEN, dördüncü turun kendi kelepçesinde saklıydı**: `photoClaims.js#createClaim`,
  `hotspotTags.js`'ten devralınan "admin hesaplarından yapılanların onaya düşmesine gerek yok"
  kısayolunu taşıyordu — talebi ANINDA uyguluyor, `'approved'` kaydediyor ve **bildirim bloğuna hiç
  ulaşmıyordu**. Dördüncü turun testi bu dalı "onay kuyruğu atlatılamaz" başlığı altında DOĞRULUYOR
  sanıyordu. Oysa bu akış, ürün etiketlemenin aksine, talebi açan kişiden **profilin yöneticisi
  olmayı** istiyor (`architectManagerGate`) — yani kısayol "bazı" değil **TÜM admin taleplerini**
  kapsıyordu. Kullanıcının gördüğü davranış tam olarak buydu: "bildirim gitmedi, ad kendiliğinden
  eklendi".
- **Kaldırılan tek şey o dal**: her talep artık `'${PENDING}'` açılır ve bildirim koşulsuz gider.
  Alıcılar DEĞİŞMEDİ (`officeManagerUserIds` + `adminUserIds`, karar kümesiyle AYNI kaynak).
  `createClaim` içinde `applyPhotoClaim` çağrısı **KALMADI** — künyeye tek yazma noktası karar ucu
  (`decideClaim`). Artık kullanılmayan `claimRow` ara nesnesi de düştü; INSERT `image_url`'i zaten
  açıkça NULL yazıyor.
- **Adminler hız sınırından MUAF KALDI** ama gerekçesi değişti: eskiden "talebi kuyruğa hiç
  düşmüyor" idi, artık "kuyruğu boşaltan taraf onlar ve talep bir yazma değil bir öneri".
- **İstemcide TEK mesaj**: `photo-finder.js`'teki `data.status === 'approved'` dalı ölü kod olacaktı,
  kaldırıldı. Kullanıcı her durumda "talebin onaya gönderildi" görür.

### 2. Mobilde "Fotoğraflarını Bul" kendi satırında, sol kenarda
- Kural `css/architect-detail.css`'in yeni `@media (max-width:560px)` bloğunda:
  `#am-find-photos-slot{display:block; margin-top:10px;}` + `.rt-add-btn{margin-left:0;}`.
- **Eski davranış TESADÜFİ idi** (Chromium 390px'te ölçüldü): başlık iki satıra sarıyor, düğme
  üçüncü satıra düşüyordu ama **başlık metninin uzunluğuna bağlı olarak** — ve 34px girintili,
  başlığa 20px yakın. `display:block` bunu kesinleştirir; `margin-left:0`,
  `claim-correction-box.js`'in `.rt-add-btn{margin-left:10px}` girintisini siler (o kural satır İÇİ
  hap düğme için doğru, kendi satırındaki düğmede sol kenardan kayma olurdu).
- Seçici **id + class** taşıdığı için enjekte edilen `<style>`'ın cascade sırasından bağımsız kazanır.
- Ölçüm sonrası: 390px'te düğme `left:34` = bölümün sol kenarı, başlık satırının 8px altında;
  1200px'te hiçbir şey değişmedi (düğme hâlâ başlığın yanında, aynı `top`).

### 3. Mobilde lightbox — etiket fotoğrafın altında, hap düğme X ile aynı hizada
- **Fotoğrafçı etiketi AKIŞA girer**: `<=560px`'te `.lightbox{flex-direction:column}` ve
  `.lightbox-credit{position:static; right:auto; bottom:auto; margin:8px 0 0; text-align:center}`.
  Ölçüldü: etiket sağ-altta (`bottom:22px`) duruyordu, `.lightbox-next`'in TAM YÜKSEKLİKTEKİ dokunma
  şeridiyle çakışıyordu ve görüntünün alt kenarından ~240px aşağıdaydı — yani fotoğrafın "altında"
  değil ekranın dibindeydi. Akıştaki tek diğer çocuk görüntünün kendisi (kapat/oklar/ızgara/alt
  çubuk hepsi `absolute`), bu yüzden sütun yönü başka hiçbir şeyi etkilemez.
- **`.lightbox.open.has-credit > img{max-height:calc(100% - 34px)}`**: etiket akışa girdiğine göre
  görüntü tam boyu doldurursa etiket ekran dışına taşardı. Sınıf **her karede canlı** yazılır
  (`paintCredit`) — künye görsel başına değişebiliyor (bkz. `image_credits`), yalnızca açılışta
  yazılsaydı künyesiz bir karede görüntü boşuna 34px kısa kalırdı.
- **Hap düğme X ile AYNI KUTU**: `.lightbox-tag-btn` mobilde `top:24px; left:32px; height:31px;
  padding:0 12px; box-sizing:border-box` + `align-items:center`. Yalnızca `top`'u eşitlemek
  YETMEZDİ — hap kendi dolgusuyla 26px, ikon butonları 31px yüksekliğinde, yani merkezleri ~3px
  kayardı. Referans kutular `css/project-detail.css`'te (`.lightbox-close`, `.lightbox-grid-toggle`:
  `top:24px`, sağdan 32px), hap simetrik olarak soldan 32px.
- Masaüstü görünümü DEĞİŞMEDİ (1200px'te ölçüldü): düğme alt çubukta, etiket sağ-altta.

### 4. proje-ekle: "Projede Kullanılan Ürünler" kutuları mobilde alt alta
- `@media (max-width:720px)` (sayfanın yerleşim breakpoint'i):
  `.brand-add-row{flex-direction:column; align-items:stretch;}`.
- **`align-items:stretch` ŞART**: satırın masaüstü değeri `flex-start`, yani column eksende çocuklar
  kendi içerik genişliğinde kalır ve kutular sola yapışık, farklı genişliklerde görünürdü. "+ Ekle"
  düğmesi de tam genişliğe geçer — kendi satırındaki bir düğmenin içerik genişliğinde kalması aynı
  ayrışık görünümü verirdi. Ölçüldü (390px): üç çocuk da 300px genişlikte, alt alta; 1200px'te satır
  düzeni aynen duruyor.

Testler: `scripts/test-2026-09-16-find-photos-and-mobile-tag-button.mjs` (49 test, preflight'a
bağlı) — dördüncü turun iki kelepçesi bu turda güncellendi (admin dalını DOĞRULAYAN assertion artık
dalın YOKLUĞUNU arıyor; mobil hap düğme kuralının ölçüleri değişti).

## Onaylanan künye kişi pop-up'ında, liste kutuları ve lightbox'ta "Kaydet" (2026-09-16, altıncı tur)

Kullanıcı isteği (yedi madde): (1) "Fotoğraflarını Bul çalışıyor sorun yok ama böyle bir talep
onaylanır ve fotoğrafçı künyeye eklenirse kişi popupındaki 'Fotoğrafladığı Projeler' kısmında da
proje gözüksün.", (2) "Proje ekle/düzenle sayfasında da tarih kısmında tarih listeden seçilebilir
olsun. 2 kutucukta da sadece birer tane tarih seçilebilsin. Tarihleri MÖ seçeneğinden başlat ve
1'den günümüze kadar getir. Ürün ekle sayfasındaki yıl kutucuğunda da aynı mantık olsun ama oradaki
tarihleri 1299'dan başlat.", (3) "sadece adminin görebildiği yayın tarihi kısmını projeyi
gönder/arşivle butonlarının altına al.", (4) "Kişi ekle sayfasındaki üniversiteler de çoktan seçmeli
olsun. Kişi isterse birden fazla seçebilsin, listeye kendi de manuel olarak bir üniversite
yazabilsin.", (5) "'Kullanılan Projeler' başlığını 'Kullanıldığı Projeler' olarak güncelle.",
(6) "Admin panelindeki 'Yayındaki İçerikler' kısmını kaldır.", (7) "Proje ve ürün lightboxlarında
sağ üstteki butonların sol yanlarına kaydet butonu da ekle. Kullanıcılar sadece görsel de
kaydedebilsinler ... Kaydettiklerim kısımında Görsel diye filtre butonu aç."

### 1. Onaylanan fotoğraf künyesi kişi pop-up'ında — KÖK NEDEN ÖNBELLEK, VERİ DEĞİL
- Zincir zaten tamdı: `photoClaims.js#applyPhotoClaim` onayda `project_photographers` kenarını
  kuruyor ve `architect.js#buildArchitectPayload` "Fotoğrafladığı Projeler" bölümünü TAM OLARAK o
  tablodan okuyor. Eksik olan tek şey **kişi detay önbelleğinin temizlenmesi**: `/api/architect/:slug`
  (ve `/kisi/:slug` SSR gövdesi) `caches.default`ta s-maxage ile durur ve **fingerprint TAŞIMAZ**,
  yani onaydan sonra açılan pop-up bayat listeyi göstermeye devam ediyordu. Bu, `hotspotTags.js` ve
  aynı dosyanın PROJE tarafı için 2026-09-16 ikinci turda zaten belgelenmiş tuzağın **kişi
  tarafıdır** — o tur yalnızca `purgeSsrDetailCache('project', ...)` çağırıyordu.
- Eklenen tek satır `purgeSsrDetailCache('architect', match.row.name, env)`. **Anahtar CANONICAL
  AD**: architect/office tipleri anahtarı ADDAN slugify eder (`ssrCache.js#SLUGIFY_TYPES`), ve
  talepteki ad bir yeniden adlandırmadan sonra ESKİ yazım olabilir.
- **Kenar artık koşulsuz kurulur**: `INSERT OR IGNORE INTO project_photographers` eskiden
  `if (!alreadyCredited)` dalının içindeydi. INSERT zaten fikirsiz olduğundan koşulun faydası yoktu;
  zararı vardı — künyede adı YAZAN ama kenarı hiç kurulmamış bir kayıt (künye elle yazılmışsa
  `syncProject` eşleşme bulamamış olabilir) onayla onarılamıyordu.

### 2. Tarih/yıl kutuları listeden seçilir
- **Yeni sarmalayıcı `office-picker.js#createYearPicker({from, bc})`** — gövde AYNI
  `createNamePicker`. İki yeni yetenek: **`items`** (statik liste; hiç fetch yok ve sıra ÇAĞIRANIN
  verdiği sıra — `loadMergedOptions`'ın `localeCompare`'ı yıllarda "10"u "2"den önce koyardı) ve
  `loadOptions`'ın artık DÜZ METİN öğeleri de kabul etmesi (`/api/architects/schools` `{items:["A"]}`
  döndürüyor).
- Liste: proje tarafında **`MÖ` + 1 … bugün** (`bc: true`), ürün tarafında **1299 … bugün**. Üst
  sınır `new Date().getFullYear()` — sabit yazılmadı. `single: true` ("2 kutucukta da sadece birer
  tane tarih seçilebilsin").
- **`allowCustom` AÇIK ve BU BİR VERİ KORUMASIDIR, kolaylık değil**: canlı künyelerde "MÖ
  5500-3500", "19. yy", "4-5. yüzyıl" gibi değerler var (bkz. `project.js#parseProjectDateYear`).
  `createNamePicker` seçili-ama-listede-olmayan değerleri zaten seçenek olarak KORUR
  (`allOptions`/`extras`), yani var olan bir kaydı düzenleyen kullanıcı tarihini kaybetmez.
- Sözleşme sayfadaki diğer kutularla aynı: görünür input'un yerini `type="hidden"` bir input alır
  (`.p-date-start`/`.p-date-end`, `#u-year`) ve kutu her yazmada `input` olayı yayar — `pendingDate`'i
  besleyen iki dinleyici ve `#u-year`'ı okuyan gönderim/prefill yolları DEĞİŞMEDİ.
- **LİSTE PANEL AÇILMADAN DOM'A BASILMAZ** (ölçülerek eklendi, TÜM kutular için geçerli):
  yıl kutusunda 2027 seçenek = ~4000 eleman ve proje-ekle'de İKİ kutu var. Chromium/390px ölçümü —
  `renderDateRows()` **46 ms → 3 ms**, sayfa düğüm sayısı **12.635 → 475**. `listOpened` bayrağı ilk
  açılışa kadar çizimi erteler; sonrasında davranış eskisi gibi (her seçim/aramada yeniden çizim).

### 3. Yayın Tarihi kutusu en altta
- `#p-publish-date-row` Görseller bölümünün altından **"Projeyi Gönder" + Arşivle/Sil satırının
  ALTINA** taşındı. Taşınan yalnızca DOM yeri: id, `name="publishDate"`, admin görünürlük kapısı ve
  `payload.publishDate` aynen duruyor. Kutu `<form>`'un İÇİNDE kalır — dışına alınsaydı
  `name` taşıyan bir alan form verisinden düşerdi (bu sayfa değeri id ile okusa da sessiz bir tuzak).

### 4. Üniversite çoklu seçim + elle yazma
- **`architects.school` ŞEMA OLARAK DEĞİŞMEDİ** — tek TEXT kolon, çoklu değer **virgülle** ayrılır.
  Bu, bu depoda zaten kullanılan biçim: `architects.profession` ("Mimar, Fotoğrafçı") ve
  `architect_submissions.office` aynı şekilde taşınır. Tek değerli ESKİ satırlar bu biçimin geçerli
  bir örneği, yani **veri taşıması GEREKMEDİ**.
- Tek kaynak `src/lib/universities.js#schoolNameList` (trim + `canonicalSchoolName` + TR duyarsız
  tekilleştirme). Okuyan DÖRT yüzey de parçalar: havuz (`fetchArchitectPool` -> `schools` dizisi),
  filtre (`schoolParams.some(...)`, grup içi OR), sayaçlar (her okul AYRI sayılır) ve
  `/api/architects/schools` (bölünmezse "A, B" listeye TEK uydurma seçenek olarak girerdi).
- **ESKİ KV HAVUZU KORUNUR**: havuz 30 dakikaya kadar KV'de yaşıyor (`POOL_CACHE_TTL_SECONDS`), yani
  deploy anında `schools` alanı OLMAYAN bir havuz okunuyor olabilir. `architect.js#schoolListOf` o
  pencerede tek değerli `school` metnini tek elemanlı diziye çevirir — filtre/sayaçlar da çalışmaya
  devam eder (`professions`'taki koruma yalnızca boş diziye düşüyordu).
- Kişi pop-up künyesi her okulu AYRI `/kisi?school=` bağlantısı yapar (`profession` satırıyla
  BİREBİR aynı desen). `/danismanlik` filtresi de `schools` dizisini okur.
- Kutu **İKİ yüzeyde de** aynı bileşen: `kisi-ekle.html#m-school-picker` ve Hesabım modalindeki kişi
  formu (`am-edit-school-picker`). Doğrulama (`isInvalidSchoolValue`, kısaltma reddi) artık her
  PARÇA için ayrı çalışır — aksi halde "Yıldız Teknik Üniversitesi, YTÜ" toplamda geçerli sayılırdı.
- **Ölü kod düştü**: `kisi-ekle.html`'deki `wireAutocomplete`/`wireAutocompleteLive` (+ yalnızca
  ikincisinin kullandığı `lastCommaSegment`/`replaceLastCommaSegment`) ve `auth-modal.js`'teki
  `wireAmEditSchoolAutocomplete` çağrısız kaldı; iki dosyadaki `.ac-*` CSS'leri de.
- **Hesap tarafı DOKUNULMADI**: `hesabim.html#edit-school` ve `auth.js#updateUserProfileFields`
  HESABIN `users.school` alanıdır (bkz. "Hesap üyeliği ile kişi profili AYRIDIR") — istek kişi
  formunu sayıyor.

### 5. urun-ekle başlığı "Kullanıldığı Projeler"
- Yalnızca FORM başlığı. Kutunun ipucundaki "Kullanılan Projeler" alıntısı BİLEREK duruyor: o, ÜRÜN
  SAYFASININ bölüm adıdır (`product-modal.js#pr-projects-title`) ve değişmedi.

### 6. Admin "Yayındaki İçerikler" sekmesi kaldırıldı
- Sekme, bölüm, `loadContent`/`toggleContentEditForm`/`CONTENT_EDITABLE_FIELDS` ve yalnızca o kartta
  kullanılan `loadFeaturedProjectSlugs`/`toggleFeaturedProject` `admin.html`'den çıktı.
- **SUNUCU UÇLARI DURUYOR** (`GET /api/admin/submissions?status=approved`, `PATCH`/`DELETE`
  `/api/admin/submissions/:type/:id`) — Arşiv ve Bekleyen Gönderiler sekmeleri aynı uçları kullanmaya
  devam ediyor; kaldırılan tek şey EKRANDI (2026-09-16 ilk turdaki "Migrasyon Çakışmaları" ile AYNI
  desen).
- **"Öne Çıkar" ile hiçbir yetenek kaybedilmedi**: `featured_project_slugs` ayarının gerçek arayüzü
  ANA SAYFA sekmesindeki karusel seçicisidir (`HOME_CAROUSELS`).

### 7. Lightbox'ta "Kaydet" — GÖRSELİN KENDİSİ kaydedilir
- **Yeni `saved_items` tipi `'image'`** (`saved.js#ITEM_TYPES`), `'gundem'` ile AYNI desen: YENİ bir
  altyapı kurulmadı — aynı tablo, aynı `/api/saved` uçları, aynı `save-widget.js` buton durumu ve
  **pano yolu kendiliğinden** (`collections.js` bu Set'i İÇE AKTARIR). Migration GEREKMEDİ.
- **ANAHTAR GÖRSELİN URL'Sİ, indeks DEĞİL**: proje-ekle'de görseller sürükle-bırak ile
  sıralanabiliyor ve indeks tabanlı bir anahtar her sıralamada başka bir kareye işaret ederdi
  (`image_hotspots`/`image_credits` ile AYNI gerekçe). `item_key` artık istemciden gelen serbest bir
  metin olduğundan **500 karakter üstü REDDEDİLİR** — kırpmak yanlış olurdu, silme ucu anahtarı
  birebir eşleştiriyor ve kırpılmış satır bir daha silinemezdi.
- `listSaved`'de `'image'` için açık dal: canonical bir SATIRI yoktur, "hedefi hâlâ yayında mı"
  sorusu bu tip için tanımsızdır.
- **Buton `.card-save-btn` SINIFINI TAŞIMAZ**: o sınıfın sayfa CSS'lerindeki KART kuralları
  (`position:absolute; top:10px; right:10px`) lightbox'ta yanlış yere oturturdu. Bunun için
  `save-widget.js`'in gövdesi tek-buton bir API'ye alındı (**`wireSaveButton(btn, type)`**);
  `wireSaveButtons(type)` onu ızgara kartları için döngüyle çağırır, `gallery.js` kendi düğmesi için
  doğrudan. Yeniden boyama da genişletildi: **`repaintAllSaveBtns()`** artık
  `.card-save-btn, .lightbox-save-btn` seçicisini kullanıyor, aksi halde kaydetme/panoya ekleme
  sonrası lightbox düğmesinin rengi güncellenmeden kalırdı.
- **KUTU, X ve "Tümünü Gör" ile BİREBİR AYNI** (ölçüldü, Chromium): `top:24px`, 38×31, sağdan üç
  yuva — `.lightbox-close` 32, `.lightbox-grid-toggle` 78, `.lightbox-save-btn` **124** (8px aralık).
  Yalnızca `top`'u eşitlemek YETMEZDİ: ikon-only bir düğme 20px yüksek kalır ve merkezi ~5px kayardı
  (2026-09-16 beşinci turda `.lightbox-tag-btn`'de ölçülen AYNI tuzak). Mobil için ayrı kural
  GEREKMEDİ — o iki buton mobilde de aynı yerde.
- **Hedef anahtarı HER KAREDE tazelenir** (`paintSaveBtnForImage`, `showLightboxImage`'tan çağrılır);
  aksi halde buton 1. karenin anahtarında kalırdı. Hedef seçici (Kaydedilenler/Pano) AYNI akıştır
  (`dataset.saveChooser`), yeni bir kaydetme yolu AÇILMADI.
- Buton **kilitli (önizleme) galeride** ve **`save-widget.js` yüklenmemiş sayfalarda** (ör. /arama)
  gizlenir — işlevsiz bir düğme göstermek yerine. Kontrol init'te DEĞİL boyama anında: init bir modal
  açılışında koşuyor olabilir, save-widget ise `<script defer>` sırasına göre biraz sonra yüklenir.
- Kaydettiklerim'de **"Görsel" filtresi İKİ yüzeyde de** (Koleksiyonum pop-up'ı + `hesabim.html`).
  Filtre mantığı (`colMatchesCatalogFilter`) DEĞİŞMEDİ — Gündem'deki AYNI desen.
- **TERS TIRNAK TUZAĞINA BU TURDA DA DÜŞÜLDÜ**: enjekte edilen CSS şablonundaki bir yoruma
  `` `.card-save-btn` `` yazmak şablon dizesini kapatıp yeniden açtı — `node --check` GEÇTİ ama dosya
  çalışma zamanında bozuktu. Beşinci turda eklenen "şablonda ters tırnak YOK" kelepçesi yakaladı
  (bkz. proje notu `[[feedback_no_backtick_in_style_template_literals]]`).

Testler: `scripts/test-2026-09-16-photo-visibility-pickers-and-image-saves.mjs` (34 test,
preflight'a bağlı). Migration YOK, SSR sürüm bumpı YOK (kabuklara script etiketi eklenmedi/
kaldırılmadı).
