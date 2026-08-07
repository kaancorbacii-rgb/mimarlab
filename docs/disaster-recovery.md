# Disaster Recovery — D1 (Faz 4D)

## Hedefler

- **RPO (Recovery Point Objective) ≤ 24 saat** — bir olay anında kabul edilebilir
  maksimum veri kaybı penceresi.
- **RTO (Recovery Time Objective) ≤ 30 dakika** — sistemi tekrar ayağa kaldırma
  süresi.

## Birincil kurtarma mekanizması: D1 Time Travel

`mimarlab-db`, Cloudflare D1'in yerleşik **Time Travel** özelliğine sahip: D1 her
yazmayı sürekli olarak WAL tabanlı bir geçmişte tutar ve varsayılan olarak **son 30
gün** içindeki herhangi bir saniyeye geri dönülebilir — elle planlanan periyodik bir
yedeğe gerek kalmadan. Bu, aşağıdaki "manuel export tatbikatı"nın YERİNE değil,
onun ÜSTÜNE birincil, gerçek-olay kurtarma yoludur.

```bash
# Mevcut bookmark'ları/geri dönülebilir zaman aralığını gör
npx wrangler d1 time-travel info mimarlab-db

# Belirli bir zamana geri dön (veritabanını O ANA döndürür, in-place)
npx wrangler d1 time-travel restore mimarlab-db --timestamp=2026-08-07T10:00:00Z
```

**RPO sonucu:** Time Travel saniye/dakika seviyesinde granülerlik sağladığından
gerçek RPO ~dakikalar mertebesindedir — 24 saatlik hedefin çok altında.

## RTO runbook (tahmini süre bütçesiyle)

1. **Olay zamanını/son iyi durumu belirle** (~2 dk) — `wrangler tail` logları veya
   admin panelindeki son bilinen tutarlı kayıt zamanı.
2. **Time Travel restore çalıştır** (~1–5 dk, veritabanı boyutuna göre değişir):
   `npx wrangler d1 time-travel restore mimarlab-db --timestamp=<ISO8601>`
3. **Bütünlüğü doğrula** (~2 dk):
   `npx wrangler d1 execute mimarlab-db --remote --command "PRAGMA integrity_check;"`
   ve birkaç tablonun satır sayısını admin panelinden/CLI'dan gözle kontrol et.
4. **Gerekirse worker'ı yeniden deploy et** (~2–5 dk, yalnızca kod da geri
   alınıyorsa): `./deploy.sh` — kendi `scripts/health-check.sh`'i deploy'un
   sağlıklı olduğunu otomatik doğrular.
5. **Toplam tahmini süre: ~10–15 dakika** — 30 dakikalık RTO hedefinin altında.

## İkincil doğrulama: manuel export/checksum/restore tatbikatı

`scripts/d1-backup-drill.sh` — Time Travel'ın kendi iç mekanizmasından BAĞIMSIZ
olarak export'ların gerçekten geçerli/geri-yüklenebilir olduğunu doğrulayan,
periyodik (önerilen: haftalık) tekrarlanabilir bir tatbikat:

1. Bütünlük kontrolü (remote, salt-okunur). **Şeffaflık notu:** D1'in yönetilen
   query API'si `PRAGMA integrity_check`'e izin vermiyor (test edildi — `not
   authorized: SQLITE_AUTH [code: 7500]` döner; bu bir token/yetki sorunu değil,
   D1 platformunun kendi kısıtı). Bunun yerine D1'in İZİN VERDİĞİ eşdeğerler
   kullanılır: `PRAGMA quick_check` (integrity_check'in D1'de çalışan hafif
   sürümü) ve `PRAGMA foreign_key_check`.
2. `wrangler d1 export --remote` ile tam SQL dump.
3. `shasum -a 256` ile checksum (dump'ın bozulmadığını ileride doğrulamak için).
4. Dump'ı `scripts/output/` altında (gitignore'lu — gerçek üretim verisi içerdiği
   için asla commit edilmemeli) tek seferlik bir yerel SQLite dosyasına doğrudan
   `sqlite3` CLI'ı ile restore eder — mevcut `wrangler dev` geliştirme
   veritabanına dokunmaz. (`wrangler d1 execute --local --file=` bu boyuttaki bir
   dump'ta kendi statement-splitter'ında bir ayrıştırma kusuruyla karşılaştı —
   export'un kendisiyle ilgisiz; doğrudan `sqlite3` restore güvenilir sonuç verdi.)
5. Restore edilen kopyada satır sayılarını remote referansla karşılaştırır.

**Önemli:** Bu script prod D1 üzerinde HİÇBİR YAZMA/RESTORE işlemi yapmaz — yalnızca
salt-okunur `integrity_check` ve `export` çalıştırır. Prod restore hiçbir zaman bu
tatbikatın bir parçası değildir.

## Kapsam dışı / bilinen boşluklar (şeffaflık için not edildi)

- **R2 (`UPLOADS` bucket)** — D1 Time Travel'ın kapsamında değil; Cloudflare R2'nin
  kendi otomatik sürümleme/yedekleme özelliği ayrıca açılmadıysa yok. Bu fazın
  kapsamı dışında, ayrı bir değerlendirme gerektirir.
- **KV (`FACET_CACHE`)** — türetilmiş bir önbellek, D1'den yeniden hesaplanabilir;
  ayrı bir yedeğe ihtiyaç yok.
