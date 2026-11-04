-- Admin report for one calendar cycle (sent on the 1st and the 15th for the cycle that just ended).
-- One row per UID: every member whose membership overlapped the cycle (even with 0 volume), plus every
-- partner-link invitee who traded in the cycle but never linked the website. Volume is crypto futures
-- (perpetual − TradFi) summed over the whole cycle.

create function public.cycle_report(p_start date, p_end date)
returns table (
  uid           bigint,
  email         text,
  member_status public.member_status,
  joined_at     timestamptz,
  volume        numeric,
  trade_days    integer
)
language sql
stable
set search_path = ''
as $$
  with mem as (
    -- Latest membership per member that was open at some point during the cycle.
    select distinct on (ms.member_id)
           mb.bingx_uid, mb.email, ms.status, ms.joined_at
      from public.memberships ms
      join public.members mb on mb.id = ms.member_id
     where (ms.joined_at at time zone 'utc')::date <= p_end
       and (ms.ended_at is null or (ms.ended_at at time zone 'utc')::date >= p_start)
     order by ms.member_id, ms.joined_at desc
  ),
  vol as (
    select d.bingx_uid,
           sum(d.crypto_futures_volume) as total,
           (count(*) filter (where d.crypto_futures_volume > 0))::integer as days
      from public.daily_volumes d
     where d.day between p_start and p_end
     group by d.bingx_uid
  )
  select coalesce(mem.bingx_uid, vol.bingx_uid),
         mem.email,
         mem.status,
         mem.joined_at,
         coalesce(vol.total, 0),
         coalesce(vol.days, 0)
    from mem
    full join vol on vol.bingx_uid = mem.bingx_uid
   where mem.bingx_uid is not null or vol.total > 0
   order by coalesce(vol.total, 0) desc
$$;

revoke execute on function public.cycle_report(date, date) from public, anon, authenticated;
grant execute on function public.cycle_report(date, date) to service_role;

notify pgrst, 'reload schema';
