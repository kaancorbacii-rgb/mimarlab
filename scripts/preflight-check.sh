#!/bin/bash
# P2 hardening (denetim raporu, 2026-08-23) — deploy.sh'e "test → deploy → health check → smoke
# test" akışının İLK adımını ekler. Bu betik tamamen YEREL/statiktir — hiçbir ağ isteği yapmaz,
# `wrangler dev` başlatmaz (bu ortamda env.AI remote binding bazı ağ kısıtlı sandbox'larda hiç
# bağlanamıyor, bkz. proje notu — bu yüzden gerçek bir sunucu GEREKTİRMEYEN kontroller seçildi).
# Amaç, deploy'dan ÖNCE bariz kırılmaları (sözdizimi hatası, P1 düzeltmelerinin kazara geri
# alınması) yakalayıp deploy'u DURDURMAK — deploy sonrası canlı doğrulama için bkz.
# scripts/health-check.sh ve scripts/smoke-test.sh.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
ok()  { echo "  OK: $1"; }
bad() { echo "  BAŞARISIZ: $1" >&2; fail=1; }

echo "Preflight kontrolü başlıyor (yerel, statik)..."
echo ""

echo "1) JS sözdizimi (src/**/*.js)"
while IFS= read -r -d '' f; do
  if node --input-type=module --check < "$f" 2>/tmp/preflight_err; then
    :
  else
    bad "$f — sözdizimi hatası: $(cat /tmp/preflight_err | head -3)"
  fi
done < <(find src -name '*.js' -print0)
[ "$fail" -eq 0 ] && ok "tüm src/**/*.js dosyaları temiz sözdizimine sahip"

echo ""
echo "2) Kök seviyesi paylaşılan .js dosyaları (plain <script>, CJS/global tarz)"
for f in *.js; do
  [ -f "$f" ] || continue
  if node --check "$f" 2>/tmp/preflight_err; then
    :
  else
    bad "$f — sözdizimi hatası: $(cat /tmp/preflight_err | head -3)"
  fi
done
ok "kök seviyesi .js dosyaları kontrol edildi"

echo ""
echo "3) HTML sayfalarındaki inline <script> blokları (proje-ekle/kisi-ekle/firma-ekle/urun-ekle/index/admin/hesabim)"
for f in index.html admin.html hesabim.html proje.html kisi.html firma.html urun.html proje-ekle.html kisi-ekle.html firma-ekle.html urun-ekle.html neden-mimarlab.html; do
  [ -f "$f" ] || continue
  node -e "
    const fs = require('fs');
    // HTML yorumlarını (<!-- ... -->) ÖNCE temizle — gerçek bulgu: kisi.html/firma.html'deki bir
    // Türkçe kod yorumu metninde örnek olarak \"<script id=...>\" GEÇİYORDU; yorumları çıkarmadan
    // yapılan bir regex bunu GERÇEK bir script açılış etiketi sanıp bir sonraki gerçek </script>'e
    // kadar olan her şeyi (asıl JSON-LD içeriği dahil) o sahte bloğun içeriği zannedip JS olarak
    // test ediyor, yanlış pozitif üretiyordu.
    const html = fs.readFileSync('$f','utf8').replace(/<!--[\s\S]*?-->/g, '');
    // type=\"application/ld+json\" (JSON-LD) bloklarını atla — bunlar JS değil JSON'dır, new
    // Function() ile sözdizimi kontrolüne tabi tutulamaz.
    const scripts = [...html.matchAll(/<script((?:(?!src=)[^>])*)>([\s\S]*?)<\/script>/g)]
      .filter(m => !/type\s*=\s*[\"']application\/ld\+json[\"']/.test(m[1]))
      .map(m => m[2]);
    let bad = false;
    scripts.forEach((s,i)=>{
      try { new Function(s); } catch(e){ bad = true; console.error('  ' + i + ': ' + e.message); }
    });
    process.exit(bad ? 1 : 0);
  " 2>/tmp/preflight_err
  if [ $? -ne 0 ]; then
    bad "$f — bir ya da daha fazla inline <script> bloğunda sözdizimi hatası:"
    cat /tmp/preflight_err >&2
  fi
done
[ "$fail" -eq 0 ] && ok "tüm kontrol edilen HTML sayfalarının inline script'leri temiz"

echo ""
echo "4) P1 düzeltmesi regresyon korumaları (kaynak-seviyeli, statik)"
if grep -q "document.addEventListener('DOMContentLoaded'" index.html; then
  ok "index.html — ilk render zinciri hâlâ DOMContentLoaded'a alınmış"
else
  bad "index.html — DOMContentLoaded sarmalayıcısı kayıp görünüyor (cdnSrcset regresyon riski)"
fi
for f in proje.html kisi.html firma.html urun.html; do
  if grep -q 'id="ssr-entity-body"' "$f"; then
    ok "$f — #ssr-entity-body konteyneri mevcut"
  else
    bad "$f — #ssr-entity-body konteyneri kayıp (SSR body enjeksiyonu bozulmuş olabilir)"
  fi
done
if grep -q "#ssr-entity-body" src/index.js; then
  ok "src/index.js — injectMeta hâlâ #ssr-entity-body'yi hedefliyor"
else
  bad "src/index.js — #ssr-entity-body handler'ı kayıp görünüyor"
fi

echo ""
echo "5) schema.sql sözdizimi (varsa sqlite3 ile)"
if command -v sqlite3 >/dev/null 2>&1; then
  if sqlite3 ":memory:" < schema.sql >/tmp/preflight_err 2>&1; then
    ok "schema.sql temiz bir SQLite veritabanında hatasız çalışıyor"
  else
    bad "schema.sql çalıştırılamadı: $(cat /tmp/preflight_err | head -5)"
  fi
else
  echo "  UYARI: sqlite3 CLI bulunamadı, schema.sql kontrolü atlandı (kritik değil)."
fi

rm -f /tmp/preflight_err
echo ""
if [ "$fail" -eq 1 ]; then
  echo "Preflight BAŞARISIZ oldu — deploy durduruldu." >&2
  exit 1
fi
echo "Preflight geçti."
