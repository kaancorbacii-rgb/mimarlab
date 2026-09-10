#!/bin/bash
# DEPLOY VERİ-GÜVENLİĞİ KAPILARI — TEK KAYNAK.
#
# Bu üç kontrol daha önce YALNIZCA deploy.sh'in içinde yaşıyordu; başka bir terminalden çıplak
# `npx wrangler deploy` çalıştırmak ÜÇÜNÜ BİRDEN atlıyordu. Bu teorik değil: 2026-08-23
# remediation'ında tam olarak bu yolla iki ek, commit'siz production deploy'u oluştu (bkz. CLAUDE.md
# ve deploy.sh'taki working-tree guard gerekçesi).
#
# Artık AYNI betik iki yerden çağrılır:
#   1) deploy.sh          -> `scripts/deploy-guard.sh`        (kilidi ALDIKTAN sonra)
#   2) wrangler build hook -> `scripts/deploy-guard.sh --hook` (wrangler.jsonc#build.command)
# İkincisi sayesinde ÇIPLAK `wrangler deploy` / `wrangler versions upload` da bu kapılardan geçer.
#
# HOOK'UN NE ZAMAN ÇALIŞACAĞI ÖLÇÜLDÜ (2026-09-10, wrangler 4.131.0): wrangler build komutuna
# `WRANGLER_COMMAND` ortam değişkenini verir — `deploy`, `versions upload`, `dev` … Böylece kapılar
# YALNIZCA gerçekten yayına çıkaran komutlarda çalışır; `wrangler dev` ve `wrangler types` etkilenmez
# (aksi halde kirli bir working tree yerel geliştirmeyi de bloke ederdi).
#
# TASARIM SINIRI: hook, deploy'un KENDİSİNİ sarmalamaz (wrangler build adımı bitince deploy başlar),
# bu yüzden eşzamanlı deploy KİLİDİNİ tutamaz ve deploy SONRASI health-check/smoke-test'i
# çalıştıramaz. O yüzden çıplak deploy, kapılardan geçse bile bilerek REDDEDİLİR; gerçekten
# gerekiyorsa `MIMARLAB_ALLOW_BARE_DEPLOY=1` ile açıkça onaylanır.
set -uo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-}"
MIN_MIRAS_FILES=2500
MAIN_REPO_MIRAS="/Users/kaancorbaci/Projects/mimarlab/miras"

# --- HOOK MODU: bu çağrının gerçekten bir yayın komutu olup olmadığına karar ver ------------------
if [ "$MODE" = "--hook" ]; then
  # deploy.sh zaten kapıları geçti, kilidi tutuyor ve deploy sonrası kontrolleri çalıştıracak.
  if [ "${MIMARLAB_DEPLOY_GUARD:-}" = "1" ]; then exit 0; fi
  case "${WRANGLER_COMMAND:-}" in
    deploy|"versions upload") ;;
    *) exit 0 ;;   # dev / types / tail / secret ... — kapılar bunlara uygulanmaz
  esac
  # `--dry-run` hiçbir şeyi yayına almaz; kirli bir ağaçta bile serbest olmalı.
  if ps -o command= -p "$PPID" 2>/dev/null | grep -q -- '--dry-run'; then exit 0; fi
fi

fail=0
bad() { echo "DEPLOY DURDURULDU: $1" >&2; fail=1; }

# --- 1) miras/ varlık manifesti koruması ---------------------------------------------------------
# miras/ gitignore'da, yani her worktree'nin KENDİ fiziksel kopyası olmalı; boşsa wrangler o
# klasörü "silinmiş" sayar ve TÜM miras görselleri canlı asset manifest'inden düşer.
miras_count=$(find miras -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "${miras_count:-0}" -lt "$MIN_MIRAS_FILES" ]; then
  bad "miras/ klasöründe sadece $miras_count dosya var (beklenen: >= $MIN_MIRAS_FILES)."
  echo "  miras/ .gitignore'da olduğu için her git worktree'nin kendi ayrı kopyası olmalı." >&2
  echo "  Deploy etmeden önce ana repodan kopyala:  rsync -a \"$MAIN_REPO_MIRAS/\" ./miras/" >&2
