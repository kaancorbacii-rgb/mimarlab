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

echo "3z) Hub kabuğu önbelleği (src/index.js#serveHubListPage) — X-ML-Shell-Cache + gömülü SSR verisi"
# Kullanıcı isteği 2026-09-10: hub HTML'i her istekte yeniden kuruluyordu; artık kabuk Cache API'de,
# SSR verisi önbelleğin dışında her yanıta eklenir. Başlık HIT|MISS olmalı ve gövde #ml-list-data
# taşımalı (veri kabuktan bağımsız geldiğinden HIT'te de bulunmalı).
for hub in /kisi /proje; do
  curl -s -o /dev/null "$BASE_URL$hub" >/dev/null
  hub_hdr=$(curl -s -D - -o /tmp/hc_hub_body.html "$BASE_URL$hub" | tr -d '\r' | grep -i '^x-ml-shell-cache:' | awk '{print $2}')
  if [ "$hub_hdr" != "HIT" ] && [ "$hub_hdr" != "MISS" ]; then
    echo "  BAŞARISIZ: $hub -> X-ML-Shell-Cache yok ('$hub_hdr') — serveHubListPage devrede değil" >&2; fail=1
  elif ! grep -q 'id="ml-list-data"' /tmp/hc_hub_body.html; then
    echo "  BAŞARISIZ: $hub -> kabuk $hub_hdr ama #ml-list-data yok (SSR verisi önbelleğin dışında eklenmeliydi)" >&2; fail=1
  else
    echo "  OK: $hub -> kabuk $hub_hdr + #ml-list-data gömülü"
  fi
done
rm -f /tmp/hc_hub_body.html

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

echo ""
echo "4b) ml-asset-version meta etiketi worker_version ile hizalı mı (src/index.js#deployVersion)"
# GERÇEK BULGU (2026-09-09): bu meta etiket (bkz. js/components/lazy-modals.js#ASSET_VERSION), lazy
# yüklenen modal script'lerine (modal-shell.js, architect-modal.js vb.) eklenen ?v= sürümünün TEK
# kaynağıdır ve bu URL'ler `immutable` (1 yıl) önbelleklenir. Eskiden ayrı bir DEPLOY_VERSION --var
# enjeksiyonuna dayanıyordu; paylaşılan .git dizinini kullanan başka bir worktree'den gelen bir
# --var'sız (çıplak) `wrangler deploy` bu var'ı sessizce silip meta'yı SSR_CACHE_VERSION sabitine
# düşürüyordu — kod sunucuda güncel olsa bile ziyaretçiler eski JS'i immutable önbellekten görmeye
# devam ediyordu (üstteki worker_version teyidi bunu YAKALAMAZ, çünkü o kontrol deploy'un HEMEN
# ardından çalışır; asıl olay SAATLER SONRA başka bir deploy'la gerçekleşiyordu). deployVersion() artık
# birincil kaynak olarak env.CF_VERSION_METADATA.id'yi kullanıyor (her deploy'da otomatik, --var'a
# bağlı değil) — bu kontrol meta etiketin GERÇEKTEN o değeri taşıdığını doğrular.
asset_version=$(curl -s "$BASE_URL/" | grep -oE '<meta name="ml-asset-version" content="[^"]*"' | sed -E 's/.*content="([^"]*)"/\1/')
if [ -z "$asset_version" ]; then
  echo "  UYARI: ml-asset-version meta etiketi bulunamadı (HTMLRewriter kancası kaldırılmış olabilir)" >&2
elif [ -n "$deployed_version" ] && [ "$asset_version" != "$deployed_version" ]; then
  echo "  BAŞARISIZ: ml-asset-version ($asset_version) canlı worker_version ($deployed_version) ile eşleşmiyor — lazy modal script'leri (modal-shell.js vb.) immutable önbellekte ESKİ KALABİLİR" >&2
  fail=1
else
  echo "  OK: ml-asset-version = $asset_version (worker_version ile hizalı)"
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

