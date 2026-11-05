-- Hardens admin sign-in and records who took each admin decision.
--  * Wrong sign-in codes are counted per IP (10 an hour, for any address), so nobody can keep guessing
--    or keep locking the admin's code from one connection. At most 12 codes per address per day.
--  * admin_verify is told whether the address is an admin, so other addresses are handled the same way.
--  * The admin's address now reaches audit_log for approve, reject and kick decisions.
--  * An admin can end all of their sessions, for example after losing a device.
-- Safe to run while the current site is live: old calls keep working through the default arguments.

create table public.admin_auth_failures (
  id         bigint generated always as identity primary key,
  ip         inet        not null,
  created_at timestamptz not null default now()
);
comment on table public.admin_auth_failures is 'Lần nhập sai mã đăng nhập trang quản trị, theo IP. Xoá sau 1 ngày.';
create index admin_auth_failures_recent on public.admin_auth_failures (ip, created_at desc);

alter table public.admin_auth_failures enable row level security;
revoke all on public.admin_auth_failures from anon, authenticated;
grant select, insert, delete on public.admin_auth_failures to service_role;

-- Returns 'ok' | 'rate_limited'.
create or replace function public.admin_start(p_email text, p_code_hash bytea, p_ip inet default null)
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
  if (select count(*) from public.admin_otps where email = p_email and created_at > now() - interval '1 day') >= 12 then
    return 'rate_limited';
  end if;
  insert into public.admin_otps (email, code_hash, ip) values (p_email, p_code_hash, p_ip);
  return 'ok';
end $$;

-- Returns 'ok' | 'rate_limited' | 'no_code' | 'too_many' | 'wrong:<tries left>'.
drop function public.admin_verify(text, bytea, bytea);
create function public.admin_verify(
  p_email text,
  p_code_hash bytea,
  p_token_hash bytea,
  p_ip inet default null,
  p_is_admin boolean default true
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_otp record;
  v_result text;
begin
  if p_ip is not null
     and (select count(*) from public.admin_auth_failures where ip = p_ip and created_at > now() - interval '1 hour') >= 10 then
    return 'rate_limited';
  end if;

  if not p_is_admin then
    v_result := 'no_code';
  else
    select id, code_hash, attempts into v_otp
      from public.admin_otps
     where email = p_email and consumed_at is null and expires_at > now()
     order by created_at desc
     limit 1
     for update;
    if not found then
      v_result := 'no_code';
    elsif v_otp.attempts >= 5 then
      v_result := 'too_many';
    elsif v_otp.code_hash <> p_code_hash then
      update public.admin_otps set attempts = attempts + 1 where id = v_otp.id;
      v_result := 'wrong:' || (4 - v_otp.attempts);
    else
      update public.admin_otps set consumed_at = now() where id = v_otp.id;
      insert into public.admin_sessions (email, token_hash) values (p_email, p_token_hash);
      return 'ok';
    end if;
  end if;

  if p_ip is not null then
    insert into public.admin_auth_failures (ip) values (p_ip);
  end if;
  return v_result;
end $$;

-- Ends every session of this admin. Returns how many were open.
create function public.admin_logout_all(p_email text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.admin_sessions set revoked_at = now() where email = p_email and revoked_at is null and expires_at > now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- The decision functions name the admin for the rest of their transaction; the audit trigger reads it.
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (table_name, row_id, action, old_row, new_row, actor)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    coalesce(nullif(current_setting('app.admin_actor', true), ''), current_user)
  );
  return null;
end $$;

create or replace function public.admin_approve_member(p_member_id bigint, p_by text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('app.admin_actor', p_by, true);
  update public.members set approved = true, approved_by = p_by where id = p_member_id and not approved;
  return found;
end $$;

drop function public.admin_reject_member(bigint);
create function public.admin_reject_member(p_member_id bigint, p_by text default null)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('app.admin_actor', coalesce(p_by, ''), true);
  delete from public.members where id = p_member_id and not approved;
  return found;
end $$;

create or replace function public.admin_decide_kick(p_review_id bigint, p_decision public.review_decision, p_by text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_decision = 'pending' then
    return false;
  end if;
  perform set_config('app.admin_actor', p_by, true);
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
  v_admin_fail     integer;
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
  delete from public.admin_auth_failures where created_at < now() - interval '1 day';
  get diagnostics v_admin_fail = row_count;
  return v_sessions + v_codes + v_fail + v_miss + v_admin_sessions + v_admin_codes + v_admin_fail;
end $$;

revoke execute on function public.admin_verify(text, bytea, bytea, inet, boolean) from public, anon, authenticated;
revoke execute on function public.admin_logout_all(text) from public, anon, authenticated;
revoke execute on function public.admin_reject_member(bigint, text) from public, anon, authenticated;
grant execute on function public.admin_verify(text, bytea, bytea, inet, boolean) to service_role;
grant execute on function public.admin_logout_all(text) to service_role;
grant execute on function public.admin_reject_member(bigint, text) to service_role;

notify pgrst, 'reload schema';
