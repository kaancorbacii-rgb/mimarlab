# MİMARLAB — Proje Notları

## Deploy

**Production'a HER ZAMAN `./deploy.sh` ile deploy edin — asla doğrudan `wrangler deploy` çalıştırmayın.**

`deploy.sh`, çıplak `wrangler deploy`'un yapmadığı üç kontrolü zorunlu kılar, deploy bunlardan biri başarısız olursa hiç başlamaz:

1. `miras/` klasörünün deploy edilecek ağaçta gerçekten dolu olduğunu doğrular (eşik: >= 2500 dosya; boş/eksikse deploy tüm miras görsellerini canlı asset manifest'inden siler).
2. Başka hiçbir worktree'nin dalının, deploy edilecek daldan commit olarak ileride olmadığını doğrular (aksi halde eski/eksik bir dal canlıya çıkar).
3. Working tree'nin commit edilmemiş değişiklik içermediğini doğrular (`wrangler deploy` working tree'yi deploy eder, son commit'i değil — aksi halde hiçbir git commit'ine karşılık gelmeyen, izlenemeyen bir production versiyonu ortaya çıkar).

Doğrudan `wrangler deploy` bu üç kontrolü de atlar. 2026-08-23 remediation'ında tam olarak bu yolla — başka bir terminalden çıplak `wrangler deploy` çalıştırılarak — iki ek, commit'siz production deploy'u oluştu (bkz. commit `814c5aa7`, `deploy.sh`'taki working-tree guard'ı).

Deploy sonrası `deploy.sh` otomatik olarak `scripts/preflight-check.sh` (deploy öncesi), `scripts/health-check.sh` ve `scripts/smoke-test.sh` (deploy sonrası) çalıştırır — bunları ayrıca elle çalıştırmaya gerek yok, `deploy.sh` zaten zincirliyor.

### 1. kapının gerekçesi DEĞİŞTİ (2026-09-10) — görseller artık git'te

Bu not daha önce 1. kapıyı "`miras/` gitignored, o yüzden her worktree'nin kendi kopyası olmalı" diye
açıklıyordu. **Bu artık doğru değil:** `36ac8f92` (2026-09-10) ile `miras/`'ın 2887 dosyası git'e
eklendi. `projects/` (10.013 dosya), `mimarlar(-thumb)/`, `logos(-thumb)/` dahil tüm görsel klasörleri
de izleniyor — toplam 16.279 izlenen dosya, ~3,5 GB working tree. `.gitignore`'da `miras/` deseni yok.

Sonuçları:

- Taze bir klon (yeni worktree, CI runner, bulut konteyneri) 1. kapıyı **kendiliğinden geçer**.
- `scripts/deploy-guard.sh`'in hata mesajındaki `rsync "/Users/kaancorbaci/Projects/mimarlab/miras/" ./miras/`
  önerisi bir **tarihsel kalıntıdır**. `miras/` bugün boş görünüyorsa asıl sebep eksik/kısmi bir
  checkout'tur; çözüm rsync değil, checkout'u düzeltmektir.
- Kapının KENDİSİ hâlâ gerekli: sparse/kısmi bir checkout ya da kazara toplu silme klasörü yine
  boşaltabilir ve sonuç aynı olur (tüm miras görselleri canlıda 404).

## Uzaktan (telefondan) deploy — `.github/workflows/deploy.yml`

Bilgisayar kapalıyken canlıya çıkmanın yolu GitHub Actions'tır.

**Claude Code'un bulut konteynerinden DOĞRUDAN deploy edilemez** (2026-09-12'de ölçüldü): o ortamda
hiçbir Cloudflare kimlik bilgisi tanımlı değil ve ağ politikası `api.cloudflare.com` ile
`mimarlab.com` için proxy CONNECT'ini 403 ile reddediyor — token verilse bile `wrangler` Cloudflare'e,
`health-check.sh`/`smoke-test.sh` de canlı siteye ulaşamaz. GitHub runner'ının ağı açıktır, zincir
orada sorunsuz çalışır ve API token'ı GitHub secret'ında kalır, hiçbir oturum konteynerine girmez.

Workflow, `deploy.sh`'i **sarmalamaz, olduğu gibi çağırır** — üç kapı, preflight ve deploy sonrası
health-check + smoke-test aynen çalışır; hiçbir kontrol orada tekrarlanmadı (tek kaynak: `deploy.sh`
+ `scripts/deploy-guard.sh`). Tasarım kararları:

- **Tetikleme yalnızca elle** (`workflow_dispatch`) ve onay kutusuna tam olarak `deploy` yazmak
  gerekir. `main`'e push **otomatik deploy ETMEZ** — canlıya çıkış açık bir karar olarak kalır.
