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
for f in index.html admin.html hesabim.html proje.html kisi.html firma.html marka.html urun.html proje-ekle.html kisi-ekle.html firma-ekle.html urun-ekle.html neden-mimarlab.html gorusme.html; do
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
echo "3b) <meta charset> ilk 1024 baytta mı (mojibake regresyon koruması)"
# GERÇEK BULGU (kullanıcı isteği, 2026-09-10: "projeler sayfasına girince yazılar bozuluyor"):
# HTML spesifikasyonunun kodlama ÖN-TARAMASI yalnızca belgenin İLK 1024 BAYTINA bakar. Liste/hub
# sayfalarında <meta charset> çok geride kalmıştı (proje.html 2107, marka.html 3787 bayt) ve
# HTMLRewriter'a charset'siz bir Content-Type verildiği için kodlama UTF-8 dışı bir varsayılana
# düşüyor, Türkçe karakterler "DOÇEM" yerine "DOÃ‡EM" olarak çıkıyordu. Sunucu tarafı artık
# charset'i açıkça veriyor (src/index.js), ama meta'nın konumu da spesifikasyona uygun kalmalı:
# ön-taramaya dayanan diğer tüketiciler (tarayıcı sniff'i, botlar, ara katmanlar) için tek güvence bu.
for f in *.html; do
  [ -f "$f" ] || continue
  off=$(node -e "const b=require('fs').readFileSync('$f');const i=b.indexOf('charset=');process.stdout.write(String(i));")
  if [ "$off" = "-1" ]; then
    bad "$f — <meta charset> hiç yok"
  elif [ "$off" -gt 1024 ]; then
    bad "$f — <meta charset> $off. baytta (ilk 1024 baytta olmalı; mojibake riski)"
  fi
done
[ "$fail" -eq 0 ] && ok "tüm HTML sayfalarında <meta charset> ilk 1024 baytta"

echo ""
echo "3c) Statik görsel dosyaları GERÇEKTEN görsel mi (bozuk varlık koruması)"
# CANLI BULGU (denetim, 2026-09-10): mimarlar/arkiv ve mimarlar-thumb/arkiv altındaki 6 dosya
# .jpg uzantılı olmasına rağmen bir arşiv sitesinin HTML dizin listesiydi (her biri 667 KB).
# Tarayıcıda bozuk görsel olarak çıkarlardı ve deploy edilen asset manifest'inde 3,8 MB yer
# kaplıyorlardı. Bu kontrol aynı sınıf bir kazayı (kazıma sırasında hata sayfasının görsel diye
# kaydedilmesi) deploy'dan ÖNCE yakalar. NOT: bazı miras/*.webp dosyalarının gerçekte PNG/JPEG
# baytları taşıması BİLİNEN ve ZARARSIZ bir durumdur (tarayıcı içeriği sniff eder), bu yüzden
# kontrol "hiçbir görsel biçimi DEĞİL" durumuna bakar, uzantı-içerik uyumuna değil.
bad_assets=$(node -e '
const fs = require("fs"), path = require("path");
const roots = ["mimarlar", "mimarlar-thumb", "logos", "logos-thumb", "projects", "miras"];
const exts = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const out = [];
const walk = (dir) => {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!exts.has(path.extname(e.name).toLowerCase())) continue;
    const fd = fs.openSync(p, "r"); const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0); fs.closeSync(fd);
    const isImage = (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
      || buf.slice(0, 4).toString("latin1") === "\x89PNG"
      || buf.slice(0, 4).toString("latin1") === "RIFF"
      || buf.slice(0, 4).toString("latin1") === "GIF8";
    if (!isImage) out.push(p);
  }
};
roots.forEach(walk);
if (out.length) { console.log(out.slice(0, 20).join("\n")); process.exit(1); }
' 2>/dev/null)
if [ -n "$bad_assets" ]; then
  bad "görsel olmayan içerik taşıyan görsel dosya(lar) var:"
  echo "$bad_assets" >&2
else
  ok "tüm statik görsel dosyaları geçerli bir görsel imzasıyla başlıyor"
fi

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
check_prefetch_limit urun.html urun.html
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

# PORTFOLYO (kullanıcı isteği, 2026-09-08) — kişi ekle/düzenle'deki Portfolyo kutusu ve kişi
# pop-up'ındaki Portfolyo galerisi. Bu özellik BEŞ ayrı parçanın birlikte deploy edilmesine bağlı ve
# hiçbirinin eksikliği sözdizimi hatası vermez, SESSİZCE kırılır:
#   * js/vendor/pdfjs/* — kendi barındırılan pdf.js; yoksa PDF yükleyen kullanıcı "PDF okunamadı"
#     görür (CDN yok, CSP script-src 'self'),
#   * kisi-ekle.html -> pdf-pages.js — yoksa PDF sessizce görsel sanılıp reddedilir,
#   * architect-modal.js#am-portfolio-section — yoksa pop-up'ta bölüm hiç çizilmez,
#   * lazy-modals.js#architect deps -> gallery.js — yoksa initDetailGallery tanımsız kalır ve
#     portfolyo şeridi (guard sayesinde sessizce) hiç çizilmez,
#   * submissionTypes.js#architects.fields -> portfolio — yoksa form portfolyoyu gönderse bile
#     sunucu alanı yok sayar ve hiçbir şey kaydedilmez.
for f in js/vendor/pdfjs/pdf.min.mjs js/vendor/pdfjs/pdf.worker.min.mjs js/components/pdf-pages.js; do
  [ -s "$f" ] && ok "$f mevcut (portfolyo PDF boru hattı)" || bad "$f EKSİK — portfolyoya PDF yüklenemez"
