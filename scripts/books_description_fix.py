#!/usr/bin/env python3
"""
2026-11-15: replace bad `books.description` on eight PUBLISHED books. Dry run unless --apply.

Found by scanning every published book's description: Spanish (Sapiens, Siddhartha, Tao Te Ching), Indonesian (Zero to One),
the wrong book (Dune carried the description of Heretics of Dune), a table of contents (Range), reader-review junk (Think and Grow Rich:
"EXTREMELY USEFULL! ...") and mojibake (Originals). The page hides "About the book" when the description is not usable, so these
pages had lost that section.

Five come from Open Library's English work description (title and author checked); three (Sapiens, Originals, Tao Te Ching) are
short neutral descriptions written for this site because the Open Library text was missing or edition-specific. Every change
writes old and new values to public.bak_seo_changes_20261114 first (batch below); undo with
  update books set description = <old_values.description> where id = row_id.
"""
from __future__ import annotations

import argparse
import json

import requests

BASE = "https://ghpdpvatfmvsahzsqgpp.supabase.co/rest/v1"
H = {"apikey": "dummy", "Authorization": "Bearer dummy", "Content-Type": "application/json"}
BATCH = "book_descriptions_20261115"
DESCRIPTIONS = {
 "dune-frank-herbert": "Set on the desert planet Arrakis, Dune is the story of the boy Paul Atreides, heir to a noble family tasked with ruling an inhospitable world where the only thing of value is the \"spice\" melange, a drug capable of extending life and enhancing consciousness. Coveted across the known universe, melange is a prize worth killing for...\r\n\r\nWhen House Atreides is betrayed, the destruction of Paul's family will set the boy on a journey toward a destiny greater than he could ever have imagined. And as he evolves into the mysterious man known as Muad'Dib, he will bring to fruition humankind's most ancient and unattainable dream.\r\n\r\nA stunning blend of adventure and mysticism, environmentalism and politics, Dune won the first Nebula Award, shared the Hugo Award, and formed the basis of what is undoubtedly the grandest epic in science fiction.",
 "siddhartha-hermann-hesse": "Hermann Hesse wrote Siddhartha after he traveled to India in the 1910s. It tells the story of a young boy who travels the country in a quest for spiritual enlightenment in the time of Guatama Buddha. It is a compact, lyrical work, which reads like an allegory about the finding of wisdom.",
 "zero-to-one-peter-thiel": "If you want to build a better future, you must believe in secrets.\r\n\r\nThe great secret of our time is that there are still uncharted frontiers to explore and new inventions to create. In Zero to One , legendary entrepreneur and investor Peter Thiel shows how we can find singular ways to create those new things. \r\n\r\nThiel begins with the contrarian premise that we live in an age of technological stagnation, even if we’re too distracted by shiny mobile devices to notice. Information technology has improved rapidly, but there is no reason why progress should be limited to computers or Silicon Valley. Progress can be achieved in any industry or area of business. It comes from the most important skill that every leader must master: learning to think for yourself.\r\n\r\nDoing what someone else already knows how to do takes the world from 1 to n, adding more of something familiar. But when you do something new, you go from 0 to 1. The next Bill Gates will not build an operating system. The next Larry Page or Sergey Brin won’t make a search engine. Tomorrow’s champions will not win by competing ruthlessly in today’s marketplace. They will escape competition altogether, because their businesses will be unique. \r\n\r\nZero to One presents at once an optimistic view of the future of progress in America and a new way of thinking about innovation: it starts by learning to ask the questions that lead you to find value in unexpected places.",
 "think-and-grow-rich-napoleon-hill": "Napoleon Hill's quintessential volume _Think and grow rich_, the all-time bestseller in the field of professional success, outlines the laws of success and sets the standard of today's motivational thinking.",
 "range-david-epstein": "What's the most effective path to success in any domain? It's not what you think. \r\n\r\nPlenty of experts argue that anyone who wants to develop a skill, play an instrument, or lead their field should start early, focus intensely, and rack up as many hours of deliberate practice as possible. If you dabble or delay, you'll never catch up to the people who got a head start. But a closer look at research on the world's top performers, from professional athletes to Nobel laureates, shows that early specialization is the exception, not the rule.\r\n\r\nDavid Epstein examined the world's most successful athletes, artists, musicians, inventors, forecasters and scientists. He discovered that in most fields--especially those that are complex and unpredictable--generalists, not specialists, are primed to excel. Generalists often find their path late, and they juggle many interests rather than focusing on one. They're also more creative, more agile, and able to make connections their more specialized peers can't see.\r\n\r\nProvocative, rigorous, and engrossing, *Range* makes a compelling case for actively cultivating inefficiency. Failing a test is the best way to learn. Frequent quitters end up with the most fulfilling careers. The most impactful inventors cross domains rather than deepening their knowledge in a single area. As experts silo themselves further while computers master more of the skills once reserved for highly focused humans, people who think broadly and embrace diverse experiences and perspectives will increasingly thrive.",
 "sapiens-yuval-noah-harari": "A history of the human species, from the Stone Age to the present, by the historian Yuval Noah Harari. It traces how Homo sapiens came to dominate the planet through the Cognitive, Agricultural and Scientific Revolutions, and asks how shared stories such as money, religion and nations let large numbers of strangers cooperate. First published in Hebrew in 2011 and in English in 2014.",
 "originals-adam-grant": "A 2016 book by the Wharton organizational psychologist Adam Grant on how people come up with and champion new ideas. Drawing on research and stories from business, politics, sport and entertainment, it looks at why original thinkers procrastinate, doubt and fail as often as anyone else, and how to spot good ideas and push them forward.",
 "tao-te-ching-lao-tzu": "A short Chinese classic of about 81 brief chapters, traditionally attributed to Lao Tzu and written more than 2,000 years ago. It is a foundational text of Taoism, and speaks of the Tao, often translated as \"the Way\", and of governing and living simply and without force. Translations vary widely in wording and emphasis."
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    done = 0
    for slug, text in DESCRIPTIONS.items():
        rows = requests.get(f"{BASE}/books", params={"select": "id,slug,description", "slug": f"eq.{slug}"}, headers=H, timeout=60).json()
        if not rows:
            print("missing:", slug)
            continue
        row = rows[0]
        if row["description"] == text:
            continue
        print(f"{slug}: {len(row['description'] or '')} -> {len(text)} chars")
        if not args.apply:
            continue
        b = requests.post(f"{BASE}/bak_seo_changes_20261114", headers={**H, "Prefer": "return=minimal"}, timeout=60,
                          json={"table_name": "books", "row_id": row["id"], "slug": slug, "old_values": {"description": row["description"]}, "new_values": {"description": text}, "batch": BATCH})
        if b.status_code not in (200, 201):
            print("  BACKUP FAILED, not changing", slug, b.status_code, b.text[:150])
            continue
        u = requests.patch(f"{BASE}/books", params={"id": f"eq.{row['id']}"}, headers={**H, "Prefer": "return=minimal"}, json={"description": text}, timeout=60)
        print("  ", "updated" if u.status_code in (200, 204) else f"FAILED {u.status_code} {u.text[:120]}")
        done += u.status_code in (200, 204)
    print(json.dumps({"mode": "APPLY" if args.apply else "DRY RUN", "updated": done}))


if __name__ == "__main__":
    main()
