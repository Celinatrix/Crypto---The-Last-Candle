-- The Last Candle — initial schema (PostgreSQL 15+ / Supabase)
--
-- Only the server (Vercel, service_role key) talks to these tables. RLS is on everywhere with
-- no policies, and anon/authenticated get no grants, so the public anon key can read nothing.
-- All "day" columns are UTC calendar days, matching the Premium rule and BingX's commissionTime.

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------

create type public.member_status as enum ('active', 'warned', 'kicked');
create type public.cycle_result as enum ('open', 'met', 'met_in_grace', 'failed');
create type public.review_decision as enum ('pending', 'approved', 'rejected');
create type public.sync_status as enum ('running', 'succeeded', 'failed');

create function public.utc_today() returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'utc')::date $$;

-- ---------------------------------------------------------------------------------------------
-- BingX data (synced from the Agent API)
-- ---------------------------------------------------------------------------------------------

create table public.bingx_invitees (
  uid               bigint primary key,
  direct_invitation boolean     not null,
  registered_at     timestamptz,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now()
);
comment on table public.bingx_invitees is
  'UID đã đăng ký BingX qua link đối tác (từ inviteAccountList). Thành viên chỉ liên kết được UID có trong bảng này.';

create table public.daily_volumes (
  bingx_uid             bigint        not null references public.bingx_invitees (uid),
  day                   date          not null,
  perpetual_volume      numeric(20, 2) not null default 0 check (perpetual_volume >= 0),
  tradfi_volume         numeric(20, 2) not null default 0 check (tradfi_volume >= 0),
  -- BingX counts TradFi inside perpetualFutures; the Premium rule counts crypto futures only.
  crypto_futures_volume numeric(20, 2) generated always as (greatest(perpetual_volume - tradfi_volume, 0)) stored,
  fetched_at            timestamptz   not null default now(),
  primary key (bingx_uid, day)
);
comment on table public.daily_volumes is
  'Volume theo ngày UTC của từng UID (commissionDataList). Chỉ crypto_futures_volume được tính cho mốc Premium.';

-- ---------------------------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------------------------

create table public.members (
  id                bigint generated always as identity primary key,
  bingx_uid         bigint      not null unique references public.bingx_invitees (uid),
  email             text        not null unique
                    check (email = lower(email) and email ~ '^[a-z0-9.+_-]+@(gmail|googlemail)\.com$'),
  email_verified_at timestamptz not null,
  email_opt_out_at  timestamptz,
  created_at        timestamptz not null default now()
);
comment on table public.members is 'Một người = một BingX UID = một Gmail (quan hệ 1-1, cả hai đều unique).';
comment on column public.members.email_opt_out_at is 'Khác NULL = đã huỷ nhận email 07:00.';

-- A kicked member may register again: each join is a new membership; history is kept.
create table public.memberships (
  id                bigint generated always as identity primary key,
  member_id         bigint        not null references public.members (id) on delete cascade,
  status            public.member_status not null default 'active',
  joined_at         timestamptz   not null default now(),
  first_cycle_start date          not null default public.utc_today(),
  warned_at         timestamptz,
  ended_at          timestamptz,
  constraint kicked_has_end check ((status = 'kicked') = (ended_at is not null)),
  constraint warned_has_time check (status <> 'warned' or warned_at is not null)
);
comment on table public.memberships is
  'Mỗi lần tham gia là một dòng. warned = trượt chu kỳ, chờ admin duyệt kick trong kick_reviews.';

-- At most one membership that is not kicked per member.
create unique index memberships_one_open_per_member on public.memberships (member_id) where status <> 'kicked';
create index memberships_member_latest on public.memberships (member_id, joined_at desc);

create table public.premium_cycles (
  id                bigint generated always as identity primary key,
  membership_id     bigint        not null references public.memberships (id) on delete cascade,
  cycle_index       integer       not null check (cycle_index >= 1),
  start_day         date          not null,
  -- The rule is copied onto each cycle so a later rule change never rewrites history.
  cycle_days        smallint      not null default 14 check (cycle_days between 1 and 60),
  rest_days         smallint      not null default 3 check (rest_days between 0 and 30),
  target_usd        numeric(14, 2) not null default 60000 check (target_usd > 0),
  end_day           date          generated always as (start_day + cycle_days - 1) stored,
  counted_volume    numeric(20, 2) not null default 0 check (counted_volume >= 0),
  evaluated_through date,
  result            public.cycle_result not null default 'open',
  met_day           date,
  next_start_day    date,
  settled_at        timestamptz,
  unique (membership_id, cycle_index),
  unique (membership_id, start_day),
  constraint met_day_matches_result check ((met_day is not null) = (result in ('met', 'met_in_grace'))),
  constraint settled_matches_result check ((settled_at is not null) = (result <> 'open')),
  -- start_day + cycle_days is the 24h grace day.
  constraint met_day_in_window check (met_day is null or met_day between start_day and start_day + cycle_days),
  constraint next_start_after_start check (next_start_day is null or next_start_day > start_day)
);
comment on table public.premium_cycles is
  'Chu kỳ Premium: 14 ngày đạt 60.000$ crypto futures, +1 ngày ân hạn; đạt thì nghỉ 3 ngày rồi sang chu kỳ mới.';