done
grep -q 'js/components/pdf-pages.js' kisi-ekle.html \
  && ok "kisi-ekle.html — pdf-pages.js yükleniyor" \
  || bad "kisi-ekle.html — pdf-pages.js <script> etiketi yok, PDF sayfalara ayrılamaz"
grep -q "id=\"portfolio-preview-grid\"" kisi-ekle.html \
  && ok "kisi-ekle.html — Portfolyo kutusu mevcut" \
  || bad "kisi-ekle.html — #portfolio-preview-grid yok, Portfolyo kutusu kaybolmuş"
grep -q 'am-portfolio-section' js/components/architect-modal.js \
  && ok "architect-modal.js — Portfolyo bölümü mevcut" \
  || bad "architect-modal.js — am-portfolio-section yok, kişi pop-up'ında Portfolyo çizilmez"
grep -q "js/components/gallery.js'" js/components/lazy-modals.js \
  && ok "lazy-modals.js — kişi pop-up'ı gallery.js bağımlılığını yüklüyor" \
  || bad "lazy-modals.js — architect deps içinde gallery.js yok, portfolyo şeridi çizilmez"
grep -q "'portfolio'" src/lib/submissionTypes.js \
  && ok "submissionTypes.js — architects.portfolio alanı tanımlı" \
  || bad "submissionTypes.js — portfolio alanı yok, gönderilen portfolyo sunucuda yok sayılır"

echo ""
echo "5) GÜNDEM (kullanıcı isteği, 2026-09-06)"

# SSRF koruması birim testleri (hardening denetimi, 2026-09-07). Gündem testleriyle AYNI desen:
# saf, ağsız, npm bağımlılığı yok. Kapsam: engelleme matrisi (IPv4 alternatif yazımları, RFC1918,
# link-local/metadata, IPv4-eşlemeli IPv6, NAT64, sondaki noktalı localhost), AŞIRI engelleme
# regresyonu (gerçek kaynak host'ları + engellenen blokların sınır komşuları) ve yönlendirme
# zinciri. Bu testler düşerse deploy HİÇ BAŞLAMAZ — bkz. scripts/test-safefetch.mjs dosya başı.
if node scripts/test-safefetch.mjs >/tmp/preflight_ssrf 2>&1; then
  ok "SSRF koruması birim testleri geçti ($(grep -c '^  ok ' /tmp/preflight_ssrf) test)"
else
  bad "SSRF koruması birim testleri BAŞARISIZ:"
  tail -20 /tmp/preflight_ssrf >&2
fi

# Güvenli Görüşme Gateway'i / Google Meet testleri (kullanıcı isteği, 2026-09-08) — node:sqlite
# üzerinde GERÇEK schema.sql ile: erişim kontrolü (401/403/404), sahte saatle zaman kilidi,
# idempotency (ardışık + eşzamanlı), Google hata yönetimi, JWT imzası, admin onay akışı.
# Bkz. scripts/test-meet-gateway.mjs dosya başı.
if node scripts/test-meet-gateway.mjs >/tmp/preflight_meet 2>&1; then
  ok "görüşme gateway/Meet testleri geçti ($(grep -c '^  ok ' /tmp/preflight_meet) test)"
else
  bad "görüşme gateway/Meet testleri BAŞARISIZ:"
  tail -20 /tmp/preflight_meet >&2
fi
rm -f /tmp/preflight_meet

# 2026-09-08 turu (kullanıcı isteği maddeleri 1-6) — node:sqlite üzerinde GERÇEK schema.sql +
# migrations/0079 ile: atamanın gerçekten düzenleme yetkisi vermesi, 'Yönetici' görevi (yetki VERİR
# ama Kurucular/Ekip'te görünmez), Ekip kutusundan çıkarma cascade'i, noktalı ad araması
# ("r.a.f. studio"), `claimed` bayrağı ve Kurucular/Ekip aksan-katlamalı tekilleştirme.
# Bkz. scripts/test-2026-09-08-round.mjs dosya başı.
if node scripts/test-2026-09-08-round.mjs >/tmp/preflight_0908 2>&1; then
  ok "atama/görev/arama/claimed/onay-kapısı testleri geçti ($(grep -c '^  ok ' /tmp/preflight_0908) test)"
else
  bad "atama/görev/arama/claimed testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_0908 >&2
fi
rm -f /tmp/preflight_0908

# Hesabım > Mesajlar konuşma avatarları (kullanıcı bulgusu, 2026-09-08) — node:sqlite üzerinde
# GERÇEK schema.sql + GERÇEK rota (handleMessagesRoute). Regresyon: listMyThreads gönderen
# yönündeki konuşmalarda otherPhotoUrl'yi koşulsuz null yazıyordu, yani kullanıcının kendi
# başlattığı her konuşma baş harflerle görünüyordu. Bkz. scripts/test-messages-avatars.mjs.
if node scripts/test-messages-avatars.mjs >/tmp/preflight_msgav 2>&1; then
  ok "mesaj konuşma avatarı testleri geçti ($(grep -c '^  ok ' /tmp/preflight_msgav) test)"
else
  bad "mesaj konuşma avatarı testleri BAŞARISIZ:"
  tail -20 /tmp/preflight_msgav >&2
fi
rm -f /tmp/preflight_msgav

