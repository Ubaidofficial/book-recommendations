import json, urllib.request, sys, os
from concurrent.futures import ThreadPoolExecutor
BASE = "https://ghpdpvatfmvsahzsqgpp.supabase.co/rest/v1/"
KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z"
# Inputs and outputs live in the gitignored reports/ folder.
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "reports", "dedupe_20261112")


def fetch(table, select, order):
    out = []
    off = 0
    while True:
        url = f"{BASE}{table}?select={select}&order={order}&limit=1000&offset={off}"
        req = urllib.request.Request(url, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
        rows = json.load(urllib.request.urlopen(req, timeout=120))
        out += rows
        off += len(rows)
        if len(rows) < 1000:
            break
    json.dump(out, open(os.path.join(HERE, "data", table + ".json"), "w"))
    print(table, len(out), flush=True)


cfg = {
    "books": ("id,slug,title,subtitle,author_name,index_status,first_published_year,publish_date,cover_image_url,description,isbn_10,isbn_13,page_count,editorial_summary,best_for,meta_description,amazon_url,created_at,recommendation_count,author_catalog_slug,publisher,rating", "id"),
    "book_recommendations": ("id,book_id,person_id,source_url,source_name,quote,confidence_score", "id"),
    "book_lists": ("book_id,list_id,rank", "book_id,list_id"),
    "book_series": ("book_id,series_id,position", "book_id,series_id"),
    "book_authors": ("book_id,person_id", "book_id,person_id"),
    "people": ("id,slug,name,index_status", "id"),
    "lists": ("id,slug,index_status", "id"),
}
os.makedirs(os.path.join(HERE, "data"), exist_ok=True)
tables = sys.argv[1:] or list(cfg)
with ThreadPoolExecutor(7) as ex:
    list(ex.map(lambda t: fetch(t, *cfg[t]), tables))
