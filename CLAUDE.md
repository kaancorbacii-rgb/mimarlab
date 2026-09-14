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

- **Hesap (`users`)**: ad soyad, **kullanıcı adı** (`username`, @kaancorbaci), e-posta, şifre, avatar.
  Hesabım başlığındaki "Profili Düzenle" YALNIZCA ad soyad + kullanıcı adını düzenler.
- **Kişi künyesi (`architects` / `architect_submissions`)**: doğum yılı, üniversite, meslek,
  pozisyon, ödüller, açıklama, sosyal medya, portfolyo. Hesabım'daki "Kişi Bilgileri" kutusu bunu
  admin'in atadığı onaylı `profile_claims('architect')` kaydından okur (atama yoksa kullanıcının
  kendi açtığı kişi kaydından) ve "Bilgileri Düzenle" düğmesi yalnızca o kaydı yazar.
- **Kaldırılan üç köprü** (geri gelirse ayrım sessizce bozulur; preflight bunu arıyor —
  `scripts/test-2026-09-14-account-person-split.mjs`):
  `src/lib/claimedProfiles.js#fillUserFromArchitectProfile`,
  `src/routes/submissions.js#syncOwnArchitectToAccount`,
  `js/components/auth-modal.js#syncClaimedArchitectData`.
- **Tek bilinçli istisna**: profil FOTOĞRAFI. Kişi künyesi formundan yüklenen fotoğraf hem kişi
  kaydına hem hesabın avatarına yazılır (nav'daki avatarın tek düzenleme yolu orası).
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
