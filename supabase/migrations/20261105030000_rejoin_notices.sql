-- People removed from the group can earn their way back: crypto-futures volume is added up from the
-- day after the kick. Once it reaches the target they are emailed once, inviting them to message the
-- admin, and the admin page marks them. Coming back still goes through the usual link and approval.
-- Safe to run while the current site is live: nothing calls this until the new code is deployed.

alter table public.email_deliveries drop constraint email_deliveries_kind_check;
alter table public.email_deliveries
  add constraint email_deliveries_kind_check
  check (kind in ('daily_calendar', 'cycle_warning', 'cycle_grace', 'rejoin_ready'));

-- One row per person currently out of the group. Someone who has linked again has an open membership
-- and is no longer listed. Volume days are BingX's UTC days, complete through yesterday.
create function public.kicked_progress(p_through date default public.utc_today() - 1)
returns table (
  member_id    bigint,
  email        text,
  bingx_uid    bigint,
  kicked_on    date,
  volume_since numeric,
  target       numeric,
  notified     boolean
)
language sql
stable
set search_path = ''
as $$
  select mb.id,
         mb.email,
         mb.bingx_uid,
         k.kicked_on,
         coalesce((select sum(v.crypto_futures_volume)
                     from public.daily_volumes v
                    where v.bingx_uid = mb.bingx_uid
                      and v.day > k.kicked_on
                      and v.day <= p_through), 0),
         coalesce((select pc.target_usd
                     from public.premium_cycles pc
                    where pc.membership_id = ms.id
                    order by pc.cycle_index desc
                    limit 1), 68686),
         exists (select 1
                   from public.email_deliveries d
                  where d.member_id = mb.id and d.kind = 'rejoin_ready' and d.send_day = k.kicked_on)
    from public.memberships ms
    join public.members mb on mb.id = ms.member_id
   cross join lateral (select (ms.ended_at at time zone 'UTC')::date as kicked_on) k
   where ms.status = 'kicked'
     and not exists (select 1
                       from public.memberships o
                      where o.member_id = ms.member_id
                        and (o.status <> 'kicked' or o.ended_at > ms.ended_at))
$$;

revoke execute on function public.kicked_progress(date) from public, anon, authenticated;
grant execute on function public.kicked_progress(date) to service_role;

notify pgrst, 'reload schema';
