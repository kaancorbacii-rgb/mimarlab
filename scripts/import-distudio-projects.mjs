#!/usr/bin/env node
// diStudio Mimarlık — 10 projenin KAYIT adımı (kullanıcı isteği, 2026-09-19: distudio.com.tr'deki 10
// projeyi künye + yüksek çözünürlüklü galeriyle MİMARLAB'a ekle/zenginleştir, HİÇBİRİ /proje'nin 1.
// SAYFASINDA görünmesin, 2+ sayfalara karışık dağılsın).
//
// Görseller ÖNCE scripts/import-distudio-projects-images.py ile R2'ye yazılır; bu betik onun
// manifest'ini (--manifest) okur.
//
// YOL: SQL elle yazılmaz — canlı `POST /api/projects` işleyicisi (submissions.js#createSubmission)
// ADMIN oturumuyla, telif beyanı onaylı çağrılır; proje-ekle.html'in gönderdiği gövdenin AYNISI.
// project_submissions taslağı, canonical `projects` satırı, künye bağları (project_designers —
// diStudio Mimarlık + Didem/İlker Özdel), ham ad kolonları ve önbellek temizliği panelin
// ürettiğiyle birebir aynı olur (bkz. scripts/add-distudio-people.mjs'teki AYNI shim).
//
// ZENGİNLEŞTİRME: proje sitede zaten varsa (slug, Türkçe katlanmış başlık ya da distudio kaynak
// adresi eşleşirse) YENİ kayıt açılmaz; aynı uca `claimed_slug` ile (proje-ekle ?claim= akışı)
// mevcut görsellerin SONUNA yeni görseller eklenmiş, künyesi tamamlanmış bir düzenleme gönderilir.
//
// 1. SAYFA YASAĞI: sıralama anahtarı `(preview_at IS NOT NULL), COALESCE(display_order,0),
// COALESCE(relisted_at, publish_date, created_at) DESC, id DESC` (projectPool.js /
// project.js#fetchProjectPageRows). Her proje için 2..11. sayfalardan FARKLI bir sayfa ve o sayfada
// rastgele bir sıra seçilir (proje↔sayfa eşlemesi de karıştırılır); `publishDate` o sıranın iki
// komşusunun anahtarları ARASINA düşecek gün olarak hesaplanır. Admin publishDate verdiğinde
// syncProject `relisted_at` damgalamaz (canonicalSync.js#relistNew), yani sıra bu tarihle belirlenir.
//
// Varsayılan DRY-RUN; yazmak için --apply. AI YOK.
import { readFileSync } from 'node:fs';

globalThis.caches ||= { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };

const { handleSubmissionRoute } = await import('../src/routes/submissions.js');
const { foldTr } = await import('../src/lib/textMatch.js');

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const KV_NAMESPACE_ID = '9a8a1cfde13447a498bc5dcc4bc7d4ae'; // wrangler.jsonc FACET_CACHE
const TOKEN = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
if (!TOKEN) throw new Error('CLOUDFLARE_API_TOKEN gerekli.');
const APPLY = process.argv.includes('--apply');
const argOf = (name, def) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const MANIFEST = JSON.parse(readFileSync(argOf('manifest', 'import-distudio-manifest.json'), 'utf8'));
const SEED = Number(argOf('seed', '20260919')) || 20260919;
const PAGE_SIZE = 24;               // js/pages/proje.js#PAGE_SIZE (preflight iki tarafı eşitler)
const FIRST_PAGE = 2, LAST_PAGE = 11;
const DATA = JSON.parse(readFileSync(new URL('./import-distudio-projects.data.json', import.meta.url), 'utf8'));

