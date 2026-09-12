#!/usr/bin/env node
// 2026-09-12 kullanıcı isteği — dört madde, tek test dosyası.
//
// MADDE 1 — "Admin panelinde; ana sayfadaki tüm carosel içeriklerini açılabilir menüden
//   seçebileyim. Örneğin 3 proje seçersem diğer 6 tanesi son eklenenler olsun."
//   Seçim site_settings'te dört slug listesi olarak yaşar, liste uçlarına `pin=` olarak taşınır ve
//   orada HAVUZUN TAMAMI üzerinde uygulanır (bkz. src/lib/homeCarousels.js). Sıralamanın istemcide
//   değil sunucuda yapılması ŞART: aksi halde çekilen 9/24'lük pencereye düşmeyen bir seçim
//   sessizce kaybolur (eski "öne çıkan projeler" davranışının kusuru).
//
// MADDE 2 — "Proje sayfasındaki proje önizlemelerinde ard arda 4 tane görsel görülebilsin 6 değil."
//   Sunucu (projectPool.js) ve istemci (js/pages/proje.js) sabitleri AYNI olmalı.
//
// MADDE 3 — "Hesabım, Aktivitelerim ve Koleksiyonum sayfaları yandan çekmece şeklinde açıldıkları
//   için buradan bir popup açıp kapattığımızda eski sayfamıza geri dönemiyoruz. Hafif karartılı ana
//   sayfa çıkıyor."
//   İKİ ayrı kök neden vardı ve ikisi de burada kilitleniyor:
//     (a) DERİNLİK: bu üç görünüm history'de diğer popup'larla aynı `depth` alanını taşıdığından
//         tür-bağımsız sayaç onları bir KATMAN sayıyordu; üstlerine açılan popup depth=2 alıyor,
//         kapanış history.go(-2) ile çekmeceyi de atlayıp bir ÖNCEKİ sayfaya düşüyordu. Artık
//         `pageBase: true` taşıyorlar ve ModalShell.popupHistoryDepth onları taban kabul ediyor.
//     (b) KARARTMA: hamburger çekmecesi OverlayManager'ın "otomatik grup"undaydı, yani bir modal
//         açılınca yalnızca `.nav-mobile-menu.open` sınıfı siliniyordu — kendi karartma katmanı
//         (#nav-mobile-overlay.open) ve durumu (subpageActive) geride kalıyordu: kullanıcının
//         gördüğü "hafif karartılı ana sayfa". Artık çekmece GERÇEK closeDrawer'ını register
//         ediyor ve kapanışını auth/info modallerine olayla bildiriyor.
//
// MADDE 4 — "Paylaş butonu tüm popuplarda hatalı olmuş, hepsini düzelt."
//   Paylaş popover'ı overlay-manager.js'in "otomatik grup"undaydı; `.open` sınıfını alır almaz
//   MutationObserver kayıtlı 'modal-shell'i kapatıyor, ModalShell.close() de
//   'mimarlab-modal-closed' yayınlayınca popover kendini kapatıyordu — yani Paylaş'a basınca HEM
//   pop-up HEM panel kayboluyordu (proje/ürün/kişi/firma/marka, hepsi aynı paylaşılan bileşen).
//   Otomatik gruptaki `el.contains(exceptEl)` koruması işe yaramıyordu, çünkü popover
//   konumlandırma için body'ye TAŞINIYOR. Çözüm: ShareWidget de register()'lı bir panel oldu ve
//   açılışını ANKRAJIYLA (düğmesiyle) bildiriyor; rootEl kontrolü panelin değil ankrajın konumuna
//   bakıyor.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseFeaturedSlugs, applyPinnedOrder, withPinParam, featuredSlugsFromSettings,
  HOME_FEATURED_KEYS, HOME_SLOT_COUNT,
} from '../src/lib/homeCarousels.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`); }
}
function section(title) { console.log(`\n${title}`); }
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

section('madde 1 — karusel seçimi: ayar biçimi ve sıralama');

test('parseFeaturedSlugs: boşluk kırpar, tekrarı atar, slot sayısını aşmaz', () => {
  assert.deepEqual(parseFeaturedSlugs(' a , b ,, a , c '), ['a', 'b', 'c']);
  assert.deepEqual(parseFeaturedSlugs(''), []);
  assert.deepEqual(parseFeaturedSlugs(null), []);
  const many = Array.from({ length: HOME_SLOT_COUNT + 5 }, (_, i) => `s${i}`).join(',');
  assert.equal(parseFeaturedSlugs(many).length, HOME_SLOT_COUNT);
});

