#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-12 (beşinci tur) — ana sayfa karusel YERLEŞİMİ yeniden dizildi ve
// MARKA + GÜNDEM kutuları eklendi (kullanıcı ekli bir tasarım görseli gönderdi). 2026-09-14 madde
// 3'te MARKA kutusu KALDIRILDI ve alt satırı ÜRÜN ile GÜNDEM yarı yarıya paylaşır oldu:
//
//   ┌───────────────────────────┬────────┐
//   │                           │  KİŞİ  │
//   │           PROJE           ├────────┤
//   │                           │ FİRMA  │
//   ├──────────────────┬────────┴────────┤
//   │       ÜRÜN       │     GÜNDEM      │
//   └──────────────────┴─────────────────┘
//
// Ayrıca: "Kategorilerin başlıklarına tıklayınca o sayfalar açılsın" + "Gönderi görsellerine ya da
// başlıklarına tıklanırsa ilgili gönderi açılsın" + "Her kategoride varsa 6 yoksa olduğu kadar
// gönderi döngüde olsun."
//
// BU DOSYANIN KİLİTLEDİĞİ SÖZLEŞMELER (hepsi sessizce sapabilecek türden):
//
// 1) YERLEŞİM TEK BİR ŞABLONDAN GELİR — HER GENİŞLİKTE. On eşit sütun + üç satır; oranların
//    tamamı grid-template-areas'ta yaşıyor (proje 8 sütun × 2 satır, sağ sütun 2, alt satır
//    5+5 — yani ÜRÜN ve GÜNDEM tam yarı yarıya). Sütun sayısı 5 -> 10 YALNIZCA bu yarıyı ifade
//    edebilmek içindir; üst satırların pikselleri DEĞİŞMEZ, çünkü bir kutunun genişliği yalnızca
//    span/sütun oranına (n/N) bağlıdır, gap sayısına değil (8/10 === 4/5).
//    Eski iç içe grid (.hero-side) kaldırıldı — kalırsa alt satırın sütunları üst satırla
//    hizasını kaybeder. Yükseklik .proje-slider'ın aspect-ratio'sundan doğduğu için satır şablonu
//    `1fr` kalmalı.
//    Kullanıcı isteği (2026-09-12, altıncı tur): "Tablet ve mobilde de aynı sistem gözüksün,
//    sıralamayı değiştirme" — yani HİÇBİR breakpoint şablonu yeniden dizmemeli. Bu test onu
//    kilitler: dar ekran bloklarında grid-template-columns/areas/rows yeniden tanımlanamaz ve
//    kutular mobil-özel aspect-ratio taşıyamaz (taşırsa oran grid'den değil karttan gelir ve
//    sistem masaüstündekinden farklı görünür).
//    Aynı turda kapsayıcı 1220 -> 1000px daraltıldı ("sağdan ve soldan carosel sistemini küçült").
//
// 2) İKİ AYRI BAĞLANTI TÜRÜ, İÇ İÇE OLMADAN. Kategori etiketi liste sayfasına, slaytın kendisi
//    gönderiye gider. Etiket bu yüzden slaytın DIŞINDA, karusel kapsayıcısının çocuğu olmalı:
//    <a> içine <a> geçersiz HTML'dir, tarayıcı onu ağaçtan dışarı taşır ve tıklama hedefleri
//    karışır. Etiket metni HTML'de ZATEN büyük harflidir (KİŞİ/ÜRÜN/GÜNDEM) — text-transform
//    Türkçe 'i'yi noktasız 'I' yapar.
//
// 3) MARKA KUTUSU GERİ GELMEZ (kullanıcı isteği, 2026-09-14 madde 3). Ana sayfa artık ne
//    ?brands=1 ucunu çağırır ne de bir marka karuseli kurar; /marka LİSTE sayfası ise yerinde
//    durur (kaldırılan şey kutu ve menü bağlantısı, sayfa değil). Sessizce geri sızmasını bu test
//    durdurur.
//
// 4) GÖMÜLÜ VERİ SÜRÜMÜ (#ml-home-data) v:5 ve İKİ TARAFTA AYNI. Gövde artık beş bölüm taşıyor;
//    sürüm ayrışırsa istemci gömülü veriyi sessizce yok sayar (ya da eski bir belge yeni gövdeyi
//    yanlış okur).
//
// 5) <img sizes> DEĞERLERİ index.html ile src/index.js#HOME_IMG arasında BİREBİR aynı olmalı —
//    aksi halde sunucunun <link rel=preload>'u tarayıcının seçtiği adayla eşleşmez ve önden
//    indirilen dosya boşa gider.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { HOME_SLOT_COUNT } from '../src/lib/homeCarousels.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const indexHtml = read('index.html');
const serverIndex = read('src/index.js');

