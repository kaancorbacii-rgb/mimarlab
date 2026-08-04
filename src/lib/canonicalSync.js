// Faz 3 — okuma yolları artık *_submissions tablolarını HİÇ okumuyor (bkz. src/routes/architect.js/
// office.js/project.js/product.js, canonical architects/offices/projects/products'tan okuyor). Bu
// yüzden bir gönderi onaylandığında/onaylıyken düzenlendiğinde, o değişikliğin canlıya yansıması
// için canonical satırın da AYNI anda güncellenmesi ZORUNLU — aksi halde onay ekranı "başarılı"
// der ama site hiçbir şey göstermez (bkz. scripts/merge-submissions-to-id-first.js'in tek seferlik
// yaptığı overlay birleştirmesinin CANLI/sürekli karşılığı). Bu modül, o tek seferlik script'teki
// "claimed_profile_key/claimed_slug doluysa UPDATE, boşsa INSERT" kuralının tek-satırlık, D1
// prepared statement'larıyla çalışan canlı versiyonudur — bkz. src/routes/admin.js#handleSubmissionsAdmin
// (PATCH), src/routes/submissions.js#createSubmission/updateOwnSubmission (yalnızca admin'in
// doğrudan ekleme/düzenleme akışında status='approved' olabildiğinden oradan da çağrılır).
//
// architects/offices/projects için "bu submission zaten daha önce hangi canonical satırı
// oluşturdu" sorusu claimed_profile_key/claimed_slug'sız (bağımsız) kayıtlarda legacy_key =
// 'submission:<submissionId>' işaretiyle çözülür — yeni bir kolon eklemeden idempotent
// UPDATE-or-INSERT sağlar (bkz. scripts/merge-submissions-to-id-first.js'teki AYNI legacy_key
// kullanımı, orada NULL bırakılıyordu çünkü tek seferlikti; burada tekrar bulunabilir olması
// gerekiyor).

function submissionMarker(id) { return `submission:${id}`; }

// bkz. src/routes/legacyContent.js#LEGACY_TYPES.key — admin panelinin "içerik anahtarı" (mimar/ofis
// için bare name, proje için slug, ürün/malzeme için "marka|||başlık") ile canonical satırı bulur.
// Faz 3 öncesi bu anahtar legacy_content_hidden.content_key'e karşılık geliyordu; artık doğrudan
// canonical satırın kendisini (name/slug/legacy_key üzerinden) hedefler.
export async function findCanonicalRowByNaturalKey(env, typeKey, key) {
  if (typeKey === 'architects' || typeKey === 'offices') {
    const table = typeKey;
    return env.DB.prepare(`SELECT * FROM ${table} WHERE name = ? OR legacy_key = ? LIMIT 1`).bind(key, key).first();
  }
  if (typeKey === 'projects') {
    return env.DB.prepare(`SELECT * FROM projects WHERE slug = ? OR legacy_key = ? LIMIT 1`).bind(key, key).first();
  }
  if (typeKey === 'products' || typeKey === 'materials') {
    return env.DB.prepare(`SELECT * FROM products WHERE legacy_key = ? LIMIT 1`).bind(key).first();
  }
  return null;
}

async function findOneByName(env, table, name) {
  if (!name) return { row: null, ambiguous: false };
  const { results } = await env.DB.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL AND name = ?`).bind(name).all();
  if (results.length === 0) return { row: null, ambiguous: false };
  if (results.length > 1) return { row: null, ambiguous: true, candidates: results };
  return { row: results[0], ambiguous: false };
}

async function logConflict(env, entity_type, conflict_key, context, candidates) {
  await env.DB.prepare(
    `INSERT INTO migration_name_conflicts (entity_type, conflict_key, context, candidates, status) VALUES (?, ?, ?, ?, 'pending')`
  ).bind(entity_type, conflict_key, context, JSON.stringify(candidates.map(r => ({ id: r.id, name: r.name }))), 'pending').run();
}

async function syncOfficeFounderLink(env, architectId, officeId) {
  if (officeId === null || officeId === undefined) {
    await env.DB.prepare(`DELETE FROM office_founders WHERE architect_id = ?`).bind(architectId).run();
    return;
  }
  await env.DB.prepare(`DELETE FROM office_founders WHERE architect_id = ? AND office_id != ?`).bind(architectId, officeId).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO office_founders (office_id, architect_id) VALUES (?, ?)`).bind(officeId, architectId).run();
}

