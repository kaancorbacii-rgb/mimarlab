// iyzico Checkout Form'un ALICI (buyer) alanları için paylaşılan doğrulama/normalleştirme.
//
// Bu iki fonksiyon önce yalnızca src/routes/payments.js içinde (rozet satışı için) duruyordu.
// Danışmanlık ödemesi (kullanıcı isteği, 2026-09-13) AYNI alanları AYNI kurallarla göndermek
// zorunda olduğundan buraya çıkarıldı — kopyalanmış bir ikinci TC checksum'ı, iki akışın sessizce
// ayrışacağı klasik yerdir (bkz. consultationMeet.js'teki "iki farklı başlangıç anı" notu, aynı
// tuzak). payments.js artık buradan import eder, davranışı DEĞİŞMEDİ.

// TC Kimlik No resmi (11 haneli) checksum algoritması — kamuya açık, standart bir doğrulamadır.
export function isValidTcKimlik(v) {
  if (!/^[1-9][0-9]{10}$/.test(v)) return false;
  const d = v.split('').map(Number);
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8];
  const evenSum = d[1] + d[3] + d[5] + d[7];
  const check10 = (((oddSum * 7) - evenSum) % 10 + 10) % 10;
  if (check10 !== d[9]) return false;
  const sumFirst10 = d.slice(0, 10).reduce((a, b) => a + b, 0);
  return (sumFirst10 % 10) === d[10];
}

// "0 (531) 881 24 45", "05318812445", "+905318812445" -> "+905318812445"; geçersizse null.
export function normalizeGsm(raw) {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('90')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return /^5\d{9}$/.test(digits) ? `+90${digits}` : null;
}
