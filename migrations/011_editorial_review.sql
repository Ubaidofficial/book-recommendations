-- 011: human review of AI-written reader notes (2026-11-25)
--
-- Published book pages show AI-written reader notes (editorial_summary, best_for,
-- not_for, key_themes). Until a person reviews them they carry
-- ai_quality_status = 'draft' and the page labels them "not yet reviewed by an
-- editor". This adds a way for an editor to approve (optionally after editing),
-- reject, or reset them from the /admin/review page, using only the public key:
--
--   * review_book_notes() is SECURITY DEFINER and refuses every call that does
--     not carry a valid review key. Keys are stored only as SHA-256 hashes in
--     editorial_review_keys, which no public role can read.
--   * Every review writes the before and after values to editorial_review_log.
--   * books stays read-only for anon (RLS); this function is the only write path.
--
-- Create a key (keep the plain value private; only its hash is stored):
--   insert into public.editorial_review_keys (key_hash, label)
--   values (encode(extensions.digest('<random key>', 'sha256'), 'hex'), 'owner');
-- Revoke:  update public.editorial_review_keys set revoked_at = now() where label = 'owner';

alter table public.books add column if not exists ai_reviewed_at timestamptz;

create table if not exists public.editorial_review_keys (
  id          bigserial primary key,
  key_hash    text not null unique,
  label       text,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
alter table public.editorial_review_keys enable row level security;
revoke all on public.editorial_review_keys from anon, authenticated;

create table if not exists public.editorial_review_log (
  id          bigserial primary key,
  book_id     uuid not null references public.books(id) on delete cascade,
  action      text not null check (action in ('approve', 'reject', 'draft')),
  old_values  jsonb not null,
  new_values  jsonb not null,
  reviewed_at timestamptz not null default now()
);
alter table public.editorial_review_log enable row level security;
revoke all on public.editorial_review_log from anon, authenticated;

create or replace function public.editorial_review_key_ok(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.editorial_review_keys
    where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex')
      and revoked_at is null
  );
$$;

create or replace function public.review_book_notes(
  p_key        text,
  p_book_id    uuid,
  p_action     text,
  p_summary    text   default null,
  p_best_for   text[] default null,
  p_not_for    text[] default null,
  p_key_themes text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  b        public.books%rowtype;
  old_v    jsonb;
  new_v    jsonb;
  status   text;
begin
  if not public.editorial_review_key_ok(p_key) then
    raise exception 'invalid review key' using errcode = '28000';
  end if;
  if p_action not in ('approve', 'reject', 'draft') then
    raise exception 'action must be approve, reject or draft';
  end if;

  select * into b from public.books where id = p_book_id for update;
  if not found then
    raise exception 'book not found';
  end if;
  if b.index_status <> 'published' then
    raise exception 'only published books are reviewed here';
  end if;

  old_v := jsonb_build_object(
    'ai_quality_status', b.ai_quality_status, 'ai_reviewed_at', b.ai_reviewed_at,
    'editorial_summary', b.editorial_summary, 'best_for', b.best_for,
    'not_for', b.not_for, 'key_themes', to_jsonb(b.key_themes));

  status := case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'draft' end;

  -- Edits are only taken with an approval: a rejected note is hidden, not rewritten.
  update public.books set
    editorial_summary = case when p_action = 'approve' and p_summary is not null then nullif(btrim(p_summary), '') else editorial_summary end,
    best_for          = case when p_action = 'approve' and p_best_for is not null then to_jsonb(p_best_for)::text else best_for end,
    not_for           = case when p_action = 'approve' and p_not_for is not null then to_jsonb(p_not_for)::text else not_for end,
    key_themes        = case when p_action = 'approve' and p_key_themes is not null then p_key_themes else key_themes end,
    ai_quality_status = status,
    ai_reviewed_at    = case when p_action = 'draft' then null else now() end,
    updated_at        = now()
  where id = p_book_id
  returning jsonb_build_object(
    'ai_quality_status', ai_quality_status, 'ai_reviewed_at', ai_reviewed_at,
    'editorial_summary', editorial_summary, 'best_for', best_for,
    'not_for', not_for, 'key_themes', to_jsonb(key_themes)) into new_v;

  insert into public.editorial_review_log (book_id, action, old_values, new_values)
  values (p_book_id, p_action, old_v, new_v);

  return new_v;
end;
$$;

revoke all on function public.editorial_review_key_ok(text) from public;
revoke all on function public.review_book_notes(text, uuid, text, text, text[], text[], text[]) from public;
grant execute on function public.editorial_review_key_ok(text) to anon, authenticated;
grant execute on function public.review_book_notes(text, uuid, text, text, text[], text[], text[]) to anon, authenticated;