// Beş kutunun tek doğruluk tablosu: grid alanı, kutu sınıfı, slider id öneki, etiket metni,
// etiketin gittiği liste sayfası ve slaytın gittiği detay öneki.
const BOXES = [
  { area: 'proje',  cls: 'card-proje',  track: 'slider-track',        label: 'PROJE',  list: '/proje',  detail: '/proje/'  },
  { area: 'kisi',   cls: 'card-kisi',   track: 'kisi-slider-track',   label: 'KİŞİ',   list: '/kisi',   detail: '/kisi/'   },
  { area: 'firma',  cls: 'card-firma',  track: 'firma-slider-track',  label: 'FİRMA',  list: '/firma',  detail: '/firma/'  },
  { area: 'urun',   cls: 'card-urun',   track: 'urun-slider-track',   label: 'ÜRÜN',   list: '/urun',   detail: '/urun/'   },
  { area: 'gundem', cls: 'card-gundem', track: 'gundem-slider-track', label: 'GÜNDEM', list: '/gundem', detail: '/gundem/' },
];

console.log('\nyerleşim — on sütunlu tek grid');

test('grid şablonu tasarımdaki dizilimi harfiyen taşıyor (10 sütun, 3 satır, 5+5 alt satır)', () => {
  const grid = indexHtml.match(/\.bento-grid\{[\s\S]*?\}/);
  assert.ok(grid, '.bento-grid kuralı yok');
  const css = grid[0];
  assert.match(css, /grid-template-columns:repeat\(10, 1fr\);/, 'on sütun yok');
  // Satırlar `1fr` kalmalı: grid'in yüksekliği .proje-slider'ın aspect-ratio'sundan doğar ve fr
  // dağıtımı üçüncü satıra da aynı yüksekliği verir (alt satır kutuları ayrı oran taşımaz).
  assert.match(css, /grid-template-rows:repeat\(3, 1fr\);/, 'üç eşit satır yok');
  assert.match(css, /"proje proje proje proje proje proje proje proje kisi kisi"/);
  assert.match(css, /"proje proje proje proje proje proje proje proje firma firma"/);
  // ÜRÜN ve GÜNDEM tam yarı yarıya (kullanıcı isteği, 2026-09-14 madde 3).
  assert.match(css, /"urun urun urun urun urun gundem gundem gundem gundem gundem"/);
  assert.match(css, /grid-template-areas:/);
  // Üst satırların ORANI değişmemiş olmalı: proje 8/10 === eski 4/5, sağ sütun 2/10 === 1/5.
  const areas = css.match(/grid-template-areas:\s*([\s\S]*?);/)[1].match(/"[^"]+"/g).map(r => r.slice(1, -1).split(' '));
  for (const row of areas) assert.equal(row.length, 10, 'her satır 10 hücre olmalı');
  assert.equal(areas[0].filter(c => c === 'proje').length / 10, 4 / 5, 'PROJE genişliği değişmiş');
  assert.equal(areas[2].filter(c => c === 'urun').length, areas[2].filter(c => c === 'gundem').length, 'ÜRÜN ve GÜNDEM yarı yarıya değil');
});

