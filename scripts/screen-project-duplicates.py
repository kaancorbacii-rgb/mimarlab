#!/usr/bin/env python3
"""Toplu proje içe aktarımlarında mükerrer taraması — DÖRT geçiş, hepsi zorunlu.

Neden ayrı bir script: bu tarama her Archello/Arkitera partisinde yeniden yazılıyordu
(`scripts/output/<parti>/screen*.py`), oysa hangi geçişin hangi mükerreri yakaladığı partiden
partiye değişiyor ve geçişlerden biri atlandığında mükerrer VERİTABANINA GİRİYOR. Geçmiş
partilerin kanıtı:

  * 2026-09-01 / 3. parti ([[project_archello_import_2026_09_01_batch3]]): İngilizce başlık
    taraması 5 mükerreri kaçırdı; 4'ünü ofis×yıl (geçiş 2), 1'ini yalnızca çeviri sonrası
    Türkçe tarama (geçiş 4) yakaladı. `yesim-kozanli` örneğinde Archello başlığı yalnızca ofis
    adıydı — başlık, slug ve source_url ile ASLA yakalanamazdı.
  * 2026-09-01 / 4. parti: `white-village-house` -> #852 "Beyaz Ev" yalnızca geçiş 3'te
    (ofis×TÜM projeler) çıktı; `r1-house` -> #855 "R1 Evi" yalnızca geçiş 2'de çıktı. İkisi de
    İngilizce başlık taramasında GÖRÜNMÜYORDU.

Geçişler:
  1. İngilizce başlık: source_url + ayırt edici token kümesi + difflib oranı
  2. Ofis × YIL kesişimi — künyedeki ofis adının DB'deki projeleriyle aynı yıl
  3. Ofis × TÜM projeler — aynı ofisin bütün projeleri (yıl kaynakta yanlış/eksik olabiliyor)
  4. Çeviri sonrası TÜRKÇE başlık + slug çakışması + oran  (--translated verilirse)

Çıktı yalnızca ADAY listesidir; kesin karar, adayların gövde metni ve künyesi okunarak elle
verilir. Yanlış pozitif bol olacak şekilde ayarlıdır — bir mükerreri kaçırmak, fazladan aday
elemekten çok daha pahalıdır.

Kullanım:
  python3 scripts/screen-project-duplicates.py --scraped scraped.json [--translated tr-all.json]
                                               [--db-dir <dizin>] [--local]

--db-dir verilirse oradaki db-projects.json / db-pd.json okunur; verilmezse wrangler ile
canlı D1'den çekilip oraya yazılır.
"""

import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import unicodedata

TR = str.maketrans('ıİşŞğĞüÜöÖçÇÂâÎîÛû', 'iisSgGuUoOccAaIiUu')


def fold(s):
    """Türkçe-duyarlı normalizasyon. camelCase AYRILIR: Archello künyesinde
    'BoytorunArchitects' boşluksuz geçiyor ve tek token'a foldlanınca eşleşmeyi kaçırıyor."""
    s = re.sub(r'(?<=[a-zçğıöşü])(?=[A-ZÇĞİÖŞÜ])', ' ', s or '')
    s = s.translate(TR).lower()
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


# Başlık token'ı olarak ayırt edici OLMAYAN kelimeler (tipoloji + sık geçen il adları).
TITLE_GENERIC = set('''house home ev evi evleri office ofis ofisi project proje projesi
residence konut konutu konutlari hotel otel apartment daire villa villas villalar studio studyo
building bina binasi center merkez merkezi restaurant restoran restorani cafe kafe clinic klinik
klinigi store magaza showroom design tasarim architecture mimarlik interior ic mekan new yeni
private ozel social sosyal group grup room oda flat kat penthouse pub bar the a an and of in for
ve ile bir istanbul izmir ankara bodrum antalya kayseri mugla kocaeli bursa edirne samsun
balikesir'''.split())

