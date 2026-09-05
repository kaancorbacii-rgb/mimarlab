#!/usr/bin/env python3
"""Ersa Mobilya referans projeleri (83 kazınmış sayfa) -> MİMARLAB import payload.

Bu script sadece bir "payload" JSON üretir, HİÇBİR ŞEY YAZMAZ (import-archello-projects.js'in
kendisi ayrı bir adım — 2. adım). Kararlar:

EŞLEŞME (enrich): 11 proje, ELLE doğrulandı (bkz. scripts/ersa-match-candidates.py çıktısı +
manuel şehir/kurum çapraz kontrolü). Otomatik bulanık eşleştirme SONUÇ olarak KULLANILMADI —
yalnızca aday üretti, her biri tek tek incelendi (crosstag-snoc-ersa-nurus.py İLKESİ). Zayıf/
belirsiz adaylar (ör. "İbis Otel" -> "WorkInn Otel", sırf "Otel" kelimesi ortak) elenip 'create'e
düşürüldü — yanlış pozitif, etiketsizlikten kötü.

Rami Kışlası Kütüphanesi + Rami Kütüphanesi: Ersa'nın kendi sitesinde AYNI binanın (Rami
Kütüphanesi, İstanbul/Eyüpsultan) iki ayrı vaka çalışması sayfası — görsel setleri TAMAMEN
ayrık (2023 RAMI_* seri vs ersa-mobilya-referans-proje-rami-kutuphanesi-* seri), ikisi de
projects#209'a (slug zaten 'rami-kutuphanesi') zenginleştirilecek.

Otokar + Otokar Otomotiv ve Savunma Sanayi A.Ş: AYNI şirket ama FARKLI şehir/tesis (Sakarya
fabrika vs İstanbul ofis, görsel setleri de tamamen ayrık) — İKİ AYRI proje olarak 'create'.

Ürün eşleştirme: Products sekmesindeki img[alt]="Ersa Mobilya | <Aile Adı>" metni, offices.id=769
ürünlerinin title'ıyla fold_tr eşleştirilir. 278/288 eşleşti; eşleşmeyen 7 aile (Core&Rove, Grid,
Lagoon, Meraki, Nox, Smart, Stoneage) MİMARLAB kataloğunda YOK — hotspot/kenar YAZILMAZ, sadece
raporlanır (uydurma ürün satırı açılmaz).

Ofis/mimar künyesi: "Mimari Ofis" alanı virgülle bölünüp architects+offices tablolarında fold_tr
tam-ad eşleşmesi aranır (import-archello-projects.js İLKESİ: eşleşmeyen isme YENİ PROFİL AÇILMAZ,
migration_name_conflicts'e düşer). Anlamsız/placeholder değerler ("-", "Mimari Stüdyo", "Team
Project", "Uygulamalı Alanlar", "*Alanları*" içerenler — bunlar CMS'in başka bir alanının sızıntısı)
baştan elenir.

Kullanım: python3 scripts/ersa-projects-build-payload.py
Çıktı: scripts/output/ersa-projects-payload.json + okunabilir rapor (stdout)
"""
import json
import re

TR_MAP = {'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o',
          'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u'}


def fold_tr(s):
    return ''.join(TR_MAP.get(c, c) for c in str(s or '')).lower().strip()


def slugify(s):
    s = ''.join(TR_MAP.get(c, c) for c in str(s or '')).lower()
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return s.strip('-')


# ---- 1. Elle doğrulanmış eşleşmeler (ersa_slug -> MİMARLAB project id) ------------------
MATCHES = {
    'anadolu-ajansi-istanbul-genel-mudurluk': 1423,   # "Anadolu Ajansı İstanbul", aynı şehir
    'cumhurbaskanligi-millet-kutuphanesi': 1320,       # birebir başlık eşleşmesi
    'ankara-uzay-ve-havacilik-osb-idari-binasi': 907,  # "...OSB Ofisi", aynı kurum+şehir
    'cobac-workspace': 921,                            # birebir başlık eşleşmesi
    'rami-kislasi-kutuphanesi': 209,                   # Rami Kütüphanesi, aynı bina (bkz. üstteki not)
    'rami-kutuphanesi': 209,
    'salt-galata': 54,                                 # "SALT Galata (Eski Osmanlı Bankası...)"
    'ronesans-maltepe': 1683,                          # Rönesans Holding Genel Merkezi, Maltepe
    'avrasya-tuneli': 443,                              # tünelin tek idari/bakım binası
    'nokia': 1642,                                      # "Nokia İstanbul Genel Merkezi", aynı marka+şehir
    'sap': 1657,                                        # "SAP Türkiye Genel Merkezi", aynı marka+şehir
}