const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;
let queryCount = 0;
async function rawQuery(sql, params = []) {
  queryCount++;
  for (let attempt = 1; attempt <= 5; attempt++) {
    let json = null, status = 0;
    try {
      const res = await fetch(`${API}/d1/database/${DATABASE_ID}/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params }),
      });
      status = res.status;
      json = await res.json().catch(() => null);
    } catch (err) { if (attempt === 5) throw err; }
    if (json && json.success) return json.result[0];
    const msg = JSON.stringify((json && json.errors) || status);
    if (attempt === 5) throw new Error(`D1 sorgusu başarısız: ${msg}\n${sql}`);
    await new Promise(r => setTimeout(r, 600 * attempt));
  }
}

let adminRow = null;
const SESSION_SQL = /FROM sessions s JOIN users u/;
function d1() {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) {
      if (SESSION_SQL.test(sql)) return adminRow;
      const r = await rawQuery(sql, params); const row = (r.results || [])[0]; if (!row) return null; return col ? row[col] : row;
    },
    async all() { const r = await rawQuery(sql, params); return { results: r.results || [] }; },
    async run() { const r = await rawQuery(sql, params); return { success: true, meta: r.meta || {} }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}
// FACET_CACHE: YALNIZCA silme gerçek KV'ye gider — invalidatePublicCache'in havuz/fingerprint
// anahtarlarını düşürmesi için (yoksa yeni projeler /proje'de 30 dk'ya kadar görünmezdi). Okuma
// "yok", yazma no-op: betik canlı önbelleğe hiçbir değer YAZMAZ.
const kvDeleted = [];
const FACET_CACHE = {
  async get() { return null; },
  async getWithMetadata() { return { value: null, metadata: null }; },
  async put() {},
  async list() { return { keys: [], list_complete: true }; },
  async delete(key) {
    if (!APPLY) return;
    try {
      const res = await fetch(`${API}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } });
      if (res.ok) kvDeleted.push(key);
    } catch { /* en iyi çaba — havuz TTL ile zaten tazelenir */ }
  },
};
const env = { DB: d1(), FACET_CACHE };

// ---- deterministik karıştırma (mulberry32) — dry-run ile apply AYNI dağılımı üretir -------------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng(SEED);
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const ORDER_SQL = `SELECT id, slug, title, (preview_at IS NOT NULL) AS pv, COALESCE(display_order, 0) AS d,
       COALESCE(relisted_at, publish_date, created_at) AS k
  FROM projects
 WHERE deleted_at IS NULL AND (hidden_at IS NULL OR preview_at IS NOT NULL) AND build_status = 'built'
 ORDER BY (preview_at IS NOT NULL) ASC, COALESCE(display_order, 0) ASC, COALESCE(relisted_at, publish_date, created_at) DESC, id DESC`;

// ------------------------------------------------------------------------------------------------
adminRow = (await rawQuery(
  `SELECT id, email, username, name, dob, school, dept, photo_url, profession, position, awards, about, social_links, role, created_at
     FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`
)).results[0];
if (!adminRow) throw new Error('Admin kullanıcı bulunamadı.');
console.log(`Admin: ${adminRow.email}${APPLY ? '' : '   [DRY-RUN — hiçbir şey yazılmayacak]'}`);

const office = (await rawQuery(
  `SELECT id, name, slug, hidden_at, preview_at FROM offices WHERE name = ? AND deleted_at IS NULL`, [DATA.office]
)).results;
if (office.length !== 1) throw new Error(`"${DATA.office}" firması tekil bulunamadı (${office.length}).`);
console.log(`Firma: ${office[0].name} (#${office[0].id} /firma/${office[0].slug})`);

// Görsel manifest'i eksiksiz mi?
for (const p of DATA.projects) {
  const urls = MANIFEST[p.slug] || [];
  if (urls.length !== p.images.length) throw new Error(`${p.slug}: manifest ${urls.length}/${p.images.length} görsel — önce görsel adımı tamamlanmalı.`);
}

