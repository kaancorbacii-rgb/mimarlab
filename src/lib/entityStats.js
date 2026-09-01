// Liste uçlarının parmak izi (fingerprint) kaynağı — bkz. migrations/0078_entity_stats.sql.
//
// Önceden her *ListFingerprint() kendi tablosunda
//     SELECT COUNT(*), MAX(updated_at) FROM <tablo> WHERE deleted_at IS NULL AND hidden_at IS NULL
// çalıştırıyordu; bu, tanımı gereği canlı satır sayısıyla DOĞRUSAL büyür (COUNT(*) her satıra
// dokunmak zorunda). entity_stats, aynı iki değeri yazma yolunda (SQLite trigger'ları) bakımı
// yapılan tek bir satırda tutar — okuma artık PRIMARY KEY üzerinden TEK satır.
//
// FALLBACK — bu dosyanın en önemli parçası: entity_stats tablosu yoksa (migration uygulanmamış bir
// ortam, ör. sıfırdan kurulmuş bir yerel D1) ya da ilgili `kind` satırı yoksa, ESKİ sorguya
// düşülür. Böylece migration'ın uygulanıp uygulanmaması bir doğruluk sorunu değil, yalnızca bir
// performans farkı olur; hiçbir ortam kırılmaz (kullanıcı isteği/depo kuralı: cache invalidation
// altyapısı başarısız olduğunda sistem güvenli şekilde çalışmaya DEVAM etmeli, bkz.
// publicCache.js#getCachedFingerprint'teki aynı gerekçe).
//
// LIVE_TABLES — `kind` doğrudan SQL'e gömüldüğünden (tablo adı bind edilemez) bu beyaz liste
// zorunludur; çağıranların hepsi zaten sabit dizge geçiriyor, bu ikinci bir savunma katmanı.
const LIVE_TABLES = {
  projects: 'projects',
  architects: 'architects',
  offices: 'offices',
  products: 'products',
};

async function fingerprintFromLiveScan(env, kind) {
  const table = LIVE_TABLES[kind];
  if (!table) return '';
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt, MAX(updated_at) AS latest FROM ${table} WHERE deleted_at IS NULL AND hidden_at IS NULL`
  ).first();
  return `${row?.cnt ?? 0}:${row?.latest ?? ''}`;
}

// Dönen dize yalnızca bir DEĞİŞİKLİK JETONUDUR (ETag üretimine girer, bkz. publicCache.js#
// cachedPublicJson) — biçimi hiçbir yerde ayrıştırılmaz, yalnızca eşitlik karşılaştırması yapılır.
// Bu yüzden `rev` alanının eklenmesi (fallback biçiminde olmayan üçüncü alan) geriye dönük bir
// uyumluluk sorunu YARATMAZ: en kötü ihtimalle, bu değişikliğin deploy edildiği an mevcut tüm
// ETag'ler bir kez geçersizleşir (tek seferlik bir cache MISS dalgası).
export async function entityFingerprint(env, kind) {
  if (!env || !env.DB) return '';
  try {
    const row = await env.DB.prepare(
      `SELECT live_count, latest_updated_at, rev FROM entity_stats WHERE kind = ?`
    ).bind(kind).first();
    if (row) return `${row.live_count ?? 0}:${row.latest_updated_at ?? ''}:${row.rev ?? 0}`;
  } catch {
    // "no such table: entity_stats" — migration henüz uygulanmamış. Sessizce tam taramaya düş.
  }
  return fingerprintFromLiveScan(env, kind);
}

// Doğrulama yardımcısı — entity_stats'ın gerçek veriyle uyumunu kontrol eder (bkz.
// scripts/verify-entity-stats.sh). Trigger'lar SQLite tarafından HER DML'de çalıştığı için
// sapma teorik olarak mümkün değil, ama bu değer cache tazeliğini belirlediğinden deploy
// sonrası bir kez doğrulanabilmesi ucuz bir güvencedir.
export async function entityStatsDrift(env, kind) {
  const table = LIVE_TABLES[kind];
  if (!table) return null;
  const [stats, actual] = await Promise.all([
    env.DB.prepare(`SELECT live_count, latest_updated_at FROM entity_stats WHERE kind = ?`).bind(kind).first(),
    env.DB.prepare(`SELECT COUNT(*) AS cnt, MAX(updated_at) AS latest FROM ${table} WHERE deleted_at IS NULL AND hidden_at IS NULL`).first(),
  ]);
  if (!stats) return { kind, missing: true };
  return {
    kind,
    countMatches: (stats.live_count ?? 0) === (actual?.cnt ?? 0),
    storedCount: stats.live_count ?? 0,
    actualCount: actual?.cnt ?? 0,
    // latest_updated_at bilerek monoton (gizleme sonrası AZALTILMAZ, bkz. migration yorumu) —
    // bu yüzden "eşit" değil "geride değil" beklenir.
    latestNotStale: (stats.latest_updated_at ?? '') >= (actual?.latest ?? ''),
    storedLatest: stats.latest_updated_at ?? '',
    actualLatest: actual?.latest ?? '',
  };
}
