#!/usr/bin/env python3
"""B&T Design (bt.design) ürün sayfası kazıyıcısı — 2026-09-04 dördüncü ürün partisi.

Site ASP.NET tabanlı, tüm ürün sayfaları aynı şablonu kullanıyor; kancalar:
  h1.emos_H1                    → ürün adı ("Odin")
  #plhUrunKodu                  → üretici ürün kodu ("BT275")
  #plhMarkaKisaAciklama         → "Tasarımcı | Yıl"
  #plhKisaAciklama              → tek cümlelik tanıtım
  #plhAciklama                  → tam açıklama
  img.mapping-img               → GERÇEK galeri (uploads/urunler/*.jpg)
  .dimension-images             → ölçü/datasheet görselleri (teknik çizim)
  .urunDetay_urunDokuman a      → gerçek CAD/booklet indirme bağlantıları
  .swiper-slide-project a       → "Ürünün Yer Aldığı Projeler"

Çıktı: scripts/output/btdesign-scraped.json
"""
import json
import os
import re
import sys
import html as H
from pathlib import Path

PAGES = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("pages")
# ÇIKTI YOLU ARGÜMANLA VERİLEBİLİR. Sabit tek bir yol, ikinci bir partiyi kazırken BİRİNCİ partinin
# çıktısını sessizce EZİYOR (2026-09-04'te 17'lik parti 85'lik dosyanın üstüne yazdı; payload
# üreticisi ve onarım betikleri o dosyayı okuduğu için fark edilmeden bozulabilirdi).
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else (
    Path(__file__).parent / "output" / "btdesign-scraped.json")

BASE = "https://bt.design"


