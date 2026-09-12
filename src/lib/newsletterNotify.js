// Yeni proje/ürün yayına girdiğinde ve yeni gündem gönderisi yayımlandığında bülten abonelerine
// mail (bkz. kullanıcı isteği: "Paylaşılan her içerik kullanıcılara mail olarak gitsin",
// migrations/0044_newsletter_subscribers.sql).
// Yalnızca GERÇEKTEN yeni içerik için çağrılmalı — çağıran taraflar (src/routes/submissions.js#
// createSubmission, src/routes/admin.js#handleSubmissionsAdmin PATCH) zaten claimed_profile_key/
// claimed_slug'lı (mevcut statik bir kaydın üzerine bindirilen) düzenlemeleri hariç tutuyor, burada
// tekrar kontrol edilmiyor.

// KAPSAM (kullanıcı isteği, 2026-09-12 madde 2: "Bundan sonra yeni kişi, firma ve markalar e-posta
// bildirimi olarak gitmesin"): architects (kişi) ve offices (firma VE marka — ikisi de AYNI
// office_submissions/offices kaydı, bkz. src/lib/submissionTypes.js#SUBMISSION_TYPES.offices)
// BİLEREK bu tabloda YOK. Tablo, notifyNewsletterOfNewContent'in tek kapısıdır: label bulunamayan
// bir tür sessizce (mail göndermeden, sayacı da ARTIRMADAN) döner, bu yüzden çağıran taraflara
// (submissions.js / admin.js) dokunmak gerekmiyor — o türlerin gönderi/onay akışları aynen sürer,
// yalnızca bülten maili çıkmaz. Footer'daki bülten metni de bu kapsamı yansıtır (bkz.
// js/components/site-chrome.js#footerHtml: "Yeni proje, ürün ve gündem içerikleri").
const TYPE_LABEL = {
  projects: 'Yeni proje',
  products: 'Yeni ürün',
  materials: 'Yeni ürün',
};

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const SITE_ORIGIN = 'https://mimarlab.com';

