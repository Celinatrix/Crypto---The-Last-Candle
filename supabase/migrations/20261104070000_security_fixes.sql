-- Security audit fixes (database side)
--  V-01  UID ownership: a new link (or a re-join after a kick) waits for the admin. Until
--        members.approved is ticked the member sees no volume, has no cycles and gets no email.
--  V-03  Partner-link UID enumeration: failed UID lookups count toward the per-IP limit (10/hour),
--        checked before anything else; UIDs BingX said "no" to are remembered for an hour.
--  V-05  Email length capped at 254 characters.

-- ---------------------------------------------------------------------------------------------
-- V-05
-- ---------------------------------------------------------------------------------------------
alter table public.members add constraint members_email_length check (char_length(email) <= 254);
alter table public.email_verifications add constraint email_verifications_email_length check (char_length(email) <= 254);

-- ---------------------------------------------------------------------------------------------
-- V-01: admin approval
-- ---------------------------------------------------------------------------------------------
alter table public.members
  add column approved    boolean not null default false,
  add column approved_at timestamptz,
  add column approved_by text;
comment on column public.members.approved is
  'Admin tick ô này để duyệt UID ↔ Gmail. Chưa duyệt: không xem được volume, không tính chu kỳ, không nhận email.';

-- Members linked before this change were set up by the owner: keep them approved.
update public.members set approved = true, approved_at = now(), approved_by = 'migration' where not approved;

create function public.member_approval_stamp() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.approved and not old.approved then
    new.approved_at := now();
    new.approved_by := coalesce(new.approved_by, current_user);
  elsif not new.approved and old.approved then
    new.approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end $$;

create trigger approval_stamp before update of approved on public.members
  for each row execute function public.member_approval_stamp();

-- Approved after the join cycle already ended: start counting from the current calendar cycle
-- (no cycles exist yet, because unapproved members are never evaluated).
create function public.member_approval_apply() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.approved and not old.approved then
    update public.memberships ms
       set first_cycle_start = public.cycle_start_of(public.utc_today())
     where ms.member_id = new.id
       and ms.status <> 'kicked'
       and ms.first_cycle_start < public.cycle_start_of(public.utc_today())
       and not exists (select 1 from public.premium_cycles pc where pc.membership_id = ms.id);
  end if;
  return null;
end $$;

create trigger approval_apply after update of approved on public.members
  for each row execute function public.member_approval_apply();

-- member_overview gains `approved` (added last so the view can be replaced in place).
create or replace view public.member_overview with (security_invoker = true) as
select mb.id               as member_id,
       mb.bingx_uid,
       mb.email,
       mb.email_opt_out_at,
       ms.id               as membership_id,
       ms.status,
       ms.joined_at,
       ms.warned_at,
       ms.ended_at,
       pc.cycle_index,
       pc.start_day        as cycle_start,
       pc.end_day          as cycle_end,
       pc.result           as cycle_result,
       pc.counted_volume,
       pc.next_start_day,
       mb.approved
  from public.members mb
  left join lateral (
       select * from public.memberships where member_id = mb.id order by joined_at desc limit 1
       ) ms on true
  left join lateral (
       select * from public.premium_cycles where membership_id = ms.id order by cycle_index desc limit 1
       ) pc on true;

create or replace view public.email_recipients with (security_invoker = true) as
select member_id, email
  from public.member_overview
 where approved and status in ('active', 'warned') and email_opt_out_at is null;

-- What the admin has to review (also in the morning digest).
create view public.pending_approvals with (security_invoker = true) as
select mo.member_id, mo.bingx_uid, mo.email, mo.joined_at, mo.status
  from public.member_overview mo
 where not mo.approved and mo.status is distinct from 'kicked'
 order by mo.joined_at;

-- ---------------------------------------------------------------------------------------------
-- V-03: throttle UID lookups
-- ---------------------------------------------------------------------------------------------
create table public.auth_failures (
  id         bigint generated always as identity primary key,
  ip         inet        not null,
  bingx_uid  bigint      not null,
  created_at timestamptz not null default now()
);
comment on table public.auth_failures is 'Lần nhập UID không thuộc link đối tác (tính vào giới hạn 10 lần/giờ mỗi IP).';
create index auth_failures_ip_recent on public.auth_failures (ip, created_at desc);

