import sys, json, random, os
D=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,D)
exec(open(D+'/recheck.py').read().split("# previous strict results")[0])
import find_primary_sources as fps
L=json.load(open(OUT+'/listed_rows.json'))
random.seed(13)
def cards_for(x):
    b=books[recs[x['rec_id']]['book_id']]; prof=set(x['profile_handles'].split(';'))
    out=[]
    for s in filter(None,x['mrb_match'].split(';')):
        if s in mrb_pages: out+=[('mrb',c) for c in mrb_pages[s]['cards'] if book_on([c],b)]
    for s in filter(None,x['rtt_match'].split(';')):
        if s in rtt_people: out+=[('rtt',c) for c in rtt_people[s]['cards'] if book_on([c],b)]
    return [(site,c) for site,c in out if any((fps.handle_of(u) or '').lower() in prof for u in c['links'] if 'twitter.com' in u or 'x.com' in u)]
for cat,n in [('own_tweet_text_names_book',14),('own_tweet',12)]:
    print('#####',cat)
    for x in random.sample([y for y in L if y['best']==cat],n):
        cs=cards_for(x)
        site,c=cs[0]
        tw=[u for u in c['links'] if 'twitter.com' in u or 'x.com' in u][0]
        print(f"- {x['person']} | {x['book']} ({x['author']}) | page-title: {c['title']} by {c['author']} | {tw}\n    text: {(c.get('quote') or '')[:230]!r}")