- **Yalnızca `main` dalından** çalışır. Gerekçe: 2. kapı (worktree ayrışması) CI'da *sessizce boştur*,
  çünkü runner kullanıcının makinesindeki kardeş worktree'leri göremez; "eski bir dal canlıya
  çıkmasın" korumasının CI'daki telafisi, production'ın yalnızca `main`'den çıkmasıdır.
- **`concurrency: production-deploy`** (`cancel-in-progress: false`). `deploy.sh`'in eşzamanlı-deploy
  kilidi `.git/mimarlab-deploy.lock`'ta yaşadığı ve her CI çalıştırması taze checkout aldığı için o
  kilit CI çalıştırmaları *arasında* hiçbir şey korumaz; seri hale getirmeyi concurrency yapar.
- **`wrangler` GLOBAL kurulur** (`npm install -g`). Yerel `npm install` repo köküne `node_modules/` +
  `package-lock.json` yazar; bunlar `.gitignore`'da **olmadığı** için 3. kapı (temiz working tree)
  deploy'u haklı olarak durdurur. Sürüm `^4.131.0`'a sabitlendi (build-hook'un dayandığı
  `WRANGLER_COMMAND` davranışı o sürümle ölçüldü).
- **Gereken secret'lar:** `CLOUDFLARE_API_TOKEN` (zorunlu). En kolayı Cloudflare'in hazır
  *Edit Cloudflare Workers* token şablonu — `wrangler.jsonc`'daki bağlayıcıların hepsini (D1, R2,
  KV, AI + Workers Scripts) kapsar; elle verilecekse Workers Scripts:Edit, D1:Edit,
  Workers R2 Storage:Edit, Workers KV Storage:Edit, Workers AI:Edit, Account Settings:Read.
  `CLOUDFLARE_ACCOUNT_ID` yalnızca token birden fazla hesaba yetkiliyse gerekir; tanımsızsa
  workflow onu boş bırakmaz, tamamen kaldırır.
- **GitHub kısıtı:** `workflow_dispatch` yalnızca **default dalda (`main`) duran** workflow dosyaları
  için tetiklenebilir. Bu dosya `main`'e merge edilene kadar ne arayüzde ne API'den görünür.

### Cloudflare Workers Builds (Git entegrasyonu) — BAĞLI KALMAMALI

**Bulgu (2026-09-12):** Cloudflare panelinden bu repoya bir *Workers Builds* Git entegrasyonu
bağlanmış ve hiçbir yerde belgelenmemişti — bu dosyada, `docs/`'ta, `deploy.sh`'te, `scripts/`'te
"Workers Builds" geçmiyordu. Her push'ta Cloudflare repoyu klonlayıp kendi deploy'unu başlatıyor ve
PR'lara `Workers Builds: mimarlab` check'i ile `cloudflare-workers-and-pages[bot]` yorumu düşüyor.

Bu entegrasyon çıplak `wrangler deploy` / `versions upload` çalıştırdığı için `wrangler.jsonc`'un
build hook'u (`scripts/deploy-guard.sh --hook`, `0a44bfcb` / 2026-09-10) onu **reddediyor**. Yerelde
birebir üretildi:

```
$ WRANGLER_COMMAND=deploy bash scripts/deploy-guard.sh --hook
DEPLOY DURDURULDU: doğrudan 'wrangler deploy' kullanılamaz.     (çıkış 1)
```

Komut bazında: `deploy` ve `versions upload` reddedilir (yani non-production dal önizlemeleri de),
`dev` ve `types` etkilenmez. Yani entegrasyon **2026-09-10'dan beri her commit'te düşüyor**; canlıya
bir şey yayınlamıyor, ama sürekli kırmızı bir check üretiyor — ve "kırmızı normaldir" alışkanlığı
zamanla gerçek bir hatayı gizler.

**Karar (2026-09-12): entegrasyon Cloudflare panelinden kaldırılacak** (Workers → `mimarlab` →
Settings → Build → Git repository → Disconnect). Reddedilen alternatifler:

- Workers Builds'in deploy komutunu `./deploy.sh` yapmak — `main`'e her push'u otomatik production
  deploy'una çevirirdi; canlıya çıkış açık bir karar olarak kalmalı.
- Workers Builds ortamına `MIMARLAB_ALLOW_BARE_DEPLOY=1` vermek — 2026-09-10'da bilerek eklenen
  kapıyı etkisiz kılar: eşzamanlı deploy kilidi, preflight ve deploy sonrası health-check +
  smoke-test atlanır.

Kaldırmak **hiçbir deploy yolunu bozmaz**: yerelde `./deploy.sh`, uzaktan
`.github/workflows/deploy.yml` (API token ile doğrudan Cloudflare API'sine gider, bu entegrasyonu
kullanmaz). Yayında duran Worker de etkilenmez — kaldırılan şey deploy'u *tetikleyen* bağlantı.

**Hâlâ bağlı mı?** Yeni bir commit'te `Workers Builds: mimarlab` check'i beliriyorsa bağlı demektir.
