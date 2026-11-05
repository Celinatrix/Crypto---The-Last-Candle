-- Admin page (/admin): sign-in by a code emailed to ADMIN_EMAIL, and a short-lived session that is
-- kept apart from member sessions. Same protections as member sign-in: keyed code hash, 10 minute
-- codes, 5 tries, 5 codes per hour per address and 10 per hour per IP. Only the server can call
-- any of this. Approve, reject and kick decisions keep going through the existing audit triggers.

create table public.admin_otps (
  id          bigint generated always as identity primary key,
  email       text        not null check (email = lower(email) and char_length(email) <= 254),
  code_hash   bytea       not null,
  attempts    integer     not null default 0,
  ip          inet,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz
);
comment on table public.admin_otps is 'Mã đăng nhập trang quản trị (chỉ lưu hash có khoá).';
create index admin_otps_email_recent on public.admin_otps (email, created_at desc);
create index admin_otps_ip_recent on public.admin_otps (ip, created_at desc);

create table public.admin_sessions (
  id         bigint generated always as identity primary key,
  email      text        not null,
  token_hash bytea       not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours',
  revoked_at timestamptz
);
comment on table public.admin_sessions is 'Phiên đăng nhập trang quản trị, 12 giờ (chỉ lưu SHA-256 của token).';

alter table public.admin_otps enable row level security;
alter table public.admin_sessions enable row level security;
revoke all on public.admin_otps, public.admin_sessions from anon, authenticated;
grant select, insert, update, delete on public.admin_otps, public.admin_sessions to service_role;

-- Returns 'ok' | 'rate_limited'. The server only calls this for an address in ADMIN_EMAIL.
create function public.admin_start(p_email text, p_code_hash bytea, p_ip inet default null)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if p_ip is not null
     and (select count(*) from public.admin_otps where ip = p_ip and created_at > now() - interval '1 hour') >= 10 then
    return 'rate_limited';
  end if;
  if (select count(*) from public.admin_otps where email = p_email and created_at > now() - interval '1 hour') >= 5 then
    return 'rate_limited';
  end if;
  insert into public.admin_otps (email, code_hash, ip) values (p_email, p_code_hash, p_ip);
  return 'ok';
end $$;

-- Returns 'ok' | 'no_code' | 'too_many' | 'wrong:<tries left>'.
create function public.admin_verify(p_email text, p_code_hash bytea, p_token_hash bytea)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_otp record;
begin
  select id, code_hash, attempts into v_otp
    from public.admin_otps
   where email = p_email and consumed_at is null and expires_at > now()
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
    update public.admin_otps set attempts = attempts + 1 where id = v_otp.id;
    return 'wrong:' || (4 - v_otp.attempts);
  end if;
  update public.admin_otps set consumed_at = now() where id = v_otp.id;
  insert into public.admin_sessions (email, token_hash) values (p_email, p_token_hash);
  return 'ok';
end $$;

-- The admin address of a live session, or null.
create function public.admin_session_email(p_token_hash bytea)
returns text
language sql
stable
set search_path = ''
as $$
  select email from public.admin_sessions
   where token_hash = p_token_hash and expires_at > now() and revoked_at is null
$$;

create function public.admin_logout(p_token_hash bytea)
returns void
language sql
set search_path = ''
as $$
  update public.admin_sessions set revoked_at = now() where token_hash = p_token_hash and revoked_at is null
$$;

-- The three decisions. Each returns false when the row is gone or was already decided, so a stale
-- page or a second admin cannot decide twice.
create function public.admin_approve_member(p_member_id bigint, p_by text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.members set approved = true, approved_by = p_by where id = p_member_id and not approved;
  return found;
end $$;

-- Rejecting removes a link that is still waiting: the UID can then be linked by its real owner.
create function public.admin_reject_member(p_member_id bigint)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  delete from public.members where id = p_member_id and not approved;
  return found;
end $$;

-- 'approved' kicks the member; 'rejected' keeps them from the current calendar cycle.
create function public.admin_decide_kick(p_review_id bigint, p_decision public.review_decision, p_by text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_decision = 'pending' then
    return false;
  end if;
  update public.kick_reviews set decision = p_decision, decided_by = p_by where id = p_review_id and decision = 'pending';
  return found;
end $$;

create or replace function public.purge_expired_auth_rows() returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_sessions       integer;
  v_codes          integer;
  v_fail           integer;
  v_miss           integer;
  v_admin_sessions integer;
  v_admin_codes    integer;
begin
  delete from public.member_sessions where expires_at < now() - interval '7 days';
  get diagnostics v_sessions = row_count;
  delete from public.email_verifications where created_at < now() - interval '7 days';
  get diagnostics v_codes = row_count;
  delete from public.auth_failures where created_at < now() - interval '1 day';
  get diagnostics v_fail = row_count;
  delete from public.invitee_misses where checked_at < now() - interval '1 day';
  get diagnostics v_miss = row_count;
  delete from public.admin_sessions where expires_at < now() - interval '7 days';
  get diagnostics v_admin_sessions = row_count;
  delete from public.admin_otps where created_at < now() - interval '7 days';
  get diagnostics v_admin_codes = row_count;
  return v_sessions + v_codes + v_fail + v_miss + v_admin_sessions + v_admin_codes;
end $$;

revoke execute on function public.admin_start(text, bytea, inet) from public, anon, authenticated;
revoke execute on function public.admin_verify(text, bytea, bytea) from public, anon, authenticated;
revoke execute on function public.admin_session_email(bytea) from public, anon, authenticated;
revoke execute on function public.admin_logout(bytea) from public, anon, authenticated;
revoke execute on function public.admin_approve_member(bigint, text) from public, anon, authenticated;
revoke execute on function public.admin_reject_member(bigint) from public, anon, authenticated;
revoke execute on function public.admin_decide_kick(bigint, public.review_decision, text) from public, anon, authenticated;
grant execute on function public.admin_start(text, bytea, inet) to service_role;
grant execute on function public.admin_verify(text, bytea, bytea) to service_role;
grant execute on function public.admin_session_email(bytea) to service_role;
grant execute on function public.admin_logout(bytea) to service_role;
grant execute on function public.admin_approve_member(bigint, text) to service_role;
grant execute on function public.admin_reject_member(bigint) to service_role;
grant execute on function public.admin_decide_kick(bigint, public.review_decision, text) to service_role;

notify pgrst, 'reload schema';