echo "5) GÜNDEM CRON sağlığı (/api/_health — YALNIZCA ingest_mode='cron' turları)"
# 2026-09-07 cron observability hardening. Bu bölümün önceki hâli /api/gundem'deki EN YENİ kayda
# bakıyordu — o kayıt bir geri doldurmadan (backfill) geliyorsa cron durmuş olsa bile "taze"
# diyordu (canlıda tam bu oldu: 17:34'te biten backfill, düzeltme sonrası hiç çalışmamış cron'u
# maskeleyebilirdi). Artık sinyal gundem_runs tablosundan, YALNIZCA cron satırlarından okunur
# (bkz. src/lib/gundemRuns.js). Backfill bu bölümü hiçbir koşulda etkilemez.
#
# AYRIM (kullanıcı isteği): "CRON RUN GERÇEKLEŞMEDİ" ≠ "CRON RUN GERÇEKLEŞTİ AMA 0 İÇERİK".
# İkincisi failure DEĞİLDİR — her aday mükerrer/kalite reddi olabilir. Yalnızca tur yokluğu,
# istisna, kill switch ve pipeline anomalisi (publish_failed vb.) uyarı üretir.
#
# EŞİK 30 SAAT: cron TR saatiyle 4 saatte bir; 30 saat ≈ arka arkaya 7 kaçırılmış tur.
# UYARIDIR, BAŞARISIZLIK DEĞİL (önceki gerekçe aynen geçerli): Gündem'in durması sitenin geri
# kalanını etkilemez, deploy'u geri almak için gerekçe olmamalı — ama stderr'e açıkça yazılır.
GUNDEM_CRON_STALE_HOURS=30
cron_status=$(echo "$health_json" | jq -r '.gundemCronStatus // "missing"')
cron_last=$(echo "$health_json" | jq -r '.gundemLastCronRun // empty')
cron_age_s=$(echo "$health_json" | jq -r '.gundemLastCronRunAge // empty')
cron_published=$(echo "$health_json" | jq -r '.gundemLastCronPublished // 0')
cron_failed=$(echo "$health_json" | jq -r '.gundemLastCronPublishFailed // 0')
cron_anoms=$(echo "$health_json" | jq -r '(.gundemLastCronAnomalies // []) | join(",")')
cron_age_h=$(( ${cron_age_s:-0} / 3600 ))
case "$cron_status" in
  ok)
    echo "  OK: son cron turu $cron_age_h saat önce ($cron_last) — $cron_published içerik yayınladı" ;;
  ok_no_content)
    echo "  OK: son cron turu $cron_age_h saat önce ($cron_last) — ÇALIŞTI, 0 içerik yayınladı (normal olabilir: mükerrer/kalite reddi)" ;;
  stale)
    echo "  UYARI: CRON RUN GERÇEKLEŞMEDİ — son cron turu $cron_age_h saat önce ($cron_last), eşik ${GUNDEM_CRON_STALE_HOURS}s." >&2
    echo "         Teşhis: Cloudflare > Workers > mimarlab > Triggers (cron aktif mi?) ve \`npx wrangler tail --status=error\`." >&2 ;;
  no_run)
    echo "  UYARI: gundem_runs'ta hiç cron turu YOK. Migration 0103 yeni uygulandıysa ilk turu bekleyin (4 saat);" >&2
    echo "         aksi halde cron hiç tetiklenmiyor demektir — Triggers panelini kontrol edin." >&2 ;;
  failed)
    echo "  UYARI: son cron turu ($cron_last) İSTİSNAYLA bitti: $(echo "$health_json" | jq -r '.gundemLastCronError // "?"' 2>/dev/null)" >&2 ;;
  disabled)
    echo "  UYARI: son cron turu ($cron_last) devre dışı çalıştı (kill switch kapalı ya da AI binding yok) — bilinçliyse sorun değil." >&2 ;;
  anomaly)
    echo "  UYARI: CRON ÇALIŞTI ($cron_last) ama pipeline anomalisi var: [$cron_anoms] publish_failed=$cron_failed published=$cron_published" >&2
    echo "         Bu, 1ff0e1b7 sınıfı sessiz bozulmanın imzasıdır. Teşhis: \`npx wrangler tail --status=error\` -> gundem_run satırı." >&2 ;;
  read_error)
    echo "  UYARI: /api/_health gundem_runs tablosunu okuyamadı (migration 0103 uygulanmamış olabilir)." >&2 ;;
  *)
    echo "  UYARI: /api/_health cron alanlarını döndürmedi (gundemCronStatus='$cron_status') — eski worker sürümü?" >&2 ;;
esac
# Bilgi satırı — SAĞLIK SİNYALİ DEĞİL (backfill dahil): yalnızca yayın tazeliğini gösterir.
gundem_published_at=$(curl -s "$BASE_URL/api/gundem?limit=1" | jq -r '.items[0].publishedAt // empty')
if [ -n "$gundem_published_at" ]; then
  echo "  BİLGİ: en yeni Gündem kaydı $(( ( $(date +%s)*1000 - gundem_published_at ) / 3600000 )) saatlik (backfill dahil — sağlık sinyali değil)"
fi

if [ "$fail" -eq 1 ]; then
  echo "Sağlık kontrolü BAŞARISIZ oldu." >&2
  exit 1
fi
echo "Sağlık kontrolü geçti."
