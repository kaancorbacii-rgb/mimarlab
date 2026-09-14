#!/usr/bin/env node
// BİR FİRMANIN İÇERİĞİNİ RAPORLA — SALT OKUNUR (kullanıcı sorusu, 2026-09-14: "Yerce Mimarlık'a
// ait proje arşivinde hangi projeler kaldı?").
//
// NEDEN VAR: bu soruların cevabı yalnızca D1'de durur; depoda proje/firma kaydı YOKTUR (statik
// data.js dosyaları kaldırıldı, bkz. scripts/export-d1-to-static.js). Uzak (web/telefon) Claude
// oturumundan hem `api.cloudflare.com` hem `mimarlab.com` çıkışı ağ politikasıyla kapalı (ölçüldü,
// 2026-09-14: CONNECT reddedildi), yani soru oradan yanıtlanamaz. Bunun için
// .github/workflows/office-content-report.yml var — runner'da hem ağ hem kimlik bilgisi vardır.
// archive-ofist.mjs / promote-office-newest-project.mjs ile AYNI desen; tek farkı: HİÇBİR ŞEY
// YAZMAZ.
//
// SALT OKUNUR — KAPI KODDA: d1 shim'i SELECT olmayan her ifadeyi reddeder (aşağıya bkz.). Bu
// betik canlı yazma yollarını (runContentAction/runProjectAction) İÇE BİLE AKTARMAZ; yanlışlıkla
// bir yazma eklenirse betik çalışma anında düşer, sessizce D1'e dokunmaz.
//
// NE RAPORLAR:
//   1. Firmanın kendisi ve durumu (yayında / ARŞİVDE / ÖNİZLEME).
//   2. Firmanın künyeli projeleri — project_designers.office_id bağı (archive-ofist.mjs ve
//      canUserEditProjectBySlug ile AYNI bağ), durumlarına göre gruplanmış.
//   3. Kurucu ortaklar (office_founders) + firmaya bağlı diğer kişiler (architects.office_id).
//   4. TAMAMLAYICI: firmaya değil, kurucularına/üyelerine künyelenmiş projeler — künye firma
//      yerine kişiye verildiğinde proje 2. listede GÖRÜNMEZ, "firmanın projesi yok" yanılgısı
//      tam olarak buradan doğar.
//
// AD EŞLEŞMESİ: önce birebir `offices.name`; bulunamazsa LIKE ile adaylar listelenir (ör. "Yerce"
// -> "Yerce Taylan Architects"). Birden çok birebir eşleşme varsa hepsi ayrı ayrı raporlanır —
// yazan betiklerin aksine burada belirsizlik tehlikeli değil, bilgi.
//
// KULLANIM:
//   node scripts/report-office-content.mjs --office="Yerce Mimarlık"
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, ...rest] = a.replace(/^--/, '').split('=');
  return [k, rest.length ? rest.join('=') : true];
}));
const OFFICE_NAME = typeof args.office === 'string' && args.office.trim() ? args.office.trim() : 'Yerce Mimarlık';

// Kimlik bilgisi — archive-ofist.mjs ile AYNI: CI'da CLOUDFLARE_API_TOKEN sırrı, yerelde wrangler
// OAuth token'ı. Sır tanımlıysa wrangler dosyasına HİÇ bakılmaz.
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
  // SALT OKUNUR KAPISI: tek giriş noktası burası olduğundan kapı da burada durur.
  if (!/^\s*select\b/i.test(sql)) throw new Error(`Bu betik salt okunur — SELECT olmayan ifade reddedildi:\n${sql}`);
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
async function all(sql, params = []) { const r = await rawQuery(sql, params); return r.results || []; }

// Kayıt durumu — archive-ofist.mjs'teki AYNI üçlü (hidden_at + preview_at). `deleted_at` ayrı
// raporlanır: SİLİNMİŞ kayıt "arşivde" DEĞİLDİR, "Arşivim > Yayına Al" ile de geri gelmez.
const state = r => (r.deleted_at ? 'SİLİNMİŞ' : r.hidden_at ? (r.preview_at ? 'ÖNİZLEME' : 'ARŞİVDE') : 'yayında');
const line = p => `      · ${p.title} (${p.slug})${p.project_date ? ` — ${p.project_date}` : ''}`;

console.log(`Aranan firma adı: "${OFFICE_NAME}"   [SALT OKUNUR — D1'e hiçbir şey yazılmaz]\n`);

let offices = await all(
  `SELECT id, name, slug, loc, hidden_at, preview_at, deleted_at, claimed_by_user_id FROM offices WHERE name = ? ORDER BY id`,
  [OFFICE_NAME]
);

