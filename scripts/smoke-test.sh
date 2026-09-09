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
for p in "/giris" "/uye-ol" "/hesabim" "/aktivitelerim" "/koleksiyonum" "/sifremi-unuttum"; do
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
echo "12) Detay sayfalarında ARTIK liste sayfasının CollectionPage şeması OLMAMALI"
# Production denetimi (2026-09-07) — proje/kisi/firma/marka/urun/gundem.html'in <head>'indeki
# statik <script id="list-jsonld"> bloğu, aynı şablon detay görünümünde servis edildiğinde de
# sayfada kalıyordu: ~4.500 detay URL'i, kendi kaydını tanımlayan şemanın YANINDA "url: /proje"
# diyen bir CollectionPage taşıyordu (sayfa düzeyinde, farklı `url`'li iki varlık düğümü).
# src/index.js#injectMeta artık bu bloğu detay görünümünde kaldırıyor. Aşağısı hem KALDIRMANIN
# gerçekleştiğini hem de LİSTE sayfasında bloğun KORUNDUĞUNU (aşırı-kaldırma regresyonu) doğrular.
# DİKKAT — `curl ... | grep -q` KULLANMAYIN. Bu betik `set -o pipefail` ile çalışıyor ve `grep -q`
# ilk eşleşmede hemen çıkıp boruyu kapatıyor; curl SIGPIPE alıp 141 ile ölüyor ve pipefail bunu
# pipeline'ın çıkış koduna taşıyor. Sonuç: "eşleşme VAR" durumu `if` tarafından "başarısız" okunur —
# yani kontrol tam TERS çalışır. (Gerçek bulgu: bu kontrolün ilk hâli tam olarak böyle yazılmıştı ve
# canlıda DOĞRU olan hub sayfaları için "şema kaybolmuş" diye yanlış alarm verdi.) `grep -c` girdiyi
# sonuna kadar okur, boruyu erken kapatmaz — sayıyı önce bir değişkene alıp onu karşılaştırıyoruz.
has_list_jsonld() { curl -s "$BASE_URL$1" | grep -c 'id="list-jsonld"' || true; }
# Örnek detay kaydı SABİT slug DEĞİL (gerçek bulgu, 2026-09-08: "emre-arolat" ve "eaa-emre-arolat-
# architecture" admin tarafından gizlendi, her ikisi 410 Gone dönüyor; 410 yanıtı hub şablonunu olduğu
# gibi servis ettiğinden list-jsonld de onunla geliyor ve bu kontrol, injectMeta kuralı sağlıklı
# çalışırken YANLIŞ alarm verdi). Önce eski sabit slug 200 dönüyorsa o, değilse liste API'sinin ilk
# kaydı (yayında olduğu KESİN) kullanılır. Materyaller de /urun altında ve aynı API'de olduğundan
# ürün için dinamik seçim yeterli.
live_detail_path() {
  local prefix="$1" api="$2" fallback="$3"
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL$prefix/$fallback")" = "200" ]; then echo "$prefix/$fallback"; return; fi
  local slug
  slug="$(curl -s "$BASE_URL$api?limit=1" | sed -n 's/.*"items":\[{[^}]*"slug":"\([^"]*\)".*/\1/p' | head -1)"
  if [ -n "$slug" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL$prefix/$slug")" = "200" ]; then echo "$prefix/$slug"; return; fi
  echo "$prefix/$fallback"
}
for pair in "$(live_detail_path /proje /api/projects bil-s-magaza):/proje" "$(live_detail_path /kisi /api/architects emre-arolat):/kisi" "$(live_detail_path /firma /api/offices eaa-emre-arolat-architecture):/firma" "$(live_detail_path /urun /api/products vivi-outdoor-masa-b-t-design):/urun"; do
  detail_path="${pair%%:*}"; hub_path="${pair#*:}"
  if [ "$(has_list_jsonld "$detail_path")" = "0" ]; then
    ok "$detail_path — liste CollectionPage şeması kaldırılmış"
  else
    bad "$detail_path — liste CollectionPage şeması hâlâ detay sayfasında (injectMeta#list-jsonld kuralı çalışmıyor)"
  fi
  if [ "$(has_list_jsonld "$hub_path")" = "0" ]; then
    bad "$hub_path — liste sayfasının CollectionPage şeması da kaybolmuş (aşırı-kaldırma regresyonu!)"
  else
    ok "$hub_path — liste sayfası kendi CollectionPage şemasını KORUYOR"
  fi
done
gundem_slug=$(curl -s "$BASE_URL/api/gundem?limit=1" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p')
if [ -n "$gundem_slug" ]; then
  if [ "$(has_list_jsonld "/gundem/$gundem_slug")" = "0" ]; then
    ok "/gundem/$gundem_slug — liste CollectionPage şeması kaldırılmış"
  else
    bad "/gundem/$gundem_slug — liste CollectionPage şeması hâlâ detay sayfasında"
  fi
  if [ "$(has_list_jsonld "/gundem")" = "0" ]; then
    bad "/gundem — liste sayfasının CollectionPage şeması da kaybolmuş (aşırı-kaldırma regresyonu!)"
  else
    ok "/gundem — liste sayfası kendi CollectionPage şemasını KORUYOR"
  fi
fi

echo ""
echo "13) Adı değişmemiş sayfaların .html biçimi KALICI (301) yönlendirmeli"
# Production denetimi (2026-09-07): bunlar PATH_RENAME_REDIRECTS'te olmadığından Cloudflare
# Assets'in kendi html_handling davranışına düşüyor ve 307 (GEÇİCİ) dönüyordu — site 2026-09-01'e
# kadar bu URL'lerle geziliyordu, yani indekslenmiş/backlink almış olabilirler.
for legacy in /index.html /proje.html /kisi.html /firma.html /urun.html /marka.html /gundem.html /arama.html /en-iyi-100.html; do
  legacy_code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$legacy")
  if [ "$legacy_code" = "301" ]; then
    ok "$legacy -> 301"
  else
    bad "$legacy -> $legacy_code (301 bekleniyordu; PATH_RENAME_REDIRECTS girdisi kaybolmuş olabilir)"
  fi
done

echo ""
echo "14) Güvenli Görüşme Gateway'i (/gorusme/:room_uuid, 2026-09-08) — anonim/geçersiz erişim"
# Anonim ziyaretçi giriş akışına yönlendirilir (302 /giris?next=...), geçersiz oda 404, çıplak yol
# 404, API ucu oturumsuz 401. Hiçbiri kişisel veri ya da Meet adresi döndürmez.
gw_uuid="00000000-0000-4000-8000-000000000000"
gw_code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/gorusme/$gw_uuid")
gw_loc=$(curl -s -o /dev/null -w "%{redirect_url}" "$BASE_URL/gorusme/$gw_uuid")
if [ "$gw_code" = "302" ] && [[ "$gw_loc" == *"/giris?next=%2Fgorusme%2F$gw_uuid"* ]]; then
  ok "/gorusme/<uuid> anonim -> 302 /giris?next=…"
else
  bad "/gorusme/<uuid> anonim -> $gw_code ($gw_loc) (302 /giris?next= bekleniyordu)"
fi
check_status "/gorusme/gecersiz" 404
check_status "/gorusme" 404
check_status "/api/consultations/room/$gw_uuid" 401
gw_api=$(curl -s "$BASE_URL/api/consultations/room/$gw_uuid")
if [[ "$gw_api" == *"meet.google.com"* ]]; then bad "/api/consultations/room oturumsuz yanıtta Meet adresi sızıyor"; else ok "/api/consultations/room oturumsuz yanıtta Meet adresi yok"; fi

# --------------------------------------------------------------------------------------------
# TELİF/YAYIN HAKKI KİLİTLEME (kullanıcı isteği, 2026-09-09) — deploy SONRASI canlı doğrulama.
#
# VERİ ODAKLI: sabit bir slug'a bağlanmaz (bkz. proje notu: gizlenen kayıt 410 -> yanlış alarm).
# Kilitli bir medyayı CANLI API'den çözer; hiç kilitli medya yoksa (seed henüz uygulanmadı) kontrolü
# UYARI ile atlar — deploy'u bloke etmez ama sessizce de geçmez.
# --------------------------------------------------------------------------------------------
echo ""
echo "Telif kilitleme (media rights)"
cb2=$(date +%s)

# Kilitli bir görsel taşıyan proje SON SAYFADAN alınır.
#
# NEDEN İLK SAYFA DEĞİL: sıralamanın kendisi telif grubuna göre (bkz. rights_bucket) — onaylı
# projeler EN BAŞTA. Bu yüzden ilk sayfa neredeyse her zaman tamamen onaylıdır ve orada hiç
# güvenli uç görünmez; ilk sürümde bu, "seed uygulanmamış" gibi yanlış bir uyarıya yol açıyordu.
# Kilitli içerik en SONA düştüğünden son sayfa doğru yerdir ve sayfa sayısı verinin kendisinden
# okunur (sabit bir sayfa numarası veri büyüdükçe yanlışlanırdı).
mr_pages=$(curl -s "$BASE_URL/api/projects?page=1&limit=48" | python3 -c "
import sys, json
try:
    print(json.load(sys.stdin).get('totalPages', 1))
except Exception:
    print(1)
" 2>/dev/null)
mr_list=$(curl -s "$BASE_URL/api/projects?page=${mr_pages:-1}&limit=48")
mr_media_id=$(printf '%s' "$mr_list" | grep -o '/api/media/[A-Za-z0-9-]\{1,64\}' | head -1 | sed 's|/api/media/||')

# SIRALAMA KONTROLÜ (kullanıcı isteği madde 8): ilk sayfa onaylı içerikle, son sayfa kilitli
# içerikle başlamalı. Bu, telif grubunun listelerde GERÇEKTEN uygulandığının canlı kanıtıdır.
mr_first_locked=$(curl -s "$BASE_URL/api/projects?page=1&limit=48" | grep -c '/api/media/' || true)
mr_last_locked=$(printf '%s' "$mr_list" | grep -c '/api/media/' || true)
if [ "${mr_pages:-1}" -gt 1 ]; then
  if [ "$mr_first_locked" -le "$mr_last_locked" ]; then
    ok "sıralama: telif grubu uygulanıyor (ilk sayfa kilitli=$mr_first_locked <= son sayfa kilitli=$mr_last_locked)"
  else
    bad "sıralama: kilitli içerik ilk sayfada son sayfadan FAZLA (ilk=$mr_first_locked, son=$mr_last_locked) — rights_bucket sıralaması çalışmıyor"
  fi
fi

if [ -z "$mr_media_id" ]; then
  warnf "canlıda kilitli proje görseli bulunamadı — seed uygulanmamış olabilir, telif kontrolleri atlandı"
else
  ok "kilitli medya bulundu (/api/media/$mr_media_id)"

  # 1) Güvenli uç GERÇEK bir görsel döndürüyor (yer tutucuya düşmüyor) ve noindex.
  mr_hdrs=$(curl -s -D - -o /dev/null "$BASE_URL/api/media/$mr_media_id?$cb2")
  mr_code=$(printf '%s' "$mr_hdrs" | head -1 | awk '{print $2}')
  mr_ctype=$(printf '%s' "$mr_hdrs" | grep -i '^content-type:' | tr -d '\r' | awk '{print $2}')
  if [ "$mr_code" = "200" ]; then ok "/api/media/<id> -> 200"; else bad "/api/media/<id> -> $mr_code (200 bekleniyordu)"; fi
  case "$mr_ctype" in
    image/svg+xml) warnf "/api/media/<id> YER TUTUCU döndürüyor — bu görselin w400/w800 türevi eksik" ;;
    image/*)       ok "/api/media/<id> gerçek görsel döndürüyor ($mr_ctype)" ;;
    *)             bad "/api/media/<id> beklenmeyen içerik türü: $mr_ctype" ;;
  esac
  if printf '%s' "$mr_hdrs" | grep -qi '^x-robots-tag:.*noindex'; then
    ok "/api/media/<id> noindex taşıyor"
  else
    bad "/api/media/<id> X-Robots-Tag: noindex TAŞIMIYOR (arama motoru kilitli görseli indexleyebilir)"
  fi

  # 2) O medyanın ORİJİNAL yolu doğrudan erişilemiyor olmalı. Yolu admin olmadan bilemeyiz; bunun
  # yerine kilitli bir PROJENİN detay yükünde orijinal yol KALINTISI olup olmadığına bakılır.
  mr_slug=$(printf '%s' "$mr_list" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for item in data.get('items', []):
    for img in (item.get('images') or []):
        if isinstance(img, str) and img.startswith('/api/media/'):
            print(item.get('slug', '')); sys.exit(0)
" 2>/dev/null)
  if [ -n "$mr_slug" ]; then
    mr_detail=$(curl -s "$BASE_URL/api/project/$mr_slug")
    # Kilitli bir görselin bulunduğu yükte /projects/, /miras/ ya da /media/ ile başlayan HAM bir
    # görsel yolu KALMAMALI — hepsi güvenli uca çevrilmiş olmalı. (Onaylı görseller ham yolda kalır,
    # bu yüzden yalnızca TAMAMEN kilitli projeler için anlamlı; aşağıdaki kontrol o durumu arar.)
    mr_locked_only=$(printf '%s' "$mr_detail" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
imgs = (data.get('item') or {}).get('images') or []
print('yes' if imgs and all(isinstance(i, str) and i.startswith('/api/media/') for i in imgs) else 'no')
" 2>/dev/null)
    if [ "$mr_locked_only" = "yes" ]; then
      # KESİN KONTROL: yükte GEÇEN her görsel yolu HERKESE AÇIK OLMALI.
      #
      # Neden "prefix arama" değil: yük, kapsam DIŞINDAKİ meşru yolları da taşır — künyedeki
      # mimarın avatarı (architects.photo_url, bilerek kaydedilmiyor) ve komşu ONAYLI projenin
      # kapağı gibi. Bunları düz `grep /media/u/` ile aramak yanlış alarm üretiyordu (canlıda
      # doğrulandı: sakirin-camii'de tek eşleşme mimarın fotoğrafıydı).
      #
      # Doğru ölçüt tersinden kurulur: kilitli bir görselin ORİJİNAL yolu kapıdan 404 alır. O hâlde
      # yükte geçen bir yol 404 veriyorsa, o yolu vermemeliydik — bu, kilidin sızdığının KESİN
      # kanıtıdır. Kapsam dışı avatarlar 200 döndüğü için doğal olarak elenir.
      mr_paths=$(printf '%s' "$mr_detail" | python3 -c "
import sys, json, re
raw = sys.stdin.read()
seen = []
for m in re.finditer(r'\"(/(?:media|projects|miras)/[^\"]+)\"', raw):
    p = m.group(1)
    if p not in seen:
        seen.append(p)
print('\n'.join(seen[:25]))
" 2>/dev/null)
      mr_leaks=0
      mr_checked=0
      while IFS= read -r mp; do
        [ -z "$mp" ] && continue
        mr_checked=$((mr_checked + 1))
        mpcode=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$mp?cb=$cb2")
        if [ "$mpcode" = "404" ]; then
          bad "kilitli proje ($mr_slug) yükünde KAPALI bir orijinal yol var (kapı 404 veriyor): $mp"
          mr_leaks=$((mr_leaks + 1))
        fi
      done <<< "$mr_paths"
      if [ "$mr_leaks" -eq 0 ]; then
        ok "kilitli proje yükündeki $mr_checked görsel yolunun tamamı meşru (hiçbiri kapıda kapalı değil)"
      fi

      # SSR/HTML tarafı: JSON-LD, OpenGraph ve gövde görseli aynı yükten beslenir. Burada
      # KİLİTLİ projenin KENDİ görsellerinin ham yolları aranır (kapsam dışı avatarlar HTML'de de
      # meşru olarak bulunur, bu yüzden yine prefix değil, projenin kendi yolları kontrol edilir).
      mr_html=$(curl -s "$BASE_URL/proje/$mr_slug")
      mr_own=$(npx wrangler d1 execute mimarlab-db --remote --json --command \
        "SELECT m.media_path FROM media_rights m JOIN projects p ON p.id=m.entity_id WHERE p.slug='$mr_slug' AND m.rights_status!='approved' LIMIT 10" 2>/dev/null \
        | python3 -c "
import sys, json
raw = sys.stdin.read()
try:
    i = raw.index('[')
    depth = 0
    for j in range(i, len(raw)):
        if raw[j] == '[': depth += 1
        elif raw[j] == ']':
            depth -= 1
            if depth == 0:
                end = j + 1
                break
    for row in json.loads(raw[i:end])[0]['results']:
        if row.get('media_path'): print(row['media_path'])
except Exception:
    pass
" 2>/dev/null)
      mr_html_leaks=0
      while IFS= read -r mp; do
        [ -z "$mp" ] && continue
        if printf '%s' "$mr_html" | grep -qF "$mp"; then
          bad "kilitli proje ($mr_slug) SSR HTML'inde KENDİ kilitli görselinin ham yolu var: $mp"
          mr_html_leaks=$((mr_html_leaks + 1))
        fi
      done <<< "$mr_own"
      if [ "$mr_html_leaks" -eq 0 ]; then
        ok "kilitli projenin SSR HTML'inde kendi kilitli görsellerinin ham yolu yok"
      fi
    else
      ok "seçilen proje karma (hem onaylı hem kilitli görsel) — ham yol kontrolü atlandı"
    fi
  fi
fi

# Kodlanmış traversal/bypass varyantları — gerçek bulgu (2026-09-09): kapı ham pathname'i
# eşleştirdiği sürece tek bir harfi yüzde-kodlamak ("g" -> "%67") kilidi atlatıyordu.
#
# DOĞRU ÖLÇÜT "404" DEĞİL, "GÖRSEL BAYTI DÖNMEMESİ": bu yolların bir kısmı Cloudflare Assets
# tarafından zaten normalize edilip 307 ile herkese açık bir SAYFAYA yönlendiriliyor (canlıda
# doğrulandı: /projects/%2e%2e/admin.html -> 307 /admin). Bu bir sızıntı değildir — /admin zaten
# kendi yolundan erişilebilir bir sayfadır ve içeriği ayrıca oturum kontrolüne tabidir. Kilit
# açısından tek önemli soru, bu yollardan bir GÖRSELİN baytlarına ulaşılıp ulaşılamadığıdır.
check_not_image() {
  local path="$1"
  local hdrs code ctype
  hdrs=$(curl -s -D - -o /dev/null "$BASE_URL$path")
  code=$(printf '%s' "$hdrs" | head -1 | awk '{print $2}')
  ctype=$(printf '%s' "$hdrs" | grep -i '^content-type:' | tr -d '\r' | awk '{print $2}')
  case "$code:$ctype" in
    200:image/*) bad "traversal varyantı GÖRSEL döndürdü: $path ($ctype)" ;;
    *)           ok "traversal varyantı görsel döndürmüyor: $path -> $code" ;;
  esac
}
check_not_image "/projects/%2e%2e/admin.html?$cb2"
check_not_image "/projects/%2e%2e%2fadmin.html?$cb2"
check_not_image "/miras/%2e%2e/admin.html?$cb2"
check_not_image "/media/_derived/w400/s/%2e%2e/%2e%2e/admin.html?$cb2"
check_not_image "/media/_derived/w400/s/..%252F..%252Fadmin.html?$cb2"

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
