# Pocket Andon

A live factory-floor alert board. Operators signal station status from their phones; the supervisor board updates instantly and every change is logged by a Postgres trigger.

Static HTML + vanilla JS, with Supabase (Postgres, Realtime, RLS) as the only backend. There is no build step.

## Setup

1. **Supabase:** create a new project → SQL Editor → paste `supabase/schema.sql` → Run.
2. **Keys:** Project Settings → API → copy the Project URL and the `anon` public key into `js/config.js`.
3. **Test locally:** run `npx serve .` and open `http://localhost:3000/board` and `/station?id=1` in two tabs.
4. **Deploy:**
   - Option A: `npx vercel --prod` from the project folder (framework preset: Other, no build command, output directory `.`).
   - Option B: push to GitHub → Vercel → Import Project → deploy with default settings.
5. Open the deployed `/board` on the big screen and scan its QR code with a phone to test.

## Troubleshooting

If pages show `permission denied for table stations`, your project does not grant new tables to the API roles by default. Run this in the SQL Editor:

```sql
grant select on public.stations, public.events, public.station_downtime_today to anon, authenticated;
```

## Pages

| Path | Purpose |
|---|---|
| `/` | Station list, board link, QR code |
| `/station?id=N` | Operator controls for one station |
| `/board` | Supervisor dashboard |

## Security model

There is no login: the anon key is public by design. RLS and column-level grants limit anonymous clients to reading data and changing a station's `status`, `reason` and `note`. Only the trigger writes to `events`. `reset_demo()` is callable by anyone, so remove it before any real use.