# Firma/marka İş / Staj İlanları (kullanıcı isteği, 2026-09-11) — node:sqlite üzerinde GERÇEK
# schema.sql + GERÇEK rota (handleOfficeJobsRoute): yalnızca künyeyi düzenleyebilen (admin, Kurucu/
# Ortak/Ekip Lideri/Yönetici claim'i) yayınlar/kaldırır; görsel yalnızca kendi /media/u/ yüklemesi.
if node scripts/test-2026-09-11-office-jobs.mjs >/tmp/preflight_jobs 2>&1; then
  ok "iş / staj ilanı testleri geçti ($(grep -c '^  ok ' /tmp/preflight_jobs) test)"
else
  bad "iş / staj ilanı testleri BAŞARISIZ:"
  tail -20 /tmp/preflight_jobs >&2
fi
rm -f /tmp/preflight_jobs

# Firma/marka yetkilisinin, firma ortaklarının KİŞİ profillerini düzenlemesi (kullanıcı isteği,
# 2026-09-08) — node:sqlite üzerinde GERÇEK schema.sql. Kural tek yerde (claimedProfiles.js#
# canEditArchitectViaOfficeMembership) yaşıyor ve HEM kaydetme kapısı (submissions.js#
# verifyClaimedProfileKey) HEM istemcinin Düzenle butonu (/api/claims/status -> delegatedEdit)
# onu okuyor; sapması sessizce ya yetkiyi kaldırır ya da başkasının profilini açar.
# Bkz. scripts/test-office-member-profile-edit.mjs dosya başı.
if node scripts/test-office-member-profile-edit.mjs >/tmp/preflight_omedit 2>&1; then
  ok "firma ortağı profil düzenleme yetkisi testleri geçti ($(grep -c '^  ok ' /tmp/preflight_omedit) test)"
else
  bad "firma ortağı profil düzenleme yetkisi testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_omedit >&2
fi
rm -f /tmp/preflight_omedit

# Telif ve Sorumluluk Beyanı kapısı + Arşivim (kullanıcı isteği, 2026-09-10 madde 1/2/3). Kapı ÜÇ
# ayrı uçta (POST/PATCH /api/<tip> ve POST /api/archive/publish) aynı yardımcıya bağlı; sapması
# ya beyanı atlatılabilir kılar ya da kullanıcıların kendi arşivlerini yayına almasını engeller.
# Bkz. scripts/test-rights-archive.mjs dosya başı.
if node scripts/test-rights-archive.mjs >/tmp/preflight_rights 2>&1; then
  ok "telif beyanı + Arşivim testleri geçti ($(grep -c '^  ok ' /tmp/preflight_rights) test)"
else
  bad "telif beyanı + Arşivim testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_rights >&2
fi
rm -f /tmp/preflight_rights

# Aramada önizleme ("soluk") kayıtları (kullanıcı isteği, 2026-09-10 madde 5). classicSearch'ün dört
# sorgusu HEM öneri penceresini HEM /arama'yı besler; biri `hidden_at IS NULL`a geri dönerse arşiv
# kayıtları aramadan sessizce kaybolur (ya da tam arşivdekiler sızar).
# Bkz. scripts/test-preview-search.mjs dosya başı.
if node scripts/test-preview-search.mjs >/tmp/preflight_prevsearch 2>&1; then
  ok "aramada önizleme kayıtları testleri geçti ($(grep -c '^  ok ' /tmp/preflight_prevsearch) test)"
else
  bad "aramada önizleme kayıtları testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_prevsearch >&2
fi
rm -f /tmp/preflight_prevsearch

# profile_claims.profile_key'in KANONİK BİÇİMİ (kullanıcı isteği, 2026-09-10: "firmaya yönetici
# atadım ama 'Bu firma sana mı ait?' kutusu kaybolmadı"). Anahtarı yazan ÜÇ yol var (POST
# /api/claims, POST /api/admin/claims, ensurePendingOfficeClaims) ve OKUYAN her yer canonical ADI
# bekliyor; biri slug/legacy_key yazarsa sahiplik sessizce görünmez olur — canlıda tam olarak bu
# oldu. Bkz. scripts/test-claim-key-canonical.mjs dosya başı.
if node scripts/test-claim-key-canonical.mjs >/tmp/preflight_claimkey 2>&1; then
  ok "sahiplenme anahtarı kanonik biçim testleri geçti ($(grep -c '^  ok ' /tmp/preflight_claimkey) test)"
else
  bad "sahiplenme anahtarı kanonik biçim testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_claimkey >&2
fi

# Kişi adı baş harfi + sahiplenilmiş firma/markada davet kutusunun gizlenmesi + Geri Bildirim metni
# (kullanıcı isteği, 2026-09-10 dokuzuncu tur). Ad normalizasyonu YAZMA anında yapılır (name aynı
# zamanda ANAHTAR, bkz. src/lib/textMatch.js#titleCasePersonName); davet kutusu kapısı ise TEK bir
# istemci satırı — bu test o satırın sessizce geri alınmasını yakalar.
# Cascade silmede slug çakışması (canlı bulgu, denetim 2026-09-10): slugify TEKİL DEĞİL —
# "r.a.f.studio" ile "r.a.f. studio" aynı etkileşim anahtarına düşüyor ve mükerreri silmek hayatta
# kalan kaydın kaydettiklerini/paylaştıklarını da siliyordu.
if node scripts/test-cascade-delete-slug-collision.mjs >/tmp/preflight_cascadeslug 2>&1; then
  ok "cascade silme slug çakışması testleri geçti ($(grep -c '^  ok ' /tmp/preflight_cascadeslug) test)"
