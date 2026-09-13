// gerçek bulgu (denetim raporu, 2026-08-16): src/routes/upload.js bir dosyayı R2'ye (env.UPLOADS,
// `u/<userId>/<uuid>.<ext>` anahtarıyla) HİÇBİR D1 satırına referans yazılmadan önce yazıyor —
// çok adımlı bir form (proje-ekle.html/kisi-ekle.html vb.) galeri görseli yüklenip TERK edilirse
// (kaydedilmeden sekme kapatılırsa) ya da bir görsel kaydetmeden önce değiştirilirse (upload.js
// yalnızca EKLER, önceki seçimi silmez) R2 nesnesi hiçbir zaman hiçbir kolondan referans edilmeden
// sonsuza kalır. Repo genelinde bu tür bir mutabakat/temizlik job'ı hiç yoktu (grep sıfır sonuç) —
// bu, r2Quota.js'in "asla ücretli kullanıma geçme" korumasının gerçek kullanımdan daha hızlı
// tükenmesine yol açar. Bu modül YALNIZCA canlı upload akışının yazdığı `u/` önekini tarar — Arkitera
// içe aktarma script'lerinin (bkz. proje hafızası) yazdığı diğer R2 önekleri (media/projects/ vb.)
// tek seferlik geçmiş veridir, sürekli sızıntı kaynağı DEĞİLDİR ve buradan KASITLI OLARAK hariç
// tutulur (yanlış pozitif riski çok daha yüksek, kapsam dışı).
//
// Tasarım: yalnızca RAPORLAR, hiçbir zaman kendiliğinden SİLMEZ (bkz. R2 free tier guard ilkesi —
// kullanıcı asla otomatik/beklenmedik bir R2 işlemi istemiyor). Admin, GET ile adayları görür, DELETE
// ile YALNIZCA kendi onayladığı anahtar listesini gönderip siler — bu iki adım arasında yeni bir
// yükleme olursa (aynı anahtar artık referanslı hale gelmiş olabilir) DELETE handler'ı silmeden hemen
// önce referans durumunu YENİDEN kontrol eder (aşağıdaki confirmStillOrphaned), gerçek bir race'i
// (yeni referanslı bir nesnenin yanlışlıkla silinmesini) engeller.
import { collectR2MediaKeysFromColumns } from './canonicalSync.js';
import { MEDIA_REFERENCE_SOURCES } from './r2References.js';

const PREFIX = 'u/';
// Yükleme ANINDA D1 satırı henüz yazılmamış olabilir (form akışı: önce görsel yüklenir, SONRA form
// gönderilir) — bu doğal gecikmeyi "orphan" ile karıştırmamak için nesne en az bu kadar eski
// olmadıkça rapora hiç girmez.
const GRACE_HOURS = 24;

// architects/offices/projects/products (canonical) + *_submissions (taslak) + job/news/users —
// upload.js'in 4 context'i (project/product/architect/office) VE varsayılan (haber/iş ilanı)
// context'i yazdığı HER kolonu kapsar (bkz. schema.sql/migrations/0022_id_first_entities.sql).
// Soft-delete/hidden durumuna bakılmaksızın (WHERE yok) taranır — arşivlenmiş/gizli bir kayıt hâlâ
// kurtarılabilir olduğundan görseli "hâlâ referanslı" sayılır, orphan adayı olmamalı.
// TEK KAYNAK (2026-09-13): tablo/kolon listesi artık src/lib/r2References.js#MEDIA_REFERENCE_SOURCES.
// Bu dosya "hiç referans edilmeyen nesneler"i (yetimler), o dosya ise "hâlâ referans edilen
// anahtarlar"ı (silme kapısı) arar — İKİ YÖN AYNI LİSTEDEN beslenmeli, aksi halde biri fazladan
// siler ya da fazladan korur. Kolon adları oradaki yorumda gerekçelendirilmiştir; ayrıca
// products/product_submissions/material_submissions `variants` kolonu da kapsanır (versiyon
// galerileri; bkz. collectR2MediaKeysFromColumns'taki gerçek bulgu).
const SOURCES = MEDIA_REFERENCE_SOURCES;

function columnList(columns) {
  return ['id', ...columns];
}

// Yukarıdaki SOURCES listesindeki TÜM tablo/kolonları tarayıp referans edilen R2 anahtarlarının
// tam kümesini döner — collectR2MediaKeys() (canonicalSync.js) zaten hem mutlak hem göreli
// "/media/..." URL'lerini aynı biçimde çözüyor, burada yeniden uygulanmıyor.
async function loadReferencedKeys(env) {
  const referenced = new Set();
  for (const { table, columns } of SOURCES) {
    const cols = columnList(columns);
    let rows;
    try {
      ({ results: rows } = await env.DB.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all());
    } catch {
      continue; // tablo yerel dev'de henüz migrate edilmemiş olabilir — atla, tarama durmasın
    }
    for (const row of rows) {
      for (const key of collectR2MediaKeysFromColumns(row, columns)) referenced.add(key);
    }
  }
  return referenced;
}

// R2'nin list() ucu tek çağrıda en fazla 1000 nesne döner — `u/` öneki tüm kullanıcı yüklemelerini
// kapsadığından (bkz. dosya başı yorum) cursor ile TAMAMI gezilir.
async function listAllR2Objects(env, prefix) {
  const objects = [];
  let cursor;
  do {
    const page = await env.UPLOADS.list({ prefix, cursor, limit: 1000 });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

// GET /api/admin/r2-orphans — bkz. dosya başı tasarım notu: yalnızca RAPORLAR.
export async function findR2Orphans(env) {
  const [referenced, objects] = await Promise.all([
    loadReferencedKeys(env),
    listAllR2Objects(env, PREFIX),
  ]);
  const graceMs = GRACE_HOURS * 60 * 60 * 1000;
  const now = Date.now();
  const orphans = objects
    .filter(o => !referenced.has(o.key) && (now - new Date(o.uploaded).getTime()) >= graceMs)
    .map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded }))
    .sort((a, b) => new Date(a.uploaded) - new Date(b.uploaded));
  return {
    orphans,
    orphanCount: orphans.length,
    orphanBytes: orphans.reduce((sum, o) => sum + o.size, 0),
    scannedObjects: objects.length,
    referencedKeys: referenced.size,
  };
}

// DELETE /api/admin/r2-orphans — admin'in GET'ten görüp onayladığı anahtarları siler. Silmeden hemen
// önce referans durumu YENİDEN kontrol edilir (bkz. dosya başı race-koruması notu) — GET ile DELETE
// arasında biri o anahtarı gerçekten kullanan yeni bir kayıt kaydettiyse o anahtar sessizce atlanır.
export async function confirmStillOrphaned(env, keys) {
  const referenced = await loadReferencedKeys(env);
  return keys.filter(key => !referenced.has(key));
}
