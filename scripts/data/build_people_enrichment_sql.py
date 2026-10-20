#!/usr/bin/env python3
"""
Turn an enrich_people_metadata.js proposal (+ fill_avatar_attribution.py credits)
into reviewed UPDATE statements for `people`.

READ-ONLY toward the database; writes a review CSV and chunked SQL files.

What it fixes in the raw proposal:
  - Bios were cut at 600 chars mid-sentence ("... He believes in ..."). They are
    rebuilt from the Wikipedia lead's first paragraph, whole sentences only.
  - Wikipedia text is CC BY-SA, so every bio row also gets source_url = the
    Wikipedia article. The person page already renders that as "Profile source".
  - Roles lose Wikidata's "(born 1947)" suffix and get a leading capital.
  - Avatars are written only when the Commons credit (author + license + file
    page) was found, because CC BY / CC BY-SA require it.
  - Existing values are never overwritten (`coalesce(nullif(col,''), new)`).

Usage:
    python3 scripts/data/build_people_enrichment_sql.py \
        --proposal scratch/people_enrichment_proposal.json \
        --attribution scratch/people_attribution.csv \
        --out scratch/people_write
"""
import argparse
import csv
import json
import re
import time
import urllib.parse
import urllib.request

UA = "BookMentionsEnrichmentBot/1.0 (+https://bookmentions.net; contact: team@bookmentions.net)"
MAX_BIO = 480
MIN_BIO = 60


def wiki_batch(names):
    qs = urllib.parse.urlencode(
        {"action": "query", "prop": "extracts|info", "exintro": 1, "explaintext": 1, "exlimit": "max",
         "inprop": "url", "redirects": 1, "format": "json", "formatversion": 2, "titles": "|".join(names)}
    )
    for attempt in range(5):
        try:
            req = urllib.request.Request(f"https://en.wikipedia.org/w/api.php?{qs}", headers={"User-Agent": UA})
            return json.load(urllib.request.urlopen(req, timeout=40))["query"]
        except Exception:
            time.sleep(2 * (attempt + 1))
    return {}


def sentences(par):
    # Split on ". " followed by a capital, but not after common abbreviations / initials.
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"“])", par)
    out, buf = [], ""
    for p in parts:
        buf = f"{buf} {p}".strip() if buf else p
        if re.search(r"(\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Inc|Ltd|vs|c|b|d|U\.S|U\.K|[A-Z])\.)$", buf):
            continue
        out.append(buf)
        buf = ""
    if buf:
        out.append(buf)
    return out


def build_bio(extract):
    par = (extract or "").strip().split("\n")[0].strip()
    par = re.sub(r"\s*\([^()]*\)", lambda m: "" if re.search(r"/|pronounced|IPA|listen", m.group(0)) else m.group(0), par)
    par = re.sub(r"\s+", " ", par)
    bio = ""
    for s in sentences(par):
        cand = f"{bio} {s}".strip()
        if len(cand) > MAX_BIO and bio:
            break
        bio = cand
        if len(bio) >= 300:
            break
    return bio if MIN_BIO <= len(bio) <= 600 else ""


def clean_role(r):
    r = re.sub(r"\s*\((?:born|b\.)[^)]*\)", "", r or "").strip()
    r = re.sub(r"\s+", " ", r)
    return (r[:1].upper() + r[1:]) if r else ""


