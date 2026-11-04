-- Reminder email when 3 days are left in the cycle (was 5): sent once per cycle, on the first morning
-- with 1–3 days left (normally the 12th for the 1–14 cycle; the 28th of a 30-day month).

create or replace function public.cycle_notices(p_today date default public.utc_today())
returns table (
  member_id   bigint,
  email       text,
  bingx_uid   bigint,
  kind        text,
  cycle_index integer,
  start_day   date,
  end_day     date,
  counted     numeric,
  target      numeric
)
language sql
stable
set search_path = ''
as $$
  select n.member_id, n.email, n.bingx_uid, n.kind, n.cycle_index, n.start_day, n.end_day, n.counted, n.target
    from (
      select mb.id as member_id, mb.email, mb.bingx_uid,
             case when pc.end_day = p_today - 1 then 'cycle_grace' else 'cycle_warning' end as kind,
             pc.cycle_index, pc.start_day, pc.end_day, pc.counted_volume as counted, pc.target_usd as target
        from public.premium_cycles pc
        join public.memberships ms on ms.id = pc.membership_id and ms.status = 'active'
        join public.members mb on mb.id = ms.member_id
       where pc.result = 'open'
         and pc.counted_volume < pc.target_usd
         and (pc.end_day = p_today - 1 or pc.end_day - p_today + 1 between 1 and 3)
    ) n
   where not exists (
     select 1 from public.email_deliveries d
      where d.member_id = n.member_id and d.kind = n.kind and d.send_day = n.start_day
   )
$$;

notify pgrst, 'reload schema';
