# MİMARLAB — Profil Sahiplenme Davet E-postası (Firma + Kurucular)

Firmalara ve firmanın kurucu / kurucu ortak / ortaklarına gönderilecek **ortak**
davet metni. Tek e-posta, tek gönderi: hem firma profilinin hem de kurucuların
kişi profillerinin linkleri metnin içinde yer alır.

Metin, MİMARLAB kurucusu **Y. Mimar ve Mimarlık Tarihçisi Kaan Çorbacı** ağzından,
birinci tekil şahısla yazılmıştır — kurumsal bir duyuru değil, kişisel bir
davettir. Bu yüzden imza da kişiseldir.

## Yer tutucular

| Yer tutucu | Açıklama | Nereden alınır |
|---|---|---|
| `{FIRMA_ADI}` | Firmanın tam adı | `/api/offices/names` → `name` |
| `{FIRMA_URL}` | Firma profili | `https://mimarlab.com/firma/{slug}` |
| `{KURUCU_LINKLERI}` | Her satırda bir kurucu: `- Ad Soyad (Rol) — URL` | `/api/office/{slug}` → `founders[]` |
| `{DOGRULAMA_KODU}` | Firmaya özgü kod: `lab211`, `lab212`, `lab213` … | Gönderim sırasına göre artan; `gonderim-listesi.csv` |

`{KURUCU_LINKLERI}` satır formatı:

```
- {AD_SOYAD} ({ROL}) — https://mimarlab.com/kisi/{kisi_slug}
```

Firmanın kayıtlı kurucusu yoksa `{KURUCU_LINKLERI}` bloğu ve onu tanıtan cümle
metinden tamamen çıkarılır.

**Tekil / çoğul kuralı.** Kurucu sayısına göre tanıtan cümle değişir:

- Birden fazla kurucu: `Kurucularınızın kişi profilleri de platformda yer alıyor:`
- Tek kurucu: `Kurucunuzun kişi profili de platformda yer alıyor:`

## Doğrulama kodu

Her firmaya benzersiz bir kod verilir: listedeki ilk firma `lab211`, ikincisi
`lab212`, üçüncüsü `lab213` … Firma, profildeki sahiplenme kutusuna bu kodu
doğrulama notu olarak yazar. Böylece gelen sahiplenme talebi, gönderilen
e-postayla birebir eşleştirilebilir. Kod ↔ firma eşleşmesi
`gonderim-listesi.csv` dosyasında tutulur.

## Bağlantı biçimi

İlk cümledeki **MİMARLAB** kelimesi `https://mimarlab.com` adresine köprü olarak
bağlanır. Gmail'de elle yazarken kelimeyi seçip Ctrl+K ile linki ekle; HTML
gönderimde aşağıdaki HTML sürümünü kullan. Düz metinde link, kelimenin yanında
parantez içinde açık yazılır.

---

## Şablon — düz metin

**Konu:** {FIRMA_ADI} profiliniz MİMARLAB'da yayında