test('MARKA kutusu ana sayfada YOK (kullanıcı isteği, 2026-09-14 madde 3)', () => {
  for (const needle of ['card-marka', 'marka-slider-track', 'id="marka-prev"', 'id="marka-next"',
                        'markaSlider', 'href="/marka">MARKA</a>', "pick('brands'", 'brands=1']) {
    assert.ok(!indexHtml.includes(needle), `ana sayfada marka kalıntısı: ${needle}`);
  }
  assert.ok(!serverIndex.includes('`/api/offices?brands=1&limit=${HOME_LIST_LIMIT}&noPreview=1`'), 'sunucu hâlâ marka ucunu çekiyor');
  assert.ok(!serverIndex.includes('data.brands'), 'gömülü gövdede hâlâ brands bölümü var');
  // Liste SAYFASI duruyor: kaldırılan şey kutu, sayfa değil.
  assert.ok(serverIndex.includes("'/marka': {"), '/marka hub sayfası da kaldırılmış — istenen bu değildi');
});

test('beş grid alanı da bir kutu sınıfına bağlı, iç içe grid (.hero-side) kalmadı', () => {
  for (const b of BOXES) {
    assert.ok(indexHtml.includes(`.${b.cls}{grid-area:${b.area};}`), `${b.cls} -> ${b.area} kuralı yok`);
  }
  // Kuralı/işaretlemesi aranır, açıklama metni DEĞİL (yukarıdaki .bento-grid yorumu kaldırma
  // gerekçesini anlatmak için adı anıyor; çıplak alt dizgi araması ona takılırdı).
  assert.ok(!indexHtml.includes('.hero-side{'), 'eski iç içe grid kuralı (.hero-side) hâlâ duruyor');
  assert.ok(!indexHtml.includes('class="hero-side"'), 'eski .hero-side kapsayıcısı hâlâ işaretlemede');
  assert.ok(!indexHtml.includes('.hero-side >') && !indexHtml.includes(', .hero-side'), '.hero-side\'a bakan bir kural kalmış');
  assert.ok(!indexHtml.includes('card-mimar'), 'eski .card-mimar sınıfı hâlâ duruyor');
});

test('proje kutusunun yüksekliği aspect-ratio 4/3 ile geliyor (satırların dayanağı bu)', () => {
  const rule = indexHtml.match(/\.proje-slider\{[\s\S]*?\}/);
  assert.ok(rule && /aspect-ratio:4\/3;/.test(rule[0]), '.proje-slider aspect-ratio 4/3 taşımıyor');
});

test('masaüstü kapsayıcısı daraltıldı: 1000px (footer bandından da içeride)', () => {
  const grid = indexHtml.match(/\.bento-grid\{[\s\S]*?\}/)[0];
  const max = Number(grid.match(/max-width:(\d+)px;/)[1]);
  assert.equal(max, 1000, 'bento kapsayıcısı 1000px değil');
  assert.ok(max < 1080, 'sistem footer bandından (1080px) daha geniş olmamalı');
  assert.match(grid, /padding:0 32px 64px;/, 'yan boşluk kuralı değişmiş');
});

