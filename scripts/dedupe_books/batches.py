"""Split MERGE clusters of plan.json into SQL batches (pilot of 10, then <=50 groups each)."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import byid, recs_by, shown, HERE

PILOT_KEYS = ["lettersfromastoic", "12rulesforlife", "quiet", "highoutputmanagement", "range", "madetostick",
              "theblackswan", "influence", "hooked", "toolsoftitans"]
plan = json.load(open(os.path.join(HERE, "plan.json")))
merge = [c for c in plan if c["decision"] == "MERGE"]


def pairs(c):
    dups = [i for i in c["ids"] if i != c["canonical"]]
    dups.sort(key=lambda i: (i in shown, len(recs_by[i]), (byid[i]["cover_image_url"] or "").startswith("http"),
                             len(byid[i]["description"] or "")), reverse=True)
    return [{"dup": d, "canon": c["canonical"], "ord": k} for k, d in enumerate(dups)]


pilot = [c for c in merge if c["key"] in PILOT_KEYS]
assert len(pilot) == 10, [c["key"] for c in pilot]
rest = [c for c in merge if c["key"] not in PILOT_KEYS]
batches = [pilot] + [rest[i:i + 50] for i in range(0, len(rest), 50)]
os.makedirs(os.path.join(HERE, "batches"), exist_ok=True)
for n, b in enumerate(batches):
    ps = [p for c in b for p in pairs(c)]
    json.dump(ps, open(os.path.join(HERE, "batches", f"batch_{n:02d}.json"), "w"), separators=(",", ":"))
    print(n, len(b), "groups", len(ps), "pairs")
