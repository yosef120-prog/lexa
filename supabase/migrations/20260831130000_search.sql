-- Stage 9: one search box over the whole firm.
--
-- The brief asks for client name, matter name, national id and the נט case
-- number. Those live in three tables, and a lawyer typing a name does not know
-- or care which — so this answers from all of them at once, ranked so the
-- strongest kind of match comes first.
--
-- Runs as the caller, not as definer: search must never reach past the firm,
-- and letting RLS do that is safer than a filter this function could forget.

create or replace function public.search_firm(q text)
returns table (
  kind        text,   -- client | matter | party
  id          uuid,   -- the row itself
  title       text,
  subtitle    text,
  matter_id   uuid,   -- where to navigate, when there is somewhere
  ref_no      integer,
  rank        integer -- lower sorts first
)
language sql
stable
set search_path = public, pg_temp
as $$
  with input as (
    select
      nullif(btrim(coalesce(q, '')), '')                                   as text_q,
      nullif(regexp_replace(coalesce(q, ''), '\D', '', 'g'), '')           as digits_q
  )
  -- Matters, by name, by נט number, or by the firm's own reference.
  select 'matter', m.id, m.name,
         coalesce(c.name, '') ||
           case when m.court_case_no is not null then ' · ' || m.court_case_no else '' end,
         m.id, m.ref_no,
         case
           when i.digits_q is not null and m.ref_no::text = i.digits_q then 0
           when m.court_case_no ilike '%' || i.text_q || '%'           then 1
           else 2
         end
  from public.matters m
  left join public.clients c on c.id = m.client_id
  cross join input i
  where m.deleted_at is null
    and (
      (i.text_q is not null and (m.name ilike '%' || i.text_q || '%'
                             or m.court_case_no ilike '%' || i.text_q || '%'))
      or (i.digits_q is not null and m.ref_no::text = i.digits_q)
    )

  union all

  -- Clients, by name or identifier. An exact identifier is the surest match
  -- there is, so it outranks everything.
  select 'client', c.id, c.name,
         coalesce(c.national_id, '') ||
           case when c.phone is not null then ' · ' || c.phone else '' end,
         null::uuid, null::integer,
         case when i.digits_q is not null and c.national_id_digits = i.digits_q then 0 else 2 end
  from public.clients c
  cross join input i
  where c.deleted_at is null
    and (
      (i.text_q is not null and c.name ilike '%' || i.text_q || '%')
      or (i.digits_q is not null and c.national_id_digits = i.digits_q)
    )

  union all

  -- Parties, which is how a firm finds the file someone appears in without
  -- being the client.
  select 'party', p.id, p.name,
         case p.side
           when 'opposing' then 'צד שכנגד'
           when 'client'   then 'לקוח בתיק'
           else 'צד נוסף'
         end || ' · ' || m.name,
         m.id, m.ref_no,
         case when i.digits_q is not null and p.national_id_digits = i.digits_q then 0 else 3 end
  from public.matter_parties p
  join public.matters m on m.id = p.matter_id and m.deleted_at is null
  cross join input i
  where (
      (i.text_q is not null and p.name ilike '%' || i.text_q || '%')
      or (i.digits_q is not null and p.national_id_digits = i.digits_q)
    )

  order by 7, 3
  limit 40;
$$;

revoke all on function public.search_firm(text) from public;
grant execute on function public.search_firm(text) to authenticated;

-- Matching is by prefix and substring on names, so an index on the lowered
-- value is what the planner can actually use once a firm has real volume.
create index if not exists clients_name_lower_idx on public.clients (lower(name))
  where deleted_at is null;
create index if not exists matters_name_lower_idx on public.matters (lower(name))
  where deleted_at is null;
create index if not exists matter_parties_name_lower_idx on public.matter_parties (lower(name));