test('HİÇBİR breakpoint şablonu yeniden dizmiyor (tablet/mobil de aynı sistem, aynı sıra)', () => {
  // .bento-grid'e yazan TÜM kurallar toplanır (taban + media blokları). Şablonu tanımlayan üç
  // özellik yalnızca BİRİNDE, taban kuralda geçmeli. Kapsam bilerek `.bento-grid{...}` bloklarına
  // sınırlı: stil sayfasında başka grid'ler de var (ör. .footer-top) ve onların sütun tanımları
  // bu sözleşmeyle ilgisizdir.
  const rules = [...indexHtml.matchAll(/\.bento-grid\{([\s\S]*?)\}/g)].map(m => m[1]);
  assert.ok(rules.length >= 2, 'bento kuralları bulunamadı');
  for (const prop of ['grid-template-columns', 'grid-template-areas', 'grid-template-rows']) {
    const n = rules.filter(r => r.includes(prop)).length;
    assert.equal(n, 1, `${prop} ${n} .bento-grid kuralında tanımlı — dar ekranda yeniden dizilim var`);
  }
  // İlk (taban) kural şablonu taşıyan kural olmalı; media blokları yalnızca ölçü değiştirir.
  assert.ok(rules[0].includes('grid-template-areas'), 'şablon taban kuralda değil');
  // Mobil-özel kart oranı da olmamalı: oran her genişlikte grid'in kendisinden gelir.
  for (const cls of ['card-kisi', 'card-firma', 'card-gundem', 'card-urun']) {
    assert.ok(!new RegExp(`\\.${cls}\\{aspect-ratio`).test(indexHtml), `.${cls} kendi aspect-ratio'sunu taşıyor`);
  }
  // .proje-slider'ın oranı da tek yerde (taban kural) durmalı.
  //
  // KAPSAM DÜZELTMESİ (2026-09-13): bu iddia eskiden index.html'in TAMAMINDA `aspect-ratio:4/3;`
  // dizesini sayıyordu ve "tam 1" bekliyordu. O kestirme yalnızca sayfada başka hiçbir 4/3 kutu
  // YOKKEN doğru sonucu veriyordu; "Senin İçin" bloğunun kart görselleri de 4/3 olunca (bkz.
  // index.html#.foryou-thumb / .foryou-skel) iddia, .proje-slider'da HİÇBİR ŞEY değişmemiş olmasına
  // rağmen kırıldı — yani testin ölçtüğü şey ile söylediği şey ayrışmıştı. Artık sayım gerçekten
  // .proje-slider kurallarıyla sınırlı: bu bloğun üstündeki .bento-grid kuralları için kullanılan
  // desenin AYNISI.
  const sliderRules = [...indexHtml.matchAll(/\.proje-slider\{([\s\S]*?)\}/g)].map(m => m[1]);
  assert.ok(sliderRules.length >= 1, '.proje-slider kuralı bulunamadı');
  const ratioRules = sliderRules.filter(r => r.includes('aspect-ratio')).length;
  assert.equal(ratioRules, 1, `.proje-slider oranı ${ratioRules} kuralda tanımlı — tek yerde durmalı`);
  assert.ok(!indexHtml.includes('aspect-ratio:16/11'), 'eski mobil proje oranı (16/11) hâlâ duruyor');
});

