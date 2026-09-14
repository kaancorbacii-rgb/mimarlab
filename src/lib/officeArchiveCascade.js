// officeArchiveCascade.js — ADMIN BİR FİRMAYI/MARKAYI ARŞİVLEYİNCE ONA AİT KİŞİ, PROJE VE ÜRÜNLERİ
// DE ARŞİVE ALAN GRAFIN TEK KAYNAĞI (kullanıcı isteği, 2026-09-14: "admin bir firmayı ya da markayı
// arşivlerse o firma ve markaya ait kişiler, projeler ve ürünler otomatik olarak arşivlensin").
//
// BU, YAYIN GRAFININ (src/routes/admin.js#activateProfileGraph) TERS YÖNÜDÜR ve İLİŞKİLERİ ONUNLA
// AYNI YERDEN OKUR — iki yön aynı kümeyi görmezse "yayına al"ın geri getirdiği küme "arşivle"nin
// gizlediğinden farklı olurdu.
//
// MARKA AYRI BİR TABLO DEĞİL: marka da bir `offices` satırıdır, firma/marka ayrımı yalnızca `cats`
// ile yapılır (bkz. office-kind.js#isBrandOffice). Bu yüzden "firma ya da marka" için TEK bir graf
// yeter; markaya ait ürünler zaten aşağıdaki brand_office_id/brand_name_raw bağıyla gelir.
//
// BU MODÜL HİÇBİR ŞEY YAZMAZ — yalnızca "arşivlenecekler" listesini döner. Yazma işi çağırana
// (src/routes/legacyContent.js#archiveOfficeGraph) aittir ve orada CANLI KOD YOLUNDAN
// (runProjectAction / runContentAction) yapılır, çünkü geri alınabilirliği sağlayan *_submissions
// taslağı yalnızca o yolda oluşur (bkz. [[project_bulk_admin_ops_via_live_code_2026_09_08]]).

// Yayın grafıyla AYNI üst sınır (src/routes/admin.js#ACTIVATE_ID_LIMIT). Tek bir admin isteğinin
// Worker bütçesi içinde kalması için gerekli: her kayıt canlı kod yolundan geçtiğinden kayıt başına
// birkaç D1 sorgusu düşer.
export const ARCHIVE_CASCADE_ID_LIMIT = 60;

async function idsFrom(env, sql, binds) {
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return (results || []).map(r => r.id).filter(id => id !== null && id !== undefined);
}

// GERÇEK BULGU (kullanıcı bildirimi, 2026-09-14: "Arıkoğlu Arkitekt firmasını arşive aldım ama
// firmaya ait proje ve kişi otomatik olarak arşive alınmadı"): bu toplayıcı kaydı atlarken yalnızca
// `hidden_at` doluluğuna bakıyordu. Ama hidden_at ÜÇ durumdan İKİSİNDE dolu (bkz.
// migrations/0107_preview_state.sql):
//   hidden_at NULL, preview_at NULL -> yayında
//   hidden_at DOLU, preview_at DOLU -> ÖNİZLEME: listelerde hâlâ SOLUK KART olarak görünür
//   hidden_at DOLU, preview_at NULL -> tam arşiv: hiçbir yerde görünmez
// Yani önizlemedeki kayıtlar "zaten canlıda değil" sayılıp cascade'in DIŞINDA bırakılıyordu; firma
// arşive giderken künyesindeki kişi/proje/ürün önizlemede asılı kalıyor ve sitede soluk kart olarak
// görünmeye devam ediyordu — canlı vaka: Arıkoğlu Arkitekt + "Arıkoğlu Plaza Apartmanı" + "Kaya
// Arıkoğlu". Atlanması gereken tek durum GERÇEKTEN arşivlenmiş olandır (idempotans); önizleme
// arşivlenmelidir.
//
// Yazma yolu bunu zaten doğru yapıyor: setLegacyHidden(hidden=true) preview_at'i de NULL'a çeker
// (bkz. src/routes/legacyContent.js#setLegacyHidden'daki "Arşivle HER ZAMAN TAM arşiv demektir"
// notu) — eksik olan tek şey kaydın oraya HİÇ ulaşmamasıydı.
function isAlreadyArchived(row) {
  return !!row.hidden_at && !row.preview_at;
}

