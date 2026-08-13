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

# Faz 4D — wrangler'ın stdout'unu hem normal şekilde ekrana basıp hem de deployed Version ID'yi
# ayrıştırmak için ayrıca bir dosyaya yakalıyoruz (bkz. scripts/health-check.sh#worker_version
# teyidi). `set -o pipefail` (yukarıda) sayesinde `wrangler deploy` başarısız olursa `tee`
# borusundan sonra da script yine hata ile durur.
deploy_log="$(mktemp)"
npx wrangler deploy "$@" | tee "$deploy_log"
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
