# Pocket Andon — PRD & Build Instructions

> **For Claude Code:** Read this whole file before writing code. Build exactly what's described in "Build Instructions". Priorities are P0 (must ship), P1 (ship if time allows), P2 (only if everything else works). We have ~60 minutes total, so prefer simple and working over clever.

---

## 1. Product Summary

**Pocket Andon** is a live factory-floor alert board for small manufacturers. Operators use their phones to signal station status (green / yellow / red). A supervisor dashboard updates instantly, shows how long each station has been down, and logs every change automatically.

**Problem:** Commercial andon systems cost thousands of dollars per line and need dedicated hardware. Small SMT and assembly shops end up relying on shouting, walkie-talkies, or WhatsApp groups. Downtime goes unmeasured, so it never gets fixed.

**Solution:** Every operator already has a phone. Scan a QR code at the station, tap a button, and the supervisor sees it in under a second. Downtime is measured automatically in the database.

**Hackathon context:** Built with Supabase (Postgres + Realtime + RLS) and deployed on Vercel. In the demo, judges scan a QR code, become operators, and watch the board react live.

---

## 2. Users

| User | Device | Goal |
|---|---|---|
| Operator | Phone | Raise or clear an alert in under 3 seconds, with no login |
| Supervisor | Laptop / TV screen | See the whole floor at a glance and spot problems immediately |

---

## 3. Features

### P0 — Must ship
1. **Station page** (`/station?id=N`)
   - Shows the station name and current status in a big color block.
   - Three large buttons: **Running** (green), **Attention** (yellow), **Line Down** (red).
   - Tapping yellow or red shows reason chips: `Material shortage`, `Machine fault`, `Quality issue`, `Need help`. One tap on a chip submits.
   - Optional one-line note field (submits along with the reason if filled).
   - Shows "in this state for mm:ss" using a live ticking timer.
   - Subscribes to its own station row so it updates if someone else changes it.
2. **Board page** (`/board`)
   - Grid of station tiles, colored by status, each showing name, reason, note, and live elapsed timer.
   - Red tiles pulse (CSS animation) so they catch the eye.
   - Summary bar at top: count of green / yellow / red stations.
   - Updates in realtime via Supabase Realtime. **No page refresh, no polling.**
3. **Automatic event log**: every status change is recorded by a Postgres trigger, never by the client.
4. **Landing page** (`/`)
   - List of stations as links to their station pages.
   - Link to the board.
5. **Deployed to Vercel** with a working public URL.

### P1 — Ship if time allows
6. **Downtime today** on each board tile (from the `station_downtime_today` view), refreshed whenever an event arrives.
7. **Live event feed** on the board: last 10 events ("AOI → RED · Quality issue · 14:32").
8. **QR code** on the board page (corner) and landing page linking to the landing page, so judges can join from their phones.
11. **Footer** on every page: "Built with Supabase · Postgres + Realtime + RLS", plus a link to the GitHub repo.
12. **Live status dot** on the board: "● Live via Supabase Realtime", which turns grey and says "Reconnecting…" if the socket drops.

### P2 — Nice to have
9. **Reset demo** button on the board (calls `reset_demo()` RPC): all stations back to green, events cleared.
10. Sound or browser-tab title flash when a station goes red.

### Out of scope
- Login / auth / multiple factories (mention in the pitch as the production roadmap).
- Editing stations from the UI (seeded via SQL).
- Historical analytics beyond "today".

---

## 4. Tech Stack & Constraints

- **Frontend:** Plain HTML + vanilla JavaScript (ES modules) + one CSS file. **No framework, no bundler, no npm build step.**
  - *Why:* zero toolchain to debug in a 1-hour build; Vercel serves a static folder instantly.
- **Supabase client:** `supabase-js` v2 via ESM CDN:
  `import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'`
- **QR codes:** `qrcodejs` from cdnjs: `https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js`
- **Backend:** Supabase only: tables, trigger, view, RLS, Realtime. No Edge Functions, no custom server.
- **Hosting:** Vercel static deploy with `cleanUrls`.
- **Auth:** none. The anon key is public by design. Safety comes from RLS and column-level grants (see SQL).

---

## 5. Data Model (run in Supabase SQL Editor)

Create `supabase/schema.sql` with exactly this content. The human will paste it into the Supabase SQL Editor.

```sql
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
```

---

## 6. Build Instructions (for Claude Code)

### 6.1 File structure
```
pocket-andon/
├── index.html          # landing: station list + board link + QR
├── station.html        # operator page (?id=N)
├── board.html          # supervisor dashboard
├── css/styles.css
├── js/config.js        # SUPABASE_URL + SUPABASE_ANON_KEY (placeholders)
├── js/supabase.js      # creates and exports the client
├── js/station.js
├── js/board.js
├── js/index.js
├── supabase/schema.sql # section 5, verbatim
├── vercel.json         # { "cleanUrls": true }
└── README.md           # setup + deploy steps (section 7)
```