test('applyPinnedOrder: seçilenler VERİLEN sırayla başa, kalanlar doğal sırada', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'].map(slug => ({ slug }));
  assert.deepEqual(applyPinnedOrder(pool, ['c', 'a']).map(x => x.slug), ['c', 'a', 'b', 'd', 'e']);
  // "3 proje seçersem diğer 6 tanesi son eklenenler olsun" — ilk 9 dilimi tam olarak budur.
  const nine = Array.from({ length: 12 }, (_, i) => ({ slug: `p${i}` }));
  const out = applyPinnedOrder(nine, ['p7', 'p9', 'p11']).slice(0, 9).map(x => x.slug);
  assert.deepEqual(out.slice(0, 3), ['p7', 'p9', 'p11']);
  assert.deepEqual(out.slice(3), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
});

test('applyPinnedOrder: havuzda olmayan seçim sessizce düşer, liste bozulmaz', () => {
  const pool = [{ slug: 'a' }, { slug: 'b' }];
  assert.deepEqual(applyPinnedOrder(pool, ['yok', 'b']).map(x => x.slug), ['b', 'a']);
  assert.deepEqual(applyPinnedOrder(pool, ['yok']).map(x => x.slug), ['a', 'b']);
  assert.deepEqual(applyPinnedOrder(pool, []).map(x => x.slug), ['a', 'b']);
});

test('withPinParam: seçim yoksa URL’e DOKUNMAZ (en sıcak önbellek anahtarı korunur)', () => {
  assert.equal(withPinParam('/api/projects?limit=24&noPreview=1', []), '/api/projects?limit=24&noPreview=1');
  assert.equal(withPinParam('/api/projects?limit=24&noPreview=1', ['a', 'b']), '/api/projects?limit=24&noPreview=1&pin=a%2Cb');
});

test('featuredSlugsFromSettings: dört karusel de kendi ayar anahtarını okur', () => {
  const s = {
    featured_project_slugs: 'p1, p2',
    featured_architect_slugs: 'k1',
    featured_office_slugs: '',
    featured_product_slugs: 'u1,u2,u3',
  };
  assert.deepEqual(featuredSlugsFromSettings(s, 'projects'), ['p1', 'p2']);
  assert.deepEqual(featuredSlugsFromSettings(s, 'architects'), ['k1']);
  assert.deepEqual(featuredSlugsFromSettings(s, 'offices'), []);
  assert.deepEqual(featuredSlugsFromSettings(s, 'products'), ['u1', 'u2', 'u3']);
});

test('dört ayar anahtarı DEFAULT_SETTINGS’te tanımlı (yoksa setSiteSetting reddeder)', () => {
  const src = read('src/lib/siteSettings.js');
  for (const key of Object.values(HOME_FEATURED_KEYS)) {
    assert.ok(new RegExp(`^\\s*${key}: '',`, 'm').test(src), `${key} DEFAULT_SETTINGS'te yok`);
  }
});