else
  bad "cascade silme slug çakışması testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_cascadeslug >&2
fi

# Doğrulanmamış girdi -> D1 500 sınıfı (canlı bulgular, denetim 2026-09-10): (1) 49+ karakterlik TEK
# bir arama kelimesi "LIKE or GLOB pattern too complex" ile, (2) devasa bir ?page= değeri güvenli
# tamsayı aralığını aşarak sorguyu düşürüyordu. İkisi de artık tek bir yardımcıdan geçiyor
# (searchFold.js#likePattern, http.js#pageParam); bu test o kapıların kalmasını sağlar.
if node scripts/test-input-limits.mjs >/tmp/preflight_inputlimits 2>&1; then
  ok "girdi sınırı (LIKE deseni + ?page=) testleri geçti ($(grep -c '^  ok ' /tmp/preflight_inputlimits) test)"
else
  bad "girdi sınırı (LIKE deseni + ?page=) testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_inputlimits >&2
fi

if node scripts/test-2026-09-10-round9.mjs >/tmp/preflight_round9 2>&1; then
  ok "kişi adı baş harfi + davet kutusu + geri bildirim testleri geçti ($(grep -c '^  ok ' /tmp/preflight_round9) test)"
else
  bad "kişi adı baş harfi + davet kutusu + geri bildirim testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_round9 >&2
fi

# Kullanıcı isteği, 2026-09-10 onuncu tur: sahiplenilmiş firmanın kurucusu da sahiplenilmiş sayılır
# (kaynak ibaresi + davet kutusu), /proje/sayfa-N popup URL'i değildir (modal-shell.js), Fotoğrafçı
# kutusundaki firma/marka Kaynak'ı web sitesiyle doldurur. Bkz. scripts/test-2026-09-10-round10.mjs.
if node scripts/test-2026-09-10-round10.mjs >/tmp/preflight_round10 2>&1; then
  ok "kurucu sahiplenme + sayfalama popup deseni + Kaynak otomatik doldurma testleri geçti ($(grep -c '^  ok ' /tmp/preflight_round10) test)"
else
  bad "kurucu sahiplenme + sayfalama popup deseni + Kaynak otomatik doldurma testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_round10 >&2
fi
rm -f /tmp/preflight_claimkey

# Kullanıcı isteği, 2026-09-10 on birinci tur: claim kutusu flash'ı, önizleme kişi/firma/marka
# popup'larının açılabilir olması (görseller blurlu), withSingleFlight bayat girdi koruması.
# Bkz. scripts/test-2026-09-10-round11.mjs.
if node scripts/test-2026-09-10-round11.mjs >/tmp/preflight_round11 2>&1; then
  ok "önizleme popup + claim flash + single-flight testleri geçti ($(grep -c '^  ok ' /tmp/preflight_round11) test)"
else
  bad "önizleme popup + claim flash + single-flight testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_round11 >&2
fi

# Kullanıcı isteği, 2026-09-11: Kişi sayfasındaki bir adla üye olunabilir, daha önce üye olan bir
# kullanıcının adıyla olunamaz; aynı adla yeni kişi paylaşımı reddedilmeye devam eder.
# Bkz. scripts/test-2026-09-11-signup-name.mjs.
if node scripts/test-2026-09-11-signup-name.mjs >/tmp/preflight_signup_name 2>&1; then
  ok "üye ol ad soyad kuralı testleri geçti ($(grep -c '^  ok ' /tmp/preflight_signup_name) test)"
else
  bad "üye ol ad soyad kuralı testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_signup_name >&2
fi

# Kullanıcı isteği, 2026-09-11: önizleme popup'ında yayındaki kayıtlara giden kartlar net görünür;
# blur yalnızca kaydın kendi medyasında. Bkz. scripts/test-2026-09-11-preview-related-cards.mjs.
if node scripts/test-2026-09-11-preview-related-cards.mjs >/tmp/preflight_preview_related 2>&1; then
  ok "önizleme popup ilgili kart muafiyeti testleri geçti ($(grep -c '^  ok ' /tmp/preflight_preview_related) test)"
else
  bad "önizleme popup ilgili kart muafiyeti testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_preview_related >&2
fi

# Hub sayfalarının ilk çizim bağımlılıkları SENKRON olmalı (kullanıcı isteği, 2026-09-10: "mobilde
# kişiler sayfası takılı kaldı"). İlk liste çizimi artık DOMContentLoaded'ı beklemiyor; bu yüzden
# çizimin dokunduğu image-cdn.js (tüm hub'lar) ve catalog-taxonomy.js (urun) defer OLMADAN yüklenmeli,
# proje.html'de ise js/pages/proje.js modal-shell.js'ten ÖNCE gelmeli. Biri geri dönerse kart çizimi
# "cdnImg is not defined" ile sessizce boş kalır — bu kontrol o gerilemeyi deploy'dan önce yakalar.
# arama.html EKLENDİ (canlı bulgu, 2026-09-10 audit): bu sayfa da ilk çizimini DOMContentLoaded'ı
# beklemeden yapıyor (top-level runSearch()) ama image-cdn.js'i defer ile yüklüyordu — /arama?q=…
# konsolunda her aramada "cdnImg is not defined" hatası oluşuyor, sonuçlar ancak rozetler gelince
# yapılan İKİNCİ render'da görünüyordu.
for page in index.html proje.html kisi.html firma.html marka.html urun.html arama.html; do
  if grep -q '<script src="image-cdn.js" defer>' "$page"; then
    bad "$page — image-cdn.js defer ile yükleniyor; ilk çizim senkron cdnImg bekler"
  else
    ok "$page — image-cdn.js senkron"
  fi