else
  echo "miras/ kontrolü geçti ($miras_count dosya)."
fi

# --- 2) worktree/dal ayrışması -------------------------------------------------------------------
# Gerçek bulgu (2026-08-13): main ve bir worktree ayrışıp saatlerce birbirinden habersiz commit aldı;
# deploy hep GERİDE kalmış daldan çalıştırıldığı için o günün tüm işi canlıda yok göründü.
current_branch=$(git branch --show-current)
if [ -z "$current_branch" ]; then
  # Detached HEAD'de dal adı okunamaz, yani ayrışma kontrolü YAPILAMAZ (bkz. proje notu:
  # "detached-HEAD worktree'ler dal guard'ını atlatır"). Doğru davranış sessizce geçmek değil DURMAK.
  bad "bu worktree detached HEAD durumunda (HEAD=$(git rev-parse --short HEAD))."
  echo "  Dal adı okunamadığı için diğer worktree'lerle ayrışma kontrolü YAPILAMAZ." >&2
  echo "  Önce bir dala geç:  git checkout <dal>" >&2
else
  behind_found=0
  wt_path=""
  while IFS= read -r line; do
    case "$line" in
      worktree\ *) wt_path="${line#worktree }" ;;
      branch\ refs/heads/*)
        wt_branch="${line#branch refs/heads/}"
        if [ "$wt_path" != "$(pwd)" ] && [ "$wt_branch" != "$current_branch" ]; then
          ahead=$(git rev-list --count "$current_branch..$wt_branch" 2>/dev/null || echo 0)
          if [ "${ahead:-0}" -gt 0 ]; then
            bad "'$wt_branch' dalı ($wt_path worktree'sinde) bu daldan ($current_branch) $ahead commit ileride."
            echo "  Önce birleştir:  git merge $wt_branch" >&2
            behind_found=1
          fi
        fi
        ;;
    esac
  done < <(git worktree list --porcelain)
  [ "$behind_found" -eq 0 ] && echo "Git dal senkronizasyon kontrolü geçti (diğer worktree'lerde eksik commit yok)."
fi

# --- 3) commit edilmemiş değişiklik --------------------------------------------------------------
# `wrangler deploy` HER ZAMAN working tree'yi deploy eder (son commit'i değil) — commit edilmemiş
# yerel bir değişiklik, hiçbir git commit'ine karşılık gelmeyen izlenemez bir production versiyonu
# üretir (2026-08-23 remediation'ının kök nedeni).
dirty="$(git status --short)"
if [ -n "$dirty" ]; then
  bad "working tree temiz değil, commit edilmemiş değişiklikler var:"
  echo "$dirty" >&2
  echo "  wrangler deploy WORKING TREE'yi deploy eder (son commit'i değil). Önce commit edin." >&2
else
  echo "Working tree temizliği kontrolü geçti (commit edilmemiş değişiklik yok)."
fi

[ "$fail" -eq 0 ] || exit 1

# --- HOOK MODU: kapılar geçti ama çıplak deploy yine de reddedilir --------------------------------
if [ "$MODE" = "--hook" ]; then
  if [ "${MIMARLAB_ALLOW_BARE_DEPLOY:-}" = "1" ]; then
    echo "UYARI: MIMARLAB_ALLOW_BARE_DEPLOY=1 — çıplak '${WRANGLER_COMMAND}' onaylandı." >&2
    echo "       Eşzamanlı deploy kilidi, preflight ve deploy sonrası health/smoke ATLANIYOR." >&2
    exit 0
  fi
  echo "DEPLOY DURDURULDU: doğrudan 'wrangler ${WRANGLER_COMMAND}' kullanılamaz." >&2
  echo "  Veri-güvenliği kapıları geçti, ama bu yol şunları ATLAR: eşzamanlı deploy kilidi," >&2
  echo "  preflight testleri ve deploy sonrası health-check + smoke-test." >&2
  echo "  Doğru komut:  ./deploy.sh" >&2
  echo "  Gerçekten gerekiyorsa:  MIMARLAB_ALLOW_BARE_DEPLOY=1 npx wrangler ${WRANGLER_COMMAND}" >&2
  exit 1
fi
exit 0
