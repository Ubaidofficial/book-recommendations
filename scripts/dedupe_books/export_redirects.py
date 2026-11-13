"""Export public.slugs book redirects as [old, new] pairs for next.config.js."""
import json, os, urllib.request
BASE = "https://ghpdpvatfmvsahzsqgpp.supabase.co/rest/v1/"
KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "redirects", "book-merges-20261112.json")


def get(path):
    req = urllib.request.Request(BASE + path, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
    return json.load(urllib.request.urlopen(req, timeout=120))


rows, off = [], 0
while True:
    page = get(f"slugs?select=slug,entity_id&entity_type=eq.book&order=slug&limit=1000&offset={off}")
    rows += page
    off += len(page)
    if len(page) < 1000:
        break
ids = sorted({r["entity_id"] for r in rows})
live = {}
for i in range(0, len(ids), 150):
    for b in get("books?select=id,slug&id=in.(" + ",".join(ids[i:i + 150]) + ")"):
        live[b["id"]] = b["slug"]
pairs = [[r["slug"], live[r["entity_id"]]] for r in rows if r["entity_id"] in live and live[r["entity_id"]] != r["slug"]]
missing = [r for r in rows if r["entity_id"] not in live]
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    f.write("[\n" + ",\n".join(json.dumps(p) for p in pairs) + "\n]\n")
print(len(rows), "slugs rows;", len(pairs), "pairs written;", len(missing), "point at missing books")
