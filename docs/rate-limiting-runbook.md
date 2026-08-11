# Cloudflare Native Rate Limiting — Uygulama Rehberi (Faz 4D)

Bu kurallar **koda değil**, Cloudflare zone yapılandırmasına ait olduğu için kod
tarafından uygulanamıyor: `wrangler whoami` ile doğrulandığı üzere bu repodaki
wrangler OAuth token'ının zone üzerinde yalnızca `read` (okuma) yetkisi var, WAF/
Rulesets için `write` (Zone > WAF > Edit) yetkisi yok. Bu yüzden kurallar aşağıda
Cloudflare Dashboard'dan elle uygulanacak şekilde hazırlandı (~5 dakika sürer).
Uygulandıktan sonra istekler Worker'a (ve dolayısıyla D1'e) hiç ulaşmadan edge'de
reddedildiğinden maliyet sıfıra yakın kalır — [src/lib/rateLimit.js](../src/lib/rateLimit.js)'teki
mevcut D1 tabanlı uygulama-seviyesi limit bunun YERİNE değil, İKİNCİ bir savunma
katmanı olarak (edge kuralı bir şekilde atlanırsa/gecikirse) çalışmaya devam eder.

## Nereden uygulanır

**mimarlab.com zone'u → Security → WAF → Rate limiting rules → Create rule**

> Not: Cloudflare Free plan'da rate limiting rule sayısı sınırlı olabilir (plan'a
> göre değişir). Sınırlıysa önce Grup B'yi (auth/form) uygula — kötüye
> kullanıldığında en maliyetli/riskli olan grup odur.

## Grup A — Genel liste/arama uçları (muhafazakâr limit)

Amaç: normal kullanıcı/arama motoru trafiğini kısıtlamadan, otomatik kazıma
(scraping) veya sonsuz döngü/bug kaynaklı patlamaları durdurmak.

- **Rule name:** `mimarlab-public-api-rl`
- **When incoming requests match** (Custom filter expression, Edit expression'a geç):
  ```
  (
    http.request.uri.path in {
      "/api/projects" "/api/architects" "/api/offices" "/api/products" "/api/news"
      "/api/architects/search" "/api/offices/search" "/api/architects/schools"
      "/api/projects/filters"
    }
    or starts_with(http.request.uri.path, "/api/public/")
    or starts_with(http.request.uri.path, "/api/architect/")
    or starts_with(http.request.uri.path, "/api/office/")
    or starts_with(http.request.uri.path, "/api/project/")
    or starts_with(http.request.uri.path, "/api/product/")
  )
  ```
- **Characteristics:** IP Address (varsayılan — `Aggregate by` alanında IP seçili kalsın)
- **Period:** 1 minute
- **Requests per period:** 300
- **Mitigation timeout / action:** Block, 60 seconds
- **Bot istisnası (önemli — ham User-Agent'a GÜVENME):** eğer planında
  `cf.client.bot_management.verified_bot` alanı seçilebiliyorsa (Custom filter
  expression'da alan listesinde arayarak kontrol et), yukarıdaki ifadenin başına
  `not cf.client.bot_management.verified_bot and (...)` ekleyerek Google/Bing gibi
  doğrulanmış botları limitin dışında tut. Bu alan planında yoksa **UA bazlı bir
  istisna EKLEME** (ham UA sahtecilikle kolayca atlatılır) — bunun yerine ücretsiz
  "Bot Fight Mode"u (Security → Bots) ayrıca aç; 300 req/dk eşiği zaten meşru arama
  motoru tarama hızının çok üzerinde, ek istisna olmadan da onları etkilemez.

## Grup B — Auth/form/submission/ödeme uçları (sıkı limit)

Amaç: brute-force login, spam kayıt/form/upload, ödeme deneme patlaması.

- **Rule name:** `mimarlab-auth-form-rl`
- **When incoming requests match:**
  ```
  (
    http.request.uri.path in {
      "/api/auth/signup" "/api/auth/login" "/api/auth/forgot-password"
      "/api/auth/reset-password" "/api/auth/change-password" "/api/uploads"
      "/api/contact" "/api/csp-report"
    }
    or starts_with(http.request.uri.path, "/api/payments/")
    or starts_with(http.request.uri.path, "/api/auth/google/")
    or starts_with(http.request.uri.path, "/api/auth/linkedin/")
  )
  ```
- **Characteristics:** IP Address
- **Period:** 1 minute
- **Requests per period:** 20
- **Mitigation timeout / action:** Block, 300 seconds (5 dakika)
- Bot istisnası uygulama — bu grup zaten kimlik doğrulama/form/ödeme trafiği,
  meşru bot burada yok.

## Doğrulama (uygulandıktan sonra)

Cloudflare'in kendi rate-limit block yanıtı varsayılan olarak zaten
`429 Too Many Requests` + `Retry-After` header'ı döner. Uygulama sonrası:

```bash
for i in $(seq 1 25); do curl -s -o /dev/null -w "%{http_code} " https://mimarlab.com/api/contact -X POST -H 'Content-Type: application/json' -d '{}'; done; echo
```

Sondaki isteklerde `429` görülmeli ve `curl -i` ile tekrar edilen tek bir istekte
`Retry-After` header'ı olmalı. Bu repodaki `scripts/health-check.sh`/benchmark adımı
Grup B'nin uygulama-seviyesi (D1) 429'unu zaten doğruluyor — WAF kuralı
uygulandıktan sonra aynı testte 429'un WAF'tan (Cloudflare'in kendi engelleme
sayfası/gövdesi, uygulamanın `{"error": "..."}` JSON'ından FARKLI bir gövde) mi
geldiğini gövdeye bakarak ayırt edebilirsin.
