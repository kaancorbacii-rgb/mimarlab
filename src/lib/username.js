// KULLANICI ADI (users.username) — hesabın TEK, değişmez biçimli genel tanıtıcısı.
//
// Kullanıcı isteği (2026-09-14): "Üye Ol sayfasında ... Ad Soyad'dan sonra 'Kullanıcı Adı'
// kutucuğu koy", "giriş yap kısmında E-posta yazılan yere kullanıcı adı da yazılıp şifre yazılarak
// giriş yapılabilsin", "bugüne kadar siteye üye olan kullanıcılara ad ve soyadlarını kullanarak bir
// kullanıcı adı tanımla, örneğin Kaan Çorbacı için @kaancorbaci".
//
// NEDEN AYRI BİR MODÜL: aynı kurallar ÜÇ yerde birden uygulanıyor — kayıt (signup), hesap düzenleme
// (PATCH /api/profile + admin paneli) ve giriş (login'in kullanıcı adı dalı). Kuralın tek kaynağı
// olmadan üçü zamanla ayrışır ve "kayıtta kabul edilen ama girişte bulunamayan" kullanıcı adları
// oluşur.
//
// BİÇİM: yalnızca ASCII küçük harf, rakam, nokta ve alt çizgi (a-z 0-9 . _), 3-30 karakter, başı ve
// sonu harf/rakam. Türkçe harfler ASCII'ye KATLANIR (Çorbacı -> corbaci) — kullanıcı adı adres
// çubuğuna/bahsetmelere girebilecek bir tanıtıcı olduğundan büyük/küçük harf ve Türkçe karakter
// belirsizliği taşımaması gerekir. Katlama migrations/0119_users_username.sql'deki SQL
// katlamasıyla BİREBİR aynı eşlemeyi kullanır (aksi halde geri dolum ile yeni kayıtlar ayrışır).

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const USERNAME_RULE_TEXT = 'Kullanıcı adı 3-30 karakter olmalı; yalnızca küçük harf, rakam, nokta ve alt çizgi kullanılabilir.';

// Türkçe (ve düzeltme işaretli) harflerin ASCII karşılıkları — migrations/0119'daki replace()
// zinciriyle AYNI liste.
const FOLD_MAP = {
  'İ': 'i', 'I': 'i', 'ı': 'i',
  'Ş': 's', 'ş': 's',
  'Ğ': 'g', 'ğ': 'g',
  'Ü': 'u', 'ü': 'u',
  'Ö': 'o', 'ö': 'o',
  'Ç': 'c', 'ç': 'c',
  'Â': 'a', 'â': 'a',
  'Î': 'i', 'î': 'i',
  'Û': 'u', 'û': 'u',
};

// MİMARLAB'ın kendisini ya da yetkili bir görevi taklit edebilecek adlar (kimliğe bürünme koruması).
const RESERVED = new Set([
  'admin', 'administrator', 'yonetici', 'moderator', 'mimarlab', 'mimarlab_official',
  'api', 'root', 'destek', 'support', 'iletisim', 'info', 'hesabim', 'giris', 'uye',
]);

export function foldUsernameChars(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[İIıŞşĞğÜüÖöÇçÂâÎîÛû]/g, (ch) => FOLD_MAP[ch] || ch)
    .toLowerCase();
}

// Kullanıcının yazdığı değeri KANONİK biçime çevirir; kurala uymayan bir şey kalırsa reddeder
// (sessizce kırpmaz — kullanıcı ne kaydedildiğini görmeli).
export function normalizeUsername(raw) {
  const folded = foldUsernameChars(String(raw == null ? '' : raw).trim().replace(/^@+/, ''));
  if (!folded) return { ok: false, error: 'Kullanıcı adı gerekli.' };
  if (folded.length < USERNAME_MIN || folded.length > USERNAME_MAX) return { ok: false, error: USERNAME_RULE_TEXT };
  if (!/^[a-z0-9._]+$/.test(folded)) return { ok: false, error: USERNAME_RULE_TEXT };
  if (!/^[a-z0-9]/.test(folded) || !/[a-z0-9]$/.test(folded)) {
    return { ok: false, error: 'Kullanıcı adı harf ya da rakamla başlayıp bitmeli.' };
  }
  if (/[._]{2,}/.test(folded)) return { ok: false, error: 'Kullanıcı adında üst üste nokta ya da alt çizgi olamaz.' };
  if (RESERVED.has(folded)) return { ok: false, error: 'Bu kullanıcı adı ayrılmış, başka bir tane seç.' };
  return { ok: true, value: folded };
}

// Ad soyaddan otomatik kullanıcı adı tohumu ("Kaan Çorbacı" -> "kaancorbaci"). Geri dolum
// (migrations/0119) ile AYNI kural; burada OAuth kayıtları ve e-postadan türetme için kullanılır.
export function usernameFromName(name) {
  const base = foldUsernameChars(name).replace(/[^a-z0-9]+/g, '');
  return base.slice(0, USERNAME_MAX);
}

export async function isUsernameTaken(env, username, excludeUserId = null) {
  const row = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  return !!row && row.id !== excludeUserId;
}

// Tohumdan BOŞTA olan bir kullanıcı adı üretir — yalnızca kullanıcının kendi seçmediği yollarda
// (Google/LinkedIn ile kayıt) kullanılır; elle girilen bir kullanıcı adı doluysa kullanıcıya hata
// döner, sessizce sayı eklenmez.
export async function uniqueUsernameFrom(env, seed, fallbackSeed = '') {
  let base = usernameFromName(seed) || usernameFromName(fallbackSeed);
  if (base.length < USERNAME_MIN) base = `uye${base}`;
  base = base.slice(0, USERNAME_MAX - 3) || 'uye';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}.${i + 1}`;
    if (normalizeUsername(candidate).ok && !(await isUsernameTaken(env, candidate))) return candidate;
  }
  return `uye${Date.now().toString(36)}`.slice(0, USERNAME_MAX);
}