async function syncOffice(env, row) {
  const claimedKey = row.claimed_profile_key;
  const marker = submissionMarker(row.id);
  const target = claimedKey
    ? await env.DB.prepare(`SELECT * FROM offices WHERE deleted_at IS NULL AND (legacy_key = ? OR name = ?) LIMIT 1`).bind(claimedKey, claimedKey).first()
    : await env.DB.prepare(`SELECT * FROM offices WHERE legacy_key = ?`).bind(marker).first();

  const cats = row.cats ? JSON.stringify(Array.isArray(row.cats) ? row.cats : [row.cats]) : null;
  const awards = row.awards ? JSON.stringify(row.awards) : null;

  if (target) {
    const sets = [];
    const vals = [];
    if (claimedKey) {
      // bkz. src/routes/office.js (eski)#buildOfficePayload overlay'i — yalnızca truthy alanlar üzerine yazılır.
      if (row.name) { sets.push('name = ?'); vals.push(row.name); }
      if (row.loc) { sets.push('loc = ?'); vals.push(row.loc); }
      if (row.cats) { sets.push('cats = ?'); vals.push(cats); }
      if (row.yil) { sets.push('yil = ?'); vals.push(row.yil); }
      if (row.website) { sets.push('website = ?'); vals.push(row.website); }
      if (row.about !== undefined && row.about !== null && row.about !== '') { sets.push('about = ?'); vals.push(row.about); }
      if (row.logo_url) { sets.push('logo_url = ?'); vals.push(row.logo_url); }
    } else {
      // bağımsız kayıt — kendi taslağının her düzenlemesi tam birebir yansır.
      sets.push('name = ?', 'loc = ?', 'cats = ?', 'yil = ?', 'website = ?', 'about = ?', 'logo_url = ?');
      vals.push(row.name, row.loc || null, cats, row.yil || null, row.website || null, row.about || null, row.logo_url || null);
    }
    if (!sets.length) return target;
    sets.push(`updated_at = datetime('now')`);
    await env.DB.prepare(`UPDATE offices SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, target.id).run();
    return { ...target, id: target.id, name: row.name || target.name };
  }

  // Yeni bağımsız kayıt (claimedKey varsa ve hedef bulunamadıysa da — bozuk bir claim'i sessizce
  // atlamak yerine yeni bir kayıt olarak oluşturmak, üye içeriğinin kaybolmasından daha güvenli).
  const { slugify } = await import('./slugify.js');
  let slug = slugify(row.name) || `firma-${row.id}`;
  const clash = await env.DB.prepare(`SELECT id FROM offices WHERE slug = ?`).bind(slug).first();
  if (clash) slug = `${slug}-${row.id}`;
  const insert = await env.DB.prepare(
    `INSERT INTO offices (slug, name, loc, cats, yil, website, about, logo_url, awards, source, legacy_key, claimed_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submission', ?, ?)`
  ).bind(slug, row.name, row.loc || null, cats, row.yil || null, row.website || null, row.about || null, row.logo_url || null, awards, marker, row.owner_user_id).run();
  return env.DB.prepare(`SELECT * FROM offices WHERE id = ?`).bind(insert.meta.last_row_id).first();
}

async function syncArchitect(env, row) {
  const claimedKey = row.claimed_profile_key;
  const marker = submissionMarker(row.id);

  let officeId = null;
  if (row.office) {
    const match = await findOneByName(env, 'offices', row.office);
    if (match.ambiguous) await logConflict(env, 'office_founder', row.office, `architect_submission:${row.id}`, match.candidates);
    officeId = match.row ? match.row.id : null;
  }

  const target = claimedKey
    ? await env.DB.prepare(`SELECT * FROM architects WHERE deleted_at IS NULL AND (legacy_key = ? OR name = ?) LIMIT 1`).bind(claimedKey, claimedKey).first()
    : await env.DB.prepare(`SELECT * FROM architects WHERE legacy_key = ?`).bind(marker).first();

  const awards = row.awards ? JSON.stringify(row.awards) : null;

  if (target) {
    const sets = [];
    const vals = [];
    if (claimedKey) {
      if (row.name) { sets.push('name = ?'); vals.push(row.name); }
      if (row.dob) { sets.push('dob = ?'); vals.push(row.dob); }
      if (row.school) { sets.push('school = ?'); vals.push(row.school); }
      if (row.dept) { sets.push('dept = ?'); vals.push(row.dept); }
      if (row.profession) { sets.push('profession = ?'); vals.push(row.profession); }
      if (row.awards && row.awards.length) { sets.push('awards = ?'); vals.push(awards); }
      if (row.photo_url) { sets.push('photo_url = ?'); vals.push(row.photo_url); }
      if (row.about !== undefined && row.about !== null && row.about !== '') { sets.push('about = ?'); vals.push(row.about); }
      if (row.position) { sets.push('position = ?'); vals.push(row.position); }
      sets.push('office_id = ?'); vals.push(officeId);
    } else {
      sets.push('name = ?', 'dob = ?', 'school = ?', 'dept = ?', 'profession = ?', 'awards = ?', 'photo_url = ?', 'about = ?', 'position = ?', 'office_id = ?');
      vals.push(row.name, row.dob || null, row.school || null, row.dept || null, row.profession || null, awards, row.photo_url || null, row.about || null, row.position || null, officeId);
    }
    sets.push(`updated_at = datetime('now')`);
    await env.DB.prepare(`UPDATE architects SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, target.id).run();
    await syncOfficeFounderLink(env, target.id, officeId);
    return target;
  }

  const { slugify } = await import('./slugify.js');
  let slug = slugify(row.name) || `mimar-${row.id}`;
  const clash = await env.DB.prepare(`SELECT id FROM architects WHERE slug = ?`).bind(slug).first();
  if (clash) slug = `${slug}-${row.id}`;
  const insert = await env.DB.prepare(
    `INSERT INTO architects (slug, name, dob, school, dept, profession, position, awards, about, photo_url, office_id, source, legacy_key, claimed_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submission', ?, ?)`
  ).bind(slug, row.name, row.dob || null, row.school || null, row.dept || null, row.profession || null, row.position || null, awards, row.about || null, row.photo_url || null, officeId, marker, row.owner_user_id).run();
  const architectId = insert.meta.last_row_id;
  await syncOfficeFounderLink(env, architectId, officeId);
  return env.DB.prepare(`SELECT * FROM architects WHERE id = ?`).bind(architectId).first();
}

async function resolveDesignerLink(env, name, contextLabel) {
  const officeMatch = await findOneByName(env, 'offices', name);
  if (officeMatch.row) return { office_id: officeMatch.row.id, architect_id: null };
  if (officeMatch.ambiguous) { await logConflict(env, 'project_designer', name, contextLabel, officeMatch.candidates); return null; }
  const archMatch = await findOneByName(env, 'architects', name);
  if (archMatch.row) return { office_id: null, architect_id: archMatch.row.id };
  if (archMatch.ambiguous) { await logConflict(env, 'project_designer', name, contextLabel, archMatch.candidates); return null; }
  return null;
}

async function syncProject(env, row) {
  const claimedSlug = row.claimed_slug;
  const marker = submissionMarker(row.id);
  const target = claimedSlug
    ? await env.DB.prepare(`SELECT * FROM projects WHERE deleted_at IS NULL AND (legacy_key = ? OR slug = ?) LIMIT 1`).bind(claimedSlug, claimedSlug).first()
    : await env.DB.prepare(`SELECT * FROM projects WHERE legacy_key = ?`).bind(marker).first();

  const category = JSON.stringify(row.category || []);
  const type = JSON.stringify(row.type || []);
  const discipline = JSON.stringify(row.discipline || []);
  const period = JSON.stringify(row.period || []);
  const images = JSON.stringify(row.images || []);

  let projectId;
  if (target) {
    // bkz. src/routes/project.js (eski)#handleProjectDetailRoute overlay kuralları — title/category/
    // type/discipline/location/date/period/description/photoCredit koşulsuz, designer/images boşsa
    // eskisi korunur.
    const sets = [
      'title = ?', 'category = ?', 'type = ?', 'discipline = ?', 'location = ?', 'location_detail = ?',
      'project_date = ?', 'date_bucket = ?', 'period = ?', 'photo_credit_text = ?', 'photo_credit_url = ?',
      'description = ?', `updated_at = datetime('now')`,
    ];
    const vals = [
      row.title, category, type, discipline, row.location || null, row.locationDetail || null,
      row.date || null, row.dateBucket || null, period, row.photoCreditText || '', row.photoCreditUrl || '',
      row.description || null,
    ];
    if (row.images && row.images.length) { sets.splice(-1, 0, 'images = ?'); vals.push(images); }
    await env.DB.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
    projectId = target.id;
    if (row.designer && row.designer.length) await env.DB.prepare(`DELETE FROM project_designers WHERE project_id = ?`).bind(projectId).run();
  } else {
    let slug = row.slug;
    const clash = await env.DB.prepare(`SELECT id FROM projects WHERE slug = ?`).bind(slug).first();
    if (clash) slug = `${slug}-${row.id}`;
    const insert = await env.DB.prepare(
      `INSERT INTO projects (slug, title, category, type, discipline, location, location_detail, project_date, date_bucket, period, description, images, photo_credit_text, photo_credit_url, source_url, ai_generated, source, legacy_key, claimed_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submission', ?, ?)`
    ).bind(
      slug, row.title, category, type, discipline, row.location || null, row.locationDetail || null,
      row.date || null, row.dateBucket || null, period, row.description || null, images,
      row.photoCreditText || null, row.photoCreditUrl || null, row.source_url || null, row.ai_generated ? 1 : 0,
      marker, row.owner_user_id
    ).run();
    projectId = insert.meta.last_row_id;
  }

  if (row.designer && row.designer.length) {
    for (const name of row.designer) {
      const resolved = await resolveDesignerLink(env, name, `project_submission:${row.id}`);
      if (resolved) {
        await env.DB.prepare(`INSERT INTO project_designers (project_id, architect_id, office_id) VALUES (?, ?, ?)`)
          .bind(projectId, resolved.architect_id, resolved.office_id).run();
      }
    }
  }
  return env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
}

async function syncProduct(env, row, kind) {
  // products/materials'ta claim sistemi yok (bkz. schema.sql yorumu) — her onaylı satırın kendi
  // canonical karşılığı slug='m-<submissionId>' ile idempotent bulunur (bkz. scripts/
  // merge-submissions-to-id-first.js'teki AYNI slug şeması).
  const slug = `m-${row.id}`;
  const existing = await env.DB.prepare(`SELECT * FROM products WHERE slug = ?`).bind(slug).first();
  const images = JSON.stringify(row.images || []);
  const specs = JSON.stringify(row.specs || []);

  let brandOfficeId = null;
  if (row.brand) {
    const match = await findOneByName(env, 'offices', row.brand);
    if (match.ambiguous) await logConflict(env, 'product_brand', row.brand, `${kind}_submission:${row.id}`, match.candidates);
    brandOfficeId = match.row ? match.row.id : null;
  }

  let productId;
  if (existing) {
    await env.DB.prepare(
      `UPDATE products SET title = ?, brand_office_id = ?, brand_name_raw = ?, website = ?, category = ?, description = ?, images = ?, specs = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(row.title, brandOfficeId, row.brand || null, row.website || null, row.category || null, row.description || null, images, specs, existing.id).run();
    productId = existing.id;
    await env.DB.prepare(`DELETE FROM product_architects WHERE product_id = ?`).bind(productId).run();
  } else {
    const insert = await env.DB.prepare(
      `INSERT INTO products (slug, kind, title, brand_office_id, brand_name_raw, website, category, description, images, specs, source_url, ai_generated, source, claimed_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submission', ?)`
    ).bind(slug, kind, row.title, brandOfficeId, row.brand || null, row.website || null, row.category || null, row.description || null, images, specs, row.source_url || null, row.ai_generated ? 1 : 0, row.owner_user_id).run();
    productId = insert.meta.last_row_id;
  }

  const architectNames = (row.architect || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const name of architectNames) {
    const match = await findOneByName(env, 'architects', name);
    if (match.row) await env.DB.prepare(`INSERT INTO product_architects (product_id, architect_id) VALUES (?, ?)`).bind(productId, match.row.id).run();
    else if (match.ambiguous) await logConflict(env, 'product_architect', name, `${kind}_submission:${row.id}`, match.candidates);
  }
  return env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(productId).first();
}

// row: parseSubmissionRow(typeKey, rawRow) ile ZATEN parse edilmiş (JSON alanları diziye çevrilmiş)
// olmalı — bkz. src/lib/submissionTypes.js#parseSubmissionRow. jobs/news canonical modelde yok, no-op.
export async function syncApprovedSubmissionToCanonical(env, typeKey, row) {
  if (typeKey === 'architects') return syncArchitect(env, row);
  if (typeKey === 'offices') return syncOffice(env, row);
  if (typeKey === 'projects') return syncProject(env, row);
  if (typeKey === 'products') return syncProduct(env, row, 'product');
  if (typeKey === 'materials') return syncProduct(env, row, 'material');
  return null;
}

// Bir satır ONAYLIYKEN reddedilir/pending'e alınırsa (bkz. src/routes/admin.js#handleSubmissionsAdmin
// PATCH) — claimed_profile_key/claimed_slug'sız (bağımsız) kayıtlarda bu senkron mekanizmasının
// ÖNCEDEN oluşturduğu canonical satır artık gizlenmeli, aksi halde site onu göstermeye devam ederdi
// (claimed'lı kayıtlarda canonical satır zaten STATİK kökenli olduğundan buna dokunulmaz — o kaydın
// kendi hidden_at'i yalnızca legacyContent.js'in hide/delete akışıyla değişir).
export async function hideCanonicalForUnapprovedSubmission(env, typeKey, row) {
  if (!row) return;
  const marker = submissionMarker(row.id);
  const table = { architects: 'architects', offices: 'offices', projects: 'projects' }[typeKey];
  if (table) {
    await env.DB.prepare(`UPDATE ${table} SET hidden_at = datetime('now') WHERE legacy_key = ?`).bind(marker).run();
    return;
  }
  if (typeKey === 'products' || typeKey === 'materials') {
    await env.DB.prepare(`UPDATE products SET hidden_at = datetime('now') WHERE slug = ?`).bind(`m-${row.id}`).run();
  }
}

// Bir <tip>_submissions satırı KALICI olarak silindiğinde (bkz. src/routes/admin.js#handleSubmissionsAdmin
// DELETE) eşleşen canonical satırı da bulup deleted_at set eder — aksi halde canonical satır
// (bu senkron mekanizmasıyla zaten oluşmuş olabilir) sitede "hayalet" olarak görünmeye devam ederdi.
export async function markCanonicalDeletedForSubmission(env, typeKey, row) {
  if (!row) return;
  const marker = submissionMarker(row.id);
  const claimedKey = typeKey === 'projects' ? row.claimed_slug : row.claimed_profile_key;
  const table = { architects: 'architects', offices: 'offices', projects: 'projects' }[typeKey];
  if (table) {
    const keyCol = typeKey === 'projects' ? 'slug' : 'name';
    if (claimedKey) {
      // Claim edilmiş bir statik/canonical kaydın SİLİNMESİ, o kaydın kendisini değil yalnızca bu
      // gönderi/taslağı hedefler — legacyContent.js'in kendi hide/delete akışı canonical satırı
      // ayrıca yönetir, burada dokunmuyoruz.
      return;
    }
    await env.DB.prepare(`UPDATE ${table} SET deleted_at = datetime('now') WHERE legacy_key = ?`).bind(marker).run();
    return;
  }
  // products/materials
  await env.DB.prepare(`UPDATE products SET deleted_at = datetime('now') WHERE slug = ?`).bind(`m-${row.id}`).run();
}
