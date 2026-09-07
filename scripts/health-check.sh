#!/bin/bash
# Faz 4D — deploy.sh sonrası otomatik sentetik doğrulama. Yalnızca canlı (production) mimarlab.com
# üzerinde salt-okunur GET istekleri yapar, herhangi bir veri değiştirmez. deploy.sh, `wrangler
# deploy` çıktısından ayrıştırdığı Version ID'yi $1 olarak geçer (opsiyonel — elle çalıştırılırsa
# version karşılaştırması atlanır, yalnızca bilgi olarak yazdırılır).
set -uo pipefail
cd "$(dirname "$0")/.."

BASE_URL="https://mimarlab.com"
EXPECTED_VERSION="${1:-}"
fail=0

check_status() {
  local path="$1" expected="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$path")
  if [ "$code" != "$expected" ]; then
    echo "  BAŞARISIZ: $path -> $code (beklenen $expected)" >&2
    fail=1
  else
    echo "  OK: $path -> $code"
  fi
}

echo "Sağlık kontrolü başlıyor: $BASE_URL"

echo "1) HTTP durum kontrolleri"
check_status "/" 200
check_status "/kisi" 200
check_status "/firma" 200
check_status "/sitemap.xml" 200

echo "2) Güvenlik/cache header kontrolleri (anasayfa)"
home_headers=$(curl -s -D - -o /dev/null "$BASE_URL/")
for h in "Content-Security-Policy" "X-Content-Type-Options" "Strict-Transport-Security"; do
  if echo "$home_headers" | grep -qi "^$h:"; then
    echo "  OK: $h header mevcut"
  else
    echo "  BAŞARISIZ: $h header eksik" >&2
    fail=1
  fi
done
# P3-3 hardening: yalnızca VARLIĞI değil, TAM DEĞERİ doğrulanır — SSR_PAGE_CACHE_HEADERS (src/index.js)
# ile aynı olmalı. "private, no-store" (yanlışlıkla admin/no-cache header'ı sızması) ya da farklı bir
# max-age (ör. "max-age=14400") gibi regresyonları yakalamak için (görev metninin istediği gibi).
EXPECTED_CACHE_CONTROL="public, max-age=60, s-maxage=300"
home_cache_control=$(echo "$home_headers" | grep -i "^Cache-Control:" | head -1 | sed -E 's/^[Cc]ache-[Cc]ontrol:[[:space:]]*//' | tr -d '\r')
if [ "$home_cache_control" = "$EXPECTED_CACHE_CONTROL" ]; then
  echo "  OK: Cache-Control tam değeri doğru ($EXPECTED_CACHE_CONTROL)"
else
  echo "  BAŞARISIZ: Cache-Control beklenmedik — bulunan: '$home_cache_control', beklenen: '$EXPECTED_CACHE_CONTROL'" >&2
  fail=1
fi

echo "3) API JSON şema + ETag + Cache-Control kontrolü (/api/projects?limit=1)"
tmp_body="$(mktemp)"
api_headers=$(curl -s -D - -o "$tmp_body" "$BASE_URL/api/projects?limit=1")
projects_json=$(cat "$tmp_body")
rm -f "$tmp_body"
if echo "$projects_json" | jq -e '.items and (.items | type == "array")' >/dev/null 2>&1; then
  echo "  OK: /api/projects yanıtı beklenen şekle (items[]) sahip"
else
  echo "  BAŞARISIZ: /api/projects yanıtı beklenen şekilde değil: $projects_json" >&2
  fail=1
fi
if echo "$api_headers" | grep -qi "^ETag:"; then
  echo "  OK: ETag header mevcut (/api/projects)"
else
  echo "  BAŞARISIZ: ETag header eksik (/api/projects)" >&2
  fail=1
fi
# P3-3 hardening: liste uçları PUBLIC_LIST_CACHE_HEADERS kullanır (src/lib/publicCache.js) — anasayfa
# SSR ile AYNI değer, tam eşitlik doğrulanır (bkz. yukarıdaki anasayfa kontrolü ile aynı gerekçe).
api_cache_control=$(echo "$api_headers" | grep -i "^Cache-Control:" | head -1 | sed -E 's/^[Cc]ache-[Cc]ontrol:[[:space:]]*//' | tr -d '\r')
if [ "$api_cache_control" = "$EXPECTED_CACHE_CONTROL" ]; then
  echo "  OK: Cache-Control tam değeri doğru (/api/projects, $EXPECTED_CACHE_CONTROL)"
else
  echo "  BAŞARISIZ: Cache-Control beklenmedik (/api/projects) — bulunan: '$api_cache_control', beklenen: '$EXPECTED_CACHE_CONTROL'" >&2
  fail=1
fi

echo "4) Deploy edilen worker_version teyidi (/api/_health)"
# Deploy hemen sonrası tüm Cloudflare PoP'ları aynı anda güncellenmeyebilir (edge propagation
# gecikmesi, gerçekte gözlemlendi) — version uyuşmazlığında birkaç saniye arayla birkaç kez dener.
deployed_version=""
for attempt in 1 2 3 4 5; do
  health_json=$(curl -s "$BASE_URL/api/_health")
  deployed_version=$(echo "$health_json" | jq -r '.version.id // empty')
  if [ -z "$EXPECTED_VERSION" ] || [ "$deployed_version" = "$EXPECTED_VERSION" ]; then
    break
  fi
  echo "  ...deneme $attempt/5: canlıdaki version ($deployed_version) henüz beklenenle ($EXPECTED_VERSION) eşleşmiyor, edge propagation olabilir, 5sn bekleniyor"
  sleep 5
