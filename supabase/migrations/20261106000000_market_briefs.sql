-- Daily USD news scenario for BTC and gold: Claude drafts it, the admin approves it, and only an
-- approved row reaches members in the 07:00 email. One row per Vietnam calendar day.
-- Safe to run while the site is live: nothing reads this table until a draft exists.

create table public.market_briefs (
  day         date        primary key,
  brief       jsonb       not null,
  status      text        not null default 'pending' check (status in ('pending', 'approved')),
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  constraint approved_has_time check ((status = 'approved') = (approved_at is not null))
);
comment on table public.market_briefs is 'Kịch bản BTC và XAU cho ngày có tin đỏ USD. Chỉ dòng approved mới được gửi cho thành viên.';

alter table public.market_briefs enable row level security;
revoke all on public.market_briefs from anon, authenticated;
grant select, insert, update on public.market_briefs to service_role;

notify pgrst, 'reload schema';
