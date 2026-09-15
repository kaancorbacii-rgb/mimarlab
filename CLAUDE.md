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
