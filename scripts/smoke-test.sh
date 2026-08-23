#!/bin/bash
# P2 hardening (denetim raporu, 2026-08-23) — health-check.sh'in tamamlayıcısı, onun YERİNE geçmez
# (bkz. kullanıcı isteği: "mevcut health-check.sh sistemini gereksiz yere yeniden yazma"). Bu betik
# health-check.sh'in kapsamadığı, P1 denetim düzeltmelerinin ("cdnSrcset" anasayfa hatası, detay
# sayfalarının SSR body içeriği) canlıda GERÇEKTEN kalıcı olduğunu doğrulayan daha kapsamlı
# regresyon kontrollerini yapar. Yalnızca salt-okunur GET istekleri kullanır, hiçbir veri değiştirmez.
#
# gerçek bulgu: macOS'un sistem /bin/bash'i hâlâ 3.2 (Apple lisans nedeniyle) — `declare -A`
# (associative array) burada YOK. Bu yüzden bilerek case/function tabanlı bir eşleme deseni
# kullanılıyor (health-check.sh gibi diğer betiklerin de zaten yaptığı, bash 3.2 uyumlu tarz).
#
# Kullanım: scripts/smoke-test.sh [base_url]
#   base_url verilmezse https://mimarlab.com kullanılır (production). Yerel bir `wrangler dev`
#   örneğine karşı da çalıştırılabilir (ör. scripts/smoke-test.sh http://localhost:8787).
set -uo pipefail
cd "$(dirname "$0")/.."

BASE_URL="${1:-https://mimarlab.com}"
fail=0
warn=0

ok()   { echo "  OK: $1"; }
bad()  { echo "  BAŞARISIZ: $1" >&2; fail=1; }
warnf(){ echo "  UYARI: $1" >&2; warn=1; }

check_status() {
  local path="$1" expected="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$path")
  if [ "$code" != "$expected" ]; then
    bad "$path -> $code (beklenen $expected)"
  else
    ok "$path -> $code"
  fi
}

# gerçek bulgu: fetch_body içinde bir global'e (LAST_STATUS) yazıp $(...) komut ikamesiyle
# çağırmak İŞE YARAMAZ — $(...) bir subshell çalıştırır, subshell içindeki atama ana kabuğa asla
# yansımaz. Bunun yerine gövde+status TEK bir çıktıda birleştirilip ayrıştırılıyor.
fetch_body_and_status() {
  local path="$1"
  curl -s -w '\n%{http_code}' "$BASE_URL$path"
}
# split_status <combined> — son satırı status olarak $REPLY_STATUS'e, geri kalanını stdout'a yazar.
split_body() { printf '%s' "$1" | sed '$d'; }
split_status() { printf '%s' "$1" | tail -n1; }

list_endpoint_for() { case "$1" in project) echo projects;; architect) echo architects;; firm) echo offices;; product) echo products;; esac; }
detail_prefix_for() { case "$1" in project) echo proje;; architect) echo mimar;; firm) echo firma;; product) echo urun;; esac; }

echo "Smoke test başlıyor: $BASE_URL"
echo ""

echo "1) Homepage"
check_status "/" 200
home_html=$(curl -s "$BASE_URL/")
for js in "image-cdn.js" "overlay-manager.js" "auth-nav.js" "js/components/site-chrome.js"; do
  if [[ "$home_html" == *"$js"* ]]; then ok "kritik script mevcut: $js"; else bad "kritik script EKSİK: $js"; fi
done
# denetim regresyon koruması (2026-08-22 P1 düzeltmesi): index.html'in ilk render zincirinin
# DOMContentLoaded'a alınmadan geriye alınmadığını doğrular — "cdnSrcset is not defined" hatasının
# geri gelip gelmediğinin statik bir imzası (gerçek console hatası yakalamak headless bir tarayıcı
# gerektirir, bkz. dosya sonu notu; bu yalnızca kaynak-seviyeli bir regresyon koruması).
if grep -q "document.addEventListener('DOMContentLoaded'" index.html; then
  ok "anasayfa render zinciri hâlâ DOMContentLoaded'a alınmış (P1 regresyon koruması)"
else
  bad "anasayfa render zinciri artık DOMContentLoaded'a alınmamış görünüyor — cdnSrcset regresyon riski!"
fi