if (!offices.length) {
  // Birebir eşleşme yok — ilk kelimeyle LIKE taraması (ör. "Yerce" -> "Yerce Taylan Architects").
  const needle = OFFICE_NAME.split(/\s+/)[0];
  const candidates = await all(
    `SELECT id, name, slug, loc, hidden_at, preview_at, deleted_at FROM offices WHERE name LIKE ? ORDER BY name`,
    [`%${needle}%`]
  );
  console.log(`"${OFFICE_NAME}" adıyla BİREBİR firma YOK.`);
  if (!candidates.length) {
    console.log(`"${needle}" geçen firma da yok. (${queryCount} D1 sorgusu)`);
    process.exit(0);
  }
  console.log(`"${needle}" geçen ${candidates.length} firma bulundu — hepsi aşağıda raporlanıyor:`);
  for (const o of candidates) console.log(`  · ${o.name} (#${o.id} / ${o.slug}) — ${state(o)}`);
  console.log('');
  offices = candidates;
}

for (const office of offices) {
  console.log('='.repeat(90));
  console.log(`FİRMA: ${office.name} (#${office.id} / ${office.slug})${office.loc ? ` — ${office.loc}` : ''}`);
  console.log(`  durum: ${state(office)}${office.claimed_by_user_id ? '  · bir hesaba bağlı' : ''}`);

  // 1) KÜNYELİ PROJELER — project_designers.office_id (archive-ofist.mjs ile AYNI bağ).
  const projects = await all(
    `SELECT DISTINCT p.id, p.slug, p.title, p.project_date, p.hidden_at, p.preview_at, p.deleted_at
       FROM project_designers pd JOIN projects p ON p.id = pd.project_id
      WHERE pd.office_id = ? ORDER BY p.title`,
    [office.id]
  );
  const by = { 'yayında': [], 'ARŞİVDE': [], 'ÖNİZLEME': [], 'SİLİNMİŞ': [] };
  for (const p of projects) by[state(p)].push(p);
  console.log(`\n  KÜNYELİ PROJE: ${projects.length} — yayında ${by['yayında'].length} · arşivde ${by['ARŞİVDE'].length} · önizleme ${by['ÖNİZLEME'].length} · silinmiş ${by['SİLİNMİŞ'].length}`);
  for (const k of ['yayında', 'ARŞİVDE', 'ÖNİZLEME', 'SİLİNMİŞ']) {
    if (!by[k].length) continue;
    console.log(`    ${k} (${by[k].length}):`);
    for (const p of by[k]) console.log(line(p));
  }

  // 2) KİŞİLER — kurucu ortaklar (office_founders) ve firmaya bağlı diğer kişiler.
  const founders = await all(
    `SELECT a.id, a.name, a.slug, a.position, a.hidden_at, a.preview_at, a.deleted_at
       FROM office_founders f JOIN architects a ON a.id = f.architect_id
      WHERE f.office_id = ? ORDER BY a.name`,
    [office.id]
  );
  const members = await all(
    `SELECT a.id, a.name, a.slug, a.position, a.hidden_at, a.preview_at, a.deleted_at
       FROM architects a
      WHERE a.office_id = ? AND a.id NOT IN (SELECT architect_id FROM office_founders WHERE office_id = ?)
      ORDER BY a.name`,
    [office.id, office.id]
  );
  console.log(`\n  KURUCU ORTAK: ${founders.length}`);
  for (const a of founders) console.log(`      · ${a.name} (${a.slug})${a.position ? ` — ${a.position}` : ''} — ${state(a)}`);
  if (members.length) {
    console.log(`  FİRMAYA BAĞLI DİĞER KİŞİ: ${members.length}`);
    for (const a of members) console.log(`      · ${a.name} (${a.slug})${a.position ? ` — ${a.position}` : ''} — ${state(a)}`);
  }

  // 3) TAMAMLAYICI — künyesi firmaya DEĞİL, bu kişilere verilmiş projeler. Yukarıdaki listede
  //    görünmezler; "firmanın projesi kalmamış" yanılgısı tam olarak buradan doğar.
  const people = [...founders, ...members].map(a => a.id);
  if (people.length) {
    const seen = new Set(projects.map(p => p.id));
    const viaPeople = await all(
      `SELECT DISTINCT p.id, p.slug, p.title, p.project_date, p.hidden_at, p.preview_at, p.deleted_at, a.name AS person
         FROM project_designers pd
         JOIN projects p ON p.id = pd.project_id
         JOIN architects a ON a.id = pd.architect_id
        WHERE pd.architect_id IN (${people.map(() => '?').join(',')})
        ORDER BY p.title`,
      people
    );
    const extra = viaPeople.filter(p => !seen.has(p.id));
    console.log(`\n  KİŞİ KÜNYESİYLE BAĞLI, FİRMA KÜNYESİNDE OLMAYAN PROJE: ${extra.length}`);
    for (const p of extra) console.log(`      · ${p.title} (${p.slug}) — ${state(p)} · künye: ${p.person}`);
  }
  console.log('');
}

console.log(`Bitti — hiçbir şey yazılmadı. (${queryCount} D1 sorgusu)`);
