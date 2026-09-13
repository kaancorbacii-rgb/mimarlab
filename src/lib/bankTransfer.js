// HAVALE/EFT HESAP BİLGİSİ — TEK GERÇEK KAYNAK (kullanıcı isteği, 2026-09-13: "ödeme seçeneklerini
// geri getir", seçilen yöntemler: iyzico kart + havale/EFT).
//
// IBAN/hesap adı DEPOYA YAZILMAZ, `wrangler secret put` ile tanımlanır:
//   PAYMENT_IBAN         — boşluklu ya da boşluksuz yazılabilir, biçim burada normalize edilir;
//                          TR + 24 hane olarak doğrulanır
//   PAYMENT_IBAN_NAME    — hesap sahibinin adı (havalede alıcı adı eşleşmezse banka reddedebilir)
//   PAYMENT_BANK_NAME    — banka adı (opsiyonel, yalnızca kullanıcıya gösterim için)
//
// GEREKÇE: 2026-09-08'de IBAN "siteden silinsin" diye kaldırılmıştı. Geri getirirken aynı hatayı
// tekrarlamamak için değer artık HTML/JS içinde sabit DEĞİL — yalnızca giriş yapmış ve o talebin
// SAHİBİ olan kullanıcıya, yalnızca kendi talebinin ödeme adımında sunucudan döner (bkz.
// src/routes/consultations.js#startConsultationPayment). Böylece IBAN ne kaynak kodda, ne genel
// sayfa HTML'inde, ne de anonim bir uçta durur; kapatmak için tek yapılacak sırrı silmektir
// (o anda havale seçeneği arayüzde kendiliğinden görünmez olur — bkz. isBankTransferConfigured).

const IBAN_RE = /^TR\d{24}$/;

function rawIban(env) {
  return String((env && env.PAYMENT_IBAN) || '').replace(/\s+/g, '').toUpperCase();
}

export function isBankTransferConfigured(env) {
  return IBAN_RE.test(rawIban(env)) && !!String((env && env.PAYMENT_IBAN_NAME) || '').trim();
}

// Görüntüleme biçimi: "TR.. .... .... .... .... .... .." — 4'lü gruplar, bankaların kendi
// gösterimiyle aynı, kopyalayınca boşluklar zararsızdır. (Bu yorumda ÖRNEK bir IBAN yazılamaz:
// scripts/test-2026-09-13-consultation-payment.mjs IBAN biçimli her diziyi reddeder — kural
// "gerçek olmayan örnek de olsa kaynak kodda IBAN durmasın"dır.)
function formatIban(compact) {
  return (compact.match(/.{1,4}/g) || []).join(' ');
}

// Kullanıcıya gösterilecek hesap bilgisi. Yapılandırılmamışsa null döner ve çağıran taraf havale
// seçeneğini HİÇ sunmaz (arayüzde de, sunucu doğrulamasında da) — yarı yapılandırılmış bir
// "IBAN yok ama 'Ödemeyi Yaptım' var" durumu OLUŞAMAZ.
export function getBankTransferAccount(env) {
  if (!isBankTransferConfigured(env)) return null;
  const compact = rawIban(env);
  return {
    iban: formatIban(compact),
    accountName: String(env.PAYMENT_IBAN_NAME).trim().slice(0, 120),
    bankName: String((env.PAYMENT_BANK_NAME || '')).trim().slice(0, 120) || null,
  };
}