done
if grep -q '<script src="catalog-taxonomy.js" defer>' urun.html; then bad "urun.html — catalog-taxonomy.js defer; ilk katalog çizimi senkron bekler"; else ok "urun.html — catalog-taxonomy.js senkron"; fi
proje_js_line=$(grep -n 'src="js/pages/proje.js"' proje.html | head -1 | cut -d: -f1)
modal_shell_line=$(grep -n 'src="js/components/modal-shell.js"' proje.html | head -1 | cut -d: -f1)
if [ -n "$proje_js_line" ] && [ -n "$modal_shell_line" ] && [ "$proje_js_line" -lt "$modal_shell_line" ]; then
  ok "proje.html — js/pages/proje.js modal-shell.js'ten önce (ilk çizim modal kodunu beklemez)"
else
  bad "proje.html — js/pages/proje.js modal-shell.js'ten SONRA (proje_js=$proje_js_line, modal_shell=$modal_shell_line)"
fi

# Unicode NFC normalizasyonu (kullanıcı isteği, 2026-09-10: "doçem yazınca çıkmıyor, docem yazınca
# çıkıyor"). İki nedenle deploy'u durduracak kadar önemli: (a) ayrışık yazılan Türkçe harf sitedeki
# HİÇBİR aramada eşleşmiyordu; (b) foldTr'nin çıktısı D1'in name_fold/title_fold/brand_fold
# generated kolonlarıyla BİREBİR aynı kalmak zorunda (bazı uçlar eşitlik kurar) — bu test o
# sözleşmeyi sabitler. Bkz. scripts/test-unicode-normalize.mjs dosya başı.
if node scripts/test-unicode-normalize.mjs >/tmp/preflight_nfc 2>&1; then
  ok "Unicode NFC + fold kolonu sözleşmesi testleri geçti ($(grep -c '^  ok ' /tmp/preflight_nfc) test)"
else
  bad "Unicode NFC + fold kolonu sözleşmesi testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_nfc >&2
fi
rm -f /tmp/preflight_nfc

# Kişi->firma ters cascade + yetkiye bağlı arşivle/sil (kullanıcı isteği, 2026-09-10 ikinci tur
# madde 1/2). İkisi de tek yerde yaşayan ve BİRDEN FAZLA yüzeyden okunan kurallar:
# cascadeRemovedOfficesFromArchitect (POST ve PATCH /api/architects) ve canAccessSubmissionRow
# (düzenleme + moderasyon aynı kapı). Sapması ya firma künyesinde hayalet isim bırakır ya da
# kullanıcının kendi içeriğini arşivlemesini engeller.
# Bkz. scripts/test-2026-09-10-round2.mjs dosya başı.
if node scripts/test-2026-09-10-round2.mjs >/tmp/preflight_r2 2>&1; then
  ok "ters cascade + yetkili arşivle/sil testleri geçti ($(grep -c '^  ok ' /tmp/preflight_r2) test)"
else
  bad "ters cascade + yetkili arşivle/sil testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_r2 >&2
fi
rm -f /tmp/preflight_r2

# Atama -> ilgili tüm içeriğin eş zamanlı yayına alınması (kullanıcı isteği, 2026-09-10 altıncı tur).
# Kural tek yerde (admin.js#activateClaimedProfile) ama atamanın İKİ admin yolu da onu çağırıyor;
# sapması "kişi canlı ama firması soluk hayalet" durumunu geri getirir (canlı bulgu: Melis Varkal).
# Bkz. scripts/test-claim-activation-cascade.mjs dosya başı.
if node scripts/test-claim-activation-cascade.mjs >/tmp/preflight_actv 2>&1; then
  ok "atama cascade + telif kutucuğu testleri geçti ($(grep -c '^  ok ' /tmp/preflight_actv) test)"
else
  bad "atama cascade + telif kutucuğu testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_actv >&2
fi
rm -f /tmp/preflight_actv

# Firmaya kullanıcı atanınca ZATEN CANLI en son yayınlanan projesinin proje sayfasında 1. sıraya
# geçmesi (kullanıcı isteği, 2026-09-11 — örnek: Per Se Mimarlık'a yönetici/kurucu atanınca).
# Kural tek yerde (admin.js#promoteOfficeProjectsOnAssignment), yukarıdaki önizleme cascade'inden
# (RELIST_TOP_PER_TYPE) BİLEREK ayrı — activated.projects kümesi buraya dışlanarak geçilmezse iki
# kural birbirinin relisted_at'ini üzerine yazar. Bkz. scripts/test-office-project-promotion.mjs.
if node scripts/test-office-project-promotion.mjs >/tmp/preflight_projpromo 2>&1; then
  ok "firma projesi 1. sıraya promosyon testleri geçti ($(grep -c '^  ok ' /tmp/preflight_projpromo) test)"
else
  bad "firma projesi 1. sıraya promosyon testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_projpromo >&2
fi
rm -f /tmp/preflight_projpromo

