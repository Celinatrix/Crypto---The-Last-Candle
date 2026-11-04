-- Premium target is now 68,686$ of crypto-futures volume per cycle.
-- New cycles take the new default; cycles still open switch too. Settled cycles keep the
-- target they were judged against.

alter table public.premium_cycles alter column target_usd set default 68686;

update public.premium_cycles set target_usd = 68686 where result = 'open';

comment on table public.premium_cycles is
  'Chu kỳ Premium theo lịch: ngày 1–14 và 15–cuối tháng, cần 68.686$ crypto futures, +1 ngày ân hạn.';
