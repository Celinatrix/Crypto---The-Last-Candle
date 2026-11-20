-- Signals without TPs are scored at their best price (the highest high for a long, the lowest low for
-- a short since the fill): when the SL is reached after at least +1R was available, or when the admin
-- closes "at the best price". Adds best_price, the exit 'best' and the event 'best'.
-- Run after 20261121010000_signal_optional_tps.sql, BEFORE deploying the code that relies on it.

alter table public.signals add column best_price numeric check (best_price > 0);

-- Replace the exit and event-kind checks by what they say, whatever Postgres named them.
do $$
declare c record;
begin
  for c in
    select conname, conrelid::regclass as tbl from pg_constraint
     where contype = 'c'
       and ((conrelid = 'public.signals'::regclass and pg_get_constraintdef(oid) ~ 'cancel_admin')
         or (conrelid = 'public.signal_events'::regclass and pg_get_constraintdef(oid) ~ 'sl_moved'))
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table public.signals add constraint signals_exit_reason_check
  check (exit_reason in ('tp', 'sl', 'manual', 'best', 'cancel_sl', 'cancel_tp', 'cancel_admin'));

alter table public.signal_events add constraint signal_events_kind_check
  check (kind in ('created', 'filled', 'tp', 'sl', 'sl_moved', 'manual_close', 'cancelled', 'tps_set', 'best'));

-- Same as before, plus best_price (kept when the patch leaves it out).
create or replace function public.signal_apply(p_id bigint, p_expected timestamptz, p_patch jsonb, p_events jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.signals set
    status         = p_patch->>'status',
    current_sl     = (p_patch->>'current_sl')::numeric,
    tp_hits        = (p_patch->>'tp_hits')::smallint,
    entries_filled = coalesce((p_patch->>'entries_filled')::smallint, entries_filled),
    realized_r     = (p_patch->>'realized_r')::numeric,
    exit_reason    = p_patch->>'exit_reason',
    filled_at      = (p_patch->>'filled_at')::timestamptz,
    closed_at      = (p_patch->>'closed_at')::timestamptz,
    checked_until  = (p_patch->>'checked_until')::timestamptz,
    best_price     = case when p_patch ? 'best_price' then (p_patch->>'best_price')::numeric else best_price end
  where id = p_id and checked_until = p_expected;
  if not found then
    return false;
  end if;

  insert into public.signal_events (signal_id, at, kind, price, r, by)
  select p_id, (e->>'at')::timestamptz, e->>'kind', (e->>'price')::numeric, (e->>'r')::numeric, e->>'by'
    from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) e;
  return true;
end $$;

revoke all on function public.signal_apply(bigint, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.signal_apply(bigint, timestamptz, jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
