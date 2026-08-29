import { newId } from './crypto.js';

// Hesabım sayfasındaki "Bildirimler" kutusuna bir satır ekler. type, istemci tarafında ikon/etiket
// seçimi için kullanılabilir (bkz. hesabim.html#NOTIFICATION_TYPE_LABELS); link varsa "Bildirimler"
// listesindeki satır tıklanabilir olur.
export async function createNotification(env, userId, type, title, body, link) {
  const id = newId();
  // denetim bulgusu: çoğu çağıran (admin.js onay/red akışları, comments.js, officeFounderCascade.js)
  // bu satırı asıl mutasyon (onay/silme/vs.) zaten başarıyla tamamlandıktan SONRA, best-effort bir yan
  // etki olarak çağırıyordu — sarmalanmamışsa bir INSERT hatası, halihazırda başarılı olmuş işlemi
  // çıplak 500'e düşürüyordu (bkz. src/routes/payments.js'teki AYNI sınıf hata için zaten var olan
  // try/catch). Hata burada merkezi olarak yutulur ki her çağıran ayrı ayrı sarmalamak zorunda kalmasın.
  try {
    await env.DB.prepare(
      'INSERT INTO notifications (id, user_id, type, title, body, link, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
    ).bind(id, userId, type, title, body || null, link || null, Date.now()).run();
  } catch (err) {
    console.error('createNotification failed', err);
  }
}
