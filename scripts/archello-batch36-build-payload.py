# Archello 36'lık parti (2026-09-02) — kazınan veriyi MİMARLAB payload'ına çeviren adım.
# Veri dosyaları (scraped/keep/existing-*.json) oturum çalışma dizinindedir ve repoya girmez;
# bu dosya çeviri tablosu + eşleştirme kurallarının KALICI kaydıdır (bkz.
# scripts/archello-batch36-translations.py). Çalıştırma: bu script'i veri dosyalarıyla aynı
# dizine kopyalayıp `python3 archello-batch36-build-payload.py` ile çalıştır.
import json, sys, re, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from translations import T

wd = os.path.dirname(os.path.abspath(__file__))
keep     = json.load(open(f"{wd}/keep.json"))
existing = json.load(open(f"{wd}/existing-projects.json"))[0]['results']
offices  = json.load(open(f"{wd}/existing-offices.json"))[0]['results']

def fold(s):
    s = (s or '').replace('İ','i').replace('I','ı').lower()
    for a,b in [('ı','i'),('ş','s'),('ç','c'),('ğ','g'),('ü','u'),('ö','o')]: s = s.replace(a,b)
    return ''.join(ch for ch in s if ch.isalnum())

# EN -> TR firma adı alias'ları. GERÇEK BULGU: Archello firmaları İNGİLİZCE adıyla listeliyor
# ("Habif Architects"), MİMARLAB ise aynı firmayı TÜRKÇE adıyla tutuyor ("Habif Mimarlık").
# Düz normalize eşleştirme bunları kaçırıyor ve var olan profiller yanlışlıkla "metin" olarak
# yazılacaktı — her biri D1'de tek tek doğrulandı.
ALIAS = {
    "Habif Architects": "Habif Mimarlık",
    "Uygur Architects": "Uygur Mimarlık",
    "Zemberek Design": "Zemberek Tasarım",
    "DILEKCI ARCHITECTS": "Dilekci Mimarlık (DDA)",
    "Sepin Architecture": "Sepin Mimarlık",
    "Udesign Architecture": "Udesign Mimarlık",
    "VEN Architecture": "VEN Mimarlık",
    "Renda Helin Design & Interiors": "Renda Helin Design",
}
omap  = {fold(o['name']): o for o in offices}
eslug = {r['slug'] for r in existing}
etitle= {fold(r['title']) for r in existing}

def bucket(y):
    try: n = int(str(y)[:4])
    except Exception: return None
    return f"{n//10*10}'l{'a' if (n//10*10)%100 in (10,30,40,60,90) else 'e'}r"

payload, skipped, unmatched = [], [], []
for x in keep:
    t = T.get(x['archelloSlug'])
    if not t: skipped.append((x['archelloSlug'],'çeviri yok')); continue
    # Türkçe slug/başlık bazlı mükerrer kontrolü (kullanıcı isteği)
    if t['slug'] in eslug or fold(t['title']) in etitle:
        skipped.append((x['archelloSlug'], f"TR mükerrer: {t['slug']}")); continue
    year = (x['data'].get('Project Year') or '').strip() or None
    office_name = x['officeEn']
    hit = omap.get(fold(ALIAS.get(office_name, office_name)))
    # Fotoğrafçı yoksa firma adına düş (kullanıcı isteği)
    photog = (x.get('photographer') or '').strip()
    photog = re.sub(r'^(Photo:|Image Courtesy)\s*', '', photog, flags=re.I).strip()
    if not photog: photog = office_name
    if not hit: unmatched.append(office_name)
    payload.append(dict(
        slug=t['slug'], title=t['title'],
        category=t['category'], type=t['type'], discipline=t['discipline'],
        location=t['location'], locationDetail=t['locationDetail'],
        projectDate=year, dateBucket=bucket(year),
        description=t['desc'],
        images=[im['url'] for im in x['images']],
        photoCredit=photog,
        sourceUrl=x['sourceUrl'],
        lat=x['lat'], lng=x['lng'],
        officeId=(hit['id'] if hit else None),
        officeName=office_name,
    ))

json.dump(payload, open(f"{wd}/payload.json","w"), ensure_ascii=False, indent=1)
print(f"payload: {len(payload)} proje")
print(f"atlanan : {len(skipped)}")
for s in skipped: print("   -", s)
print(f"\nfirma eşleşen : {sum(1 for p in payload if p['officeId'])}")
print(f"firma METİN   : {sum(1 for p in payload if not p['officeId'])}")
for n in sorted(set(unmatched)): print("   metin:", n)
print(f"\ntoplam görsel : {sum(len(p['images']) for p in payload)}")
print(f"açıklama uzunluk: min {min(len(p['description']) for p in payload)} / max {max(len(p['description']) for p in payload)} (sınır 1500)")
miss=[k for p in payload for k,v in p.items() if v in (None,'',[]) and k not in ('locationDetail',)]
print("boş alan:", sorted(set(miss)) or "yok")