// "Bu kayıt, ARŞİVLENMEYEN ve HÂLÂ YAYINDA olan başka bir firmaya da mı ait?" — öyleyse cascade ona
// DOKUNMAZ.
//
// NEDEN VAR (yayın grafında olmayan tek fark): yayına almak toplayıcıdır, arşivlemek çıkarıcıdır.
// İki firmanın ORTAK tasarladığı bir proje, firmalardan biri arşivlenince canlıdan düşseydi, hâlâ
// yayında olan öteki firmanın künyesinden kendi projesi sessizce kaybolurdu. Aynısı iki firmada
// birden görünen bir kişi ve markası başka bir firma olan bir ürün için de geçerli.
//
// "Yayında" = hidden_at NULL (önizlemedeki/arşivdeki bir firma koruma sağlamaz — o da zaten canlıda
// değil). Arşivlenmekte olan firmanın KENDİSİ (seedOfficeIds) her zaman hariç tutulur; bu fonksiyon
// cascade seed firmayı arşivledikten ÖNCE de SONRA da aynı sonucu versin diye.
async function liveOfficeIdsExcluding(env, seedOfficeIds, candidateOfficeIds) {
  const others = [...new Set(candidateOfficeIds)].filter(id => !seedOfficeIds.includes(id));
  if (!others.length) return new Set();
  const ph = others.map(() => '?').join(', ');
  const live = await idsFrom(env,
    `SELECT id FROM offices WHERE id IN (${ph}) AND deleted_at IS NULL AND hidden_at IS NULL`, others);
  return new Set(live);
}