# Ofis adında ayırt edici OLMAYAN kelimeler. 'yapi/yapim/insaat/holding/muhendislik' BURADA
# OLMALI: aksi halde "Him Yapi" -> "Yapı Stüdyo Mimarlık" yanlış pozitifi çıkıyor (tek ortak
# token "yapi", ki Türkçede "bina" demek).
OFFICE_GENERIC = set('''architects architecture architectural architect mimarlik mimarligi mimar
mimari design designs designer designers tasarim tasarimlari studio studyo stydio atelier atolye
workshop project proje projects projeleri interior interiors ic mekan and ve of the co ltd sti as
inc group grup partners partnership office ofis works limited sirketi anonim yapi yapim insaat
holding muhendislik engineering'''.split())

DB_QUERIES = {
    'db-projects.json':
        'SELECT id, title, slug, location, project_date, source_url FROM projects',
    'db-pd.json':
        'SELECT pd.project_id, COALESCE(o.name, a.name) AS name FROM project_designers pd '
        'LEFT JOIN offices o ON o.id = pd.office_id '
        'LEFT JOIN architects a ON a.id = pd.architect_id',
}
PERSIST_TO = '/Users/kaancorbaci/.mimarlab-dev-state'


def load_db(db_dir, local):
    os.makedirs(db_dir, exist_ok=True)
    out = {}
    for name, sql in DB_QUERIES.items():
        path = os.path.join(db_dir, name)
        if not os.path.exists(path):
            target = (['--local', '--persist-to', PERSIST_TO] if local else ['--remote'])
            print(f'  D1 -> {name}', file=sys.stderr)
            raw = subprocess.run(
                ['npx', 'wrangler', 'd1', 'execute', 'mimarlab-db', *target, '--json',
                 '--command', sql],
                capture_output=True, check=True).stdout.decode('utf8')
            rows = json.loads(raw[raw.index('['):])[0]['results']
            json.dump(rows, open(path, 'w', encoding='utf8'), ensure_ascii=False)
        out[name] = json.load(open(path, encoding='utf8'))
    return out['db-projects.json'], out['db-pd.json']


def title_tokens(title):
    return [w for w in fold(title).split() if w not in TITLE_GENERIC and len(w) > 2]


def office_tokens(name):
    return {w for w in fold(name).split() if w not in OFFICE_GENERIC and len(w) > 2}


def rank(hits, limit=5):
    """Aynı projeyi tek satıra indir, skora göre sırala."""
    seen, uniq = set(), []
    for kind, score, r in sorted(hits, key=lambda x: -x[1]):
        if r['id'] in seen:
            continue
        seen.add(r['id'])
        uniq.append((kind, score, r))
    return uniq[:limit]


def show(header, hits):
    if not hits:
        return 0
    print(header)
    for kind, score, r in hits:
        print(f"      [{kind} {score}] #{r['id']} {r['title']} [{r.get('slug')}] "
              f"({r.get('location')}, {r.get('project_date')})")
    return 1