def q(s):
    return "NULL" if s in (None, "") else "'" + s.replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--proposal", required=True)
    ap.add_argument("--attribution", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--chunk", type=int, default=60)
    a = ap.parse_args()

    rows = json.load(open(a.proposal))
    credit = {r["id"]: r for r in csv.DictReader(open(a.attribution))}

    # Wikipedia article + clean lead per person with a proposed bio.
    want = [r for r in rows if r.get("proposed_bio")]
    wiki = {}
    for i in range(0, len(want), 20):
        batch = want[i : i + 20]
        data = wiki_batch([r["name"] for r in batch])
        norm = {n["from"]: n["to"] for n in data.get("normalized", [])}
        redir = {n["from"]: n["to"] for n in data.get("redirects", [])}
        pages = {p["title"]: p for p in data.get("pages", []) if not p.get("missing")}
        for r in batch:
            t = norm.get(r["name"], r["name"])
            t = redir.get(t, t)
            p = pages.get(t)
            if p and p.get("extract"):
                wiki[r["id"]] = p
        time.sleep(0.5)

    out, stats = [], {"bio": 0, "bio_unverified": 0, "avatar": 0, "role": 0}
    for r in rows:
        role = clean_role(r.get("proposed_role"))
        bio, src = "", ""
        p = wiki.get(r["id"])
        if p:
            # Same person as the proposal: the proposal's bio is a prefix of this lead.
            head = re.sub(r"\s+", " ", r["proposed_bio"])[:70]
            if head and head in re.sub(r"\s+", " ", p["extract"]):
                bio, src = build_bio(p["extract"]), p["fullurl"]
            else:
                stats["bio_unverified"] += 1
        c = credit.get(r["id"])
        av = {}
        if c and c["avatar_license"] and c["avatar_author"] and c["avatar_source_url"]:
            av = c
        stats["bio"] += bool(bio)
        stats["avatar"] += bool(av)
        stats["role"] += bool(role)
        if not (role or bio or av):
            continue
        out.append(
            {"id": r["id"], "slug": r["slug"], "name": r["name"], "role": role if role else "", "bio": bio,
             "source_url": src if bio else "", "avatar_url": av.get("avatar_url", ""),
             "avatar_source_url": av.get("avatar_source_url", ""), "avatar_license": av.get("avatar_license", ""),
             "avatar_author": av.get("avatar_author", ""), "avatar_attribution": av.get("avatar_attribution", "")}
        )

    with open(a.out + ".csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)

    cols = ["role", "bio", "source_url", "avatar_url", "avatar_source_url", "avatar_license", "avatar_author", "avatar_attribution"]
    for n in range(0, len(out), a.chunk):
        ch = out[n : n + a.chunk]
        vals = ",".join(f"('{r['id']}'::uuid," + ",".join(q(r[c]) for c in cols) + ")" for r in ch)
        # Each field is only filled when the row is currently empty; the avatar
        # block moves together so a photo is never stored without its credit.
        sql = (
            "update people p set "
            "role=coalesce(nullif(p.role,''),v.role), "
            "bio=coalesce(nullif(p.bio,''),v.bio), "
            "source_url=case when coalesce(p.bio,'')='' and v.bio is not null then coalesce(nullif(p.source_url,''),v.source_url) else p.source_url end, "
            "avatar_url=case when coalesce(p.avatar_url,'')='' then coalesce(v.avatar_url,p.avatar_url) else p.avatar_url end, "
            "avatar_source_url=case when coalesce(p.avatar_url,'')='' and v.avatar_url is not null then v.avatar_source_url else p.avatar_source_url end, "
            "avatar_license=case when coalesce(p.avatar_url,'')='' and v.avatar_url is not null then v.avatar_license else p.avatar_license end, "
            "avatar_author=case when coalesce(p.avatar_url,'')='' and v.avatar_url is not null then v.avatar_author else p.avatar_author end, "
            "avatar_attribution=case when coalesce(p.avatar_url,'')='' and v.avatar_url is not null then v.avatar_attribution else p.avatar_attribution end, "
            "updated_at=now() "
            f"from (values {vals}) as v(id,{','.join(cols)}) where p.id=v.id returning p.slug;"
        )
        with open(f"{a.out}_{n // a.chunk + 1:02d}.sql", "w") as f:
            f.write(sql)

    print(f"{len(out)} people rows; {stats}; -> {a.out}.csv and {(len(out) + a.chunk - 1) // a.chunk} sql chunk(s)")


if __name__ == "__main__":
    main()
