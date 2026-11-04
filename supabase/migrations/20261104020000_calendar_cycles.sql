-- Premium cycles follow the calendar, the same for everyone: day 1–14 and day 15–end of month (UTC).
-- A member is counted from the first day of the cycle they join in. Reaching 60,000$ early means
-- rest until the cycle ends (no extra rest days); the next cycle starts on its calendar date.
-- Missing the target still gets the 24h grace day (the next cycle's first day), then a kick review.

create function public.cycle_start_of(p_day date) returns date
language sql immutable
set search_path = ''
as $$
  select make_date(extract(year from p_day)::int, extract(month from p_day)::int,
                   case when extract(day from p_day) < 15 then 1 else 15 end)
$$;

create function public.cycle_end_of(p_day date) returns date
language sql immutable
set search_path = ''
as $$
  select case
           when extract(day from p_day) < 15
             then make_date(extract(year from p_day)::int, extract(month from p_day)::int, 14)
           else (make_date(extract(year from p_day)::int, extract(month from p_day)::int, 1)
                 + interval '1 month')::date - 1
         end
$$;

-- New memberships start in the cycle that contains the join day.
alter table public.memberships
  alter column first_cycle_start set default public.cycle_start_of(public.utc_today());
alter table public.premium_cycles alter column rest_days set default 0;

-- Align rows created under the old rule (cycle started on the join day).
update public.memberships
   set first_cycle_start = public.cycle_start_of(first_cycle_start)
 where first_cycle_start <> public.cycle_start_of(first_cycle_start);
delete from public.premium_cycles
 where result = 'open' and start_day <> public.cycle_start_of(start_day);

create or replace function public.evaluate_premium_cycles(p_through date default public.utc_today() - 1)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  m         record;
  c         public.premium_cycles%rowtype;
  r         record;
  v_start   date;
  v_last    date;
  v_cum     numeric(20, 2);
  v_met     date;
  v_flagged integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('public.evaluate_premium_cycles')) then
    raise exception 'evaluate_premium_cycles is already running';
  end if;

  for m in
    select ms.id, ms.first_cycle_start, mb.bingx_uid
      from public.memberships ms
      join public.members mb on mb.id = ms.member_id
     where ms.status = 'active'
  loop
    loop
      select * into c from public.premium_cycles
       where membership_id = m.id order by cycle_index desc limit 1;

      if not found then
        v_start := public.cycle_start_of(m.first_cycle_start);
        insert into public.premium_cycles (membership_id, cycle_index, start_day, cycle_days, rest_days)
        values (m.id, 1, v_start, public.cycle_end_of(v_start) - v_start + 1, 0)
        returning * into c;
      elsif c.result <> 'open' then
        -- The next cycle exists from its first day on (p_through + 1 is "today").
        exit when c.next_start_day is null or c.next_start_day > p_through + 1;
        v_start := public.cycle_start_of(c.next_start_day);
        insert into public.premium_cycles (membership_id, cycle_index, start_day, cycle_days, rest_days)
        values (m.id, c.cycle_index + 1, v_start, public.cycle_end_of(v_start) - v_start + 1, 0)
        returning * into c;
      end if;

      exit when c.start_day > p_through;

      -- Count through the grace day (end_day + 1) at most.
      v_last := least(p_through, c.end_day + 1);
      v_cum := 0;
      v_met := null;
      for r in
        select day, crypto_futures_volume as vol
          from public.daily_volumes
         where bingx_uid = m.bingx_uid and day between c.start_day and v_last
         order by day
      loop
        v_cum := v_cum + r.vol;
        if v_cum >= c.target_usd then
          v_met := r.day;
          exit;
        end if;
      end loop;

      if v_met is not null then
        update public.premium_cycles
           set result = case when v_met <= c.end_day then 'met' else 'met_in_grace' end::public.cycle_result,
               met_day = v_met,
               counted_volume = v_cum,
               evaluated_through = v_met,
               settled_at = now(),
               next_start_day = c.end_day + 1
         where id = c.id;
        -- loop again: the next cycle may already have started
      elsif v_last >= c.end_day + 1 then
        update public.premium_cycles
           set result = 'failed', counted_volume = v_cum, evaluated_through = v_last, settled_at = now()
         where id = c.id;
        insert into public.kick_reviews (cycle_id) values (c.id);
        update public.memberships set status = 'warned', warned_at = now() where id = m.id;
        v_flagged := v_flagged + 1;
        exit;
      else
        update public.premium_cycles
           set counted_volume = v_cum, evaluated_through = v_last
         where id = c.id;
        exit;
      end if;
    end loop;
  end loop;

  return v_flagged;
end $$;

-- rejected → the member stays and continues from the calendar cycle that contains today.
create or replace function public.kick_review_apply() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_membership bigint;
begin
  if old.decision <> 'pending' or new.decision = 'pending' then
    return null;
  end if;
  select membership_id into v_membership from public.premium_cycles where id = new.cycle_id;

  if new.decision = 'approved' then
    update public.memberships set status = 'kicked', ended_at = new.decided_at where id = v_membership;
  else
    update public.memberships set status = 'active', warned_at = null where id = v_membership;
    update public.premium_cycles
       set next_start_day = public.cycle_start_of(greatest(public.utc_today(), end_day + 1))
     where id = new.cycle_id;
  end if;
  return null;
end $$;

comment on table public.premium_cycles is
  'Chu kỳ Premium theo lịch: ngày 1–14 và 15–cuối tháng, cần 60.000$ crypto futures, +1 ngày ân hạn.';

revoke execute on function public.cycle_start_of(date) from public, anon, authenticated;
revoke execute on function public.cycle_end_of(date) from public, anon, authenticated;
grant execute on function public.cycle_start_of(date) to service_role;
grant execute on function public.cycle_end_of(date) to service_role;

notify pgrst, 'reload schema';
