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
check_status "/mimar" 200
check_status "/firma" 200
check_status "/sitemap.xml" 200

echo "2) Güvenlik/cache header kontrolleri (anasayfa)"
home_headers=$(curl -s -D - -o /dev/null "$BASE_URL/")
for h in "Cache-Control" "Content-Security-Policy" "X-Content-Type-Options" "Strict-Transport-Security"; do
  if echo "$home_headers" | grep -qi "^$h:"; then
    echo "  OK: $h header mevcut"
  else
    echo "  BAŞARISIZ: $h header eksik" >&2
    fail=1
  fi
done

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
for h in "ETag" "Cache-Control"; do
  if echo "$api_headers" | grep -qi "^$h:"; then
    echo "  OK: $h header mevcut (/api/projects)"
  else
    echo "  BAŞARISIZ: $h header eksik (/api/projects)" >&2
    fail=1
  fi
done

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

if [ "$fail" -eq 1 ]; then
  echo "Sağlık kontrolü BAŞARISIZ oldu." >&2
  exit 1
fi
echo "Sağlık kontrolü geçti."
