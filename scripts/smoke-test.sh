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
detail_prefix_for() { case "$1" in project) echo proje;; architect) echo kisi;; firm) echo firma;; product) echo urun;; esac; }

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

# ------------------------------------------------------------------------------------------------
# Aşağıdakiler production audit'te (2026-09-03) BULUNAN VE DÜZELTİLEN dört hatanın regresyon
# korumasıdır. Dördü de canlıda gerçekten kırıktı; bu kontroller olmadan sessizce geri gelebilirler.
# ------------------------------------------------------------------------------------------------
echo ""
echo "6) Tekil detay uçlarının soft-404'ü (publicCache.js#statusFor regresyon koruması)"
# Bulgu: cachedPublicJson'ın CACHE'LENEBİLİR dalı durum kodunu SABİT 200 yazıyordu — detay uçları
# 2026-08-25'te cacheable yapıldığında statusFor() bypass edildi ve var olmayan HER slug 200 döndü.
for ep in "/api/project" "/api/architect" "/api/office" "/api/product"; do
  check_status "$ep/bu-kayit-kesinlikle-yok-smoke-test" 404
done

echo ""
echo "7) Hesap/oturum yollarında noindex (src/index.js#AUTH_MODAL_META regresyon koruması)"
# Bulgu: /giris, /uye-ol, /hesabim ... ana sayfanın gövdesini robots etiketi OLMADAN döndürüyordu;
# /giris ile /uye-ol sitedeki her sayfanın footer'ında gerçek <a href> — yani indexlenebilir
# duplicate'lardı. Kaynak kodda AKSİ İDDİA EDİLEN bir yorum vardı, bu yüzden kontrol canlıya bakar.
for p in "/giris" "/uye-ol" "/hesabim" "/aktivitelerim" "/iceriklerim" "/koleksiyonum" "/sifremi-unuttum"; do
  page_html=$(curl -s "$BASE_URL$p")
  if [[ "$page_html" == *'name="robots" content="noindex'* ]]; then ok "$p noindex taşıyor"; else bad "$p noindex TAŞIMIYOR (ana sayfa duplicate'i indexlenebilir)"; fi
done
# Ters kontrol: indexlenmesi GEREKEN sayfalar yanlışlıkla noindex almasın.
for p in "/" "/iletisim" "/hakkinda"; do
  page_html=$(curl -s "$BASE_URL$p")
  if [[ "$page_html" == *'name="robots" content="noindex'* ]]; then bad "$p YANLIŞLIKLA noindex aldı"; else ok "$p indexlenebilir kaldı"; fi
done

echo ""
echo "8) /media/_derived/.../s/ statik kaynak kısıtı (upload.js#DERIVED_STATIC_IMAGE_RE koruması)"
# Bulgu: "s" (statik varlık) türev kaynağı çözülmüş yolu doğrudan ASSETS.fetch'e veriyordu; URL
# nesnesi nokta segmentlerini normalize ettiğinden /media/ altından KEYFİ bir statik varlık
# (ör. admin.html'in tam HTML'i) 200 ile servis edilebiliyordu.
# Sorgu dizesi bir CACHE BUSTER'dır, kontrolün kendisinin parçası değil: handleMediaRoute'un
# caches.default anahtarı TAM URL'dir (bkz. o dosyadaki `new Request(url.toString())`) ama R2/asset
# aramasında kullanılan `key` yalnızca pathname'den türer — yani ?cb=... anahtarı ayrıştırır,
# davranışı DEĞİŞTİRMEZ. Buna ihtiyaç var çünkü bu yolun eski (düzeltme öncesi) 200 yanıtı edge'de
# 1 saat (DERIVED_FALLBACK_EDGE_MAX_AGE_SECONDS) yaşayabiliyor ve cache HIT, kontrolden ÖNCE
# kısa devre yapıyor — test kodu doğrulamalı, bayat bir edge girdisini değil.
cb="cb=$$-$(date +%s)"
check_status "/media/_derived/w400/s/..%2F..%2Fadmin.html?$cb" 404
check_status "/media/_derived/w400/s/..%252F..%252Fadmin.html?$cb" 404
check_status "/media/_derived/w400/s/admin.html?$cb" 404

