#!/usr/bin/env node
// BİR FİRMANIN "YILA GÖRE EN YENİ" PROJESİNİ PROJE SAYFASININ 1. SIRASINA TAŞI
// (kullanıcı isteği, 2026-09-14: "Bundan sonra yönetici hesabı atanan firmaların en yeni
// projelerini (en son yayınlanan değil yıla göre en yeni) proje sayfasında 1. sıraya koy. Örnek
// olarak en son yönetici yetkisi verdiğim FREA firması için bunu yap.")
//
// NEDEN BU BETİK VAR: kuralın KENDİSİ src/routes/admin.js#promoteOfficeProjectsOnAssignment'ta ve
// yalnızca ATAMA ANINDA çalışır (bkz. activateProfileGraph). FREA'ya yönetici yetkisi kural
// değişmeden ÖNCE verildi — yani promosyonunu ESKİ ölçütle ("en son yayınlanan") aldı ve
// profiles_promoted_at damgası düştüğü için yeni bir atama da onu tekrar çalıştırmaz
// (bkz. profilesPromotedBefore + migrations/0118_projects_promoted_at.sql). Bu betik, ZATEN
// atanmış bir firma için promosyonu YENİ ölçütle bir kez daha çalıştırır.
//
// KURAL TEK YERDE: sıralama/damgalama mantığı burada YENİDEN YAZILMAZ, canlı koddan içe aktarılır
// (promoteOfficeProjectsOnAssignment) — bkz. scripts/archive-ofist.mjs'teki AYNI gerekçe
// ([[project_bulk_admin_ops_via_live_code_2026_09_08]]). Betik sapmaz: admin panelinden bir atama
// yapılsaydı D1'e ne yazılacaksa BİREBİR o yazılır.
//
// NE YAPAR / NE YAPMAZ:
//   YAPAR   : firmanın künyeli (project_designers.office_id) ve ZATEN CANLI (deleted/hidden/preview
//             değil) projelerini yıla göre sıralar; yılı en yeni olana relisted_at=now +
//             display_order=NULL verir, kalan en fazla 10 projeyi günlük adımlarla geriye yayar.
//             Firma damgasızsa (projects_promoted_at NULL) damgayı da düşer.
//   YAPMAZ  : hiçbir kaydı yayına almaz/arşivlemez/silmez, önizlemeden çıkarmaz, slug/künye/görsel
//             DEĞİŞMEZ, yeni bir yönetici ataması YAPMAZ. Yalnızca sıralama alanlarına dokunur.
//
// VARSAYILAN DRY-RUN: --apply verilmedikçe D1'e HİÇBİR ŞEY yazılmaz; yalnızca öncesi/sonrası
// sıralama raporlanır (migrate.yml / archive-ofist.mjs ile AYNI sözleşme).
//
// KULLANIM:
//   node scripts/promote-office-newest-project.mjs                  # DRY-RUN, firma = FREA
//   node scripts/promote-office-newest-project.mjs --apply
//   node scripts/promote-office-newest-project.mjs --office="Per Se Mimarlık" --apply
//
// NEREDEN ÇALIŞTIRILIR: uzak (web/telefon) Claude oturumundan ÇALIŞTIRILAMAZ — o konteynerden
// `api.cloudflare.com` çıkışı ağ politikasıyla kapalıdır (ölçüldü, 2026-09-12: CONNECT'e 403).
// Bunun için .github/workflows/promote-office-newest-project.yml var; runner'da hem ağ hem kimlik
// bilgisi vardır (CLAUDE.md'deki AYNI gerekçe: deploy.yml / gundem-retitle.yml / archive-ofist.yml).
//
// CACHE: proje sayfasının VARSAYILAN (filtresiz) listesi her istekte D1 hızlı-yolundan okunur ve
// tazeliği entity_stats.rev parmak iziyle doğrulanır — projects tablosundaki HER UPDATE bu sayacı
// trigger'la artırdığından (bkz. migrations/0078_entity_stats.sql) yeni sıra ANINDA görünür.
// Yalnızca filtreli/aramalı görünümlerin beslendiği KV havuzu (pool:projects:*) en geç 30 dakikada
// (POOL_CACHE_TTL_SECONDS) kendi kendine tazelenir — bu betikten KV'ye erişim yoktur.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

// Worker global'i `caches` Node'da YOKTUR (scripts/archive-ofist.mjs'teki AYNI shim) — içe aktarılan
// modüllerin yükleme anında ona dokunma ihtimaline karşı sessiz bir no-op.
globalThis.caches ||= { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };

const { promoteOfficeProjectsOnAssignment, markProjectsPromoted, compareByProjectYearDesc } = await import('../src/routes/admin.js');
const { parseProjectDateYear } = await import('../src/routes/project.js');

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, ...rest] = a.replace(/^--/, '').split('=');
  return [k, rest.length ? rest.join('=') : true];
}));
const APPLY = !!args.apply && !args['dry-run'];
const OFFICE_NAME = typeof args.office === 'string' && args.office.trim() ? args.office.trim() : 'FREA';

