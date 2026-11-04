-- Sign-in in one database round trip per step (the API used to make up to 7 sequential calls).
-- Called by the server with the service_role key via PostgREST RPC.

-- Step 1 (/api/register): checks the UID and Gmail, rate-limits, stores the hashed code.
-- Returns 'ok' | 'not_invitee' | 'email_taken' | 'uid_taken' | 'rate_limited'.
create function public.auth_start(p_uid bigint, p_email text, p_code_hash bytea, p_ip inet default null)
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

  insert into public.email_verifications (bingx_uid, email, code_hash, request_ip)
  values (p_uid, p_email, p_code_hash, p_ip);
  return 'ok';
end $$;

-- Step 2 (/api/verify-otp): checks the latest code (max 5 tries); on success creates the member
-- (or moves a kicked member to the new Gmail), opens a membership when none is active, and
-- stores the session. Returns 'ok' | 'no_code' | 'too_many' | 'wrong:<tries left>' | 'uid_taken'.
create function public.auth_verify(p_uid bigint, p_email text, p_code_hash bytea, p_token_hash bytea)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_otp       record;
  v_member    record;
  v_exists    boolean;
  v_member_id bigint;
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
    if v_member.email <> p_email then
      if v_member.status is distinct from 'kicked' then
        return 'uid_taken';
      end if;
      update public.members set email = p_email, email_verified_at = now() where id = v_member_id;
    end if;
  end if;

  -- First join or re-join after a kick opens a membership; signing in again keeps the current one.
  if not v_exists or v_member.status is null or v_member.status = 'kicked' then
    insert into public.memberships (member_id) values (v_member_id);
  end if;

  insert into public.member_sessions (member_id, token_hash) values (v_member_id, p_token_hash);
  return 'ok';
end $$;

-- /api/me: the session's member plus the last 30 UTC days of crypto-futures volume, as JSON.
-- NULL when the session is missing, expired or revoked.
create function public.member_me(p_token_hash bytea)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
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
           'updatedAt',  (select max(d.fetched_at) from public.daily_volumes d where d.bingx_uid = mo.bingx_uid)
         )
    from public.member_sessions s
    join public.member_overview mo on mo.member_id = s.member_id
   where s.token_hash = p_token_hash and s.expires_at > now() and s.revoked_at is null
   limit 1
$$;

revoke execute on function public.auth_start(bigint, text, bytea, inet) from public, anon, authenticated;
revoke execute on function public.auth_verify(bigint, text, bytea, bytea) from public, anon, authenticated;
revoke execute on function public.member_me(bytea) from public, anon, authenticated;
grant execute on function public.auth_start(bigint, text, bytea, inet) to service_role;
grant execute on function public.auth_verify(bigint, text, bytea, bytea) to service_role;
grant execute on function public.member_me(bytea) to service_role;

-- Let the Data API see the new functions right away.
notify pgrst, 'reload schema';
