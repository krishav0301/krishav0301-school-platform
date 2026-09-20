# Hosting options (free-first)

Date: 2026-09-20. Status: **research done; one-day test not yet run. Direction is D-018.**

## Constraint

PM: the whole project budget is 50K a year (assumed NPR, about US$350) and there is no money for servers. Run free first; hosting cost moves into the yearly subscription later. About 1,500 users, quiet most days, a few hundred logins at once on results day.

## What the research found (prices and limits as read on 2026-09-20; confirm at signup)

| Platform | Free offer | Verdict |
|---|---|---|
| Cloudflare Pages, DNS, CDN | Static hosting, free | Use |
| Cloudflare R2 | 10 GB, no download fees | Use for uploads and backups |
| Cloudflare Workers | Free: 100,000 requests/day, **10 ms CPU per request**. Paid from $5/month: 30 s CPU | Free CPU limit is too tight for password hashing. Paid likely needed |
| Cloudflare D1 (SQLite) | Free: 5 GB, 5M rows read/day, 100K written/day. **Hard limits enforced from 1 Sep 2026** | Possible. No database roles, so audit "insert-only" cannot be enforced by database permissions. Restore window not confirmed |
| Cloudflare Durable Objects (SQLite) | Available on the free plan | Possible for strict transactions. Unproven for us |
| Cloudflare Queues, cron | Queues free since Feb 2026 (10K ops/day, 24 h retention). 3 cron triggers per Worker. One user reported free cron triggers stopping on 15 Sep 2026 | Usable, watch reliability |
| Cloudflare Browser Rendering | Free: 10 min/day. Paid: 10 h/month | Fine for PDFs if generated at publish time |
| Cloudflare Containers | Paid only, per-10ms billing | Not for free |
| Django on Workers | Python Workers + Hyperdrive in beta (Sep 2026); `psycopg` unsupported | Not viable |
| Northflank Sandbox | 2 always-on services, 1 database, 2 cron jobs, free forever. Singapore. Resource sizes unpublished | Best free home for Django if we keep it |
| Neon | 0.5 GB, 6-hour restore window, Singapore region, 100 CU-hours | Best free PostgreSQL |
| Aiven free Postgres | 1 GB, backups, Bangalore only, powers off when idle | Second choice |
| Oracle Always Free | Halved in June 2026 to 2 CPU / 12 GB. Idle instances can be reclaimed | Avoid |
| Google Cloud Run | 2M requests/month free. Django cold starts up to about 11 s. No worker | Poor fit |
| Koyeb | Free tier closed to new users | Out |
| Supabase | Free: no backups, pauses after a week idle. Pro $25/month (7 days of backups); point-in-time recovery +$100/month | Out (cost and RLS risk) |
| Render free, Vercel Hobby | Sleeps / DB expires in 30 days; Hobby forbids commercial use | Out |
| Native Android app | iOS is 25.5% of mobile use in Nepal (Aug 2026). Play Store account $25; personal accounts need 12 testers for 14 days | Not now. Use an installable web app |

## Two paths, both free to start

- **B. All-Cloudflare** (Pages, Workers, D1 or Durable Objects, R2, Queues). One vendor. Backend rewritten in TypeScript. Probably needs Workers Paid ($5/month, about NPR 8,400/year) because of the CPU limit.
- **A. Keep Django** (D-005). Cloudflare Pages and R2, Northflank Sandbox for API and worker, Neon Singapore for the database. About $0, or about $72/year if a small server is needed.

The front end is static export in both (API on a subdomain, cookies same-site, CORS). This replaces the `/api` proxy in D-016 if we go static.

## One-day test (decides between A and B)

1. Approve-and-apply and gapless receipt numbers stay correct under two simultaneous requests.
2. Login time with the strongest password hashing Workers allows, on free and paid.
3. A receipt PDF with Devanagari through Browser Rendering.
4. How far back the database can be restored (Time Travel or Durable Object bookmarks).
5. For A: Django hello plus a database round trip on Northflank and Neon, measured.

Pass B: propose replacing the Django backend. Fail B: A.

## Regardless of path

- Nightly encrypted database copy to R2 and a second location, because free tiers give little or no backup.
- Tripwire to move to a small paid server (about NPR 10,000/year): results-day slowness, a free-tier rule change, data over the free limit, or a need for longer restore history.
- Keep the apps portable so moving host is a configuration change.
