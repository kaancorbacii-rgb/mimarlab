import { json, errorJson, readJson } from '../lib/http.js';
import { newId } from '../lib/crypto.js';
import { SUBMISSION_TYPES, parseSubmissionRow } from '../lib/submissionTypes.js';
import { cachedPublicJson, invalidatePublicCache } from '../lib/publicCache.js';
// data.js/projeler-data.js/urunler-data.js/malzemeler-data.js/haberler-data.js tarayıcıda classic
// <script> olarak yüklenen, export içermeyen dosyalar; dosya sonlarındaki guard'lı `module.exports`
// bloğu sayesinde esbuild bunları CJS modülü olarak paketler (bkz. src/lib/seo.js'teki aynı desen).
import dataJs from '../../data.js';
import projeJs from '../../projeler-data.js';
import urunJs from '../../urunler-data.js';
import malzemeJs from '../../malzemeler-data.js';
import haberJs from '../../haberler-data.js';

const { architects, offices } = dataJs;
const { projects } = projeJs;
const { products } = urunJs;
const { materials } = malzemeJs;
const { newsItems } = haberJs;

// Statik (miras) içerik tiplerinin doğal anahtarı (bkz. schema.sql#legacy_content_hidden) ve admin
// panelinde kart olarak gösterilecek sade {title, subtitle, image} şekli. Ürün/malzemenin kararlı
// bir id'si olmadığından (urunler-data.js/malzemeler-data.js sadece title/brand tutar) anahtar
// "marka|||başlık" ikilisinden türetilir — nadir bir çakışma riski var ama admin panelinde her zaman
// tam kart içeriğiyle gösterildiğinden gizlemeden önce görsel olarak doğrulanabilir.
const LEGACY_TYPES = {
  projects: {
    all: () => projects,
    key: (item) => item.slug,
    shape: (item) => ({ title: item.title, subtitle: [item.location, item.date].filter(Boolean).join(' · '), image: (item.images && item.images[0]) || null }),
  },
  architects: {
    all: () => architects,
    key: (item) => item.name,
    shape: (item) => ({ title: item.name, subtitle: [item.office, item.school].filter(Boolean).join(' · '), image: item.photo || item.photo_url || null }),
  },
  offices: {
    all: () => offices,
    key: (item) => item.name,
    shape: (item) => ({ title: item.name, subtitle: [item.loc, item.cats].filter(Boolean).join(' · '), image: item.logo || null }),
  },
  products: {
    all: () => products,
    key: (item) => `${item.brand || ''}|||${item.title}`,
    shape: (item) => ({ title: item.title, subtitle: [item.brand, item.category].filter(Boolean).join(' · '), image: item.image || null }),
  },
  materials: {
    all: () => materials,
    key: (item) => `${item.brand || ''}|||${item.title}`,
    shape: (item) => ({ title: item.title, subtitle: [item.brand, item.category].filter(Boolean).join(' · '), image: item.image || null }),
  },
  news: {
    all: () => newsItems,
    key: (item) => item.id,
    shape: (item) => ({ title: item.title, subtitle: item.category || '', image: item.image || null }),
  },
};

function trLower(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}

// /api/admin/legacy?type=<tip>&q=<arama>  (GET: statik kayıtlarda başlık/isim araması)
// /api/admin/legacy/hidden  (PATCH: {type, key, hidden} — gizle/tekrar göster)
// requireAdmin kontrolü çağıran (src/routes/admin.js#handleAdminRoute) tarafından zaten yapıldı.
export async function handleLegacyAdmin(request, env, url, segments, user) {
  if (segments.length === 3 && request.method === 'GET') return searchLegacy(env, url);
  if (segments.length === 4 && segments[3] === 'hidden' && request.method === 'PATCH') return toggleLegacyHidden(request, env, user);
  if (segments.length === 4 && segments[3] === 'project-action' && request.method === 'POST') return handleProjectAction(request, env, user);
  if (segments.length === 4 && segments[3] === 'content-action' && request.method === 'POST') return handleContentAction(request, env, user);
  return errorJson('Bulunamadı', 404);
}