comment on column public.premium_cycles.next_start_day is
  'Ngày bắt đầu chu kỳ kế tiếp: sau 3 ngày nghỉ nếu đạt, hoặc ngày admin từ chối kick.';

create table public.kick_reviews (
  id         bigint generated always as identity primary key,
  cycle_id   bigint      not null unique references public.premium_cycles (id) on delete cascade,
  decision   public.review_decision not null default 'pending',
  note       text        check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  constraint decided_has_time check ((decision = 'pending') = (decided_at is null))
);
comment on table public.kick_reviews is
  'Đề xuất kick khi trượt chu kỳ. Admin đổi decision thành approved (kick) hoặc rejected (cho ở lại, chu kỳ mới bắt đầu hôm đó).';

create index kick_reviews_pending on public.kick_reviews (created_at) where decision = 'pending';

-- ---------------------------------------------------------------------------------------------
-- Sign-in: Gmail OTP and the 24h httpOnly session cookie
-- ---------------------------------------------------------------------------------------------

create table public.email_verifications (
  id          bigint generated always as identity primary key,
  bingx_uid   bigint      not null references public.bingx_invitees (uid),
  email       text        not null check (email = lower(email)),
  -- SHA-256 of the 6-digit code; the code itself is never stored.
  code_hash   bytea       not null check (octet_length(code_hash) = 32),
  attempts    smallint    not null default 0 check (attempts between 0 and 5),
  request_ip  inet,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz,
  check (expires_at > created_at)
);
comment on table public.email_verifications is 'Mã OTP gửi qua Gmail khi liên kết UID. Tối đa 5 lần nhập sai, hết hạn sau 10 phút.';

-- Rate limiting: "how many codes for this email / IP in the last hour".
create index email_verifications_email_recent on public.email_verifications (email, created_at desc);
create index email_verifications_ip_recent on public.email_verifications (request_ip, created_at desc);

create table public.member_sessions (
  id         bigint generated always as identity primary key,
  member_id  bigint      not null references public.members (id) on delete cascade,
  -- SHA-256 of the cookie value; a leaked table cannot be replayed as cookies.
  token_hash bytea       not null unique check (octet_length(token_hash) = 32),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  revoked_at timestamptz,
  check (expires_at > created_at)
);

create index member_sessions_member on public.member_sessions (member_id);

-- ---------------------------------------------------------------------------------------------
-- Operations: email log, sync runs, audit
-- ---------------------------------------------------------------------------------------------

create table public.email_deliveries (
  id          bigint generated always as identity primary key,
  member_id   bigint      not null references public.members (id) on delete cascade,
  kind        text        not null check (kind in ('daily_calendar')),
  send_day    date        not null,
  provider_id text,
  error       text,
  created_at  timestamptz not null default now(),
  -- One email of each kind per member per day, even if the cron retries.
  unique (member_id, kind, send_day)
);

create table public.sync_runs (
  id           bigint generated always as identity primary key,
  job          text        not null check (job in ('bingx_volume')),
  status       public.sync_status not null default 'running',
  window_start date,
  window_end   date,
  invitees     integer,
  volume_rows  integer,
  skipped_rows integer,
  flagged      integer,
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  check ((status = 'running') = (finished_at is null))
);
comment on table public.sync_runs is 'Nhật ký mỗi lần đồng bộ volume từ BingX — xem ở đây khi số liệu có vẻ sai.';

create index sync_runs_recent on public.sync_runs (job, started_at desc);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text        not null,
  row_id     bigint      not null,
  action     text        not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_row    jsonb,
  new_row    jsonb,
  actor      text        not null default current_user,
  at         timestamptz not null default now()
);
comment on table public.audit_log is 'Lịch sử thay đổi members, memberships, kick_reviews (ai đổi, lúc nào, trước/sau).';

create index audit_log_row on public.audit_log (table_name, row_id, at desc);

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------

create function public.audit_row_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (table_name, row_id, action, old_row, new_row)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end $$;