# Admin önizlemedeki firmayı ya da KİŞİYİ yayına alınca grafı da yayına çıkar (projeler, firmadaki
# kişiler; en son proje 1. sıraya) — kullanıcı isteği 2026-09-11 (firma) + 2026-09-12 ("yayına
# alınmış mimarların projeleri de"); firma popup'ında Ekip Lideri Ekip'te. Kural tek yerde
# (admin.js#activateProfilesOnPublish), iki tetikleyicisi var: submissions.js ve
# legacyContent.js#runContentAction. Bkz. scripts/test-2026-09-11-office-publish-cascade.mjs.
if node scripts/test-2026-09-11-office-publish-cascade.mjs >/tmp/preflight_offpub 2>&1; then
  ok "firma/kişi yayını cascade + Ekip Lideri testleri geçti ($(grep -c '^  ok ' /tmp/preflight_offpub) test)"
else
  bad "firma/kişi yayını cascade + Ekip Lideri testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_offpub >&2
fi
rm -f /tmp/preflight_offpub

# Gündem KULLANICI GÖNDERİLERİ (kullanıcı isteği, 2026-09-11): gönder → admin onayı → public liste +
# profil şeridi; sahibin düzenlemesi yeniden onaya düşer; yayın kapısı yalnızca admin moderate ucu.
# Bkz. scripts/test-2026-09-11-gundem-user-submissions.mjs.
if node scripts/test-2026-09-11-gundem-user-submissions.mjs >/tmp/preflight_gundem_user 2>&1; then
  ok "Gündem kullanıcı gönderisi testleri geçti ($(grep -c '^  ok ' /tmp/preflight_gundem_user) test)"
else
  bad "Gündem kullanıcı gönderisi testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_gundem_user >&2
fi
rm -f /tmp/preflight_gundem_user

# "Görüldü" okunma bildirimi (kullanıcı isteği, 2026-09-11) — bkz. src/routes/messages.js#getThread,
# migrations/0112_message_reads.sql. Bkz. scripts/test-message-seen-receipt.mjs dosya başı.
if node scripts/test-message-seen-receipt.mjs >/tmp/preflight_seen 2>&1; then
  ok "mesaj görüldü bildirimi testleri geçti ($(grep -c '^  ok ' /tmp/preflight_seen) test)"
else
  bad "mesaj görüldü bildirimi testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_seen >&2
fi
rm -f /tmp/preflight_seen

# Bildirim noktaları + tıklanabilir gönderen profili (kullanıcı isteği, 2026-09-12) — bkz.
# src/routes/auth.js#me (unreadCount), src/routes/admin.js#countNewUsers,
# src/routes/messages.js#resolveSenderProfile. Bkz. scripts/test-2026-09-12-notification-dots.mjs.
if node scripts/test-2026-09-12-notification-dots.mjs >/tmp/preflight_dots 2>&1; then
  ok "bildirim noktası + gönderen profili testleri geçti ($(grep -c '^  ok ' /tmp/preflight_dots) test)"
else
  bad "bildirim noktası + gönderen profili testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_dots >&2
fi
rm -f /tmp/preflight_dots

# Boşluksuz yazım araması ("perse" -> "Per Se Mimarlık", kullanıcı isteği 2026-09-11) — bkz.
# src/lib/classicSearch.js#collapsedToken/likeCondition. Bkz. scripts/test-search-word-merge.mjs.
if node scripts/test-search-word-merge.mjs >/tmp/preflight_wmerge 2>&1; then
  ok "boşluksuz yazım araması testleri geçti ($(grep -c '^  ok ' /tmp/preflight_wmerge) test)"
else
  bad "boşluksuz yazım araması testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_wmerge >&2
fi
rm -f /tmp/preflight_wmerge

# Firma/marka üyelik listesi — kisi-ekle.html ile Profili Düzenle'nin (auth-modal.js) ORTAK
# birleştiricisi (kullanıcı isteği, 2026-09-08: "admin tarafından dahi olsa görevlendiriliyorsa kişi
# ekle/düzenle sayfasında da gözüksün"). Regresyon: kisi-ekle yalnızca kaydın `office` metnini okuyordu,
# talepler/office_founders bağları görünmüyor ve Kaydet'te admin ataması siliniyordu. Saf test
# (node:vm), ayrıca iki yüzeyin aynı yardımcıyı çağırdığını kaynak üzerinden doğrular.
# Bkz. scripts/test-office-membership-names.mjs dosya başı.
if node scripts/test-office-membership-names.mjs >/tmp/preflight_omnames 2>&1; then
  ok "firma/marka üyelik birleştirici testleri geçti ($(grep -c '^  ok ' /tmp/preflight_omnames) test)"
else
  bad "firma/marka üyelik birleştirici testleri BAŞARISIZ:"
  tail -25 /tmp/preflight_omnames >&2
fi
rm -f /tmp/preflight_omnames

# slugify TR/aksan haritası BEŞ dosyada kopyalı (bkz. src/lib/slugify.js dosya başı: save-widget.js
# ve *-ekle.html tarayıcıda modülsüz çalıştığından bilerek kopyalanmış). Biri sapan bir kopya SESSİZ
# bir hatadır: sunucunun ürettiği slug ile istemcinin kaydet/takip anahtarı ayrışır ve buton durumu
# ya da temiz URL eşleşmesi bozulur. Karşılaştırma harita İÇERİĞİ üzerinden (yorumlar/boşluk hariç).
slug_sig() { tr -d ' \n' < "$1" | grep -o "ç:'c'.*Đ:'d'" | head -1; }
slug_ref="$(slug_sig src/lib/slugify.js)"
slug_drift=""
if [ -z "$slug_ref" ]; then
  bad "slugify TR/aksan haritası src/lib/slugify.js'te bulunamadı (biçim değişmiş olabilir)"
