#!/usr/bin/env node
// diStudio Mimarlık'ın üç kişisini (Didem Özdel, İlker Özdel, Yenal Akgün) kişi sayfasına ekler
// (kullanıcı isteği, 2026-09-19: "https://distudio.com.tr/ofis — linkteki kişileri kişi sayfasına
// uygun seçenekleri seçerek ekle, firma zaten firma sayfasında yüklü"; fotoğraflar kişilerin
// onayıyla kullanıcı tarafından iletildi, mimarlar/ altında statik varlık).
//
// YOL: SQL elle yazılmaz — canlı `POST /api/architects` işleyicisi (submissions.js#createSubmission)
// ADMIN oturumuyla, telif beyanı onaylı olarak çağrılır; kisi-ekle.html'in gönderdiği gövdenin
// AYNISI. Böylece architect_submissions taslağı, canonical `architects` satırı, firma bağı
// (office_founders + office_id — sahibi admin olduğundan onay kapısı serbest) ve önbellek temizliği
// panelin ürettiğiyle birebir aynı olur. Oturum, D1 shim'inde session sorgusu admin satırına
// yönlendirilerek taklit edilir (bkz. scripts/archive-ofist.mjs'teki AYNI shim).
//
// Varsayılan DRY-RUN; yazmak için --apply. Aynı adla kişi zaten varsa o kişi ATLANIR.
import { readFileSync } from 'node:fs';

globalThis.caches ||= { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };

const { handleSubmissionRoute } = await import('../src/routes/submissions.js');
const { foldTr } = await import('../src/lib/textMatch.js');

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const TOKEN = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
if (!TOKEN) throw new Error('CLOUDFLARE_API_TOKEN gerekli.');
const APPLY = process.argv.includes('--apply');
const DATA = JSON.parse(readFileSync(new URL('./add-distudio-people.data.json', import.meta.url), 'utf8'));

let queryCount = 0;
async function rawQuery(sql, params = []) {
  queryCount++;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let json = null, status = 0;
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
        { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) }
      );
      status = res.status;
      json = await res.json().catch(() => null);
    } catch (err) { if (attempt === 4) throw err; }
    if (json && json.success) return json.result[0];
    const msg = JSON.stringify((json && json.errors) || status);
    if (attempt === 4) throw new Error(`D1 sorgusu başarısız: ${msg}\n${sql}`);
    await new Promise(r => setTimeout(r, 500 * attempt));
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
const env = { DB: d1() };

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
console.log(`Firma: ${office[0].name} (#${office[0].id} / ${office[0].slug})\n`);

const existing = (await rawQuery(`SELECT name, slug FROM architects WHERE deleted_at IS NULL`)).results;
const existingFolds = new Map(existing.map(r => [foldTr(r.name || ''), r]));

for (const p of DATA.people) {
  const dup = existingFolds.get(foldTr(p.name));
  if (dup) { console.log(`ATLANDI (zaten var): ${p.name} -> /kisi/${dup.slug}`); continue; }
  const body = {
    name: p.name, dob: p.dob, school: p.school, profession: p.profession, office: office[0].name,
    position: p.position, awards: [], photo_url: p.photo_url, about: p.about, social_links: [], portfolio: [],
    rightsAccepted: true, rightsTextVersion: '2026-09-10',
  };
  console.log(`${APPLY ? 'EKLENİYOR' : 'EKLENECEK'}: ${p.name} — ${p.position}, ${p.profession}, ${p.dob}, ${p.school}, ${p.photo_url}`);
  if (!APPLY) continue;
  const req = new Request('https://mimarlab.com/api/architects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: '__Host-mimarlab_session=script' },
    body: JSON.stringify(body),
  });
  const res = await handleSubmissionRoute(req, env, new URL(req.url));
  const text = await res.text();
  console.log(`  -> HTTP ${res.status} ${text.slice(0, 300)}`);
  if (!res.ok) process.exitCode = 1;
}

if (APPLY) {
  const rows = (await rawQuery(
    `SELECT a.name, a.slug, a.position, a.hidden_at, a.preview_at, a.office_id,
            (SELECT COUNT(*) FROM office_founders f WHERE f.architect_id = a.id AND f.office_id = ?) AS linked
       FROM architects a WHERE a.office_id = ? AND a.deleted_at IS NULL ORDER BY a.name`, [office[0].id, office[0].id]
  )).results;
  console.log('\nFirmaya bağlı kişiler:');
  for (const r of rows) console.log(`  · ${r.name} (/kisi/${r.slug}) — ${r.position || '-'} — ${r.hidden_at ? 'GİZLİ' : 'yayında'} — office_founders:${r.linked}`);
}
console.log(`\n(${queryCount} D1 sorgusu)`);