// ---------------------------------------------------------------------------------------------
// Kimlik bilgisi — scripts/archive-ofist.mjs ile AYNI: CI'da CLOUDFLARE_API_TOKEN sırrı, yerelde
// wrangler OAuth token'ı. Sır tanımlıysa wrangler dosyasına HİÇ bakılmaz (bakılsaydı runner'da
// daha ilk satırda düşerdi).
// ---------------------------------------------------------------------------------------------
const TOKEN_PATHS = [
  `${homedir()}/Library/Preferences/.wrangler/config/default.toml`,
  `${homedir()}/.wrangler/config/default.toml`,
  `${homedir()}/.config/.wrangler/config/default.toml`,
];
function oauthToken() {
  for (const p of TOKEN_PATHS) {
    try { const m = readFileSync(p, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/); if (m) return m[1]; } catch { /* sıradaki yol */ }
  }
  throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın (ya da CLOUDFLARE_API_TOKEN verin).');
}
const TOKEN = (process.env.CLOUDFLARE_API_TOKEN || '').trim() || oauthToken();

let queryCount = 0;
async function rawQuery(sql, params = []) {
  queryCount++;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
      { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) }
    );
    const json = await res.json().catch(() => null);
    if (json && json.success) return json.result[0];
    const msg = JSON.stringify((json && json.errors) || res.status);
    // 7403 = token süresi doldu (bkz. [[project_wrangler_oauth_token_expires_mid_script]]).
    if (msg.includes('7403') || msg.includes('10000')) throw new Error(`D1 yetkilendirme hatası (token dolmuş olabilir): ${msg}`);
    if (attempt === 3) throw new Error(`D1 sorgusu başarısız: ${msg}\n${sql}`);
    await new Promise(r => setTimeout(r, 400 * attempt));
  }
}
// DRY-RUN KAPISI D1 SHIM'İNDE: promoteOfficeProjectsOnAssignment canlı koddur, "yazma" parametresi
// yoktur. Yazan ifadeler (UPDATE) burada yakalanıp LOG'lanır ve D1'e HİÇ gönderilmez — böylece
// dry-run, gerçek turun YAZACAĞI ifadelerin ta kendisini gösterir, bir taklidini değil.
const plannedWrites = [];
function isWrite(sql) { return /^\s*(update|insert|delete|replace)\b/i.test(sql); }
function d1() {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = await rawQuery(sql, params); const row = (r.results || [])[0]; if (!row) return null; return col ? row[col] : row; },
    async all() { const r = await rawQuery(sql, params); return { results: r.results || [] }; },
    async run() {
      if (!APPLY && isWrite(sql)) { plannedWrites.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return { success: true, meta: { changes: 0 } }; }
      const r = await rawQuery(sql, params);
      return { success: true, meta: r.meta || {} };
    },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}

const env = { DB: d1() };
console.log(`Firma: ${OFFICE_NAME}${APPLY ? '' : '   [DRY-RUN — hiçbir şey yazılmayacak]'}\n`);

