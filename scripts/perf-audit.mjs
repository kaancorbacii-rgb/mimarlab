#!/usr/bin/env node
// scripts/perf-audit.mjs — PRODUCTION HIZ/PERFORMANS ÖLÇÜMÜ (denetim, 2026-09-12).
//
// Neden ayrı bir betik: Claude Code'un uzak oturumu mimarlab.com'a çıkamıyor (CONNECT 403, bkz.
// CLAUDE.md), ölçüm bu yüzden ağı açık olan tek yerde — GitHub Actions runner'ında
// (.github/workflows/perf-audit.yml) ya da yerelde (`node scripts/perf-audit.mjs --base
// http://localhost:8787`) — çalışır. Salt okunur: yalnızca GET/HEAD atar, tek istisna geçersiz
// kimlik bilgisiyle bir POST /api/auth/login (401 bekler; hiçbir veri yazmaz).
//
// İki katman:
//   1) HTTP (Node fetch, tarayıcı önbelleği yok): sayfa/API/asset başına 3 ardışık istek — TTFB,
//      toplam süre, boyut, cf-cache-status / X-ML-Shell-Cache / Cache-Control. API'lerde ayrıca
//      benzersiz bir sorgu parametresiyle ZORUNLU bir MISS (soğuk D1 yolu).
//   2) Tarayıcı (Playwright Chromium): gerçek kullanıcı akışları — ilk yükleme (TTFB/FCP/LCP/
//      DCL/load, istek sayısı ve baytlar, tekrarlanan istekler, uzun görevler), liste → popup,
//      popup → popup, ESC/geri, ana sayfa → varlık, Giriş Yap, /hesabim (anonim), mobil
//      genişlikler ve 10+ popup aç/kapat sonrası dinleyici/DOM/heap büyümesi (CDP
//      Performance.getMetrics).
//
// Kullanım: node scripts/perf-audit.mjs [--base URL] [--out dosya.json] [--no-browser]
//           [--widths 1280,375] [--chromium /yol/chromium] [--modules /yol/node_modules]
// Çıktı: JSON (dosya + stdout'ta "===PERF-AUDIT-JSON===" işaretleri arasında) ve kısa özet.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; }
const BASE = (arg('--base', 'https://mimarlab.com')).replace(/\/+$/, '');
const OUT = arg('--out', '');
const NO_BROWSER = args.includes('--no-browser');
const WIDTHS = arg('--widths', '1280,375').split(',').map(n => parseInt(n, 10)).filter(Boolean);
const CHROMIUM = arg('--chromium', process.env.PERF_AUDIT_CHROMIUM || '');
const MODULES = arg('--modules', process.env.PERF_AUDIT_MODULES || '');
const HTTP_REPEAT = parseInt(arg('--repeat', '3'), 10);

const report = { base: BASE, startedAt: new Date().toISOString(), http: {}, browser: {}, errors: [] };
const log = (...a) => console.error('[perf-audit]', ...a);
const ms = (n) => Math.round(n);

// ------------------------------------------------------------------------------------------
// 1) HTTP
async function timedGet(url, init = {}) {
  const t0 = performance.now();
  let res, ttfb, bytes = 0, err = null;
  try {
    res = await fetch(url, { redirect: 'manual', ...init, headers: { 'User-Agent': 'mimarlab-perf-audit/1 (+curl-like)', 'Accept-Encoding': 'gzip, br', ...(init.headers || {}) } });
    ttfb = performance.now() - t0;
    const buf = await res.arrayBuffer();
    bytes = buf.byteLength;
  } catch (e) { err = String(e && e.message || e); }
  const total = performance.now() - t0;
  const h = res ? res.headers : new Headers();
  return {
    status: res ? res.status : 0, ttfb: ttfb != null ? ms(ttfb) : null, total: ms(total), bytes, err,
    cf: h.get('cf-cache-status'), shell: h.get('x-ml-shell-cache'), cc: h.get('cache-control'),
    age: h.get('age'), enc: h.get('content-encoding'), ct: (h.get('content-type') || '').split(';')[0],
    etag: h.get('etag') ? 1 : 0, len: h.get('content-length'), loc: h.get('location'),
  };
}

async function sampleUrl(key, pathname, opts = {}) {
  const url = BASE + pathname;
  const runs = [];
  for (let i = 0; i < (opts.repeat || HTTP_REPEAT); i++) runs.push(await timedGet(url, opts.init));
  const entry = { path: pathname, runs };
  if (opts.bust) {
    const sep = pathname.includes('?') ? '&' : '?';
    entry.cold = await timedGet(url + sep + '_pa=' + Date.now());
  }
  report.http[key] = entry;
  const r = runs[runs.length - 1];
  log(`${key}: ${r.status} ttfb=${r.ttfb}ms total=${r.total}ms bytes=${r.bytes} cf=${r.cf || '-'} shell=${r.shell || '-'} cc="${r.cc || ''}"${entry.cold ? ` cold(ttfb)=${entry.cold.ttfb}ms` : ''}`);
  return entry;
}

