# Firma profili OLMAYAN projeler için project_submissions künye satırlarını üretir
# (bkz. [[project_unmatched_project_credits_via_submission_row]]).
# Eşleşen firma profili OLMAYAN projeler için project_submissions satırı üretir.
# Bkz. [[project_unmatched_project_credits_via_submission_row]]:
#   * Satır EKSİKSİZ olmalı (canonical projects satırının aynası) — eksik alanlı bir taslak,
#     admin projeyi bir kez kaydettiğinde canonical satırı boş değerlerle EZER.
#   * Firması EŞLEŞEN projelere bu satır EKLENMEZ — `office` dolu olunca isLegacy=false olur ve
#     "firma kurucularını Mimar chip'i yap" fallback'i kapanır.
import json, os, sys, uuid
wd = os.path.dirname(os.path.abspath(__file__))
payload = json.load(open(f"{wd}/payload.json"))
def q(v):
    if v is None: return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"
rows, now = [], 0
targets = [p for p in payload if not p['officeId']]
for p in targets:
    pid = str(uuid.uuid4())
    rows.append(f"""INSERT INTO project_submissions
 (id, owner_user_id, status, created_at, updated_at, slug, title, category, type, location,
  locationDetail, date, dateBucket, period, designer, photoCreditText, photoCreditUrl,
  description, images, brands, claimed_slug, source_url, ai_generated, discipline, office,
  build_status, conceptCategory, awards, publishDate, lat, lng)
 VALUES ({q(pid)}, NULL, 'approved', strftime('%s','now')*1000, strftime('%s','now')*1000,
  {q(p['slug'])}, {q(p['title'])}, {q(json.dumps(p['category'],ensure_ascii=False))},
  {q(json.dumps(p['type'],ensure_ascii=False))}, {q(p['location'])}, {q(p['locationDetail'])},
  {q(p['projectDate'])}, {q(p['dateBucket'])}, '[]', '[]',
  {q(p['photoCredit'])}, NULL, {q(p['description'])},
  {q(json.dumps(p['images'],ensure_ascii=False))}, '[]', {q(p['slug'])}, {q(p['sourceUrl'])}, 0,
  {q(json.dumps(p['discipline'],ensure_ascii=False))},
  {q(json.dumps([p['officeName']],ensure_ascii=False))},
  'built', NULL, '[]', NULL, {p['lat']}, {p['lng']});""")
open(f"{wd}/credit-rows.sql","w").write("\n".join(rows)+"\n")
print(f"{len(rows)} künye satırı üretildi (firması eşleşmeyen projeler):")
for p in targets: print(f"   {p['slug']:44s} firma metni: {p['officeName']}")
