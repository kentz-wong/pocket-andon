-- ============ TABLES ============
create table public.stations (
  id            serial primary key,
  name          text not null,
  line          text not null default 'SMT Line 1',
  position      int  not null default 0,
  status        text not null default 'green'
                check (status in ('green','yellow','red')),
  reason        text,
  note          text,
  status_since  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.events (
  id           bigserial primary key,
  station_id   int not null references public.stations(id) on delete cascade,
  from_status  text,
  to_status    text not null,
  reason       text,
  note         text,
  created_at   timestamptz not null default now()
);

create index events_station_time_idx on public.events (station_id, created_at);

-- ============ TRIGGER: auto-log status changes ============
create or replace function public.log_station_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status
     or new.reason is distinct from old.reason then
    if new.status is distinct from old.status then
      new.status_since := now();
    end if;
    if new.status = 'green' then
      new.reason := null;
      new.note := null;
    end if;
    insert into public.events (station_id, from_status, to_status, reason, note)
    values (new.id, old.status, new.status, new.reason, new.note);
  end if;
  return new;
end;
$$;

create trigger trg_station_change
before update on public.stations
for each row execute function public.log_station_change();

-- ============ VIEW: downtime today ============
-- Known simplification: a station already non-green at midnight
-- is only counted from its first event today. Fine for a demo.
create or replace view public.station_downtime_today
with (security_invoker = true) as
with ev as (
  select station_id, to_status, created_at,
         lead(created_at, 1, now()) over (
           partition by station_id order by created_at
         ) as ended_at
  from public.events
  where created_at >= date_trunc('day', now())
)
select s.id as station_id,
       coalesce(sum(extract(epoch from (ev.ended_at - ev.created_at)))
                filter (where ev.to_status <> 'green'), 0)::int as downtime_seconds,
       count(ev.*) filter (where ev.to_status = 'red') as red_count
from public.stations s
left join ev on ev.station_id = s.id
group by s.id;

-- ============ RLS ============
alter table public.stations enable row level security;
alter table public.events   enable row level security;

create policy "anyone can read stations" on public.stations
  for select to anon, authenticated using (true);
create policy "anyone can update station status" on public.stations
  for update to anon, authenticated using (true) with check (true);
create policy "anyone can read events" on public.events
  for select to anon, authenticated using (true);
-- No insert policy on events: only the security-definer trigger writes there.

-- Column-level lock: anon may only change status / reason / note
revoke update on public.stations from anon, authenticated;
grant  update (status, reason, note) on public.stations to anon, authenticated;
revoke insert, delete on public.stations from anon, authenticated;

-- ============ DEMO RESET (P2) ============
create or replace function public.reset_demo()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.events where true;
  update public.stations
     set status = 'green', reason = null, note = null,
         status_since = now()
   where true;
  delete from public.events where true;  -- remove events the trigger just logged
end;
$$;
grant execute on function public.reset_demo() to anon, authenticated;

-- ============ REALTIME ============
alter publication supabase_realtime add table public.stations;
alter publication supabase_realtime add table public.events;

-- ============ SEED: a realistic SMT line ============
insert into public.stations (name, position) values
  ('Solder Paste Printer', 1),
  ('SPI',                  2),
  ('Pick & Place 1',       3),
  ('Pick & Place 2',       4),
  ('Reflow Oven',          5),
  ('AOI',                  6),
  ('ICT',                  7),
  ('Packing',              8);
