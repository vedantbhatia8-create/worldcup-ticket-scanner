# World Cup Ticket Watch

Personal price monitor for **FIFA World Cup 2026 Quarterfinal — Argentina vs Switzerland**
(Sat Jul 11, 2026, 9:00 PM ET, Arrowhead Stadium, Kansas City).

Polls Ticketmaster Discovery + SeatGeek every 30 minutes (GitHub Actions → `/api/scan`),
stores snapshots in Supabase, and pushes an ntfy.sh alert when a listing hits your target price.

## Setup checklist

1. **Supabase**: create a project, open the SQL editor, run `supabase/schema.sql`.
2. **Local env**: `cp .env.local.example .env.local`, fill in every value.
   Generate `CRON_SECRET` with `openssl rand -hex 32`.
3. **ntfy**: install the ntfy app on your phone and subscribe to your `NTFY_TOPIC`.
4. **Vercel → Project → Settings → Environment Variables**: add the same vars as `.env.local`
   (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `TICKETMASTER_API_KEY`, `SEATGEEK_CLIENT_ID`,
   `NTFY_TOPIC`, `CRON_SECRET`, `MY_TARGET_PRICE`).
5. **GitHub → repo → Settings → Secrets and variables → Actions**: add
   - `APP_URL` — your deployed URL, e.g. `https://wc26-ticket-watch.vercel.app` (no trailing slash)
   - `CRON_SECRET` — same value as in Vercel.
6. Push to GitHub; Vercel auto-deploys. The `Ticket price scan` workflow then runs every
   30 min (you can also trigger it manually from the Actions tab).

## Test it

```bash
npm run dev
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/scan
```

Dashboard at `/` — current lowest price per source, history chart, editable target price,
Scan Now button.

## Notes

- Ticketmaster Discovery returns price *ranges* per event; SeatGeek returns event-level
  stats (lowest price + listing count). Neither exposes individual seat listings publicly,
  so alerts key off the lowest listed price per source.
- Duplicate alerts for the same source/listing/price are suppressed for 6 hours
  (`ALERT_DEDUPE_HOURS` in `lib/event.ts`).
- The dashboard target price (stored in Supabase) overrides `MY_TARGET_PRICE`.
