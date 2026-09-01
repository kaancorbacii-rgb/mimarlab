import { slugify } from './slugify.js';

// Yeni proje/ürün/mimar/firma yayına girdiğinde bülten abonelerine mail (bkz. kullanıcı isteği:
// "Paylaşılan her içerik kullanıcılara mail olarak gitsin", migrations/0044_newsletter_subscribers.sql).
// Yalnızca GERÇEKTEN yeni içerik için çağrılmalı — çağıran taraflar (src/routes/submissions.js#
// createSubmission, src/routes/admin.js#handleSubmissionsAdmin PATCH) zaten claimed_profile_key/
// claimed_slug'lı (mevcut statik bir kaydın üzerine bindirilen) düzenlemeleri hariç tutuyor, burada
// tekrar kontrol edilmiyor.

const TYPE_LABEL = {
  projects: 'Yeni proje',
  products: 'Yeni ürün',
  materials: 'Yeni ürün',
  architects: 'Yeni mimar profili',
  offices: 'Yeni firma profili',
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

function buildCoverImage(typeKey, row) {
  if (typeKey === 'projects' || typeKey === 'products' || typeKey === 'materials') {
    try {
      const arr = row.images ? JSON.parse(row.images) : [];
      return safeAbsoluteUrl(arr[0] || null);
    } catch {
      return null;
    }
  }
  if (typeKey === 'architects') return safeAbsoluteUrl(row.photo_url);
  if (typeKey === 'offices') return safeAbsoluteUrl(row.logo_url);
  return null;
}

function buildLink(typeKey, row) {
  if (typeKey === 'projects') return row.slug ? `https://mimarlab.com/proje/${encodeURIComponent(row.slug)}` : null;
  if (typeKey === 'products' || typeKey === 'materials') return row.slug ? `https://mimarlab.com/urun/${encodeURIComponent(row.slug)}` : null;
  if (typeKey === 'architects') return row.name ? `https://mimarlab.com/kisi/${encodeURIComponent(slugify(row.name))}` : null;
  if (typeKey === 'offices') return row.name ? `https://mimarlab.com/firma/${encodeURIComponent(slugify(row.name))}` : null;
  return null;
}

function buildTitle(typeKey, row) {
  return (typeKey === 'projects' || typeKey === 'products' || typeKey === 'materials') ? row.title : row.name;
}

function buildSummary(typeKey, row) {
  const text = (typeKey === 'architects' || typeKey === 'offices') ? row.about : row.description;
  if (!text) return null;
  const trimmed = String(text).trim();
  return trimmed.length > 160 ? trimmed.slice(0, 160).trimEnd() + '…' : trimmed;
}

// Resend'in /emails/batch ucu (bkz. src/routes/contact.js/auth.js'teki AYNI tekli /emails deseni) —
// burada batch kullanılıyor çünkü her abone kendi unsubscribe_token'ıyla KİŞİSELLEŞTİRİLMİŞ bir
// "Abonelikten çık" linki almalı (bkz. src/routes/newsletter.js#GET /api/newsletter/unsubscribe);
// tek bir bcc'li mail bunu sağlayamaz. Tek istekte en fazla 100 e-posta kabul ediyor, bu yüzden
// abone listesi 100'lük gruplara bölünür.
const BATCH_SIZE = 100;

// Bültenin abonelere HER paylaşımda değil, ~5 paylaşımdan 1'inde gitmesi için (bkz. kullanıcı
// isteği: "5 proje, mimar, firma ve ürün paylaşımından 1'ini gönder") — proje/mimar/firma/ürün
// TÜRLERİ birlikte, tek paylaşılan sayaçla sayılır (ayrı ayrı tür başına değil, kullanıcının
// örneğindeki gibi). rate_limits#checkRateLimit İLE AYNI atomik INSERT...ON CONFLICT DO
// UPDATE...RETURNING deseni (bkz. migrations/0060_newsletter_notify_counter.sql) — sayaç hiç
// sıfırlanmaz, yalnızca 5'in katına ulaştığında (o anki içerik için) gerçek bir mail gönderilir,
// aradaki 4 paylaşım sessizce atlanır.
const NOTIFY_EVERY_N = 5;
async function shouldSendThisTime(env) {
  try {
    const row = await env.DB.prepare(
      `INSERT INTO newsletter_notify_counter (key, count) VALUES ('global', 1)
       ON CONFLICT(key) DO UPDATE SET count = count + 1
       RETURNING count`
    ).first();
    return !!row && row.count % NOTIFY_EVERY_N === 0;
  } catch (err) {
    console.error('newsletter notify counter failed', err);
    return false;
  }
}

export async function notifyNewsletterOfNewContent(env, typeKey, row) {
  if (!env.RESEND_API_KEY || !row) return;
  const label = TYPE_LABEL[typeKey];
  const link = buildLink(typeKey, row);
  const title = buildTitle(typeKey, row);
  if (!label || !link || !title) return;
  if (!(await shouldSendThisTime(env))) return;

  try {
    const { results } = await env.DB.prepare(
      `SELECT email, unsubscribe_token FROM newsletter_subscribers WHERE unsubscribed_at IS NULL`
    ).all();
    if (!results || !results.length) return;

    const from = env.RESEND_FROM || 'MİMARLAB <no-reply@mimarlab.com>';
    const subject = `${label}: ${title}`;
    const safeTitle = escapeHtml(title);
    const summary = buildSummary(typeKey, row);
    const safeSummary = summary ? escapeHtml(summary) : null;
    const coverImage = buildCoverImage(typeKey, row);
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
    console.error('notifyNewsletterOfNewContent failed', err);
  }
}
