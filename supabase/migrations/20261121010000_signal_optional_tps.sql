-- Signals may be posted without a take-profit; TPs can be added later (event 'tps_set').
-- Run after 20261121000000_signal_caller.sql, BEFORE deploying the code that relies on it.
-- Safe while the site is live: existing signals all have 1–3 TPs, which still passes.

-- Drop the old checks by what they say, whatever Postgres named them.
do $$
declare c record;
begin
  for c in
    select conname, conrelid::regclass as tbl from pg_constraint
     where contype = 'c'
       and ((conrelid = 'public.signals'::regclass and pg_get_constraintdef(oid) ~ 'cardinality\(tps\) >= 1')
         or (conrelid = 'public.signal_events'::regclass and pg_get_constraintdef(oid) ~ 'sl_moved'))
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table public.signals add constraint signals_tps_count check (cardinality(tps) between 0 and 3);

alter table public.signal_events add constraint signal_events_kind_check
  check (kind in ('created', 'filled', 'tp', 'sl', 'sl_moved', 'manual_close', 'cancelled', 'tps_set'));

notify pgrst, 'reload schema';