```
Sayın {FIRMA_ADI} Ekibi,

Ben MİMARLAB'ın (https://mimarlab.com) kurucusu Y. Mimar ve Mimarlık Tarihçisi
Kaan Çorbacı.

MİMARLAB; mimarlık, iç mimarlık, peyzaj ve ürün tasarımını tek bir dinamik ağda
toplayan Türkiye'nin en gelişmiş mimarlık ve ürün rehberidir. Yapay zekâ
destekli arama altyapısıyla projeleri, malzemeleri ve üreticileri birbirine
bağlar; mimarlar, fotoğrafçılar, markalar ve tasarımcılar için kapsamlı bir
araştırma ve ortak üretim merkezi sunar.

{FIRMA_ADI} profili şu anda MİMARLAB'da yayında:
{FIRMA_URL}

Kurucularınızın kişi profilleri de platformda yer alıyor:
{KURUCU_LINKLERI}

Bu profilleri kamuya açık kaynaklardan derledim. Yönetimlerini devraldığınızda
proje künyelerini, ekip bilgilerini ve görselleri doğrudan siz kontrol eder,
yeni projelerinizi yayınlayabilirsiniz. Ücretsizdir.

Platformu henüz kimseye duyurmadım; şu aşamada yalnızca profili yayında olan
firmalara yazıyorum. Profilinin ya da bilgilerinin yayınlanmasını istemeyen
firma ve kişilerin kayıtlarını talepleri üzerine kaldırıyorum; bunun için bu
e-postayı yanıtlamanız yeterli.

Sahiplenmek için: profil sayfasını açın, "Bu firma sana mı ait?" (kişi
profillerinde "Bu profil sana mı ait?") başlığına tıklayın ve açılan not
alanına {DOGRULAMA_KODU} yazıp gönderin. Bu kod, talebinizi bu e-postayla
eşleştirmemi sağlıyor. Hesabınız yoksa: https://mimarlab.com/uye-ol

Saygılarımla,

Kaan Çorbacı
Kurucu, MİMARLAB
info@mimarlab.com | https://mimarlab.com
```

## Şablon — HTML gövde

```html
<p>Sayın {FIRMA_ADI} Ekibi,</p>

<p>Ben <a href="https://mimarlab.com">MİMARLAB</a>'ın kurucusu Y. Mimar ve
Mimarlık Tarihçisi Kaan Çorbacı.</p>

<p>MİMARLAB; mimarlık, iç mimarlık, peyzaj ve ürün tasarımını tek bir dinamik
ağda toplayan Türkiye'nin en gelişmiş mimarlık ve ürün rehberidir. Yapay zekâ
destekli arama altyapısıyla projeleri, malzemeleri ve üreticileri birbirine
bağlar; mimarlar, fotoğrafçılar, markalar ve tasarımcılar için kapsamlı bir
araştırma ve ortak üretim merkezi sunar.</p>

<p>{FIRMA_ADI} profili şu anda MİMARLAB'da yayında:<br>
<a href="{FIRMA_URL}">{FIRMA_URL}</a></p>

<p>Kurucularınızın kişi profilleri de platformda yer alıyor:</p>
<ul>{KURUCU_LINKLERI_HTML}</ul>

<p>Bu profilleri kamuya açık kaynaklardan derledim. Yönetimlerini
devraldığınızda proje künyelerini, ekip bilgilerini ve görselleri doğrudan siz
kontrol eder, yeni projelerinizi yayınlayabilirsiniz. Ücretsizdir.</p>

<p>Platformu henüz kimseye duyurmadım; şu aşamada yalnızca profili yayında olan
firmalara yazıyorum. Profilinin ya da bilgilerinin yayınlanmasını istemeyen
firma ve kişilerin kayıtlarını talepleri üzerine kaldırıyorum; bunun için bu
e-postayı yanıtlamanız yeterli.</p>

<p>Sahiplenmek için: profil sayfasını açın, &laquo;Bu firma sana mı ait?&raquo;
(kişi profillerinde &laquo;Bu profil sana mı ait?&raquo;) başlığına tıklayın ve
açılan not alanına <strong>{DOGRULAMA_KODU}</strong> yazıp gönderin. Bu kod,
talebinizi bu e-postayla eşleştirmemi sağlıyor. Hesabınız yoksa:
<a href="https://mimarlab.com/uye-ol">https://mimarlab.com/uye-ol</a></p>

<p>Saygılarımla,<br><br>
Kaan Çorbacı<br>
Kurucu, MİMARLAB<br>
<a href="mailto:info@mimarlab.com">info@mimarlab.com</a> |
<a href="https://mimarlab.com">https://mimarlab.com</a></p>
```

`{KURUCU_LINKLERI_HTML}` satır formatı:

```html
<li>{AD_SOYAD} ({ROL}) &mdash; <a href="{KISI_URL}">{KISI_URL}</a></li>
```
