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
