#!/usr/bin/env python3
"""Ersa proje kazımasını (83) mevcut MİMARLAB projects tablosuyla eşleştirme ADAYLARI üretir.

crosstag-snoc-ersa-nurus.py İLKESİ: bu script SONUÇ üretmez, yalnızca ELLE doğrulanacak
adayları basar. Hiçbir satır otomatik yazılmaz.
"""
import json
import re

TR_MAP = {'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o',
          'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u'}


def fold_tr(s):
    return ''.join(TR_MAP.get(c, c) for c in str(s or '')).lower().strip()


NOISE = {'a', 's', 'ltd', 'sti', 'genel', 'mudurluk', 'mudurlugu', 'merkezi', 'merkez',
         'binasi', 'bina', 'ofis', 'ofisi', 've', 'the', 'grup', 'group', 'holding',
         'sirketi', 'san', 'tic', 'insaat'}


def tokens(s):
    s = re.sub(r'[^a-z0-9 ]', ' ', fold_tr(s))
    return {t for t in s.split() if t and t not in NOISE}


ersa = json.load(open('scripts/output/ersa-projects-raw.json', encoding='utf8'))
mimarlab = json.load(open('/tmp/all-projects-clean.json', encoding='utf8'))

by_fold = {}
for p in mimarlab:
    by_fold.setdefault(fold_tr(p['title']), []).append(p)

for e in ersa:
    et = e['title']
    ef = fold_tr(et)
    etoks = tokens(et)
    print(f'\n=== {et}  ({e["slug"]}) | Konum: {e["overview"].get("Konum","?")} ===')

    exact = by_fold.get(ef)
    if exact:
        for p in exact:
            print(f'  [EXACT]  #{p["id"]:<5} {p["title"]:<45} loc={p.get("location")}')
        continue

    cands = []
    for p in mimarlab:
        ptoks = tokens(p['title'])
        if not ptoks or not etoks:
            continue
        inter = etoks & ptoks
        if not inter:
            continue
        score = len(inter) / max(len(etoks), len(ptoks))
        if score >= 0.5 or (len(inter) >= 1 and (etoks <= ptoks or ptoks <= etoks)):
            cands.append((score, p))
    cands.sort(key=lambda x: -x[0])
    if not cands:
        print('  [NO CANDIDATE]')
    for score, p in cands[:4]:
        print(f'  [{score:.2f}]   #{p["id"]:<5} {p["title"]:<45} loc={p.get("location")}')
