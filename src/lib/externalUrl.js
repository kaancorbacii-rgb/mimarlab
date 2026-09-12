// DIŞ (harici) BAĞLANTI NORMALİZASYONU — proje künyesindeki "Kaynak" bağlantısı gibi, bu sitenin
// DIŞINDAKİ bir sayfaya gitmesi gereken kullanıcı girdisi tek yerden buradan geçer.
//
// NEDEN AYRI BİR DOSYA (ve neden isSafeUrlValue yetmiyor): submissionTypes.js#isSafeUrlValue bir
// GÜVENLİK kapısıdır — "bu değer bir href'e basılırsa enjeksiyon yapar mı" sorusunu yanıtlar ve
// bilerek ŞEMASIZ değerleri de kabul eder ("mimarlab.com/x", "logos-thumb/a.jpg"), çünkü aynı
// kontrol logo/görsel gibi SİTE-İÇİ göreli yolları da denetliyor (bkz. o fonksiyonun yorumu).
// "Kaynak" kutusu ise type="url" DEĞİL (bkz. proje-ekle.html#p-credit-url yorumu: tarayıcı
// doğrulaması "ytong.com.tr" gibi girişleri sessizce reddedip formu bloke ediyordu), yani veritabanına
// şemasız bir değer girmesi NORMAL ve BEKLENEN bir durum.
//
// GERÇEK BULGU (kullanıcı bildirimi, 2026-09-12 madde 1): şemasız saklanan böyle bir değer,
// istemcide `new URL(u, document.baseURI)` ile çözülünce https://mimarlab.com/<değer> gibi SİTE-İÇİ
// ve 404 veren bir adrese dönüşüyordu — yani fotoğrafçı etiketi ya hiç bağlantı olmuyor ya da kırık
// bir iç bağlantıya gidiyordu. Dış bağlantı ASLA document.baseURI'ye göre çözülmemeli: şema yoksa
// "https://" varsayılır, ama yalnızca değer gerçekten bir ALAN ADI gibi görünüyorsa.
//
// js/components/project-meta.js#externalHttpUrl bu fonksiyonun İSTEMCİ KOPYASIDIR (o dosya bir ES
// modülü değil, klasik <script> — import edemez). Bu kod tabanının kuralı gereği iki kopya da aynı
// davranışı üretmeli; biri değişirse diğeri de güncellenmeli.

// "example.com", "www.example.com.tr", "alt.alan-adi.co.uk/yol?x=1#a" → alan adı gibi görünen ilk
// parça. Şema, boşluk ya da kullanıcı bilgisi (@) taşıyan değerler buraya HİÇ gelmez (aşağıya bkz.).
const HOSTLIKE_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{2,5})?(?:[/?#]|$)/i;

// Değer gerçekten DIŞ bir http(s) sayfasına çözülüyorsa mutlak URL'i, aksi halde '' döner.
// '' dönmesi çağıran için "bağlantı üretme" demektir — asla tahmini/kırık bir href basılmaz.
export function externalHttpUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  // Tırnak/açı işareti taşıyan bir değer bir href'e hiç basılmamalı (bkz. isSafeUrlValue'daki AYNI
  // kural) — burada da kapı olarak durur, çağıranların escape'ine tek başına güvenilmez.
  if (/["'<>\s]/.test(raw)) return '';
  // Şemalı değer: yalnızca http/https kabul edilir (javascript:, data:, mailto: vb. elenir).
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch { /* ayrıştırılamayan — bağlantı üretme */ }
    return '';
  }
  // Protokol-göreli ("//host/yol"): şema site ile aynı olur, dış adres yine de doğrudur.
  if (raw.startsWith('//')) {
    try {
      const parsed = new URL(`https:${raw}`);
      return parsed.href;
    } catch { return ''; }
  }
  // Şemasız: yalnızca ALAN ADI gibi görünüyorsa https:// varsayılır. "logos-thumb/a.jpg" ya da
  // "/media/x" gibi site-içi yollar buradan GEÇMEZ — dış bağlantı olarak anlamsızdırlar.
  if (!HOSTLIKE_RE.test(raw)) return '';
  try {
    const parsed = new URL(`https://${raw}`);
    return parsed.href;
  } catch { return ''; }
}
