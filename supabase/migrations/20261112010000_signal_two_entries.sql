-- Limit signals may have a second entry (ET2), each entry half of the position (src/shared/signals.ts).
-- Run after 20261112000000_signals.sql. Safe while the site is live: existing signals keep one entry.

alter table public.signals
  add column entry2 numeric check (entry2 > 0),
  -- How many entries have filled: 0 (waiting), 1, or 2 (only with entry2).
  add column entries_filled smallint not null default 0;

-- Signals posted before this change have one entry, filled once they left 'pending' with a fill time.
update public.signals set entries_filled = 1 where filled_at is not null;

alter table public.signals
  add constraint entry2_limit_only check (entry2 is null or order_type = 'limit'),
  add constraint entry2_differs check (entry2 is null or entry2 <> entry),
  add constraint entries_filled_range check (
    entries_filled >= 0 and entries_filled <= case when entry2 is null then 1 else 2 end
  );

-- Same as before, plus entries_filled.
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
    checked_until  = (p_patch->>'checked_until')::timestamptz
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
