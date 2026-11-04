-- Hardening and notifications:
--  * auth_start also limits codes per IP (10/hour), not only per Gmail (5/hour).
--  * Sessions last 7 days.
--  * cycle_notices(): members to warn by email (5 days left / grace day), once per cycle.
--  * pending_kick_reviews: what the admin is emailed about every morning.

alter table public.member_sessions alter column expires_at set default now() + interval '7 days';

alter table public.email_deliveries drop constraint email_deliveries_kind_check;
alter table public.email_deliveries
  add constraint email_deliveries_kind_check check (kind in ('daily_calendar', 'cycle_warning', 'cycle_grace'));
comment on column public.email_deliveries.send_day is
  'daily_calendar: ngày gửi. cycle_warning / cycle_grace: ngày bắt đầu chu kỳ (mỗi chu kỳ gửi tối đa 1 lần).';

-- Returns 'ok' | 'not_invitee' | 'email_taken' | 'uid_taken' | 'rate_limited' | 'rate_limited_ip'.
create or replace function public.auth_start(p_uid bigint, p_email text, p_code_hash bytea, p_ip inet default null)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_row record;
begin
  if not exists (select 1 from public.bingx_invitees where uid = p_uid) then
    return 'not_invitee';
  end if;

  -- 1 UID = 1 Gmail.
  select bingx_uid into v_row from public.member_overview where email = p_email;
  if found and v_row.bingx_uid <> p_uid then
    return 'email_taken';
  end if;
  -- The UID keeps its Gmail, unless its last membership was kicked (then it may re-join with a new one).
  select email, status into v_row from public.member_overview where bingx_uid = p_uid;
  if found and v_row.email <> p_email and v_row.status is distinct from 'kicked' then
    return 'uid_taken';
  end if;

  if (select count(*) from public.email_verifications
       where email = p_email and created_at > now() - interval '1 hour') >= 5 then
    return 'rate_limited';
  end if;
  if p_ip is not null and (select count(*) from public.email_verifications
       where request_ip = p_ip and created_at > now() - interval '1 hour') >= 10 then
    return 'rate_limited_ip';
  end if;

  insert into public.email_verifications (bingx_uid, email, code_hash, request_ip)
  values (p_uid, p_email, p_code_hash, p_ip);
  return 'ok';
end $$;

-- Open cycles still below target that need an email today (p_today = the UTC day of the sync):
--   cycle_grace   — the cycle ended yesterday, today is the 24h grace day;
--   cycle_warning — 1 to 5 days left, including today.
-- Each kind is sent at most once per cycle (email_deliveries, send_day = cycle start).
create function public.cycle_notices(p_today date default public.utc_today())
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
         and (pc.end_day = p_today - 1 or pc.end_day - p_today + 1 between 1 and 5)
    ) n
   where not exists (
     select 1 from public.email_deliveries d
      where d.member_id = n.member_id and d.kind = n.kind and d.send_day = n.start_day
   )
$$;

create view public.pending_kick_reviews with (security_invoker = true) as
select kr.id         as review_id,
       kr.created_at,
       mb.bingx_uid,
       mb.email,
       pc.cycle_index,
       pc.start_day,
       pc.end_day,
       pc.counted_volume,
       pc.target_usd
  from public.kick_reviews kr
  join public.premium_cycles pc on pc.id = kr.cycle_id
  join public.memberships ms on ms.id = pc.membership_id
  join public.members mb on mb.id = ms.member_id
 where kr.decision = 'pending'
 order by kr.created_at;

revoke all on public.pending_kick_reviews from anon, authenticated;
grant select on public.pending_kick_reviews to service_role;
revoke execute on function public.cycle_notices(date) from public, anon, authenticated;
grant execute on function public.cycle_notices(date) to service_role;

notify pgrst, 'reload schema';
