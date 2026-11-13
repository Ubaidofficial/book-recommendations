import sys, json, os, re, hashlib, collections, datetime, csv
D=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,D)
exec(open(D+'/recheck.py').read().split("# previous strict results")[0])
import find_primary_sources as fps
L=[x for x in json.load(open(OUT+'/listed_rows.json')) if x['best'] in ('own_tweet_text_names_book','own_tweet')]
fresh={r['id']:r for r in fps.sb_read_ids('book_recommendations','id,person_id,book_id,source_url,quote',[x['rec_id'] for x in L])}
yrs={b['id']:b.get('first_published_year') for b in fps.sb_read_ids('books','id,first_published_year',list({r['book_id'] for r in fresh.values()}))}
def tdate(u):
    m=re.search(r'/status/(\d+)',u); i=int(m.group(1))
    if i<30000000000: return None  # pre-snowflake (before Nov 2010)
    return datetime.datetime.utcfromtimestamp(((i>>22)+1288834974657)/1000)
def clean(u):
    m=re.match(r'https?://(?:www\.|mobile\.)?(twitter\.com|x\.com)/([A-Za-z0-9_]{1,15})/status/(\d+)',u)
    return f"https://{m.group(1)}/{m.group(2)}/status/{m.group(3)}" if m else None
c=collections.Counter(); payload=[]
for x in L:
    r=fresh.get(x['rec_id'])
    if not r: c['gone']+=1; continue
    b=books[r['book_id']]; prof=set(x['profile_handles'].split(';'))-{''}
    best=None
    for src,pages in (('mrb',mrb_pages),('rtt',rtt_people)):
        for s in filter(None,x[src+'_match'].split(';')):
            if s not in pages: continue
            for cd in pages[s]['cards']:
                if not book_on([cd],b): continue
                names=fps.title_in(fps.norm_title(b['title']), fps.norm_text(cd.get('quote') or '')) if cd.get('quote') else False
                for u in cd['links']:
                    cu=clean(u) if ('twitter.com' in u or 'x.com' in u) else None
                    if cu and (fps.handle_of(u) or '').lower() in prof:
                        cand=(1 if names else 0, cu)
                        if best is None or cand>best: best=cand
    if not best: c['no_tweet']+=1; continue
    if (r['source_url'] or '')==best[1]: c['already_written']+=1; continue
    td=tdate(best[1]); y=yrs.get(r['book_id'])
    if td and y and td.year < int(y)-1: c['tweet_older_than_book']+=1; continue
    snap=hashlib.md5(((r['source_url'] or '')+'|'+(r['quote'] or '')).encode()).hexdigest()
    payload.append((r['id'],snap,best[1],'tweet_text_names_book' if best[0] else 'own_tweet'))
    c['ok_'+('names' if best[0] else 'plain')]+=1
print(c, len(payload))
json.dump(payload,open(OUT+'/payload.json','w'))
def sql(rows,batch):
    vals=',\n'.join(f"('{i}'::uuid,'{s}','{u}','{k}')" for i,s,u,k in rows)
    chk=hashlib.md5(','.join(f"{i}|{s}|{u}" for i,s,u,k in sorted(rows)).encode()).hexdigest()
    return f"""with v(id,snap,nu,kind) as (values
{vals}),
chk as (select md5(string_agg(id::text||'|'||snap||'|'||nu, ',' order by id::text collate "C"))='{chk}' good from v),
ok as (select r.*, v.nu, v.kind from public.book_recommendations r join v on v.id=r.id
       where (select good from chk) and md5(coalesce(r.source_url,'')||'|'||coalesce(r.quote,''))=v.snap
       and not exists (select 1 from public.bak_recs_primary_sources_20261112 b where b.id=r.id)),
ins as (insert into public.bak_recs_primary_sources_20261112(id,book_id,person_id,source_url,source_name,quote,confidence_score,new_source_url,new_source_name,new_quote,new_confidence_score,evidence_strength,batch,backed_up_at)
        select id,book_id,person_id,source_url,source_name,quote,confidence_score,nu,null,null,60,'index_own_tweet:'||kind,'{batch}',now() from ok on conflict (id) do nothing returning id),
upd as (update public.book_recommendations r set source_url=ok.nu, source_name=null, quote=null, confidence_score=60
        from ok where r.id=ok.id and r.id in (select id from ins) returning r.id)
select (select good from chk) checksum_ok,(select count(*) from v) given,(select count(*) from ok) matched,(select count(*) from ins) backed_up,(select count(*) from upd) updated;"""
TAG=sys.argv[2] if len(sys.argv)>2 else 'index_tweets_20261113'  # batch label prefix in the backup table
os.makedirs(OUT+'/batches',exist_ok=True)
payload.sort(key=lambda p:p[0])
chunks=([payload[:10]]+[payload[i:i+200] for i in range(10,len(payload),200)]) if payload else []
for n,ch in enumerate(chunks):
    open(OUT+f'/batches/b{n:02d}.sql','w').write(sql(ch,f'{TAG}_b{n:02d}'))
print('batches',len(chunks),[len(c) for c in chunks])