test('dar ekranda sistem ÖLÇEKLENİR: boşluk daralır, telefonda tipografi/oklar küçülür', () => {
  const at = (bp) => {
    const start = indexHtml.indexOf(`@media (max-width: ${bp}px)`);
    assert.ok(start > 0, `${bp}px bloğu yok`);
    return indexHtml.slice(start, indexHtml.indexOf('\n  }', start));
  };
  // Boşluk kademeli daralır: 16 (taban) -> 10 -> 8 -> 6.
  assert.match(at(860), /\.bento-grid\{gap:10px;\}/);
  assert.match(at(720), /\.bento-grid\{padding:0 14px 50px; gap:8px;\}/);
  const phone = at(560);
  assert.match(phone, /\.bento-grid\{gap:6px;\}/);
  // Telefonda bir sütun ~65px: iki ok kartın tamamını kaplardı. Yalnızca KÜÇÜK kutuların
  // okları gizlenir; PROJE kutusu 4 sütun genişliğinde olduğundan oklarını korur.
  assert.match(phone, /\.side-slider \.slider-arrow\{display:none;\}/, 'telefonda küçük kutu okları gizlenmiyor');
  assert.ok(!/\n    \.slider-arrow\{display:none;\}/.test(phone), 'PROJE kutusunun okları da gizlenmiş');
  assert.match(phone, /\.side-slider \.slide-title\{font-size:8\.5px;/, 'telefonda küçük kutu başlığı küçültülmemiş');
  assert.match(phone, /\.side-slider \.slide-designer\{display:none;\}/, 'telefonda okunmayan ikinci satır gizlenmiyor');
  // Parmakla kaydırma her kutuda bağlı olduğundan ok gizlemek karuseli erişilemez BIRAKMAZ.
  assert.ok(indexHtml.includes('wireSwipe(wrapEl,'), 'mini karusellerde swipe bağlı değil');
});

console.log('\nbağlantılar — kategori etiketi liste sayfasına, slayt gönderiye');

test('beş kutunun etiketi HTML\'de SABİT bir <a> ve doğru liste sayfasına gidiyor', () => {
  for (const b of BOXES) {
    assert.ok(
      indexHtml.includes(`<a class="slide-tag" href="${b.list}">${b.label}</a>`),
      `${b.label} etiketi <a href="${b.list}"> olarak yok`,
    );
  }
});

test('etiket slaytın DIŞINDA: slayt şablonlarının hiçbiri slide-tag basmıyor (iç içe <a> olmaz)', () => {
  // Slayt üreten beş şablonun gövdesi: hiçbiri kendi içinde bir etiket taşımamalı.
  for (const fn of ['projectSlideHtml', 'architectSlideHtml', 'officeSlideHtml', 'urunSlideHtml', 'gundemSlideHtml']) {
    const start = indexHtml.indexOf(`function ${fn}(`);
    assert.ok(start > 0, `${fn} yok`);
    const body = indexHtml.slice(start, indexHtml.indexOf('\n}', start));
    assert.ok(body.includes('class="proje-slide'), `${fn} slayt <a>'si basmıyor`);
    assert.ok(!body.includes('slide-tag'), `${fn} hâlâ slaydın İÇİNDE etiket basıyor — iç içe <a>`);
  }
  assert.ok(!indexHtml.includes('<span class="slide-tag">'), 'eski <span> etiket kalıntısı duruyor');
});

test('etiket metni HTML\'de büyük harfli (text-transform Türkçe İ\'yi bozar) ve dönüşüm kaldırıldı', () => {
  const rule = indexHtml.match(/\n  \.slide-tag\{[\s\S]*?\}/);
  assert.ok(rule, '.slide-tag kuralı yok');
  assert.ok(!/text-transform/.test(rule[0]), '.slide-tag hâlâ text-transform ile büyütüyor');
  assert.ok(indexHtml.includes('a.slide-tag:hover'), 'etiket artık bir bağlantı — hover durumu olmalı');
});

test('slaytlar GÖNDERİNİN kendisine gidiyor (görsel + başlık aynı <a> içinde)', () => {
  const links = {
    projectSlideHtml: '/proje/${encodeURIComponent(p.slug)}',
    architectSlideHtml: '/kisi/${encodeURIComponent(a.slug || idxSlugify(a.name))}',
    urunSlideHtml: '/urun/${encodeURIComponent(p.slug)}',
    gundemSlideHtml: '/gundem/${encodeURIComponent(g.slug)}',
  };
  for (const [fn, href] of Object.entries(links)) {
    const start = indexHtml.indexOf(`function ${fn}(`);
    const body = indexHtml.slice(start, indexHtml.indexOf('\n}', start));
    assert.ok(body.includes(`href="${href}"`), `${fn} slayt bağlantısı ${href} değil`);
    // Görsel/baş harf rozeti ve başlık AYNI <a>'nın içinde olmalı ki ikisi de gönderiyi açsın.
    assert.ok(body.includes('slide-caption') && body.includes('slide-title'), `${fn} başlığı slaytın içinde değil`);
  }
  // Firma/Marka: kanonik önek KAYDIN kendi bayrağından gelir (Autoban gibi hem firma hem marka
  // olan kayıtlar marka kutusunda da /firma/ adresini korur).
  const o = indexHtml.slice(indexHtml.indexOf('function officeSlideHtml('));
  assert.ok(o.includes("${o.brand ? '/marka/' : '/firma/'}"), 'officeSlideHtml kanonik öneki kayıttan okumuyor');
});

console.log('\nveri — beş karusel, "varsa 6 yoksa olduğu kadar"');

test('beş karusel de kuruldu ve HTML\'deki track/ok id\'leriyle eşleşiyor', () => {
  for (const b of BOXES.slice(1)) {
    const name = b.track.replace('-slider-track', '');
    assert.ok(indexHtml.includes(`createMiniSlider('${b.track}', '${name}-prev', '${name}-next'`), `${b.track} karuseli kurulmamış`);
    assert.ok(indexHtml.includes(`id="${b.track}"`), `${b.track} HTML'de yok`);
    assert.ok(indexHtml.includes(`id="${name}-prev"`) && indexHtml.includes(`id="${name}-next"`), `${name} okları HTML'de yok`);
  }
  // Proje karuseli kendi (büyük) motorunu kullanır, id'si tarihsel olarak öneksizdir.
  assert.ok(indexHtml.includes('id="slider-track"') && indexHtml.includes('id="proje-slider"'));
});

test('slot sayısı 6 ve ÜST sınır: eksik kayıt yer tutucuyla doldurulmaz', () => {
  assert.equal(Number(indexHtml.match(/const PROJECT_CAROUSEL_SLOTS = (\d+);/)[1]), 6);
  assert.equal(Number(serverIndex.match(/const HOME_SLOTS = (\d+);/)[1]), 6);
  assert.equal(HOME_SLOT_COUNT, 6);
  // Tek yol: slice(0, SLOTS). Eksik olanı tamamlayan bir dolgu/`while`/`padEnd` OLMAMALI.
  assert.match(indexHtml, /const head = \(list\) => notPreview\(list\)\.slice\(0, PROJECT_CAROUSEL_SLOTS\);/);
  assert.match(indexHtml, /gundemSlider\.render\(\(gundemRes\.items \|\| \[\]\)\.slice\(0, PROJECT_CAROUSEL_SLOTS\)\)/);
  assert.equal(Number(indexHtml.match(/const HOME_LIST_FETCH_LIMIT = PROJECT_CAROUSEL_SLOTS;/) ? 6 : 0), 6);
  assert.match(serverIndex, /const HOME_LIST_LIMIT = HOME_SLOTS;/);
});

test('FİRMA kutusu saf markaları dışlayan ucu kullanır, GÜNDEM kendi ucunu', () => {
  // İstemci (gömülü veri yoksa devreye giren yedek fetch yolu)
  assert.ok(indexHtml.includes("pick('offices', '/api/offices?limit=' + HOME_LIST_FETCH_LIMIT + '&noPreview=1')"), 'firma ucu yok');
  assert.ok(indexHtml.includes("pick('gundem', '/api/gundem?limit=' + HOME_LIST_FETCH_LIMIT)"), 'gündem ucu yok');
  // Sunucu (gömülü veri)
  assert.ok(serverIndex.includes('`/api/gundem?limit=${HOME_LIST_LIMIT}`'), 'sunucu gündem ucunu çekmiyor');
  // Gündem'in admin seçimi YOK: pin= eklenmemeli (en sıcak önbellek anahtarı korunur).
  assert.ok(!serverIndex.includes("pinFor('brands')") && !serverIndex.includes("pinFor('gundem')"), 'gündem için olmayan bir seçim anahtarı okunuyor');
  assert.match(indexHtml, /const settingKey = HOME_SETTINGS_KEY\[key\];/, 'pinQuery anahtarsız kategoriyi açıkça ele almıyor');
});

test('beş karusel de HER İKİ yolda besleniyor (gömülü veri + yedek fetch)', () => {
  const renders = ['renderSlider(', 'kisiSlider.render(', 'firmaSlider.render(', 'urunSlider.render(', 'gundemSlider.render('];
  for (const r of renders) assert.ok(indexHtml.includes(r), `${r} çağrısı yok`);
  // Hata yolu: beş kutunun hiçbiri kalıcı boş gri kutu olarak kalmamalı.
  for (const r of ['kisiSlider.renderError(', 'firmaSlider.renderError(', 'urunSlider.renderError(', 'gundemSlider.renderError(']) {
    assert.ok(indexHtml.includes(r), `${r} yok — istek başarısız olursa kutu boş kalır`);
  }
});

console.log('\ngömülü veri (#ml-home-data) ve görsel adayları');

test('#ml-home-data v:5 ve iki tarafta AYNI; gövde beş bölüm taşıyor', () => {
  assert.match(serverIndex, /v: 5, t: Date\.now\(\)/);
  assert.match(indexHtml, /return \(d && d\.v === 5\) \? d : null;/);
  for (const key of ['projects', 'architects', 'offices', 'products', 'gundem']) {
    assert.ok(new RegExp(`${key}:`).test(serverIndex.slice(serverIndex.indexOf('v: 5, t: Date.now()'), serverIndex.indexOf('v: 5, t: Date.now()') + 400)), `gömülü gövdede ${key} yok`);
  }
  // Bölümlerin HEPSİ null olduğunda blok hiç gömülmez (istemci eskisi gibi ağdan çeker).
  assert.match(serverIndex, /data\.products \|\| data\.gundem\) \? data : null;/);
});