# ---- 2. Sektör -> (category[], type[]) varsayılan haritası ------------------------------
SEKTOR_MAP = {
    'Misafirperverlik': (['Konaklama'], ['Turizm / Otel']),
    'Eğitim': (['Eğitim'], ['Okul']),
    'Ofis/Kurumsal': (['Ticari'], ['Ofis / İş Merkezi']),
    'Ofis/Kurumsa': (['Ticari'], ['Ofis / İş Merkezi']),
    'Ofis': (['Ticari'], ['Ofis / İş Merkezi']),
    'Kütüphane': (['Kültürel'], ['Kütüphane']),
    'Finans': (['Ticari'], ['Ofis / İş Merkezi']),
    'Devlet Kurumu': (['Kamu'], ['Kamu / İdari Yapı']),
    'Sağlık': (['Kamu'], ['Sağlık']),
    'Konut': (['Konaklama'], ['Konut']),
    'Otomotiv ve Savunma Sanayi': (['Ticari'], ['Sanayi / Üretim']),
    'Gıda Ambalaj Çözümleri': (['Ticari'], ['Sanayi / Üretim']),
    'Enerji': (['Ticari'], ['Ofis / İş Merkezi']),
    'Teknoloji': (['Ticari'], ['Ofis / İş Merkezi']),
    'Gıda': (['Ticari'], ['Sanayi / Üretim']),
    'Oyun / Teknoloji': (['Ticari'], ['Ofis / İş Merkezi']),
    'Gayrimenkul': (['Ticari'], ['Ofis / İş Merkezi']),
    'Tekstil': (['Ticari'], ['Ofis / İş Merkezi']),
}
TYPE_OVERRIDE_BY_SLUG = {
    'ibn-i-haldun-universitesi': ['Yükseköğretim'],
    'koc-universitesi-yapay-zeka-merkezi': ['Yükseköğretim'],
    'sabanci-universitesi-temel-gelistirme-binasi': ['Yükseköğretim'],
    'tubitak-sage-ar-ge-binasi': ['Ar-Ge / Araştırma'],
}

OFFICE_SKIP = {'-', '', 'mimari studyo', 'team project', 'uygulamali alanlar', 'donusum mimari'}


def clean_office_credit(raw):
    if not raw:
        return []
    if 'alanlari' in fold_tr(raw) or fold_tr(raw).strip() in OFFICE_SKIP:
        return []
    parts = [p.strip() for p in raw.split(',') if p.strip()]
    return [p for p in parts if fold_tr(p).strip() not in OFFICE_SKIP]


BACK_VOWELS, FRONT_VOWELS = set('aıou'), set('eiöü')
UNVOICED = set('pçtkfhsş')


def locative(place):
    """'İstanbul' -> 'İstanbul'da', 'İzmir' -> 'İzmir'de' (ünlü uyumu + ünsüz sertleşmesi)."""
    word = re.sub(r'[^a-zçğıiöşü]', '', fold_tr(place))
    last_vowel = next((c for c in reversed(word) if c in BACK_VOWELS | FRONT_VOWELS), 'a')
    suffix_vowel = 'a' if last_vowel in BACK_VOWELS else 'e'
    consonant = 't' if word and word[-1] in UNVOICED else 'd'
    return f"{place}'{consonant}{suffix_vowel}"


