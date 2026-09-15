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
  yok), bu yüzden firmadan çıkarılan biri kutudan da düşer. "Bilgileri Düzenle" yalnızca kendi
  künyesi sayfasında görünür.

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

## proje-ekle: firma kutusuna elle isim (2026-09-15)

- `office-picker.js` yeni **`allowCustom`** seçeneği: arama kutusuna yazılan ve listede karşılığı
  olmayan ad "+ «...» ekle" satırıyla (ya da Enter'la) seçime katılır.
- **YALNIZCA `proje-ekle.html` açar.** kisi-ekle ve Hesabım'daki kişi formu kapalı kalır: oradaki
  kutu sitede kayıtlı bir firmaya BAĞLANMAK içindir (bkz. `ensurePendingOfficeClaims`), serbest metin
  o zinciri karşılığı olmayan bir adla doldururdu.
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