create table public.invitee_misses (
  uid        bigint primary key,
  checked_at timestamptz not null default now()
);
comment on table public.invitee_misses is 'UID mà BingX trả lời "không thuộc link" — không hỏi lại BingX trong 1 giờ.';

alter table public.auth_failures  enable row level security;
alter table public.invitee_misses enable row level security;
revoke all on public.auth_failures, public.invitee_misses from anon, authenticated;
grant select, insert, update, delete on public.auth_failures, public.invitee_misses to service_role;
grant usage on all sequences in schema public to service_role;

-- Returns 'ok' | 'not_invitee' | 'email_taken' | 'uid_taken' | 'rate_limited' | 'rate_limited_ip'.
create or replace function public.auth_start(p_uid bigint, p_email text, p_code_hash bytea, p_ip inet default null)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_row record;
begin
  -- Per IP, first: codes sent + unknown UIDs tried in the last hour.
  if p_ip is not null and (
       (select count(*) from public.email_verifications where request_ip = p_ip and created_at > now() - interval '1 hour')
     + (select count(*) from public.auth_failures      where ip = p_ip         and created_at > now() - interval '1 hour')
     ) >= 10 then
    return 'rate_limited_ip';
  end if;

  if not exists (select 1 from public.bingx_invitees where uid = p_uid) then
    if p_ip is not null then
      insert into public.auth_failures (ip, bingx_uid) values (p_ip, p_uid);
    end if;
    return 'not_invitee';
  end if;

  -- 1 UID = 1 Gmail.
  select bingx_uid into v_row from public.member_overview where email = p_email;
  if found and v_row.bingx_uid <> p_uid then
    return 'email_taken';
  end if;
  -- The UID keeps its Gmail (approved or still pending), unless its last membership was kicked.
  select email, status into v_row from public.member_overview where bingx_uid = p_uid;
  if found and v_row.email <> p_email and v_row.status is distinct from 'kicked' then
    return 'uid_taken';
  end if;

  if (select count(*) from public.email_verifications
       where email = p_email and created_at > now() - interval '1 hour') >= 5 then
    return 'rate_limited';
  end if;

  insert into public.email_verifications (bingx_uid, email, code_hash, request_ip)
  values (p_uid, p_email, p_code_hash, p_ip);
  return 'ok';
end $$;

-- Returns 'ok' (signed in) | 'ok_new' (new link waiting for the admin) | 'no_code' | 'too_many'
-- | 'wrong:<tries left>' | 'uid_taken'.
create or replace function public.auth_verify(p_uid bigint, p_email text, p_code_hash bytea, p_token_hash bytea)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_otp       record;
  v_member    record;
  v_exists    boolean;
  v_member_id bigint;
  v_new       boolean := false;
begin
  select id, code_hash, attempts into v_otp
    from public.email_verifications
   where bingx_uid = p_uid and email = p_email and consumed_at is null and expires_at > now()
   order by created_at desc
   limit 1
   for update;
  if not found then
    return 'no_code';
  end if;
  if v_otp.attempts >= 5 then
    return 'too_many';
  end if;
  if v_otp.code_hash <> p_code_hash then
    update public.email_verifications set attempts = attempts + 1 where id = v_otp.id;
    return 'wrong:' || (4 - v_otp.attempts);
  end if;
  update public.email_verifications set consumed_at = now() where id = v_otp.id;

  select member_id, email, status into v_member from public.member_overview where bingx_uid = p_uid;
  v_exists := found;
  if not v_exists then
    insert into public.members (bingx_uid, email, email_verified_at)
    values (p_uid, p_email, now())
    returning id into v_member_id;
  else
    v_member_id := v_member.member_id;
    if v_member.email <> p_email and v_member.status is distinct from 'kicked' then
      return 'uid_taken';
    end if;
  end if;

  -- First join or re-join after a kick: new membership, and the admin must approve it again.
  if not v_exists or v_member.status is null or v_member.status = 'kicked' then
    insert into public.memberships (member_id) values (v_member_id);
    update public.members
       set email = p_email, email_verified_at = now(), approved = false
     where id = v_member_id;
    v_new := true;
  end if;

  insert into public.member_sessions (member_id, token_hash) values (v_member_id, p_token_hash);
  return case when v_new then 'ok_new' else 'ok' end;