async function firstSlug(listPath, pick) {
  try {
    const res = await fetch(BASE + listPath, { headers: { 'User-Agent': 'mimarlab-perf-audit/1' } });
    const d = await res.json();
    const items = (d.items || []).filter(x => x && !x.preview);
    for (const it of items) { const s = pick(it); if (s) return s; }
  } catch (e) { report.errors.push('firstSlug ' + listPath + ': ' + e.message); }
  return null;
}

async function runHttp() {
  log('HTTP katmanı başlıyor:', BASE);
  const slugs = {
    project: await firstSlug('/api/projects?page=1&limit=12&noPreview=1', p => Array.isArray(p.images) && p.images[0] ? p.slug : null),
    architect: await firstSlug('/api/architects?page=1&limit=12&noPreview=1', a => a.slug),
    office: await firstSlug('/api/offices?page=1&limit=12&noPreview=1', o => o.slug),
    brand: await firstSlug('/api/offices?brands=1&page=1&limit=12&noPreview=1', o => o.slug),
    product: await firstSlug('/api/products?page=1&limit=12&noPreview=1', p => p.slug),
  };
  report.slugs = slugs;
  log('slug örnekleri:', JSON.stringify(slugs));

  const pages = {
    home: '/', proje: '/proje', kisi: '/kisi', firma: '/firma', marka: '/marka', urun: '/urun', gundem: '/gundem',
    hesabim: '/hesabim', giris: '/giris', arama: '/arama?q=ev', top100: '/en-iyi-100',
  };
  if (slugs.project) pages.projectDetail = '/proje/' + encodeURIComponent(slugs.project);
  if (slugs.architect) pages.architectDetail = '/kisi/' + encodeURIComponent(slugs.architect);
  if (slugs.office) pages.officeDetail = '/firma/' + encodeURIComponent(slugs.office);
  if (slugs.brand) pages.brandDetail = '/marka/' + encodeURIComponent(slugs.brand);
  if (slugs.product) pages.productDetail = '/urun/' + encodeURIComponent(slugs.product);
  for (const [k, p] of Object.entries(pages)) await sampleUrl('page:' + k, p);

  const apis = {
    projects: '/api/projects?page=1&limit=24', projectsBuilt: '/api/projects?buildStatus=built&page=1&limit=24',
    projectsFilters: '/api/projects/filters?buildStatus=built', architects: '/api/architects?page=1&limit=24',
    offices: '/api/offices?page=1&limit=24', brands: '/api/offices?page=1&limit=24&brands=1',
    products: '/api/products?page=1&limit=24', gundem: '/api/gundem?page=1&limit=12',
    homeProjects: '/api/projects?limit=24&noPreview=1', homeArchitects: '/api/architects?limit=6&noPreview=1',
    search: '/api/public/search?q=ev', suggest: '/api/public/search-suggest?q=mim',
    badges: '/api/public/badges', siteSettings: '/api/public/site-settings', platform: '/api/public/platform',
    top100: '/api/public/top100', authMe: '/api/auth/me', ratingsBulk: '/api/ratings/bulk?targetType=project',
  };
  if (slugs.project) apis.projectDetail = '/api/project/' + encodeURIComponent(slugs.project);
  if (slugs.architect) apis.architectDetail = '/api/architect/' + encodeURIComponent(slugs.architect);
  if (slugs.office) apis.officeDetail = '/api/office/' + encodeURIComponent(slugs.office);
  if (slugs.product) apis.productDetail = '/api/product/' + encodeURIComponent(slugs.product);
  for (const [k, p] of Object.entries(apis)) await sampleUrl('api:' + k, p, { bust: !/auth\/me|badges|site-settings/.test(p) });

  const assets = {
    siteChrome: '/js/components/site-chrome.js', authModal: '/js/components/auth-modal.js', modalShell: '/js/components/modal-shell.js',
    interCss: '/fonts/inter.css', authNav: '/auth-nav.js', imageCdn: '/image-cdn.js',
  };
  for (const [k, p] of Object.entries(assets)) await sampleUrl('asset:' + k, p, { repeat: 2 });
  // Sürümlü varyant (immutable bekleniyor)
  try {
    const html = await (await fetch(BASE + '/kisi')).text();
    const m = html.match(/<meta name="ml-asset-version" content="([^"]+)"/);
    if (m) { report.assetVersion = m[1]; await sampleUrl('asset:siteChromeVersioned', '/js/components/site-chrome.js?v=' + m[1], { repeat: 2 }); }
    const authMeta = html.match(/<meta name="ml-auth" content="([^"]+)"/);
    report.anonAuthMeta = authMeta ? authMeta[1] : null;
  } catch (e) { report.errors.push('version meta: ' + e.message); }

  // Geçersiz giriş (401 bekler, veri yazmaz)
  try {
    const t0 = performance.now();
    const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'mimarlab-perf-audit/1' }, body: JSON.stringify({ email: 'perf-audit-invalid@example.invalid', password: 'wrong-password-123' }) });
    await res.text();
    report.http['api:loginInvalid'] = { status: res.status, total: ms(performance.now() - t0) };
    log('loginInvalid:', res.status, report.http['api:loginInvalid'].total + 'ms');
  } catch (e) { report.errors.push('loginInvalid: ' + e.message); }
}

