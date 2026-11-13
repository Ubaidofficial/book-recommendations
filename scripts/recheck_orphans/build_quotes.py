"""Quote = the index's copy of the person's own tweet, for rows written by build.py
whose tweet text names the book (kind tweet_text_names_book). Confidence 70 so the
display gate (>= 70, >= 50 chars, single source) shows it. Guard: the row must still
carry exactly that tweet URL with an empty quote."""
import sys, json, os, re, hashlib
D=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,D)
exec(open(D+'/recheck.py').read().split("# previous strict results")[0])
import find_primary_sources as fps
OUTD=OUT  # set from the output-dir argument by recheck.py's loader
payload=[p for p in json.load(open(OUTD+'/payload.json')) if p[3]=='tweet_text_names_book']
def tid(u): m=re.search(r'/status/(\d+)',u); return m.group(1) if m else None
by_tid={}
for pages in (mrb_pages, rtt_people):
    for pg in pages.values():
        for cd in pg['cards']:
            for u in cd['links']:
                t=tid(u)
                if t and cd.get('quote'): by_tid.setdefault(t, cd['quote'])
rows=[]
for rid,snap,url,kind in payload:
    q=(by_tid.get(tid(url)) or '').strip()
    if not q: continue
    q=re.sub(r'\s+\n','\n',q)
    rows.append((rid,url,q))
print('quotes',len(rows),'of',len(payload),' >=50 chars:',sum(len(q)>=50 for _,_,q in rows))
import base64
def lit(s):
    # base64 keeps the statement pure ASCII: no-break spaces, curly quotes and
    # newlines in tweets cannot be altered on the way to the database.
    return "convert_from(decode('"+base64.b64encode(s.encode()).decode()+"','base64'),'UTF8')"
def sql(ch,batch):
    vals=',\n'.join(f"('{i}'::uuid,'{u}',{lit(q)})" for i,u,q in ch)
    chk=hashlib.md5(','.join(f"{i}|{u}|{hashlib.md5(q.encode()).hexdigest()}" for i,u,q in sorted(ch)).encode()).hexdigest()
    return f"""with v(id,url,q) as (values
{vals}),
chk as (select md5(string_agg(id::text||'|'||url||'|'||md5(q), ',' order by id::text collate "C"))='{chk}' good from v),
ok as (select r.id, v.q from public.book_recommendations r join v on v.id=r.id
       where (select good from chk) and r.source_url=v.url and r.quote is null and r.confidence_score=60),
bk as (update public.bak_recs_primary_sources_20261112 b set new_quote=ok.q, new_confidence_score=70, evidence_strength=b.evidence_strength||'+index_tweet_text'
       from ok where b.id=ok.id returning b.id),
upd as (update public.book_recommendations r set quote=ok.q, confidence_score=70 from ok where r.id=ok.id and r.id in (select id from bk) returning r.id)
select (select good from chk) checksum_ok,(select count(*) from v) given,(select count(*) from ok) matched,(select count(*) from bk) backup_rows_updated,(select count(*) from upd) updated;"""
os.makedirs(OUTD+'/quote_batches',exist_ok=True)
rows.sort()
chunks=[rows[:10]]+[rows[i:i+120] for i in range(10,len(rows),120)]
for n,ch in enumerate(chunks): open(OUTD+f'/quote_batches/q{n:02d}.sql','w').write(sql(ch,n))
print('batches',[len(c) for c in chunks])
