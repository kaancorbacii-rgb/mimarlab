#!/bin/bash
# Guards against the miras/ asset-manifest wipe: miras/ is gitignored, so a git
# worktree that never had it rsynced in looks "empty" to wrangler and a deploy
# from there drops all miras/*.webp from the live asset manifest (every legacy
# project photo 404s). Always deploy through this script, not raw `wrangler deploy`.
set -eo pipefail
cd "$(dirname "$0")"

# EŞZAMANLI DEPLOY KİLİDİ (hardening denetimi, 2026-09-07).
# Aşağıdaki dal/working-tree kontrollerinin hepsi TEK BİR ANIN fotoğrafını çeker. İki deploy.sh
# aynı anda çalışırsa ikisi de kendi kontrollerinden geçer, sonra ikisi de `wrangler deploy`
# çalıştırır ve canlıya en SON bitenin kodu çıkar — hangisinin daha yeni olduğundan bağımsız.
# Bu teorik değil: 2026-09-07 denetimi sırasında dört dakika arayla (17:38 ve 17:42) bu oturumun
# dışından iki ayrı production deploy'u gözlendi ve depoda üç kardeş worktree var.
# Kilit, worktree'lerin PAYLAŞTIĞI git dizinine konur (git-common-dir), yani depo geneliNDEdir.
# `mkdir` bilerek seçildi: POSIX'te atomiktir (dosya oluşturmanın aksine "varsa başarısız ol"
# garantisi verir) ve `flock` macOS'ta yoktur.
LOCK_DIR="$(git rev-parse --git-common-dir 2>/dev/null || echo .git)/mimarlab-deploy.lock"
LOCK_STALE_SECONDS=1800
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  lock_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || echo '?')"
  # Bayat kilit temizliği: deploy'u yarıda kesilmiş (Ctrl+C/çökme) bir çalıştırma kilidi bırakmış
  # olabilir. Süreç ARTIK YAŞAMIYORSA ya da kilit çok eskiyse devral — aksi halde tek bir kaza
  # tüm deploy'ları kalıcı olarak bloke ederdi.
  lock_age=$(( $(date +%s) - $(stat -f %m "$LOCK_DIR" 2>/dev/null || stat -c %Y "$LOCK_DIR" 2>/dev/null || date +%s) ))
  if { [ "$lock_pid" != "?" ] && ! kill -0 "$lock_pid" 2>/dev/null; } || [ "$lock_age" -gt "$LOCK_STALE_SECONDS" ]; then
    echo "UYARI: bayat deploy kilidi devralınıyor (pid=$lock_pid, yaş=${lock_age}s)." >&2
    rm -rf "$LOCK_DIR"; mkdir "$LOCK_DIR" 2>/dev/null || { echo "DEPLOY DURDURULDU: kilit alınamadı." >&2; exit 1; }
  else
    echo "DEPLOY DURDURULDU: başka bir deploy.sh çalışıyor (pid=$lock_pid, yaş=${lock_age}s)." >&2
    echo "Aynı anda iki deploy, kontrollerini ayrı ayrı geçip birbirinin kodunu canlıdan silebilir." >&2
    echo "Diğer deploy bitince tekrar dene; gerçekten takıldıysa: rm -rf '$LOCK_DIR'" >&2
    exit 1
  fi
fi
echo $$ > "$LOCK_DIR/pid"
# Betik nasıl biterse bitsin (başarı, hata, Ctrl+C) kilit bırakılır — `set -e` altında da çalışır.
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
echo "Deploy kilidi alındı."

# VERİ-GÜVENLİĞİ KAPILARI (miras/ dolu mu · başka bir worktree'nin dalı ileride mi · working tree
# temiz mi) artık scripts/deploy-guard.sh'te TEK KAYNAK olarak duruyor ve AYNI betik wrangler'ın
# build hook'undan da çalışıyor (bkz. wrangler.jsonc#build.command) — böylece çıplak
# `npx wrangler deploy` de aynı kapılardan geçer. Kilit ALINDIKTAN SONRA çağrılır: kontroller ile
# deploy arasındaki pencerede başka bir deploy araya giremesin.
./scripts/deploy-guard.sh

# P2 hardening (denetim raporu, 2026-08-23) — "test → build/check → deploy → health check →
# smoke test" akışının İLK adımı: tamamen yerel/statik (ağ isteği yok, `wrangler dev` başlatmıyor)
# sözdizimi + P1 regresyon kontrolleri. Başarısız olursa deploy hiç BAŞLAMAZ (bkz. kullanıcı
# isteği: "test başarısızsa deploy durmalı").
echo ""
echo "Preflight kontrolü çalıştırılıyor (scripts/preflight-check.sh)..."
./scripts/preflight-check.sh
echo ""