async function searchLegacy(env, url) {
  const type = url.searchParams.get('type');
  const q = (url.searchParams.get('q') || '').trim();
  const config = LEGACY_TYPES[type];
  if (!config) return errorJson('Geçersiz tip.');
  if (q.length < 2) return json({ items: [] });

  const needle = trLower(q);
  const matches = config.all().filter(item => trLower(config.shape(item).title).includes(needle)).slice(0, 50);
  const keys = matches.map(item => config.key(item));

  const hiddenSet = keys.length
    ? new Set((await env.DB.prepare(
        `SELECT content_key FROM legacy_content_hidden WHERE content_type = ? AND content_key IN (${keys.map(() => '?').join(', ')})`
      ).bind(type, ...keys).all()).results.map(r => r.content_key))
    : new Set();

  return json({
    items: matches.map(item => ({ key: config.key(item), hidden: hiddenSet.has(config.key(item)), ...config.shape(item) })),
  });
}

export async function setLegacyHidden(env, user, type, key, hidden) {
  if (hidden) {
    await env.DB.prepare(
      `INSERT INTO legacy_content_hidden (id, content_type, content_key, hidden_by_user_id, hidden_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(content_type, content_key) DO UPDATE SET hidden_by_user_id = excluded.hidden_by_user_id, hidden_at = excluded.hidden_at`
    ).bind(newId(), type, key, user.id, Date.now()).run();
  } else {
    await env.DB.prepare(
      `DELETE FROM legacy_content_hidden WHERE content_type = ? AND content_key = ?`
    ).bind(type, key).run();
  }
}

async function toggleLegacyHidden(request, env, user) {
  const body = await readJson(request);
  const config = LEGACY_TYPES[body.type];
  if (!config) return errorJson('Geçersiz tip.');
  const key = (body.key || '').trim();
  if (!key) return errorJson('Geçersiz kayıt.');
  await setLegacyHidden(env, user, body.type, key, !!body.hidden);
  await invalidatePublicCache();
  return json({ ok: true });
}

// GET /api/public/hidden — auth gerektirmez. Gizlenmiş statik kayıtların doğal anahtarlarını tipe
// göre gruplanmış olarak döner; her sayfa kendi statik dizisini bu listeye göre filtreler — proje-
// edits/profile-edits ile aynı overlay deseni (bkz. src/routes/public.js). Önbellekleme/admin
// muafiyeti cachedPublicJson içinde ele alınır (bkz. src/lib/publicCache.js).
export async function handlePublicHidden(request, env) {
  return cachedPublicJson(request, env, '/api/public/hidden', async () => {
    const { results } = await env.DB.prepare(`SELECT content_type, content_key FROM legacy_content_hidden`).all();
    const out = { projects: [], architects: [], offices: [], products: [], materials: [], news: [] };
    for (const row of results) {
      if (out[row.content_type]) out[row.content_type].push(row.content_key);
    }
    return out;
  });
}

// Statik bir projenin (projeler-data.js) "şu an canlıda görünen" hâli: temel statik veri + varsa
// admin'in onaylı düzenleme bindirmesi (claimed_slug, bkz. src/routes/public.js#handlePublicProjectEdits
// ile aynı birleştirme) — arşivleme, projeyi bu haliyle bir project_submissions taslağına kopyalar
// ki admin panelde düzenlerken en son görünen içerikten devam etsin, eski statik veriden değil.
const PROJECT_FIELD_KEYS = ['title', 'category', 'type', 'discipline', 'location', 'locationDetail', 'date', 'dateBucket', 'period', 'designer', 'photoCreditText', 'photoCreditUrl', 'description', 'images', 'brands'];

async function currentStaticProjectFields(env, slug) {
  const p = projeJs.projectBySlug(slug);
  if (!p) return null;
  const base = {
    title: p.title || '', category: p.category || [], type: p.type || [], discipline: p.discipline || [],
    location: p.location || null, locationDetail: p.locationDetail || null,
    date: p.date || null, dateBucket: p.dateBucket || null, period: p.period || [],
    designer: p.designer || [],
    photoCreditText: (p.photoCredit && p.photoCredit.text) || null,
    photoCreditUrl: (p.photoCredit && p.photoCredit.url) || null,
    description: p.description || null, images: p.images || [], brands: p.brands || [],
  };
  const editRow = await env.DB.prepare(
    `SELECT * FROM project_submissions WHERE claimed_slug = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT 1`
  ).bind(slug).first();
  if (!editRow) return base;
  const parsed = parseSubmissionRow('projects', editRow);
  const merged = { ...base };
  for (const f of PROJECT_FIELD_KEYS) merged[f] = parsed[f];
  return merged;
}

