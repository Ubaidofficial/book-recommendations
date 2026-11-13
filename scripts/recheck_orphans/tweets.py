import sys, json, re, collections, os, csv
D=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,D)
exec(open(D+'/recheck.py').read().split("# previous strict results")[0])   # reuse loaders
import find_primary_sources as fps
handles_known={}

hm=fps.load_house_maps()
slug_handles=collections.defaultdict(set)
for h,sl in hm[0].items(): slug_handles[sl].add(h.lower())
deny=hm[1]
per=json.load(open(D+'/per_row.json'))
done_ids=set()
for f in ['/home/user/book-recommendations/.claude/worktrees/agent-aedf84a0558ba70ab/reports/already_written_ids_20261112.json']:
    try: done_ids|=set(json.load(open(f)))
    except Exception as e: print('ids',e)
pp=fps.sb_read_ids('people','id,slug,twitter_handle',list({recs[x['rec_id']]['person_id'] for x in per}))
tw={p['slug']:(p.get('twitter_handle') or '').lower().lstrip('@') for p in pp}
c=collections.Counter(); out=[]
for x in per:
    if not (x['book_on_mrb'] or x['book_on_rtt']): continue
    b=books[recs[x['rec_id']]['book_id']]
    cards=[]; prof=set()
    for s in filter(None,x['mrb_match'].split(';')):
        if s in mrb_pages:
            prof|=mrb_pages[s]['profile_handles']; cards+=[('mrb',cd) for cd in mrb_pages[s]['cards'] if book_on([cd],b)]
    for s in filter(None,x['rtt_match'].split(';')):
        if s in rtt_people:
            if rtt_people[s]['twitter']: prof.add(rtt_people[s]['twitter'])
            cards+=[('rtt',cd) for cd in rtt_people[s]['cards'] if book_on([cd],b)]
    if tw.get(x['person_slug']): prof.add(tw[x['person_slug']])
    prof|=slug_handles.get(x['person_slug'],set()); prof-=deny
    best='no_link'
    for site,cd in cards:
        for u in cd['links']:
            h=fps.handle_of(u) if 'twitter.com' in u or 'x.com' in u else None
            if h:
                if h.lower() in prof:
                    qn=fps.norm_text(cd.get('quote') or '')
                    names=fps.title_in(fps.norm_title(b['title']), qn) if qn else False
                    best='own_tweet_text_names_book' if names else ('own_tweet' if best not in ('own_tweet_text_names_book',) else best)
                elif best=='no_link': best='tweet_other_or_unknown_account'
            elif best=='no_link': best='non_tweet_link'
    if not cards: best='card_not_found'
    c[best]+=1
    out.append(dict(x, best=best, profile_handles=';'.join(sorted(prof))))
print(c)
json.dump(out,open(D+'/listed_rows.json','w'))
