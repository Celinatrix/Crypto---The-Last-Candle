-- Who called each signal in the group (e.g. "Phương Thắng", "Thanh Kiệt"), shown to members and
-- used for the per-caller winrate. Run after 20261112010000_signal_two_entries.sql, BEFORE deploying
-- the code that reads it. Safe while the site is live: existing signals keep caller = null.

alter table public.signals
  add column caller text check (caller is null or char_length(caller) between 1 and 60);

notify pgrst, 'reload schema';