// Arşivlenecek kişi/proje/ürünleri toplar. Dönen her kayıt, çağıranın canlı kod yoluna geçireceği
// ANAHTARI da taşır (kişi/firma ÇIPLAK AD, proje/ürün slug — bkz. canonicalSync.js#canonicalKeyFor).
//
// `skipped`, ISTEYEREK atlananları taşır ve çağıran onu log/yanıt olarak verir: admin "arşivledim"
// dedikten sonra hâlâ canlı duran bir projeyi görünce bunun bir hata değil, ortak künye koruması
// olduğunu anlayabilmeli.
export async function collectOfficeArchiveTargets(env, office) {
  const seedOfficeIds = [office.id];
  const skipped = { architects: [], projects: [], products: [] };

  // ---------------------------------------------------------------------------------------------
  // 1) KİŞİLER — yayın grafındaki İKİ YAPISAL bağ: office_founders (firma pop-up'ının "Kurucular /
  //    Ortaklar" listesi) ve architects.office_id (kişinin birincil firması). Biri kurulup diğeri
  //    kurulmamış olabilir, bu yüzden ikisi de okunur.
  //
  //    YAYIN GRAFINDAN TEK EKSİK: architectIdsFromOfficeDraftNames — firma taslağının Kurucular/Ekip
  //    METİN kutusundaki adların isim eşleşmesi (name_fold). Yayına almak için doğru (fazladan bir
  //    profili blurdan çıkarmak zararsız), arşivlemek için DEĞİL: bir kişiyi yalnızca adı bir metin
  //    kutusunda geçtiği için canlıdan çekmek, adaş bir profili sessizce gizleyebilir. Yapısal bağı
  //    olmayan kişi bu cascade'in dışındadır.
  // ---------------------------------------------------------------------------------------------
  const architectIds = [...new Set([
    ...await idsFrom(env, `SELECT DISTINCT f.architect_id AS id FROM office_founders f WHERE f.office_id = ?`, seedOfficeIds),
    ...await idsFrom(env, `SELECT id FROM architects WHERE deleted_at IS NULL AND office_id = ?`, seedOfficeIds),
  ])].slice(0, ARCHIVE_CASCADE_ID_LIMIT);

  const architects = [];
  if (architectIds.length) {
    const ph = architectIds.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT id, name, slug, hidden_at, preview_at FROM architects WHERE id IN (${ph}) AND deleted_at IS NULL`
    ).bind(...architectIds).all();
    // Kişinin bağlı olduğu DİĞER firmalar (iki bağ da) — yayında olan varsa kişi korunur.
    const { results: links } = await env.DB.prepare(
      `SELECT architect_id AS aid, office_id AS oid FROM office_founders WHERE architect_id IN (${ph})
       UNION
       SELECT id AS aid, office_id AS oid FROM architects WHERE id IN (${ph}) AND office_id IS NOT NULL`
    ).bind(...architectIds, ...architectIds).all();
    const liveOthers = await liveOfficeIdsExcluding(env, seedOfficeIds, (links || []).map(l => l.oid));
    for (const a of results || []) {
      if (isAlreadyArchived(a)) continue; // gerçekten arşivde — dokunma (idempotans)
      const blocker = (links || []).find(l => l.aid === a.id && liveOthers.has(l.oid));
      if (blocker) { skipped.architects.push(a.name); continue; }
      architects.push({ id: a.id, key: a.name, label: a.name });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // 2) PROJELER — künyesi firmaya (project_designers.office_id) ya da yukarıdaki kişilere
  //    (project_designers.architect_id) bağlı olanlar; yayın grafındaki AYNI iki bağ ve
  //    canUserEditProjectBySlug'ın kullandığı bağ, yani "arşivlenen" ile "düzenlenebilen" küme örtüşür.
  // ---------------------------------------------------------------------------------------------
  const archivedArchitectIds = architects.map(a => a.id);
  const projectIdSet = new Set(await idsFrom(env,
    `SELECT DISTINCT pd.project_id AS id FROM project_designers pd WHERE pd.office_id = ?`, seedOfficeIds));
  if (archivedArchitectIds.length) {
    const ph = archivedArchitectIds.map(() => '?').join(', ');
    for (const id of await idsFrom(env,
      `SELECT DISTINCT pd.project_id AS id FROM project_designers pd WHERE pd.architect_id IN (${ph})`, archivedArchitectIds)) {
      projectIdSet.add(id);
    }
  }
  const projectIds = [...projectIdSet].slice(0, ARCHIVE_CASCADE_ID_LIMIT);

  const projects = [];
  if (projectIds.length) {
    const ph = projectIds.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT id, slug, title, hidden_at, preview_at FROM projects WHERE id IN (${ph}) AND deleted_at IS NULL`
    ).bind(...projectIds).all();
    const { results: designers } = await env.DB.prepare(
      `SELECT project_id AS pid, office_id AS oid FROM project_designers WHERE project_id IN (${ph}) AND office_id IS NOT NULL`
    ).bind(...projectIds).all();
    const liveOthers = await liveOfficeIdsExcluding(env, seedOfficeIds, (designers || []).map(d => d.oid));
    for (const p of results || []) {
      if (isAlreadyArchived(p)) continue;
      const blocker = (designers || []).find(d => d.pid === p.id && liveOthers.has(d.oid));
      if (blocker) { skipped.projects.push(p.title); continue; }
      projects.push({ id: p.id, key: p.slug, label: p.title });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // 3) ÜRÜNLER — markası bu firma olanlar (brand_office_id; o boşsa marka ADI, bkz.
  //    projectClaimAccess.js#canUserEditProductBySlug'daki AYNI eşleşme) + künyesinde yukarıdaki
  //    kişiler geçenler (product_architects). İstek "markaya ait ürünler" dediğinden asıl bağ
  //    birincisidir; ikincisi yayın grafıyla simetri için.
  //
  //    `type`: products ve materials AYNI canonical tabloda yaşar, ayrımları `kind` kolonudur ve
  //    canlı kod yolunda ayrı taslak tablolarına (product_submissions / material_submissions)
  //    gider — bu yüzden tip satırın kendi `kind`'ından okunur.
  // ---------------------------------------------------------------------------------------------
  const productIdSet = new Set(await idsFrom(env,
    `SELECT DISTINCT p.id AS id FROM products p JOIN offices o ON o.id = ?
      WHERE p.deleted_at IS NULL AND (p.brand_office_id = o.id OR p.brand_name_raw = o.name COLLATE NOCASE)`, seedOfficeIds));
  if (archivedArchitectIds.length) {
    const ph = archivedArchitectIds.map(() => '?').join(', ');
    for (const id of await idsFrom(env,
      `SELECT DISTINCT pa.product_id AS id FROM product_architects pa WHERE pa.architect_id IN (${ph})`, archivedArchitectIds)) {
      productIdSet.add(id);
    }
  }
  const productIds = [...productIdSet].slice(0, ARCHIVE_CASCADE_ID_LIMIT);

  const products = [];
  if (productIds.length) {
    const ph = productIds.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT id, slug, title, kind, brand_office_id, hidden_at, preview_at FROM products WHERE id IN (${ph}) AND deleted_at IS NULL`
    ).bind(...productIds).all();
    const liveOthers = await liveOfficeIdsExcluding(env, seedOfficeIds, (results || []).map(p => p.brand_office_id).filter(Boolean));
    for (const p of results || []) {
      if (isAlreadyArchived(p)) continue;
      // Markası BAŞKA ve hâlâ yayında olan bir firma olan ürün (yalnızca product_architects
      // üzerinden geldiyse mümkün) — o markanın kataloğundan düşmemeli.
      if (p.brand_office_id && liveOthers.has(p.brand_office_id)) { skipped.products.push(p.title); continue; }
      products.push({ id: p.id, key: p.slug, label: p.title, type: p.kind === 'material' ? 'materials' : 'products' });
    }
  }

  return { architects, projects, products, skipped };
}