### 6.2 `js/config.js`
```js
export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
```
Leave placeholders. The human fills them in. Do not hardcode real keys anywhere else.

### 6.3 Behavior details
- **Status colors:** green `#16a34a`, yellow `#eab308`, red `#dc2626`. Text on yellow must be dark for contrast.
- **Updating status:** `supabase.from('stations').update({ status, reason, note }).eq('id', id)`. Send **only** these three columns (others are blocked by grants and will error).
- **Clearing to green:** send `{ status: 'green', reason: null, note: null }`.
- **Realtime (station page):** subscribe to `postgres_changes`, event `UPDATE`, table `stations`, filter `id=eq.${id}`.
- **Realtime (board):** one channel subscribed to `UPDATE` on `stations` (replace the tile in local state and re-render it) and `INSERT` on `events` (prepend to the feed and re-fetch `station_downtime_today`).
- **Timers:** compute elapsed time client-side from `status_since`, ticking once per second with a single `setInterval` for the whole page. Format as `mm:ss`, or `h:mm:ss` past one hour.
- **Initial load:** fetch stations ordered by `position`. Board also fetches the downtime view and the last 10 events, joined to station names client-side.
- **Error handling:** if an update fails, show a small red toast with the error message. If realtime disconnects, the board's live status dot turns grey and says "Reconnecting…".
- **Invalid station id:** show "Station not found" with a link back to `/`.

### 6.4 Layout & style
- **Station page (mobile-first):** full-height layout. Status block on top (~35% of height), three stacked buttons each ≥ 72px tall, large text. Must be usable one-handed with gloves on: big tap targets, no small links.
- **Board (desktop / TV):** dark background (`#0f172a`), responsive grid (`repeat(auto-fill, minmax(220px, 1fr))`), tiles with large station names. Summary bar on top, event feed as a right sidebar on wide screens and below the grid on narrow ones. Red tiles pulse via CSS `@keyframes`.
- System font stack, no external font loading.

### 6.5 Build order (follow this sequence)
1. `schema.sql`, `config.js`, `supabase.js`, `vercel.json`
2. `station.html` + `station.js` (P0)
3. `board.html` + `board.js`: tiles, summary bar, realtime, timers (P0)
4. `index.html` + `index.js` (P0)
5. Downtime per tile, event feed, QR code (P1)
6. Reset button, red alert sound / title flash (P2)
7. `README.md`

After each step, the app must still load without console errors.

### 6.6 Acceptance checks
- [ ] Opening `/station?id=6` on a phone and tapping **Line Down → Quality issue** turns the AOI tile red on `/board` within ~1 second, without a refresh.
- [ ] The tile timer starts from 00:00 and ticks.
- [ ] Tapping **Running** turns the tile green and clears the reason.
- [ ] A row appears in `events` for each change (check the Supabase table editor).
- [ ] Two phones changing different stations at once both appear correctly on the board.
- [ ] Running `supabase.from('stations').update({ name: 'hacked' }).eq('id', 1)` from the browser console **fails** (column grant works).
- [ ] The deployed Vercel URL works on mobile data, not just local wifi.

---

## 7. Human Setup Steps (put these in README.md)

1. **Supabase:** create a new project → SQL Editor → paste `supabase/schema.sql` → Run.
2. **Keys:** Project Settings → API → copy the Project URL and the `anon` public key into `js/config.js`.
3. **Test locally:** `npx serve .` and open `http://localhost:3000/board` and `/station?id=1` in two tabs.
4. **Deploy:**
   - Option A: `npx vercel --prod` from the project folder (framework preset: Other, no build command, output directory `.`).
   - Option B: push to GitHub → Vercel → Import Project → deploy with default settings.
5. Open the deployed `/board` on the big screen and scan its QR code with a phone to test.

---

## 8. Demo Script (3 minutes)

1. **Problem (30s):** "On an SMT line, when a machine stops, the supervisor often finds out minutes later. Commercial andon systems cost thousands per line. Small factories can't afford them."
2. **Live demo (90s):** Board on screen with all green. Ask judges to scan the QR code and pick a station. They tap red, and the tiles turn red live. Point out the timers and the event feed.
3. **Under the hood (40s):** "The client never writes the log: a Postgres trigger does. Downtime is a SQL view. Row-level security plus column grants mean operators can change status but nothing else. Realtime pushes changes to every screen."
4. **Roadmap (20s):** multi-factory login, WhatsApp / Telegram escalation after N minutes red, weekly downtime Pareto by reason.