else
  for f in save-widget.js marka-ekle.html firma-ekle.html kisi-ekle.html; do
    [ "$(slug_sig "$f")" = "$slug_ref" ] || slug_drift="$slug_drift $f"
  done
  if [ -n "$slug_drift" ]; then bad "slugify haritası src/lib/slugify.js'ten SAPMIŞ:$slug_drift"
  else ok "slugify haritası beş kopyada da aynı"; fi
fi
# Bildirim linki /gorusme/:uuid'e gidebilmeli — auth-modal.js#NOTIF_ENTITY_PATH_RE 'gorusme'
# içermezse "görüşmen hazır" bildirimi tıklanınca hiçbir yere gitmez (sessiz regresyon).
if grep -q "function meetingRoomUuidFromLink" js/components/auth-modal.js && grep -q "MeetingRoom.open(meetingRoomUuid)" js/components/auth-modal.js; then
  ok "auth-modal.js — Meet bildirimi görüşme odası popup'ını açıyor"
else
  bad "auth-modal.js — meetingRoomUuidFromLink/MeetingRoom.open dalı kayıp (Meet bildirimi tıklanınca hiçbir şey açmaz)"
fi
# Bildirim linki /gorusme/ olduğu için NOTIF_ENTITY_PATH_RE'ye de eklenmemeli — iki dal aynı linki
# sahiplenirse biri sessizce ölü kod olur (bu depodaki klasik ayrışma tuzağı).
if grep -q "NOTIF_ENTITY_PATH_RE = .*|gorusme)" js/components/auth-modal.js; then
  bad "auth-modal.js — 'gorusme' hem NOTIF_ENTITY_PATH_RE'de hem popup dalında (ikili yol)"
else
  ok "auth-modal.js — görüşme odası linki için tek yol var (popup dalı)"
fi
# Sayfa rotası + kabuk + API ucu üçü birlikte var olmalı (bu depodaki "parça taşınınca sessizce öldü" tuzağı).
gw_missing=""
grep -q "serveMeetingRoomPage" src/index.js || gw_missing="$gw_missing src/index.js(route)"
[ -f gorusme.html ] || gw_missing="$gw_missing gorusme.html(kabuk)"
grep -q "getRoomState" src/routes/consultations.js || gw_missing="$gw_missing consultations.js(api)"
[ -f js/components/meeting-room.js ] || gw_missing="$gw_missing meeting-room.js(ortak render)"
grep -q "MeetingRoom.mount" gorusme.html || gw_missing="$gw_missing gorusme.html(mount)"
# <base href="/"> — sayfa /gorusme/:uuid altında servis edilir; yoksa nav logosu dahil TÜM göreli
# kaynak yolları o iç içe yola göre çözümlenip 404 olur (2026-09-08'de canlıda görülen hata).
grep -q '<base href="/">' gorusme.html || gw_missing="$gw_missing gorusme.html(base-href)"
grep -q '<base href="/">' pano.html || gw_missing="$gw_missing pano.html(base-href)"
grep -q "room_uuid" schema.sql || gw_missing="$gw_missing schema.sql(kolon)"
if [ -n "$gw_missing" ]; then bad "Görüşme gateway'i eksik parça(lar):$gw_missing"; else ok "Görüşme gateway'i — route + kabuk + api + şema dördü de yerinde"; fi

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

# image-lightbox.js — Gündem'de görsel TEK tıklanabilir öğedir (kullanıcı isteği 2026-09-07
# madde 1). Betik düşerse tıklama sessizce yeni-sekme fallback'ine düşer ve popup engelleyiciye
# takılır; canlıda tam olarak bu oldu (betik kümesi kısaltılırken kazara çıkmıştı).
if grep -q 'js/components/image-lightbox.js' gundem.html; then
  ok "gundem.html — image-lightbox.js yükleniyor (görsel büyütme çalışır)"
else
  bad "gundem.html — image-lightbox.js kayıp; görsele tıklama popup açmaz"
fi

# SSR konteyneri — yukarıdaki dört liste sayfasıyla AYNI gerekçe (src/index.js#serveGundemListPage
# ve #injectMeta bu id'yi hedefliyor; kaybolursa SSR gövdesi sessizce hiçbir yere basılmaz).
if grep -q 'id="ssr-entity-body"' gundem.html; then
  ok "gundem.html — #ssr-entity-body konteyneri mevcut"
else
  bad "gundem.html — #ssr-entity-body konteyneri kayıp (SSR body enjeksiyonu bozulmuş olabilir)"
fi

# OKUNDU İŞARETİ (kullanıcı isteği, 2026-09-07) — ÜÇ parça birlikte çalışmak zorunda ve biri
# eksilirse hata SESSİZDİR: buton basılır ama tıklama 404 alır (route kayıp), ya da hiç basılmaz
# (kart işaretlemesi kayıp), ya da işaretli/işaretsiz hali aynı görünür (stil kayıp). Bu depoda
# "parçalardan biri taşınınca özellik sessizce öldü" tekrar eden kök nedendir.
reads_missing=""
grep -q "'/api/reads'" src/index.js || reads_missing="$reads_missing src/index.js(route)"
grep -q 'gundem-read-btn' js/pages/gundem.js || reads_missing="$reads_missing js/pages/gundem.js(buton)"
grep -q 'gundem-read-btn' gundem.html || reads_missing="$reads_missing gundem.html(stil)"
grep -q 'read_items' schema.sql || reads_missing="$reads_missing schema.sql(tablo)"
if [ -n "$reads_missing" ]; then
  bad "Okundu işareti eksik parça(lar):$reads_missing"
