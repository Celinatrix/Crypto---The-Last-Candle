-- Signals may be posted without a stop loss. Without one there is no 1R, so such a signal is scored in
-- percent from its entry (realized_pct); the admin can add the SL later, which switches it to R.
-- realized_pct is kept for every signal. Run after 20261121020000_signal_best_price.sql, BEFORE
-- deploying the code that relies on it. Safe while the site is live: existing rows keep their SL.

alter table public.signals
  alter column sl drop not null,
  alter column current_sl drop not null,
  add column realized_pct numeric not null default 0;

-- Same as before, plus realized_pct (kept when the patch leaves it out).
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
    best_price     = case when p_patch ? 'best_price' then (p_patch->>'best_price')::numeric else best_price end,
    realized_pct   = case when p_patch ? 'realized_pct' then (p_patch->>'realized_pct')::numeric else realized_pct end
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