echo ""
echo "9) Proje JSON-LD entity grafiği (seo.js#creator url regresyon koruması)"
# Bulgu: creator düğümleri yalnızca `name` taşıyordu; slug'lar AYNI sorguda zaten mevcuttu ama
# kullanılmıyordu, dolayısıyla Google projeyi mimar/firma sayfasıyla aynı varlık sayamıyordu.
# İKİ AYRI şeyi doğrular ve bu ayrım ŞART (ilk sürümde yapılmadığı için canlıda yanlış pozitif
# verdi): (a) künyesi olan HER projede `creator` düğümü ÜRETİLİYOR mu — bu, project_designers'a
# bağlanamamış serbest metin künyelerin (188 proje) fallback'ini korur; (b) künyesi canonical bir
# mimar/firma kaydına BAĞLI olan projelerde creator `url` taşıyor mu — bu, entity grafiği
# düzeltmesini korur. Bir projenin creator'ında url OLMAMASI tek başına hata DEĞİLDİR (kayıtsız
# künye) — bu yüzden url'li bir örnek bulana kadar birkaç proje taranır.
# "https://mimarlab.com/kisi/" ve "https://mimarlab.com/firma/" MUTLAK biçimleri bir PROJE
# sayfasında YALNIZCA JSON-LD creator[].url'den gelir — SSR gövdesindeki mimar/firma bağlantıları
# göreli href kullanır (bkz. src/lib/seo.js#internalLink), canonical/og:url ise /proje/ önekli.
# Bu yüzden düz bir alt dize kontrolü yeterli ve taşınabilir (macOS bash 3.2 + BRE farkları
# nedeniyle ilk sürümdeki `grep '.\{0,600\}'` yaklaşımı bu ortamda hata veriyordu).
# limit=30: liste en yeniden eskiye sıralı ve en yeni gönderiler ağırlıkla serbest metin künyeli
# olabiliyor (canlıda ilk 10'un tamamı öyleydi) — canonical kayda bağlı bir örnek bulmak için
# daha geniş bir pencere gerekiyor.
project_slugs=$(curl -s "$BASE_URL/api/projects?limit=30" | tr ',' '\n' | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p')
creator_seen=0; creator_url_seen=0; seen_slug=""; url_slug=""
for s in $project_slugs; do
  [ -n "$s" ] || continue
  proj_html=$(curl -s "$BASE_URL/proje/$s")
  case "$proj_html" in *'"creator"'*) if [ "$creator_seen" -eq 0 ]; then creator_seen=1; seen_slug="$s"; fi ;; esac
  case "$proj_html" in
    *'https://mimarlab.com/kisi/'*|*'https://mimarlab.com/firma/'*) creator_url_seen=1; url_slug="$s"; break ;;
  esac
done
if [ "$creator_seen" -eq 1 ]; then ok "proje JSON-LD'sinde creator düğümü üretiliyor (ör. /proje/$seen_slug)"; else bad "taranan projelerin HİÇBİRİNDE JSON-LD creator yok (künye fallback'i kırılmış olabilir)"; fi
if [ "$creator_url_seen" -eq 1 ]; then ok "kayıtlı künyeli projede creator url taşıyor (/proje/$url_slug)"; else bad "taranan projelerin hiçbirinde creator url'i yok (entity grafiği düzeltmesi kırılmış olabilir)"; fi

echo ""
echo "10) /favicon.ico (denetim 2026-09-05: canlıda 404'tü — src/index.js#routeAsset iç yeniden yazması)"
# Site sayfaları ikonu <link rel="icon"> ile bildiriyor, ama Worker'ın kendi ürettiği sayfalar
# (notFoundPageResponse/maintenanceResponse) ve ikonu yalnızca kök yoldan arayan istemciler
# /favicon.ico'yu ister. 200 VE bir image/* Content-Type'ı bekliyoruz (yönlendirme değil).
favicon_headers=$(curl -s -D- -o /dev/null "$BASE_URL/favicon.ico")
case "$favicon_headers" in
  *"200"*) case "$favicon_headers" in
             *[Ii]mage/*) ok "/favicon.ico -> 200, image/* Content-Type" ;;
             *) bad "/favicon.ico 200 döndü ama Content-Type image/* değil" ;;
           esac ;;
  *) bad "/favicon.ico 200 dönmüyor (kök favicon route'u kırılmış olabilir)" ;;
esac

echo ""
echo "11) Bilgi sayfalarının kendi H1'i (denetim 2026-09-05: INFO_MODAL_META#h1 regresyon koruması)"
# Bu 5 URL noindex DEĞİL ve sitemap'te — ham HTML'lerinde ana sayfanın H1'ini döndürüyorlardı
# (bkz. src/index.js#INFO_MODAL_META'daki h1 notu). Ana sayfanın H1'inin bu yollarda ARTIK
# görünmemesi ve her sayfanın kendi başlığını taşıması beklenir.
for pair in "/hakkinda:Hakkında" "/iletisim:İletişim" "/gizlilik-politikasi:Gizlilik Politikası" "/hizmet-sartlari:Hizmet Şartları" "/cerez-politikasi:Çerez Politikası"; do
  info_path="${pair%%:*}"; want_h1="${pair#*:}"
  # Tek satıra indirgeyip <h1 id="entity-h1"> ... </h1> arasını al (macOS sed/bash 3.2 uyumlu).
  info_h1=$(curl -s "$BASE_URL$info_path" | tr -d '\n' | sed -n 's/.*<h1 id="entity-h1">\([^<]*\)<.*/\1/p')
  case "$info_h1" in
    "$want_h1") ok "$info_path — H1 kendi başlığını taşıyor (\"$info_h1\")" ;;
    *"Gelişmiş"*) bad "$info_path — H1 hâlâ ana sayfanınki (\"$info_h1\"); INFO_MODAL_META#h1 enjeksiyonu çalışmıyor" ;;
    "") warnf "$info_path — H1 okunamadı (index.html#entity-h1 kancası kaldırılmış olabilir)" ;;
    *) bad "$info_path — beklenmeyen H1: \"$info_h1\" (beklenen \"$want_h1\")" ;;
  esac
done

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
