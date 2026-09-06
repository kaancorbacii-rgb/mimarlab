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
# marka.html EKLENDİ (2026-09-06): kisi/firma ile birebir aynı iskelete sahip ve aynı elle yazılmış
# inline render mantığını taşıyor, ama bu listede yoktu — yani onun inline script'i hiç kontrol
# edilmiyordu.
for f in index.html admin.html hesabim.html proje.html kisi.html firma.html marka.html urun.html proje-ekle.html kisi-ekle.html firma-ekle.html urun-ekle.html neden-mimarlab.html; do
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

# Erken liste fetch'i (performans denetimi, 2026-09-06 madde 3) — liste sayfalarının <head>'indeki
# senkron betik, render()'ın ÜRETECEĞİ API URL'sini elle kurar; listFetch() o URL'yi birebir
# eşleştirebilirse önceden başlatılmış isteği devralır. İki taraf ayrışırsa hiçbir şey KIRILMAZ
# (listFetch normal fetch'e düşer) ama kazanç sessizce kaybolur — bu tam olarak bu depodaki tekrar
# eden "iki yerin birlikte güncellenmesi gereken sabit" tuzağıdır, o yüzden statik olarak kontrol
# edilir. Kontrol edilen: <head>'deki limit=N ile sayfanın kendi PAGE_SIZE sabiti aynı mı.
check_prefetch_limit() {
  local page="$1" src="$2"
  local head_limit page_size
  head_limit=$(grep -o "limit=[0-9]\+" "$page" | head -1 | cut -d= -f2)
  page_size=$(grep -o "^const PAGE_SIZE = [0-9]\+" "$src" | head -1 | grep -o "[0-9]\+")
  if [ -z "$head_limit" ] || [ -z "$page_size" ]; then
    bad "$page — erken liste fetch'i için limit/PAGE_SIZE okunamadı (head_limit='$head_limit', PAGE_SIZE='$page_size')"
  elif [ "$head_limit" != "$page_size" ]; then
    bad "$page — <head> prefetch limit=$head_limit ile $src PAGE_SIZE=$page_size ayrışmış (erken fetch boşa gidiyor)"
  else
    ok "$page — erken liste fetch'i PAGE_SIZE=$page_size ile hizalı"
  fi
}
check_prefetch_limit kisi.html kisi.html
check_prefetch_limit firma.html firma.html
check_prefetch_limit marka.html marka.html
check_prefetch_limit proje.html js/pages/proje.js
# Aynı denetimin ikinci yarısı: prefetch'i TÜKETEN taraf hâlâ yerinde mi (biri silinirse istek
# yapılır ama hiç kullanılmaz — sessiz bir israf).
for f in kisi.html firma.html marka.html js/pages/proje.js; do
  if grep -q "function listFetch(url)" "$f" && grep -q "await listFetch(" "$f"; then
    ok "$f — listFetch() tanımlı ve render() içinde kullanılıyor"
  else
    bad "$f — listFetch() tanımı ya da kullanımı kayıp (erken liste fetch'i tüketilmiyor)"
  fi
done

# Tembel varlık modalleri (performans denetimi, 2026-09-06 madde 4) — kişi/firma/marka liste
# sayfaları architect-modal.js/office-modal.js'i ARTIK <script> etiketiyle yüklememeli; yüklerlerse
# hem ~250 KB blocking JS geri gelir hem de lazy-modals zinciri gereksizleşir.
for f in kisi.html firma.html marka.html; do
  if grep -qE '<script src="js/components/(architect|office)-modal\.js"' "$f"; then
    bad "$f — varlık modalı yeniden <script> etiketiyle yükleniyor (tembel yükleme regresyonu)"
  elif grep -q "LazyModals.load(" "$f"; then
    ok "$f — varlık modalı lazy-modals üzerinden tembel yükleniyor"
  else
    bad "$f — LazyModals.load() çağrısı kayıp (popup hiç açılmayabilir)"
  fi
done

# GERÇEK BULGU (2026-09-06, bu denetimin kendisi sırasında): modal-shell.js bu üç sayfadan
# kaldırıldıktan sonra inline script'in TEPESİNDE duran `ModalShell.setSsrDefaults({...})` çağrısı
# ReferenceError fırlattı ve script'in GERİ KALANI hiç çalışmadı — liste bomboş kaldı, popup hiç
# açılmadı, konsolda tek satır uyarı yoktu. Sözdizimi kontrolü bunu YAKALAYAMAZ (geçerli JS'tir).
# Kural: bu üç sayfada `ModalShell` yalnızca `window.ModalShell &&` koruması ile aynı satırda
# geçebilir; korumasız her kullanım aynı sessiz ölüme yol açar.
for f in kisi.html firma.html marka.html; do
  unguarded=$(grep -n 'ModalShell' "$f" | grep -v 'window.ModalShell &&' | grep -vE '^\s*[0-9]+:\s*(//|\*|<!--)' | grep -vE '^[0-9]+:.*(bkz\.|ile AYNI|yorum)' || true)
  if [ -n "$unguarded" ]; then
    bad "$f — korumasız ModalShell kullanımı (modal-shell.js tembel yükleniyor, bu satır ReferenceError verir): $(echo "$unguarded" | head -2 | tr '\n' ' ')"
  else
    ok "$f — ModalShell kullanımlarının tamamı window.ModalShell guard'lı"
  fi
