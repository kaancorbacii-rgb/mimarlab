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