# Faz 4D — wrangler'ın stdout'unu hem normal şekilde ekrana basıp hem de deployed Version ID'yi
# ayrıştırmak için ayrıca bir dosyaya yakalıyoruz (bkz. scripts/health-check.sh#worker_version
# teyidi). `set -o pipefail` (yukarıda) sayesinde `wrangler deploy` başarısız olursa `tee`
# borusundan sonra da script yine hata ile durur.
deploy_log="$(mktemp)"
# DEPLOY_VERSION — liste sayfalarındaki yerel script/stylesheet bağlantılarına eklenen ?v= sürümünün
# İKİNCİL/bilgilendirici kaynağı (bkz. src/index.js#deployVersion). BİRİNCİL kaynak artık
# env.CF_VERSION_METADATA.id (wrangler.jsonc#version_metadata binding'i) — Cloudflare tarafından HER
# deploy'da (çıplak `wrangler deploy` dahil) otomatik üretilir, --var enjeksiyonuna dayanmadığından
# başka bir worktree'den gelen bir deploy onu SİLEMEZ (gerçek bulgu, 2026-09-09: DEPLOY_VERSION --var'ı
# tam olarak bu şekilde — paylaşılan .git'i kullanan başka bir worktree'nin --var'sız bir deploy'u —
# sessizce silinmişti, ?v= SSR_CACHE_VERSION sabitine düşüp yeni kod immutable önbellekte hiç
# görünmemişti). DEPLOY_VERSION insan-okunur bir git sha vermeye devam eder (debug için faydalı),
# ama artık HERHANGİ bir deploy'un onu unutması canlıyı bozmaz.
deploy_version="$(git rev-parse --short=10 HEAD)"
echo "DEPLOY_VERSION=$deploy_version (bilgilendirici — asıl önbellek sürümü CF_VERSION_METADATA.id'den gelir)"
# MIMARLAB_DEPLOY_GUARD=1 — build hook'a "kapılar zaten geçildi, kilit bende, deploy sonrası
# health/smoke ben çalıştıracağım" der; hook o zaman hiçbir şey yapmadan çıkar.
MIMARLAB_DEPLOY_GUARD=1 npx wrangler deploy --var "DEPLOY_VERSION:$deploy_version" "$@" | tee "$deploy_log"
deployed_version=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$deploy_log" | tail -1 || true)
rm -f "$deploy_log"

echo "Deploy sonrası hızlı görsel sağlık kontrolü..."
sample_files=$(find miras -maxdepth 1 -type f | awk 'NR % 400 == 1' | head -6)
fail=0
for f in $sample_files; do
  url="https://mimarlab.com/${f}"
  # `|| code=000`: set -e altında curl'ün geçici bir ağ hatası (ör. exit 56, deploy'dan hemen sonra
  # bağlantı sıfırlanması — 2026-09-08'de yaşandı) tüm betiği burada öldürüp health-check.sh ve
  # smoke-test.sh'i HİÇ çalıştırmadan bırakıyordu. Hata artık "200 değil" uyarısına dönüşür.
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo 000)
  if [ "$code" != "200" ]; then
    echo "  UYARI: $url -> $code"
    fail=1
  fi
done

if [ "$fail" -eq 1 ]; then
  echo "Bazı örnek görseller 404 döndü. Bu, deploy'dan hemen sonra normal bir edge-propagation gecikmesi olabilir - birkaç dakika sonra tekrar kontrol edin. Israrcıysa gerçek bir sorun olabilir." >&2
else
  echo "Örnek görseller canlıda doğrulandı (200)."
fi

echo ""
echo "Faz 4D kapsamlı sağlık kontrolü çalıştırılıyor (scripts/health-check.sh)..."
./scripts/health-check.sh "$deployed_version"

# P2 hardening (denetim raporu, 2026-08-23) — health-check.sh'in YERİNE değil, TAMAMLAYICISI
# olarak (bkz. kullanıcı isteği: "mevcut health-check.sh sistemini gereksiz yere yeniden yazma").
# Deploy zaten gerçekleşmiş olduğundan (Cloudflare Workers'ta bu repo'nun tek ortamı var, ayrı bir
# staging/canary aşaması yok — bkz. denetim raporu "Deployment" bulgusu) bu adım deploy'u geriye
# alamaz; başarısız olursa yüksek sesle bildirir ve rollback için gereken komutu gösterir.
echo ""
echo "Kapsamlı production smoke test çalıştırılıyor (scripts/smoke-test.sh)..."
if ! ./scripts/smoke-test.sh; then
  echo "" >&2
  echo "UYARI: smoke test deploy SONRASINDA başarısız oldu (deploy zaten canlıya çıktı, geri alınamadı)." >&2
  echo "Geri almak istersen: npx wrangler rollback [<önceki-version-id>] (bkz. \`npx wrangler deployments list\`)" >&2
  exit 1
fi