// ------------------------------------------------------------------------------------------
// 2) Tarayıcı
const INIT_SCRIPT = `(() => {
  const S = window.__pa = { paint: {}, lcp: null, longTasks: 0, longTaskMs: 0, cls: 0, marks: {} };
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) S.paint[e.name] = e.startTime; }).observe({ type: 'paint', buffered: true }); } catch {}
  try { new PerformanceObserver(l => { const es = l.getEntries(); const last = es[es.length - 1]; if (last) S.lcp = { t: last.startTime, size: last.size, url: last.url || '', tag: last.element ? last.element.tagName : '' }; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) { S.longTasks++; S.longTaskMs += e.duration; } }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) S.cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
})();`;

function typeOf(url, ct) {
  if (/\.(js)(\?|$)/.test(url)) return 'js';
  if (/\.(css)(\?|$)/.test(url)) return 'css';
  if (/\.(woff2?|ttf)(\?|$)/.test(url)) return 'font';
  if (/\/api\//.test(url)) return 'api';
  if (/\.(png|jpe?g|webp|avif|gif|svg)(\?|$)/.test(url) || /\/media\//.test(url) || /\/_derived\//.test(url)) return 'img';
  if (ct && ct.includes('image/')) return 'img';
  if (ct && ct.includes('javascript')) return 'js';
  if (ct && ct.includes('text/html')) return 'html';
  return 'other';
}

async function collectPageMetrics(page, requests, t0) {
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource').map(r => ({ n: r.name, t: r.initiatorType, d: Math.round(r.duration), s: r.startTime, enc: r.encodedBodySize, tr: r.transferSize, dec: r.decodedBodySize, rb: Math.round(r.responseEnd) }));
    const imgs = Array.from(document.images).map(i => {
      const r = i.getBoundingClientRect();
      return { src: (i.currentSrc || i.src || '').slice(0, 160), nw: i.naturalWidth, cw: Math.round(r.width), loading: i.getAttribute('loading') || '', inVp: r.bottom > 0 && r.top < innerHeight && r.width > 0, complete: i.complete, sizes: i.getAttribute('sizes') || '', srcset: !!i.getAttribute('srcset') };
    });
    const S = window.__pa || {};
    return {
      ttfb: nav ? Math.round(nav.responseStart) : null, dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null, load: nav ? Math.round(nav.loadEventEnd) : null,
      htmlBytes: nav ? nav.encodedBodySize : null, transferHtml: nav ? nav.transferSize : null,
      fcp: S.paint ? Math.round(S.paint['first-contentful-paint'] || 0) : null, lcp: S.lcp ? { t: Math.round(S.lcp.t), url: S.lcp.url.slice(0, 160), tag: S.lcp.tag } : null,
      longTasks: S.longTasks, longTaskMs: Math.round(S.longTaskMs || 0), cls: Math.round((S.cls || 0) * 1000) / 1000,
      resources: res, images: imgs, scripts: Array.from(document.scripts).filter(s => s.src).length, domNodes: document.getElementsByTagName('*').length,
    };
  });
  // İstek sayıları/baytlar (Playwright'tan; önbellekten gelenler dahil)
  const byType = {}; let totalBytes = 0; const seen = new Map();
  for (const r of requests) {
    const t = typeOf(r.url, r.ct);
    byType[t] = byType[t] || { n: 0, bytes: 0 };
    byType[t].n++; byType[t].bytes += r.bytes || 0; totalBytes += r.bytes || 0;
    const k = r.url.replace(/[?&]_pa=\d+/, '');
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dup = [...seen.entries()].filter(([, n]) => n > 1).map(([u, n]) => ({ url: u.replace(BASE, '').slice(0, 140), n }));
  const oversized = timing.images.filter(i => i.nw && i.cw && i.nw > i.cw * 2.2 && i.cw > 40).map(i => ({ src: i.src.replace(BASE, ''), nw: i.nw, cw: i.cw }));
  const notLazyOffscreen = timing.images.filter(i => !i.inVp && i.complete && !i.loading && i.nw > 0).length;
  return {
    ...timing, resources: undefined, images: undefined,
    resourceCount: timing.resources.length, requestCount: requests.length, totalBytes, byType, duplicates: dup,
    imageCount: timing.images.length, imagesLoaded: timing.images.filter(i => i.complete && i.nw > 0).length, oversized: oversized.slice(0, 12), oversizedCount: oversized.length, offscreenEagerLoaded: notLazyOffscreen,
    apiCalls: requests.filter(r => /\/api\//.test(r.url)).map(r => ({ u: r.url.replace(BASE, '').slice(0, 120), st: r.status, ms: r.ms, cf: r.cf })),
    jsFiles: requests.filter(r => typeOf(r.url, r.ct) === 'js').map(r => ({ u: r.url.replace(BASE, '').replace(/\?v=.*/, '').slice(0, 80), b: r.bytes, cached: r.cached })),
    wallMs: ms(performance.now() - t0),
  };
}

function attachRequestLog(page) {
  const requests = [];
  const starts = new Map();
  page.on('request', req => starts.set(req, performance.now()));
  page.on('response', async res => {
    const req = res.request();
    const entry = { url: res.url(), status: res.status(), ct: res.headers()['content-type'] || '', cf: res.headers()['cf-cache-status'] || '', ms: ms(performance.now() - (starts.get(req) || performance.now())), bytes: 0, cached: false };
    requests.push(entry);
    try {
      const sizes = await req.sizes();
      entry.bytes = sizes.responseBodySize + sizes.responseHeadersSize;
      entry.cached = sizes.responseBodySize === 0 && res.status() === 200 && !/\/api\//.test(entry.url);
    } catch { /* önbellek/iptal */ }
  });
  page.on('requestfailed', req => requests.push({ url: req.url(), status: -1, ct: '', failed: req.failure() && req.failure().errorText }));
  return requests;
}

async function newPage(browser, width) {
  const mobile = width < 700;
  const ctx = await browser.newContext({
    viewport: { width, height: mobile ? 812 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile,
    userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 mimarlab-perf-audit' : undefined,
  });
  const page = await ctx.newPage();
  await page.addInitScript(INIT_SCRIPT);
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e.message || e).slice(0, 200)));
  return { ctx, page, consoleErrors };
}

