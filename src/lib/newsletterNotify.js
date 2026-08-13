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

function buildLink(typeKey, row) {
  if (typeKey === 'projects') return row.slug ? `https://mimarlab.com/proje/${encodeURIComponent(row.slug)}` : null;
  if (typeKey === 'products' || typeKey === 'materials') return row.slug ? `https://mimarlab.com/urun/${encodeURIComponent(row.slug)}` : null;
  if (typeKey === 'architects') return row.name ? `https://mimarlab.com/mimar/${encodeURIComponent(slugify(row.name))}` : null;
  if (typeKey === 'offices') return row.name ? `https://mimarlab.com/firma/${encodeURIComponent(slugify(row.name))}` : null;
  return null;
}

function buildTitle(typeKey, row) {
  return (typeKey === 'projects' || typeKey === 'products' || typeKey === 'materials') ? row.title : row.name;
}

// Resend'in /emails/batch ucu (bkz. src/routes/contact.js/auth.js'teki AYNI tekli /emails deseni) —
// burada batch kullanılıyor çünkü her abone kendi unsubscribe_token'ıyla KİŞİSELLEŞTİRİLMİŞ bir
// "Abonelikten çık" linki almalı (bkz. src/routes/newsletter.js#GET /api/newsletter/unsubscribe);
// tek bir bcc'li mail bunu sağlayamaz. Tek istekte en fazla 100 e-posta kabul ediyor, bu yüzden
// abone listesi 100'lük gruplara bölünür.
const BATCH_SIZE = 100;

export async function notifyNewsletterOfNewContent(env, typeKey, row) {
  if (!env.RESEND_API_KEY || !row) return;
  const label = TYPE_LABEL[typeKey];
  const link = buildLink(typeKey, row);
  const title = buildTitle(typeKey, row);
  if (!label || !link || !title) return;

  try {
    const { results } = await env.DB.prepare(
      `SELECT email, unsubscribe_token FROM newsletter_subscribers WHERE unsubscribed_at IS NULL`
    ).all();
    if (!results || !results.length) return;

    const from = env.RESEND_FROM || 'MİMARLAB <no-reply@mimarlab.com>';
    const subject = `${label}: ${title}`;
    const safeTitle = escapeHtml(title);

    const emails = results.map((sub) => ({
      from,
      to: sub.email,
      subject,
      html: `<p>MİMARLAB'da ${label.toLowerCase()} yayında:</p>
        <p style="font-size:16px;font-weight:600;">${safeTitle}</p>
        <p><a href="${link}">İncele →</a></p>
        <p style="margin-top:28px;font-size:12px;color:#888;">
          Bu e-postayı MİMARLAB bültenine abone olduğun için aldın.
          <a href="https://mimarlab.com/api/newsletter/unsubscribe?token=${encodeURIComponent(sub.unsubscribe_token)}">Abonelikten çık</a>
        </p>`,
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