// ---------------------------------------------------------------------------------------------
// 1) FİRMAYI BUL. Aynı adı taşıyan iki firma varsa hangisinin promosyona gireceği SESSİZCE id
//    sırasına düşerdi — burada dur (archive-ofist.mjs'teki AYNI kapı).
// ---------------------------------------------------------------------------------------------
const { results: officeMatches } = await env.DB.prepare(
  `SELECT id, name, slug, hidden_at, preview_at, projects_promoted_at FROM offices WHERE name = ? AND deleted_at IS NULL ORDER BY id`
).bind(OFFICE_NAME).all();
if (!officeMatches.length) throw new Error(`"${OFFICE_NAME}" firması bulunamadı.`);
if (officeMatches.length > 1) {
  throw new Error(`"${OFFICE_NAME}" adıyla ${officeMatches.length} firma var (${officeMatches.map(o => `#${o.id}/${o.slug}`).join(', ')}) — belirsiz, elle ayrıştırın.`);
}
const office = officeMatches[0];
console.log(`  #${office.id} / ${office.slug} — ${office.hidden_at ? (office.preview_at ? 'ÖNİZLEME' : 'ARŞİVDE') : 'yayında'}`);
console.log(`  projects_promoted_at: ${office.projects_promoted_at || 'BOŞ'}`);

// Yönetici/kurucu ataması GERÇEKTEN var mı — kural "yönetici hesabı atanan firmalar" diyor.
// Yalnızca RAPOR: atama yoksa betik durmaz (kullanıcı bilinçli olarak elle de çalıştırabilir),
// ama log'da görünür ki yanlış firmaya çalıştırıldığı fark edilsin.
const { results: claims } = await env.DB.prepare(
  `SELECT user_id, status, office_position FROM profile_claims WHERE profile_type = 'office' AND profile_key = ? AND status = 'approved'`
).bind(office.name).all();
console.log(`  onaylı atama: ${claims.length}${claims.length ? ` (${claims.map(c => c.office_position || 'yetkili').join(', ')})` : ' — YOK (dikkat)'}`);

// ---------------------------------------------------------------------------------------------
// 2) KÜNYELİ PROJELER — activateProfileGraph'ın promosyona verdiği AYNI küme (project_designers).
// ---------------------------------------------------------------------------------------------
const { results: projects } = await env.DB.prepare(
  `SELECT DISTINCT p.id, p.slug, p.title, p.project_date, p.publish_date, p.created_at, p.relisted_at, p.display_order,
          p.hidden_at, p.preview_at, p.deleted_at
     FROM project_designers pd JOIN projects p ON p.id = pd.project_id
    WHERE pd.office_id = ? ORDER BY p.id`
).bind(office.id).all();
const live = projects.filter(p => !p.deleted_at && !p.hidden_at && !p.preview_at);
console.log(`\nKünyeli proje: ${projects.length} (canlı: ${live.length})`);
// RAPOR SIRASI = PROMOSYON SIRASI: karşılaştırıcı burada YENİDEN YAZILMAZ, promosyonun kendi
// kullandığı compareByProjectYearDesc içe aktarılır — aksi halde log, D1'e yazılacak sıradan
// sessizce sapabilirdi.
const order = [...live]
  .map(p => ({ ...p, year: parseProjectDateYear(p.project_date), published: p.publish_date || p.created_at || '' }))
  .sort(compareByProjectYearDesc);
for (const [i, p] of order.entries()) {
  console.log(`  ${String(i + 1).padStart(2)}. ${p.title} (${p.slug}) — yıl: ${p.project_date || 'YOK'} -> ${p.year ?? 'çözülemedi'} · yayın: ${p.published.slice(0, 10)} · display_order: ${p.display_order ?? 'NULL'}`);
}
if (!order.length) {
  console.error('\nDURDURULDU — firmanın canlı (yayında) künyeli projesi yok, taşınacak bir şey de yok.');
  process.exit(1);
}
// Eski ölçüt neyi seçerdi — farkın gerçekten oluştuğunu log'da göster.
const oldTop = [...live].sort((a, b) => {
  const ap = a.publish_date || a.created_at || '', bp = b.publish_date || b.created_at || '';
  if (ap !== bp) return ap < bp ? 1 : -1;
  return b.id - a.id;
})[0];
console.log(`\n  ESKİ ölçüt (en son yayınlanan) : ${oldTop.title} (${oldTop.slug})`);
console.log(`  YENİ ölçüt (yıla göre en yeni) : ${order[0].title} (${order[0].slug})`);

// ---------------------------------------------------------------------------------------------
// 3) PROMOSYON — canlı kod yolu. noSpreadIds BOŞ: bu çağrıda önizlemeden çıkan kayıt yok
//    (unpreviewByIds hiç çalışmıyor), yani firmanın TÜM canlı projeleri yayılmaya girer.
// ---------------------------------------------------------------------------------------------
const nowIso = new Date().toISOString();
const promoted = await promoteOfficeProjectsOnAssignment(env, projects.map(p => p.id), nowIso, { noSpreadIds: new Set() });
if (!promoted) throw new Error('Promosyon çalışmadı (canlı proje bulunamadı) — hiçbir şey yazılmadı.');
if (!office.projects_promoted_at) await markProjectsPromoted(env, [office.id], [], nowIso);

if (!APPLY) {
  console.log(`\n[DRY-RUN] D1'e gönderilecek ${plannedWrites.length} yazma ifadesi:`);
  for (const w of plannedWrites) console.log(`  ${w.sql}  <- [${w.params.join(', ')}]`);
  console.log(`\nGerçekten uygulamak için --apply ile çalıştırın. (${queryCount} D1 sorgusu)`);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// 4) DOĞRULA — "1. sıraya aldım" demeden ÖNCE, proje sayfasının GERÇEK sırasını D1'den geri oku.
//    Sorgu, fetchProjectPageRows'un ORDER BY'ının BİREBİR aynısıdır (bkz. src/routes/project.js ve
//    migrations/0111_relisted_at_sort_fix.sql) — "damga düştü" demek "1. sırada" demek değildir.
// ---------------------------------------------------------------------------------------------
const { results: top } = await env.DB.prepare(
  `SELECT slug, title FROM projects
    WHERE deleted_at IS NULL AND hidden_at IS NULL AND build_status = 'built'
    ORDER BY (preview_at IS NOT NULL) ASC, COALESCE(display_order, 0) ASC, COALESCE(relisted_at, publish_date, created_at) DESC, id DESC
    LIMIT 5`
).all();
console.log('\nPROJE SAYFASININ İLK 5 SIRASI (fetchProjectPageRows ile AYNI ORDER BY):');
for (const [i, p] of top.entries()) console.log(`  ${i + 1}. ${p.title} (${p.slug})`);

const ok = top.length && top[0].slug === order[0].slug;
console.log(`\n${ok ? `Bitti — "${order[0].title}" proje sayfasının 1. sırasında.` : `BAŞARISIZ — 1. sırada "${top[0] && top[0].slug}" var, beklenen "${order[0].slug}".`} (${queryCount} D1 sorgusu)`);
if (!ok) process.exit(1);