def strip_tags(s):
    s = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", s)
    s = re.sub(r"(?is)<br\s*/?>", "\n", s)
    s = re.sub(r"(?is)</p>", "\n", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    s = H.unescape(s)
    s = s.replace("\xa0", " ")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n", s)
    return s.strip()


def block_by_id(h, el_id):
    """Belirli id'li elemanın iç HTML'ini dengeli div taramasıyla döndür."""
    m = re.search(r'<(\w+)[^>]*\bid="%s"[^>]*>' % re.escape(el_id), h)
    if not m:
        return None
    tag = m.group(1)
    i = m.end()
    depth = 1
    for t in re.finditer(r"</?%s\b[^>]*>" % tag, h[i:], re.I):
        if t.group(0).startswith("</"):
            depth -= 1
            if depth == 0:
                return h[i:i + t.start()]
        elif not t.group(0).endswith("/>"):
            depth += 1
    return None


def abs_url(u):
    u = H.unescape(u.strip())
    if u.startswith("//"):
        return "https:" + u
    if u.startswith("http"):
        return u
    return BASE + "/" + u.lstrip("./").lstrip("/")


def timthumb_src(u):
    """timthumb.php?src=uploads/... sarmalayıcısını çöz, orijinal dosyayı ver."""
    m = re.search(r"timthumb\.php\?src=([^&\"']+)", u)
    if m:
        return abs_url(m.group(1))
    return abs_url(u)


def parse(slug, h):
    d = {"slug": slug, "sourceUrl": f"{BASE}/{slug}.html"}

    m = re.search(r'(?is)<h1[^>]*class="emos_H1"[^>]*>(.*?)</h1>', h)
    d["name"] = strip_tags(m.group(1)) if m else ""

    b = block_by_id(h, "plhUrunKodu")
    d["code"] = strip_tags(b) if b else ""

    b = block_by_id(h, "plhMarkaKisaAciklama")
    d["designerLine"] = strip_tags(b) if b else ""
    d["designer"], d["year"] = "", ""
    if d["designerLine"]:
        parts = [p.strip() for p in d["designerLine"].split("|")]
        for p in parts:
            if re.fullmatch(r"(19|20)\d{2}", p):
                d["year"] = p
            elif p and not d["designer"]:
                d["designer"] = p

    b = block_by_id(h, "plhKisaAciklama")
    d["tagline"] = strip_tags(b) if b else ""

    b = block_by_id(h, "plhAciklama")
    d["description"] = strip_tags(b) if b else ""

    # --- galeri: İKİ ayrı slayt kalıbı var ---
    #   (a) img.mapping-img  → kumaş/malzeme işaretçisi taşıyan sayfalar
    #   (b) li[data-large]   → işaretçisiz sayfalar (masalar, pufların çoğu)
    # İkisi de ürünün KENDİ galerisidir; "Benzer Ürünler" karuseli ise
    # .ems-prd-image bloklarında yaşar ve ikisine de girmez.
    gallery, seen = [], set()

    def add(u):
        u = timthumb_src(u)
        if "/uploads/urunler/" not in u:
            return
        # mobil kırpımları masaüstü eşleniğinin tekrarıdır
        if re.search(r"-mobil[-_]?\d*m?-\d+\.", u, re.I):
            return
        if u not in seen:
            seen.add(u)
            gallery.append(u)

    for m in re.finditer(r'<img[^>]*\bclass="[^"]*\bmapping-img\b[^"]*"[^>]*>', h, re.I):
        s = re.search(r'src="([^"]+)"', m.group(0))
        if s:
            add(s.group(1))
    for m in re.finditer(r'data-large="([^"]+)"', h):
        add(m.group(1))
    d["gallery"] = gallery

    # --- dekupe (saydam zeminli ürün render'ları) ---
    dek = []
    for u in re.findall(r'"(https://bt\.design/image-resize/dekupe/urunler/[^"]+)"', h):
        u = H.unescape(u)
        if u not in dek:
            dek.append(u)
    d["cutouts"] = dek

    # --- kapak ---
    # Sayfada BAŞKA ürünlerin kapakları da var ("Benzer Ürünler" karuseli,
    # .ems-prd-image). Ürünün kendi kapağı fiyat-teklifi formunun içindedir;
    # o bloğa çapa at, "ilk eşleşme" heuristiğine güvenme.
    cov = ""
    rf = re.search(r'(?is)<div class="request-form-prd">(.{0,2000}?)</div>', h)
    scope = rf.group(1) if rf else ""
    m = re.search(r'src="([^"]*timthumb\.php\?src=uploads/urunler/[^"]*)"', scope, re.I)
    if m:
        cov = timthumb_src(m.group(1))
    d["cover"] = cov

    # --- ölçü / teknik çizim görselleri ---
    dims = []
    for m in re.finditer(r'<img[^>]*\bclass="[^"]*\bdimension-images\b[^"]*"[^>]*>', h, re.I):
        s = re.search(r'src="([^"]+)"', m.group(0))
        if s:
            u = timthumb_src(s.group(1))
            if u not in dims:
                dims.append(u)
    d["dimensionImages"] = dims

    # --- indirilebilir dosyalar (gerçek CAD/booklet) ---
    files = []
    for m in re.finditer(
        r'(?is)<div class="urunDetay_urunDokuman">\s*<a[^>]*href="([^"]+)"[^>]*'
        r'extension="([^"]*)"[^>]*>(.*?)</a>', h):
        url, ext, label = abs_url(m.group(1)), m.group(2).strip(), strip_tags(m.group(3))
        if not label:
            continue
        files.append({"label": label, "url": url, "ext": ext.lstrip(".").upper() or "ZIP"})
    d["files"] = files

    # --- kategori kırıntısı (schema.org ListItem, .navigasyonSeviyeN) ---
    crumbs = []
    for m in re.finditer(
        r'(?is)<li[^>]*class="navigasyonSeviye\d"[^>]*>.*?<span itemprop="name"[^>]*>(.*?)</span>', h):
        t = strip_tags(m.group(1))
        if t and t not in crumbs:
            crumbs.append(t)
    d["breadcrumbs"] = crumbs

    # --- "Ürünün Yer Aldığı Projeler" ---
    projects = []
    for m in re.finditer(
        r'(?is)<li class="swiper-slide swiper-slide-project">\s*<a[^>]*href="([^"]+)"(.*?)</li>', h):
        url = abs_url(m.group(1))
        inner = m.group(2)
        cat = re.search(r'(?is)<span class="block ttl font-3">\s*<span>(.*?)</span>', inner)
        nm = re.search(r'(?is)<p class="font-4[^"]*">(.*?)</p>', inner)
        projects.append({
            "url": url,
            "category": strip_tags(cat.group(1)) if cat else "",
            "name": strip_tags(nm.group(1)) if nm else "",
        })
    d["projects"] = projects

    # --- döşeme/malzeme sekmeleri (#materialDiv → a.material-id-N) ---
    tags = []
    md = re.search(r'(?is)<div class="ems-tab-header ems-tab-materials-header[^"]*">(.*?)</div>', h)
    if md:
        for m in re.finditer(r'(?is)<a[^>]*class="material-id-\d+[^"]*"[^>]*>(.*?)</a>', md.group(1)):
            t = strip_tags(m.group(1))
            if t and t not in tags:
                tags.append(t)
    d["tags"] = tags

    # --- kumaş/malzeme eşleme kartları (mapping-card): döşeme alternatifleri ---
    mats = []
    for m in re.finditer(r"(?is)<span class='mapping-img-span'>(.*?)</span>", h):
        t = strip_tags(m.group(1))
        t = re.sub(r"\s*\n\s*", " ", t).strip()
        if t and t not in mats:
            mats.append(t)
    d["materials"] = mats

    return d


def main():
    rows = []
    for f in sorted(PAGES.glob("*.html")):
        h = f.read_text(encoding="utf-8", errors="replace")
        rows.append(parse(f.stem, h))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    missing = lambda k: [r["slug"] for r in rows if not r[k]]
    print(f"{len(rows)} sayfa ayrıştırıldı → {OUT}")
    for k in ("name", "code", "designer", "description", "gallery", "cover"):
        m = missing(k)
        print(f"  {k:16s} eksik: {len(m)}" + (f"  {m[:8]}" if m else ""))
    print(f"  toplam galeri görseli: {sum(len(r['gallery']) for r in rows)}")
    print(f"  toplam dekupe: {sum(len(r['cutouts']) for r in rows)}")
    print(f"  toplam dosya: {sum(len(r['files']) for r in rows)}")
    print(f"  toplam ölçü görseli: {sum(len(r['dimensionImages']) for r in rows)}")
    print(f"  proje referansı olan ürün: {sum(1 for r in rows if r['projects'])}")


if __name__ == "__main__":
    main()
