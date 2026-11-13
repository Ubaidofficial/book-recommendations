import sys, csv, json, glob, re, collections, unicodedata, pickle, os
REPO='/home/user/book-recommendations'
sys.path.insert(0, REPO+'/scripts')
import find_primary_sources as fps
import rtt_primary_sources as rtt
OUT=os.path.dirname(os.path.abspath(__file__))
RTTC=REPO+'/reports/third_party_cache/readthistwice'
MRBC=REPO+'/reports/third_party_cache/mrb/mostrecommendedbooks.com'

def nfkd(s): return unicodedata.normalize('NFKD', s or '').encode('ascii','ignore').decode().lower()
def toks(s): return [t for t in re.split(r'[^a-z0-9]+', nfkd(s)) if t]
STOP={'jr','sr','dr','md','phd','ii','iii','the','mr','mrs','ms','sir'}
def namekeys(name):
    t=[x for x in toks(name) if x not in STOP]
    keys=set()
    if not t: return keys
    keys.add(''.join(t))
    if len(t)>=2: keys.add(t[0]+'|'+t[-1])
    return keys
def tnorm(t):
    t=nfkd(t); t=re.split(r'[:(\[]| - | — ',t)[0]
    t=re.sub(r'^(the|a|an)\s+','',t.strip()); return ' '.join(toks(t))

# orphan rows
plan=[r for r in csv.DictReader(open(REPO+'/reports/quote_reattribution_plan.csv')) if r['action']=='ORPHANED_OWNER']
ids=sorted({r['row_id'] for r in plan}); print('orphan ids',len(ids))
cache=OUT+'/live.pkl'
if os.path.exists(cache): recs,people,books=pickle.load(open(cache,'rb'))
else:
    recs={r['id']:r for r in fps.sb_read_ids('book_recommendations','id,person_id,book_id,source_url,quote,confidence_score',ids)}
    pids=sorted({r['person_id'] for r in recs.values()}); bids=sorted({r['book_id'] for r in recs.values()})
    people={p['id']:p for p in fps.sb_read_ids('people','id,name,slug,index_status',pids)}
    books={b['id']:b for b in fps.sb_read_ids('books','id,title,author_name,slug,index_status',bids)}
    pickle.dump((recs,people,books),open(cache,'wb'))
print('live recs',len(recs),'people',len(people),'books',len(books))

# MRB sitemap + pages
mrb_slugs=set(); mrb_pages={}
for p in glob.glob(MRBC+'/*.json'):
    d=json.load(open(p)); u=d.get('final_url') or ''
    if u.endswith('/people/sitemap.xml'):
        mrb_slugs|=set(re.findall(r'/people/([a-z0-9-]+)-recommended-books', d.get('text','')))
    elif '-recommended-books' in u:
        s=re.search(r'/people/([a-z0-9-]+)-recommended-books',u).group(1)
        mrb_pages[s]=fps.parse_mrb_person(d.get('text',''))
print('MRB people in sitemap',len(mrb_slugs),'pages cached',len(mrb_pages))
mrb_key=collections.defaultdict(set)
for s in mrb_slugs:
    for k in namekeys(s.replace('-',' ')): mrb_key[k].add(s)
# RTT pages
rtt_people={}; rtt_slugs=set()
for p in glob.glob(RTTC+'/*.json'):
    d=json.load(open(p)); u=d.get('final_url') or d.get('url') or ''
    if u.endswith('/sitemap.xml'): rtt_slugs|=set(re.findall(r'/person/([a-z0-9-]+)</loc>', d.get('text','')))
    if u.endswith('/people'): rtt_slugs|=set(re.findall(r'href="/person/([a-z0-9-]+)"', d.get('text','')))
    m=re.search(r'/person/([a-z0-9-]+)$',u)
    if not m: continue
    try: pr=rtt.parse_rtt_person(d.get('text',''), m.group(1))
    except Exception as e: pr=None
    if pr: rtt_people[m.group(1)]=pr
print('RTT person pages parsed',len(rtt_people))
print('RTT people listed',len(rtt_slugs))
rtt_key=collections.defaultdict(set)
for s in rtt_slugs:
    for k in namekeys(s.replace('-',' ')): rtt_key[k].add(s)
for s,pr in rtt_people.items():
    for k in namekeys(pr['name'] or ''): rtt_key[k].add(s)

def book_on(cards, book):
    bt=tnorm(book['title']); 
    if not bt: return False
    for c in cards:
        ct=tnorm(c['title'])
        if ct and (ct==bt or (len(bt)>=8 and (bt in ct or ct in bt))): return True
    return False

# previous strict results
A=REPO+'/.claude/worktrees/agent-a805390d8bc11899a/reports'; B=REPO+'/.claude/worktrees/agent-aedf84a0558ba70ab/reports'
strict_book=set()
for f in [A+'/primary_source_candidates.csv',A+'/primary_source_rejected.csv',B+'/rtt_primary_source_candidates.csv',B+'/rtt_primary_source_rejected.csv']:
    strict_book|={r['rec_id'] for r in csv.DictReader(open(f))}
written=set()  # filled from json if present
st=collections.Counter(); per=[]
for rid in ids:
    r=recs.get(rid)
    if not r: st['row_gone']+=1; continue
    p=people.get(r['person_id']); b=books.get(r['book_id'])
    if not p or not b: st['person_or_book_gone']+=1; continue
    keys=namekeys(p['name'])|namekeys(p['slug'].replace('-',' '))
    ms=set().union(*[mrb_key.get(k,set()) for k in keys]) if keys else set()
    rs=set().union(*[rtt_key.get(k,set()) for k in keys]) if keys else set()
    mrb_fetched=[s for s in ms if s in mrb_pages]
    on_mrb=any(book_on(mrb_pages[s]['cards'],b) for s in mrb_fetched)
    rtt_fetched=[s for s in rs if s in rtt_people]
    on_rtt=any(book_on(rtt_people[s]['cards'],b) for s in rtt_fetched)
    per.append(dict(rec_id=rid, person=p['name'], person_slug=p['slug'], person_status=p['index_status'], book=b['title'], author=b['author_name'],
        mrb_match=';'.join(sorted(ms)), mrb_fetched=bool(mrb_fetched), rtt_fetched=bool(rtt_fetched), rtt_match=';'.join(sorted(rs)), book_on_mrb=on_mrb, book_on_rtt=on_rtt,
        strict_book_match=rid in strict_book, conf=r['confidence_score'], source_url=(r['source_url'] or '')[:200]))
json.dump(per, open(OUT+'/per_row.json','w'))
c=collections.Counter()
for x in per:
    has=bool(x['mrb_match'] or x['rtt_match'])
    c['person_on_any_site' if has else 'person_on_no_site']+=1
    if x['mrb_match'] and not x['mrb_fetched']: c['mrb_page_exists_not_fetched']+=1
    if x['book_on_mrb'] or x['book_on_rtt']: c['book_listed_on_a_site']+=1
    if x['rtt_match'] and not x['rtt_fetched']: c['rtt_page_exists_not_fetched']+=1
    if (x['mrb_match'] and not x['mrb_fetched']) or (x['rtt_match'] and not x['rtt_fetched']): c['some_page_not_fetched']+=1
    if (x['book_on_mrb'] or x['book_on_rtt']) and not x['strict_book_match']: c['book_listed_but_strict_missed']+=1
print(st, c)