done
if [ -z "$deployed_version" ]; then
  echo "  UYARI: /api/_health version bilgisi döndürmedi: $health_json" >&2
elif [ -n "$EXPECTED_VERSION" ] && [ "$deployed_version" != "$EXPECTED_VERSION" ]; then
  echo "  BAŞARISIZ: canlıdaki version ($deployed_version) deploy edilen version ($EXPECTED_VERSION) ile eşleşmiyor" >&2
  fail=1
else
  echo "  OK: canlı worker_version = $deployed_version"
fi

# Zone-geneli önbellek temizliği (production audit 2026-09-01, madde E) — YALNIZCA bilgi amaçlı,
# BAŞARISIZLIK SAYILMAZ: kod, CF_ZONE_ID + CF_PURGE_TOKEN secret'ları yokken de tamamen çalışır
# (purge sessizce atlanır, mevcut s-maxage tabanlı tazelik davranışı korunur). Bu satır yalnızca
# "secret'ları eklemeyi unuttum mu?" sorusunun cevabını her deploy'da görünür kılar.
purge_ready=$(echo "$health_json" | jq -r '.globalCachePurge // false')
if [ "$purge_ready" = "true" ]; then
  echo "  OK: zone-geneli önbellek temizliği ETKİN (CF_ZONE_ID + CF_PURGE_TOKEN tanımlı)"
else
  echo "  BİLGİ: zone-geneli önbellek temizliği KAPALI — etkinleştirmek için:"
  echo "         npx wrangler secret put CF_ZONE_ID      (Cloudflare > mimarlab.com > Zone ID)"
  echo "         npx wrangler secret put CF_PURGE_TOKEN  (API token, izin: Zone > Cache Purge > Purge)"
  echo "         Kapalıyken site normal çalışır; yalnızca admin değişikliği diğer PoP'larda"
  echo "         s-maxage (en fazla 5 dk) kadar geç görünebilir."
fi

echo "5) GÜNDEM otomatik toplama hattının TAZELİĞİ"
# Production denetimi (2026-09-07) — bu kontrol, canlıda BİR KEZ GERÇEKLEŞMİŞ bir sessiz bozulma
# sınıfı içindir (bkz. commit 1ff0e1b7): publishCandidate içindeki bir ReferenceError yüzünden her
# yayın denemesi düşüyor, hat SIFIR içerik üretiyordu — ama kaynak sağlığı tablosu 13/13 "başarılı"
# gösterdiğinden hiçbir sinyal yoktu. Feed'ler okunuyordu, yalnızca hiçbir şey yayınlanmıyordu.
# En üstteki kaydın yaşına bakmak bu sınıfın TAMAMINI yakalar: hangi adımda kırılırsa kırılsın
# (feed, AI, kalite kapısı, D1 yazımı) sonuç aynıdır — yeni kayıt gelmez.
#
# EŞİK 30 SAAT: cron ızgarası TR saatiyle 4 saatte bir (bkz. wrangler.jsonc#triggers.crons). Tek bir
# turun yayın üretmemesi NORMALDİR (mükerrer/görselsiz/proje içeriği elenmiş olabilir), bu yüzden
# eşik tek tura göre değil, arka arkaya ~7 tura göre seçildi — böylece kontrol gerçek bir bozulmayı
# gösterir, gündelik dalgalanmada gürültü yapmaz. Yeni bir kaynak eklerken/kaynaklar toptan
# kapatılırken bu satır BEKLENEN şekilde uyarır.
#
# UYARIDIR, BAŞARISIZLIK DEĞİL: Gündem'in bayatlaması sitenin geri kalanını etkilemez ve deploy'u
# geri almak için bir gerekçe olmamalıdır (deploy.sh bu betiğin çıkış kodunu okur).
GUNDEM_STALE_HOURS=30
gundem_json=$(curl -s "$BASE_URL/api/gundem?limit=1")
gundem_published_at=$(echo "$gundem_json" | jq -r '.items[0].publishedAt // empty')
if [ -z "$gundem_published_at" ]; then
  echo "  UYARI: /api/gundem en üstteki kaydı okunamadı (uç bozuk ya da liste tamamen boş)" >&2
else
  now_ms=$(( $(date +%s) * 1000 ))
  age_h=$(( (now_ms - gundem_published_at) / 3600000 ))
  if [ "$age_h" -gt "$GUNDEM_STALE_HOURS" ]; then
    echo "  UYARI: Gündem'in en yeni kaydı $age_h saatlik (eşik ${GUNDEM_STALE_HOURS}s) — toplama hattı" >&2
    echo "         sessizce içerik üretmiyor olabilir. Teşhis: npx wrangler tail --format=pretty ile" >&2
    echo "         bir sonraki cron turunun 'gundem_run' satırına bakın (published/skipped alanları)." >&2
  else
    echo "  OK: Gündem'in en yeni kaydı $age_h saatlik (eşik ${GUNDEM_STALE_HOURS}s)"
  fi
fi

if [ "$fail" -eq 1 ]; then
  echo "Sağlık kontrolü BAŞARISIZ oldu." >&2
  exit 1
fi
echo "Sağlık kontrolü geçti."