create trigger audit after insert or update or delete on public.members
  for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.memberships
  for each row execute function public.audit_row_change();
create trigger audit after insert or update or delete on public.kick_reviews
  for each row execute function public.audit_row_change();

-- Admins decide in the Supabase dashboard by editing `decision`; this stamps who and when,
-- and makes a decision final.
create function public.kick_review_stamp() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.decision <> 'pending' and new.decision is distinct from old.decision then
    raise exception 'kick_review % was already decided (%)', old.id, old.decision;
  end if;
  if old.decision = 'pending' and new.decision <> 'pending' then
    new.decided_at := coalesce(new.decided_at, now());
    new.decided_by := coalesce(new.decided_by, current_user);
  end if;
  return new;
end $$;

create trigger stamp before update on public.kick_reviews
  for each row execute function public.kick_review_stamp();

-- approved → the membership is kicked; rejected → it stays and a new cycle starts today.
create function public.kick_review_apply() returns trigger
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
       set next_start_day = greatest(public.utc_today(), end_day + 2)
     where id = new.cycle_id;
  end if;
  return null;
end $$;

create trigger apply after update of decision on public.kick_reviews
  for each row execute function public.kick_review_apply();

-- ---------------------------------------------------------------------------------------------
-- Premium cycle evaluation (run by the daily sync after volumes are stored)
-- ---------------------------------------------------------------------------------------------

-- p_through is the last UTC day whose volume is complete (BingX publishes a day after it ends).
-- For every active membership it walks open cycles forward: reached → settle and schedule the
-- next cycle after the rest days; past the grace day and short → mark failed, flag the membership
-- as warned and open a kick review. Returns the number of new kick reviews.
create function public.evaluate_premium_cycles(p_through date default public.utc_today() - 1)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  m         record;
  c         public.premium_cycles%rowtype;
  r         record;
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
        insert into public.premium_cycles (membership_id, cycle_index, start_day)
        values (m.id, 1, m.first_cycle_start)
        returning * into c;
      elsif c.result <> 'open' then
        -- The next cycle exists from its first day on (p_through + 1 is "today").
        exit when c.next_start_day is null or c.next_start_day > p_through + 1;
        insert into public.premium_cycles (membership_id, cycle_index, start_day)
        values (m.id, c.cycle_index + 1, c.next_start_day)
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
               next_start_day = case when v_met <= c.end_day then c.end_day else c.end_day + 1 end + c.rest_days + 1
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

-- Expired sessions and old OTP codes are useless after a week; called by the daily sync.
create function public.purge_expired_auth_rows() returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_sessions integer;
  v_codes    integer;
begin
  delete from public.member_sessions where expires_at < now() - interval '7 days';
  get diagnostics v_sessions = row_count;
  delete from public.email_verifications where created_at < now() - interval '7 days';
  get diagnostics v_codes = row_count;
  return v_sessions + v_codes;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------------------------

-- One row per member: latest membership and its latest cycle. Backs /api/me and the admin view.
create view public.member_overview with (security_invoker = true) as
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
       pc.next_start_day
  from public.members mb
  left join lateral (
       select * from public.memberships where member_id = mb.id order by joined_at desc limit 1
       ) ms on true
  left join lateral (
       select * from public.premium_cycles where membership_id = ms.id order by cycle_index desc limit 1
       ) pc on true;

-- Who gets the 07:00 email: not kicked, not unsubscribed.
create view public.email_recipients with (security_invoker = true) as
select member_id, email
  from public.member_overview
 where status in ('active', 'warned') and email_opt_out_at is null;

-- ---------------------------------------------------------------------------------------------
-- Access control (least privilege)
-- ---------------------------------------------------------------------------------------------

alter table public.bingx_invitees      enable row level security;
alter table public.daily_volumes       enable row level security;
alter table public.members             enable row level security;
alter table public.memberships         enable row level security;
alter table public.premium_cycles      enable row level security;
alter table public.kick_reviews        enable row level security;
alter table public.email_verifications enable row level security;
alter table public.member_sessions     enable row level security;
alter table public.email_deliveries    enable row level security;
alter table public.sync_runs           enable row level security;
alter table public.audit_log           enable row level security;

-- Supabase grants anon/authenticated access to new objects by default; this app uses neither.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- The server: data changes only, no TRUNCATE/REFERENCES/TRIGGER; the audit log is read-only.
revoke all on all tables in schema public from service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
revoke insert, update, delete on public.audit_log from service_role;
grant usage on all sequences in schema public to service_role;
grant execute on function public.utc_today() to service_role;
grant execute on function public.evaluate_premium_cycles(date) to service_role;
grant execute on function public.purge_expired_auth_rows() to service_role;
