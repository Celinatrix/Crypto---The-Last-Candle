-- Admin statistics: deposits of invited users (BingX depositDetailList, last 90 days) and daily
-- totals for the admin page charts. BingX gives no row id, so one row is identified by its values
-- plus `seq`, which tells identical deposits apart. BingX offers no withdrawal data for invitees.

create table public.deposits (
  uid             bigint        not null,
  biz_time        timestamptz   not null,
  asset_type      integer       not null,
  asset_type_name text          not null,
  currency        text          not null,
  amount          numeric(30,8) not null,
  seq             smallint      not null default 0,
  synced_at       timestamptz   not null default now(),
  primary key (uid, biz_time, asset_type, currency, amount, seq)
);
comment on table public.deposits is 'Lượt nạp của UID dưới link đối tác (BingX depositDetailList). Tải lại được từ BingX trong 90 ngày.';
create index deposits_recent on public.deposits (biz_time desc);

create table public.deposit_sync_state (
  id          smallint    primary key default 1 check (id = 1),
  synced_at   timestamptz not null,
  window_days integer     not null,
  row_count   integer     not null,
  failed_uids integer     not null
);
comment on table public.deposit_sync_state is 'Lần đồng bộ lượt nạp gần nhất.';

alter table public.deposits enable row level security;
alter table public.deposit_sync_state enable row level security;
revoke all on public.deposits, public.deposit_sync_state from anon, authenticated;
grant select, insert, update, delete on public.deposits, public.deposit_sync_state to service_role;

-- Crypto-futures volume per UTC day (BingX's day), split into linked members and other partner-link UIDs.
create function public.admin_volume_daily(p_from date, p_to date)
returns table (day date, linked_volume numeric, other_volume numeric, linked_traders integer, other_traders integer)
language sql
stable
set search_path = ''
as $$
  with linked as (
    select bingx_uid from public.member_overview where approved and status is distinct from 'kicked'
  )
  select d::date,
         coalesce(sum(v.crypto_futures_volume) filter (where l.bingx_uid is not null), 0),
         coalesce(sum(v.crypto_futures_volume) filter (where l.bingx_uid is null), 0),
         (count(*) filter (where v.crypto_futures_volume > 0 and l.bingx_uid is not null))::integer,
         (count(*) filter (where v.crypto_futures_volume > 0 and l.bingx_uid is null))::integer
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
    left join public.daily_volumes v on v.day = d::date
    left join linked l on l.bingx_uid = v.bingx_uid
   group by d
   order by d
$$;

-- USDT deposited per Vietnam calendar day, by kind. Other currencies are only counted.
create function public.admin_deposit_daily(p_from date, p_to date)
returns table (day date, onchain numeric, p2p numeric, transfer numeric, events integer, uids integer, other_currency integer)
language sql
stable
set search_path = ''
as $$
  select d::date,
         coalesce(sum(x.amount) filter (where x.currency = 'USDT' and x.asset_type = 30), 0),
         coalesce(sum(x.amount) filter (where x.currency = 'USDT' and x.asset_type = 231), 0),
         coalesce(sum(x.amount) filter (where x.currency = 'USDT' and x.asset_type not in (30, 231)), 0),
         count(x.uid)::integer,
         count(distinct x.uid)::integer,
         (count(*) filter (where x.currency <> 'USDT'))::integer
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
    left join public.deposits x on (x.biz_time at time zone 'Asia/Ho_Chi_Minh')::date = d::date
   group by d
   order by d
$$;

revoke execute on function public.admin_volume_daily(date, date) from public, anon, authenticated;
revoke execute on function public.admin_deposit_daily(date, date) from public, anon, authenticated;
grant execute on function public.admin_volume_daily(date, date) to service_role;
grant execute on function public.admin_deposit_daily(date, date) to service_role;

notify pgrst, 'reload schema';