test('<img sizes> değerleri index.html ile src/index.js#HOME_IMG arasında BİREBİR aynı', () => {
  const server = {};
  const block = serverIndex.slice(serverIndex.indexOf('const HOME_IMG = {'), serverIndex.indexOf('};', serverIndex.indexOf('const HOME_IMG = {')));
  for (const m of block.matchAll(/(\w+):\s*\{ widths: \[([^\]]+)\],\s*sizes: '([^']+)' \}/g)) {
    server[m[1]] = { widths: m[2].replace(/\s/g, ''), sizes: m[3] };
  }
  assert.deepEqual(Object.keys(server).sort(), ['architect', 'office', 'product', 'project'], 'HOME_IMG anahtarları beklenenden farklı');
  const client = [
    ['project',   `slideImgHtml(slideImg, [${server.project.widths}], '${server.project.sizes}'`],
    ['architect', `slideImgHtml(a.photo, [${server.architect.widths}], '${server.architect.sizes}'`],
    ['office',    `slideImgHtml(o.logo, [${server.office.widths}], '${server.office.sizes}'`],
    ['product',   `slideImgHtml(p.image, [${server.product.widths}], '${server.product.sizes}'`],
  ];
  for (const [key, needle] of client) {
    assert.ok(indexHtml.includes(needle.replace(/,(\S)/g, ', $1')), `${key}: istemci sizes/widths sunucudan farklı (${needle})`);
  }
});