// ---- mevcut kayıt eşleşmesi (upsert) --------------------------------------------------------------
const allProjects = (await rawQuery(
  `SELECT id, slug, title, images, source_url, photo_credit_url, hidden_at, preview_at FROM projects WHERE deleted_at IS NULL`
)).results;
function findExisting(p) {
  const src = DATA.sourceBase + p.sourcePath;
  const srcKey = p.sourcePath.split('/')[0];
  return allProjects.find(r => r.slug === p.slug)
    || allProjects.find(r => foldTr(r.title || '') === foldTr(p.title))
    || allProjects.find(r => [r.source_url, r.photo_credit_url].some(u => u && (u === src || u.includes(`distudio.com.tr/proje/${srcKey}/`))));
}

// ---- 1. sayfa dışı hedef sıralar ----------------------------------------------------------------
const order = (await rawQuery(ORDER_SQL)).results;
const liveBucket = order.filter(r => !r.pv && Number(r.d) === 0);
console.log(`Havuz: ${order.length} proje, sıralanan ilk kova (önizleme değil, display_order=0): ${liveBucket.length}`);
if (liveBucket.length < LAST_PAGE * PAGE_SIZE) throw new Error('İlk kova hedef sayfaları kapsamıyor — dağılım yeniden düşünülmeli.');

const pages = shuffle(Array.from({ length: LAST_PAGE - FIRST_PAGE + 1 }, (_, i) => FIRST_PAGE + i)).slice(0, DATA.projects.length);
const plan = DATA.projects.map((p, i) => ({ p, page: pages[i], slot: Math.floor(rand() * PAGE_SIZE) }));

const dayStr = (d) => d.toISOString().slice(0, 10);
function dateBetween(upper, lower) {
  // upper > v > lower (METİN karşılaştırması — SQLite'ın yaptığı gibi); v = "YYYY-MM-DD 00:00:00"
  const top = new Date(`${String(upper).slice(0, 10)}T00:00:00Z`);
  const bottom = new Date(`${String(lower).slice(0, 10)}T00:00:00Z`);
  for (let d = new Date(top); d >= bottom; d.setUTCDate(d.getUTCDate() - 1)) {
    const v = `${dayStr(d)} 00:00:00`;
    if (v < String(upper) && v > String(lower)) return dayStr(d);
  }
  return null;
}
// Hedefleri küçükten büyüğe yerleştir; k = kendisinden önce yerleşen yeni proje sayısı.
const sorted = [...plan].sort((a, b) => (a.page - b.page) || (a.slot - b.slot));
let placedBefore = 0, lastT = -1;
for (const item of sorted) {
  let t = Math.max((item.page - 1) * PAGE_SIZE + item.slot, lastT + 1);
  for (let tries = 0; tries < PAGE_SIZE; tries++) {
    const origIdx = t - placedBefore;             // bu sıraya yerleşince önünde origIdx eski kayıt var
    const upper = liveBucket[origIdx - 1], lower = liveBucket[origIdx];
    const d = upper && lower ? dateBetween(upper.k, lower.k) : null;
    const samePage = Math.floor(t / PAGE_SIZE) + 1 === item.page;
    if (d && samePage) { item.publishDate = d; item.target = t; item.between = [upper.slug, lower.slug]; break; }
    t++;
  }
  if (!item.publishDate) throw new Error(`${item.p.slug}: ${item.page}. sayfada uygun tarih aralığı bulunamadı.`);
  lastT = item.target;
  placedBefore++;
}
console.log('\nDağılım (sayfa · sıra · yayın tarihi · komşular):');
for (const it of plan) {
  console.log(`  ${it.p.slug.padEnd(28)} sayfa ${String(it.page).padStart(2)} · #${String(it.target % PAGE_SIZE + 1).padStart(2)} · ${it.publishDate} · ${it.between.join(' > * > ')}`);
}