async function settle(page, msWait = 1500) { await page.waitForTimeout(msWait); }

async function measurePageLoad(browser, key, pathname, width) {
  const { ctx, page, consoleErrors } = await newPage(browser, width);
  const requests = attachRequestLog(page);
  const t0 = performance.now();
  try {
    await page.goto(BASE + pathname, { waitUntil: 'load', timeout: 60000 });
    await settle(page, 2500);
    const m = await collectPageMetrics(page, requests, t0);
    m.consoleErrors = consoleErrors.slice(0, 10);
    report.browser[`${key}@${width}`] = m;
    log(`${key}@${width}: ttfb=${m.ttfb} fcp=${m.fcp} lcp=${m.lcp && m.lcp.t} dcl=${m.dcl} load=${m.load} req=${m.requestCount} bytes=${Math.round(m.totalBytes / 1024)}KB dup=${m.duplicates.length} longTasks=${m.longTasks}(${m.longTaskMs}ms) imgs=${m.imageCount} oversized=${m.oversizedCount} errors=${consoleErrors.length}`);
  } catch (e) { report.errors.push(`${key}@${width}: ${e.message}`); log('HATA', key, e.message); }
  await ctx.close();
}

// Tıklamadan overlay'e ve içerik başlığına kadar süre (aynı belge).
async function timeClickToModal(page, clickSel, titleSel, owner, { fullNav = false, label = '' } = {}) {
  const out = { label, clickSel, owner };
  const hadOwner = await page.evaluate((o) => { const el = document.querySelector('.modal-shell-overlay.open'); return el ? (el.getAttribute('data-owner') || '') : ''; }, owner);
  const prevTitle = await page.evaluate((s) => { const el = document.querySelector(s); return el ? el.textContent.trim() : ''; }, titleSel).catch(() => '');
  const apiBefore = await page.evaluate(() => performance.getEntriesByType('resource').length);
  const t0 = performance.now();
  await page.evaluate(() => { window.__paClick = performance.now(); });
  const nav = fullNav ? page.waitForNavigation({ waitUntil: 'commit', timeout: 30000 }).catch(() => null) : null;
  await page.click(clickSel, { timeout: 10000 });
  if (fullNav) {
    await nav;
    out.navCommit = ms(performance.now() - t0);
    await page.waitForSelector('.modal-shell-overlay.open', { timeout: 30000 });
    out.overlayVisible = ms(performance.now() - t0);
    await page.waitForFunction((s) => { const el = document.querySelector(s); return el && el.textContent.trim().length > 0; }, titleSel, { timeout: 30000 });
    out.contentReady = ms(performance.now() - t0);
    out.nextDocTiming = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), transfer: n.transferSize } : null; });
    out.nextDocRequests = await page.evaluate(() => performance.getEntriesByType('resource').length);
  } else {
    await page.waitForFunction((o, prev) => { const el = document.querySelector('.modal-shell-overlay.open'); return el && (!o || el.getAttribute('data-owner') === o); }, owner, hadOwner, { timeout: 30000 });
    out.overlayVisible = await page.evaluate(() => Math.round(performance.now() - window.__paClick));
    await page.waitForFunction((s, prev) => { const el = document.querySelector(s); const t = el ? el.textContent.trim() : ''; return t.length > 0 && t !== prev; }, titleSel, prevTitle, { timeout: 30000 });
    out.contentReady = await page.evaluate(() => Math.round(performance.now() - window.__paClick));
    // popup açılırken atılan istekler
    out.requests = await page.evaluate((n) => performance.getEntriesByType('resource').slice(n).map(r => ({ u: r.name.replace(location.origin, '').replace(/\?v=[^&]+/, '').slice(0, 90), d: Math.round(r.duration), t: r.initiatorType, b: r.encodedBodySize })), apiBefore);
    out.requestCount = out.requests.length;
    out.apiMs = out.requests.filter(r => r.u.startsWith('/api/')).map(r => r.u + ':' + r.d);
    out.requests = out.requests.slice(0, 40);
  }
  out.url = page.url().replace(BASE, '');
  return out;
}

