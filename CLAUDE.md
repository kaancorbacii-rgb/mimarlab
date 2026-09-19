# MİMARLAB — Proje Notları

## ÜCRETLİ KAYNAK KURALI — ÖNCE SOR (2026-09-19, kesin kullanıcı kuralı)

Kullanıcı: "Bir daha asla böyle yüksek ücretli bir şeyi aktif etmek istemiyorum ... Asla ama asla
bir daha böyle bir şey yapma." (17-18 Eylül'de fotoğraf mekan etiketlemesi Workers AI'da ~15,5 $
fatura çıkardı; maliyet yalnızca bu dosyaya not düşülmüş, kullanıcıya SORULMAMIŞTI.)

- Ücret doğurabilecek HİÇBİR şey kullanıcının AÇIK onayı olmadan eklenmez, çalıştırılmaz ya da
  zamanlanmaz: Workers AI çağrıları (özellikle görsel/LLM modelleri, toplu backfill'ler), yeni
  cron/`schedule` tetikleyicileri, AI kullanan GitHub Actions zamanlamaları, ücretli API'ler, R2/KV/D1
  kotasını aşabilecek toplu işler, yeni ücretli Cloudflare ürünleri.
- Önce kullanıcıya TAHMİNİ MALİYETİ ($ olarak) ve ücretsiz kotayı aşıp aşmayacağını söyle, onay
  bekle. "Bu dosyaya not düşmek" onay DEĞİLDİR.
- Mevcut durum: fotoğraf mekan etiketi cron'u (`*/15`) ve `photo-space-classify.yml` zamanlaması
  KAPALI. Yeniden açmak kullanıcı onayı ister.

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

## Kişi ↔ firma üyeliği ONAYA BAĞLANDI, rozet yalnızca profillere (2026-09-16, yedinci tur)

Kullanıcı isteği (yedi madde): (1) "MİMARLAB Robotu kişisine admin tarafından doğrulanmış üye rozeti
verilmesine rağmen ... popuplarda ve hesabım sayfasında Kişi Bilgileri kutusunda ad soyadın yanında
rozet gözükmüyor. Bu sorunu kökten çöz.", (2) "Firma popuplarında kapak görseli olmasına rağmen
düzenle butonuna tıkladığımız zaman kapak görseli kısmı ... boş gözüküyor. Bu sorunu kökten çöz.",
(3) "Profili düzenle butonuna tıklayınca açılan popuptaki bir kutucukta kullanıcının e-posta adresi
de yazsın ama bu değiştirilemesin.", (4) kaydı ekleyen yönetici olsun ama aynı adla ikinci kayıt
açılamasın ("bu özellik zaten vardı"), (5) firmaya BAŞKA bir firmada görünen bir kişi eklenirse o
firmanın yöneticisine + admine bildirim gitsin, onaya kadar kişi kısmı boş kalsın, (6) kişiye
YÖNETİCİSİ OLAN bir firma eklenirse aynı akış, onaya kadar firma kısmı boş kalsın, (7) "Bir kullanıcı
rozeti sadece kişi profilleri ya da firma profilleri için alabilsin, kullanıcı hesapları için rozet
alınamasın. Kullanıcı sadece sitede yönetici olduğu firmaya ve bu firmadaki kişilere rozet alabilsin."

**migrations/0123_profile_membership_claims.sql — KOD DEPLOY'UNDAN ÖNCE UYGULANMALIDIR**
(`.github/workflows/migrate.yml`). Tablo yoksa talep satırı açılamaz; kapı o pencerede GÜVENLİ yönde
davranır (ad künyeye yazılmaz) ama talep oluşmaz — `createMembershipClaims` hatayı yutar, gönderi
yazımı 500'e DÜŞMEZ.

### 1. Kişi künyesinin rozeti — İKİ AYRI kök neden
- **Firma pop-up'ında Ekip kartı**: rozet üç yerde çizilir ve `office-modal.js#teamCardHtml` onu HİÇ
  sormuyordu (başlık ve Kurucular/Ortaklar kartı soruyordu). Kurucular ile Ekip **AYNI kaynaktan**
  (`office_founders`) beslenip yalnızca göreve göre ayrıldığı için (bkz. `office.js#buildOfficePeople`)
  rozetin birinde görünüp diğerinde görünmemesinin hiçbir gerekçesi yoktu. Artık kart
  `verifiedBadgeHtml('architect', person.name, person.badges, 14)` çağırıyor ve **`renderTeamGrid`**,
  `renderFoundersGrid` ile birlikte `renderVerifiedBadges`'ten tazeleniyor — `/api/public/badges`
  ASENKRON geldiği için bu şart (ilk çizimde harita boş olabilir).
- **Hesabım > Kişi Bilgileri**: kaynak **HESABIN** rozetiydi (`myEffectiveBadgeType` — onaylı
  `profile_claims('architect')` arıyor, yoksa kullanıcının kendi `badge_requests('self')` satırına
  düşüyordu). İki sonucu vardı: (a) kişi künyesine sahiplik ATAMADAN değil **kaydı eklemekten**
  geliyorsa (`architects.claimed_by_user_id`) claim satırı hiç olmadığından rozet HİÇ görünmüyordu,
  (b) kutunun 2.+ sayfaları (yönetilen firmanın kişileri) adı düz metin basıyor, rozet hiç
  çizmiyordu. Artık TEK kaynak **`personProfileBadgesHtml`** → `amPublicBadges.architect[<ad>]`,
  yani **Firma satırıyla birebir aynı desen** (o satır 2026-09-02'den beri böyle okuyor). Kutudaki
  rozet ile kişi pop-up'ındaki rozet artık ayrışamaz. `myEffectiveBadgeType` SİLİNDİ — hesap rozeti
  kavramı bu satırdan tamamen kalktı, madde 7 de aynı yöne gidiyor.

### 2. Firma kapak görseli — `/api/office/:key` HAM kolonu döndürmüyordu
- `firma-ekle.html#prefillForClaim` **bilerek** `merged.cover_url` okuyor: `cover` TÜREVDİR
  (`cover_url` boşsa son projenin ilk görseline düşer, bkz. `office.js#latestProjectCover`) ve o
  türev değeri forma "yüklenmiş kapak" gibi yazmak, kullanıcı hiçbir şey yüklemediği hâlde kapağı
  kalıcı olarak sabitlerdi. **Ama yanıt `cover_url`ü HİÇ döndürmüyordu**, yani `merged.cover_url`
  her zaman `undefined`'dı ve gerçek kapak yüklenmiş olsa bile kutu boş açılıyordu.
- Düzeltme: payload artık `cover` (türev, görüntüleme) **ve** `cover_url` (ham kolon, form) alanlarını
  AYRI AYRI taşıyor. `?edit=<id>` yolu gönderi satırını okuduğu için (`item.cover_url`) hiç
  etkilenmemişti — hata yalnızca claim yolundaydı.

### 3. Salt okunur e-posta
- "Profili Düzenle" pop-up'ına `#am-account-email` (`readonly`) eklendi. `readonly`, `disabled`
  DEĞİL: disabled bir input seçilemez/kopyalanamaz ve ekran okuyucular atlar. `name` özniteliği YOK
  ve PATCH gövdesine hiç konmaz; sunucu karşılığı da zaten kapalı —
  `auth.js#updateUserProfileFields`'in izinli alan listesinde `email` YOKTUR.

### 4. Kaydı ekleyen yöneticidir + aynı adla ikinci kayıt YOK
- Zaten yürürlükteydi, bu turda yalnızca KELEPÇELENDİ: `submissions.js#createSubmission` ->
  `isDuplicateCanonicalName` (409, mevcut profilin slug'ıyla) ve `claimed_by_user_id` kapıları
  (`canEditOfficeAsCreator` / `canEditArchitectAsCreator` / `fetchOwnCreatedOfficeRows`).

### 5 + 6. KİŞİ ↔ FİRMA ÜYELİK ONAY KUYRUĞU (yeni)
- **Tablo `profile_membership_claims`** (`migrations/0123`), `project_photo_claims` /
  `product_hotspot_tags` kuyruklarının KARDEŞİ: aynı durum sözlüğü, aynı "karar kümesi = bildirim
  kümesi" kuralı, aynı `membership-claim:<id>` bildirim→pop-up bağlantısı. Karar veren firma TEK
  kolonda (`decider_office_name`): madde 5'te kişinin ZATEN göründüğü DİĞER firma, madde 6'da
  eklenmek istenen firmanın kendisi — böylece `canDecideMembership` tek kurala iner.
- **KAPI GÖNDERİ YAZIMINDA, canonicalSync'te DEĞİL** (`submissions.js#withholdPendingMemberships`,
  `createSubmission` + `updateOwnSubmission`). Gerekçe "boş kalsın" şartının ta kendisi: firma
  pop-up'ının Kurucular/Ekip listeleri İKİ kaynaktan beslenir — yapısal bağ (`office_founders`) VE
  **gönderi satırındaki serbest metin adlar** (`office.js#fetchRawFounderNames/fetchRawTeamNames`).
  Yalnızca bağı engellemek YETMEZDİ: ad gönderi metninden okunup pop-up'ta yine görünürdü. Adı
  gönderiye hiç yazmayarak iki yol birden kapanır.
- **TUZAK**: `normalizeSubmission` dizi alanlarını **JSON METNİ** olarak bırakır (değerler doğrudan
  SQL'e bind ediliyor). Diziymiş gibi `filter()` çağırmak sessizce hiçbir şey süzmez ve kapı
  görünürde çalışıp gerçekte kapanmazdı — kutular `JSON.parse`/`JSON.stringify` ile ele alınır.
  Kişi tarafındaki `office` ise düz (virgüllü) metindir.
- **VAR OLAN ÜYELİK GERİ ÇEKİLMEZ** (`membershipExists`): istek "eklemek istediği zaman" diyor. Aksi
  halde bir firmanın mevcut üyesi kendi künyesini (ör. yalnızca açıklamasını) düzenlediğinde firma
  adı künyeden SESSİZCE düşer ve yeniden onay beklerdi — 2026-09-08'deki firma-tarafı kapısının
  `pendingIds` ile koruduğu AYNI şey.
- **MUAFİYETLER**: admin (kuyruğun onaylayıcısı); madde 6'da firmanın yöneticisi (onaylayacak kişi
  kendisi); madde 5'te kişinin göründüğü DİĞER firmayı da yöneten kullanıcı. Sitede kaydı olmayan
  serbest metin ad kapı DIŞI (bağ da üretemez). Firma sitede henüz YOKSA (ilk gönderi) kapı yok —
  bağ kurulacak firma daha oluşmadı, o künye admin moderasyonundan geçer.
- **madde 6'da DARALTMA YOK, GENİŞLETME YOK**: firmanın yöneticisi YOKSA davranış DEĞİŞMEDİ — bağ
  yine `canonicalSync#splitAdminApprovedOffices` kapısına tabidir (admin onayı). İstek "zaten bir
  yöneticisi varsa" diyor.
- **ONAY ÜÇ YERE YAZAR** (`membershipClaims.js#applyMembershipClaim`): (1) TASLAK — `canonicalSync`
  künyeyi gönderi satırından BAŞTAN yazdığı için yalnızca canonical'a yazmak bir sonraki kaydetmede
  SESSİZ VERİ KAYBI olurdu (hotspotTags/photoClaims'teki AYNI tuzak); (2) yapısal bağ
  (`office_founders`, `INSERT OR IGNORE` — mükerrer onay fikirsiz); (3) kişi tarafında birincil firma
  (`architects.office_id`) **YALNIZCA BOŞSA** — dolu bir değeri ezmek kişinin kendi seçtiği birincil
  firmayı sessizce değiştirirdi. Ardından **İKİ profilin** detay önbelleği purge edilir (bağ hem
  firma hem kişi pop-up'ını değiştirir ve o uçlar fingerprint TAŞIMAZ).
- Bildirim alıcıları = karar kümesi, TEK fonksiyondan (`officeManagerIds` → `fetchOfficeManagers` +
  `OFFICE_EDIT_POSITIONS`, yani "Hesabım > Yetkili Kullanıcılar" kümesiyle birebir aynı) + TÜM
  adminler. Onay pop-up'ı `auth-modal.js#openMembershipClaimPrompt` — `openPhotoClaimPrompt` ile
  birebir aynı iskelet; yeni bir onay deseni icat EDİLMEDİ.
- `createMembershipClaims` **best-effort**: gönderi yazımı BAŞARIYLA tamamlandıktan sonra çalışır ve
  onu asla 500'e düşürmez (`createNotification`'daki AYNI gerekçe).

### 7. Rozet yalnızca KİŞİ/FİRMA profilleri için
- **`'self'` hedefi KALDIRILDI** (`badges.js#normalizeTarget`): o hedef HESABA rozet veriyordu ve
  profilde ancak dolaylı olarak (kullanıcının onaylı architect claim'i üzerinden) görünüyordu.
  Yerine **`'architect'`** geldi ve KİŞİ KÜNYESİNİN ADIYLA anahtarlanır — `'office'` ile birebir aynı
  desen. Bu, "Hesap üyeliği ile kişi profili AYRIDIR" kuralının rozet tarafındaki karşılığıdır.
- **ESKİ `'self'` SATIRLARI SİLİNMEDİ ve okunmaya devam eder** (`computeBadgesPayload`'ın ilk
  sorgusu) — yalnızca YENİ talep açılamaz. `'office'` yolunun davranışı da DEĞİŞMEDİ.
- **Kişi hedefli satın almalar sahiplenme JOIN'İ OLMADAN okunur** (ayrı sorgu): satın alan kişi
  tanımı gereği hedefin sahibi değildir (firma yöneticisi, firmasındaki BİR BAŞKASI için alır), o
  JOIN hiç eşleşmez ve rozet hiçbir yerde görünmeyen ölü bir satın almaya dönüşürdü. Yetki kapısı
  satın alma anındadır; anahtar doğrudan hedefin ADIDIR (`admin_badges` ile AYNI desen). Kabul edilen
  ödünleşme: yönetici yetkisi sonradan iptal edilse bile satın alınmış rozet `expires_at`'e kadar
  profilde kalır — alternatifi, herkese açık ve ÖNBELLEKSİZ olan `/api/public/badges`'te satır başına
  bir üyelik sorgusu koşturmaktı.
- **KAPI TEK** (`verifyBadgeTargetOwnership`): `'office'` → onaylı `profile_claims('office')`
  (2026-09-01'den beri geçerli kural, değişmedi); `'architect'` → kişi, kullanıcının yönettiği
  firmalardan birinin ÜYESİ olmalı (`office_founders` + `architects.office_id`). Eşleşme `foldTr` ile.
  Havale (`badges.js#createBadgeRequest`) ve kart (`payments.js#startCheckout`) AYNI fonksiyonu
  çağırır. Serbest metin adlar (canonical kaydı olmayan) kapsam dışı — o ada verilen rozet hiçbir
  yerde görünmezdi.
- **Hedef listeleri SUNUCUDAN** (`GET /api/badges/targets`) ve o uç kapının TA KENDİSİNİ okur; ayrıca
  hedef başına O AN GÖRÜNEN rozeti de döner, yani "zaten bu rozetin var" paneli ile sunucunun
  (`getBlockingRank`) engellediği rozet AYNI veriden gelir. İKİ yüzey de güncellendi
  (`satin-al.html` + `info-modal.js#mountRozetAl`); "Kendim için" seçeneği ikisinden de kalktı ve
  `myProfileBadges` okuması düştü (o alan yalnızca kullanıcının KENDİ sahiplendiği profilleri
  taşıyordu, firmasındaki kişileri taşımıyordu).

Testler: `scripts/test-2026-09-16-membership-claims-and-profile-badges.mjs` (31 test, preflight'a
bağlı) — üyelik kapısının ve rozet kapısının tamamı GERÇEK SQLite fikstürü üzerinde ölçülür
(`schema.sql` + 0079; `name_fold` ÜRETİLMİŞ kolon olduğundan INSERT'lerde verilmez).

## Ekip rozeti, gece modu lightbox ikonları, Hesabım hızı ve azalan yıl listesi (2026-09-16, sekizinci tur)

Kullanıcı isteği (dört madde): (1) "Kişi popupındaki ekip arkadaşları kısmında da rozet gözükmüyor
bu sorunu düzelt.", (2) "Gece görünümünde lightboxlardaki kaydet tümünü göster ve kapat butonlarının
icon renklerini beyaz yap.", (3) "Hesabım sayfasındaki Firma Bilgileri ve Kişi Bilgileri kutuları
çok yavaş yükleniyorlar, buna bir çözüm bul. Daha hızlı yüklensinler.", (4) "Proje ekle/düzenle
sayfasında Tarih başlığının altındaki Başlangıç kutucuğunda opsiyonel yazmasın. Ayrıca açılan
tarihler günümüzden geçmişe doğru olsun. Ürün sayfasındaki Yıl kutucuğunda da tarihler günümüzden
eskiye doğru olsun."

### 1. "Ekip Arkadaşları" kartında da rozet
- **AYNI SINIF HATA, yedinci turdaki `office-modal.js#teamCardHtml` ile birebir**: kart geri-çağrısı
  `verifiedBadgeHtml`'i HİÇ sormuyordu. Komşu **Ortaklar** ızgarası soruyordu — oysa iki liste
  `buildOfficePeople`'ın AYNI kaynağından (`office_founders`) gelip yalnızca GÖREVE göre ayrılıyor
  (bkz. `office.js#buildOfficePeople` -> `FOUNDER_POSITIONS`), yani rozetin birinde görünüp
  diğerinde görünmemesinin hiçbir gerekçesi yoktu.
- Çizim **`renderTeamGrid()`** adlı ayrı bir fonksiyona alındı ve `renderVerifiedBadges()`
  `renderOfficeGrid`/`renderColleaguesGrid` ile birlikte onu da çağırıyor. Bu ŞART:
  `/api/public/badges` ASENKRON gelir, ilk çizimde `dynamicBadges` haritası boş olabilir — satır
  olmadan rozet yalnızca önbellek zaten dolu olduğunda görünürdü (kişi A'dan B'ye gezinmede
  tesadüfen çalışır, ilk açılışta çalışmaz).
- **Sunucu tarafı DEĞİŞMEDİ**: `structuredTeam` satırları `badges` anahtarı taşımaz (`founders`
  `badges: []` taşır), ikisi de `verifiedBadgeHtml`'in statik yedeğine düşer — asıl kaynak ad bazlı
  `dynamicBadges` önbelleğidir.

### 2. Lightbox ikonları gece görünümünde de beyaz
- **KÖK NEDEN TEMA TOKEN'I**: ikonlar `color:var(--paper)` taşıyordu; `--paper` açık temada
  `#EDF0F3`, **gece temasında `#12171F`**. Lightbox zemini ise HER temada koyudur
  (`rgba(27,42,61,0.92)`) — yani gece modunda koyu zemin üstüne koyu ikon çiziliyordu.
- Çözüm: bu kurallarda renk artık **SABİT `#EDF0F3`** (açık temanın `--paper` değeri). Aynı
  dosyalardaki `.lightbox-counter` (`#fff`), `.gallery-nav` (`#fff`) ve `gallery.js#.lightbox-credit`
  (`rgba(237,240,243,0.92)`) bu yüzden ZATEN sabit değer taşıyordu; `image-lightbox.js` de
  `#EDF0F3` kullanıyordu — kural o iki örneğe hizalandı, yeni bir desen icat edilmedi.
- **Kapsam**: kapat (`.lightbox-close`), "Tümünü Gör" (`.lightbox-grid-toggle`), kaydet
  (`gallery.js#.lightbox-save-btn`) **ve oklar** (`.lightbox-nav`) — oklar istekte adı geçmiyordu
  ama AYNI kök nedenle gece modunda görünmez oluyordu, aynı turda düzeltildi.
  Kural **DÖRT kopyada** yaşıyor (paylaşılan stylesheet yok): `css/project-detail.css`,
  `css/architect-detail.css`, `css/product-detail.css`, `en-iyi-100.html` + `gallery.js` (kaydet).
  `.pm-map-lightbox-close` (harita lightbox'ı) da aynı kapsamda.
- **SSR sürüm bumpı GEREKMEDİ**: detay kabukları CSS'i `<link>` ile çeker (revalidate edilir) ve
  `/en-iyi-100` `LIST_PAGE_CACHE_HEADERS` (max-age=60/s-maxage=300) ile servis edilir, sürümlenmiş
  Cache API anahtarıyla DEĞİL.
- Ölçüldü (Chromium, gerçek CSS dosyası): `data-theme="dark"` -> dört düğme de
  `rgb(237,240,243)`; açık temada sonuç BİREBİR eskisi gibi.

### 3. Hesabım'ın Firma/Kişi Bilgileri kutuları — ÜÇ ayrı gecikme kaynağı
- **(a) SUNUCU: `/api/claims/mine` yedi bağımsız sorguyu ARDI ARDINA await ediyordu.** Üçü kendi
  içinde de zincirliydi (`fetchOfficeFounderLinks` 3 dalga, `fetchOwnOfficeRoles` 2,
  `fetchOwnCreatedOfficeRows` 2) — **toplam ~13 SIRALI D1 gidiş-dönüşü**, hiçbiri diğerinin
  sonucunu kullanmadığı hâlde. Artık tek `Promise.all`; kritik yolu en uzun dal (3 dalga) belirler.
  Ölçüldü (gerçek yardımcılar, gidiş-dönüş başına sabit gecikmeyle sahte D1): **13 dalga -> 4 dalga**.
  * `fetchOwnArchitectRows` ÜÇ yoldan, `revokedOfficeKeysForUser` İKİ yoldan çağrılıyor; sıralıyken
    her biri ayrı gecikme ekliyordu, paralelde aynı dalgada koşuyorlar. **Yardımcıların içine memo
    KOYULMADI**: modül ömürlü bir önbellek Workers'ta isolate'lar arası yaşar ve bayat YETKİ verisi
    servis edebilirdi.
  * **İki `profile_claims` sorgusu BİRE indi**: `status != removed` (liste) ile `status = removed`
    (`dismissed`) aynı satır kümesinin tümleyenleriydi — tek SELECT + JS'te ayırma.
- **(b) İSTEMCİ: aynı uç iki kez çekiliyordu.** `/api/architects/mine` İKİ kez
  (`fetchOwnSelfSubmission` + `fetchArchitectRecordForSync`) ve `/api/architect/:key` İKİ kez
  (`fetchClaimedArchitect` + `fetchArchitectRecordForSync`) — çağıranlar farklı SÜZGEÇ uyguladığı
  için her biri kendi isteğini atıyordu. Artık **HAM yanıt paylaşılır** (`fetchMyArchitectSubmissions`,
  anahtar başına `fetchArchitectItem`), süzgeç çağıranda kalır. `invalidatePersonCaches()` bu iki
  memoyu da düşürür — aksi halde eski üç memo boşalsa bile hepsi yine bayat veriden beslenirdi.
  Ayrıca `fetchArchitectRecordForSync` iki isteği artık PARALEL başlatıyor (birbirine bağlı değiller).
- **(c) İSTEMCİ: `/api/office/:key` istekleri kişi künyesi await'inin ARKASINDA bekliyordu.**
  `loadFirmInfo` sırası "claims/mine -> architect/:key -> office/:key" şeklinde ÜÇ SIRALI
  gidiş-dönüştü; oysa anahtarların hepsi ZATEN elde (claim'ler + `officeLinks` + `ownOffices`, üçü de
  `/api/claims/mine`'ın AYNI yanıtından) ve o await'e bağlı olan yalnızca DÖRDÜNCÜ kaynak (kişi
  künyesinin `office` alanı). Artık istekler await ile paralel ısıtılır.
  * **ISITMA KÜMESİ BİLEREK DAR**: yalnızca ZATEN çekilecek anahtarlar — `canManageFirmEntry`'nin
    AYNI koşulundan geçen firmalar + 1. sayfanın firması. Tüm anahtarları ısıtmak, hiç açılmayacak
    sayfalar için YENİ istekler doğururdu (`ensureFirmOffice` argümansız çağrıldığında yalnızca AÇIK
    sayfanın künyesini çeker).
  * **GİRDİ SIRASI ve ÇİZİM ANI DEĞİŞMEDİ**: ısıtma yalnızca `firmOfficeCache`'i doldurur, aşağıdaki
    `ensureFirmOffice` çağrıları onu hazır bulur (anahtar başına tek uçuş guard'ı sayesinde istek
    ikiye çıkmaz).

### 4. Tarih/Yıl kutuları: yer tutucu + AZALAN sıra
- `proje-ekle.html`'deki yer tutucu düz **"Başlangıç"**. **Davranış değişmedi**: Tarih alanı
  ZORUNLUDUR (`Tarih *` + submit guard'ı "Bir tarih gir.") ama `formatDateRow` start VEYA end'den
  biri doluysa yeter — "(opsiyonel)" bunu anlatmaya çalışıyor ve etiketle çelişiyordu.
- `office-picker.js#yearOptionList` artık **AZALAN** üretir (`for (let y = now; y >= from; y--)`);
  altıncı turda ARTAN'dı ve gerçekte kullanılan yıllar listenin en DİBİNDE kalıyordu. **Kapsam
  DEĞİŞMEDİ** (proje 1..bugün, ürün 1299..bugün; üst sınır hâlâ `new Date().getFullYear()`).
- **"MÖ" artık listenin SON öğesi**: azalan sıralamada en eski değer sona düşer ve MÖ, `from`'dan
  da eskisini ifade eder — başta durması sırayı bozardı.
- **Sıra bozulmuyor** çünkü statik `items` yolu `loadMergedOptions`'ın `localeCompare` sıralamasını
  HİÇ kullanmaz (altıncı turda bilerek böyle kuruldu — "10" aksi halde "2"den önce gelirdi).
  `allOptions()` seçili-ama-listede-olmayan değerleri (`extras`, ör. canlı künyedeki "MÖ 5500-3500")
  başa koymaya devam eder.
- Sıra kelepçesi altıncı turun test dosyasından bu turun dosyasına TAŞINDI (o dosyada kapsam ve
  "üst sınır sabit değil" ölçümü kaldı).

Testler: `scripts/test-2026-09-16-team-badges-lightbox-icons-and-account-speed.mjs` (31 test,
preflight'a bağlı). Madde 3'ün ölçümü GERÇEK yardımcıları sahte bir D1 üzerinde koşturur ve eski
(sıralı) kurgu ile yeni (paralel) kurguyu YAN YANA zamanlar — kurala değil gerçek süreye bakar.
Migration YOK, SSR sürüm bumpı YOK.

## Google Search Console "Server error (5xx)" — bozuk %-kodlaması (2026-09-17)

Kullanıcı isteği: Search Console'un "New reason preventing your pages from being indexed: **Server
error (5xx)**" bildirimi (ekran görüntüsü) — "Bu sorunu düzelt."

- **KÖK NEDEN `decodeURIComponent`'tir**: geçersiz bir yüzde dizisinde URIError **FIRLATIR**. Yol
  segmentini çözen çağıranların HİÇBİRİ bunu sarmalamıyordu, hata `src/index.js`'in en dıştaki
  try/catch'ine kadar çıkıp `errorJson('Sunucu hatası oluştu.', 500)` üretiyordu.
- **ÖLÇÜLDÜ, TAHMİN EDİLMEDİ** (düzeltmeden ÖNCE, gerçek `worker.fetch` Node'da koşturularak —
  `scripts/test-2026-09-17-malformed-url-5xx.mjs` 1. bölümü aynı ölçümü kalıcı kelepçeye çevirdi):
  `/proje/%E0%A4%A`, `/kisi/%`, `/firma/a%zz`, `/urun/%FF`, `/gundem/%E0%A4%A`, `/gorusme/%` ve
  `/api/{project,architect,office,product,gundem}/%` -> **HEPSİ 500**. `/marka/%...` önce 301 ile
  `/firma/%...`'e taşınıyor ve **yönlendirmenin HEDEFİNDE** 500 oluyordu — yani en çok indekslenmiş
  eski önek de kapsam içindeydi.
- **GERÇEK TRAFİKTE NEDEN OLUYOR**: (a) **Latin-1/Windows-1254 ile kodlanmış ESKİ Türkçe adresler** —
  `%C7orbac%FD` ("Çorbacı") UTF-8 olarak GEÇERSİZDİR ve bu, Türkçe bir sitede en sık rastlanan hâldir;
  (b) kopyala-yapıştır ile kırpılmış yarım diziler; (c) sondaki çıplak `%` (`/proje/100%`);
  (d) tarayıcı/güvenlik probları. Googlebot 5xx'i GEÇİCİ bir arıza sayar: adresi indekslemez, tarama
  bütçesini düşürür ve tekrar tekrar dener. **Doğru cevap 404'tür.**
- **ÇÖZÜM TEK NOKTADA**: `src/lib/http.js#safeDecode` — çözülemeyen değer **HAM hâliyle** döner. Ham
  değer hiçbir slug/anahtarla eşleşmediğinden çağıranların **MEVCUT** 404/410 akışı kendiliğinden
  devreye girer; tek tek "geçersiz istek" dalları YAZILMADI. `%` taşımayan değerde
  `decodeURIComponent` hiç çağrılmaz (sıcak yol). Aynı karar `gatedMedia.js` ve `upload.js`'te
  (2026-09-05 denetimi, `/media/` yolu için) zaten verilmişti — bu, o kararın site geneline
  taşınmasıdır.
- **KAPSAM 18 çağrı noktası**: `src/index.js` (detay sayfaları — asıl yer, `/gorusme/:uuid`, self
  content/project moderasyon yolları), `project.js`, `architect.js`, `office.js`, `product.js`,
  `gundem.js`, `admin.js`, `saved.js`, `reads.js`, `follows.js`, `shares.js`, `seo.js`,
  `canonicalSync.js` ve **`http.js#parseCookies`** — sonuncusu ayrı bir sınıf: bozuk %-kodlaması
  taşıyan TEK bir çerez değeri, oturum okuması her yolun başında çalıştığı için o ziyaretçinin
  **HER** isteğini 500'e düşürürdü.
- **REGRESYON KELEPÇESİ dosya taramasıdır** (testin 3. bölümü): `src/` içinde sarmalanmamış tek bir
  `decodeURIComponent` kalırsa preflight kırmızı döner. Muaf olan dört dosya kendi try/catch'ini
  taşır ya da URL segmenti çözmez (`http.js` — safeDecode'un kendisi, `gatedMedia.js`,
  `upload.js`, `oauth.js` — base64).
- **`serveDetailPage`'in 503 dalı DEĞİŞMEDİ** ve doğrudur: `buildMeta` bir D1 hatasıyla fırlarsa
  (MetaLookupError, 2026-09-01 madde 4) sayfa 404 DEĞİL 503 + `Retry-After` döner. O da Search
  Console'da "5xx" görünür ama kasıtlıdır — geçici bir kesinti yayındaki bir kaydı indeksten
  DÜŞÜRMEMELİ. Bu turda yalnızca o dalın YANLIŞ tetiklenmesi kapatıldı (bkz. aşağısı).

### schema.sql migration'larla EŞİTLENDİ (aynı turun ikinci bulgusu)

- `schema.sql`, migration'larda eklenmiş **12 kolonu** taşımıyordu: `consultation_requests.phone`
  (0039), `users.company` (0045), `products.display_order` (0089), `collection_items.pos_x/pos_y/
  width/height/z_index` (0094), `collections.canvas_orientation` + `collection_items.text_color/
  font_size/font_weight` (0095), `gundem_items.images/submitted_by/submitter_type/submitter_key/
  submitter_name` (0113).
- **ÜRETİMİ ETKİLEMEZ** (orada migration'lar uygulanır) ama **yerel SQLite fikstürünü gerçeklikten
  ayırır** — ve tam da bu yüzden `/gundem/:slug`'ın 404 yolu yerelde ölçülemiyordu: fikstürde
  `no such column: submitter_type` -> `buildGundemMeta` fırlıyor -> `serveDetailPage` **503**
  döndürüyordu. Yani var olmayan bir gündem adresi, yerelde Search Console'un gördüğü 5xx'in İKİNCİ
  bir görünümünü üretiyordu ve hiçbir test bunu yakalayamazdı.
- **0079 BİLEREK DIŞARIDA** (fold kolonları VIRTUAL generated'dır, tek kaynak
  `migrations/0079_search_fold_columns.sql` — bkz. schema.sql'deki açık not); kelepçe onu muaf tutar.
- **İKİ TEST GÜNCELLENDİ**: `test-2026-09-11-office-jobs.mjs` ve `test-2026-09-12-home-rails.mjs`
  0113'ü schema.sql'in ÜSTÜNE uyguluyordu ("schema.sql canlı D1'in gerisinde" notuyla); artık
  gereksiz ve `duplicate column name` veriyor, satırlar kaldırıldı.
- **Kelepçe** (testin 4. bölümü): schema.sql GERÇEK SQLite'a yüklenir, tüm migration'lardaki
  `ALTER TABLE ... ADD COLUMN` ifadeleri `PRAGMA table_info` ile karşılaştırılır. Yeni bir migration
  schema.sql'e yansıtılmazsa preflight orada durur.

Testler: `scripts/test-2026-09-17-malformed-url-5xx.mjs` (22 test, preflight'a bağlı). Düzeltme
geri alındığında **12 test birden kırılır** (ölçüldü) — yani kelepçe kurala değil gerçek durum
koduna bakıyor. Migration YOK, SSR sürüm bumpı YOK (kabuklara script etiketi eklenmedi/kaldırılmadı).

## Kaydettiklerim görseli lightbox'ta, mobil filtre satırları, canlı "Senin İçin" (2026-09-17, ikinci tur)

Kullanıcı isteği (üç madde): (1) "Koleksiyonum sayfasında Kaydettiklerim kutusunda görsel butonuna
kaydedilen görsellere tıklayınca sadece görsel lightbox olarak açılsın. Proje popupının açılmasına
gerek yok.", (2) "Hesabım, Koleksiyonum ve Aktivitelerim sayfalarında kutuların içinde bulunan
filtreleme butonları mobil görünümde tek satırda sıralansınlar ve sağa doğru kaydırılarak görünür
olsunlar. Kutunun dışına asla çıkmasınlar.", (3) "Ana sayfadaki senin için kullanıcı farklı
aktviteler yaptıkça sürekli yenilensin."

### 1. Görsel satırı yalnızca lightbox açar
- `auth-modal.js#renderColSaved`: `item_type === 'image'` satırı **HREF'SİZ** bir `<a role="button">`
  taşır. Gerekçe yapısal: `lazy-modals.js`'in ve varlık pop-up'larının tıklama yakalayıcıları
  `a[href]` arar — href yoksa proje pop-up'ı açılma yolu hiç oluşmaz (preventDefault yarışına
  kalmaz). Görsel adresi `item_key`'dir (kaydedilen anahtar TAM görsel url'si).
- Açılış `openSavedImageLightbox` üzerinden: `ImageLightbox` yoksa `image-lightbox.js` İLK tıklamada
  tembel yüklenir, yüklenemezse görsel yeni sekmede açılır. Koleksiyonum her sayfadan açılabildiği,
  modül ise her kabukta yüklü olmadığı için şart.
- `hesabim.html`'deki Kaydettiklerim kopyası aynı kararı `data-lightbox-src` ile verir (o sayfa
  modülü zaten yüklüyor, delege dinleyicisi işi görür).

### 2. Mobilde filtre satırları tek satır + yatay kaydırma
- `@media (max-width:720px)`: `.saved-filter` ve `.submissions-toolbar-row` → `flex-wrap:nowrap;
  overflow-x:auto; min-width:0; max-width:100%`, düğmeler `flex:0 0 auto; white-space:nowrap`.
  Kural İKİ yüzeyde: `auth-modal.js` (Hesabım/Koleksiyonum/Aktivitelerim modalleri) ve `hesabim.html`.
- **Negatif margin YOK**: `.saved-filter-scroll`'un masaüstündeki kutu kenarına uzanan deseni
  (`margin-inline:-24px`) mobilde sıfırlanır — satır kutunun İÇ alanında kalır ("kutunun dışına asla
  çıkmasın"). Ölçüldü (Chromium 375px): tüm satırlar tek satır, kutunun iç kenarları arasında,
  `document.scrollWidth === 375`.

### 3. "Senin İçin" canlı tazeleme
- Sinyal TEK noktada yakalanır: `index.html` kendi `window.fetch`'ini şeffaf biçimde sarar ve
  forYou.js'in okuduğu beş sinyal ucuna (`/api/saved|follows|ratings|shares|comments`) giden
  **başarılı, GET olmayan** bir istekten sonra tazeleme planlar. Dört ayrı bileşene (save-widget,
  rating-widget, share-button, project-comments) ayrı olay eklemek yerine bu seçildi — yeni bir
  kaydet/beğen düğmesi de kendiliğinden kapsanır. Sarmalayıcı özgün promise'i aynen döndürür.
- **Debounce 1200 ms** (art arda kayıtlar tek istek), sekme gizliyken ertelenir; sekmeye dönüşte
  (60 sn'den eskiyse ya da bekleyen tazeleme varsa) ve bfcache dönüşünde (`pageshow.persisted`)
  de tazelenir.
- `loadForYou({ refresh: true })`: tazelemede ağ/sunucu hatası ekrandaki kartları SİLMEZ. Bölüm artık
  `section.remove()` ile değil **`hidden`** ile gizlenir — ilk yüklemede boş dönen kutu, kullanıcının
  ilk etkileşiminden sonra tazelemeyle yeniden görünebilsin diye.

Testler: `scripts/test-2026-09-17-saved-image-filters-foryou-refresh.mjs` (13 test, preflight'a
bağlı) — tazeleme bloğu `vm` içinde GERÇEK kaynaktan koşturulur. Migration YOK, SSR sürüm bumpı YOK.

## Projesi olmayan blurlu kişi/firmalar SİLİNDİ (2026-09-17, üçüncü tur)

Kullanıcı isteği: "Şu an blurlu olup yani önizleme modunda olup üzerinde hiçbir proje olmayan tüm
kişi ve firmaları canlı siteden ve admin panelindeki arşiv kısmından sil." + karar: "Bir kullanıcıya
ait profilleri ve Projesi yok ama başka içeriği var olanları silme."

- **Betik** `scripts/delete-projectless-preview-profiles.mjs` (`archive-empty-preview-profiles.mjs`'in
  kardeşi; varsayılan DRY-RUN, `--apply`, `--expect=N`, `--skip=`). Silme ARŞİV DEĞİL, admin
  panelindeki "Sil" ile AYNI canlı yol: `runContentAction({ action:'delete', key })` — canonical satır
  + join kenarları + karaliste + `*_submissions` taslakları (Arşiv sekmesinden de düşer) + etkileşimler.
  **GERİ ALINAMAZ.**
- **"Proje yok" (şüphede korunur)**: pop-up'ta görünen proje (kişide fotoğrafladıkları dahil) YOK +
  `project_designers`/`project_photographers`/`project_brands`'te ARŞİVDEKİ projeler dahil kenar YOK +
  firma arşiv cascade'i proje toplamıyor + ad hiçbir fotoğraf künyesinde yok. Arşivdeki projeye bağlı
  profil silinmez: o proje ileride yayına alınırsa künyesi eksik çıkardı.
- **Korunanlar**: sahipli profiller (`fetchOwnership`) ve projesi olmayıp BAŞKA içeriği olanlar (firmada
  kurucu/ekip/ürün, kişide firma/ürün/portfolyo). Ölçüm: projesi olmayan 305 blurlu kişinin 281'i,
  194 firmanın 193'ü karşılıklı firma/kurucu bağı taşıyordu — bu kural onları kapsam dışı bırakır.
- **Sonuç**: 20 kişi betikle silindi. Kuru çalıştırmada tek aday olan firma (Kolektif Mimarlar),
  silme koşusundan önce başka bir yoldan zaten silinmişti (blurlu firma 515 -> 514; `--expect=1`
  kapısı hiçbir şey yazmadan durdu, kayıt D1'de yok). 2026-09-15 on üçüncü turda arşivden
  elle muaf tutulan dört ad (Arif Özden, Nur Urfalıoğlu, Alp Nuhoğlu, Serkan Ennaç) aynı gerekçeyle
  `--skip` ile KORUNDU — silinmeleri istenirse betik `--skip` olmadan yeniden koşturulur.
- **R2**: Node'da bağlama olmadığından betik görselleri silmez (`UPLOADS` no-op); yetim görselleri
  r2Reconcile taraması temizler. KV havuzu 30 dk içinde kendiliğinden tazelenir.

## İçeriği olmayan blurlu kişi/firmalar SİLİNDİ — kişi↔firma bağı içerik SAYILMAZ (2026-09-17, dördüncü tur)

Kullanıcı isteği: "Üzerinde herhangi bir proje, ürün, fotoğraf ya da kullanıcı ataması olmayan blurlu
kişi ve firmaları canlı siteden ve arşivden sil. Örneğin ekteki kişi ve firmanın silinmesi gerekiyor."
(örnek: Zeynep Mutlu + Mimarize Mimarlık — yalnızca birbirinin kurucusu/firması olan iki boş profil)
+ "Admin panelindeki 'Arşiv' bölümünde firmaları proje sayısı çok olandan az olana doğru sırala."

- **Üçüncü turun kuralı GENİŞLETİLDİ**: orada kişi↔firma bağı "başka içerik" sayılıp 305 kişinin 281'i,
  194 firmanın 193'ü korunmuştu — kullanıcının örneği tam o gruptaydı. `scripts/delete-projectless-
  preview-profiles.mjs` artık İKİ TİPİ TEK koşuda tarar; İÇERİK = proje (arşivdekiler dahil kenar),
  ürün (kenar dahil), fotoğraf (fotoğrafladığı proje, kenar, künyede ad), kişide portfolyo, KULLANICI
  ATAMASI/sahiplik. Kurucu/ekip/birincil firma bağı içerik DEĞİLDİR.
- **BAĞ KAPANIŞI**: içeriği olmayan bir profil, içeriği OLAN (ya da canlı, ya da `--skip` ile dışlanan)
  bir profile bağlıysa korunur, sabit noktaya kadar yayılır. Yalnızca TAMAMEN boş kümeler silinir;
  projeli bir firmanın Kurucular/Ekip listesinden kişi koparılmaz. (Kuru çalıştırmada 7 kişi bu yüzden
  korundu — örn. Zambak Mimarlık, Archist Mimarlık, PARCH'a bağlı olanlar.)
- **Sayım kapıları** `--expect-offices` / `--expect-architects`; silme sırası önce firmalar.
- **Token yenileme**: tarama ~1 saati aşabiliyor; 7403 gelince betik `wrangler whoami` ile OAuth
  token'ı yenileyip isteği tekrarlar.
- Dört ad (Arif Özden, Nur Urfalıoğlu, Alp Nuhoğlu, Serkan Ennaç) kullanıcı kararıyla yine KORUNDU.
- **Sonuç (iki koşuda, aralarında ağ hatası)**: 193 firma + 20 kişi (üçüncü tur kalıntısı) + 324 kayıt
  (50 firma + 274 kişi, bu tur) = toplam **243 firma + 294 kişi** silindi. Koşunun ortasında Cloudflare
  API'ye geçici bir ağ erişim hatası (`EHOSTUNREACH`) `rawQuery`'nin sarmalanmamış `fetch()` çağrısından
  fırlayıp süreci çökertti (142 firma silinmiş hâldeyken) — betik artık ağ seviyesi hataları da (HTTP
  yanıtı hiç gelmeyen durumlar) 6 kez yeniden dener, yalnızca HTTP yanıtındaki 7403/10000 kodlarını
  değil. Kalan kayıtlar aynı betikle, D1'den zaten silinenleri otomatik atlayarak tamamlandı.
- **Arşiv sıralaması**: `admin.js#handleSubmissionsAdmin` `status=archived&type=offices` yanıtına
  `projectCount` ekler (canonical `project_designers.office_id`, TEK tarama, arşivdeki projeler dahil —
  firmanın projeleri genelde onunla birlikte arşivdedir) ve azalan sıralar; `admin.html` aynı anahtarla
  istemcide de sıralar ve kartta "Proje: N" gösterir. Test:
  `scripts/test-2026-09-17-saved-image-filters-foryou-refresh.mjs` bölüm 4.

## Proje görünüm adresleri, tek sayfa En İyi 100, kişi arşiv sırası, Fotoğrafçı/Kaynak yeri (2026-09-17, beşinci tur)

Kullanıcı isteği (üç madde): (1) "Proje sayfasındaki en iyi 100 ve harita seçeneklerinin de ayrı bir
URL'si olsun. Örneğin /proje-en-iyi-100 ve /proje-harita ... en iyi 100 sayfasında 100 eser de tek
sayfada listelensin. Ama proje sayfasındaki sistem ve tasarım olduğu gibi kalsın.", (2) "Admin
panelindeki arşiv bölümünde kişiler de en çok projesi olandan en az olana doğru sıralansın.",
(3) "Proje ekle sayfasında fotoğrafçı ve kaynak kutucuklarını Görseller kutusunun en üst satırına
yerleştir."

- **Aynı kabuk, yeni adres**: `src/index.js#PROJECT_VIEW_PAGES` iki yolu `/proje` kabuğuna eşler
  (`/proje/sayfa-N` ile aynı yöntem, kabuk önbelleği PAYLAŞILIR); yanıt üstünde yalnızca `<title>`,
  `og:title`, canonical ve `og:url` yola çevrilir. İkisi de sitemap'te. Ayrı `/en-iyi-100` sayfası
  DEĞİŞMEDİ.
- **Görünüm adresten okunur, sekmeyle yazılır** (`js/pages/proje.js`): `viewFromPath` açılışta ve
  geri/ileri tuşunda (`bootView`) görünümü uygular; `setView` sekme tıklamasında `syncBrowserUrl(true)`
  çağırır. `listBasePath` artık görünüme göre döner — Harita'da filtre değiştirmek adresi
  `/proje-harita?...` tutar, Liste'ye dönünce `/proje?...` olur. `/sayfa-N` yalnızca Liste'de.
- **En İyi 100 sayfalanmaz**: top100 dalı süzülmüş listenin tamamını çizer (`renderPagination(1)`).
  Liste görünümünün sayfalaması DEĞİŞMEDİ.
- **Arşiv > Kişi**: firma bloğu genelleştirildi — sayı `project_designers.architect_id` kenarından
  (arşivdeki projeler dahil), kartta "Proje: N".
- **proje-ekle**: Fotoğrafçı + Kaynak `form-row`'u Görseller bölümünde başlığın hemen altına taşındı;
  id/name ve tüm prefill/gönderim yolları aynı.
- Testler: `scripts/test-2026-09-17-project-view-urls.mjs` (7 test, preflight'a bağlı — gerçek
  `worker.fetch` ile iki yolun `/proje` kabuğunu 200 döndürdüğünü ölçer). Migration YOK, SSR sürüm
  bumpı YOK.

## Tarih satırı hizası, yöneticinin sil/arşivlesi, marka arşiv sırası, KİŞİ↔FİRMA takası (2026-09-17, altıncı tur)

Kullanıcı isteği (beş madde): (1) "Proje ekle sayfasında bir tarih girince ekteki görseldeki gibi
kutucuklarda kayma meydana geliyor, bu sorunu kökten düzelt.", (2) "Bir kullanıcı yönetici olarak
atandığı firmada bir proje ya da ürünü sil derse direkt silinsin, arşivle derse hesabım sayfasındaki
arşivim kısmına düşsün.", (3) /firma sayfa açıklaması değişsin, (4) "Admin panelindeki arşiv
kısmındaki markaları da en çok ürünü olandan en az ürünü olana doğru sırala.", (5) "Ana menüdeki ve
footerdaki KİŞİ ile FİRMA'nın yerlerini değiştir."

### 1. Tarih satırında kayma — KÖK NEDEN: satırın çocukları SABİT YÜKSEKLİKLİ DEĞİL
- `.date-range-row` `align-items:center` taşıyordu. Kutu mount'u (`office-picker.js`) seçilen değeri
  düğmenin ALTINA bir `.op-chip` olarak DA basar (`.op-chips:empty{display:none}`, `margin-top:8px`)
  ve o an 39px'ten 74px'e uzar. `center` satır yüksekliğini en uzun çocuğa göre belirleyip DİĞER
  çocukları dikeyde ortalıyordu.
- **Ölçüldü** (Chromium, proje-ekle.html'in GERÇEK `<style>` bloğu + gerçek `office-picker.js`):
  Bitiş kutusuna 2025 seçilince Başlangıç düğmesinin tepesi 45 -> **62px** (17px kayma), "+ Ekle"
  63px. `align-items:flex-start` ile üçü de 45px'te (ikinci ölçüm: 21/21/21) sabitlenir. Seçim
  olmayan hâlde görünüm BİREBİR aynı (üç çocuk zaten eşit yüksekte).
- **Çip KALDIRILMADI**: tek seçimli kutuda düğme etiketi değeri zaten gösterir ama çipin ✕'i
  seçimi TEMİZLEMENİN TEK yoludur (radio yeniden tıklanınca `change` yaymaz). Kayma çipin
  varlığından değil satırın hizalamasından geliyordu.
- `.brand-add-row` ZATEN `flex-start`, `#u-year` bir `.form-row` ızgarasında — kural yalnızca bu
  satırda gerekiyordu (ölçüldü).

### 2. Firma yöneticisinin "Sil"i tam silmiyor, "Arşivle"si çelişik durum bırakıyordu
- **Yöneticinin yolu ZORUNLU olarak ANAHTAR tabanlıdır**: kendi taslağı yoktur, id tabanlı uç ona
  404 döner (`submissions.js#canAccessSubmissionRow` — taslak ne onun, ne `claimed_slug`/
  `claimed_profile_key` taşıyor). Yani `DELETE /api/project/:slug` ve
  `POST /api/product/:slug/moderate`.
- **KÖK NEDEN** (gerçek SQLite + gerçek uçlarla ÖLÇÜLDÜ): o yol taslakları YALNIZCA
  `claimed_slug`/claim kolonundan topluyordu. İçeriği SİTEYE EKLEYEN üyenin taslağı (claimed_slug
  NULL) kapsam dışıydı:
  * **SİL**: canonical satır hard-delete + karaliste, ama üyenin taslağı `approved` kalıyor — o
    üyenin Gönderilerim kutusunda "Yayında" görünmeye devam ediyor ve bir sonraki kaydetmesi
    (`updateOwnSubmission` -> `syncApprovedSubmissionToCanonical`) kaydı GERİ getiriyordu.
    products/materials'ta daha kötüydü: `key` dalındaki `if (config.claimedColumn)` koşulu o tipte
    HİÇ girmiyor (claimedColumn yok), yani ürün taslakları hiç silinmiyordu.
  * **ARŞİVLE**: kayıt Arşivim'e düşüyordu ama HER ZAMAN İKİNCİ bir taslak açılıyor, üyeninki
    `approved` kalıyordu — aynı içerik bir yanda "Yayında" bir yanda "Arşivde", ve üyenin sonraki
    kaydetmesi arşivi SESSİZCE yeniden yayına alıyordu. (Arşivin tanımı bu depoda status +
    hidden_at İKİSİDİR — bkz. `src/lib/archiveSync.js`.)
- **BAĞ İKİ YOLDAN, İKİSİ DE KESİN** (`legacyContent.js#canonicalDraftRows`): (a) `claimed_slug` /
  claim kolonu, (b) canonical satırın **`legacy_key = 'submission:<id>'`** işareti — kayıt tam
  olarak o taslağın onayından doğmuştur (`canonicalSync.js#submissionMarker`) ve bu, üyenin kendi
  gönderisini bulmanın TEK kesin yoludur. **Adla/slug'la gevşek eşleşme YOK**: aynı başlıktan
  üretilmiş, henüz onaylanmamış BAŞKA bir gönderiyi silmesin.
- **Taslaklar canonical satır SİLİNMEDEN ÖNCE toplanır** (yoksa legacy_key okunamaz) — test bunu
  çağrı sırasıyla kelepçeliyor. R2 sırası korunur: anahtarlar önce, satırlar sonra, medya en son
  (`deleteR2MediaKeys` ÇAĞIRAN SÖZLEŞMESİ).
- **ARŞİVLEME artık kaydın DOĞDUĞU taslağı YENİDEN KULLANIR** (yeni satır açmak yerine):
  `owner_user_id` **KORUNUR** (`COALESCE`) — taslak, içeriği siteye ekleyen üyenin gönderi satırı
  olabilir, onu arşivleyenin üzerine yazmak o üyenin gönderisini elinden almak olurdu. Yetkiliye
  Arşivim'de GÖRÜNMESİ sahiplikten değil FİRMA BAĞINDAN gelir (bkz. `src/routes/archive.js`).
  `claimed_slug` yazılır — "Düzenle ve Yayına Al"ın yetki kapısı o kolonu okur ve ürünlerde
  olmadığında "Yayınla" İKİNCİ bir ürün satırı yaratırdı (migrations/0088).
- **`DRAFT_LINK_COLUMN` ayrı bir eşlemedir**: architects/offices'te `claimed_profile_key`
  (= config.claimedColumn), products/materials'ta **`claimed_slug`** — `config.claimedColumn` tek
  başına ürünleri hep dışarıda bırakıyordu. Bağ ANAHTARI ürünlerde canonical **slug**'dır: o tipte
  `key`, `/api/product/:slug/moderate` yolunda slug, admin `?adminedit=` yolunda "marka|||başlık"
  olabilir, taslakta duran değer ise her zaman slug'dır.
- **ADMIN yolları da kapsandı** (id dalı): admin'in Arşiv sekmesinden sildiği/arşivlediği kayıt da
  aynı yetim/çelişik taslakları bırakıyordu.
- **ÖLÇÜM** (`scripts/test-2026-09-17-manager-moderation-and-nav-order.mjs`, gerçek SQLite + gerçek
  uçlar): sil -> canonical 0 + taslak 0 + üyenin Gönderilerim'i boş; arşivle -> TEK taslak
  (`ps1`/`us1`, `archived`, owner `member`, claimed_slug dolu) + `hidden_at` dolu + hem yöneticinin
  hem üyenin Arşivim'inde `canEdit=1`. **Fikstür canonical satırı ELLE YAZMAZ** — üyenin gönderisini
  `syncApprovedSubmissionToCanonical`'den geçirir; elle yazılmış bir satırda legacy_key işareti
  olmadığından düzeltme "çalışmıyor" görünürdü (ilk ölçümde tam bu oldu).

### 3. /firma açıklaması
`firma.html#.page-head p` -> "Türkiye'de yapı sektöründe faaliyet gösteren tasarım, uygulama ve
satış yapan firmaları keşfedin." Metnin SSR/`src` kopyası YOK (ölçüldü) — tek yer bu satır.

### 4. Admin > Arşiv > Marka: ÜRÜN sayısına göre
- Ölçüt ALT SEKMEYE göre değişir: firma/kişi **proje**, marka **ürün**. Marka ayrı bir gönderi tipi
  DEĞİL (aynı `offices` listesi, `isBrandOffice` ile süzülür), bu yüzden yanıt İKİ sayıyı da taşır
  (`projectCount`, `productCount`) ve marka sıralaması istemcide yapılır (`admin.html#loadArchive`);
  sunucunun `projectCount` sıralaması olduğu gibi kalır.
- Marka bağı ürünlerde İKİ YOLDAN kurulur ve ikisi de sayılır (`canUserEditProductBySlug` /
  `archive.js#brandMatchSql`'deki AYNI ayrım): yapısal `products.brand_office_id` ve serbest metin
  `products.brand_name_raw`. İki küme AYRIK (b, yalnızca a NULL iken) olduğundan sayılar TOPLANIR;
  aynı ofisin üç anahtarı (ad/slug/legacy_key) arasında ise `max` kullanılır (toplamak ürünleri üçe
  katlardı). Ürün + yapı malzemesi birlikte, arşivdekiler DAHİL (arşivdeki markanın ürünleri de
  çoğunlukla onunla birlikte arşivdedir).
- **`isBrandOffice`'ı üretici yapan şey 'Üretim ve Satış' hizmet alanı DEĞİL**, `BRAND_CATS`'ten bir
  ÜRÜN KATEGORİSİDİR (ör. 'Mobilya') — testin fikstürü bu yüzden ikisini birlikte yazar. `cats`
  ' · ' AYRIMLI METİN olarak saklanır (JSON dizi değil; `parseSubmissionRow` o alanı ayrıştırmaz).

### 5. Ana menü + footer: PROJE · FİRMA · KİŞİ · ÜRÜN · GÜNDEM
- `site-chrome.js#NAV_ITEMS` sırası (üst menü VE mobil çekmece tek kaynaktan) ile footer'ın "Ana
  Menü" sütunu AYRI listelerdir; ikisinde de takas yapıldı ve test ikisini AYNI sırayla kelepçeliyor
  — ayrışırsa aynı site iki farklı sıra gösterir. Footer'ın etiketi "Mimar" olarak KALDI (hep öyleydi,
  istek yalnızca sırayı kapsıyor). Gerçek Chromium'da ölçüldü: nav `[Proje, Firma, Kişi, Ürün,
  Gündem]`, footer `[Proje, Firma, Mimar, Ürün, Gündem]`.

Testler: `scripts/test-2026-09-17-manager-moderation-and-nav-order.mjs` (12 test, preflight'a bağlı).
Migration YOK, SSR sürüm bumpı YOK (kabuklara script etiketi eklenmedi/kaldırılmadı).

## Proje popup'ındaki yorum "Gönder" butonu — sayfa-özel token bağımlılığı (2026-09-17, yedinci tur)

Kullanıcı bildirimi (ekran görüntüsü): "Proje popuplarındaki yorumlar kısmındaki gönder butonunda
sorun var" — buton neredeyse görünmez, çerçevesiz/dolgusuz bir dikdörtgen olarak görünüyordu.

- **KÖK NEDEN, `css/project-detail.css`'in KENDİ dosya başı notundaki 2026-09-12 sınıf hatasının
  BİREBİR TEKRARI**: `.comment-submit-btn` `--color-primary`/`--color-primary-hover`/`--space-2`/
  `--space-4`/`--radius-full`/`--font-body-2` adlı bir "Design Token" katmanı kullanıyordu, ama bu
  katman YALNIZCA `proje.html` ve `en-iyi-100.html`'in KENDİ satır içi `<style>`'ında tanımlıydı —
  2026-09-12'de tüm popup kuralları TAM DA bu yüzden (host sayfanın CSS'ini varsayma) bu dosyaya
  taşınmıştı, ama bu iki satır o taşımadan SONRA eklenmiş ve aynı hataya bir daha düşmüştü. Popup
  artık `lazy-modals.js` ile HER sayfada (ana sayfa, `/kisi`, `/firma`, `/urun`, `/gundem`, `/arama`,
  `/danismanlik`...) açılabiliyor ve o sayfaların HİÇBİRİ bu token katmanını tanımlamıyor (ölçüldü).
  Token tanımsız olduğunda `var()` çözülemez ve KALITIMSIZ özellikler (background/padding/
  border-radius) İLK DEĞERLERİNE düşer: şeffaf zemin, sıfır dolgu, sıfır yuvarlama — bildirimdeki
  "boş kutu" tam olarak budur. **Gerçek tarayıcıda (Chromium) yeniden üretildi**: aynı belge
  `index.html`'in `:root`'u + eski (bozuk) kuralla render edilince buton `background:transparent;
  padding:0; border-radius:0` ölçüldü; düzeltilmiş kuralla `background:#1B2A3D (--ink); padding:8px
  16px; border-radius:999px` ölçüldü.
- **ÇÖZÜM**: `.comment-submit-btn` artık YALNIZCA HER sayfanın `:root`'unda evrensel olarak tanımlı
  temel palet token'larını (`--ink`/`--walnut`/`--paper-card`) ve proje.html'deki token'ların ta
  kendisinin sabit sayısal karşılıklarını (8px/16px/999px/12px) kullanır — görünüm HİÇBİR sayfada
  değişmez (proje.html/en-iyi-100.html'de `--color-primary` zaten `--ink`'e, `--space-2` zaten 8px'e
  eşitti), yalnızca token'ı hiç tanımlamayan sayfalarda düzelir.
- **`en-iyi-100.html`'in kendi satır içi `.comment-submit-btn` KOPYASI KASITLI OLARAK DOKUNULMADI**:
  o sayfa `css/project-detail.css`'i `<link>` ile satır içi `<style>`'dan SONRA yükler (bkz. o
  dosyadaki açık not: "eşit özgüllükte olan kurallarda paylaşılan sürüm kazanır") — yani bu dosyadaki
  düzeltme orada da otomatik olarak kazanır, ikinci bir düzenleme YAPILMASA da davranış doğrudur.
- Testler: `scripts/test-2026-09-17-comment-submit-button.mjs` (4 test, preflight'a bağlı) — kaynak
  taraması (yasaklı token'lar + evrensel token'lar) VE düzeltmeden ÖNCEKİ/SONRAKİ kuralın CSS
  kalıtım kurallarına göre hesaplanan render sonucunu (background/padding/border-radius) ayrı ayrı
  kelepçeler. Migration YOK, SSR sürüm bumpı YOK (CSS dosyası zaten revalidate edilir, sürümlenmiş
  Cache API anahtarıyla servis edilmiyor).

## Yorum kimliği + FOTOĞRAF sayfası (/fotograf) — 2026-09-17, sekizinci tur

Kullanıcı isteği (iki madde): (1) "Her kullanıcı sadece kullanıcı ismiyle yorum yapabilsin. Kişi
popuplarını yorum kısmına karıştırma. Eğer projeye yorum yapıldıysa örneğin Yorumlar (1) şeklinde
gözüksün, yorum yapılmadıysa 0'ı gösterme. Ayrıca admine ve firma yöneticisine yorumu silme yetkisi
ver.", (2) "... siteye yüklenen projelerin görsellerinin yükleme sırasına göre en son yüklenenden
ilk yüklenene doğru sıralanacağı bir sayfa ... istediği mekanı seçerek (örneğin yatak odası) ...
Mekan filtremesini yapay zeka yapsın. Görsele tıklayınca da lightbox şeklinde açılacak ve projenin
künyesi ... sergilenecek. Bu sayfanın ismi fotoğraf olsun, sayfayı yayınla ama şimdilik bir menüye
koyma."

### 1. "commenterProfile" KALDIRILDI — yorum HER ZAMAN hesap kimliğiyle
- `listComments`, yorumu yapan hesabın bağlı olduğu bir kişi/firma profili varsa
  (`architects/offices.claimed_by_user_id`) yorumu O PROFİLİN adı+fotoğrafıyla gösteriyor ve adı
  `/kisi`|`/firma`'ya LİNK yapıyordu. Kendi profiline yorum yazan bir mimar, kendi adına link veren
  bir yorum görüyordu — istekteki "kişi popuplarını yorum kısmına karıştırma" tam olarak buydu.
- **İKİ JOIN + shaping SİLİNDİ** (`LEFT JOIN architects` / `LEFT JOIN offices` ve `commenterProfile`
  alanı). Yanıt şekli artık SABİT yedi anahtar: `id, body, created_at, user_name, user_id,
  user_photo, user_badge` — test bunu anahtar KÜMESİYLE kelepçeliyor (yeni bir profil köprüsü
  sessizce geri gelmesin). İstemcide (`project-comments.js`) avatar artık HER ZAMAN `<div>`,
  hiçbir bağlantı yok; `.comment-author-link` ve `a.comment-avatar` CSS kuralları ÖLÜ KOD olarak
  iki kopyadan da (`css/project-detail.css` + `en-iyi-100.html`) düştü.
- **`canonicalSync.js#resolveClaimedByUserId` DOKUNULMADI**: o, admin'in eklediği kayıtların
  sahipliğini NULL bırakan ayrı bir doğruluk düzeltmesidir (2026-09-01) ve bu turdan bağımsız
  olarak geçerli kalır — yalnızca onun dosya başı notundaki "commenterProfile JOIN'ini etkiliyordu"
  cümlesi artık tarihsel bir kayıttır.

### 2. Sayaç "Yorumlar (N)", 0'da hiç görünmez
- `pm-comments-count` span'ı **inline `style="display:none;"` ve sabit `0` ile doğuyordu ve hiçbir
  kod o display'i KALDIRMIYORDU** — yani sayaç bugüne kadar HİÇ görünmemişti (0 da dahil). Artık
  span BOŞ doğar ve `loadComments` `items.length ? \` (${items.length})\` : ''` yazar —
  `auth-modal.js#loadArchive`'ın "am-archive-count" deseniyle BİREBİR aynı.

### 3. Silme yetkisi: admin + firma yöneticisi
- **Sunucu** (`comments.js#canDeleteComment`, `project` dalı): ESKİ yol DARALTILMADI, YENİ bir yol
  EKLENDİ — `canUserEditProjectBySlug` (proje-ekle `?claim=` akışının AYNI kuralı: künyedeki
  mimar/firma profilini onaylı `profile_claims` ile sahiplenmek, firmada `OFFICE_EDIT_POSITIONS`
  görev kısıtıyla). Rozet ŞARTI YOK: admin onayından geçmiş bir sahiplik zaten yeterli güven
  sinyalidir. Eski yol (gönderi sahibi + aktif rozet) aynen duruyor.
- **İstemci**: `canModerate` artık (a) `currentUser.role === 'admin'` ile KISA DEVRE yapıyor —
  server admin'i zaten koşulsuz geçiriyordu ama istemci bunu HİÇ sormadığından **Sil düğmesi
  admine popup'ta hiç görünmüyordu** (yalnızca admin panelinden silinebiliyordu); (b) proje
  hedefinde `/api/project/:slug/can-edit` sonucunu eski `isOwner && hasActiveBadge` ile OR'luyor.
  Üç fetch AYNI `Promise.all`'da.

### 4. /fotograf — tüm proje görselleri, AI mekan filtresi, künyeli lightbox
- **Sıralama "YÜKLEME SIRASI"dır, editoryal sıra DEĞİL**: `projects.created_at DESC, id DESC` —
  en son eklenen projenin TÜM görselleri önce, sonra bir önceki proje. `/proje` listesinin
  `COALESCE(relisted_at, publish_date, created_at)` zinciri BİLEREK kullanılmadı (o "1. sırada
  görünme" sorusunun cevabı; bu sayfa "ne zaman yüklendi" soruyor). Bir projenin KENDİ görselleri
  arasındaki sıra `images[]` dizisinin sırasıdır (proje-ekle'deki sürükle-bırak sırası).
  `id DESC` tie-break ŞART: `created_at` SQLite'ta SANİYE çözünürlüklüdür ve toplu içe aktarılmış
  legacy satırlar aynı damgayı paylaşabilir.
- **Mekan etiketi AI ÜRETİMİ, kolon `projects.image_spaces`** (`migrations/0124`, görsel URL'sine
  anahtarlı JSON — İNDEKS DEĞİL URL, 0076/0122'nin AYNI gerekçesi). **canonicalSync'in yazdığı
  kolonlar arasında DEĞİL ve `project_submissions`'ta karşılığı YOK** (image_credits'in aksine):
  kullanıcı girişi olmadığından bir taslak kavramı yok, ve syncProject bu kolona hiç değinmediği
  için normal proje kaydetme akışı etiketleri SİLEMEZ. Test bunu `canonicalSync.js`'te
  `image_spaces` geçmediğini arayarak kelepçeliyor.
- **Sınıflandırma** `src/lib/photoSpaceClassify.js`: model kademesi (`VISION_CANDIDATES`),
  `toBase64` ve `parseJsonLoose` `visionAnalyze.js`'ten PAYLAŞILIR (kopyalanmadı; o üçü bu turda
  export edildi). Prompt/şema AYRI ve küçüktür — visionAnalyze.js TERS GÖRSEL ARAMA için
  `identity/visibleText/brand/products/description` üretir, bu modül ise "bu karede hangi mekan
  var" sorusunun cevabını verir. Çıktı `photo-space-taxonomy.js#PHOTO_SPACE_OPTIONS` (20 mekan,
  TR alfabetik) whitelist'inden geçer — model uydurma bir etiket üretirse SÜZÜLÜR, net bir mekan
  göremezse boş dizi döner ve o görsel filtrede hiç görünmez.
- **Etiketleme ÇEVRİMDIŞIDIR**: `scripts/photo-space-classify-backfill.mjs` +
  `.github/workflows/photo-space-classify.yml` (`workflow_dispatch`, **varsayılan dry-run**,
  `apply=evet` ile yazar). `env.AI` binding'i yalnızca deploy edilmiş Worker'da var olduğundan
  betik Workers AI'ın **REST ucunu** `env.AI.run(model, opts)` ile aynı şekli döndüren bir
  adaptörle kullanır (`gundem-retitle-backfill.mjs`'teki BİREBİR aynı desen/token mekaniği).
  Varsayılan olarak YALNIZCA etiketsiz görseller işlenir — betik tekrar tekrar koşturulabilir,
  yeni eklenen projeler için yalnızca eksikleri tamamlar (`--force` bunu kapatır).
- **Veri ucu** `GET /api/photos` (`src/routes/photos.js`): havuz `src/lib/photoPool.js`'ten,
  `getCachedPool(env, 'photos')` ile KV'de (30 dk TTL) — `POOL_CACHE_KINDS`'a `'photos'` eklendi,
  yani her içerik yazımındaki `invalidatePublicCache()` onu da tazeler. Görünürlük kuralı sitedeki
  her liste yüzeyiyle AYNI: `deleted_at IS NULL AND (hidden_at IS NULL OR preview_at IS NOT NULL)`.
  Geçersiz bir `space` değeri filtreyi SESSİZCE yok sayar (boş sayfa göstermek yerine tüm havuz).
- **Lightbox künyesi** (ekteki 2. görselin karşılığı): proje başlığı (gerçek `<a href="/proje/:slug">`
  — `lazy-modals.js` onu yakalayıp TAM proje popup'ını aynı belgede açar), konum, mekan çipleri,
  "Projeyi paylaşan" + avatar + ad, ve Kaydet. **"Projeyi paylaşan" `fetchOwnerByline`'dan gelir** —
  2026-09-09'da ANA proje popup'ından kaldırılmış olan alan, bu YENİ sayfa için yeniden kullanılıyor
  (farklı bağlam, aynı fonksiyon); `claimed_by_user_id` NULL olan legacy/admin kayıtlarında
  "MİMARLAB"a düşer. Kaydet, var olan `saved_items` `'image'` tipini ve `save-widget.js#
  wireSaveButton`'ı kullanır (Koleksiyonum > Kaydettiklerim > **Görsel** filtresi kendiliğinden
  çalışır); yeni bir kaydetme yolu AÇILMADI.
- **Izgara kartı `href` TAŞIMAYAN `<a role="button">`dır** (`auth-modal.js#renderColSaved`'deki AYNI
  desen): `lazy-modals.js`'in yakalayıcıları `a[href]` arıyor — href olsaydı karta tıklamak MY
  lightbox yerine proje popup'ını açardı.
- **İlk çizim `DOMContentLoaded`'ı BEKLER**: sayfanın satır içi betiği ayrıştırma sırasında, TÜM
  `defer`'lı betiklerden ÖNCE çalışır; beklenmezse `wireSaveButton`/`PHOTO_SPACE_OPTIONS` henüz
  tanımsız olur ve Kaydet düğmeleri kalıcı olarak gizlenirdi.
- **HİÇBİR MENÜDE YOK** (kullanıcı isteği): `site-chrome.js`'e DOKUNULMADI, sitedeki hiçbir sayfa
  `/fotograf`'a `<a href>` ile bağlanmıyor. `/danismanlik` precedent'i birebir izlenir: sayfa
  `noindex` DEĞİL, o yüzden "indexlenebilir ama sitemap'te yok" çelişkisi oluşmasın diye
  `SITEMAP_STATIC_PAGES`'e eklendi (tek keşif yolu budur); `/fotograf.html` -> `/fotograf` 301.
  `smoke-test.sh` 13c canlıda 200 + kabuk bütünlüğü + `/api/photos` dolu + ana sayfada bağlantı YOK
  kontrollerini yapıyor.

Testler: `scripts/test-2026-09-17-comments-identity-and-photo-page.mjs` (22 test, preflight'a bağlı)
— yorum kimliği/silme yetkisi ve fotoğraf havuzu/filtre/künye GERÇEK SQLite + gerçek uçlarla,
AI whitelist'i sahte bir `env.AI` ile ölçülür. **migrations/0124 KOD DEPLOY'undan ÖNCE uygulanmalı**
(`.github/workflows/migrate.yml`): kolon yokken `photoPool.js`'in SELECT'i hata verir.

## /fotograf ikinci tur — footer, sabit mekan listesi, firma/mimar etiketi, beyaz lightbox, AI arama, ana menü (2026-09-17)

Kullanıcı isteği (13 madde): footer bozuk; hero metni; mekanlar VERİLEN sırayla + arama kutusunda
mavi çerçeve yok; kart altında mimarlık firması (yoksa mimar); "projeyi paylaşan" HİÇBİR yerde yok;
görselin altında fotoğrafçı; Kaydet·Paylaş X'in solunda, başlık o satırdan sonra; sağ panel beyaz;
görselin dışına tıklayınca kapansın; blurlu görseller gösterilmesin; filtreyi AI ile geliştir;
sayfayı ana menü + footer'a FOTOĞRAF olarak PROJE'den sonra ekle.

- **Footer'ın KÖK NEDENİ**: `site-chrome.js` yalnızca footer MARKUP'ını üretir; `.site-footer/
  .footer-top/.footer-col...` kuralları HER sayfanın kendi `<style>`'ında kopyalıdır (nav CSS'iyle
  aynı desen) ve ilk turda bu blok fotograf.html'e KOPYALANMAMIŞTI — footer sütunları düz akışta
  alt alta diziliyordu. Blok eklendi (720px'te 2 sütun dahil). Ölçüldü: `.footer-top` grid, 4 sütun.
- **Taksonomi 15 mekan, KULLANICININ SIRASI** (`photo-space-taxonomy.js#PHOTO_SPACE_TAXONOMY` —
  artık `{label, description}`; description yalnızca AI promptu içindir). Eski 20'lik liste ile
  yazılan `image_spaces` değerleri artık eşleşmez → backfill `--force` ile YENİDEN koşturuldu
  (workflow `force=evet`); eski etiketleri taşıyan bir tur yarıda iptal edildi.
- **AI (madde 11)**: (a) sınıflandırma promptu her etiketin tanımını taşır, etiket başına GÜVEN
  ister (`SPACE_CONFIDENCE_MIN=0.45` altı elenir, en fazla 3 etiket) ve fotoğraf/çizim ayrımını
  açıkça yapar (dış cephe FOTOĞRAFI → boş dizi; "Cephe Çizimi" yalnızca çizim). Eski düz-string
  çıktı biçimi hâlâ kabul (whitelist yine uygulanır). (b) **Serbest metin → etiket**: `GET
  /api/photos/space-for-query?q=` (`aiProvider.js#callOnce`, JSON Mode, `AI_MODEL`); istemci önce
  listeyi kendi süzer, yalnızca eşleşme yoksa ve **Enter'a basılınca** bu uca gider ("salon" →
  Oturma Odası, "wc" → Tuvalet & Banyo). IP bazlı `checkRateLimit('photo-space-query', 20/10dk)`
  ŞART — herkese açık bir LLM ucu.
- **Havuz** (`photoPool.js`): `hidden_at IS NULL` (önizleme/blur DAHİL DEĞİL — projectPool'un
  `OR preview_at IS NOT NULL` kuralından bilerek ayrılır; blur kalkınca invalidatePublicCache
  havuzu tazeler). Görsel başına `credit` (project_designers → ilk firma, yoksa ilk mimar; bağ
  yoksa `office_names_raw`/`designer_names_raw`), `creditType`, `photographer` (`image_credits[url]`
  → `photo_credit_text`, gallery.js#paintCredit ile AYNI düşüş). `ownerName/ownerPhoto` ve
  `fetchOwnerByline` çağrısı KALDIRILDI.
- **Lightbox**: panel sabit beyaz (temaya bağlanmaz — overlay). Üst satır `#ph-lightbox-bar`:
  Kaydet (32px pil, `.share-btn` ile aynı ölçü) · `ShareWidget.html('ph-share-btn')` · X; başlık
  satırdan SONRA. Paylaş `ShareWidget.wire` ile BİR kez bağlanır, `getData` o anki görseli okur
  (URL = /proje/:slug). Fotoğrafçı `#ph-lightbox-credit` görselin hemen altında ("© Ad"). Kapatma:
  `e.target === lightbox || e.target === lbMedia` — görselin/etiketin/panelin üzeri kapatmaz.
- **Menü**: `NAV_ITEMS`'a `fotograf` PROJE'den sonra, footer "Ana Menü"ye de; sayfa
  `data-nav-active="fotograf"`. Sitemap önceliği 0.8. smoke-test 13c artık menü bağlantısının
  VARLIĞINI doğrular (site-chrome.js dosyasında — menü istemcide çizildiğinden ham HTML'de yoktur).
- Testler: `test-2026-09-17-comments-identity-and-photo-page.mjs` 24 test; nav sırası kelepçeleri
  (`test-2026-09-17-manager-moderation-and-nav-order.mjs`) PROJE · FOTOĞRAF · FİRMA · KİŞİ · ÜRÜN ·
  GÜNDEM olarak güncellendi.

## /fotograf üçüncü tur — yapışkan arama, dropdown z-index, künye satırları, künye-destekli arama (2026-09-18)

Kullanıcı isteği: arama çubuğu kaydırdıkça üstte kalsın; dropdown içeriğin arkasında kalıyor;
lightbox'ta künye proje sayfasındaki sırayla (fotoğrafçı hariç); "tuvalet & banyo" hiç sonuç
vermiyor; filtre yalnızca son projeleri gösteriyor ve "daha fazla" çıkmıyor; arama motorunu proje
künyeleriyle güçlendir.

- **Yapışkan arama**: pil hero'nun İÇİNDEN ÇIKTI, hemen altında kendi `.ph-search-sticky`
  kapsayıcısında (`position:sticky; top:66px; z-index:30` — nav 40'ın altında). Sticky, kapsayıcının
  sınırlarıyla çalışır; hero içinde kalsaydı hero ekrandan çıkınca pil de giderdi. Ölçüldü: top 255
  → kaydırınca 66.
- **Dropdown'ın arkada kalmasının KÖK NEDENİ** hero'daki `overflow:hidden` (dropdown hero'nun alt
  kenarında kırpılıyor, kalan kısmı DOM'da sonra gelen kartların arkasında boyanıyordu). Kaldırıldı;
  sticky kapsayıcının z-index'i ızgaranın üstünde. `elementFromPoint` ile doğrulandı.
- **Havuz şekli değişti** (`photoPool.js`): `{ projects: {slug→künye}, items }` — künye (mimarlar/
  firmalar/tür/tip/grup/yer/yıl/ödül/keywordSpaces/photoCredit) proje başına BİR kez, 11k görselde
  tekrarlanmaz; uç sayfalama SONRASI birleştirir (`photos.js#expand`). `items[].spaces`: **null = AI
  hiç bakmadı, [] = AI baktı mekan yok** — bu ayrım ikincil sonucun kapısıdır.
- **Arama sıralaması** (`photos.js#selectPhotos`): (1) AI etiketi eşleşen görseller, (2) ardından AI'ın
  bakmadığı (null) görsellerden projesinin KÜNYESİNDE (başlık+açıklama+tip/grup) o mekanın anahtar
  kelimeleri geçenler (`via:'kunye'`, taksonomideki `keywords`). AI "yok" dediği ([]) görsel asla
  ikincil sonuca girmez. Böylece etiketleme turu tamamlanmadan da sayfa boş kalmaz, "Daha Fazla
  Göster" doğal olarak belirir; etiketleme ilerledikçe 1. küme büyür.
- **"Hiç sonuç yok"un asıl nedeni** etiketleme kapsamıydı: 11.060 görsellik havuzda tur proje başına
  6 görselle ve saatler sürerek ilerliyor (canlıda Oturma Odası 30, Tuvalet & Banyo 0). Yeni tur
  proje başına sınırsız görselle (`max_images=0`) ve künye BAĞLAMIYLA (`classifyPhotoSpace(...,
  context)` — `buildContextNote`: proje adı/tür/tip/grup/açıklama, "yalnızca ipucu, kararı görsele
  göre ver") kuyruğa alındı; betik zaten etiketli görselleri atladığı için turlar üst üste
  çalıştırılabilir (concurrency group sıraya sokar).
- **Anahtar kelimeler istemcide de**: `PHOTO_SPACE_TAXONOMY.keywords` sayesinde "wc"/"salon"/"hamam"
  AI'a gitmeden etikete düşer; AI ucu yalnızca hiçbiri eşleşmezse.
- **Lightbox künyesi**: `#ph-lightbox-meta` — Mimar, Mimarlık Firması, Tür, Tip, Grup, Yer, Yıl, Ödül
  (project-meta.js#renderMeta sırası), düz metin; Fotoğraf satırı yok (görselin altında "© Ad").
- **Otomatik yükleme**: `IntersectionObserver` sentinel (600px önden) + düğme duruyor.
- Testler: `test-2026-09-17-comments-identity-and-photo-page.mjs` 26 test (ikincil sonuç kapısı,
  sıralama, bağlam notu, sayfa kelepçeleri).

## /fotograf dördüncü tur — otomatik yükleme yok, arama kalitesi, çizimler dışarıda (2026-09-18)

Kullanıcı isteği: kaydırınca otomatik yükleme olmasın (yalnızca "Daha Fazla Göster"); filtreye göre
bazen alakasız fotoğraflar geliyor — kaliteyi artıracak farklı yollar; lightbox'taki "künyesindeki
bilgiye göre listelendi" metni silinsin, künyede mimar da olsun; çizim seçenekleri aramadan kalksın
ve sonuçlarda çizim çıkmasın.

- **Otomatik yükleme KALDIRILDI** (bir önceki turun IntersectionObserver'ı + sentinel); sayfa yalnızca
  düğmeyle ilerler.
- **Alakasız sonuçların KÖK NEDENİ künye ikincil sonucuydu** (üçüncü tur): projenin açıklamasında
  "banyo" geçmesi o projenin TÜM etiketsiz görsellerini banyo yapıyordu — proje seviyesinde bir sinyal
  görsel seçemez. KALDIRILDI (`keywordSpaces`/`via` de gitti). Künye artık yalnızca sınıflandırıcıya
  BAĞLAM (photoSpaceClassify.js#buildContextNote) ve arama kutusunda eş anlamlı eşleme için.
- **Güven SAKLANIYOR**: `image_spaces[url]` artık `[{label, confidence}]` (eski düz-string satırlar
  `photoPool.js#normalizeStoredSpaces` ile okunmaya devam eder, güven=null). Filtre İKİ KADEMELİ
  (`photos.js#matchTier`): (1) mekan birincil etiket (modelin "ana konu"su, listenin ilki) ya da
  güven ≥ 0.7; (2) ikincil etiket, güven ≥ 0.55 (bilinmiyorsa kabul). Her kademede yükleme sırası
  korunur — zayıf eşleşmeler kümenin sonuna iner, düşük güvenli ikincil etiket hiç çıkmaz.
- **Prompt sıkılaştırıldı**: "İLK etiket görselin ANA KONUSU; arka planda/kapı aralığından görünen
  mekanı ekleme; kararsızsan az etiket ver — yanlış etiket eksikten kötüdür."
- **Çizimler**: taksonomide `kind:'drawing'` (Plan/Kesit/Cephe Çizimi). `PHOTO_SPACE_LABELS` (AI
  whitelist'i, 15) ile `PHOTO_SPACE_OPTIONS` (aranabilir, 12) AYRILDI — çizim etiketi listede KALIR
  ki AI bir çizimi çizim olarak etiketlesin; çizim etiketi taşıyan görsel havuza HİÇ GİRMEZ
  (fotoğraf sayfası), dropdown'da ve `space-for-query` şemasında yok.
- **Künyede Mimar**: pop-up ile aynı düşüş — mimarı girilmemiş projede firmanın kurucuları
  (`office_founders`) "Mimar" satırında (`project.js#fetchFoundersForOffices`in havuz karşılığı);
  bağ görünürlüğü de pop-up'ınki (önizlemedeki profil adıyla görünür).
- Etiketleme turu (max_images=0, künye bağlamı) kuyrukta; yeni tur güvenleri de yazar, eski turların
  düz-string etiketleri geçerli kalır. `--force` ile tam yeniden etiketleme güven verisini tamamlar.
- Testler: `test-2026-09-17-comments-identity-and-photo-page.mjs` 26 test (kademe kuralı, çizim
  dışlama, kurucu düşüşü, eski/yeni biçim normalize).

## /fotograf beşinci tur — ÜÇ SİNYALLİ arama sistemi: CLIP + vision-LLM v2 + künye (2026-09-18)

Kullanıcı isteği: "Fotoğraf sayfası için Künye fallbackini neden kaldırdın? Fotoğraf sayfasındaki
arama filtreleri için en doğru ve en çok sonuç için gereken en iyi sistemi kur."

**ÖLÇÜLEN DURUM (deploy öncesi canlı)**: 11.058 görselin yalnızca **275'i** etiketliydi ("Tuvalet &
Banyo": 3 sonuç) — süren tur saatte ~280 görsel işliyordu (görsel başına ~13 sn, SIRALI; tam havuz
~40 saat, iş sınırı 6 saat). Etiketler de güvenilmezdi: v1 promptu kapalı 15'lik listeye zorlandığı
için dış cephe kareleri "Resepsiyon + Çalışma Odası + Bahçe" oluyordu (ilk 282 görselin neredeyse
tamamı 2-3 etiket, boş dizi hiç yok). İki eski tur iptal edildi (junk üretiyorlardı).

- **Künye tek başına GERİ GELMEDİ ve nedeni ölçüldü** (761 projenin açıklaması + 11.058 görsel):
  proje seviyesi bir sinyal görsel seçemiyor — görsel kanıtı zayıfken künye eşleşse bile isabet
  Banyo %50 / Mutfak %40 / Resepsiyon %42 / Bahçe fark yok. Tek anlamlı kazanç **Çalışma Odası %78**
  (proje tipi "Ofis" ile örtüşen sınıf). Künye artık yalnızca orada ve yalnızca CLIP kanıtıyla
  birlikte sonuç üretir (`photoSpaceClip.js#CLIP_KUNYE_MIN`); LLM promptuna BAĞLAM olarak eklenmesi
  de ölçümle KAPATILDI (aşağıda).
- **Sinyal 1 — CLIP sıfır-atış ipucu (`src/lib/photoSpaceClip.js`)**: görsel arama dizininin
  (KV `vsearch:imgindex:project:v1`, havuzun %97,6'sını kapsıyor) her görsel için ZATEN tuttuğu
  CLIP ViT-B/32 embedding'i ile 158 İngilizce alt-kavram cümlesinin (`scripts/photo-space-clip-
  classes.json` → `scripts/build-photo-space-clip-prompts.py` → ÜRETİLMİŞ
  `src/lib/photoSpaceClipVectors.js`, int16) kosinüsü; softmax(100·cos), sınıf başına toplam.
  12 aranabilir sınıf + 19 çeldirici sınıf (`_exterior`, `_drawing`, `_worship`, `_hamam`...) —
  çeldiriciler olmadan olasılık kütlesi aranabilir sınıflara akıyordu. AI çağrısı YOK, yeni
  yüklenen görselde de anında (tarayıcı embedding'i kayıt anında dizine ekliyor). Sınıf başına
  GÜÇLÜ eşikler (`CLIP_STRONG_MIN`) 48'lik gözle etiketli örneklemlerden okundu (~%85-95 isabet);
  `_drawing >= 0.6` çizim tespiti 72/72 → **~1.190 çizim LLM bakmadan sayfadan düştü**.
  * JS uygulaması Python/float referansını yeniden üretir (`scripts/photo-space-clip-fixture.json`,
    28 canlı vektör); kaynak sınıf dosyası ile üretilmiş modül SHA ile kelepçeli — dosya değişince
    üretici yeniden koşturulmalı (`/tmp/clip_env`, build-image-embeddings.py ile aynı venv deseni).
  * Havuz (`photoPool.js#attachClipHints`) ipuçlarını KV `photo:cliphints:v1:<sha>` altında KALICI
    tutar; kurulum başına en fazla `CLIP_SCORE_PER_BUILD` (2500) görsel puanlanır, bitmediyse havuz
    **60 sn** TTL ile yazılır (`getCachedPool` yeni `opts.ttlSeconds`), sonraki istek sürdürür.
    KV yazma hakkı (`reserveKvWrite`) puanlamadan ÖNCE ayrılır; alınamazsa bütçe 300'e iner.
    Dizinde olmayan görsel 6 saat "yok" işaretlenir (14 MB'lık dizin boşuna okunmasın).
- **Sinyal 2 — vision-LLM v2 (`photoSpaceClassify.js`)**: (1) önce SAHNE (`ic_mekan/dis_mekan/
  dis_cephe/cizim/detay`; dış cephe/detay sahnesinde aranabilir etiket TUTULMAZ — sahne kazanır),
  (2) 15 çeldirici etiket (`photo-space-taxonomy.js#PHOTO_SPACE_DISTRACTORS` — "Dış Cephe",
  "Restoran / Kafe", "Genel İç Mekan"...; kullanıcının 15'lik listesi DEĞİŞMEDİ, çeldiriciler
  aranmaz/çip olmaz ama SAKLANIR), (3) en fazla 2 etiket. **Saklama v2**: `image_spaces[url] =
  {v:2, scene, spaces:[{label,confidence}]}` — v1 düz dizileri havuz "bakılmadı" sayar, betik
  `--force`suz yeniden işler. Birincillik ÇELDİRİCİ ATILMADAN ÖNCE belirlenir (["Dış Cephe","Bahçe"]
  → Bahçe birincil değil). **Model kademesi bu göreve ÖZEL** (`PHOTO_SPACE_CANDIDATES`):
  `@cf/meta/llama-4-scout-17b-16e-instruct` önce (gold 656: %89,8/%85,9; dış cephe hatası 2/72),
  Mistral-small-3.1 yedek (%87,2/%84,0; 4/72); görsel aramanın `VISION_CANDIDATES`'i DEĞİŞMEDİ.
  Künye BAĞLAMI kapalı: gold'da fark yok, rastgele 700'de modeli proje tipine yanlılaştırdı
  ("Ofis" projesinin atrium/koridoru "Çalışma Odası") ve Scout'ta %3,6 yanıt hatası üretti.
- **Tek sıralama = ÖLÇÜLEN İSABET SIRASI** (`photos.js#spaceTier`; rastgele 700 görsel LLM'e sorulup
  CLIP'le çaprazlandı, uyuşmazlık hücreleri gözle hakemlendi): 1 LLM birincil + CLIP≥0.25 (%90+) ·
  2 CLIP güçlü, LLM bakmadı (~%90) · 3 LLM ikincil + CLIP≥0.25 (%78) · 4 CLIP orta + künye (yalnız
  Çalışma Odası, %78) · 5 LLM birincil, CLIP zayıf (0.10-0.25) ya da ipucu yok (%65) · 6 tek model
  tek başına — LLM birincil ama CLIP<0.10 / CLIP güçlü ama LLM başka dedi (%45-50, EN SONDA).
  CLIP'in desteklemediği İKİNCİL etiket (%35) hiç gösterilmez. **"Hüküm tek modelin" DEĞİL**:
  LLM'in CLIP'in desteklemediği birincil etiketleri (LLM etiketlerinin %55'i) ~%50 isabetliydi.
  Her kademe kendi içinde yükleme sırasını korur. Simülasyon (canlı dizinle, LLM bakmadan):
  1.589 sonuç (eskiden ~607, %2,5 kapsam).
- **Etiketleme betiği** (`scripts/photo-space-classify-backfill.mjs`): `--concurrency` (varsayılan
  10) ile PARALEL (656 görsel 1,7-2,4 dk; tam havuz ~1 saat), proje bitince YAZ ve yazmadan hemen önce
  kolonu yeniden oku/birleştir, `--max-minutes` (320) sonrası temiz çıkış, ağ/429/5xx yeniden
  deneme, havuzla AYNI görünürlük (blurlu projeye AI harcanmaz). **Üç mod**: etiketle / `--eval`
  (656 gözle etiketli `scripts/photo-space-gold.json`, sınıf başına isabet-kapsama, HİÇ YAZMAZ) /
  `--index-report` (CLIP dizin kapsamı + LLM bakmadan mekan başına sonuç sayısı). Deney bayrakları
  `--model=`, `--with-context`, `--eval=scripts/photo-space-sample.json` (rastgele 700, yansız).
- **Workflow** `.github/workflows/photo-space-classify.yml`: `mode` (etiketle/olc/dizin),
  `concurrency`, `eval_file`, `model`, `context`; **`schedule: 41 2,8,14,20 * * *`** — zamanlanmış
  koşu her zaman `apply=evet, scope=tumu` (yalnızca eksikler; eksik yoksa tek D1 sorgusu). Yeni
  yüklenen proje o ana kadar CLIP ile aranabilir, sonra LLM etiketi gelir.
- **`GET /api/photos/stats`** (yalnızca sayılar): `images/llmLabeled/clipHinted/clipMissing/
  clipPending/clipDrawingsHidden` + mekan başına kademe sayıları; `smoke-test.sh` 13c artık
  "mekan sinyali > 0 ve Oturma Odası > 0" ister (boş filtre 200 dönmeye devam ediyordu).
- Testler: `scripts/test-2026-09-18-photo-space-signals.mjs` (29 test, preflight'a bağlı) +
  `test-2026-09-17-comments-identity-and-photo-page.mjs` v2 biçimine geçti (26). Migration YOK,
  SSR sürüm bumpı YOK. Maliyet notu: tam havuz etiketlemesi ~11 bin vision çağrısı (~$5-8, bir
  kez); zamanlanmış koşular yalnızca yeni görseller için harcar.

## /fotograf altıncı tur — hero (açık mavi bant) daraltıldı (2026-09-18)

Kullanıcı isteği: "Fotoğraf sayfasında ilk çıkan açık mavi alan çok geniş, bunu daralt."

- Bant `fotograf.html#.ph-hero`. Ölçüldü (Chromium): masaüstünde 229 → 142 px, mobilde (390px)
  280 → 139 px. Üç kaynak: dolgu 56/74 → 28/52 (mobil 36/48 → 22/46), h1 38 → 32 px (mobil 28 → 26),
  p'nin 26px alt boşluğu KALDIRILDI — o mesafeyi alt dolgu zaten taşıyordu (yapışkan pilin -32px
  bindirmesi + ~20px nefes payı), iki boşluk aynı aralığı iki kez sayıyordu.
- Mobil `min-height:280px` KALDIRILDI: bant artık içeriği kadar. "Açık mavi": gece temasında hero'nun
  tabanı `var(--ink)` (#E8ECF1) olduğundan bant açık çelik mavisi görünür (açık temada koyu lacivert);
  renk bu turda BİLEREK değişmedi — istek yalnızca yüksekliği kapsıyor.
- Yapışkan arama pilinin kuralları (`.ph-search-sticky`: top / margin-top) DEĞİŞMEDİ; pil hâlâ bandın
  alt kenarına biner.
- Test: `scripts/test-2026-09-17-comments-identity-and-photo-page.mjs` (iki hero kuralında dolgu üst
  sınırı + min-height yokluğu + `p{margin:0}`). Migration YOK, SSR sürüm bumpı YOK.

## /fotograf yedinci tur — YENİ YÜKLENEN projeler aynı kurallarla, kendiliğinden (2026-09-18)

Kullanıcı isteği: "Bundan sonra yüklenecek tüm projeler de fotoğraflar sayfasında görünür olsun ve
aynı kurallara göre işlesinler."

**ÖLÇÜLEN BOŞLUK**: yayına giren proje havuza ANINDA giriyordu (her içerik yazımı
`invalidatePublicCache` ile `pool:photos:v2`yi düşürür; en yeni proje en önde) ama görselleri "LLM
bakmadı" durumundaydı: LLM etiketi yalnızca günde 4 kez koşan GitHub işine, CLIP ipucu ise sayfa
yönlenmeden bitmesi mümkün olmayan bir tarayıcı işine bağlıydı — dizin raporunda en yeni 14
projenin (kc-evi, cer-loft...) HİÇBİR görselinin embedding'i yoktu (kayıt anında 89 MB model + 13
görsel, 1,2 sn sonra yönlendirme). Blur (önizleme) kuralı DEĞİŞMEDİ: blurlu proje sayfada görünmez
(2026-09-17 madde 10), blur kalkınca aynı zincir onu alır.

- **Worker cron'u `*/15 * * * *`** (`src/lib/photoSpaceCron.js#labelPendingPhotoSpaces`,
  `src/index.js#PHOTO_SPACE_CRON`, wrangler.jsonc): havuzla AYNI görünürlükteki projelerden v2 etiketi
  OLMAYAN görseller (en yeni proje önce; v1 düz diziler de "yok" sayılır) — betikle AYNI
  `classifyPhotoSpace` + `storedSpaceEntry` (Scout→Mistral), AYNI türev adresi
  (`/media/_derived/w800/...`, Worker kendi alan adına subrequest atar), yazmadan önce kolon
  yeniden okunup birleştirilir, kalıntı girdiler atılır, sonra yalnızca `pool:photos:v2` düşürülür.
  Sınırlar `PHOTO_SPACE_CRON_LIMITS`: 24 görsel / ~100 sn / 3 eşzamanlı → günde ~2.300 kapasite,
  nöron yalnızca YENİ görsel için. Son turun özeti `site_settings.photo_space_cron_last` (iç anahtar,
  `INTERNAL_SETTING_KEYS`) → `/api/photos/stats.cron` (`at/scanned/pending/classified/failed/
  remaining/budgetHit`).
- **Dispatcher**: Gündem dalı `cron !== VISUAL_INDEX_CRON && !isPhotoSpaceCron` — aksi halde
  "tanınmayan ifadede Gündem yine de çalışsın" kuralı Gündem'i 15 dakikada bir koştururdu. Meet
  yeniden denemesi de aynı dışlamayla. Test: `test-gundem.mjs` 5a-5e değişmedi.
- **GitHub işi** (`photo-space-classify.yml`): etiketlemeden ÖNCE **CLIP embedding adımı** —
  `build-image-embeddings.py --type project --only-changed --max-images 0 --derivative 400`
  (Python 3.11 + `scripts/photo-space-embed-requirements.txt`, `continue-on-error`). Betik artık
  `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` ortam değişkenlerini tanır (toml runner'da yok).
  Bu adım tarayıcı yolunun tamamlayamadığı embedding'leri kapatır; `--only-changed` yalnızca images
  listesi dizindekinden farklı projeleri embed eder (tarayıcı yolunun `/media/u/..` göreli anahtarı
  ile betiğin mutlak anahtarı farklı olduğundan o projeler bir kez yeniden embed edilir — beklenen).
  `photoPool.js#CLIP_MISS_RETRY_HOURS` 6 → **1**: yeni embedding en geç 1 saatte ipucuya döner.
- **Tarayıcı** (`proje-ekle.html`): embedding dosya eklenir eklenmez ARKA PLANDA sırayla hesaplanır
  (`precomputeImageEmbeddings`, tek kuyruk), gönderim `keepalive: true`, üç yayın yolu da
  `navigateAfterEmbeddings` ile gönderim bitene kadar (en fazla `EMBED_NAV_WAIT_MS` = 8 sn, en az
  1,2 sn) bekler. urun-ekle.html'e dokunulmadı (ürünler fotoğraf sayfasında değil; ürün
  embedding'i görsel arama içindir).
- Testler: `scripts/test-2026-09-18-photo-page-new-uploads.mjs` (11 test, preflight'a bağlı) —
  cron turu GERÇEK SQLite + sahte AI/fetch ile ölçülür. Migration YOK, SSR sürüm bumpı YOK.

## /fotograf sekizinci tur — yalnızca fotoğraf + "Daha Fazla Göster" sırayı bozmaz (2026-09-18)

Kullanıcı isteği: "Fotoğraflar sayfasında mimar çizimler yayınlanmasın, sadece fotoğraflar olsun.
Ayrıca daha fazla göre butonuna tıklayınca fotoğrafların sıralaması değişmesin, yeni gelecek
fotoğraflar ... alt sıralardan gözükmeye başlasın üst tarafa dahil olmasınlar."

- **Çizimlerin KÖK NEDENİ "sinyalsiz" görsellerdi**: akışın en üstündeki en yeni projenin (Ahiler
  Kalkınma Ajansı) plan/kesit paftaları ne LLM etiketi ne CLIP embedding'i taşıyordu; havuz
  bilinmeyen görseli "fotoğraf" sayıyordu. Kural artık (`photoPool.js`): görsel YALNIZCA bir sinyal
  onu fotoğraf olarak tanıdıysa gösterilir — sinyalsiz kare gizli (`stats.unknownHidden`), CLIP
  `_drawing >= 0.6` LLM "fotoğraf" dese BİLE düşer, LLM bakmamışken CLIP'in en olası sınıfı çizimse
  düşer. Havuz şekli `photos:v3`.
- **Cron hiçbir yeni görseli etiketleyemiyordu** (canlı özet: 24/24 failed, 1,1 sn): Worker'ın
  KENDİ alan adına attığı `/media/_derived/...` fetch'i başarısız. `photoSpaceCron.js` baytları artık
  önce doğrudan `env.UPLOADS`tan (`_derived/w800/r2/<k>`, yoksa orijinal) ya da `env.ASSETS`ten
  okur; fetch yalnızca yedek. Sinyalsiz yeni görsel bu sayede ~15 dk içinde görünür olur.
- **Sıralama**: ızgara CSS `columns` idi — içerik değişince tarayıcı TÜM kartları sütunlara yeniden
  dağıtıyor, yeni gelenler üst sıralara karışıyordu. Artık sabit `.ph-col` sütunları; her kart
  eklendiği anda en kısa sütunun SONUNA konur (`placeCard`) ve bir daha taşınmaz. Yeniden dağıtım
  yalnızca sütun sayısı değişince (4 / 3 ≤960px / 2 ≤720px). Görsel yüklenene kadar 4:3 yer tutucu
  oran (yerleşim anında sütun yükseklikleri anlamlı olsun). Sayfalar arası mükerrer url atılır.
- Testler: `test-2026-09-18-photo-space-signals.mjs` (30), `test-2026-09-18-photo-page-new-uploads.mjs`
  (13), `test-2026-09-17-comments-identity-and-photo-page.mjs` (26). Migration YOK, SSR bumpı YOK.

## /fotograf dokuzuncu tur — her açılışta RASTGELE sıra (2026-09-18)

Kullanıcı isteği: "Fotoğraf sayfasına her girdiğimizde farklı bir sıralamada karşılaşalım, en son
yüklenen projenin fotoğrafları ilk sıraya gelsin kuralını kaldır."

- `fotograf.html` her açılışta `ORDER_SEED` (0..999) üretir ve TÜM `/api/photos` isteklerine `seed`
  olarak ekler; sunucu (`photos.js#seededShuffle`, mulberry32) listeyi o tohumla karıştırır. Sıra bir
  ziyaret içinde SABİT (sayfalama aynı karıştırmanın devamı — tekrar/atlama yok, sekizinci turun
  "Daha Fazla Göster sırayı bozmaz" kuralı korunur), yenilemede değişir.
- Mekan filtresinde isabet KADEMELERİ korunur; karıştırma her kademenin kendi içindedir.
- Önbellek anahtarı normalize parametrelerden kurulur (tohum 1000'e kısılı → sınırlı anahtar sayısı).
  Tohumsuz istek havuz (yükleme) sırasını döner — smoke-test/eski istemci için.
- Test: `scripts/test-2026-09-18-photo-page-new-uploads.mjs` (14).

## /fotograf onuncu tur — kart altında PROJE ADI (2026-09-18)

Kullanıcı isteği: "Fotoğraf kartlarının altında proje adı yazsın, mimarlık firmasının adı yazmasın."
`fotograf.html#cardHtml` artık `.ph-card-credit`e `item.projectTitle` yazar (ikinci turdaki
"firma, yoksa mimar" kuralı kaldırıldı). Firma/mimar bilgisi lightbox künyesinde DURUYOR; API'nin
`credit` alanı değişmedi. Test: `test-2026-09-17-comments-identity-and-photo-page.mjs`.

## Admin üye pop-up'ı yalnızca hesap alanları + gündem bülteni 10'da 1 (2026-09-18)

Kullanıcı isteği: (1) "admin panelinde siteye üye olan kullanıcıların gözüktüğü paneldeki doğum
yılı, üniversite vs. gibi bilgileri kaldır. Sadece Ad Soyad, kullanıcı adı ve e-posta gözüksün.",
(2) "Gündem içerikleri abone olan e-postalara 10 tanede 1 tane şeklinde gitsin."

- **Admin > Üyeler detay pop-up'ı** (`admin.html#ud-overlay`): "Profil Bilgileri" artık yalnızca
  Ad Soyad + Kullanıcı Adı (düzenlenebilir) + E-posta (`readonly`). Kaydet gövdesi yalnızca
  `name`/`username` taşır — `updateUserProfileFields` kullanıcı adında kayıttaki AYNI kuralı ve
  tekillik kontrolünü uygular, e-postayı zaten kabul etmez. `users` kolonları (dob/school/...)
  SİLİNMEDİ, yalnızca ekran kaldırıldı. Bu, "Hesap üyeliği ile kişi profili AYRIDIR" kuralının
  admin tarafıdır.
- **Gündem bülteni**: `newsletterNotify.js#GUNDEM_NOTIFY_EVERY_N = 10` (proje/ürün hâlâ 5'te 1,
  ayrı sayaç). Sayaç sıfırlanmaz; ilk gündem maili sayacın bir sonraki 10'un katında gider.
- Testler: `scripts/test-2026-09-18-admin-user-account-fields.mjs` + güncellenen
  `scripts/test-2026-09-12-newsletter-scope-and-gundem.mjs` (ikisi de preflight'a bağlı).
