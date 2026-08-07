#!/bin/bash
# Faz 4D — D1 yedek dayanıklılığı doğrulama tatbikatı (bkz. docs/disaster-recovery.md). Production
# D1 üzerinde YALNIZCA salt-okunur bir integrity check ve bir export çalıştırır — hiçbir zaman
# `wrangler d1 execute --remote` ile YAZMA veya `wrangler d1 time-travel restore` ile prod'u geri
# ALMAZ (bkz. kullanıcı isteği: "Production D1 veritabanı üzerinde KESİNLİKLE RESTORE İŞLEMİ
# YAPMA"). Restore testi, scripts/output/ (gitignore'lu, gerçek üretim verisi barındırdığı için asla
# commit edilmemeli) altında tek seferlik bir yerel SQLite'a yapılır — mevcut `wrangler dev` yerel
# geliştirme veritabanına (bkz. proje belleği: özel --persist-to yolu) HİÇ dokunmaz.
set -eo pipefail
cd "$(dirname "$0")/.."

DB_NAME="mimarlab-db"
WORKDIR="scripts/output/d1-backup-drill"
STAMP=$(date +%Y%m%d-%H%M%S)
DUMP_FILE="$WORKDIR/backup-$STAMP.sql"
RESTORE_DB="$WORKDIR/local-restore-$STAMP.sqlite"

mkdir -p "$WORKDIR"

echo "1) Remote D1 bütünlük kontrolü (salt-okunur)"
echo "   NOT: D1'in yönetilen query API'si tam 'PRAGMA integrity_check' çalıştırılmasına izin"
echo "   VERMİYOR (test edildi: 'not authorized: SQLITE_AUTH [code: 7500]' döner — token/yetki"
echo "   sorunu DEĞİL, D1 platformunun kendi kısıtı). D1'in İZİN VERDİĞİ eşdeğerleri kullanılıyor:"
echo "   PRAGMA quick_check (integrity_check'in D1 üzerinde çalışan hafif sürümü) + foreign_key_check."
npx wrangler d1 execute "$DB_NAME" --remote --command "PRAGMA quick_check;" --json
npx wrangler d1 execute "$DB_NAME" --remote --command "PRAGMA foreign_key_check;" --json

echo ""
echo "2) Remote D1 export alınıyor -> $DUMP_FILE"
npx wrangler d1 export "$DB_NAME" --remote --output="$DUMP_FILE"

echo ""
echo "3) Export checksum (SHA-256)"
shasum -a 256 "$DUMP_FILE"

echo ""
echo "4) Referans satır sayıları (remote, salt-okunur)"
npx wrangler d1 execute "$DB_NAME" --remote --command \
  "SELECT 'architects' t, count(*) c FROM architects UNION ALL SELECT 'offices', count(*) FROM offices UNION ALL SELECT 'projects', count(*) FROM projects UNION ALL SELECT 'users', count(*) FROM users;"

echo ""
echo "5) Export'u tek seferlik yerel SQLite'a restore et -> $RESTORE_DB"
# NOT: `wrangler d1 execute --local --file=...` bu dump boyutunda kendi statement-splitter'ında
# bir sorunla karşılaştı ("no such table" — CREATE/INSERT sırasını bozan bir ayrıştırma kusuru,
# export'un kendisiyle İLGİSİZ). Bunun yerine dump doğrudan gerçek `sqlite3` CLI'ına verilir — asıl
# doğrulanmak istenen zaten "bu SQL dump geçerli ve tam olarak restore edilebilir mi?" sorusu,
# wrangler'ın D1 emülasyonundan bağımsız olarak da cevaplanabilir.
sqlite3 "$RESTORE_DB" < "$DUMP_FILE"

echo ""
echo "6) Restore edilen yerel kopyada satır sayıları (yukarıdaki referansla karşılaştır)"
sqlite3 "$RESTORE_DB" \
  "SELECT 'architects', count(*) FROM architects UNION ALL SELECT 'offices', count(*) FROM offices UNION ALL SELECT 'projects', count(*) FROM projects UNION ALL SELECT 'users', count(*) FROM users;"

echo ""
echo "Tatbikat tamamlandı. Dump: $DUMP_FILE  |  Yerel restore: $RESTORE_DB"
echo "Bu ikisi gerçek üretim verisi içerir (scripts/output/ .gitignore'lu) — işiniz bitince silmeniz önerilir:"
echo "  rm -rf \"$WORKDIR\""
