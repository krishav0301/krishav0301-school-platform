# Spike: all-Cloudflare backend (Workers + D1 + Browser Rendering)

Date: 2026-09-20. Phase 0. Status: **test passed with caveats. Recommendation is D-019, awaiting PM approval.**

Run on a real, new, free Cloudflare account (no payment method). Code is in `spikes/cloudflare/`. The test Worker, database and account link were deleted afterwards.

## Question

Can a backend written for Cloudflare Workers with D1 (SQLite) keep the money and approval rules correct, at $0 to start? (See `hosting-options.md`.)

## Results

| # | Test | Result |
|---|---|---|
| 1 | 10 approvals, each raced by 8 people at the same instant (approve and apply in one batch) | **Exactly one winner every time.** The requester never won. No errors |
| 2 | 60 valid and 15 invalid payments fired together, with gapless receipt numbers | 60 accepted, 15 rejected. Receipt numbers **1 to 60, no gap, no duplicate.** The 15 failures rolled back the counter too (next number 61) |
| 3 | Try to update or delete a ledger row | **Blocked** by database triggers |
| 4 | Can our own Worker remove that guard? | **Yes.** It dropped the trigger and edited a ledger row. D1 has no separate database accounts to prevent this |
| 5 | Password hashing, PBKDF2 | **Hard cap of 100,000 rounds** in the runtime (`iteration counts above 100000 are not supported`). Not a CPU limit, so paying would not raise it |
| 6 | Password hashing, scrypt in JavaScript | 16 to 32 MiB (N=2^14 to 2^15) works on the free plan at about 0.3 to 0.5 s each. 64 MiB is intermittent (503). 128 MiB fails (memory limit) |
| 7 | 150 logins at once with scrypt N=2^14 | 145 succeeded, 5 returned a temporary 503. Median 0.42 s, 95th percentile 0.94 s. 60 at once with N=2^15: 58 succeeded, 2 returned 503 |
| 8 | Nepali receipt as PNG and PDF (Cloudflare Browser Rendering) | Text renders **correctly** (conjuncts, vowel signs, Nepali digits). One PDF about 5.4 s including browser start. **30 PDFs in one session took 3.5 s** (6.9 s total) |
| 9 | Starting browsers back to back on the free plan | `429 Rate limit exceeded`. Waiting a minute cleared it. Generate in batches |
| 10 | PDF text layer | Scrambled for Nepali, same as the earlier Edge test. The database is the record |
| 11 | Database restore (Time Travel) | Works on the free plan. Added rows, restored to an earlier moment, rows gone. **30-day window.** Gives an undo bookmark |
| 12 | Speed from Nepal | Route without the database: median 80 ms (served from Singapore). Each database round trip costs about 100 ms. Four queries one by one: 491 ms. **The same four in one batch: 184 ms** |
| 13 | File storage (R2) | Cannot be created from the command line: `Please enable R2 through the Cloudflare Dashboard`. Likely needs a payment method (not confirmed) |

## What was not tested or not verified

- The PDF's drawn output was not viewed in a PDF viewer (the browser pane would not open the page). The PNG of the same page is correct, so this is an inference. Check before Phase 6.
- The free plan documents a 10 ms CPU limit per request. It did not stop scrypt in these tests, but I would not rely on that. Cloudflare began enforcing D1 free limits on 1 Sep 2026, so rules do change.
- Cron triggers and Queues (one user reported free cron triggers stopping on 15 Sep 2026).
- Durable Objects, and a multi-day soak test.
- Local test tooling for Workers (needed for our automated tests). Set up in Phase 1.
- Whether R2 needs a card.

## Assessment

**Strong:** the two things I most feared, simultaneous approvals and gapless receipt numbers, worked under real concurrency. Restore is generous (30 days versus 6 hours on Neon's free tier). Pages are fast from Nepal if we make one database call per request. Nepali PDFs work. One vendor, no servers, $0 to start.

**Weak, and what to do:**
1. **Immutability is not enforced by database permissions** (test 4). Mitigate with a hash chain: every ledger and audit row stores a hash of the previous row, so any edit is detectable, plus a daily export of the chain to a second location. This makes tampering detectable, not impossible. Never put schema-changing statements in application code.
2. **Password hashing:** use scrypt (N=2^15, r=8, p=1) in JavaScript, with lockout and rate limiting, and retry on 503. PBKDF2 at 100,000 rounds is the fallback and is much weaker.
3. **Speed:** one database round trip per request (use batches and joins). Add a rule to `CLAUDE.md`.
4. **Files:** R2 needs enabling and possibly a card. Decision needed.
5. **It is a backend rewrite** in TypeScript, and a newer, less common platform than Django. We lose Django's login, migrations and test tooling, and take on some lock-in.

## Recommendation (D-019)

Proceed with Cloudflare for the backend (TypeScript Workers with D1), with the mitigations above, and retire the Django skeleton. If a later test or a rule change breaks this, the fallback in `hosting-options.md` (Django on free tiers) still stands, and the data model and permission matrix carry over unchanged.
