alter table public.health_monitors
add column if not exists interval_mins integer not null default 5;