def main():
    ersa = json.load(open('scripts/output/ersa-projects-raw.json', encoding='utf8'))
    mimarlab = json.load(open('/tmp/all-projects-clean.json', encoding='utf8'))
    ersa_products = json.load(open('/tmp/ersa-products-clean.json', encoding='utf8'))
    architects = json.load(open('/tmp/architects-clean.json', encoding='utf8'))
    offices = json.load(open('/tmp/offices-clean.json', encoding='utf8'))
    targets = json.load(open('/tmp/match-targets-clean.json', encoding='utf8'))

    proj_by_id = {p['id']: p for p in mimarlab}
    target_images = {t['id']: set(json.loads(t['images'] or '[]')) for t in targets}
    prod_by_fold = {fold_tr(p['title']): p for p in ersa_products}
    arch_by_fold = {fold_tr(a['name']): a['id'] for a in architects}
    office_by_fold = {fold_tr(o['name']): o['id'] for o in offices}

    unmatched_products = {}
    unmatched_offices = {}
    enrich, create = [], []

    for e in ersa:
        slug = e['slug']
        items = list(e['overview'].items())
        sektor = items[0][1] if len(items) > 0 else None
        location = items[1][1].replace(' I ', ', ') if len(items) > 1 else None
        year = items[2][1] if len(items) > 2 else None
        office_raw = items[3][1] if len(items) > 3 else None
        year_num = int(year) if year and year.isdigit() else None
        date_bucket = None
        if year_num:
            date_bucket = f"{(year_num // 10) * 10}'lar" if (year_num // 10) % 10 in (0, 1) else f"{(year_num // 10) * 10}'ler"
            date_bucket = "2020'ler" if year_num >= 2020 else ("2010'lar" if year_num >= 2010 else date_bucket)

        # ürün eşleştirme (ortak, hem enrich hem create için)
        product_ids = []
        for pr in e['products']:
            f = fold_tr(pr['name'])
            if f in prod_by_fold:
                product_ids.append(prod_by_fold[f]['id'])
            else:
                unmatched_products.setdefault(pr['name'], []).append(slug)

        if slug in MATCHES:
            pid = MATCHES[slug]
            existing = target_images.get(pid, set())
            new_images = [u for u in e['images'] if u not in existing]
            enrich.append({
                'action': 'enrich', 'ersa_slug': slug, 'project_id': pid,
                'project_slug': proj_by_id[pid]['slug'], 'project_title': proj_by_id[pid]['title'],
                'new_image_urls': new_images, 'product_ids': sorted(set(product_ids)),
                'source_url': e['source_url'],
            })
            continue

        # ofis/mimar künyesi eşleştirme
        credits = clean_office_credit(office_raw)
        office_ids, unmatched_credit_names = [], []
        for name in credits:
            f = fold_tr(name)
            if f in office_by_fold:
                office_ids.append(office_by_fold[f])
            elif f in arch_by_fold:
                office_ids.append(('architect', arch_by_fold[f]))
            else:
                unmatched_credit_names.append(name)
                unmatched_offices.setdefault(name, []).append(slug)

        cat, typ = SEKTOR_MAP.get(sektor, (['Ticari'], ['Ofis / İş Merkezi']))
        if slug in TYPE_OVERRIDE_BY_SLUG:
            typ = TYPE_OVERRIDE_BY_SLUG[slug]

        desc = e['description']
        if not desc:
            areas = items[4][1] if len(items) > 4 else None
            city = location.split(',')[0].strip() if location else None
            bits = [f"{locative(city)} yer alan bu {sektor.lower()} projesinde Ersa Mobilya ürünleri kullanılmıştır." if city and sektor else 'Bu projede Ersa Mobilya ürünleri kullanılmıştır.']
            if areas:
                bits.append(f"Uygulama alanları: {areas}.")
            desc = ' '.join(bits)

        create.append({
            'action': 'create', 'ersa_slug': slug,
            'slug': slugify(e['title']), 'title': e['title'],
            'category': cat, 'type': typ, 'discipline': ['İç Mekan'],
            'location': location, 'project_date': year, 'date_bucket': date_bucket,
            'description': desc, 'image_urls': e['images'],
            'photo_credit_text': 'Ersa Mobilya', 'source_url': e['source_url'],
            'product_ids': sorted(set(product_ids)),
            'office_ids': [o for o in office_ids if isinstance(o, int)],
            'architect_ids': [o[1] for o in office_ids if isinstance(o, tuple)],
            'unmatched_credits': unmatched_credit_names,
        })

    out = {'enrich': enrich, 'create': create}
    json.dump(out, open('scripts/output/ersa-projects-payload.json', 'w', encoding='utf8'),
               ensure_ascii=False, indent=2)

    print(f'ZENGİNLEŞTİRME (enrich): {len(enrich)} proje')
    for x in enrich:
        print(f"  #{x['project_id']:<5} {x['project_title']:<45} +{len(x['new_image_urls'])} görsel, "
              f"ürün id: {x['product_ids']}")
    print(f'\nYENİ PROJE (create): {len(create)} proje')
    for x in create:
        print(f"  {x['slug']:<55} {x['title']:<42} img={len(x['image_urls']):2} "
              f"cat={x['category']} type={x['type']} ofis={x['office_ids']} mimar={x['architect_ids']} "
              f"eşleşmeyen_künye={x['unmatched_credits']}")

    print(f'\nEşleşmeyen ürün aileleri (kataloğa YAZILMADI): {json.dumps(unmatched_products, ensure_ascii=False)}')
    print(f'\nEşleşmeyen ofis/mimar künyeleri (migration_name_conflicts\'e düşecek): {json.dumps(unmatched_offices, ensure_ascii=False)}')
    print(f'\nToplam: {len(enrich)} enrich + {len(create)} create = {len(enrich)+len(create)} (kazınan 83)')
    print('Çıktı: scripts/output/ersa-projects-payload.json')


if __name__ == '__main__':
    main()