test('dört liste ucu da pin= uyguluyor — sıralamadan SONRA, sayfalamadan ÖNCE', () => {
  for (const f of ['src/routes/project.js', 'src/routes/architect.js', 'src/routes/office.js', 'src/routes/product.js']) {
    const src = read(f);
    assert.ok(src.includes("from '../lib/homeCarousels.js'"), `${f}: import yok`);
    assert.ok(src.includes('const ordered = applyPinnedOrder(filtered, pinnedSlugsFromUrl(url));'), `${f}: pin uygulanmıyor`);
    // Sayfalama artık SIRALANMIŞ diziden dilimlenmeli; `filtered.slice(start` kalmışsa pin no-op olur.
    assert.ok(src.includes('ordered.slice(start, start + limit)'), `${f}: sayfalama ordered'dan dilimlenmiyor`);
    assert.ok(!/\bfiltered\.slice\(start,/.test(src), `${f}: hâlâ filtered'dan dilimliyor`);
  }
});

test('projelerde pin= D1 hızlı yolunu DEVRE DIŞI bırakır (yoksa seçim 24. sıradan sonra kaybolur)', () => {
  const src = read('src/routes/project.js');
  const fn = src.slice(src.indexOf('function hasActiveProjectListFilters'), src.indexOf('function hasActiveProjectListFilters') + 900);
  assert.ok(fn.includes("url.searchParams.get('pin')"), 'hasActiveProjectListFilters pin parametresini görmüyor');
});

test('ana sayfa (sunucu + istemci) seçimi pin= olarak taşıyor, istemcide yeniden sıralamıyor', () => {
  const idx = read('src/index.js');
  assert.ok(idx.includes("featuredSlugsFromSettings, withPinParam"), 'src/index.js homeCarousels import etmiyor');
  for (const uc of ['/api/projects?limit=', '/api/architects?limit=', '/api/offices?limit=', '/api/products?limit=']) {
    const i = idx.indexOf(`withPinParam(\`${uc}`);
    assert.ok(i > 0, `loadHomeData ${uc} için withPinParam kullanmıyor`);
  }
  // Eski istemci-içi sıralama kalıntısı kalmamalı (iki kaynak = sessiz sapma).
  assert.ok(!idx.includes('settings.featuredProjectSlugs'), 'src/index.js hâlâ istemci-içi öne çıkarma yapıyor');
  const home = read('index.html');
  assert.ok(home.includes("'&pin=' + encodeURIComponent"), 'index.html yedek fetch yolunda pin göndermiyor');
  assert.ok(!home.includes('pool.find(p => p.slug === slug)'), 'index.html hâlâ havuz İÇİNDE yeniden sıralıyor');
});

test('public uç dört seçimi de yayımlıyor (index.html yedek yolu bunları okur)', () => {
  const src = read('src/routes/public.js');
  for (const field of ['featuredProjectSlugs', 'featuredArchitectSlugs', 'featuredOfficeSlugs', 'featuredProductSlugs']) {
    assert.ok(src.includes(`${field}: featuredSlugsFromSettings(`), `${field} public ayarlarda yok`);
  }
});

test('admin paneli: Ana Sayfa sekmesi + dört karusel + açılır menü', () => {
  const src = read('admin.html');
  assert.ok(src.includes('data-tab="home"'), 'Ana Sayfa sekme düğmesi yok');
  assert.ok(src.includes('id="section-home"'), 'Ana Sayfa bölümü yok');
  assert.ok(src.includes("if(tab.dataset.tab === 'home') loadHomeCarousels();"), 'sekme geçişi loadHomeCarousels çağırmıyor');
  for (const key of Object.values(HOME_FEATURED_KEYS)) {
    assert.ok(src.includes(`settingKey: '${key}'`), `${key} admin karusel tablosunda yok`);
  }
  assert.ok(src.includes('class="hc-menu"'), 'açılır menü işaretlemesi yok');
  // Eski serbest metin kutusu kaldırıldı; kalırsa iki arayüz aynı anahtara yazar ve biri diğerini ezer.
  assert.ok(!src.includes("getElementById('settings-featured-projects')"), 'eski slug metin kutusu hâlâ kayıtlı');
});

section('madde 2 — proje kartı karuselinde 4 görsel');

test('sunucu ve istemci sabitleri 4 ve BİRBİRİYLE AYNI', () => {
  assert.ok(read('src/lib/projectPool.js').includes('export const CARD_CAROUSEL_IMAGES = 4;'));
  assert.ok(read('js/pages/proje.js').includes('const CARD_CAROUSEL_IMAGES = 4;'));
  assert.ok(read('js/pages/proje.js').includes('p.images.slice(0, CARD_CAROUSEL_IMAGES)'));
});

test('liste gövdesi değiştiği için API_PAYLOAD_VERSION bump edildi (>= v41)', () => {
  const v = Number((read('src/lib/publicCache.js').match(/const API_PAYLOAD_VERSION = 'v(\d+)';/) || [])[1]);
  assert.ok(v >= 41, `önbellekteki eski gövde 6 görsel taşımaya devam eder (şu an v${v})`);
});

section('madde 3 — çekmeceden açılan popup kapanınca çekmeceye dönüş');

test('AuthModal: üç sayfa görünümü history girdisine pageBase yazıyor', () => {
  const src = read('js/components/auth-modal.js');
  assert.ok(src.includes("const PAGE_VIEWS = new Set(['account', 'activities', 'collections']);"));
  const pushes = src.match(/history\.pushState\(\{ mimarlabModal: 'auth'[^)]*\)/g) || [];
  assert.equal(pushes.length, 2, 'open() ve swap() dışında auth pushState beklenmiyor');
  pushes.forEach(p => assert.ok(p.includes('pageBase: PAGE_VIEWS.has(view)'), `pageBase eksik: ${p}`));
});

test('ModalShell.popupHistoryDepth: pageBase girdisi zincirin TABANI (derinlik 0)', () => {
  const src = read('js/components/modal-shell.js');
  const i = src.indexOf('function popupHistoryDepth()');
  assert.ok(i > 0);
  const body = src.slice(i, i + 260);
  assert.ok(body.includes('if (st && st.mimarlabModal && st.pageBase) return 0;'),
    'pageBase kapısı yok — çekmecenin üstündeki popup depth=2 alır ve kapanış çekmeceyi atlar');
});

test('OverlayManager: çekmece otomatik gruptan çıktı, register rootEl koruması var', () => {
  const src = read('js/overlay-manager.js');
  const sel = (src.match(/const AUTO_SELECTOR = '([^']+)'/) || [])[1] || '';
  assert.ok(!sel.includes('.nav-mobile-menu'), 'çekmece hâlâ otomatik grupta — karartma geride kalır');
  assert.ok(src.includes('function register(id, closeFn, rootEl)'), 'register rootEl almıyor');
  assert.ok(src.includes('if (entry.rootEl && exceptEl && entry.rootEl.contains(exceptEl)) return;'),
    'çekmece İÇİNDE açılan panel (arama önerileri/Paylaş) çekmeceyi kapatır');
});

test('NavDrawer: açılışta register+notifyOpen, kapanışta olay yayını', () => {
  const src = read('js/components/site-chrome.js');
  assert.ok(src.includes("OverlayManager.register('nav-drawer', closeDrawer, navMobileMenu);"), 'çekmece register edilmiyor');
  assert.ok(src.includes("OverlayManager.notifyOpen('nav-drawer');"), 'çekmece açılışını bildirmiyor');
  assert.ok(src.includes("document.dispatchEvent(new CustomEvent('mimarlab-navdrawer-closed'));"), 'kapanış olayı yok');
  // Kayıt initNavDrawer gövdesinde DEĞİL openDrawer içinde olmalı: overlay-manager.js `defer`,
  // site-chrome.js senkron — init anında OverlayManager henüz tanımlı değildir.
  const open = src.slice(src.indexOf('function openDrawer()'), src.indexOf('function closeDrawer()'));
  assert.ok(open.includes("OverlayManager.register('nav-drawer'"), 'kayıt openDrawer içinde değil (defer sırası tuzağı)');
});

test('auth/info modalleri çekmece kapanışında kendi durumlarını bırakıyor', () => {
  for (const f of ['js/components/auth-modal.js', 'js/components/info-modal.js']) {
    const src = read(f);
    const i = src.indexOf("document.addEventListener('mimarlab-navdrawer-closed'");
    assert.ok(i > 0, `${f}: dinleyici yok`);
    const body = src.slice(i, i + 320);
    assert.ok(body.includes('currentView = null;'), `${f}: currentView bırakılmıyor`);
    // history'e DOKUNULMAMALI: o an zinciri üstteki popup yönetiyor.
    assert.ok(!/history\.(go|pushState|replaceState)/.test(body), `${f}: dinleyici history'e dokunuyor`);
  }
});

section('Paylaş popover’ı — pop-up’ı kapatmamalı (tüm varlık pop-up’larında)');

test('share-popover otomatik gruptan çıktı (body’ye taşınıyor, contains koruması işlemiyordu)', () => {
  const src = read('js/overlay-manager.js');
  const sel = (src.match(/const AUTO_SELECTOR = '([^']+)'/) || [])[1] || '';
  assert.ok(!sel.includes('.share-popover'), 'popover hâlâ otomatik grupta — açılışı ModalShell’i kapatır');
  assert.ok(!sel.includes('.nav-mobile-menu'), 'çekmece otomatik gruba geri dönmüş');
});

test('notifyOpen ankraj alıyor ve onu exceptEl olarak geçiriyor', () => {
  const src = read('js/overlay-manager.js');
  assert.ok(src.includes('function notifyOpen(id, anchorEl)'), 'notifyOpen ankraj almıyor');
  assert.ok(src.includes('closeOthers(anchorEl || null, id);'), 'ankraj exceptEl olarak geçirilmiyor');
});

test('ModalShell kendini overlay’iyle kaydediyor (içindeki panel onu kapatmasın)', () => {
  const src = read('js/components/modal-shell.js');
  assert.ok(src.includes("OverlayManager.register('modal-shell', close, overlayEl);"),
    'rootEl verilmezse pop-up içindeki Paylaş düğmesi pop-up’ı kapatır');
});

test('ShareWidget kayıtlı bir panel ve açılışını DÜĞMESİYLE bildiriyor', () => {
  const src = read('js/components/share-button.js');
  const i = src.indexOf("btn.addEventListener('click'");
  assert.ok(i > 0);
  const body = src.slice(i, i + 2600);
  assert.ok(body.includes("OverlayManager.register('share', closeAllPopovers);"), 'ShareWidget register edilmiyor');
  assert.ok(body.includes("OverlayManager.notifyOpen('share', btn);"), 'açılış düğmeyle bildirilmiyor');
  // Bildirim, popover body'ye TAŞINMADAN önce olmalı: taşındıktan sonra çağrılsa ankraj yine
  // düğmedir ama sıralama okunurluğu ve closeAllPopovers'ın kendi popover'ımızı kapatmaması için
  // register/notify, appendChild'dan önce durmalı.
  assert.ok(body.indexOf("OverlayManager.notifyOpen('share', btn);") < body.indexOf('document.body.appendChild(popover);'),
    'notifyOpen popover body’ye taşındıktan SONRA çağrılıyor');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