def credit_names(p):
    """Künyedeki firma/tasarımcı adları — og:title'daki ofis + Architects/Design rolleri."""
    names = []
    if p.get('officeEn'):
        names.append(p['officeEn'])
    for role, people in (p.get('credits') or {}).items():
        if 'rchitect' in role or 'Design' in role:
            names += [x['name'] for x in people]
    return list(dict.fromkeys(names))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scraped', required=True, help='kazıma çıktısı (scrape-archello-projects.py)')
    ap.add_argument('--translated', help='çeviri çıktısı: {archelloSlug: {title, slug, ...}}')
    ap.add_argument('--db-dir', default='.', help='db-*.json önbellek dizini')
    ap.add_argument('--local', action='store_true')
    a = ap.parse_args()

    db, pd_rows = load_db(a.db_dir, a.local)
    scraped = json.load(open(a.scraped, encoding='utf8'))
    for r in db:
        r['f'] = fold(r['title'])
    byid = {r['id']: r for r in db}
    src_urls = {r['source_url']: r for r in db if r.get('source_url')}

    # ofis adı -> proje id listesi
    off_projects = {}
    for l in pd_rows:
        off_projects.setdefault(fold(l['name']), []).append(l['project_id'])

    n1 = n2 = n3 = n4 = 0

    print('### GEÇİŞ 1 — İNGİLİZCE BAŞLIK (source_url + token + oran)\n')
    for p in scraped:
        f = fold(p.get('titleEn') or '')
        toks = title_tokens(p.get('titleEn') or '')
        hits = []
        if p['sourceUrl'] in src_urls:
            hits.append(('SOURCE_URL', 100, src_urls[p['sourceUrl']]))
        for r in db:
            if toks and all(w in r['f'] for w in toks):
                hits.append(('TOKEN', 90, r))
            ratio = difflib.SequenceMatcher(None, f, r['f']).ratio()
            if ratio > 0.62:
                hits.append(('ORAN', int(ratio * 100), r))
        n1 += show(f"--- {p['archelloSlug']} | {p.get('titleEn')} | {p.get('officeEn')} | "
                   f"{(p.get('data') or {}).get('Project Year')}", rank(hits))

    print('\n### GEÇİŞ 2 — OFİS × YIL KESİŞİMİ\n')
    print('### GEÇİŞ 3 — OFİS × TÜM PROJELER (yıl kaynakta yanlış/eksik olabiliyor)\n')
    for p in scraped:
        year = ((p.get('data') or {}).get('Project Year') or '').strip()
        cand = set()
        for n in credit_names(p):
            nf, nt = fold(n), office_tokens(n)
            # `nt` boşsa ERKEN ÇIKMA: tüm ayırt edici token'ları <=2 harf olan ofis adları
            # ("AE Interior Architecture" -> {}, "r.a.f. studio" -> {}) yalnızca TAM fold
            # eşitliğiyle yakalanır. Bu guard'ın erken dönmesi 4. partide
            # `white-village-house` -> #852 "Beyaz Ev" mükerrerini kaçırmıştı.
            for of, pids in off_projects.items():
                if nf == of or (nt and office_tokens(of) & nt):
                    cand.update(pids)
        same_year, other = [], []
        for i in cand:
            if i not in byid:
                continue
            (same_year if year and year in (byid[i].get('project_date') or '') else other).append(
                ('OFIS+YIL' if year and year in (byid[i].get('project_date') or '') else 'OFIS',
                 95 if year and year in (byid[i].get('project_date') or '') else 60, byid[i]))
        hits = same_year + other
        if hits:
            n2 += 1 if same_year else 0
            n3 += 1 if other else 0
            show(f"--- {p['archelloSlug']} | {p.get('titleEn')} | {p.get('officeEn')} | {year}",
                 rank(hits, limit=12))

    if a.translated:
        print('\n### GEÇİŞ 4 — ÇEVİRİ SONRASI TÜRKÇE BAŞLIK + SLUG ÇAKIŞMASI\n')
        tr = json.load(open(a.translated, encoding='utf8'))
        db_slugs = {r['slug']: r for r in db if r.get('slug')}
        for arch, t in tr.items():
            f = fold(t['title'])
            toks = title_tokens(t['title'])
            hits = []
            if t.get('slug') in db_slugs:
                hits.append(('SLUG_CAKISMASI', 100, db_slugs[t['slug']]))
            for r in db:
                if toks and all(w in r['f'] for w in toks):
                    hits.append(('TOKEN', 90, r))
                ratio = difflib.SequenceMatcher(None, f, r['f']).ratio()
                if ratio > 0.66:
                    hits.append(('ORAN', int(ratio * 100), r))
            n4 += show(f"--- {t['title']} [{t.get('slug')}] | {t.get('location')} | "
                       f"{t.get('projectDate')}", rank(hits))
    else:
        print('\n### GEÇİŞ 4 ATLANDI — --translated verilmedi.')
        print('DİKKAT: çeviri sonrası Türkçe tarama yapılmadan içe aktarma YAPMAYIN; geçmiş')
        print('partilerde yalnızca bu geçişte yakalanan mükerrerler oldu.')

    print(f'\nadayı olan proje sayısı: geçiş1={n1} geçiş2={n2} geçiş3={n3} geçiş4={n4} '
          f'(toplam {len(scraped)} proje)')


if __name__ == '__main__':
    main()
