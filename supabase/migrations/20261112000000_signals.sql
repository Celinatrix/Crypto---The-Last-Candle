-- Trade signals posted by the admin, scored automatically against BingX 1-minute prices
-- (src/shared/signals.ts holds the rules). Members who linked their UID see the statistics.
-- Safe to run while the site is live: nothing reads these tables until the first signal is posted.

create table public.signals (
  id            bigint generated always as identity primary key,
  symbol        text        not null check (symbol ~ '^[A-Z0-9]{1,20}-USDT$'),
  side          text        not null check (side in ('long', 'short')),
  order_type    text        not null check (order_type in ('market', 'limit')),
  entry         numeric     not null check (entry > 0),
  -- The original stop: defines 1R and never changes. Moves are signal_events of kind 'sl_moved'.
  sl            numeric     not null check (sl > 0),
  -- The stop the replay has applied so far.
  current_sl    numeric     not null check (current_sl > 0),
  tps           numeric[]   not null check (cardinality(tps) between 1 and 3),
  note          text        check (char_length(note) <= 500),
  status        text        not null default 'pending' check (status in ('pending', 'open', 'closed', 'cancelled')),
  tp_hits       smallint    not null default 0 check (tp_hits >= 0 and tp_hits <= cardinality(tps)),
  realized_r    numeric     not null default 0,
  exit_reason   text        check (exit_reason in ('tp', 'sl', 'manual', 'cancel_sl', 'cancel_tp', 'cancel_admin')),
  created_at    timestamptz not null default now(),
  filled_at     timestamptz,
  closed_at     timestamptz,
  -- Open time of the next 1-minute candle to replay (the first full minute after the post).
  checked_until timestamptz not null default date_trunc('minute', now()) + interval '1 minute',
  created_by    text        not null,
  constraint closed_has_time check ((status in ('closed', 'cancelled')) = (closed_at is not null)),
  constraint risk_not_zero check (entry <> sl)
);
comment on table public.signals is 'Tín hiệu admin đăng. Kết quả được chấm tự động theo nến 1 phút BingX.';

create index signals_active_idx on public.signals (symbol) where status in ('pending', 'open');
create index signals_created_idx on public.signals (created_at desc);

create table public.signal_events (
  id         bigint generated always as identity primary key,
  signal_id  bigint      not null references public.signals (id) on delete cascade,
  at         timestamptz not null,
  kind       text        not null check (kind in ('created', 'filled', 'tp', 'sl', 'sl_moved', 'manual_close', 'cancelled')),
  price      numeric,
  r          numeric,
  by         text,
  created_at timestamptz not null default now()
);
comment on table public.signal_events is 'Lịch sử từng tín hiệu: đăng, khớp, chạm TP/SL, dời SL, đóng tay, huỷ.';

create index signal_events_signal_idx on public.signal_events (signal_id, at);

alter table public.signals enable row level security;
alter table public.signal_events enable row level security;
revoke all on public.signals, public.signal_events from anon, authenticated;
grant select, insert, update on public.signals, public.signal_events to service_role;

-- Saves one replay step atomically. It only applies when checked_until is still what the caller read,
-- so two overlapping replays (two page loads, or the cron and an admin action) never book a TP twice.
create or replace function public.signal_apply(p_id bigint, p_expected timestamptz, p_patch jsonb, p_events jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.signals set
    status        = p_patch->>'status',
    current_sl    = (p_patch->>'current_sl')::numeric,
    tp_hits       = (p_patch->>'tp_hits')::smallint,
    realized_r    = (p_patch->>'realized_r')::numeric,
    exit_reason   = p_patch->>'exit_reason',
    filled_at     = (p_patch->>'filled_at')::timestamptz,
    closed_at     = (p_patch->>'closed_at')::timestamptz,
    checked_until = (p_patch->>'checked_until')::timestamptz
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

-- True for a valid member session (any linked UID). Lighter than member_me for the signals page.
create or replace function public.member_session_ok(p_token_hash bytea)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.member_sessions s
     where s.token_hash = p_token_hash and s.expires_at > now() and s.revoked_at is null
  )
$$;

revoke all on function public.member_session_ok(bytea) from public, anon, authenticated;
grant execute on function public.member_session_ok(bytea) to service_role;

notify pgrst, 'reload schema';
