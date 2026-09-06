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

// Hesabim.html'in "Gönderdiğim İçerikler" bölümündeki TYPE_LABELS ile aynı — bildirim metninde
// de aynı Türkçe adlandırma kullanılsın diye burada tekrarlanır.
const SUBMISSION_TYPE_LABELS = { offices: 'Firma', projects: 'Proje', products: 'Ürün', materials: 'Malzeme', architects: 'Mimar' };

// "Gönderin onaylandı" bildiriminin tıklanınca gideceği KANONİK yol (kullanıcı isteği, 2026-09-06
// madde 2). Eşleme js/components/auth-modal.js#itemDetailUrl ile BİREBİR aynı olmak ZORUNDA — ikisi
// de aynı satırdan aynı public URL'i türetir; ayrışırlarsa Hesabım'daki "Eklediklerim" linki ile
// bildirim linki aynı kaydın FARKLI adreslerine giderdi. 'submission:<id>' işareti, henüz bir
// claimed_profile_key'e bağlanmamış yeni kayıtlar için kullanılan legacy_key çözümlemesidir (bkz.
// src/routes/product.js#findProductByLegacyMarker ve mimar/firma karşılıkları).
// Yol üretilemiyorsa (ör. slug'ı olmayan bir proje satırı) null döner ve bildirim linksiz kalır —
// tıklanınca hiçbir şey yapmayan kırık bir adres yazmaktansa satır yalnızca okundu işaretlenir.
export function approvedSubmissionLink(typeKey, row) {
  if (!row) return null;
  if (typeKey === 'projects') {
    const slug = row.claimed_slug || row.slug;
    return slug ? `/proje/${encodeURIComponent(slug)}` : null;
  }
  if (typeKey === 'offices') return `/firma/${encodeURIComponent(row.claimed_profile_key || ('submission:' + row.id))}`;
  if (typeKey === 'architects') return `/kisi/${encodeURIComponent(row.claimed_profile_key || ('submission:' + row.id))}`;
  if (typeKey === 'products' || typeKey === 'materials') return `/urun/${encodeURIComponent('submission:' + row.id)}`;
  return null;
}

// "<Tip> gönderin onaylandı" bildirimi — bir gönderi 'pending'den 'approved'a geçtiğinde SAHİBİNE
// düşer (kullanıcı isteği, 2026-09-06 madde 3: "Paylaşılan gönderiler onaylanınca kullanıcılara
// bildirim gitmeli ve bu bildirime tıklayınca kullanıcılar paylaşılan gönderi popupını görmeli").
//
// GERÇEK BULGU (canlı veri, 2026-09-06): bu bildirim YALNIZCA src/routes/admin.js#
// handleSubmissionsAdmin'in PATCH dalında (admin panelindeki "Onayla" düğmesi) oluşturuluyordu. Ama
// admin panelinin bekleyen gönderi kartında "Onayla"nın yanında bir de "Düzenle / İncele" bağlantısı
// var; oradan açılan proje-ekle.html/urun-ekle.html vb. kaydederken PUT /api/<tip>/:id'ye gider ve
// src/routes/submissions.js#updateOwnSubmission admin için status'ü koşulsuz 'approved' yapar —
// yani gönderi yayına girer ama sahibine HİÇBİR bildirim gitmezdi. MİMARLAB Robotu'nun
// "Kemalpaşa Kongre Merkezi" gönderisinde canlıda görülen davranış tam olarak buydu (satır
// pending'den approved'a geçmiş, notifications'ta karşılığı yok). Bildirim mantığı bu yüzden
// admin.js'ten buraya taşındı ve HER İKİ onay yolu da bunu çağırıyor.
export async function notifySubmissionApproved(env, typeKey, row) {
  if (!row || !row.owner_user_id) return;
  const label = SUBMISSION_TYPE_LABELS[typeKey] || typeKey;
  const name = row.name || row.title || '';
  await createNotification(
    env, row.owner_user_id, 'submission_approved',
    `${label} gönderin onaylandı`,
    name ? `"${name}" yayına alındı.` : null,
    approvedSubmissionLink(typeKey, row)
  );
}

export async function notifySubmissionRejected(env, typeKey, row) {
  if (!row || !row.owner_user_id) return;
  const label = SUBMISSION_TYPE_LABELS[typeKey] || typeKey;
  const name = row.name || row.title || '';
  await createNotification(
    env, row.owner_user_id, 'submission_rejected',
    `${label} gönderin reddedildi`,
    name ? `"${name}" için gönderdiğin içerik reddedildi.` : null,
    'hesabim.html'
  );
}