async function closeWithEscape(page) {
  const t0 = await page.evaluate(() => performance.now());
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.modal-shell-overlay.open'), null, { timeout: 15000 });
  const closed = await page.evaluate((t) => Math.round(performance.now() - t), t0);
  // arka sayfa yeniden kullanılabilir mi: body scroll kilidi kalktı mı
  await page.waitForFunction(() => document.body.style.position !== 'fixed', null, { timeout: 15000 });
  const usable = await page.evaluate((t) => Math.round(performance.now() - t), t0);
  return { closed, usable, url: page.url().replace(BASE, '') };
}

async function cdpMetrics(page) {
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const { metrics } = await session.send('Performance.getMetrics');
  const pick = (n) => { const m = metrics.find(x => x.name === n); return m ? m.value : null; };
  const listeners = await (async () => {
    try {
      const { result: win } = await session.send('Runtime.evaluate', { expression: 'window', objectGroup: 'pa' });
      const { result: doc } = await session.send('Runtime.evaluate', { expression: 'document', objectGroup: 'pa' });
      const w = await session.send('DOMDebugger.getEventListeners', { objectId: win.objectId });
      const d = await session.send('DOMDebugger.getEventListeners', { objectId: doc.objectId });
      const count = (l) => l.listeners.reduce((acc, x) => { acc[x.type] = (acc[x.type] || 0) + 1; return acc; }, {});
      return { window: w.listeners.length, document: d.listeners.length, windowByType: count(w), documentByType: count(d) };
    } catch (e) { return { err: e.message }; }
  })();
  await session.detach().catch(() => {});
  return { jsListeners: pick('JSEventListeners'), nodes: pick('Nodes'), heapMB: Math.round((pick('JSHeapUsedSize') || 0) / 1048576 * 10) / 10, documents: pick('Documents'), frames: pick('Frames'), ...listeners };
}

const LIST_CARD = { kisi: 'a.person-card', firma: 'a.office-card', marka: 'a.office-card', proje: 'a.content-card', urun: 'a.content-card-titlelink' };
const TITLE = { architect: '#am-name-text', office: '#om-name-text', project: '#pm-title', product: '#pr-title' };
const OWNER_OF = { kisi: 'architect', firma: 'office', marka: 'office', proje: 'project', urun: 'product' };