// ---- gönderim ----------------------------------------------------------------------------------
console.log('');
const results = [];
for (const it of plan) {
  const p = it.p;
  const images = MANIFEST[p.slug];
  const existing = findExisting(p);
  const body = {
    title: p.title, category: p.category, type: p.type, discipline: p.discipline,
    location: p.location, locationDetail: p.locationDetail || '', date: p.date, dateBucket: p.dateBucket, period: [],
    designer: p.designer, office: p.office,
    photoCreditText: p.photoCreditText, photoCreditUrl: DATA.sourceBase + p.sourcePath,
    source_url: DATA.sourceBase + p.sourcePath,
    description: p.description, images, brands: [], build_status: 'built', awards: [],
    publishDate: it.publishDate, lat: p.lat, lng: p.lng,
    rightsAccepted: true, rightsTextVersion: '2026-09-10',
  };
  if (existing) {
    let old = [];
    try { old = JSON.parse(existing.images || '[]'); } catch {}
    body.images = [...old, ...images.filter(u => !old.includes(u))];
    body.claimed_slug = existing.slug;
    console.log(`${APPLY ? 'ZENGİNLEŞTİRİLİYOR' : 'ZENGİNLEŞTİRİLECEK'}: ${p.title} -> /proje/${existing.slug} (${old.length} + ${body.images.length - old.length} görsel)`);
  } else {
    console.log(`${APPLY ? 'EKLENİYOR' : 'EKLENECEK'}: ${p.title} — ${images.length} görsel, ${p.location}, ${p.date}, ${p.discipline.join('/')} · ${p.category.join('/')} · ${p.type.join('/')}, © ${p.photoCreditText}`);
  }
  if (!APPLY) continue;
  const req = new Request('https://mimarlab.com/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: '__Host-mimarlab_session=script' },
    body: JSON.stringify(body),
  });
  const res = await handleSubmissionRoute(req, env, new URL(req.url));
  const text = await res.text();
  console.log(`  -> HTTP ${res.status} ${text.slice(0, 300)}`);
  if (!res.ok) { process.exitCode = 1; continue; }
  let slug = existing ? existing.slug : null;
  try { slug = JSON.parse(text).slug || slug; } catch {}
  results.push({ ...it, slug });
}

// ---- doğrulama ---------------------------------------------------------------------------------
if (APPLY && results.length) {
  const after = (await rawQuery(ORDER_SQL)).results;
  const pos = new Map(after.map((r, i) => [r.slug, i]));
  console.log('\nDOĞRULAMA — canlı sıralamadaki yer:');
  let bad = 0;
  for (const r of results) {
    const i = pos.get(r.slug);
    const page = i === undefined ? null : Math.floor(i / PAGE_SIZE) + 1;
    const links = (await rawQuery(
      `SELECT COALESCE(a.name, o.name) AS name, CASE WHEN a.id IS NOT NULL THEN 'kişi' ELSE 'firma' END AS kind
         FROM project_designers pd JOIN projects p ON p.id = pd.project_id
         LEFT JOIN architects a ON a.id = pd.architect_id LEFT JOIN offices o ON o.id = pd.office_id
        WHERE p.slug = ?`, [r.slug])).results;
    const row = (await rawQuery(`SELECT publish_date, relisted_at, hidden_at, preview_at, json_array_length(images) AS n FROM projects WHERE slug = ?`, [r.slug])).results[0] || {};
    const ok = page !== null && page >= 2 && !row.hidden_at;
    if (!ok) bad++;
    console.log(`  ${ok ? 'OK ' : 'HATA'} /proje/${r.slug} -> sayfa ${page} (#${i === undefined ? '-' : (i % PAGE_SIZE) + 1}), publish_date ${row.publish_date}, relisted_at ${row.relisted_at || '-'}, ${row.n} görsel, künye: ${links.map(l => `${l.name} (${l.kind})`).join(', ')}`);
  }
  const page1 = after.slice(0, PAGE_SIZE).map(r => r.slug);
  const leak = results.filter(r => page1.includes(r.slug));
  console.log(`\n1. sayfada yeni proje: ${leak.length ? leak.map(r => r.slug).join(', ') : 'YOK'} · KV'den düşürülen anahtar: ${kvDeleted.length}`);
  if (bad || leak.length) process.exitCode = 1;
}
console.log(`\n(${queryCount} D1 sorgusu)`);