test('preload: dört kutu var, GÜNDEM bilerek yok (dış host + referrerpolicy eşleşmesi)', () => {
  const fn = serverIndex.slice(serverIndex.indexOf('function buildHomePreloadLinks('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  for (const key of ['data.projects', 'data.architects', 'data.offices', 'data.products']) {
    assert.ok(body.includes(key), `${key} preload'a girmemiş`);
  }
  assert.ok(!body.includes('data.gundem'), 'gündem preload edilmemeli (dış adres)');
  assert.ok(!body.includes('data.brands'), 'marka kutusu kaldırıldı, preload\'u da kalmamalı');
});

test('gündem görseli: kendi /media/ dosyası türevden, dış adres HAM ve daima no-referrer', () => {
  const fn = indexHtml.slice(indexHtml.indexOf('function gundemSlideImgHtml('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /startsWith\('\/media\/'\)/, 'kendi dosyası/dış adres ayrımı yok');
  assert.match(body, /own \? cdnImg\(src, 900\) : src/, 'dış adres türev yolundan geçirilmemeli');
  assert.match(body, /own \? cdnSrcset\(src, GUNDEM_IMG_WIDTHS\) : ''/, 'dış adres için srcset üretilmemeli');
  assert.equal((body.match(/referrerpolicy="no-referrer"/g) || []).length, 2, 'her iki <img> dalı da no-referrer taşımalı');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