// src/lib/seo.js#absoluteUrl/safeHttpUrl ile aynı desen (oradan export edilmediği için burada
// yerel kopyası) — DB'deki images/photo_url/logo_url kolonları hem göreli (/media/...,
// R2-backed, bkz. proje hafızası) hem de mutlak URL içerebiliyor, ikisini de tek biçime getirir
// ve yalnızca http(s) kabul ederek e-posta img src'sine enjeksiyonu engeller.
function safeAbsoluteUrl(path) {
  if (!path) return null;
  try {
    const parsed = new URL(path, SITE_ORIGIN);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

// Aşağıdaki üç üretici yalnızca TYPE_LABEL'da KARŞILIĞI OLAN türler için çağrılır (bkz.
// notifyNewsletterOfNewContent'in label kapısı) — kişi/firma/marka dalları, o türler kapsamdan
// çıkarıldığında (bkz. TYPE_LABEL yorumu) ulaşılamaz hale geldiğinden kaldırıldı; kapsam yeniden
// genişletilirse onlarla birlikte geri gelmeleri gerekir.
function buildCoverImage(row) {
  try {
    const arr = row.images ? JSON.parse(row.images) : [];
    return safeAbsoluteUrl(arr[0] || null);
  } catch {
    return null;
  }
}

function buildLink(typeKey, row) {
  if (!row.slug) return null;
  if (typeKey === 'projects') return `${SITE_ORIGIN}/proje/${encodeURIComponent(row.slug)}`;
  if (typeKey === 'products' || typeKey === 'materials') return `${SITE_ORIGIN}/urun/${encodeURIComponent(row.slug)}`;
  return null;
}

function truncateSummary(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  return trimmed.length > 160 ? trimmed.slice(0, 160).trimEnd() + '…' : trimmed;
}

// Resend'in /emails/batch ucu (bkz. src/routes/contact.js/auth.js'teki AYNI tekli /emails deseni) —
// burada batch kullanılıyor çünkü her abone kendi unsubscribe_token'ıyla KİŞİSELLEŞTİRİLMİŞ bir
// "Abonelikten çık" linki almalı (bkz. src/routes/newsletter.js#GET /api/newsletter/unsubscribe);
// tek bir bcc'li mail bunu sağlayamaz. Tek istekte en fazla 100 e-posta kabul ediyor, bu yüzden
// abone listesi 100'lük gruplara bölünür.
const BATCH_SIZE = 100;

// Bültenin abonelere HER paylaşımda değil, ~5 paylaşımdan 1'inde gitmesi için (bkz. kullanıcı
// isteği: "5 proje, mimar, firma ve ürün paylaşımından 1'ini gönder") — proje/ürün TÜRLERİ
// birlikte, tek paylaşılan sayaçla sayılır (ayrı ayrı tür başına değil, kullanıcının
// örneğindeki gibi). rate_limits#checkRateLimit İLE AYNI atomik INSERT...ON CONFLICT DO
// UPDATE...RETURNING deseni (bkz. migrations/0060_newsletter_notify_counter.sql) — sayaç hiç
// sıfırlanmaz, yalnızca 5'in katına ulaştığında (o anki içerik için) gerçek bir mail gönderilir,
// aradaki 4 paylaşım sessizce atlanır.
//
// GÜNDEM AYRI SAYILIR (kullanıcı isteği, 2026-09-12 madde 2: "Her 5 gündem gönderisinden 1'i
// e-posta olarak gitsin"): gündem hattı otomatik ve çok daha yoğun aktığından tek bir ortak sayaç,
// paylaşılan proje/ürünlerin sırasını yiyip onları neredeyse hiç göndermezdi. Sayaç tablosu zaten
// `key` ile anahtarlı (bkz. migrations/0060) — 'gundem' satırı ilk çağrıda kendiliğinden oluşur,
// yeni bir migration GEREKMEZ.
const NOTIFY_EVERY_N = 5;
const COUNTER_CONTENT = 'global';
const COUNTER_GUNDEM = 'gundem';
async function shouldSendThisTime(env, counterKey) {
  try {
    const row = await env.DB.prepare(
      `INSERT INTO newsletter_notify_counter (key, count) VALUES (?, 1)
       ON CONFLICT(key) DO UPDATE SET count = count + 1
       RETURNING count`
    ).bind(counterKey).first();
    return !!row && row.count % NOTIFY_EVERY_N === 0;
  } catch (err) {
    console.error('newsletter notify counter failed', err);
    return false;
  }
}

// Tek bir içerik için TÜM abonelere mail — aşağıdaki iki giriş noktasının (paylaşılan içerik ve
// gündem) PAYLAŞTIĞI gövde. "5'te 1" kapısı çağıranda kalır: bu fonksiyon çağrıldığında gönderim
// kararı ZATEN verilmiştir.
async function sendToSubscribers(env, { label, title, summary, coverImage, link }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT email, unsubscribe_token FROM newsletter_subscribers WHERE unsubscribed_at IS NULL`
    ).all();
    if (!results || !results.length) return;

    const from = env.RESEND_FROM || 'MİMARLAB <no-reply@mimarlab.com>';
    const subject = `${label}: ${title}`;
    const safeTitle = escapeHtml(title);
    const safeSummary = summary ? escapeHtml(summary) : null;
    // gerçek bulgu (denetim raporu, 2026-08-16): coverImage/link daha önce escapeHtml'den GEÇMEDEN
    // doğrudan src=""/href="" attribute'larına gömülüyordu — bugün safeAbsoluteUrl()'un URL() ile
    // parse edip yeniden serialize etmesi (tırnak karakterleri otomatik percent-encode edilir) ve
    // link'in slug/encodeURIComponent'ten gelmesi nedeniyle fiilen güvenli, ama proje konvansiyonu
    // ("attribute context → escapeAttr/escapeHtml") ihlal ediliyordu — buildCoverImage/buildLink
    // ileride farklı bir yoldan (ör. doğrudan D1 yazımı) doğrulanmamış bir değer dönerse render
    // noktasında sessiz bir stored-injection açığına dönüşebilirdi. Render noktasında da savunma
    // katmanı olarak escapeHtml (bu dosyada zaten tırnak dahil 5 karakteri encode ediyor, escapeAttr
    // ile eşdeğer) uygulanır.
    const safeCoverImage = coverImage ? escapeHtml(coverImage) : null;
    const safeLink = escapeHtml(link);

    const emails = results.map((sub) => ({
      from,
      to: sub.email,
      subject,
      html: `<div style="max-width:480px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;">
        <p style="margin:0 0 24px;"><img src="https://mimarlab.com/logos/site/mimarlab-logo.png" alt="MİMARLAB" height="28" style="height:28px;width:auto;"></p>
        ${safeCoverImage ? `<p style="margin:0 0 20px;"><img src="${safeCoverImage}" alt="${safeTitle}" width="480" style="width:100%;max-width:480px;height:auto;border-radius:8px;display:block;"></p>` : ''}
        <p>MİMARLAB'da ${label.toLowerCase()} yayında:</p>
        <p style="font-size:16px;font-weight:600;">${safeTitle}</p>
        ${safeSummary ? `<p style="font-size:14px;color:#555;line-height:1.5;">${safeSummary}</p>` : ''}
        <p><a href="${safeLink}">İncele →</a></p>
        <p style="margin-top:28px;font-size:12px;color:#888;">
          Bu e-postayı MİMARLAB bültenine abone olduğun için aldın.
          <a href="https://mimarlab.com/api/newsletter/unsubscribe?token=${encodeURIComponent(sub.unsubscribe_token)}">Abonelikten çık</a>
        </p>
      </div>`,
    }));

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const chunk = emails.slice(i, i + BATCH_SIZE);
      await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      });
    }
  } catch (err) {
    console.error('newsletter send failed', err);
  }
}

export async function notifyNewsletterOfNewContent(env, typeKey, row) {
  if (!env.RESEND_API_KEY || !row) return;
  // TYPE_LABEL kapsam kapısı (bkz. o tablonun yorumu): kişi/firma/marka burada sessizce döner ve
  // sayaç da ARTMAZ — o türler bültenin "5'te 1" sırasını yemesin.
  const label = TYPE_LABEL[typeKey];
  const link = buildLink(typeKey, row);
  const title = row.title;
  if (!label || !link || !title) return;
  if (!(await shouldSendThisTime(env, COUNTER_CONTENT))) return;

  await sendToSubscribers(env, {
    label,
    title,
    summary: truncateSummary(row.description),
    coverImage: buildCoverImage(row),
    link,
  });
}

// Yeni gündem gönderisi yayına girdiğinde (kullanıcı isteği, 2026-09-12 madde 2: "Her 5 gündem
// gönderisinden 1'i e-posta olarak gitsin"). İKİ yayın kapısından da çağrılır — otomatik hat
// (src/lib/gundemIngest.js, hacmin neredeyse tamamı) ve kullanıcı gönderisinin admin onayı
// (src/routes/gundemAdmin.js#moderateGundemItem) — ikisi AYNI 'gundem' sayacını paylaşır, yani
// "5'te 1" oranı yayının hangi yoldan geldiğine bakmaz.
//
// row: gundem_items satırı ya da onunla AYNI alan adlarını taşıyan bir nesne (slug/title/summary/
// image_url). Mail hiç fırlatmaz (bkz. sendToSubscribers'ın kendi try/catch'i) — bülten, bir yayını
// asla geri almamalı.
export async function notifyNewsletterOfNewGundem(env, row) {
  if (!env.RESEND_API_KEY || !row || !row.slug || !row.title) return;
  if (!(await shouldSendThisTime(env, COUNTER_GUNDEM))) return;

  await sendToSubscribers(env, {
    label: 'Yeni gündem içeriği',
    title: row.title,
    summary: truncateSummary(row.summary),
    coverImage: safeAbsoluteUrl(row.image_url),
    link: `${SITE_ORIGIN}/gundem/${encodeURIComponent(row.slug)}`,
  });
}