echo ""
echo "2) API + Detay sayfaları — SSR body içeriği (denetim P1 düzeltmesi regresyon koruması)"
for kind in project architect firm product; do
  ep=$(list_endpoint_for "$kind")
  prefix=$(detail_prefix_for "$kind")
  combined=$(fetch_body_and_status "/api/$ep?limit=3")
  json=$(split_body "$combined")
  if ! echo "$json" | jq -e '.items and (.items | type == "array") and (.items | length > 0)' >/dev/null 2>&1; then
    bad "/api/$ep beklenen şekilde değil ya da boş: $(echo "$json" | head -c 200)"
    continue
  fi
  ok "/api/$ep -> items[] dolu"
  slug=$(echo "$json" | jq -r '.items[0].slug // empty')
  if [ -z "$slug" ]; then
    warnf "$kind için örnek slug bulunamadı, detay/SSR kontrolü atlandı"
    continue
  fi

  path="/$prefix/$slug"
  combined=$(fetch_body_and_status "$path")
  html=$(split_body "$combined")
  status=$(split_status "$combined")
  if [ "$status" != "200" ]; then
    bad "$path -> $status (beklenen 200)"
    continue
  fi
  ok "$path -> 200"
  # tam olarak BOŞ konteyner deseni ("...ssr-entity"></div>", araya hiçbir şey enjekte edilmemiş) —
  # yalnızca "id=...">...<" gibi gevşek bir desen kullanmak img/div gibi HERHANGİ bir sonraki
  # etiketle de eşleşirdi (gerçek bulgu: ilk sürümde bu yüzden yanlış pozitif üretti).
  if [[ "$html" == *'<div id="ssr-entity-body" class="ssr-entity"></div>'* ]]; then
    bad "$path — #ssr-entity-body BOŞ (SSR body içeriği enjekte edilmemiş — P1 regresyonu!)"
  elif [[ "$html" == *'id="ssr-entity-body"'* ]]; then
    ok "$path — #ssr-entity-body dolu (SSR body içeriği mevcut)"
  else
    bad "$path — #ssr-entity-body konteyneri hiç yok (şablon değişmiş olabilir)"
  fi
  if [[ "$html" == *'application/ld+json'* ]]; then
    ok "$path — JSON-LD mevcut"
  else
    bad "$path — JSON-LD EKSİK"
  fi
  # P3-4 hardening: önce attribute SIRASINDAN BAĞIMSIZ olarak TÜM <link id="canonical-link" ...> tag'ini
  # çek (eski regex href'in id'den ÖNCE gelmesini şart koşuyordu — kalıp değişirse sessizce warn'a
  # düşüyordu). Sonra o tag'in İÇİNDEN href değerini ayrıca parse et. Üç durum da artık KESİN sonuçlanır
  # (görev metninin istediği gibi): doğru → PASS, yanlış değer → FAIL, hiç yok → FAIL.
  canonical_tag=$(echo "$html" | grep -oE '<link[^>]*id="canonical-link"[^>]*>' | head -1)
  if [ -z "$canonical_tag" ]; then
    bad "$path — canonical-link tag'i hiç yok"
  else
    canonical_href=$(echo "$canonical_tag" | grep -oE 'href="[^"]*"' | head -1 | sed -E 's/^href="//; s/"$//')
    expected_href="https://mimarlab.com/$prefix/$slug"
    if [ "$canonical_href" = "$expected_href" ]; then
      ok "$path — canonical doğru ($expected_href)"
    else
      bad "$path — canonical yanlış: bulunan '$canonical_href', beklenen '$expected_href'"
    fi
  fi
done

echo ""
echo "3) SEO temelleri"
check_status "/sitemap.xml" 200
check_status "/robots.txt" 200

echo ""
echo "4) Güvenlik başlıkları (anasayfa)"
home_headers=$(curl -s -D - -o /dev/null "$BASE_URL/")
for h in "Content-Security-Policy" "X-Content-Type-Options" "X-Frame-Options" "Strict-Transport-Security"; do
  if grep -qi "^$h:" <<< "$home_headers"; then
    ok "$h mevcut"
  else
    bad "$h EKSİK"
  fi
done

echo ""
echo "5) Migration Conflicts admin gate (P1 düzeltmesi regresyon koruması)"
check_status "/api/admin/migration-conflicts" 401

echo ""
if [ "$fail" -eq 1 ]; then
  echo "Smoke test BAŞARISIZ oldu." >&2
  exit 1
fi
if [ "$warn" -eq 1 ]; then
  echo "Smoke test UYARILARLA geçti (kritik değil)."
  exit 0
fi
echo "Smoke test geçti."

# NOT: bu betik yalnızca HTTP/curl tabanlı, salt-okunur kontroller yapar. Tarayıcı console hatalarını
# (ör. "cdnSrcset is not defined" sınıfı JS ReferenceError'ları) veya hydration-sonrası davranışı
# YAKALAYAMAZ — bu, gerçek bir JS motoru çalıştırmayı gerektirir (headless tarayıcı). Bu repo hiç npm
# bağımlılığı taşımadığından (bkz. audit — package.json yok) Playwright/Puppeteer gibi ağır bir
# bağımlılık BİLEREK eklenmedi (kullanıcı isteği: "gereksiz ağır dependency ekleme"). Deploy sonrası
# anasayfa/detay sayfalarını gerçek bir tarayıcıda bir kez gözle kontrol etmek hâlâ önerilir.