else
  ok "Okundu işareti — route + buton + stil + tablo dördü de yerinde"
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

# Gündem sıralaması GÖSTERİLEN tarihe göre olmalı (kullanıcı isteği 2026-09-07: "her zaman en
# yakın tarihten en eskiye"). Kart source_published_at gösterir; sıralama published_at'e (ingest
# anı) dönerse fark normal cron turunda GÖRÜNMEZ ve ancak toplu bir yazımda ortaya çıkar — yani
# sessizce geri gelebilecek bir regresyondur. Bu yüzden statik olarak kontrol edilir.
gundem_sort_raw=$(grep -c 'ORDER BY published_at DESC' src/routes/gundem.js src/routes/gundemAdmin.js | awk -F: '{s+=$2} END {print s+0}')
if ! grep -q "^export const GUNDEM_SORT = 'COALESCE(source_published_at, published_at) DESC';" src/routes/gundem.js; then
  bad "src/routes/gundem.js — GUNDEM_SORT sabiti kayıp/değişmiş (liste sıralaması gösterilen tarihe bağlı olmalı)"
elif [ "$gundem_sort_raw" != "0" ]; then
  bad "gundem sıralaması ayrışmış: $gundem_sort_raw sorgu hâlâ ham 'ORDER BY published_at DESC' kullanıyor"
else
  ok "gundem liste sıralaması gösterilen tarihe bağlı (GUNDEM_SORT)"
fi

# İfade index'i sıralama ifadesiyle BİREBİR eşleşmeli — SQLite ifade index'ini yalnızca yapısı
# eşleşen ifadede kullanır; ayrışırsa sorgu sessizce tam tablo taramasına düşer.
if grep -q 'COALESCE(source_published_at, published_at) DESC' schema.sql; then
  ok "schema.sql — gundem sıralama index'i mevcut ve ifadeyle hizalı"
else
  bad "schema.sql — gundem sıralama index'i kayıp (liste sorguları tam tablo taramasına düşer)"
fi

rm -f /tmp/preflight_gundem

echo ""
echo "5b) Deploy kapıları — çıplak wrangler deploy bypass'ı kapalı mı"
# CANLI BULGU (denetim, 2026-09-10): miras/, worktree-dal ve working-tree kapıları YALNIZCA
# deploy.sh içindeydi; başka bir terminalden çıplak `npx wrangler deploy` üçünü birden atlıyordu
# (2026-08-23'te tam bu yolla iki commit'siz production deploy'u oluştu). Kapılar artık
# scripts/deploy-guard.sh'te tek kaynak ve wrangler'ın build hook'undan da çalışıyor. Bu üç kontrol,
# o zincirin sessizce kopmasını yakalar.
if [ -f scripts/deploy-guard.sh ]; then
  ok "scripts/deploy-guard.sh mevcut"
else
  bad "scripts/deploy-guard.sh KAYIP — deploy kapıları tek kaynağını yitirdi"
fi
if grep -q 'deploy-guard.sh --hook' wrangler.jsonc; then
  ok "wrangler.jsonc — build hook deploy-guard'ı çağırıyor (çıplak deploy kapıdan geçer)"
else
  bad "wrangler.jsonc — build.command deploy-guard.sh'i ÇAĞIRMIYOR; çıplak 'wrangler deploy' tüm kapıları atlar"
fi
if grep -q '^\./scripts/deploy-guard\.sh$' deploy.sh && grep -q 'MIMARLAB_DEPLOY_GUARD=1 npx wrangler deploy' deploy.sh; then
  ok "deploy.sh — kapıları guard'dan çağırıyor ve hook'u bypass değişkeniyle no-op yapıyor"
else
  bad "deploy.sh — deploy-guard.sh çağrısı ya da MIMARLAB_DEPLOY_GUARD bypass'ı kayıp"
fi
# Deploy sonrası sürüm doğrulaması ÖNBELLEKTEN BAĞIMSIZ olmalı (canlı bulgu, denetim 2026-09-10):
# 4b eskiden anasayfa HTML'ini çekiyordu; o sayfa edge'de s-maxage=300 ile durduğundan deploy'dan
# hemen sonra ÖNCEKİ sürümü taşıyan bayat bir kopya dönüyor, kontrol yanlış yere başarısız oluyor ve
# deploy.sh smoke-test'i HİÇ çalıştırmadan duruyordu.
if grep -q "assetVersion: deployVersion(env)" src/index.js; then
  ok "/api/_health assetVersion döndürüyor (önbeleksiz sürüm doğrulaması)"
else
  bad "src/index.js — /api/_health assetVersion alanı kayıp; health-check 4b tekrar bayat HTML'e bağımlı kalır"
fi
if grep -q "jq -r '.assetVersion // empty'" scripts/health-check.sh; then
  ok "health-check 4b sürümü /api/_health'ten okuyor (HTML'den değil)"
else
  bad "scripts/health-check.sh — 4b assetVersion'ı /api/_health'ten okumuyor"
fi

# Kapıların KENDİSİ hâlâ deploy.sh'te kopyalanmış olmasın (iki kaynak = biri unutulur).
if grep -q 'MIN_MIRAS_FILES' deploy.sh; then
  bad "deploy.sh miras kontrolünü hâlâ kendi içinde yapıyor — kapılar iki yerde, biri ayrışır"
else
  ok "deploy.sh kapıları kopyalamıyor (tek kaynak: scripts/deploy-guard.sh)"
fi

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