function bindProjectFields(fields) {
  return PROJECT_FIELD_KEYS.map(f =>
    SUBMISSION_TYPES.projects.arrayFields.includes(f) ? JSON.stringify(fields[f] || []) : fields[f]
  );
}

// POST /api/admin/legacy/project-action  body: {action:'delete'|'archive'|'publish', id?, slug?}
// proje-detay.html'deki (yalnızca admin görür) Sil/Arşivle butonlarının ve admin panelindeki Arşiv
// sekmesinin Yayınla/Sil aksiyonlarının tek ortak uç noktası (bkz. kullanıcı isteği: "arşivle
// butonuna tıklanırsa gönderi canlıdan çıkıp admin panelinin içine yerleşsin ... admin isterse ...
// tekrar yayınlayabilsin"). id: gerçek bir project_submissions satırı (üye gönderisi YA DA daha önce
// arşivlenmiş/düzenlenmiş statik proje) — durum doğrudan değiştirilir, claimed_slug'lıysa
// legacy_content_hidden senkron tutulur. slug: henüz hiç DB satırı olmayan statik bir proje —
// 'archive' onu ilk kez bir taslağa kopyalar, 'delete' yalnızca gizler (statik veri fiilen
// silinemez, bkz. schema.sql#legacy_content_hidden açıklaması).
async function handleProjectAction(request, env, user) {
  const body = await readJson(request);
  const action = body.action;
  const id = (body.id || '').trim();
  const slug = (body.slug || '').trim();
  if (!['delete', 'archive', 'publish'].includes(action)) return errorJson('Geçersiz işlem.');
  if (!id && !slug) return errorJson('Geçersiz istek.');

  if (id) {
    const row = await env.DB.prepare(`SELECT * FROM project_submissions WHERE id = ?`).bind(id).first();
    if (!row) return errorJson('Bulunamadı.', 404);
    const now = Date.now();
    if (action === 'delete') {
      await env.DB.prepare(`DELETE FROM project_submissions WHERE id = ?`).bind(id).run();
    } else if (action === 'archive') {
      await env.DB.prepare(`UPDATE project_submissions SET status = 'archived', updated_at = ? WHERE id = ?`).bind(now, id).run();
      if (row.claimed_slug) await setLegacyHidden(env, user, 'projects', row.claimed_slug, true);
    } else {
      await env.DB.prepare(`UPDATE project_submissions SET status = 'approved', updated_at = ? WHERE id = ?`).bind(now, id).run();
      if (row.claimed_slug) await setLegacyHidden(env, user, 'projects', row.claimed_slug, false);
    }
    await invalidatePublicCache();
    return json({ ok: true });
  }

  // slug ile: statik bir proje, henüz kendine ait bir project_submissions satırı olmayabilir.
  if (action === 'publish') return errorJson('Geçersiz istek.');

  if (action === 'delete') {
    await setLegacyHidden(env, user, 'projects', slug, true);
    await env.DB.prepare(`DELETE FROM project_submissions WHERE claimed_slug = ?`).bind(slug).run();
    await invalidatePublicCache();
    return json({ ok: true });
  }

  const fields = await currentStaticProjectFields(env, slug);
  if (!fields) return errorJson('Böyle bir statik proje bulunamadı.', 404);
  const now = Date.now();
  const existing = await env.DB.prepare(
    `SELECT id FROM project_submissions WHERE claimed_slug = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(slug).first();
  if (existing) {
    await env.DB.prepare(
      `UPDATE project_submissions SET ${PROJECT_FIELD_KEYS.map(f => `${f} = ?`).join(', ')}, status = 'archived', owner_user_id = ?, updated_at = ? WHERE id = ?`
    ).bind(...bindProjectFields(fields), user.id, now, existing.id).run();
  } else {
    const columns = ['id', 'owner_user_id', 'status', 'created_at', 'updated_at', 'slug', 'claimed_slug', ...PROJECT_FIELD_KEYS];
    const placeholders = columns.map(() => '?').join(', ');
    await env.DB.prepare(
      `INSERT INTO project_submissions (${columns.join(', ')}) VALUES (${placeholders})`
    ).bind(newId(), user.id, 'archived', now, now, slug, slug, ...bindProjectFields(fields)).run();
  }
  await setLegacyHidden(env, user, 'projects', slug, true);
  await invalidatePublicCache();
  return json({ ok: true });
}

// architects/offices'in mevcut claimed_profile_key + /api/public/profile-edits bindirme mekanizması
// (bkz. src/routes/public.js#handlePublicProfileEdits) sayesinde, projelerdeki claimed_slug ile
// birebir aynı desen: statik bir profili "arşivle" demek, o profilin GÜNCEL (varsa onaylı düzenleme
// bindirmeli) hâlini bir taslak satıra kopyalayıp claimed_profile_key ile statik anahtara bağlamak,
// sonra statik kaydı gizlemek. "Yayınla" taslağı onaylar ve statik kaydı tekrar gösterir — aynı
// profilin GÜNCELLENMİŞ hâli olarak canlıya döner. Ürünlerin böyle bir claimed-key/bindirme sistemi
// YOK (claim akışı hiç yok, bkz. src/lib/submissionTypes.js#products) — bu yüzden ürünlerde
// 'archive', statik kaydı KALICI olarak gizleyip bağımsız yeni bir taslak oluşturur; bu taslak
// yayınlandığında sıradan bir üye gönderisi gibi ayrı bir ürün olarak canlıya çıkar, statik köken
// bir daha geri gelmez (claimedColumn: null durumunda 'publish' asla gizliliği geri açmaz).
const CONTENT_ACTION_TYPES = {
  architects: {
    table: 'architect_submissions',
    claimedColumn: 'claimed_profile_key',
    copyFields: ['name', 'dob', 'school', 'dept', 'office', 'position', 'profession', 'awards', 'photo_url'],
    async staticFields(env, key) {
      const base = architects.find(x => x.name === key);
      if (!base) return null;
      const fields = {
        name: base.name, dob: base.dob || null, school: base.school || null, dept: base.dept || null,
        office: base.office || null, position: base.position || null, profession: base.profession || null,
        awards: base.awards || [], photo_url: base.photo || base.photo_url || null,
      };
      const editRow = await env.DB.prepare(
        `SELECT * FROM architect_submissions WHERE claimed_profile_key = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT 1`
      ).bind(key).first();
      if (editRow) {
        const parsed = parseSubmissionRow('architects', editRow);
        Object.assign(fields, {
          dob: parsed.dob, school: parsed.school, dept: parsed.dept, office: parsed.office,
          position: parsed.position, profession: parsed.profession, photo_url: parsed.photo_url,
        });
      }
      return fields;
    },
  },
  offices: {
    table: 'office_submissions',
    claimedColumn: 'claimed_profile_key',
    copyFields: ['name', 'loc', 'cats', 'yil', 'website', 'about', 'logo_url', 'awards', 'founders'],
    async staticFields(env, key) {
      const base = offices.find(x => x.name === key);
      if (!base) return null;
      const fields = {
        name: base.name, loc: base.loc || null, cats: base.cats || null, yil: base.yil || null,
        website: base.website || null, about: base.about || null, logo_url: base.logo || null,
        awards: base.awards || [], founders: base.founders || [],
      };
      const editRow = await env.DB.prepare(
        `SELECT * FROM office_submissions WHERE claimed_profile_key = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT 1`
      ).bind(key).first();
      if (editRow) {
        const parsed = parseSubmissionRow('offices', editRow);
        Object.assign(fields, {
          loc: parsed.loc, cats: parsed.cats, yil: parsed.yil, website: parsed.website,
          about: parsed.about, logo_url: parsed.logo_url,
        });
      }
      return fields;
    },
  },
  products: {
    table: 'product_submissions',
    claimedColumn: null,
    copyFields: ['title', 'brand', 'website', 'category', 'description', 'images'],
    async staticFields(_env, key) {
      const base = products.find(x => `${x.brand || ''}|||${x.title}` === key);
      if (!base) return null;
      return {
        title: base.title, brand: base.brand || null, website: base.website || null,
        category: base.category || null, description: base.description || null, images: base.images || [],
      };
    },
  },
};

function bindContentFields(type, fields) {
  const { copyFields } = CONTENT_ACTION_TYPES[type];
  const arrayFields = SUBMISSION_TYPES[type].arrayFields;
  return copyFields.map(f => (arrayFields.includes(f) ? JSON.stringify(fields[f] || []) : (fields[f] ?? null)));
}

// POST /api/admin/legacy/content-action  body: {type:'architects'|'offices'|'products', action:'delete'|'archive'|'publish', id?, key?}
// mimar-detay.html/ofis-detay.html'deki (yalnızca admin görür) Sil/Arşivle butonlarının, urun.html'deki
// ürün kartı admin aksiyonlarının ve admin panelindeki Arşiv sekmesinin tek ortak uç noktası —
// handleProjectAction ile AYNI mantık, 3 içerik tipine genelleştirildi (bkz. kullanıcı isteği:
// "mimar, firma ve ürüne silme ve arşivleme yetkisi ver"). id: gerçek bir <tip>_submissions satırı
// (üye gönderisi YA DA önceden arşivlenmiş statik kayıt taslağı). key: henüz hiç DB satırı olmayan
// statik bir kayıt — architects[]/offices[].name ya da ürünün "marka|||başlık" anahtarı (bkz.
// LEGACY_TYPES). "Sil" canlıdan kaldırır (id'liyse satırı siler, key'liyse statik kaydı gizler);
// "Arşivle" canlıdan kaldırıp admin panelinin Arşiv sekmesine taşır, admin isterse "Yayınla" ile
// tekrar canlıya alabilir.
async function handleContentAction(request, env, user) {
  const body = await readJson(request);
  const type = body.type;
  const config = CONTENT_ACTION_TYPES[type];
  if (!config) return errorJson('Geçersiz tip.');
  const action = body.action;
  const id = (body.id || '').trim();
  const key = (body.key || '').trim();
  if (!['delete', 'archive', 'publish'].includes(action)) return errorJson('Geçersiz işlem.');
  if (!id && !key) return errorJson('Geçersiz istek.');

  if (id) {
    const row = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
    if (!row) return errorJson('Bulunamadı.', 404);
    const now = Date.now();
    if (action === 'delete') {
      await env.DB.prepare(`DELETE FROM ${config.table} WHERE id = ?`).bind(id).run();
    } else if (action === 'archive') {
      await env.DB.prepare(`UPDATE ${config.table} SET status = 'archived', updated_at = ? WHERE id = ?`).bind(now, id).run();
      if (config.claimedColumn && row[config.claimedColumn]) await setLegacyHidden(env, user, type, row[config.claimedColumn], true);
    } else {
      await env.DB.prepare(`UPDATE ${config.table} SET status = 'approved', updated_at = ? WHERE id = ?`).bind(now, id).run();
      if (config.claimedColumn && row[config.claimedColumn]) await setLegacyHidden(env, user, type, row[config.claimedColumn], false);
    }
    await invalidatePublicCache();
    return json({ ok: true });
  }

  // key ile: statik bir kayıt, henüz kendine ait bir satır olmayabilir.
  if (action === 'publish') return errorJson('Geçersiz istek.');

  if (action === 'delete') {
    await setLegacyHidden(env, user, type, key, true);
    if (config.claimedColumn) {
      await env.DB.prepare(`DELETE FROM ${config.table} WHERE ${config.claimedColumn} = ?`).bind(key).run();
    }
    await invalidatePublicCache();
    return json({ ok: true });
  }

  const fields = await config.staticFields(env, key);
  if (!fields) return errorJson('Böyle bir statik kayıt bulunamadı.', 404);
  const now = Date.now();
  const boundValues = bindContentFields(type, fields);

  if (config.claimedColumn) {
    const existing = await env.DB.prepare(
      `SELECT id FROM ${config.table} WHERE ${config.claimedColumn} = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(key).first();
    if (existing) {
      await env.DB.prepare(
        `UPDATE ${config.table} SET ${config.copyFields.map(f => `${f} = ?`).join(', ')}, status = 'archived', owner_user_id = ?, updated_at = ? WHERE id = ?`
      ).bind(...boundValues, user.id, now, existing.id).run();
    } else {
      const columns = ['id', 'owner_user_id', 'status', 'created_at', 'updated_at', config.claimedColumn, ...config.copyFields];
      const placeholders = columns.map(() => '?').join(', ');
      await env.DB.prepare(
        `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`
      ).bind(newId(), user.id, 'archived', now, now, key, ...boundValues).run();
    }
  } else {
    const columns = ['id', 'owner_user_id', 'status', 'created_at', 'updated_at', ...config.copyFields];
    const placeholders = columns.map(() => '?').join(', ');
    await env.DB.prepare(
      `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`
    ).bind(newId(), user.id, 'archived', now, now, ...boundValues).run();
  }

  await setLegacyHidden(env, user, type, key, true);
  await invalidatePublicCache();
  return json({ ok: true });
}
