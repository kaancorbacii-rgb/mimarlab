#!/bin/bash
# Guards against the miras/ asset-manifest wipe: miras/ is gitignored, so a git
# worktree that never had it rsynced in looks "empty" to wrangler and a deploy
# from there drops all miras/*.webp from the live asset manifest (every legacy
# project photo 404s). Always deploy through this script, not raw `wrangler deploy`.
set -eo pipefail
cd "$(dirname "$0")"

MIN_MIRAS_FILES=2500
MAIN_REPO_MIRAS="/Users/kaancorbaci/Projects/mimarlab/miras"

miras_count=$(find miras -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')

if [ "$miras_count" -lt "$MIN_MIRAS_FILES" ]; then
  echo "DEPLOY DURDURULDU: miras/ klasöründe sadece $miras_count dosya var (beklenen: >= $MIN_MIRAS_FILES)." >&2
  echo "miras/ .gitignore'da olduğu için her git worktree'nin kendi ayrı kopyası olmalı - bu worktree'de eksik/boş görünüyor." >&2
  echo "Deploy etmeden önce ana repodan kopyala:" >&2
  echo "  rsync -a \"$MAIN_REPO_MIRAS/\" ./miras/" >&2
  exit 1
fi

echo "miras/ kontrolü geçti ($miras_count dosya)."

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

# Gerçek bulgu (2026-08-13): main ve bir Claude oturumu worktree'si (claude/terminal-yaz-
# sorusu-e4c8aa) aynı noktadan ayrışıp saatlerce birbirinden habersiz commit aldı; deploy hep
# main'den (worktree'lerin GERİSİNDE kalmış bir daldan) çalıştırıldığından o günün TÜM hesabım
# pop-up/mimar-ekle senkron/footer/rozet işi canlıdan saatlerce yok görünmüştü — kod hiç
# kaybolmamıştı, sadece deploy edilen dal yanlış/eskiydi. Bu kontrol, deploy edilecek dalın
# başka bir worktree'nin dalından GERİDE olduğu (yani o dalda burada olmayan commit'ler
# bulunduğu) durumu tespit edip deploy'u durdurur - `git worktree list --porcelain` paylaşılan
# .git nesnelerinden dolayı diğer worktree'lerin dallarını da (checkout edilmemiş olsalar bile)
# görebilir.
current_branch=$(git branch --show-current)
# DETACHED HEAD ARTIK SESSİZCE GEÇMİYOR (hardening denetimi, 2026-09-07).
# `git branch --show-current` detached HEAD'de BOŞ döner ve buradaki `if [ -n ... ]` yüzünden
# aşağıdaki worktree ayrışma kontrolünün TAMAMI atlanıyordu — yani guard'ın korumak için var
# olduğu senaryoda guard hiç çalışmıyordu. Bu, proje belleğinde zaten kayıtlı bilinen bir açıktı
# (bkz. "Concurrent deploy race 2026-08-19": detached-HEAD worktree'ler dal guard'ını atlatır).
# Kontrol edilemiyorsa doğru davranış "sessizce geç" değil, DURMAKTIR.
if [ -z "$current_branch" ]; then
  echo "DEPLOY DURDURULDU: bu worktree detached HEAD durumunda (HEAD=$(git rev-parse --short HEAD))." >&2
  echo "Dal adı okunamadığı için diğer worktree'lerle ayrışma kontrolü YAPILAMAZ — eski/eksik kod" >&2
  echo "deploy etme riski var. Önce bir dala geç:  git checkout <dal>" >&2
  exit 1
fi
if [ -n "$current_branch" ]; then
  behind_found=0
  wt_path=""
  while IFS= read -r line; do
    case "$line" in
      worktree\ *) wt_path="${line#worktree }" ;;
      branch\ refs/heads/*)
        wt_branch="${line#branch refs/heads/}"
        if [ "$wt_path" != "$(pwd)" ] && [ "$wt_branch" != "$current_branch" ]; then
          ahead=$(git rev-list --count "$current_branch..$wt_branch" 2>/dev/null || echo 0)
          if [ "$ahead" -gt 0 ]; then
            echo "DEPLOY DURDURULDU: '$wt_branch' dalı ($wt_path worktree'sinde) bu daldan ($current_branch) $ahead commit ileride." >&2
            echo "Bu tam olarak main/terminal-yaz-sorusu-e4c8aa'nın ayrışıp canlıya eksik kod deploy edilmesine yol açtığı senaryo - önce birleştir:" >&2
            echo "  git merge $wt_branch" >&2
            behind_found=1
          fi
        fi
        ;;
    esac
  done < <(git worktree list --porcelain)
  if [ "$behind_found" -eq 1 ]; then
    exit 1
  fi
  echo "Git dal senkronizasyon kontrolü geçti (diğer worktree'lerde eksik commit yok)."
fi

# Deploy drift kapanışı (remediation, 2026-08-23) — yukarıdaki guard yalnızca COMMIT edilmiş
# dallar arasındaki farkı görüyor; bu worktree'nin KENDİ working tree'sindeki commit edilmemiş
# değişiklikleri görmüyor. `wrangler deploy` her zaman working tree'yi (son commit'i değil) deploy
# eder - bu yüzden commit edilmemiş yerel bir değişiklik, hiçbir git commit'ine karşılık gelmeyen,
# izlenemeyen bir production deploy'una yol açabilir (kök neden - bkz. 2026-08-23 remediation
# raporu, acb26e27'den sonraki commit'siz deeb1be9/dd4a68d2 deploy'ları).
dirty="$(git status --short)"
if [ -n "$dirty" ]; then
  echo "DEPLOY DURDURULDU: working tree temiz değil, commit edilmemiş değişiklikler var:" >&2
  echo "$dirty" >&2
  echo "wrangler deploy WORKING TREE'yi deploy eder (son commit'i değil) - bu commit'siz/izlenemeyen bir production versiyonuna yol açar. Önce commit edin ya da değişiklikleri geri alın." >&2
  exit 1
fi
echo "Working tree temizliği kontrolü geçti (commit edilmemiş değişiklik yok)."

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
# DEPLOY_VERSION — liste sayfalarındaki yerel script/stylesheet bağlantılarına eklenen ?v= sürümü (bkz.
# src/index.js#versionAssetUrls). Her deploy'da değişmesi ŞART: sürümlü URL'ler `immutable` ile bir yıl
# önbelleklenir; sürüm değişmezse yeni kod tarayıcıya hiç ulaşmaz. Working tree yukarıda temiz
# olduğundan HEAD sha'sı deploy edilen kodu birebir tanımlar.
deploy_version="$(git rev-parse --short=10 HEAD)"
echo "DEPLOY_VERSION=$deploy_version"
npx wrangler deploy --var "DEPLOY_VERSION:$deploy_version" "$@" | tee "$deploy_log"
deployed_version=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$deploy_log" | tail -1 || true)
rm -f "$deploy_log"

echo "Deploy sonrası hızlı görsel sağlık kontrolü..."
sample_files=$(find miras -maxdepth 1 -type f | awk 'NR % 400 == 1' | head -6)
fail=0
for f in $sample_files; do
  url="https://mimarlab.com/${f}"
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
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
