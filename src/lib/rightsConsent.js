// Telif ve Sorumluluk Beyanı — sunucu tarafı kapısı ve denetim kaydı
// (kullanıcı isteği, 2026-09-10 madde 1: "Kullanıcılar bu metne tik atmadan içerik
// yayınlayamasınlar", madde 2/3: "Kişiler telif sorumluluğunu kabul etmeden arşivden projeleri
// yayına alamayacaklar").
//
// İSTEMCİ KONTROLÜ TEK BAŞINA YETMEZ (bkz. bu depodaki AYNI kural, src/routes/legacyContent.js#
// handleSelfProjectDelete yorumu): js/components/rights-consent.js formu engelliyor olsa da
// gönderi uçlarına doğrudan istek atılabilir. Bu yüzden onay HER gönderide sunucuda da aranır.
//
// SÜRÜM: metnin kendisi istemcide (js/components/rights-consent.js) yaşar, sürüm sabiti BİLEREK
// iki tarafta ayrı kopya tutulur — kayda yazılan sürüm HER ZAMAN buradaki sabittir, istemciden
// gelen dize yalnızca uyuşmazlık halinde göz ardı edilir; aksi halde bir istemci kendi uydurduğu
// sürümü denetim kaydına yazdırabilirdi. İSTEMCİ METNİ DEĞİŞİRSE BU SABİT DE ARTIRILMALI.
import { newId } from './crypto.js';
import { errorJson } from './http.js';

export const RIGHTS_TEXT_VERSION = '2026-09-10';

export const RIGHTS_REQUIRED_MESSAGE = 'İçeriği yayınlayabilmek için Telif ve Sorumluluk Beyanı’nı onaylaman gerekiyor.';

// Gövdedeki onay bayrağı — hem `rightsAccepted` hem (eski istemciler/otomasyon için) `rights_accepted`
// kabul edilir. Yalnızca gerçek `true` (ya da 1/'true') geçerlidir; "yok" ile "false" arasında bir
// fark GÖZETİLMEZ, ikisi de reddedilir.
export function hasRightsAcceptance(body) {
  const raw = body && (body.rightsAccepted !== undefined ? body.rightsAccepted : body.rights_accepted);
  return raw === true || raw === 1 || raw === 'true' || raw === '1';
}

// Gönderiyi durduracak hata yanıtını döner (onay varsa null) — çağıran `if (err) return err;` yazar.
export function requireRightsAcceptance(body) {
  if (hasRightsAcceptance(body)) return null;
  return errorJson(RIGHTS_REQUIRED_MESSAGE, 422);
}

// Denetim kaydı. HİÇBİR ZAMAN çağıranı patlatmaz: beyan kaydı tutulamadı diye kullanıcının içeriği
// kaybolmamalı (kayıt eksikse tabloda satır olmaz, ama gönderi tamamlanır) — bkz. bu depodaki AYNI
// "yan kayıt asıl işlemi düşürmez" deseni (analytics-beacon, entity_stats).
export async function recordRightsAcceptance(env, user, { contentType, contentKey, submissionId, source }) {
  if (!user || !user.id) return;
  try {
    await env.DB.prepare(
      `INSERT INTO rights_acceptances (id, user_id, content_type, content_key, submission_id, text_version, source, accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      newId(), user.id, contentType || null, contentKey || null, submissionId || null,
      RIGHTS_TEXT_VERSION, source || 'submit', Date.now(),
    ).run();
  } catch { /* bkz. yukarıdaki gerekçe — denetim kaydı asıl işlemi düşürmez */ }
}