end $$;

-- /api/me: a member waiting for approval gets status 'pending' and no volume data.
create or replace function public.member_me(p_token_hash bytea)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when not mo.approved and mo.status is distinct from 'kicked' then
           jsonb_build_object(
             'uid', mo.bingx_uid::text, 'email', mo.email, 'status', 'pending',
             'joinedAt', mo.joined_at, 'warnedAt', null, 'cycleStart', null, 'cycleIndex', null,
             'daily', '[]'::jsonb, 'updatedAt', null)
         else
           jsonb_build_object(
             'uid',        mo.bingx_uid::text,
             'email',      mo.email,
             'status',     mo.status,
             'joinedAt',   mo.joined_at,
             'warnedAt',   mo.warned_at,
             'cycleStart', mo.cycle_start,
             'cycleIndex', mo.cycle_index,
             'daily',      coalesce((
                             select jsonb_agg(jsonb_build_object('day', d.day, 'volume', d.crypto_futures_volume)
                                              order by d.day)
                               from public.daily_volumes d
                              where d.bingx_uid = mo.bingx_uid and d.day >= public.utc_today() - 29
                           ), '[]'::jsonb),
             'updatedAt',  (select max(d.fetched_at) from public.daily_volumes d where d.bingx_uid = mo.bingx_uid))
         end
    from public.member_sessions s
    join public.member_overview mo on mo.member_id = s.member_id
   where s.token_hash = p_token_hash and s.expires_at > now() and s.revoked_at is null
   limit 1
$$;

-- Unapproved members are never evaluated (same body as 20261104020000, plus `and mb.approved`).
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
     where ms.status = 'active' and mb.approved
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
        exit when c.next_start_day is null or c.next_start_day > p_through + 1;
        v_start := public.cycle_start_of(c.next_start_day);
        insert into public.premium_cycles (membership_id, cycle_index, start_day, cycle_days, rest_days)
        values (m.id, c.cycle_index + 1, v_start, public.cycle_end_of(v_start) - v_start + 1, 0)
        returning * into c;
      end if;

      exit when c.start_day > p_through;

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

-- Reminder emails only for approved members (same as 20261104060000, plus `and mb.approved`).
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
        join public.members mb on mb.id = ms.member_id and mb.approved
       where pc.result = 'open'
         and pc.counted_volume < pc.target_usd
         and (pc.end_day = p_today - 1 or pc.end_day - p_today + 1 between 1 and 3)
    ) n
   where not exists (
     select 1 from public.email_deliveries d
      where d.member_id = n.member_id and d.kind = n.kind and d.send_day = n.start_day
   )
$$;

-- Admin report: only approved members count as members; a pending UID shows up as "not linked".
create or replace function public.cycle_report(p_start date, p_end date)
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
    select distinct on (ms.member_id)
           mb.bingx_uid, mb.email, ms.status, ms.joined_at
      from public.memberships ms
      join public.members mb on mb.id = ms.member_id and mb.approved
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

-- Old throttle rows are useless after a day.
create or replace function public.purge_expired_auth_rows() returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_sessions integer;
  v_codes    integer;
  v_fail     integer;
  v_miss     integer;
begin
  delete from public.member_sessions where expires_at < now() - interval '7 days';
  get diagnostics v_sessions = row_count;
  delete from public.email_verifications where created_at < now() - interval '7 days';
  get diagnostics v_codes = row_count;
  delete from public.auth_failures where created_at < now() - interval '1 day';
  get diagnostics v_fail = row_count;
  delete from public.invitee_misses where checked_at < now() - interval '1 day';
  get diagnostics v_miss = row_count;
  return v_sessions + v_codes + v_fail + v_miss;
end $$;

revoke all on public.pending_approvals from anon, authenticated;
grant select on public.pending_approvals, public.member_overview, public.email_recipients to service_role;
revoke execute on function public.member_approval_stamp() from public, anon, authenticated;
revoke execute on function public.member_approval_apply() from public, anon, authenticated;

notify pgrst, 'reload schema';
