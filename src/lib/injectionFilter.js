// Modele göndermeden önce, sayfa içeriğinde modele yönlendirilmiş GİBİ görünen (prompt injection)
// cümleleri kaba bir desen eşleştirmesiyle tespit edip nötr bir yer tutucuyla değiştirir.
//
// Bu KESİN bir çözüm DEĞİLDİR — parafraz edilmiş, başka dile çevrilmiş ya da gizlenmiş (ör. sıfır
// genişlikli karakterlerle bölünmüş) bir talimatı yakalamayabilir. Sistem promptundaki açık
// injection-guard'ın (bkz. src/routes/ai.js#INJECTION_GUARD) YERİNE değil, ek bir savunma katmanı
// olarak eklendi (bkz. kullanıcı isteği: "ek güvenlik ağı ekle").
//
// Tüm metni reddetmek yerine yalnızca şüpheli SATIRI çıkarmak, meşru bir sayfada tesadüfen benzer
// bir ifade geçmesi (ör. bir haber metninde "sistem promptu" kelimesinin geçmesi) durumunda
// çıkarımın tamamen durmasını önler — geri kalan gerçek içerikten çıkarım yapılmaya devam eder.

const INJECTION_PATTERNS = [
  /ignore\s+(all|any|the)?\s*(previous|above|prior)\s*(instructions?|prompts?|rules?)/i,
  /disregard\s+(all|any|the)?\s*(previous|above|prior)/i,
  /system\s*(prompt|override|instruction)/i,
  /you\s+are\s+(now|no longer)/i,
  /new\s+instructions?\s*:/i,
  /respond\s+only\s+with/i,
  /output\s+only/i,
  /return\s+(only|exactly)\s+the\s+following/i,
  /do\s+not\s+extract/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /forget\s+(your|all)\s*(previous)?\s*instructions?/i,
  /reveal\s+your\s+(system\s+)?prompt/i,
  /print\s+your\s+instructions/i,
  /comply\s+immediately/i,
  // Türkçe varyantlar
  /önceki\s+talimatları\s+(yok say|görmezden gel)/i,
  /sistem\s+promptunu?\s+(yok say|görmezden gel|göster|değiştir)/i,
  /artık\s+.*\s+değilsin/i,
  /yeni\s+talimat/i,
  /sadece\s+(şu|aşağıdaki)\s+json'?u?\s+döndür/i,
  /talimatlara\s+uy(ma)?\b.*asistan/i,
];

const PLACEHOLDER = '[talimat benzeri içerik kaldırıldı]';

// Verilen metni satır satır tarar; eşleşen her satırı yer tutucuyla değiştirir. `hits`, kaç satırın
// değiştirildiğini döner — 0'dan büyükse çağıran taraf isterse loglayabilir (bkz. src/routes/ai.js).
export function stripInjectionAttempts(text) {
  if (!text) return { text, hits: 0 };
  let hits = 0;
  const cleaned = String(text).split('\n').map(line => {
    if (INJECTION_PATTERNS.some(re => re.test(line))) { hits++; return PLACEHOLDER; }
    return line;
  }).join('\n');
  return { text: cleaned, hits };
}
