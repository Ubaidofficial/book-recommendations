-- Applied to production (project ghpdpvatfmvsahzsqgpp) via the Supabase MCP.
-- Kept here so the schema change and the data fill are reproducible.

alter table public.people add column if not exists twitter_handle text;
comment on column public.people.twitter_handle is
  'Official X/Twitter handle without @, lower case. Used to show a tweet as the source of a recommendation only when it comes from this account. NULL = unknown (tweet sources are then left as they are).';

-- Handles taken from the person profiles on readthistwice.com (schema.org sameAs).
-- Deliberately NOT filled: peter-thiel, charlie-munger, warren-buffett — no official
-- personal account, so the handle on that site is likely unofficial.
update public.people p set twitter_handle = v.h
from (values
  ('sahil-lavingia','shl'),('tim-ferriss','tferriss'),('patrick-collison','patrickc'),
  ('jordan-peterson','jordanbpeterson'),('oprah-winfrey','oprah'),('keith-rabois','rabois'),
  ('elon-musk','elonmusk'),('barack-obama','barackobama'),('ev-williams','ev'),
  ('derek-sivers','sivers'),('sam-altman','sama'),('paul-graham','paulg'),
  ('mark-zuckerberg','finkd'),('nassim-nicholas-taleb','nntaleb'),('malcolm-gladwell','gladwell'),
  ('nir-eyal','nireyal'),('alexis-ohanian','alexisohanian'),('bill-gates','billgates'),
  ('naval-ravikant','naval'),('marc-andreessen','pmarca'),('richard-branson','richardbranson'),
  ('joe-rogan','joerogan'),('jeff-bezos','jeffbezos'),('emma-watson','emmawatson')
) as v(s,h)
where p.slug = v.s and p.index_status = 'published';