async function popupFlows(browser, width) {
  const results = {};
  // Liste → popup (soğuk: modül henüz yüklü değil) + ESC + tekrar aç (sıcak) + geri tuşu
  for (const list of ['kisi', 'firma', 'marka', 'urun', 'proje']) {
    const { ctx, page, consoleErrors } = await newPage(browser, width);
    attachRequestLog(page);
    const key = `list:${list}@${width}`;
    try {
      await page.goto(BASE + '/' + list, { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('#card-grid ' + LIST_CARD[list], { timeout: 30000 });
      await settle(page, 2000); // boşta ön-yükleme (warmListPageModule) gerçekleşsin
      const owner = OWNER_OF[list];
      const cold = await timeClickToModal(page, '#card-grid ' + LIST_CARD[list], TITLE[owner], owner, { label: 'cold' });
      await settle(page, 800);
      const esc = await closeWithEscape(page);
      await settle(page, 500);
      const warm = await timeClickToModal(page, '#card-grid ' + LIST_CARD[list] + ':nth-of-type(2), #card-grid ' + LIST_CARD[list], TITLE[owner], owner, { label: 'warm' });
      await settle(page, 500);
      // geri tuşu ile kapanış
      const tb = performance.now();
      await page.goBack({ waitUntil: 'commit', timeout: 15000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('.modal-shell-overlay.open'), null, { timeout: 15000 });
      const back = { closed: ms(performance.now() - tb), url: page.url().replace(BASE, '') };
      results[key] = { cold, esc, warm, back, consoleErrors: consoleErrors.slice(0, 8) };
      log(`${key}: cold overlay=${cold.overlayVisible} content=${cold.contentReady} (req=${cold.requestCount}) | esc=${esc.closed}/${esc.usable} | warm overlay=${warm.overlayVisible} content=${warm.contentReady} | back=${back.closed} url=${back.url}`);
    } catch (e) { results[key] = { err: e.message.slice(0, 300), consoleErrors: consoleErrors.slice(0, 8) }; log('HATA', key, e.message.slice(0, 200)); }
    await ctx.close();
  }

  // Popup → popup geçişleri (bir liste sayfasında açık popup içinden başka türe)
  const transitions = [
    { from: 'proje', to: 'kisi', owner: 'architect' }, { from: 'proje', to: 'firma', owner: 'office' }, { from: 'proje', to: 'urun', owner: 'product' }, { from: 'proje', to: 'marka', owner: 'office' },
    { from: 'kisi', to: 'firma', owner: 'office' }, { from: 'kisi', to: 'proje', owner: 'project' },
    { from: 'firma', to: 'kisi', owner: 'architect' }, { from: 'firma', to: 'proje', owner: 'project' },
    { from: 'marka', to: 'urun', owner: 'product' }, { from: 'urun', to: 'marka', owner: 'office' }, { from: 'urun', to: 'proje', owner: 'project' },
  ];
  for (const tr of transitions) {
    const key = `popup:${tr.from}->${tr.to}@${width}`;
    const { ctx, page, consoleErrors } = await newPage(browser, width);
    attachRequestLog(page);
    try {
      await page.goto(BASE + '/' + tr.from, { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('#card-grid ' + LIST_CARD[tr.from], { timeout: 30000 });
      await settle(page, 1500);
      const fromOwner = OWNER_OF[tr.from];
      // hedef türe bağlantısı olan bir kart bul (en fazla 6 kart dene)
      const cards = await page.$$('#card-grid ' + LIST_CARD[tr.from]);
      let opened = null, link = null;
      for (let i = 0; i < Math.min(cards.length, 6) && !link; i++) {
        if (i > 0) { await closeWithEscape(page); await settle(page, 400); }
        const sel = `#card-grid ${LIST_CARD[tr.from]}:nth-of-type(${i + 1})`;
        opened = await timeClickToModal(page, sel, TITLE[fromOwner], fromOwner, { label: 'open' }).catch(() => null);
        if (!opened) continue;
        await settle(page, 700);
        link = await page.evaluate((to) => {
          const ov = document.querySelector('.modal-shell-overlay.open');
          if (!ov) return null;
          const a = Array.from(ov.querySelectorAll(`a[href^="/${to}/"]`)).find(x => !/\/sayfa-\d+/.test(x.getAttribute('href')) && x.offsetParent !== null);
          if (!a) return null;
          a.setAttribute('data-pa-target', '1');
          return a.getAttribute('href');
        }, tr.to);
      }
      if (!link) { results[key] = { skipped: 'hedef türe bağlantı bulunamadı', tried: Math.min(cards.length, 6) }; log(key, 'atlandı (bağlantı yok)'); await ctx.close(); continue; }
      // Proje modülü preloadedOnly: proje.html dışında tam sayfa gezinme beklenir
      const projectLoaded = await page.evaluate(() => !!window.ProjectModal);
      const fullNav = tr.owner === 'project' && !projectLoaded;
      const t = await timeClickToModal(page, 'a[data-pa-target="1"]', TITLE[tr.owner], tr.owner, { fullNav, label: 'transition' });
      t.fullNavigation = fullNav;
      results[key] = { open: { overlayVisible: opened.overlayVisible, contentReady: opened.contentReady }, transition: t, link, consoleErrors: consoleErrors.slice(0, 8) };
      log(`${key}: ${fullNav ? 'TAM SAYFA' : 'aynı belge'} overlay=${t.overlayVisible} content=${t.contentReady}${t.navCommit ? ' navCommit=' + t.navCommit : ''} api=${JSON.stringify(t.apiMs || [])}`);
    } catch (e) { results[key] = { err: e.message.slice(0, 300), consoleErrors: consoleErrors.slice(0, 8) }; log('HATA', key, e.message.slice(0, 200)); }
    await ctx.close();
  }
  return results;
}

async function homeFlows(browser, width) {
  const results = {};
  const targets = [
    { key: 'home->proje', track: '#slider-track', owner: 'project' }, { key: 'home->kisi', track: '#kisi-slider-track', owner: 'architect' },
    { key: 'home->firma', track: '#firma-slider-track', owner: 'office' }, { key: 'home->urun', track: '#urun-slider-track', owner: 'product' },
    { key: 'home->marka', track: '#marka-slider-track', owner: 'office' },
  ];
  for (const t of targets) {
    const key = `${t.key}@${width}`;
    const { ctx, page, consoleErrors } = await newPage(browser, width);
    attachRequestLog(page);
    try {
      await page.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector(`${t.track} a.proje-slide.active`, { timeout: 30000 });
      await settle(page, 1500);
      const r = await timeClickToModal(page, `${t.track} a.proje-slide.active`, TITLE[t.owner], t.owner, { fullNav: true, label: t.key });
      results[key] = { ...r, consoleErrors: consoleErrors.slice(0, 6) };
      log(`${key}: navCommit=${r.navCommit} overlay=${r.overlayVisible} content=${r.contentReady} nextDoc=${JSON.stringify(r.nextDocTiming)} req=${r.nextDocRequests}`);
    } catch (e) { results[key] = { err: e.message.slice(0, 300) }; log('HATA', key, e.message.slice(0, 200)); }
    await ctx.close();
  }
  // Karusel etkileşimi: ok tıklamalarında atılan istekler
  {
    const key = `home:carousel@${width}`;
    const { ctx, page } = await newPage(browser, width);
    const requests = attachRequestLog(page);
    try {
      await page.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('#slider-track a.proje-slide.active', { timeout: 30000 });
      await settle(page, 3000);
      const before = requests.length;
      const beforeImgs = requests.filter(r => typeOf(r.url, r.ct) === 'img').length;
      for (let i = 0; i < 4; i++) { await page.click('#slider-next'); await page.waitForTimeout(400); }
      for (let i = 0; i < 3; i++) { await page.click('#kisi-next').catch(() => {}); await page.waitForTimeout(300); }
      await settle(page, 1500);
      const after = requests.slice(before);
      results[key] = { initialRequests: before, initialImgs: beforeImgs, afterClicks: { n: after.length, api: after.filter(r => /\/api\//.test(r.url)).length, img: after.filter(r => typeOf(r.url, r.ct) === 'img').length, urls: after.map(r => r.url.replace(BASE, '').slice(0, 100)).slice(0, 20) } };
      log(`${key}: ilk=${before} istek (img ${beforeImgs}); 7 ok tıklaması sonrası +${after.length} (api ${results[key].afterClicks.api}, img ${results[key].afterClicks.img})`);
    } catch (e) { results[key] = { err: e.message.slice(0, 300) }; }
    await ctx.close();
  }
  return results;
}

async function authFlows(browser, width) {
  const results = {};
  // Giriş Yap popup'ı (anonim) + geçersiz giriş + Üye Ol geçişi
  {
    const key = `auth:login@${width}`;
    const { ctx, page, consoleErrors } = await newPage(browser, width);
    const requests = attachRequestLog(page);
    try {
      await page.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
      await settle(page, 1500);
      const before = requests.length;
      const sel = width < 700 ? '#nav-hamburger, .nav-hamburger' : 'a.nav-rate[href="/giris"]';
      if (width < 700) { await page.click(sel); await page.waitForSelector('.nav-mobile-menu.open, .nav-drawer.open, [class*="drawer"].open', { timeout: 5000 }).catch(() => {}); }
      const t0 = await page.evaluate(() => performance.now());
      await page.click(width < 700 ? 'a.nav-mobile-cta[href="/giris"], a[href="/giris"]:visible' : sel);
      await page.waitForSelector('.modal-shell-overlay.open .auth-title, .auth-title', { timeout: 30000 });
      const opened = await page.evaluate((t) => Math.round(performance.now() - t), t0);
      const loaded = requests.slice(before).map(r => ({ u: r.url.replace(BASE, '').replace(/\?v=.*/, '').slice(0, 80), ms: r.ms, b: r.bytes }));
      await page.fill('#am-login-email, input[type="email"]', 'perf-audit-invalid@example.invalid').catch(() => {});
      await page.fill('#am-login-password, input[type="password"]', 'wrong-password-123').catch(() => {});
      const n0 = requests.length;
      const t1 = performance.now();
      await page.click('.auth-submit').catch(() => {});
      await page.waitForFunction(() => { const n = document.querySelector('#am-login-notice'); return n && n.textContent.trim().length > 0; }, null, { timeout: 15000 }).catch(() => {});
      const invalid = { ms: ms(performance.now() - t1), requests: requests.slice(n0).map(r => r.url.replace(BASE, '') + ':' + r.status + ':' + r.ms + 'ms') };
      // Üye Ol'a geçiş
      const t2 = await page.evaluate(() => performance.now());
      await page.click('#am-goto-signup').catch(() => {});
      await page.waitForFunction(() => location.pathname === '/uye-ol', null, { timeout: 10000 }).catch(() => {});
      const signup = await page.evaluate((t) => Math.round(performance.now() - t), t2);
      const esc = await closeWithEscape(page).catch(e => ({ err: e.message }));
      results[key] = { opened, loadedOnOpen: loaded.length, loadedFiles: loaded.slice(0, 30), invalidLogin: invalid, toSignup: signup, esc, url: page.url().replace(BASE, ''), consoleErrors: consoleErrors.slice(0, 6) };
      log(`${key}: popup=${opened}ms (+${loaded.length} istek) invalidLogin=${invalid.ms}ms signup=${signup}ms esc=${JSON.stringify(esc)}`);
    } catch (e) { results[key] = { err: e.message.slice(0, 300), consoleErrors: consoleErrors.slice(0, 6) }; log('HATA', key, e.message.slice(0, 200)); }
    await ctx.close();
  }
  // /hesabim ve /giris doğrudan (anonim)
  for (const p of ['/hesabim', '/giris', '/uye-ol']) {
    const key = `direct:${p}@${width}`;
    const { ctx, page, consoleErrors } = await newPage(browser, width);
    const requests = attachRequestLog(page);
    const t0 = performance.now();
    try {
      await page.goto(BASE + p, { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('.modal-shell-overlay.open', { timeout: 30000 }).catch(() => {});
      const modalAt = ms(performance.now() - t0);
      await settle(page, 2000);
      const m = await collectPageMetrics(page, requests, t0);
      results[key] = { modalAt, ttfb: m.ttfb, fcp: m.fcp, dcl: m.dcl, load: m.load, requestCount: m.requestCount, totalKB: Math.round(m.totalBytes / 1024), apiCalls: m.apiCalls, jsFiles: m.jsFiles, duplicates: m.duplicates, url: page.url().replace(BASE, ''), consoleErrors: consoleErrors.slice(0, 6) };
      log(`${key}: modal=${modalAt}ms ttfb=${m.ttfb} dcl=${m.dcl} req=${m.requestCount} api=${m.apiCalls.length} js=${m.jsFiles.length} dup=${m.duplicates.length}`);
    } catch (e) { results[key] = { err: e.message.slice(0, 300) }; log('HATA', key, e.message.slice(0, 200)); }
    await ctx.close();
  }
  return results;
}

async function memoryFlow(browser, width) {
  const key = `memory@${width}`;
  const { ctx, page, consoleErrors } = await newPage(browser, width);
  attachRequestLog(page);
  try {
    await page.goto(BASE + '/proje', { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('#card-grid a.content-card', { timeout: 30000 });
    await settle(page, 2500);
    const base = await cdpMetrics(page);
    const times = [];
    for (let i = 0; i < 10; i++) {
      const sel = `#card-grid a.content-card:nth-of-type(${(i % 6) + 1})`;
      const r = await timeClickToModal(page, sel, TITLE.project, 'project', { label: 'iter' + i });
      times.push(r.contentReady);
      await settle(page, 300);
      await closeWithEscape(page);
      await settle(page, 300);
    }
    const afterOpenClose = await cdpMetrics(page);
    // popup → popup zinciri (proje → kişi/firma → geri proje) x5
    let chain = 0;
    for (let i = 0; i < 5; i++) {
      const sel = `#card-grid a.content-card:nth-of-type(${(i % 6) + 1})`;
      await timeClickToModal(page, sel, TITLE.project, 'project', { label: 'chain' + i });
      await settle(page, 500);
      const href = await page.evaluate(() => { const ov = document.querySelector('.modal-shell-overlay.open'); const a = ov && Array.from(ov.querySelectorAll('a[href^="/kisi/"], a[href^="/firma/"]')).find(x => x.offsetParent !== null); if (!a) return null; a.setAttribute('data-pa-target', '1'); return a.getAttribute('href'); });
      if (href) { const owner = href.startsWith('/kisi/') ? 'architect' : 'office'; await timeClickToModal(page, 'a[data-pa-target="1"]', TITLE[owner], owner, { label: 'chain' }).catch(() => {}); chain++; await settle(page, 400); }
      await closeWithEscape(page).catch(() => {});
      await settle(page, 300);
    }
    // Sayfalar arası dolaşım ve geri dönüş
    await page.goto(BASE + '/kisi', { waitUntil: 'load' }); await settle(page, 1000);
    await page.goto(BASE + '/arama?q=ev', { waitUntil: 'load' }); await settle(page, 1000);
    await page.goto(BASE + '/proje', { waitUntil: 'load' }); await settle(page, 2000);
    const fresh = await cdpMetrics(page);
    const afterChain = await cdpMetrics(page);
    report.browser[key] = { baseline: base, afterOpenClose10: afterOpenClose, afterChain5: afterChain, chainTransitions: chain, freshDocAfterNav: fresh, openTimes: times, consoleErrors: consoleErrors.slice(0, 10) };
    log(`${key}: listeners ${base.jsListeners} -> ${afterOpenClose.jsListeners} -> ${afterChain.jsListeners}; nodes ${base.nodes} -> ${afterOpenClose.nodes} -> ${afterChain.nodes}; heap ${base.heapMB}MB -> ${afterOpenClose.heapMB} -> ${afterChain.heapMB}; window/document listeners ${base.window}/${base.document} -> ${afterChain.window}/${afterChain.document}; open times=${times.join(',')}`);
  } catch (e) { report.browser[key] = { err: e.message.slice(0, 300), consoleErrors: consoleErrors.slice(0, 10) }; log('HATA', key, e.message.slice(0, 200)); }
  await ctx.close();
}

async function runBrowser() {
  const require = createRequire(MODULES ? path.join(MODULES, 'x.js') : import.meta.url);
  const { chromium } = require('playwright');
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  report.browserVersion = browser.version();
  try {
    const pages = { home: '/', proje: '/proje', kisi: '/kisi', firma: '/firma', marka: '/marka', urun: '/urun', gundem: '/gundem', arama: '/arama?q=ev' };
    if (report.slugs) {
      if (report.slugs.project) pages.projectDetail = '/proje/' + encodeURIComponent(report.slugs.project);
      if (report.slugs.architect) pages.architectDetail = '/kisi/' + encodeURIComponent(report.slugs.architect);
    }
    for (const width of WIDTHS) {
      const subset = width === WIDTHS[0] ? Object.entries(pages) : Object.entries(pages).filter(([k]) => ['home', 'proje', 'kisi', 'projectDetail'].includes(k));
      for (const [k, p] of subset) await measurePageLoad(browser, k, p, width);
    }
    for (const width of WIDTHS.slice(0, 2)) {
      Object.assign(report.browser, await popupFlows(browser, width));
      Object.assign(report.browser, await homeFlows(browser, width));
      Object.assign(report.browser, await authFlows(browser, width));
    }
    await memoryFlow(browser, WIDTHS[0]);
    for (const width of [768, 1600]) if (!WIDTHS.includes(width)) await measurePageLoad(browser, 'home', '/', width);
  } finally { await browser.close(); }
}

(async () => {
  await runHttp();
  if (!NO_BROWSER) { try { await runBrowser(); } catch (e) { report.errors.push('browser: ' + e.message); log('TARAYICI HATASI', e.stack || e.message); } }
  report.finishedAt = new Date().toISOString();
  const json = JSON.stringify(report);
  if (OUT) writeFileSync(OUT, json);
  console.log('===PERF-AUDIT-JSON===');
  console.log(json);
  console.log('===END-PERF-AUDIT-JSON===');
})().catch(e => { console.error(e); process.exit(1); });