done

echo ""
echo "5) GÜNDEM (kullanıcı isteği, 2026-09-06)"

# Birim testler — feed ayrıştırma, mükerrer anahtarları, kalite kapısı, entity eşleştirme, kaynak
# yapılandırması. Tamamen yerel/saf (ağ ve D1 yok), bkz. scripts/test-gundem.mjs dosya başı.
if node scripts/test-gundem.mjs >/tmp/preflight_gundem 2>&1; then
  ok "gundem birim testleri geçti ($(grep -c '^  ok ' /tmp/preflight_gundem) test)"
else
  bad "gundem birim testleri BAŞARISIZ:"
  tail -20 /tmp/preflight_gundem >&2
fi

# PAGE_SIZE üç yerde tekrarlanıyor ve ÜÇÜ de aynı olmak zorunda: (a) gundem.html <head>'indeki
# erken fetch URL'si, (b) js/pages/gundem.js#PAGE_SIZE, (c) src/routes/gundem.js#GUNDEM_PAGE_SIZE
# (SSR gövdesinin kaç kart basacağı). Ayrışırlarsa hiçbir şey KIRILMAZ ama prefetch boşa gider ve
# SSR ile istemci render'ı farklı sayıda kart gösterir — bu depodaki klasik "iki yerde tutulan sabit
# sessizce ayrıştı" tuzağı (bkz. yukarıdaki check_prefetch_limit).
gundem_head_limit=$(grep -o "limit=[0-9]\+" gundem.html | head -1 | cut -d= -f2)
gundem_page_size=$(grep -o "^const PAGE_SIZE = [0-9]\+" js/pages/gundem.js | grep -o "[0-9]\+")
gundem_api_size=$(grep -o "^export const GUNDEM_PAGE_SIZE = [0-9]\+" src/routes/gundem.js | grep -o "[0-9]\+")
if [ -z "$gundem_head_limit" ] || [ -z "$gundem_page_size" ] || [ -z "$gundem_api_size" ]; then
  bad "gundem sayfa boyutu okunamadı (head='$gundem_head_limit' page='$gundem_page_size' api='$gundem_api_size')"
elif [ "$gundem_head_limit" != "$gundem_page_size" ] || [ "$gundem_page_size" != "$gundem_api_size" ]; then
  bad "gundem sayfa boyutu ayrışmış: gundem.html=$gundem_head_limit, js/pages/gundem.js=$gundem_page_size, src/routes/gundem.js=$gundem_api_size"
else
  ok "gundem sayfa boyutu üç yerde de hizalı (=$gundem_page_size)"
fi

# SSR konteyneri — yukarıdaki dört liste sayfasıyla AYNI gerekçe (src/index.js#serveGundemListPage
# ve #injectMeta bu id'yi hedefliyor; kaybolursa SSR gövdesi sessizce hiçbir yere basılmaz).
if grep -q 'id="ssr-entity-body"' gundem.html; then
  ok "gundem.html — #ssr-entity-body konteyneri mevcut"
else
  bad "gundem.html — #ssr-entity-body konteyneri kayıp (SSR body enjeksiyonu bozulmuş olabilir)"
fi

# Cron dispatcher — src/index.js#VISUAL_INDEX_CRON, wrangler.jsonc'taki görsel-dizin ifadesiyle
# BİREBİR aynı olmalı. Ayrışırsa dispatcher o ifadeyi tanımaz ve 6 saatlik görsel dizin turu her
# 30 dakikada bir çalışmaya başlar (12 kat maliyet), üstelik sessizce.
wrangler_cron=$(grep -o '"23 \*/6 \* \* \*"' wrangler.jsonc | head -1 | tr -d '"')
index_cron=$(grep -o "^const VISUAL_INDEX_CRON = '[^']*'" src/index.js | sed "s/.*'\(.*\)'/\1/")
if [ -z "$wrangler_cron" ] || [ -z "$index_cron" ]; then
  bad "cron ifadesi okunamadı (wrangler='$wrangler_cron' index='$index_cron')"
elif [ "$wrangler_cron" != "$index_cron" ]; then
  bad "VISUAL_INDEX_CRON ayrışmış: wrangler.jsonc='$wrangler_cron', src/index.js='$index_cron'"
else
  ok "cron dispatcher ifadesi wrangler.jsonc ile hizalı ($index_cron)"
fi

# Gündem görselleri kaynağın kendi CDN'inden gelir; CSP img-src listesi kaynak yapılandırmasından
# TÜRETİLMELİ. Biri elle sabit bir host listesi yazarsa (ör. kaynak eklerken CSP'yi unutup satırı
# kopyalarsa) kart canlıda sessizce görselsiz kalır.
if grep -q 'GUNDEM_IMAGE_HOSTS.map' src/index.js; then
  ok "src/index.js — CSP img-src hâlâ GUNDEM_IMAGE_HOSTS'tan türetiliyor"
else
  bad "src/index.js — CSP img-src artık GUNDEM_IMAGE_HOSTS'tan türetilmiyor (Gündem görselleri engellenir)"
fi

rm -f /tmp/preflight_gundem

echo ""
echo "6) schema.sql sözdizimi (varsa sqlite3 ile)"
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
